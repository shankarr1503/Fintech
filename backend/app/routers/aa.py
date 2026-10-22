import logging
import random
import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request

from ..config import settings
from ..db import db
from ..services import audit, game
from ..utils import serialize_doc

router = APIRouter()
AA_UNAVAILABLE = "Bank linking opens once our Account Aggregator partner is connected."


def _demo_only() -> None:
    """The AA flow below is simulated; outside demo mode it must not invent balances."""
    if not settings.demo_mode:
        raise HTTPException(status_code=503, detail=AA_UNAVAILABLE)
logger = logging.getLogger(__name__)


@router.get("/aa/consent-status/{user_id}")
async def get_aa_consent_status(user_id: str):
    """Get Account Aggregator consent status"""
    consent = await db.aa_consents.find_one({"user_id": user_id, "status": {"$in": ["pending", "active"]}}, sort=[("created_at", -1)])
    
    if not consent:
        return {
            "status": "not_linked",
            "message": "No accounts linked yet",
            "linked_accounts": [],
            "available_fips": [
                {"id": "hdfc", "name": "HDFC Bank", "type": "bank", "logo": "hdfc"},
                {"id": "icici", "name": "ICICI Bank", "type": "bank", "logo": "icici"},
                {"id": "sbi", "name": "State Bank of India", "type": "bank", "logo": "sbi"},
                {"id": "axis", "name": "Axis Bank", "type": "bank", "logo": "axis"},
                {"id": "kotak", "name": "Kotak Mahindra", "type": "bank", "logo": "kotak"},
                {"id": "zerodha", "name": "Zerodha", "type": "investment", "logo": "zerodha"},
                {"id": "groww", "name": "Groww", "type": "investment", "logo": "groww"},
                {"id": "lic", "name": "LIC", "type": "insurance", "logo": "lic"},
                {"id": "nps", "name": "NPS", "type": "pension", "logo": "nps"}
            ]
        }
    
    return serialize_doc(consent)

@router.post("/aa/initiate-consent")
async def initiate_aa_consent(data: dict):
    """Initiate AA consent flow (Finvu/CAMFinserv simulation)"""
    _demo_only()
    user_id = data.get("user_id")
    fip_ids = data.get("fip_ids", [])  # Financial Information Providers
    
    # Simulate AA consent flow
    consent_id = str(uuid.uuid4())
    
    consent = {
        "id": consent_id,
        "user_id": user_id,
        "status": "pending",
        "fip_ids": fip_ids,
        "consent_purpose": "Financial data aggregation for expense tracking and insights",
        "data_life": "Until consent revoked",
        "frequency": "Monthly",
        "data_range": "Last 12 months",
        "created_at": datetime.utcnow(),
        "aa_provider": "Finvu",  # or CAMFinserv
        "rbi_compliant": True
    }
    
    await db.aa_consents.insert_one(dict(consent))
    
    return {
        "consent_id": consent_id,
        "status": "pending",
        "redirect_url": f"https://aa.finvu.in/consent/{consent_id}",  # Simulated
        "message": "Please complete consent on your bank app"
    }

@router.post("/aa/confirm-consent")
async def confirm_aa_consent(data: dict):
    """Confirm AA consent (callback simulation)"""
    _demo_only()
    consent_id = data.get("consent_id")
    user_id = data.get("user_id")
    
    # Simulate successful consent
    linked_accounts = [
        {
            "fip_id": "hdfc",
            "account_type": "savings",
            "masked_number": "XXXX1234",
            "balance": random.randint(50000, 500000),
            "last_synced": datetime.utcnow().isoformat()
        },
        {
            "fip_id": "icici",
            "account_type": "savings", 
            "masked_number": "XXXX5678",
            "balance": random.randint(20000, 200000),
            "last_synced": datetime.utcnow().isoformat()
        },
        {
            "fip_id": "zerodha",
            "account_type": "demat",
            "masked_number": "XXXX9012",
            "portfolio_value": random.randint(100000, 1000000),
            "last_synced": datetime.utcnow().isoformat()
        }
    ]
    
    result = await db.aa_consents.update_one(
        {"id": consent_id, "user_id": user_id, "status": "pending"},
        {
            "$set": {
                "status": "active",
                "linked_accounts": linked_accounts,
                "confirmed_at": datetime.utcnow()
            }
        }
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="No pending consent with that id")
    # One reward per user for linking, not one per consent created.
    reward = await game.award(user_id, "account_linked") if await game.claim_once(f"aa_linked:{user_id}") else None
    return {
        "status": "success",
        "message": "Accounts linked successfully!",
        "linked_accounts": linked_accounts,
        "reward": reward,
    }

