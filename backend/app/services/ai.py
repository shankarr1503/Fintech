"""Transaction categorisation and spending insights.

OpenAI is used when OPENAI_API_KEY is configured; otherwise everything falls back
to deterministic rules so the app works fully offline.
"""
import json
import logging
import math
import re
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from ..config import settings
from ..db import db
from ..models import TransactionCategory

logger = logging.getLogger(__name__)

ai_client = None
if settings.openai_api_key:
    from openai import AsyncOpenAI

    ai_client = AsyncOpenAI(
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url or None,
    )

KEYWORDS: Dict[TransactionCategory, tuple] = {
    TransactionCategory.FOOD: ("swiggy", "zomato", "domino", "mcdonald", "starbucks", "restaurant", "cafe", "pizza", "kfc", "blinkit", "zepto"),
    TransactionCategory.TRANSPORT: ("uber", "ola", "rapido", "petrol", "fuel", "metro", "irctc", "fastag", "indigo"),
    TransactionCategory.SHOPPING: ("amazon", "flipkart", "myntra", "ajio", "dmart", "bazaar", "nykaa", "meesho"),
    TransactionCategory.UTILITIES: ("electric", "water", "gas", "broadband", "internet", "airtel", "jio", "power", "bescom"),
    TransactionCategory.SUBSCRIPTION: ("netflix", "spotify", "prime", "hotstar", "youtube", "gym", "subscription"),
    TransactionCategory.ENTERTAINMENT: ("bookmyshow", "pvr", "inox", "steam", "game"),
    TransactionCategory.HEALTH: ("pharmacy", "apollo", "hospital", "clinic", "medplus", "1mg", "practo"),
    TransactionCategory.EDUCATION: ("udemy", "coursera", "school", "college", "tuition", "byju"),
    TransactionCategory.SALARY: ("salary", "payroll", "employer"),
    TransactionCategory.INVESTMENT: ("zerodha", "groww", "sip", "mutual", "upstox", "kuvera"),
    TransactionCategory.EMI: ("emi", "loan"),
    TransactionCategory.TRANSFER: ("upi", "neft", "imps", "transfer"),
}


def categorize_by_keywords(merchant: str, description: str = "") -> TransactionCategory:
    text = f"{merchant} {description}".lower()
    for category, words in KEYWORDS.items():
        if any(w in text for w in words):
            return category
    return TransactionCategory.OTHER


async def categorize_transaction_ai(merchant: str, description: str = "") -> TransactionCategory:
    """Categorise a transaction, preferring the LLM when one is configured."""
    if ai_client is None:
        return categorize_by_keywords(merchant, description)
    try:
        prompt = (
            "Categorize this transaction into one of these categories: "
            + ", ".join(c.value for c in TransactionCategory)
            + f"\nMerchant: {merchant}\n"
            "Respond with ONLY the category name in lowercase."
        )
        response = await ai_client.chat.completions.create(
            model=settings.openai_model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=20,
            temperature=0,
            timeout=10,
        )
        category = response.choices[0].message.content.strip().lower()
        if category in {c.value for c in TransactionCategory}:
            return TransactionCategory(category)
    except Exception as e:  # network/auth errors shouldn't break imports
        logger.warning(f"AI categorization failed, using keywords: {e}")
    return categorize_by_keywords(merchant, description)


INSIGHT_CATEGORIES = {"saving", "warning", "spending"}


def clean_insight(raw) -> Optional[Dict]:
    """Keep only the fields we expect from the model, with the types we expect.

    Model output is untrusted: a missing title used to crash the endpoint, and extra keys such as
    "user_id" were spread into the stored insight."""
    if not isinstance(raw, dict):
        return None
    title, description = raw.get("title"), raw.get("description")
    if not isinstance(title, str) or not isinstance(description, str) or not title.strip():
        return None
    impact = raw.get("impact_amount")
    if isinstance(impact, bool) or not isinstance(impact, (int, float)) or not math.isfinite(impact) or impact < 0:
        impact = None
    category = raw.get("category")
    return {
        "title": title.strip()[:80],
        "description": description.strip()[:300],
        "category": category if category in INSIGHT_CATEGORIES else "spending",
        "impact_amount": impact,
    }


