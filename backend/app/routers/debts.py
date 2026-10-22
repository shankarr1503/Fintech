import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request

from ..auth import current_user
from ..db import db
from ..models import Debt, DebtCreate, DebtPayment, DebtStrategy
from ..services import game
from ..services.debt import calculate_debt_payoff
from ..utils import serialize_doc

router = APIRouter()
logger = logging.getLogger(__name__)

@router.get("/debts/{user_id}")
async def get_debts(user_id: str):
    """Get all user debts"""
    debts = await db.debts.find({"user_id": user_id}).to_list(100)
    return serialize_doc(debts)

@router.post("/debts")
async def create_debt(debt: DebtCreate):
    """Add a new debt"""
    debt_obj = Debt(**debt.model_dump())
    await db.debts.insert_one(debt_obj.model_dump())
    reward = await game.award(debt.user_id, "debt_added")
    return {**debt_obj.model_dump(mode="json"), "reward": reward}

@router.delete("/debts/{debt_id}")
async def delete_debt(debt_id: str, request: Request):
    """Delete a debt"""
    result = await db.debts.delete_one({"id": debt_id, "user_id": current_user(request)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Debt not found")
    return {"message": "Debt deleted"}

@router.post("/debts/{debt_id}/pay")
async def pay_debt(debt_id: str, payment: DebtPayment, request: Request):
    """Log a payment against a debt ("attack the boss"). Defeating it pays a big bonus."""
    debt = await db.debts.find_one({"id": debt_id, "user_id": current_user(request)})
    if not debt:
        raise HTTPException(status_code=404, detail="Debt not found")

    if debt["outstanding"] <= 0:
        raise HTTPException(status_code=409, detail="This debt is already paid off")
    paid = round(min(payment.amount, debt["outstanding"]), 2)
    outstanding = round(debt["outstanding"] - paid, 2)
    # Compare-and-set on the balance we read, so two payments at once can't both apply.
    res = await db.debts.update_one({"id": debt_id, "outstanding": debt["outstanding"]}, {"$set": {"outstanding": outstanding}})
    if res.modified_count == 0:
        raise HTTPException(status_code=409, detail="This debt just changed. Please try again.")
    await db.debt_payments.insert_one({
        "id": str(uuid.uuid4()), "debt_id": debt_id, "user_id": debt["user_id"],
        "amount": paid, "timestamp": datetime.utcnow(),
    })

    reward = await game.award(debt["user_id"], "debt_payment")
    defeated = outstanding <= 0
    if defeated and await game.claim_once(f"boss:{debt_id}"):
        reward = await game.award(debt["user_id"], "boss_defeated")
    return {"debt_id": debt_id, "paid": paid, "outstanding": outstanding, "defeated": defeated, "reward": reward}


@router.get("/debts/analysis/{user_id}")
async def analyze_debts(user_id: str, extra_payment: float = 0):
    """Analyze debts with payoff strategies"""
    debts = await db.debts.find({"user_id": user_id}).to_list(100)
    
    if not debts:
        return {
            "total_debt": 0,
            "total_emi": 0,
            "snowball_analysis": None,
            "avalanche_analysis": None
        }
    
    total_debt = sum(d['outstanding'] for d in debts)
    total_emi = sum(d['emi_amount'] for d in debts)
    avg_interest = sum(d['interest_rate'] * d['outstanding'] for d in debts) / total_debt if total_debt > 0 else 0
    
    snowball = calculate_debt_payoff(debts, DebtStrategy.SNOWBALL, extra_payment)
    avalanche = calculate_debt_payoff(debts, DebtStrategy.AVALANCHE, extra_payment)
    
    # Log for debugging
    logger.info(f"Debt Analysis - Snowball: {snowball['total_months']} months, {snowball['total_interest']} interest")
    logger.info(f"Debt Analysis - Avalanche: {avalanche['total_months']} months, {avalanche['total_interest']} interest")
    
    return {
        "total_debt": round(total_debt, 2),
        "total_emi": round(total_emi, 2),
        "average_interest_rate": round(avg_interest, 2),
        "snowball_analysis": snowball,
        "avalanche_analysis": avalanche,
        "interest_saved_with_avalanche": round(snowball['total_interest'] - avalanche['total_interest'], 2)
    }
