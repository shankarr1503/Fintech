"""Tamper-evident audit trail.

Every entry stores the SHA-256 of the previous entry, forming a hash chain:
editing or deleting any record breaks every hash after it, which
`verify_chain()` detects. The application only ever inserts into this
collection. In production, also mirror entries to write-once storage
(e.g. S3 Object Lock) so a database administrator can't rewrite history.

Entries hold the user id and non-sensitive context only: no OTPs, PINs,
full account numbers or PAN.
"""
import hashlib
import json
from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import Request
from pymongo.errors import DuplicateKeyError

from ..db import db

GENESIS = "0" * 64


def _digest(entry: Dict[str, Any]) -> str:
    body = {k: entry[k] for k in ("seq", "user_id", "action", "details", "ip", "device", "at", "prev_hash")}
    return hashlib.sha256(json.dumps(body, sort_keys=True, default=str).encode()).hexdigest()


def request_context(request: Optional[Request]) -> Dict[str, str]:
    if request is None:
        return {"ip": "system", "device": "system"}
    from ..ratelimit import client_ip

    return {"ip": client_ip(request), "device": request.headers.get("x-device-name") or request.headers.get("user-agent", "unknown")[:80]}


async def record(action: str, user_id: Optional[str], details: Optional[Dict[str, Any]] = None, request: Optional[Request] = None) -> Dict[str, Any]:
    """Append an entry to the chain. Retries if another writer took the same sequence number."""
    ctx = request_context(request)
    for _ in range(5):
        last = await db.audit_logs.find_one({}, sort=[("seq", -1)])
        entry = {
            "seq": (last["seq"] + 1) if last else 1,
            "user_id": user_id,
            "action": action,
            "details": details or {},
            "ip": ctx["ip"],
            "device": ctx["device"],
            "at": datetime.utcnow().isoformat(timespec="microseconds"),
            "prev_hash": last["hash"] if last else GENESIS,
        }
        entry["hash"] = _digest(entry)
        try:
            await db.audit_logs.insert_one(dict(entry))
            return entry
        except DuplicateKeyError:
            continue
    raise RuntimeError("Could not append to audit log")


async def verify_chain() -> Dict[str, Any]:
    """Recompute every hash. Returns the first broken sequence number, if any."""
    prev = GENESIS
    count = 0
    async for entry in db.audit_logs.find({}).sort("seq", 1):
        count += 1
        if entry["prev_hash"] != prev or _digest(entry) != entry["hash"]:
            return {"ok": False, "entries": count, "broken_at": entry["seq"]}
        prev = entry["hash"]
    return {"ok": True, "entries": count, "broken_at": None}


async def for_user(user_id: str, limit: int = 50):
    cursor = db.audit_logs.find({"user_id": user_id}).sort("seq", -1).limit(limit)
    return [
        {"action": e["action"], "details": e.get("details", {}), "timestamp": e["at"], "ip": e["ip"], "device": e["device"]}
        async for e in cursor
    ]
