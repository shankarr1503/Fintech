import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request

from ..db import db
from .auth import public_user
from ..models import DeleteAccountRequest, LanguageUpdate, SecuritySettings, SupportRequest, UserUpdate
from ..services import audit, game, pci, privacy
from ..utils import serialize_doc

router = APIRouter()
logger = logging.getLogger(__name__)

# Profile fields safe to send back. Never the PIN record, attempt counters, devices or encrypted KYC data.
PROFILE_FIELDS = ("level", "xp", "reward_coins", "streak", "last_checkin", "language", "created_at")


def profile(user: dict) -> dict:
    return serialize_doc({**public_user(user), **{k: user[k] for k in PROFILE_FIELDS if k in user}})

@router.get("/users/{user_id}")
async def get_user(user_id: str):
    """Get user profile"""
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return profile(user)

@router.put("/users/{user_id}")
async def update_user(user_id: str, user_data: UserUpdate):
    """Update user profile"""
    update_data = {k: v for k, v in user_data.model_dump().items() if v is not None}

    if update_data:
        await db.users.update_one({"id": user_id}, {"$set": update_data})
        await game.award(user_id, "profile_updated")
    
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    return {
        "message": "Profile updated successfully",
        "user": profile(user)
    }

@router.delete("/users/{user_id}")
async def delete_user_account(user_id: str, body: DeleteAccountRequest, request: Request):
    """Erase the account. Payment, KYC and audit records are kept only as the law requires (see services/privacy.py)."""
    await audit.record("account_erasure_requested", user_id, {"reason": (body.reason or "")[:100]}, request)
    result = await privacy.erase(user_id)
    await audit.record("account_erased", user_id, {"retain_until": result["retain_until"]}, request)
    return {"message": "Account deleted", **result}


@router.post("/support")
async def submit_support_request(request: SupportRequest):
    """Submit a support request"""
    support_ticket = {
        "id": str(uuid.uuid4()),
        "user_id": request.user_id,
        "subject": pci.mask_card_numbers(request.subject),
        "message": pci.mask_card_numbers(request.message),
        "status": "open",
        "created_at": datetime.utcnow()
    }
    await db.support_tickets.insert_one(dict(support_ticket))
    
    return {"message": "Support request submitted", "ticket_id": support_ticket['id']}


@router.post("/users/{user_id}/language")
async def update_language(user_id: str, data: LanguageUpdate):
    """Update user's preferred language"""
    await db.users.update_one({"id": user_id}, {"$set": {"language": data.language}})
    return {"message": "Language updated successfully", "language": data.language}

@router.get("/users/{user_id}/security")
async def get_security_settings(user_id: str):
    """Get user's security settings"""
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    return {
        "biometric_enabled": user.get('biometric_enabled', False),
        "transaction_alerts": user.get('transaction_alerts', True),
        "login_notifications": user.get('login_notifications', True)
    }

@router.post("/users/{user_id}/security")
async def update_security_settings(user_id: str, settings: SecuritySettings):
    """Update user's security settings"""
    await db.users.update_one(
        {"id": user_id},
        {"$set": {
            "biometric_enabled": settings.biometric_enabled,
            "transaction_alerts": settings.transaction_alerts,
            "login_notifications": settings.login_notifications
        }}
    )
    return {"message": "Security settings updated"}

@router.get("/users/{user_id}/linked-accounts")
async def get_linked_accounts(user_id: str):
    """Get user's linked bank accounts (mock)"""
    # In production, this would fetch from Account Aggregator
    accounts = await db.linked_accounts.find({"user_id": user_id}).to_list(10)
    if not accounts:
        # Return demo accounts
        return [
            {
                "id": "acc_001",
                "bank_name": "HDFC Bank",
                "account_type": "Savings",
                "last_four": "4521",
                "linked_date": datetime.utcnow().isoformat(),
                "status": "active"
            }
        ]
    return serialize_doc(accounts)

@router.get("/users/{user_id}/export")
async def export_user_data(user_id: str, request: Request):
    """Everything we hold about the user, in machine-readable form (data portability)."""
    await audit.record("data_exported", user_id, {}, request)
    return await privacy.export(user_id)
