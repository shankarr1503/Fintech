import logging
import random
import uuid
from datetime import datetime, timedelta

from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request, Response
from pydantic import BaseModel, Field

from ..auth import current_user, use_step_up

from ..config import settings
from ..db import db
from ..ratelimit import limit
from ..services import aml, audit, kyc, notify, payments, pci
from ..utils import serialize_doc

router = APIRouter()
logger = logging.getLogger(__name__)

# Payments at or above this need a fresh PIN entry (step-up authentication).
STEP_UP_AMOUNT = 2000


@router.get("/upi/linked-accounts/{user_id}")
async def get_upi_linked_accounts(user_id: str):
    """Get user's UPI linked bank accounts (demo balances, stable per user)"""
    rng = random.Random(user_id)
    if not settings.demo_mode:
        return {"upi_id": None, "linked_accounts": [], "daily_limit": 100000, "used_today": 0}
    return {
        "sample": True,
        "upi_id": f"user{user_id[:4]}@coinquest",
        "linked_accounts": [
            {
                "id": "upi_1",
                "bank": "Sample Bank",
                "account_number": "XXXX1234",
                "ifsc": "SMPL0001234",
                "is_primary": True,
                "balance": rng.randint(10000, 500000),
                "upi_handle": "@sample"
            },
            {
                "id": "upi_2", 
                "bank": "Sample Bank",
                "account_number": "XXXX5678",
                "ifsc": "SMPL0005678",
                "is_primary": False,
                "balance": rng.randint(5000, 200000),
                "upi_handle": "@sample"
            },
            {
                "id": "upi_3",
                "bank": "Sample Bank",
                "account_number": "XXXX9012",
                "ifsc": "SMPL0009012",
                "is_primary": False,
                "balance": rng.randint(20000, 300000),
                "upi_handle": "@sample"
            }
        ],
        "daily_limit": 100000,
        "used_today": rng.randint(0, 30000)
    }

@router.get("/upi/recent-payees/{user_id}")
async def get_recent_payees(user_id: str):
    """Recent payees (sample ones in demo mode)"""
    if not settings.demo_mode:
        return []
    return [
        {"id": "p1", "name": "Rahul Sharma", "upi_id": "rahul@paytm", "avatar": "R", "last_paid": "₹500", "frequency": "frequent"},
        {"id": "p2", "name": "Swiggy", "upi_id": "swiggy@ybl", "avatar": "S", "last_paid": "₹350", "frequency": "frequent"},
        {"id": "p3", "name": "Amazon Pay", "upi_id": "amazon@apl", "avatar": "A", "last_paid": "₹1,299", "frequency": "weekly"},
        {"id": "p4", "name": "Priya Kumar", "upi_id": "priya@okaxis", "avatar": "P", "last_paid": "₹2,000", "frequency": "monthly"},
        {"id": "p5", "name": "Electricity Board", "upi_id": "mseb@upi", "avatar": "E", "last_paid": "₹2,450", "frequency": "monthly"},
        {"id": "p6", "name": "Netflix", "upi_id": "netflix@icici", "avatar": "N", "last_paid": "₹649", "frequency": "monthly"},
    ]

class SendMoney(BaseModel):
    user_id: str
    recipient_upi: str = Field(pattern=r"^[\w.\-]{2,64}@[a-zA-Z]{2,32}$")
    amount: float = Field(gt=0, le=100000)
    note: str = Field(default="", max_length=50)
    source_account: Optional[str] = None
    confirm_duplicate: bool = False


