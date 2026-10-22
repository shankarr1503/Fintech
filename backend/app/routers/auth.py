import hashlib
import hmac
import logging
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from pymongo import ReturnDocument

from ..auth import (
    check_pin,
    create_session,
    current_user,
    device_of,
    hash_pin_async,
    mfa_token,
    pin_problem,
    require_user,
    revoke_session,
    step_up_token,
    user_from_mfa,
)
from ..config import settings
from ..db import db
from ..models import OTPRequest, OTPVerify, User
from ..ratelimit import client_ip, limit
from ..services import audit, crypto, notify, privacy
from ..services.sample_data import generate_sample_data

router = APIRouter()
logger = logging.getLogger(__name__)

OTP_TTL = timedelta(minutes=5)
MAX_OTP_ATTEMPTS = 5
# Bump when the Terms or Privacy Policy change; users accept the new version at next sign-in.
TERMS_VERSION = "2026-10"
INVALID = "Invalid or expired code"  # same message for unknown phone, wrong or expired code
CONSENT_REQUIRED = "Confirm you're 18 or older and accept the Terms and Privacy Policy to continue"


def _hash_otp(phone: str, otp: str) -> str:
    """OTPs are stored hashed (keyed by phone) so a database leak doesn't reveal live codes."""
    return hashlib.sha256(f"{phone}:{otp}".encode()).hexdigest()


@router.post("/auth/send-otp")
async def send_otp(request: OTPRequest, http: Request):
    """Send a one-time code (returned in the response in demo mode).

    Nothing is stored about the number except the hashed code, which expires in 5 minutes.
    The account itself is created only after the code is verified and the Terms are accepted."""
    await limit(f"otp-send:phone:{request.phone}", 3, 600)
    await limit(f"otp-send:ip:{client_ip(http)}", settings.otp_sends_per_ip_hour, 3600)

    otp = "".join(secrets.choice("0123456789") for _ in range(6))
    await db.otp_codes.update_one(
        {"phone": request.phone},
        {"$set": {"otp_hash": _hash_otp(request.phone, otp), "expires_at": datetime.utcnow() + OTP_TTL, "attempts": 0}},
        upsert=True,
    )

    if not settings.demo_mode:
        # Production: hand the OTP to your SMS provider here.
        return {"message": "OTP sent successfully"}

    logger.info(f"OTP for {request.phone}: {otp}")
    return {"message": "OTP sent successfully", "demo_otp": otp}


async def _check_otp(phone: str, otp: str, http: Request) -> None:
    """Raise unless `otp` is the live code for `phone`. Doesn't use the code up (see _consume_otp)."""
    await limit(f"otp-verify:ip:{client_ip(http)}", settings.otp_verifies_per_ip_10min, 600)
    # Reserve an attempt before comparing: the atomic $inc means parallel guesses each use up
    # one of the MAX_OTP_ATTEMPTS, instead of all reading the same count.
    code = await db.otp_codes.find_one_and_update(
        {"phone": phone, "expires_at": {"$gt": datetime.utcnow()}, "attempts": {"$lt": MAX_OTP_ATTEMPTS}},
        {"$inc": {"attempts": 1}},
        return_document=ReturnDocument.AFTER,
    )
    if not code:
        if await db.otp_codes.find_one({"phone": phone, "attempts": {"$gte": MAX_OTP_ATTEMPTS}}):
            await db.otp_codes.delete_one({"phone": phone})
            raise HTTPException(status_code=400, detail="Too many wrong codes. Request a new one.")
        raise HTTPException(status_code=400, detail=INVALID)
    if hmac.compare_digest(code["otp_hash"], _hash_otp(phone, otp)):
        # Right code: the consent step may send it again, so give its attempts back.
        await db.otp_codes.update_one({"phone": phone}, {"$set": {"attempts": 0}})
        return
    user = await db.users.find_one({"phone": phone})
    await audit.record("login_otp_failed", user["id"] if user else None, {"phone": f"******{phone[-4:]}"}, http)
    attempts = code["attempts"]
    if attempts >= MAX_OTP_ATTEMPTS:
        # Burn the code: guessing has to start over with a fresh (rate-limited) send.
        await db.otp_codes.delete_one({"phone": phone})
        raise HTTPException(status_code=400, detail="Too many wrong codes. Request a new one.")
    left = MAX_OTP_ATTEMPTS - attempts
    raise HTTPException(status_code=400, detail=f"Wrong code. {left} attempt{'s' if left != 1 else ''} left.")


async def _consume_otp(phone: str) -> None:
    await db.otp_codes.delete_one({"phone": phone})


