"""KYC tiers and the identity-verification provider adapter.

Tiers follow the spirit of RBI's minimum-KYC rules: unverified users get small
limits; full KYC (PAN verified against the name, plus Aadhaar e-KYC consent)
unlocks normal UPI limits.

`SandboxKycProvider` stands in for a real provider (e.g. a PAN verification /
DigiLocker / Aadhaar e-KYC API). Swap it via `get_provider()` in production.
"""
import re
import uuid
from datetime import date, datetime
from typing import Dict, Optional

from ..db import db
from ..utils import ist_day_start_utc, ist_month_start_utc

PAN_RE = re.compile(r"^[A-Z]{3}P[A-Z]\d{4}[A-Z]$")  # 4th letter P = individual

TIERS: Dict[str, Dict[str, int]] = {
    # per transaction, per day, per calendar month (₹)
    "none": {"per_txn": 5_000, "per_day": 10_000, "per_month": 10_000},
    "verified": {"per_txn": 100_000, "per_day": 100_000, "per_month": 1_000_000},
}

# Sandbox name-screening list (stand-in for a sanctions/PEP database).
SCREENING_LIST = {"SANCTIONED PERSON", "TEST PEP"}


def mask_pan(pan: str) -> str:
    return "XXXXX" + pan[5:9] + pan[9]


def age_on(dob: date, today: Optional[date] = None) -> int:
    today = today or date.today()
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


class SandboxKycProvider:
    """Deterministic test behaviour, like a payment sandbox's magic values:
    - PAN ending in 'X' -> name doesn't match PAN records
    - names on SCREENING_LIST -> sent to manual review
    - everything else -> verified
    """

    name = "sandbox"

    async def verify(self, pan: str, full_name: str, dob: date) -> Dict[str, str]:
        ref = f"KYC{uuid.uuid4().hex[:10].upper()}"
        if pan.endswith("X"):
            return {"status": "failed", "reason": "Name doesn't match PAN records", "ref": ref}
        if full_name.upper() in SCREENING_LIST:
            return {"status": "review", "reason": "Needs a manual check by our compliance team", "ref": ref}
        return {"status": "verified", "reason": "", "ref": ref}


def get_provider():
    return SandboxKycProvider()


def tier_of(user: dict) -> str:
    return "verified" if user.get("kyc", {}).get("status") == "verified" else "none"


async def spent_since(user_id: str, since: datetime) -> float:
    """Money already committed (completed, pending or held) since `since`."""
    total = 0.0
    async for t in db.upi_transactions.find({
        "user_id": user_id,
        "timestamp": {"$gte": since},
        "status": {"$in": ["success", "pending", "on_hold"]},
    }):
        total += t.get("amount", 0)
    return total


async def usage(user: dict) -> Dict[str, float]:
    # Limits reset at midnight in India, not at 05:30 (UTC midnight).
    day, month = ist_day_start_utc(), ist_month_start_utc()
    return {"today": await spent_since(user["id"], day), "this_month": await spent_since(user["id"], month)}


async def check_limits(user: dict, amount: float) -> Optional[str]:
    """Return a user-facing reason if this payment exceeds the user's KYC tier limits."""
    tier = tier_of(user)
    limits = TIERS[tier]
    used = await usage(user)
    hint = " Complete KYC to raise your limits." if tier == "none" else ""
    if amount > limits["per_txn"]:
        return f"₹{limits['per_txn']:,} is the most you can send in one payment.{hint}"
    if used["today"] + amount > limits["per_day"]:
        return f"This would take you over your ₹{limits['per_day']:,} daily limit.{hint}"
    if used["this_month"] + amount > limits["per_month"]:
        return f"This would take you over your ₹{limits['per_month']:,} monthly limit.{hint}"
    return None
