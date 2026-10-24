import logging
import math
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Request

from ..auth import current_user
from ..db import db
from ..ratelimit import limit
from ..config import settings
from ..utils import serialize_doc

router = APIRouter()
logger = logging.getLogger(__name__)

# Indicative terms. Real offers come from the lending partner (a regulated bank or NBFC)
# and are shown in its Key Fact Statement before the borrower accepts.
LOAN_TYPES = {
    "loan_against_mf": {"name": "Loan against mutual funds", "rate": 10.5, "fee_pct": 1.0, "max_ltv": 70, "collateral_value": 450000, "tenures": [12, 24, 36, 48, 60]},
    "loan_against_shares": {"name": "Loan against shares", "rate": 11.5, "fee_pct": 1.5, "max_ltv": 50, "collateral_value": 320000, "tenures": [12, 24, 36]},
    "loan_against_fd": {"name": "Loan against FD", "rate": 8.5, "fee_pct": 0.5, "max_ltv": 90, "collateral_value": 200000, "tenures": [12, 24, 36, 48, 60]},
    "personal_loan": {"name": "Personal loan", "rate": 14.5, "fee_pct": 2.0, "max_ltv": 100, "collateral_value": 0, "tenures": [12, 24, 36, 48, 60]},
}
GST = 0.18
COOLING_OFF_DAYS = 3  # RBI Digital Lending Guidelines: exit without penalty during the look-up period


def _collateral(kind: str) -> int:
    """Pledgeable holdings. Only the demo has sample ones; real values need a depository link."""
    return LOAN_TYPES[kind]["collateral_value"] if settings.demo_mode else 0


def _max_loan(kind: str, score: int) -> int:
    t = LOAN_TYPES[kind]
    if kind == "personal_loan":
        return 500000 if score >= 700 else 200000
    return int(_collateral(kind) * t["max_ltv"] / 100)


async def _score(user_id) -> int:
    credit_score = await db.credit_scores.find_one({"user_id": user_id})
    return credit_score.get("score", 700) if credit_score else 700


def key_facts(kind: str, amount: float, tenure: int) -> dict:
    """The numbers a borrower must see before accepting: EMI, every fee, APR, net disbursal and total cost."""
    t = LOAN_TYPES[kind]
    r = t["rate"] / 12 / 100
    emi = amount * r * (1 + r) ** tenure / ((1 + r) ** tenure - 1)
    fee = amount * t["fee_pct"] / 100
    fee_gst = fee * GST
    net = amount - fee - fee_gst
    # APR: the yearly rate at which the EMIs repay the money actually received (fees included).
    lo, hi = 0.0, 1.0
    for _ in range(100):
        mid = (lo + hi) / 2
        pv = sum(emi / (1 + mid) ** k for k in range(1, tenure + 1))
        lo, hi = (mid, hi) if pv > net else (lo, mid)
    return {
        "loan_type": kind,
        "name": t["name"],
        "amount": round(amount, 2),
        "tenure_months": tenure,
        "interest_rate": t["rate"],
        "emi": round(emi, 2),
        "processing_fee": round(fee, 2),
        "gst_on_fee": round(fee_gst, 2),
        "net_disbursal": round(net, 2),
        "total_interest": round(emi * tenure - amount, 2),
        "total_repayable": round(emi * tenure, 2),
        "apr": round(lo * 12 * 100, 2),
        "late_payment": "Charged by the lender as per its schedule of charges, shown in its Key Fact Statement",
        "cooling_off_days": COOLING_OFF_DAYS,
        "lender": None,  # set once a lending partner is connected
    }