@router.post("/auth/verify-otp")
async def verify_otp(request: OTPVerify, http: Request):
    """Verify the code and start a session. New users must confirm they're 18+ and accept the Terms."""
    await _check_otp(request.phone, request.otp, http)
    user = await db.users.find_one({"phone": request.phone})

    needs_consent = not user or not user.get("consents")
    if needs_consent and (request.accept_terms != TERMS_VERSION or not request.confirm_age):
        # 428: the code is still valid; the app asks for consent and sends it again.
        raise HTTPException(status_code=428, detail=CONSENT_REQUIRED)

    await _consume_otp(request.phone)
    if not user:
        user = User(phone=request.phone).model_dump()
        await db.users.insert_one(dict(user))
        # New players get a demo world to explore.
        await generate_sample_data(user["id"])

    if needs_consent:
        consent = {"terms": TERMS_VERSION, "privacy": TERMS_VERSION, "age_18_plus": True, "at": datetime.utcnow().isoformat()}
        await db.users.update_one({"id": user["id"]}, {"$push": {"consents": consent}})
        await audit.record("terms_accepted", user["id"], {"version": TERMS_VERSION, "age_18_plus": True}, http)
    await audit.record("login_otp_verified", user["id"], {"phone": f"******{request.phone[-4:]}"}, http)
    if user.get("pin"):
        # Second factor: the app PIN, exchanged for a session at /auth/pin/login.
        return {"mfa_required": True, "mfa_token": mfa_token(user["id"])}
    # First sign-in: start a session; the app then requires setting a PIN before anything else.
    return await _finish_login(user, http)


class DeletionRequest(BaseModel):
    phone: str = Field(pattern=r"^[6-9]\d{9}$")
    otp: str = Field(pattern=r"^\d{6}$")
    pin: Optional[str] = Field(default=None, pattern=r"^\d{4,6}$")
    confirm: bool = False


@router.post("/privacy/deletion-request")
async def deletion_request(body: DeletionRequest, http: Request):
    """Delete an account without signing in (e.g. lost PIN, uninstalled app), proven by an OTP to the number."""
    if not body.confirm:
        raise HTTPException(status_code=400, detail="Confirm that you want your account deleted")
    await _check_otp(body.phone, body.otp, http)
    user = await db.users.find_one({"phone": body.phone})
    if user and user.get("pin"):
        # An OTP alone (e.g. after a SIM swap) mustn't be enough to erase an account for good.
        # Forgot the PIN? Reset it from sign-in (OTP, plus PAN once KYC is done), then delete.
        if not body.pin:
            raise HTTPException(status_code=428, detail="Enter your app PIN to confirm. Forgot it? Reset it from the sign-in screen first.")
        await check_pin(user, body.pin)
    await _consume_otp(body.phone)
    if not user:
        return {"deleted": False, "message": "There's no CoinQuest account for this number, so there's nothing to delete."}
    await audit.record("account_erasure_requested", user["id"], {"via": "public_request"}, http)
    result = await privacy.erase(user["id"])
    await audit.record("account_erased", user["id"], {"via": "public_request"}, http)
    return {
        "deleted": True,
        "message": "Your account and personal data have been deleted.",
        "retain_until": result["retain_until"],
    }


async def _finish_login(user: dict, http: Request) -> dict:
    token = await create_session(user["id"], http, needs_pin=not user.get("pin"))
    device = device_of(http)
    known = user.get("known_devices", [])
    if known and device["device_id"] not in known:
        await notify.send(
            user["id"], "security", "New sign-in",
            f"Your account was opened on {device['device_name']}. If this wasn't you, sign out other devices from Security and change your PIN.",
        )
    await db.users.update_one({"id": user["id"]}, {"$addToSet": {"known_devices": device["device_id"]}})
    await audit.record("login", user["id"], {"device_id": device["device_id"], "new_device": bool(known) and device["device_id"] not in known}, http)
    return {"message": "Login successful", "token": token, "pin_required": not user.get("pin"), "user": public_user(user)}


def public_user(user: dict) -> dict:
    return {
        "id": user["id"],
        "phone": user["phone"],
        "name": user.get("name"),
        "avatar": user.get("avatar", "hero"),
        "pin_set": bool(user.get("pin")),
        "kyc_status": user.get("kyc", {}).get("status", "none"),
    }


class PinLogin(BaseModel):
    mfa_token: str
    pin: str = Field(pattern=r"^\d{4,6}$")


class PinSet(BaseModel):
    pin: str
    current_pin: Optional[str] = None


class PinCheck(BaseModel):
    pin: str = Field(pattern=r"^\d{4,6}$")


@router.post("/auth/pin/login")
async def pin_login(body: PinLogin, http: Request):
    """Second sign-in step: OTP already verified, now the PIN."""
    user_id = user_from_mfa(body.mfa_token)
    await limit(f"pin-login:{user_id}", 10, 600)
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=401, detail="Please sign in again")
    try:
        await check_pin(user, body.pin)
    except HTTPException as e:
        await audit.record("login_pin_failed", user_id, {"status": e.status_code}, http)
        raise
    return await _finish_login(user, http)


