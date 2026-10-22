import logging
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException

from ..config import settings
from ..db import db
from ..ratelimit import limit
from ..services import game

router = APIRouter()
logger = logging.getLogger(__name__)

BILLS = [
    {
        "id": "bill_rent",
        "type": "rent",
        "title": "Monthly Rent",
        "biller": "Landlord",
        "amount": 25000,
        "due_in_days": 5,
        "status": "pending",
        "autopay": False,
        "coins_earn": 250
    },
    {
        "id": "bill_electricity",
        "type": "utility",
        "title": "Electricity Bill",
        "biller": "Tata Power",
        "amount": 2450,
        "due_in_days": 8,
        "status": "pending",
        "autopay": False,
        "coins_earn": 24
    },
    {
        "id": "bill_broadband",
        "type": "utility",
        "title": "Broadband",
        "biller": "Airtel Xstream",
        "amount": 999,
        "due_in_days": 12,
        "status": "pending",
        "autopay": False,
        "coins_earn": 10
    },
    {
        "id": "bill_mobile",
        "type": "recharge",
        "title": "Mobile Recharge",
        "biller": "Jio",
        "amount": 666,
        "due_in_days": 3,
        "status": "pending",
        "autopay": False,
        "coins_earn": 7
    },
    {
        "id": "bill_insurance",
        "type": "insurance",
        "title": "Health Insurance",
        "biller": "HDFC Ergo",
        "amount": 1500,
        "due_in_days": 20,
        "status": "pending",
        "autopay": False,
        "coins_earn": 15
    }
]


@router.get("/bills/{user_id}")
async def get_bills(user_id: str):
    """Get all pending bills"""
    month = datetime.utcnow().strftime("%Y-%m")
    paid = {
        p["bill_id"]: p
        for p in await db.payments.find({"user_id": user_id, "type": "bill", "month": month}).to_list(100)
    }
    bills = []
    if not settings.demo_mode:
        return bills  # real bills come from BBPS once connected
    for template in BILLS:
        bill = {k: v for k, v in template.items() if k != "due_in_days"}
        bill["sample"] = True
        bill["due_date"] = (datetime.utcnow() + timedelta(days=template["due_in_days"])).strftime("%Y-%m-%d")
        if template["id"] in paid:
            bill["status"] = "paid"
            bill["paid_on"] = paid[template["id"]]["timestamp"].strftime("%Y-%m-%d")
        bills.append(bill)
    
    return bills

@router.post("/bills/pay")
async def pay_bill(payment: dict):
    """Pay a bill and earn coins + XP"""
    user_id = payment.get("user_id")
    await limit(f"payments:{user_id}", 10, 60)
    bill = next((b for b in BILLS if b["id"] == payment.get("bill_id")), None)
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")

    month = datetime.utcnow().strftime("%Y-%m")
    if not settings.demo_mode:
        raise HTTPException(status_code=503, detail="Bill payments open once our BBPS partner is connected.")
    if not await game.claim_once(f"bill:{user_id}:{bill['id']}:{month}"):
        raise HTTPException(status_code=400, detail="This bill is already paid for this month")

    transaction_id = str(uuid.uuid4())
    await db.payments.insert_one({
        "id": transaction_id, "user_id": user_id, "type": "bill", "bill_id": bill["id"], "title": bill["title"],
        "amount": bill["amount"], "coins_earned": bill["coins_earn"], "month": month,
        "status": "success", "timestamp": datetime.utcnow(),
    })
    await db.users.update_one({"id": user_id}, {"$inc": {"reward_coins": bill["coins_earn"]}})
    reward = await game.award(user_id, "bill_paid")

    return {
        "message": "Bill paid successfully!",
        "amount_paid": bill["amount"],
        "coins_earned": bill["coins_earn"],
        "transaction_id": transaction_id,
        "reward": reward,
    }
