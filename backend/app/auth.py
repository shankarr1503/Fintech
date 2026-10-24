"""Sessions, second factor (app PIN) and per-user access control.

Sign-in is two factors: an SMS OTP (something you have) and a 4-6 digit app
PIN (something you know). New users set the PIN right after their first OTP.

Every token maps to a server-side session, so sessions can be listed, revoked
and timed out: 15 minutes without activity, 30 days at most.

`require_user` also rejects any request whose `user_id` (path, query or JSON
body) isn't the caller's, and stores the caller on `request.state`.
"""
import asyncio
import hashlib
import hmac
import json
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import HTTPException, Request
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from .config import settings
from .db import db

logger = logging.getLogger(__name__)

ALGORITHM = "HS256"
SESSION_TTL = timedelta(days=30)
IDLE_TIMEOUT = timedelta(minutes=settings.idle_timeout_minutes)
MFA_TTL = timedelta(minutes=5)
STEP_UP_TTL = timedelta(minutes=5)
PIN_ATTEMPTS = 5
PIN_LOCK = timedelta(minutes=15)
PBKDF2_ROUNDS = 210_000
# All an OTP-only session (no PIN set yet) may call: the PIN is the second factor, not optional.
PIN_SETUP_PATHS = {"/api/auth/pin", "/api/auth/logout"}

_secret = settings.secret_key
if not _secret:
    _secret = secrets.token_urlsafe(48)
    # Only reachable in demo mode: config refuses to start a real deployment without SECRET_KEY.
    logger.warning("SECRET_KEY not set - using a random key; sessions end when the server restarts")


def sign(text: str) -> str:
    """HMAC for links sent outside the app (e.g. email unsubscribe), so they can't be forged."""
    return hmac.new(_secret.encode(), text.encode(), hashlib.sha256).hexdigest()[:32]


def _now() -> datetime:
    return datetime.utcnow()


def _encode(claims: dict, ttl: timedelta) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode({**claims, "iat": now, "exp": now + ttl}, _secret, algorithm=ALGORITHM)


def _decode(token: str, kind: str) -> dict:
    try:
        claims = jwt.decode(token, _secret, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")
    if claims.get("typ") != kind:
        raise HTTPException(status_code=401, detail="Invalid token")
    return claims


def device_of(request: Request) -> dict:
    return {
        "device_id": (request.headers.get("x-device-id") or "unknown")[:64],
        "device_name": (request.headers.get("x-device-name") or request.headers.get("user-agent", "Unknown device"))[:80],
    }


# ---------------------------------------------------------------- PIN

WEAK_PINS = {"0000", "1111", "1234", "4321", "1212", "000000", "111111", "123456", "654321", "121212", "123123", "112233"}


def pin_problem(pin: str) -> Optional[str]:
    if not pin.isdigit() or not 4 <= len(pin) <= 6:
        return "PIN must be 4 to 6 digits"
    if pin in WEAK_PINS or len(set(pin)) == 1:
        return "That PIN is too easy to guess"
    digits = [int(c) for c in pin]
    steps = {b - a for a, b in zip(digits, digits[1:])}
    if steps in ({1}, {-1}):
        return "Avoid sequences like 2345"
    return None


def hash_pin(pin: str, salt: Optional[bytes] = None) -> dict:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt, PBKDF2_ROUNDS)
    return {"salt": salt.hex(), "hash": digest.hex(), "rounds": PBKDF2_ROUNDS}


async def hash_pin_async(pin: str) -> dict:
    """hash_pin off the event loop: 210k PBKDF2 rounds would stall every other request."""
    return await asyncio.to_thread(hash_pin, pin)