@router.post("/auth/pin", dependencies=[Depends(require_user)])
async def set_pin(body: PinSet, http: Request):
    """Create the app PIN, or change it (current PIN required)."""
    user = await db.users.find_one({"id": current_user(http)})
    if user.get("pin"):
        if not body.current_pin:
            raise HTTPException(status_code=400, detail="Enter your current PIN")
        await check_pin(user, body.current_pin)
    problem = pin_problem(body.pin)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    changed = bool(user.get("pin"))
    await db.users.update_one({"id": user["id"]}, {"$set": {"pin": await hash_pin_async(body.pin), "pin_attempts": 0}, "$unset": {"pin_locked_until": ""}})
    await audit.record("pin_changed" if changed else "pin_set", user["id"], {}, http)
    if changed:
        await notify.send(user["id"], "security", "PIN changed", "Your CoinQuest PIN was changed. If this wasn't you, contact support now.")
    return {"pin_set": True}


class PinReset(BaseModel):
    mfa_token: str
    new_pin: str
    pan: Optional[str] = None  # required once KYC is complete


@router.post("/auth/pin/reset")
async def reset_pin(body: PinReset, http: Request):
    """Forgot PIN: OTP (via mfa_token) plus PAN for KYC'd users. Large payments pause for 24 hours afterwards."""
    user_id = user_from_mfa(body.mfa_token)
    await limit(f"pin-reset:{user_id}", 3, 3600)
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=401, detail="Please sign in again")
    if user.get("kyc", {}).get("status") == "verified":
        if not body.pan or crypto.blind_index(body.pan.strip().upper()) != user["kyc"].get("pan_hash"):
            await audit.record("pin_reset_failed", user_id, {"reason": "pan_mismatch"}, http)
            raise HTTPException(status_code=400, detail="That PAN doesn't match your KYC record")
    problem = pin_problem(body.new_pin)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"pin": await hash_pin_async(body.new_pin), "pin_attempts": 0, "pin_reset_at": datetime.utcnow()}, "$unset": {"pin_locked_until": ""}},
    )
    # A reset is a classic account-takeover step: end every other session and tell the user.
    await db.sessions.update_many({"user_id": user_id, "revoked": False}, {"$set": {"revoked": True, "revoked_reason": "pin_reset"}})
    await audit.record("pin_reset", user_id, {}, http)
    await notify.send(user_id, "security", "PIN reset", "Your PIN was reset and other devices were signed out. Payments of ₹2,000 or more are paused for 24 hours.")
    return await _finish_login(await db.users.find_one({"id": user_id}), http)


@router.post("/auth/pin/verify", dependencies=[Depends(require_user)])
async def verify_pin(body: PinCheck, http: Request):
    """Fresh PIN check before a sensitive action. Returns a 5-minute step-up token."""
    user = await db.users.find_one({"id": current_user(http)})
    await check_pin(user, body.pin)
    return {"step_up_token": step_up_token(user["id"], http.state.session_id), "expires_in": 300}


@router.get("/auth/sessions", dependencies=[Depends(require_user)])
async def list_sessions(http: Request):
    rows = await db.sessions.find({"user_id": current_user(http), "revoked": False}).sort("last_seen", -1).to_list(50)
    return [
        {
            "id": r["sid"],
            "device": r.get("device_name", "Unknown device"),
            "ip": r.get("ip"),
            "created_at": r["created_at"].isoformat(),
            "last_seen": r["last_seen"].isoformat(),
            "current": r["sid"] == http.state.session_id,
        }
        for r in rows
    ]


@router.delete("/auth/sessions/{sid}", dependencies=[Depends(require_user)])
async def end_session(sid: str, http: Request):
    res = await db.sessions.update_one({"sid": sid, "user_id": current_user(http)}, {"$set": {"revoked": True, "revoked_reason": "user"}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Session not found")
    await audit.record("session_revoked", current_user(http), {"sid": sid[:6]}, http)
    return {"revoked": True}


@router.post("/auth/sessions/revoke-others", dependencies=[Depends(require_user)])
async def end_other_sessions(http: Request):
    res = await db.sessions.update_many(
        {"user_id": current_user(http), "revoked": False, "sid": {"$ne": http.state.session_id}},
        {"$set": {"revoked": True, "revoked_reason": "user_revoked_others"}},
    )
    await audit.record("sessions_revoked_others", current_user(http), {"count": res.modified_count}, http)
    return {"revoked": res.modified_count}


@router.post("/auth/logout", dependencies=[Depends(require_user)])
async def logout(http: Request):
    """End the current session on the server."""
    await revoke_session(http.state.session_id, "logout")
    return {"message": "Logged out"}