async def generate_financial_insights(user_id: str, use_ai: bool = True) -> List[Dict]:
    """Generate up to 3 insights from the last 60 days of spending."""
    try:
        # The last 30 days, so "monthly" figures really are monthly.
        month_ago = datetime.utcnow() - timedelta(days=30)
        transactions = await db.transactions.find({
            "user_id": user_id,
            "date": {"$gte": month_ago}
        }).to_list(500)
        
        if not transactions:
            return []
        
        # Prepare summary
        category_totals = {}
        total_spending = 0
        total_income = 0
        for t in transactions:
            cat = t.get('category', 'other')
            if t.get('type') == 'debit':
                amount = t.get('amount', 0)
                category_totals[cat] = category_totals.get(cat, 0) + amount
                total_spending += amount
            elif t.get('type') == 'credit':
                total_income += t.get('amount', 0)
        
        # Try AI-powered insights first
        if use_ai and ai_client is not None:
            try:
                spending_summary = ", ".join([f"{cat}: ₹{int(amt):,}" for cat, amt in sorted(category_totals.items(), key=lambda x: -x[1])[:6]])
                
                prompt = f"""Analyze this Indian user's monthly spending and provide 3 actionable financial insights.

Monthly Income: ₹{int(total_income):,}
Total Spending: ₹{int(total_spending):,}
Category Breakdown: {spending_summary}

Provide exactly 3 insights in this JSON format:
[
  {{"title": "short title", "description": "actionable advice in 1-2 sentences with specific INR amounts", "category": "saving|warning|spending", "impact_amount": number_or_null}}
]

Rules:
- Use ₹ symbol for Indian Rupees
- Be specific with numbers
- Focus on actionable advice
- category should be: "saving" for money-saving tips, "warning" for concerns, "spending" for general spending advice"""

                response = await ai_client.chat.completions.create(
                    model=settings.openai_model,
                    messages=[{"role": "user", "content": prompt}],
                    max_tokens=500,
                    temperature=0.7,
                    timeout=10,
                )
                
                content = response.choices[0].message.content.strip()
                # Extract JSON from response
                json_match = re.search(r'\[.*\]', content, re.DOTALL)
                if json_match:
                    ai_insights = [i for i in map(clean_insight, json.loads(json_match.group())) if i]
                    if ai_insights:
                        logger.info("AI insights generated successfully")
                        return ai_insights[:3]
            except Exception as ai_error:
                logger.warning(f"AI insights failed, falling back to rules: {ai_error}")
        
        # Fallback to rule-based insights
        insights = []
        
        # Food spending insight
        food_spending = category_totals.get('food', 0)
        if food_spending > 5000:
            potential_savings = food_spending * 0.25
            insights.append({
                "title": "Reduce Food Delivery",
                "description": f"You spent ₹{int(food_spending):,} on food. Cooking at home 3 times more per week could save ₹{int(potential_savings):,}/month.",
                "category": "saving",
                "impact_amount": potential_savings
            })
        
        # Subscription insight
        sub_spending = category_totals.get('subscription', 0)
        if sub_spending > 500:
            insights.append({
                "title": "Review Subscriptions",
                "description": f"You're paying ₹{int(sub_spending):,} for subscriptions. Consider using family plans to save up to 40%.",
                "category": "warning",
                "impact_amount": sub_spending * 0.4
            })
        
        # EMI insight
        emi_spending = category_totals.get('emi', 0)
        if emi_spending > 10000:
            insights.append({
                "title": "EMI Management",
                "description": f"EMIs of ₹{int(emi_spending):,}/month take up a significant portion. Consider prepaying loans to reduce interest.",
                "category": "spending",
                "impact_amount": None
            })
        
        # Shopping insight
        shopping_spending = category_totals.get('shopping', 0)
        if shopping_spending > 3000:
            insights.append({
                "title": "Smart Shopping",
                "description": f"Shopping expenses of ₹{int(shopping_spending):,}. Try using cashback cards and wait for sales.",
                "category": "saving",
                "impact_amount": shopping_spending * 0.15
            })
        
        # Transport insight
        transport_spending = category_totals.get('transport', 0)
        if transport_spending > 3000:
            insights.append({
                "title": "Optimize Transport",
                "description": f"Transport costs of ₹{int(transport_spending):,}. Using public transport twice a week could save ₹{int(transport_spending * 0.2):,}/month.",
                "category": "saving",
                "impact_amount": transport_spending * 0.2
            })
        
        # If we have few insights, add a positive one
        if len(insights) < 2:
            savings_rate = ((total_income - total_spending) / total_income * 100) if total_income > 0 else 0
            if savings_rate > 20:
                insights.append({
                    "title": "Excellent Savings!",
                    "description": f"You're saving {int(savings_rate)}% of your income. Great financial discipline!",
                    "category": "spending",
                    "impact_amount": None
                })
            else:
                insights.append({
                    "title": "Track & Improve",
                    "description": "Keep tracking your expenses to identify more savings opportunities.",
                    "category": "spending",
                    "impact_amount": None
                })
        
        return insights[:3]  # Return max 3 insights
    except Exception as e:
        logger.error(f"Insight generation failed: {e}")
        return []
