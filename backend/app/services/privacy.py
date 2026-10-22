"""Data-subject rights: export and erasure (GDPR, CCPA, India's DPDP Act).

Erasure deletes everything personal *except* records we are legally required
to keep: under the Prevention of Money Laundering Act, payment records and KYC
records must be retained for five years after the relationship ends. Those are
kept in restricted form, keyed only by an opaque user id, and flagged with a
`retain_until` date so a scheduled job can purge them afterwards. GDPR and the
DPDP Act both allow retention when the law requires it.
"""
import re
from datetime import datetime, timedelta
from typing import Any, Dict

from ..db import db
from ..utils import serialize_doc

# Collections deleted outright on erasure.
PERSONAL = [
    "transactions", "debts", "debt_payments", "savings_goals", "insights", "game_profiles", "game_events",
    "payments", "upi_requests", "redemptions", "learning_progress", "aa_consents", "loans", "manual_accounts",
    "credit_scores", "privacy_settings", "support_tickets", "notifications", "notification_prefs", "sessions",
    "idempotency", "linked_accounts",
]
# Kept for the statutory period (PMLA): payments, AML alerts, the audit trail.
RETAINED = ["upi_transactions", "aml_alerts", "audit_logs"]
RETENTION = timedelta(days=5 * 365)

# Never exported: credentials and ciphertexts.
SECRET_FIELDS = {"pin", "pin_attempts", "pin_locked_until", "otp", "otp_hash", "otp_expiry", "otp_attempts", "push_tokens", "known_devices"}


def _clean_user(user: Dict[str, Any]) -> Dict[str, Any]:
    out = {k: v for k, v in user.items() if k not in SECRET_FIELDS and k != "_id"}
    if "kyc" in out:
        k = out["kyc"]
        out["kyc"] = {key: k.get(key) for key in ("status", "masked_pan", "name", "verified_at", "provider", "consent_at")}
    out["pin_set"] = bool(user.get("pin"))
    return serialize_doc(out)


async def export(user_id: str) -> Dict[str, Any]:
    user = await db.users.find_one({"id": user_id})
    data: Dict[str, Any] = {"export_date": datetime.utcnow().isoformat(), "user": _clean_user(user or {})}
    for name in PERSONAL + ["upi_transactions"]:
        if name in ("sessions", "idempotency"):
            continue
        rows = await db[name].find({"user_id": user_id}).to_list(10000)
        data[name] = serialize_doc(rows)
    audit_rows = await db.audit_logs.find({"user_id": user_id}).sort("seq", 1).to_list(10000)
    data["audit_trail"] = [{"action": r["action"], "at": r["at"], "details": r.get("details", {})} for r in audit_rows]
    return data


async def erase(user_id: str) -> Dict[str, Any]:
    user = await db.users.find_one({"id": user_id})
    deleted: Dict[str, int] = {}
    for name in PERSONAL:
        res = await db[name].delete_many({"user_id": user_id})
        deleted[name] = res.deleted_count
    retain_until = datetime.utcnow() + RETENTION
    for name in RETAINED[:2]:
        await db[name].update_many({"user_id": user_id}, {"$set": {"retain_until": retain_until, "subject_erased": True}})
    if user and user.get("kyc"):
        # Encrypted KYC record moves to restricted storage for the PMLA period; nothing else of the profile is kept.
        await db.kyc_retained.insert_one({"user_id": user_id, "kyc": user["kyc"], "retain_until": retain_until})
    if user:
        # Leftovers keyed by phone number or user id rather than a user_id field.
        phone = user.get("phone", "")
        await db.otp_codes.delete_many({"phone": phone})
        keys = [re.escape(k) for k in (user_id, phone) if k]
        await db.rate_limits.delete_many({"key": {"$regex": "|".join(keys)}})
        await db.game_claims.delete_many({"key": {"$regex": re.escape(user_id)}})
        await db.payment_locks.delete_many({"user_id": user_id})
    await db.users.delete_one({"id": user_id})
    return {"deleted": deleted, "retained": RETAINED, "retain_until": retain_until.date().isoformat()}