async def check_pin(user: dict, pin: str) -> None:
    """Raise unless `pin` matches. Locks the PIN for 15 minutes after 5 wrong tries."""
    record = user.get("pin")
    if not record:
        raise HTTPException(status_code=409, detail="Set up your app PIN first")
    # Reserve an attempt atomically before checking, so parallel guesses can't all read the same
    # count: at most PIN_ATTEMPTS guesses are ever compared before the lock.
    now = _now()
    reserved = await db.users.find_one_and_update(
        {"id": user["id"], "pin_attempts": {"$not": {"$gte": PIN_ATTEMPTS}},
         "$or": [{"pin_locked_until": {"$exists": False}}, {"pin_locked_until": {"$lte": now}}]},
        {"$inc": {"pin_attempts": 1}},
        return_document=ReturnDocument.AFTER,
    )
    if not reserved:
        current = await db.users.find_one({"id": user["id"]}) or {}
        locked = current.get("pin_locked_until")
        minutes = max(1, int((locked - now).total_seconds() // 60) + 1) if locked and locked > now else 15
        raise HTTPException(status_code=423, detail=f"PIN locked. Try again in {minutes} minutes.")
    candidate = (await asyncio.to_thread(
        hashlib.pbkdf2_hmac, "sha256", pin.encode(), bytes.fromhex(record["salt"]), record.get("rounds", PBKDF2_ROUNDS)
    )).hex()
    if hmac.compare_digest(candidate, record["hash"]):
        await db.users.update_one({"id": user["id"]}, {"$set": {"pin_attempts": 0}, "$unset": {"pin_locked_until": ""}})
        return
    attempts = reserved["pin_attempts"]
    if attempts >= PIN_ATTEMPTS:
        await db.users.update_one({"id": user["id"]}, {"$set": {"pin_attempts": 0, "pin_locked_until": _now() + PIN_LOCK}})
        from .services import audit, notify

        await audit.record("pin_locked", user["id"], {})
        await notify.send(user["id"], "security", "PIN locked", "Too many wrong PIN attempts. It unlocks in 15 minutes. If this wasn't you, change your PIN.")
        raise HTTPException(status_code=423, detail="Too many wrong attempts. PIN locked for 15 minutes.")
    left = PIN_ATTEMPTS - attempts
    # 403, not 401: the session is still valid, only this PIN was wrong (clients sign out on 401).
    raise HTTPException(status_code=403, detail=f"Wrong PIN. {left} attempt{'s' if left != 1 else ''} left.")


# ---------------------------------------------------------------- tokens

def mfa_token(user_id: str) -> str:
    """Short-lived proof that the OTP step passed; exchanged for a session after the PIN."""
    return _encode({"sub": user_id, "typ": "mfa"}, MFA_TTL)


def user_from_mfa(token: str) -> str:
    return _decode(token, "mfa")["sub"]


def step_up_token(user_id: str, sid: str) -> str:
    """Proof of a fresh PIN entry, required for large payments. Bound to the session."""
    return _encode({"sub": user_id, "sid": sid, "typ": "step_up", "jti": secrets.token_urlsafe(12)}, STEP_UP_TTL)


def require_step_up(request: Request) -> dict:
    token = request.headers.get("x-step-up-token")
    if not token:
        raise HTTPException(status_code=428, detail="Enter your PIN to confirm this payment")
    try:
        claims = _decode(token, "step_up")
    except HTTPException:
        # Not 401: the session is fine, only the PIN confirmation expired. Ask for the PIN again.
        raise HTTPException(status_code=428, detail="Your PIN confirmation expired. Enter your PIN again.")
    if claims["sub"] != request.state.user_id or claims.get("sid") != request.state.session_id:
        raise HTTPException(status_code=403, detail="PIN confirmation doesn't match this session")
    return claims


async def use_step_up(request: Request) -> None:
    """require_step_up, and spend the token: one PIN entry confirms one sensitive action."""
    claims = require_step_up(request)
    try:
        await db.used_step_ups.insert_one({"jti": claims["jti"], "expires_at": _now() + STEP_UP_TTL})
    except (KeyError, DuplicateKeyError):
        raise HTTPException(status_code=428, detail="Enter your PIN to confirm this payment")


async def create_session(user_id: str, request: Request, needs_pin: bool = False) -> str:
    """`needs_pin`: the user signed in with only an OTP and has no PIN yet. Until they set one,
    the session can do nothing but set it (see PIN_SETUP_PATHS)."""
    sid = secrets.token_urlsafe(18)
    now = _now()
    await db.sessions.insert_one({
        "sid": sid,
        "user_id": user_id,
        "needs_pin": needs_pin,
        **device_of(request),
        "ip": request.client.host if request.client else "unknown",
        "created_at": now,
        "last_seen": now,
        "expires_at": now + SESSION_TTL,
        "revoked": False,
    })
    return _encode({"sub": user_id, "sid": sid, "typ": "session"}, SESSION_TTL)


async def revoke_session(sid: str, reason: str) -> None:
    await db.sessions.update_one({"sid": sid}, {"$set": {"revoked": True, "revoked_reason": reason, "revoked_at": _now()}})


async def session_from_token(token: str) -> dict:
    claims = _decode(token, "session")
    session = await db.sessions.find_one({"sid": claims.get("sid")})
    if not session or session.get("revoked") or session["user_id"] != claims["sub"]:
        raise HTTPException(status_code=401, detail="Session ended. Please sign in again.")
    now = _now()
    if now - session["last_seen"] > IDLE_TIMEOUT:
        await revoke_session(session["sid"], "idle_timeout")
        raise HTTPException(status_code=401, detail="Signed out after 15 minutes of inactivity.")
    if now - session["last_seen"] > timedelta(seconds=30):  # avoid a write on every request
        await db.sessions.update_one({"sid": session["sid"]}, {"$set": {"last_seen": now}})
    return session


async def require_user(request: Request) -> str:
    """FastAPI dependency: authenticate the caller and enforce user_id ownership."""
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Sign in required")
    session = await session_from_token(header[7:].strip())
    user_id = session["user_id"]

    claimed = [request.path_params.get("user_id"), request.query_params.get("user_id")]
    content_type = request.headers.get("content-type", "").lower()
    is_form = content_type.startswith(("multipart/", "application/x-www-form-urlencoded"))
    if request.method in ("POST", "PUT", "PATCH", "DELETE") and not is_form:
        # Inspect any other body that parses as JSON, whatever the Content-Type says: FastAPI
        # reads `application/JSON` or `+json` bodies too, so a header-based check can be sidestepped.
        # (Form uploads are parsed as forms, never as JSON, and their stream is already consumed.)
        raw = await request.body()  # Starlette caches the body for the route
        try:
            body = json.loads(raw) if raw else None
        except (ValueError, UnicodeDecodeError):
            body = None
        if isinstance(body, dict):
            claimed.append(body.get("user_id"))
    if any(c is not None and c != user_id for c in claimed):
        raise HTTPException(status_code=403, detail="You can only access your own account")

    if session.get("needs_pin") and request.url.path not in PIN_SETUP_PATHS:
        user = await db.users.find_one({"id": user_id}, {"pin": 1})
        if not (user or {}).get("pin"):
            # 403 rather than 401: the session is fine, it just can't be used until the PIN exists.
            raise HTTPException(status_code=403, detail="Set up your app PIN first")
        await db.sessions.update_one({"sid": session["sid"]}, {"$set": {"needs_pin": False}})

    request.state.user_id = user_id
    request.state.session_id = session["sid"]
    return user_id


def current_user(request: Request) -> str:
    """The authenticated user id (set by require_user)."""
    return request.state.user_id
