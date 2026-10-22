import logging
import random
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Request

from ..auth import current_user
from ..config import settings
from ..db import db
from ..models import CardBillPayment
from ..ratelimit import limit
from ..services import game
from ..utils import months_ago_label, serialize_doc

router = APIRouter()
logger = logging.getLogger(__name__)
MAX_CARD_BILL_COINS = 50

# Credit Score Management
@router.get("/credit-score/{user_id}")
async def get_credit_score(user_id: str):
    """Credit score. In demo mode this is a sample, not a bureau score."""
    score_data = await db.credit_scores.find_one({"user_id": user_id})
    if not score_data and not settings.demo_mode:
        # No bureau connected: never show an invented score.
        return {"available": False, "message": "Credit score will be available once we connect to a credit bureau."}
    if not score_data:
        # Generate initial simulated credit score
        base_score = random.randint(650, 800)
        score_data = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "score": base_score,
            "rating": "Excellent" if base_score >= 750 else "Good" if base_score >= 700 else "Fair" if base_score >= 650 else "Poor",
            "factors": {
                "payment_history": random.randint(70, 100),
                "credit_utilization": random.randint(20, 50),
                "credit_age": random.randint(2, 10),
                "credit_mix": random.randint(60, 90),
                "recent_inquiries": random.randint(0, 3)
            },
            "credit_cards": [
                {
                    "bank": "Sample Bank",
                    "card_type": "Rewards card",
                    "limit": 200000,
                    "used": random.randint(20000, 80000),
                    "due_date": (datetime.utcnow() + timedelta(days=random.randint(5, 25))).strftime("%Y-%m-%d"),
                    "min_due": random.randint(2000, 5000),
                    "total_due": random.randint(10000, 50000),
                    "reward_points": random.randint(1000, 15000)
                },
                {
                    "bank": "Example Bank",
                    "card_type": "Cashback card",
                    "limit": 150000,
                    "used": random.randint(15000, 60000),
                    "due_date": (datetime.utcnow() + timedelta(days=random.randint(5, 25))).strftime("%Y-%m-%d"),
                    "min_due": random.randint(1500, 4000),
                    "total_due": random.randint(8000, 40000),
                    "reward_points": random.randint(500, 8000)
                }
            ],
            "history": [
                {"month": months_ago_label(i), "score": base_score - random.randint(5 * i, 10 * i + 5)}
                for i in range(1, 6)
            ],
            "sample": True,  # demo data, not from a credit bureau
            "last_updated": datetime.utcnow(),
            "next_update": datetime.utcnow() + timedelta(days=30)
        }
        await db.credit_scores.insert_one(score_data)
    
    return serialize_doc(score_data)

@router.post("/credit-cards/pay-bill")
async def pay_credit_card_bill(payment: CardBillPayment, request: Request):
    """Pay credit card bill and earn rewards"""
    user_id = current_user(request)
    await limit(f"payments:{user_id}", 10, 60)
    if not settings.demo_mode:
        # No card-bill rail is connected, so there's no real payment to record or reward.
        raise HTTPException(status_code=503, detail="Card bill payments open once our BBPS partner is connected.")
    amount = round(payment.amount, 2)

    # 1 coin per ₹100 paid, at most 50 a bill; daily caps in game.award apply on top.
    bonus = min(int(amount // 100), MAX_CARD_BILL_COINS)

    # Record payment
    payment_record = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "type": "credit_card_bill",
        "card_bank": payment.card_bank,
        "amount": amount,
        "status": "success",
        "sample": True,
        "timestamp": datetime.utcnow()
    }
    reward = await game.award(user_id, "bill_paid", bonus_coins=bonus)
    coins_earned = reward.get("coins_earned", 0)
    await db.payments.insert_one({**payment_record, "coins_earned": coins_earned})
    
    return {
        "message": "Bill paid successfully!",
        "amount_paid": amount,
        "coins_earned": coins_earned,
        "transaction_id": payment_record["id"],
        "reward": reward,
    }