@router.post("/upi/send-money")
async def send_money_upi(body: SendMoney, request: Request, response: Response, idempotency_key: Optional[str] = Header(default=None)):
    """Send money over UPI. Idempotent with an Idempotency-Key header; see services/payments.py for states."""
    uid = current_user(request)
    await limit(f"payments:{uid}", 10, 60)
    amount = round(body.amount, 2)
    recipient = body.recipient_upi.lower()
    note = pci.mask_card_numbers(body.note)

    replay = await payments.idempotency_begin(uid, idempotency_key, payments.body_hash(body.model_dump()))
    if replay is not None:
        response.headers["Idempotent-Replayed"] = "true"
        return replay
    try:
        async with payments.user_lock(uid):
            result = await _send(uid, amount, recipient, note, body, request, idempotency_key)
    except HTTPException:
        await payments.idempotency_abort(uid, idempotency_key)
        raise
    except Exception:
        # Not a refusal: something broke mid-payment. Don't leave the key "processing" for 24h.
        await payments.idempotency_crashed(uid, idempotency_key)
        raise
    await payments.idempotency_finish(uid, idempotency_key, result)
    if result["status"] in ("pending", "on_hold"):
        response.status_code = 202
    return result


async def _send(uid: str, amount: float, recipient: str, note: str, body: "SendMoney", request: Request, idempotency_key: Optional[str]) -> dict:
    user = await db.users.find_one({"id": uid})
    if recipient == f"user{uid[:4]}@coinquest":
        raise HTTPException(status_code=400, detail="You can't pay yourself. Use self transfer between your accounts.")

    problem = await kyc.check_limits(user, amount)
    if problem:
        raise HTTPException(status_code=403, detail=problem)

    if not body.confirm_duplicate:
        dup = await db.upi_transactions.find_one({
            "user_id": uid, "recipient": recipient, "amount": amount, "status": {"$in": ["success", "pending"]},
            "timestamp": {"$gte": datetime.utcnow() - payments.DUPLICATE_WINDOW},
        })
        if dup:
            raise HTTPException(status_code=409, detail=f"You paid ₹{amount:,.0f} to {recipient} a moment ago. Pay again anyway?")

    if amount >= STEP_UP_AMOUNT:
        reset_at = user.get("pin_reset_at")
        if reset_at and datetime.utcnow() - reset_at < timedelta(hours=24):
            raise HTTPException(status_code=403, detail="For your safety, payments of ₹2,000 or more are paused for 24 hours after a PIN reset.")
        await use_step_up(request)

    txn_id = payments.new_txn_id()
    now = datetime.utcnow()
    txn = {
        "id": txn_id, "user_id": uid, "type": "upi_send", "amount": amount, "recipient": recipient, "note": note,
        "source_account": body.source_account, "status": "pending", "coins_earned": 0, "timestamp": now, "updated_at": now,
    }

    check = await aml.evaluate(user, amount, recipient)
    if check["outcome"] != "allow":
        txn["aml_alert"] = await aml.raise_alert(uid, txn_id, amount, recipient, check)
    if check["outcome"] == "hold":
        txn.update(status="on_hold", reason="Held for a routine security check. We'll update you within 24 hours; no money has moved.")
        await db.upi_transactions.insert_one(dict(txn))
        await payments.idempotency_attach(uid, idempotency_key, txn_id)
        await audit.record("payment_on_hold", uid, {"txn_id": txn_id, "amount": amount, "rules": [h["rule"] for h in check["hits"]]}, request)
        await notify.send(uid, "security", "Payment held for review", f"₹{amount:,.0f} to {recipient} is on hold for a routine check. No money has moved.", {"txn_id": txn_id})
        return {**payments.public(txn), "reward": {}}

    if payments.breaker.open:
        raise HTTPException(status_code=503, detail=payments.UNAVAILABLE)
    await db.upi_transactions.insert_one(dict(txn))
    await payments.idempotency_attach(uid, idempotency_key, txn_id)
    await audit.record("payment_initiated", uid, {"txn_id": txn_id, "amount": amount, "aml": check["outcome"]}, request)

    try:
        answer = await payments.rail.pay(txn)
        payments.breaker.success()
    except payments.RailUnavailable:
        payments.breaker.failure()
        await payments.settle(txn_id, "failed", "UPI was unavailable at the bank. You haven't been charged.", source="rail_unavailable")
        raise HTTPException(status_code=503, detail=payments.UNAVAILABLE)
    except payments.RailTimeout:
        payments.breaker.failure()
        # Money may or may not have moved: keep it pending and let the webhook / reconciliation decide.
        await db.upi_transactions.update_one({"id": txn_id}, {"$set": {"reason": "Waiting for the bank to confirm"}})
        return {**payments.public({**txn, "reason": "Waiting for the bank to confirm"}), "reward": {}}

    await db.upi_transactions.update_one({"id": txn_id}, {"$set": {"rail_ref": answer["rail_ref"]}})
    txn["rail_ref"] = answer["rail_ref"]
    if answer["status"] == "pending":
        await notify.send(uid, "debit", "Payment pending", f"₹{amount:,.0f} to {recipient} is waiting for the bank to confirm.", {"txn_id": txn_id})
        return {**payments.public({**txn, "reason": "Waiting for the bank to confirm"}), "reward": {}}
    settled = await payments.settle(txn_id, answer["status"], answer.get("reason", ""))
    return settled


