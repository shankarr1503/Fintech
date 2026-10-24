"""Payment orchestration: limits, AML, the payment rail, idempotency and settlement.

Transaction states:
    on_hold  -> stopped by AML rules, waiting for compliance review (never sent)
    pending  -> sent to the rail, waiting for the bank's final answer
    success  -> money moved (terminal)
    failed   -> money did not move (terminal)

A payment reaches a terminal state exactly once (an atomic pending -> final
update), so a webhook arriving twice, late, or out of order can't pay coins or
send alerts twice.

`SandboxUpiRail` stands in for a UPI PSP/bank partner (e.g. via a payment
aggregator's UPI API). It has magic payee IDs for testing, like card sandboxes:
    fail@coinquest     -> declined by the payee's bank
    pending@coinquest  -> stays pending until a webhook or reconciliation
    timeout@coinquest  -> the rail times out (we mark pending, then reconcile)
    outage@coinquest   -> the rail is down (counts towards the circuit breaker)
"""
import asyncio
import hashlib
import json
import logging
import random
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Any, AsyncIterator, Dict, Optional

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

from ..db import db
from . import audit, game, notify

logger = logging.getLogger(__name__)

RECONCILE_AFTER = timedelta(minutes=2)
DUPLICATE_WINDOW = timedelta(seconds=90)


class RailTimeout(Exception):
    pass


class RailUnavailable(Exception):
    pass


class SandboxUpiRail:
    name = "sandbox-upi"

    async def pay(self, txn: Dict[str, Any]) -> Dict[str, str]:
        payee = txn["recipient"].lower()
        rrn = str(random.randint(10**11, 10**12 - 1))  # UPI retrieval reference number
        if payee == "outage@coinquest":
            raise RailUnavailable("PSP unavailable")
        if payee == "timeout@coinquest":
            raise RailTimeout("No response from PSP")
        if payee == "fail@coinquest":
            return {"status": "failed", "rail_ref": rrn, "reason": "The payee's bank declined this payment"}
        if payee == "pending@coinquest":
            return {"status": "pending", "rail_ref": rrn, "reason": ""}
        return {"status": "success", "rail_ref": rrn, "reason": ""}

    async def status(self, txn: Dict[str, Any]) -> Dict[str, str]:
        """Status enquiry used by reconciliation. The sandbox settles stuck payments as successful."""
        return {"status": "success", "reason": ""}


class CircuitBreaker:
    """Stop calling a failing rail for a while instead of piling up timeouts.

    Per API instance, which is the usual design: each instance learns about an
    outage from its own failures.
    """

    def __init__(self, threshold: int = 3, cooldown: float = 30.0):
        self.threshold, self.cooldown = threshold, cooldown
        self.failures, self.opened_at = 0, 0.0

    @property
    def open(self) -> bool:
        if self.failures < self.threshold:
            return False
        if time.monotonic() - self.opened_at > self.cooldown:
            self.failures = self.threshold - 1  # half-open: let one request through
            return False
        return True

    def success(self):
        self.failures = 0

    def failure(self):
        self.failures += 1
        if self.failures >= self.threshold:
            self.opened_at = time.monotonic()


rail = SandboxUpiRail()
breaker = CircuitBreaker()

UNAVAILABLE = "UPI is temporarily unavailable at the bank. You haven't been charged. Please try again in a minute."


# ---------------------------------------------------------------- per-user payment lock

LOCK_TTL = timedelta(seconds=60)  # longer than any rail call; a crashed worker's lock expires
LOCK_WAIT_SECONDS = 5.0


@asynccontextmanager
async def user_lock(user_id: str) -> AsyncIterator[None]:
    """Run one payment at a time per user.

    Limit, duplicate and AML checks read the user's earlier payments; without this, parallel
    requests all see the same history and together pass limits none of them could alone."""
    token = uuid.uuid4().hex
    deadline = time.monotonic() + LOCK_WAIT_SECONDS
    while True:
        now = datetime.utcnow()
        try:
            await db.payment_locks.insert_one({"user_id": user_id, "token": token, "expires_at": now + LOCK_TTL})
            break
        except DuplicateKeyError:
            # Take over a lock whose holder died (the TTL monitor only sweeps once a minute).
            await db.payment_locks.delete_one({"user_id": user_id, "expires_at": {"$lt": now}})
            if time.monotonic() > deadline:
                raise HTTPException(status_code=409, detail="Another payment is still being processed. Please wait a moment.")
            await asyncio.sleep(0.1)
    try:
        yield
    finally:
        await db.payment_locks.delete_one({"user_id": user_id, "token": token})


# ---------------------------------------------------------------- idempotency

def body_hash(body: Dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(body, sort_keys=True, default=str).encode()).hexdigest()