async def _validate(user_id, kind: str, amount, tenure) -> tuple:
    if kind not in LOAN_TYPES:
        raise HTTPException(status_code=400, detail="Unknown loan type")
    try:
        amount, tenure = float(amount), int(tenure)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid amount or tenure")
    if not math.isfinite(amount):
        raise HTTPException(status_code=400, detail="Invalid amount or tenure")
    if amount < 10000:
        raise HTTPException(status_code=400, detail="The minimum loan is ₹10,000")
    most = _max_loan(kind, await _score(user_id))
    if amount > most:
        raise HTTPException(status_code=400, detail=f"The most you can borrow here is ₹{most:,}" if most else "Link your investments to borrow against them")
    if tenure not in LOAN_TYPES[kind]["tenures"]:
        raise HTTPException(status_code=400, detail="Choose one of the tenures shown")
    return round(amount, 2), tenure


@router.get("/loans/eligibility/{user_id}")
async def check_loan_eligibility(user_id: str):
    """Indicative eligibility. Final terms come from the lender."""
    score = await _score(user_id)
    return {
        "credit_score": score,
        "lender": None,
        "eligible_loan_types": [
            {
                "type": k,
                "name": t["name"],
                "max_ltv": t["max_ltv"],
                "interest_rate": t["rate"],
                "processing_fee": t["fee_pct"],
                "tenure_options": t["tenures"],
                "collateral_value": _collateral(k),
                "max_loan": _max_loan(k, score),
            }
            for k, t in LOAN_TYPES.items()
        ],
        "pre_approved_offers": [],
    }


@router.post("/loans/quote")
async def loan_quote(data: dict, request: Request):
    """Key Fact Statement for a loan, shown before the user applies."""
    amount, tenure = await _validate(current_user(request), data.get("loan_type"), data.get("amount"), data.get("tenure"))
    return key_facts(data["loan_type"], amount, tenure)


@router.post("/loans/apply")
async def apply_for_loan(data: dict, request: Request):
    """Submit an application. It is only sent to a lender after the user has seen and accepted the key facts."""
    user_id = current_user(request)
    await limit(f"loan-apply:{user_id}", 5, 3600)
    amount, tenure = await _validate(user_id, data.get("loan_type"), data.get("amount"), data.get("tenure"))
    if data.get("accept_key_facts") is not True:
        raise HTTPException(status_code=400, detail="Please review and accept the key facts first")
    facts = key_facts(data["loan_type"], amount, tenure)

    loan_id = f"LN{uuid.uuid4().hex[:10].upper()}"
    loan = {
        "id": loan_id,
        "user_id": user_id,
        "type": data["loan_type"],
        "name": facts["name"],
        "amount": amount,
        "tenure": tenure,
        "emi": facts["emi"],
        "interest_rate": facts["interest_rate"],
        "key_facts": facts,
        "status": "submitted",
        "applied_at": datetime.utcnow(),
    }
    await db.loans.insert_one(dict(loan))
    message = (
        "Application saved. This is a demo: no lender is connected, so nothing is disbursed."
        if settings.demo_mode
        else "Application received. The lender will review it and contact you; nothing is disbursed until you sign the loan agreement."
    )
    return {"status": "submitted", "loan_id": loan_id, **facts, "message": message}


@router.get("/loans/active/{user_id}")
async def get_active_loans(user_id: str):
    """Get user's active loans"""
    loans = await db.loans.find({"user_id": user_id, "status": {"$in": ["submitted", "approved", "active"]}}).to_list(10)
    
    if not loans and settings.demo_mode:
        # Sample loan
        loans = [
            {
                "id": "LN001",
                "type": "loan_against_mf",
                "name": "Loan Against Mutual Funds",
                "amount": 150000,
                "outstanding": 125000,
                "emi": 4832,
                "interest_rate": 10.5,
                "tenure": 36,
                "remaining_tenure": 26,
                "next_emi_date": (datetime.utcnow() + timedelta(days=15)).strftime("%Y-%m-%d"),
                "status": "active",
                "collateral": {
                    "type": "mutual_funds",
                    "value": 220000,
                    "funds": ["Sample Large Cap Fund", "Sample Mid Cap Fund"]
                }
            }
        ]
    
    return serialize_doc(loans)