@router.get("/aa/aggregated-data/{user_id}")
async def get_aggregated_data(user_id: str):
    """Get all aggregated financial data from AA"""
    _demo_only()
    consent = await db.aa_consents.find_one({"user_id": user_id, "status": "active"})
    
    if not consent:
        raise HTTPException(status_code=404, detail="No active consent found")
    
    # Simulated aggregated data
    return {
        "bank_accounts": [
            {
                "bank": "Sample Bank",
                "type": "Savings",
                "balance": 245000,
                "account_number": "XXXX1234",
                "transactions_count": 45
            },
            {
                "bank": "Sample Bank",
                "type": "Savings",
                "balance": 89000,
                "account_number": "XXXX5678",
                "transactions_count": 23
            }
        ],
        "investments": {
            "mutual_funds": {
                "total_value": 450000,
                "funds": [
                    {"name": "Sample Large Cap Fund", "value": 180000, "returns": 12.5},
                    {"name": "Sample Mid Cap Fund", "value": 150000, "returns": 18.2},
                    {"name": "Sample Small Cap Fund", "value": 120000, "returns": 24.1}
                ]
            },
            "stocks": {
                "total_value": 320000,
                "holdings": [
                    {"name": "Sample Energy Ltd", "qty": 50, "value": 145000},
                    {"name": "Sample IT Services Ltd", "qty": 30, "value": 105000},
                    {"name": "Sample Bank Ltd", "qty": 40, "value": 70000}
                ]
            },
            "fixed_deposits": {
                "total_value": 200000,
                "deposits": [
                    {"bank": "Sample Bank", "amount": 100000, "rate": 7.1, "maturity": "2025-06-15"},
                    {"bank": "Sample Bank", "amount": 100000, "rate": 7.25, "maturity": "2025-09-20"}
                ]
            }
        },
        "insurance": [
            {"type": "Health", "provider": "HDFC Ergo", "sum_assured": 1000000, "premium": 18000},
            {"type": "Term Life", "provider": "ICICI Pru", "sum_assured": 10000000, "premium": 12000}
        ],
        "loans": [
            {"type": "Home Loan", "bank": "Sample Bank", "outstanding": 3500000, "emi": 32000, "rate": 8.5},
            {"type": "Car Loan", "bank": "Sample Bank", "outstanding": 450000, "emi": 12000, "rate": 9.2}
        ],
        "net_worth": {
            "total_assets": 1304000,
            "total_liabilities": 3950000,
            "net_worth": -2646000
        },
        "last_synced": datetime.utcnow().isoformat()
    }

@router.post("/aa/revoke-consent")
async def revoke_aa_consent(data: dict, request: Request):
    """Revoke AA consent (RBI compliant)"""
    user_id = data.get("user_id")
    consent_id = data.get("consent_id")
    
    await db.aa_consents.update_one(
        {"id": consent_id, "user_id": user_id},
        {
            "$set": {
                "status": "revoked",
                "revoked_at": datetime.utcnow(),
                "linked_accounts": []
            }
        }
    )
    
    await audit.record("aa_consent_revoked", user_id, {"consent_id": consent_id}, request)
    
    return {"message": "Consent revoked successfully. All linked data has been removed."}