async def idempotency_begin(user_id: str, key: Optional[str], fingerprint: str) -> Optional[Dict[str, Any]]:
    """Reserve `key`. Returns the stored response if this request was already completed."""
    if not key:
        return None
    if not 8 <= len(key) <= 64:
        raise HTTPException(status_code=400, detail="Idempotency-Key must be 8-64 characters")
    try:
        await db.idempotency.insert_one({
            "user_id": user_id, "key": key, "fingerprint": fingerprint, "state": "processing",
            "created_at": datetime.utcnow(), "expires_at": datetime.utcnow() + timedelta(hours=24),
        })
        return None
    except DuplicateKeyError:
        prior = await db.idempotency.find_one({"user_id": user_id, "key": key})
        if prior["fingerprint"] != fingerprint:
            raise HTTPException(status_code=409, detail="This Idempotency-Key was already used for a different payment")
        if prior["state"] == "processing":
            raise HTTPException(status_code=409, detail="This payment is still being processed")
        return {**prior["response"], "replayed": True}


async def idempotency_finish(user_id: str, key: Optional[str], response: Dict[str, Any]):
    if key:
        await db.idempotency.update_one({"user_id": user_id, "key": key}, {"$set": {"state": "done", "response": response}})


async def idempotency_attach(user_id: str, key: Optional[str], txn_id: str):
    """Link the key to the payment it created, so an unexpected error can't orphan it."""
    if key:
        await db.idempotency.update_one({"user_id": user_id, "key": key}, {"$set": {"txn_id": txn_id}})


async def idempotency_crashed(user_id: str, key: Optional[str]):
    """After an unexpected error: answer retries with the payment if one was created, else free the key."""
    if not key:
        return
    prior = await db.idempotency.find_one({"user_id": user_id, "key": key, "state": "processing"})
    if not prior:
        return
    txn = await db.upi_transactions.find_one({"id": prior["txn_id"]}) if prior.get("txn_id") else None
    if txn:
        await idempotency_finish(user_id, key, {**public(txn), "reward": {}})
    else:
        await idempotency_abort(user_id, key)


async def idempotency_abort(user_id: str, key: Optional[str]):
    """Release the key so the client can retry, e.g. after the rail was down."""
    if key:
        await db.idempotency.delete_one({"user_id": user_id, "key": key, "state": "processing"})


# ---------------------------------------------------------------- settlement

def public(txn: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "transaction_id": txn["id"],
        "status": txn["status"],
        "amount": txn["amount"],
        "recipient": txn["recipient"],
        "note": txn.get("note", ""),
        "rail_ref": txn.get("rail_ref"),
        "reason": txn.get("reason"),
        "coins_earned": txn.get("coins_earned", 0),
        "created_at": txn["timestamp"].isoformat() if isinstance(txn.get("timestamp"), datetime) else txn.get("timestamp"),
        "updated_at": txn["updated_at"].isoformat() if isinstance(txn.get("updated_at"), datetime) else txn.get("updated_at"),
    }


async def settle(txn_id: str, status: str, reason: str = "", source: str = "rail") -> Optional[Dict[str, Any]]:
    """Move a pending payment to success/failed exactly once and apply side effects. Returns None if already final."""
    assert status in ("success", "failed")
    now = datetime.utcnow()
    txn = await db.upi_transactions.find_one_and_update(
        {"id": txn_id, "status": "pending"},
        {"$set": {"status": status, "reason": reason or None, "updated_at": now, "settled_by": source}},
        return_document=True,
    )
    if not txn:
        return None
    reward: Dict[str, Any] = {}
    if status == "success":
        coins = int(txn["amount"] / 50)
        await db.upi_transactions.update_one({"id": txn_id}, {"$set": {"coins_earned": coins}})
        await db.users.update_one({"id": txn["user_id"]}, {"$inc": {"reward_coins": coins}})
        txn["coins_earned"] = coins
        reward = await game.award(txn["user_id"], "payment_sent")
        await notify.send(txn["user_id"], "debit", f"₹{txn['amount']:,.0f} paid", f"To {txn['recipient']}. UPI ref {txn.get('rail_ref')}.", {"txn_id": txn_id})
    else:
        await notify.send(
            txn["user_id"], "debit", "Payment failed",
            f"₹{txn['amount']:,.0f} to {txn['recipient']} didn't go through: {reason}. If money left your account, your bank reverses it by the next working day.",
            {"txn_id": txn_id},
        )
    await audit.record(f"payment_{status}", txn["user_id"], {"txn_id": txn_id, "amount": txn["amount"], "source": source, "reason": reason})
    return {**public(txn), "reward": reward}


async def reconcile_stale(user_id: Optional[str] = None) -> int:
    """Ask the rail about payments stuck in pending (e.g. a webhook never arrived)."""
    query: Dict[str, Any] = {"status": "pending", "timestamp": {"$lte": datetime.utcnow() - RECONCILE_AFTER}}
    if user_id:
        query["user_id"] = user_id
    settled = 0
    async for txn in db.upi_transactions.find(query):
        try:
            answer = await rail.status(txn)
        except (RailTimeout, RailUnavailable):
            continue
        if answer["status"] in ("success", "failed") and await settle(txn["id"], answer["status"], answer.get("reason", ""), source="reconcile"):
            settled += 1
    return settled


def new_txn_id() -> str:
    return f"UPI{uuid.uuid4().hex[:12].upper()}"
