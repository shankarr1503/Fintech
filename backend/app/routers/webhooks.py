"""Inbound webhooks from the payment provider.

Security and reliability rules for every event:
- HMAC-SHA256 signature over "<timestamp>.<raw body>" with WEBHOOK_SECRET
- timestamp must be within 5 minutes (stops replays of captured requests)
- each event_id is processed at most once (providers retry deliveries)
- late or out-of-order events can't undo a final state (see payments.settle)
"""
import hashlib
import hmac
import json
import math
import time
import uuid
from datetime import datetime

from fastapi import APIRouter, Header, HTTPException, Request
from pymongo.errors import DuplicateKeyError

from ..config import settings
from ..db import db
from ..services import audit, notify, payments

router = APIRouter(prefix="/webhooks", tags=["webhooks"])
TOLERANCE_SECONDS = 300


def sign(timestamp: str, raw: bytes) -> str:
    return hmac.new(settings.webhook_secret.encode(), timestamp.encode() + b"." + raw, hashlib.sha256).hexdigest()


@router.post("/upi")
async def upi_webhook(request: Request, x_signature: str = Header(default=""), x_timestamp: str = Header(default="")):
    if not settings.webhook_secret:
        raise HTTPException(status_code=404, detail="Not found")
    raw = await request.body()
    try:
        ts = int(x_timestamp)
    except ValueError:
        raise HTTPException(status_code=400, detail="Missing timestamp")
    if abs(time.time() - ts) > TOLERANCE_SECONDS:
        raise HTTPException(status_code=400, detail="Stale webhook")
    if not hmac.compare_digest(sign(x_timestamp, raw), x_signature):
        raise HTTPException(status_code=401, detail="Bad signature")

    try:
        event = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="Body is not JSON")
    event_id = event.get("event_id")
    if not event_id:
        raise HTTPException(status_code=400, detail="Missing event_id")
    if await db.webhook_events.find_one({"event_id": event_id}):
        return {"received": True, "duplicate": True}

    # Handle first, then remember the event: if handling fails, the provider's retry must be
    # processed again rather than answered "duplicate". Both handlers are safe to repeat
    # (settle only moves a pending payment once; receipts are deduplicated on rail_ref).
    result = await _handle(event)
    try:
        await db.webhook_events.insert_one({"event_id": event_id, "type": event.get("type"), "received_at": datetime.utcnow()})
    except DuplicateKeyError:
        pass  # a concurrent retry finished first
    return result


async def _find_payment(event: dict) -> dict | None:
    rail_ref, txn_id = event.get("rail_ref"), event.get("txn_id")
    if not rail_ref and not txn_id:
        raise HTTPException(status_code=400, detail="Missing rail_ref or txn_id")
    # Never query on a missing value: {"rail_ref": None} matches every payment without one.
    if rail_ref:
        txn = await db.upi_transactions.find_one({"rail_ref": rail_ref, "type": "upi_send"})
        if txn:
            return txn
    if txn_id:
        txn = await db.upi_transactions.find_one({"id": txn_id, "type": "upi_send"})
        # A txn_id can only confirm a payment the rail hasn't given a different reference to.
        if txn and (not rail_ref or txn.get("rail_ref") in (None, rail_ref)):
            return txn
    return None


async def _handle(event: dict) -> dict:
    kind = event.get("type")
    if kind == "payment.updated":
        status = event.get("status")
        if status not in ("success", "failed"):
            raise HTTPException(status_code=400, detail="Unknown status")
        txn = await _find_payment(event)
        if not txn:
            return {"received": True, "ignored": "unknown payment"}
        result = await payments.settle(txn["id"], status, event.get("reason", ""), source="webhook")
        return {"received": True, "applied": result is not None}

    if kind == "payment.received":
        # Money coming in to the user's UPI ID.
        user_id, rail_ref = event.get("user_id"), event.get("rail_ref")
        try:
            amount = round(float(event.get("amount", 0)), 2)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Bad amount")
        if not rail_ref:
            raise HTTPException(status_code=400, detail="Missing rail_ref")
        if not math.isfinite(amount) or amount <= 0:
            raise HTTPException(status_code=400, detail="Bad amount")
        if not await db.users.find_one({"id": user_id}):
            return {"received": True, "ignored": "unknown user"}
        if await db.upi_transactions.find_one({"rail_ref": rail_ref, "type": "upi_receive"}):
            return {"received": True, "duplicate": True}
        now = datetime.utcnow()
        await db.upi_transactions.insert_one({
            "id": f"UPI{uuid.uuid4().hex[:12].upper()}", "user_id": user_id, "type": "upi_receive", "amount": amount,
            "recipient": None, "from": event.get("from", "UPI"), "status": "success", "rail_ref": rail_ref,
            "timestamp": now, "updated_at": now,
        })
        await notify.send(user_id, "credit", f"₹{amount:,.0f} received", f"From {event.get('from', 'a UPI user')}.")
        await audit.record("payment_received", user_id, {"amount": amount, "rail_ref": rail_ref})
        return {"received": True}

    return {"received": True, "ignored": f"unhandled type {kind}"}
