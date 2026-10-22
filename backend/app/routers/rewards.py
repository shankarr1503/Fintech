import logging
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException

from ..config import settings
from ..db import db
from ..ratelimit import limit
from ..services import game
from ..utils import serialize_doc

router = APIRouter()
logger = logging.getLogger(__name__)

# What a coin is worth in the store: every voucher below costs 10 coins per rupee.
COIN_VALUE = 0.10

# Generic vouchers. Brand vouchers need a contract with each brand (or a voucher
# partner); until one exists we don't show brand names or logos.
DEALS = [
    {"id": "v_shop_50", "brand": "Shopping voucher", "title": "₹50 shopping voucher", "coins_required": 500, "category": "shopping", "image": "shopping",
     "discount": "One use. Valid 30 days from redemption."},
    {"id": "v_food_100", "brand": "Food voucher", "title": "₹100 food delivery voucher", "coins_required": 1000, "category": "food", "image": "food",
     "discount": "On orders of ₹200 or more. Valid 30 days."},
    {"id": "v_travel_150", "brand": "Travel voucher", "title": "₹150 off a cab or bus ride", "coins_required": 1500, "category": "transport", "image": "transport",
     "discount": "One ride. Valid 30 days."},
    {"id": "v_movie_250", "brand": "Movie voucher", "title": "₹250 off movie tickets", "coins_required": 2500, "category": "entertainment", "image": "entertainment",
     "discount": "On 2 tickets or more. Valid 30 days."},
    {"id": "v_shop_500", "brand": "Shopping voucher", "title": "₹500 shopping voucher", "coins_required": 5000, "category": "shopping", "image": "shopping",
     "discount": "One use. Valid 30 days from redemption."},
]


@router.get("/rewards/{user_id}")
async def get_rewards(user_id: str):
    """Get user's reward coins and available deals"""
    user = await db.users.find_one({"id": user_id})
    coins = user.get("reward_coins", 0) if user else 0
    
    # Coins history
    history = await db.payments.find({"user_id": user_id}).sort("timestamp", -1).to_list(20)
    
    return {
        "total_coins": coins,
        "coins_value": round(coins * COIN_VALUE, 2),
        "coin_value": COIN_VALUE,
        "store_open": settings.demo_mode,  # opens for real once a voucher partner is connected
        "sample_codes": settings.demo_mode,
        "deals": DEALS,
        "coins_history": serialize_doc(history),
        "tier": "Platinum" if coins > 10000 else "Gold" if coins > 5000 else "Silver" if coins > 1000 else "Bronze"
    }

@router.post("/rewards/redeem")
async def redeem_reward(redemption: dict):
    """Redeem coins for a deal"""
    user_id = redemption.get("user_id")
    deal_id = redemption.get("deal_id")
    await limit(f"redeem:{user_id}", 10, 60)
    if not settings.demo_mode:
        raise HTTPException(status_code=503, detail="The rewards store opens once our voucher partner is connected. Your coins are safe.")
    deal = next((d for d in DEALS if d["id"] == deal_id), None)
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    coins_required = deal["coins_required"]  # never trust the client's price
    
    # Check and deduct in one step, so parallel redemptions can't spend the same coins twice.
    res = await db.users.update_one(
        {"id": user_id, "reward_coins": {"$gte": coins_required}},
        {"$inc": {"reward_coins": -coins_required}}
    )
    if res.modified_count == 0:
        raise HTTPException(status_code=400, detail="Insufficient coins")
    user = await db.users.find_one({"id": user_id})
    current_coins = user.get("reward_coins", 0) + coins_required
    
    # Generate voucher code
    voucher_code = f"FW{uuid.uuid4().hex[:8].upper()}"
    
    redemption_record = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "deal_id": deal_id,
        "coins_used": coins_required,
        "voucher_code": voucher_code,
        "status": "active",
        "valid_until": datetime.utcnow() + timedelta(days=30),
        "redeemed_at": datetime.utcnow()
    }
    await db.redemptions.insert_one(dict(redemption_record))
    await db.payments.insert_one({
        "id": str(uuid.uuid4()), "user_id": user_id, "type": "redemption", "title": deal["title"],
        "coins_earned": -coins_required, "status": "success", "timestamp": datetime.utcnow(),
    })
    reward = await game.award(user_id, "reward_redeemed")

    return {
        "reward": reward,
        "coins_left": current_coins - coins_required,
        "message": "Reward redeemed",
        "sample": settings.demo_mode,  # demo codes can't be used at a real store
        "voucher_code": voucher_code,
        "valid_until": redemption_record["valid_until"].strftime("%Y-%m-%d")
    }
