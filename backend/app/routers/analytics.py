import logging
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter

from ..db import db
from ..services.ai import generate_financial_insights

router = APIRouter()
logger = logging.getLogger(__name__)

@router.get("/analytics/summary/{user_id}")
async def get_analytics_summary(user_id: str):
    """Get spending summary and analytics"""
    now = datetime.utcnow()
    start_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    last_month_start = (start_of_month - timedelta(days=1)).replace(day=1)
    
    # This month's transactions
    this_month_txns = await db.transactions.find({
        "user_id": user_id,
        "date": {"$gte": start_of_month},
        "type": "debit"
    }).to_list(1000)
    
    # Same point in last month, so a half-finished month isn't compared to a full one
    last_month_same_point = min(last_month_start + (now - start_of_month), start_of_month)
    last_month_txns = await db.transactions.find({
        "user_id": user_id,
        "date": {"$gte": last_month_start, "$lt": last_month_same_point},
        "type": "debit"
    }).to_list(1000)
    
    # Calculate totals
    this_month_total = sum(t['amount'] for t in this_month_txns)
    last_month_total = sum(t['amount'] for t in last_month_txns)
    
    # Category breakdown
    category_totals = {}
    for t in this_month_txns:
        cat = t.get('category', 'other')
        category_totals[cat] = round(category_totals.get(cat, 0) + t['amount'], 2)
    
    # Get income
    income_txns = await db.transactions.find({
        "user_id": user_id,
        "date": {"$gte": start_of_month},
        "type": "credit"
    }).to_list(100)
    total_income = sum(t['amount'] for t in income_txns)
    
    # Calculate change percentage
    change_pct = 0
    if last_month_total > 0:
        change_pct = round(((this_month_total - last_month_total) / last_month_total) * 100, 1)
    
    return {
        "this_month_spending": round(this_month_total, 2),
        "last_month_spending": round(last_month_total, 2),
        "change_percentage": change_pct,
        "total_income": round(total_income, 2),
        "remaining_balance": round(total_income - this_month_total, 2),
        "category_breakdown": category_totals,
        "transaction_count": len(this_month_txns)
    }

@router.get("/analytics/insights/{user_id}")
async def get_insights(user_id: str):
    """Get AI-generated financial insights"""
    insights = await generate_financial_insights(user_id)
    
    # Store insights
    for insight in insights:
        insight_obj = {
            **insight,
            "id": str(uuid.uuid4()),
            "user_id": user_id,  # after the spread, so an insight can never name another user
            "created_at": datetime.utcnow()
        }
        await db.insights.update_one(
            {"user_id": user_id, "title": insight['title']},
            {"$set": insight_obj},
            upsert=True
        )
    
    return insights

@router.get("/analytics/expense-reduction/{user_id}")
async def get_expense_reduction_tips(user_id: str):
    """Get personalized expense reduction suggestions"""
    # Get category spending
    start_of_month = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    
    txns = await db.transactions.find({
        "user_id": user_id,
        "date": {"$gte": start_of_month},
        "type": "debit"
    }).to_list(1000)
    
    category_totals = {}
    subscription_totals = 0
    
    for t in txns:
        cat = t.get('category', 'other')
        category_totals[cat] = category_totals.get(cat, 0) + t['amount']
        if t.get('is_subscription'):
            subscription_totals += t['amount']
    
    suggestions = []
    
    # Food delivery reduction
    if category_totals.get('food', 0) > 5000:
        food_spending = category_totals['food']
        potential_savings = food_spending * 0.3
        suggestions.append({
            "category": "food",
            "title": "Reduce Food Delivery",
            "description": f"Cooking at home 3 more times per week could save you ₹{int(potential_savings):,}/month",
            "monthly_savings": potential_savings,
            "yearly_savings": potential_savings * 12
        })
    
    # Entertainment/subscription
    if subscription_totals > 1000:
        suggestions.append({
            "category": "subscription",
            "title": "Review Subscriptions",
            "description": f"You're spending ₹{int(subscription_totals):,} on subscriptions. Consider sharing family plans.",
            "monthly_savings": subscription_totals * 0.4,
            "yearly_savings": subscription_totals * 0.4 * 12
        })
    
    # Transport
    if category_totals.get('transport', 0) > 3000:
        transport = category_totals['transport']
        suggestions.append({
            "category": "transport",
            "title": "Optimize Commute",
            "description": f"Using public transport twice a week could save ₹{int(transport * 0.2):,}/month",
            "monthly_savings": transport * 0.2,
            "yearly_savings": transport * 0.2 * 12
        })
    
    return suggestions