@router.get("/upi/transactions/{txn_id}")
async def payment_status(txn_id: str, request: Request):
    """Current state of one payment. Stuck pending payments are reconciled with the rail on read."""
    uid = current_user(request)
    txn = await db.upi_transactions.find_one({"id": txn_id, "user_id": uid})
    if not txn:
        raise HTTPException(status_code=404, detail="Payment not found")
    if txn["status"] == "pending" and datetime.utcnow() - txn["timestamp"] >= payments.RECONCILE_AFTER:
        await payments.reconcile_stale(uid)
        txn = await db.upi_transactions.find_one({"id": txn_id})
    return payments.public(txn)


@router.get("/upi/idempotency/{key}")
async def payment_by_key(key: str, request: Request):
    """After a network timeout the app asks here instead of paying again."""
    row = await db.idempotency.find_one({"user_id": current_user(request), "key": key})
    if not row:
        raise HTTPException(status_code=404, detail="No payment was received with this key")
    if row["state"] == "processing":
        return {"status": "processing"}
    return row["response"]


@router.post("/upi/request-money")
async def request_money_upi(data: dict):
    """Request money via UPI"""
    user_id = data.get("user_id")
    from_upi = data.get("from_upi")
    amount = data.get("amount", 0)
    note = data.get("note", "")
    await limit(f"payment-requests:{user_id}", 10, 60)

    request_id = f"REQ{uuid.uuid4().hex[:10].upper()}"
    await db.upi_requests.insert_one({
        "id": request_id, "user_id": user_id, "from_upi": from_upi, "amount": amount,
        "note": note, "status": "pending", "timestamp": datetime.utcnow(),
    })

    return {
        "status": "pending",
        "request_id": request_id,
        "amount": amount,
        "from_upi": from_upi,
        "message": "Payment request sent!"
    }

@router.get("/upi/transaction-history/{user_id}")
async def get_upi_history(user_id: str):
    """Get UPI transaction history"""
    transactions = await db.upi_transactions.find({"user_id": user_id}).sort("timestamp", -1).to_list(50)
    
    if not transactions and settings.demo_mode:
        # Sample transactions
        transactions = [
            {"id": "UPI001", "type": "sent", "amount": 500, "to": "rahul@paytm", "timestamp": datetime.utcnow() - timedelta(hours=2), "status": "success"},
            {"id": "UPI002", "type": "received", "amount": 1000, "from": "priya@okaxis", "timestamp": datetime.utcnow() - timedelta(hours=5), "status": "success"},
            {"id": "UPI003", "type": "sent", "amount": 350, "to": "swiggy@ybl", "timestamp": datetime.utcnow() - timedelta(days=1), "status": "success"},
            {"id": "UPI004", "type": "sent", "amount": 2450, "to": "mseb@upi", "timestamp": datetime.utcnow() - timedelta(days=2), "status": "success"},
        ]
    
    return serialize_doc(transactions)
