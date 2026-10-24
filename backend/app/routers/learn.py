import logging

from fastapi import APIRouter, HTTPException

from ..db import db
from ..services import game
from ..utils import serialize_doc

router = APIRouter()
public_router = APIRouter()
logger = logging.getLogger(__name__)


# CoinQuest's own short lessons. General information, not personal financial advice.
COURSES = [
    {
        "id": "basics",
        "title": "Money basics",
        "description": "A budget you can keep, and a cushion for surprises.",
        "level": "Beginner",
        "badge": "Money Master",
        "lessons": [
            ("Know where it goes", "Before cutting anything, look at one month of spending by category. Most people find two or three categories make up most of their discretionary spending; that's where small changes count."),
            ("The 50/30/20 rule", "A simple starting split of take-home pay: about 50% for needs (rent, bills, groceries, EMIs), 30% for wants, and 20% for saving or paying down debt. Adjust it to your life; the point is to decide in advance."),
            ("Emergency fund first", "Aim for 3 to 6 months of essential expenses in a savings account or liquid fund you can reach within a day. It stops a surprise bill from turning into credit card debt."),
            ("Pay yourself first", "Move your savings on payday, before you spend, instead of saving whatever is left. A standing instruction or SIP on the day salary arrives makes it automatic."),
        ],
    },
    {
        "id": "debt",
        "title": "Getting out of debt",
        "description": "Pick a payoff order and stick to it.",
        "level": "Beginner",
        "badge": "Debt Crusher",
        "lessons": [
            ("List every debt", "Write down each debt's balance, interest rate and minimum payment. Credit cards often charge over 36% a year, far more than most loans, so they usually come first."),
            ("Avalanche", "Pay the minimum on everything, and put every extra rupee on the highest-interest debt. This costs the least in total interest. The Debts screen shows how much it saves you."),
            ("Snowball", "Pay the minimum on everything, and put extra on the smallest balance first. It costs a little more, but clearing a debt quickly keeps many people motivated."),
            ("Avoid the minimum-payment trap", "Paying only the minimum due on a credit card keeps you in debt for years, because interest is charged on the rest. Pay the full statement balance whenever you can."),
        ],
    },
    {
        "id": "credit",
        "title": "Credit scores",
        "description": "What moves your score, and what doesn't.",
        "level": "Beginner",
        "badge": "Score Builder",
        "lessons": [
            ("What a score is", "Credit bureaus in India (CIBIL, Experian, Equifax, CRIF High Mark) give scores from 300 to 900 based on your borrowing history. Lenders use them to decide whether to lend and at what rate."),
            ("Pay on time, every time", "Payment history matters most. One payment more than 30 days late can stay on your report for years. Autopay for at least the minimum due prevents accidents."),
            ("Keep utilisation low", "Try to use less than 30% of your total card limits. Using ₹45,000 of a ₹50,000 limit looks risky even if you pay in full."),
            ("Checking is free and safe", "Checking your own score is a 'soft' enquiry and doesn't lower it. You're entitled to one free full report a year from each bureau."),
        ],
    },
    {
        "id": "investing",
        "title": "First steps in investing",
        "description": "How to start once your emergency fund is in place.",
        "level": "Intermediate",
        "badge": "Steady Investor",
        "lessons": [
            ("Match money to time", "Money you need within 3 years belongs in low-risk options such as FDs or debt funds. Only money you won't need for 5 years or more should go into equity, which can fall sharply in the short term."),
            ("SIPs", "A Systematic Investment Plan puts a fixed amount into a mutual fund every month. It removes the temptation to time the market, and buys more units when prices are low."),
            ("Costs matter", "Compare expense ratios. Direct plans of mutual funds cost less than regular plans, and over 20 years a 1% difference in yearly cost can take a large share of your returns."),
            ("Beware of guarantees", "No genuine market investment guarantees high returns. Be wary of tips on social media and of anyone promising fixed profits; check that advisers are SEBI-registered."),
        ],
    },
]


def _public(course: dict) -> dict:
    lessons = [{"title": t, "body": b} for t, b in course["lessons"]]
    return {**course, "lessons": lessons, "topics": [l["title"] for l in lessons], "modules": len(lessons)}


@public_router.get("/learn/courses")
async def get_courses():
    """CoinQuest's lessons."""
    return [_public(c) for c in COURSES]


@router.get("/learn/progress/{user_id}")
async def get_learning_progress(user_id: str):
    """Get user's learning progress and badges"""
    progress = await db.learning_progress.find_one({"user_id": user_id})
    
    if not progress:
        progress = {
            "user_id": user_id,
            "courses_completed": 0,
            "courses_in_progress": [],
            "badges_earned": ["Beginner"],
            "total_xp": 100,
            "level": 1,
            "streak_days": 0,
            "articles_read": 0,
            "quizzes_passed": 0,
            "modules_done": [],
        }
        await db.learning_progress.insert_one(dict(progress))
    
    return serialize_doc(progress)

@router.post("/learn/complete-module")
async def complete_module(data: dict):
    """Mark a module as complete and earn XP"""
    user_id = data.get("user_id")
    course_id = data.get("course_id")
    module_id = data.get("module_id")
    
    course = next((c for c in COURSES if c["id"] == course_id), None)
    if not course or not str(module_id).isdigit() or not 0 <= int(module_id) < len(course["lessons"]):
        raise HTTPException(status_code=404, detail="Lesson not found")
    progress = await get_learning_progress(user_id)
    if not await game.claim_once(f"module:{user_id}:{course_id}:{module_id}"):
        return {"message": "Already done", "xp_earned": 0, "total_xp": progress.get("total_xp", 0), "level": progress.get("level", 1), "reward": None}

    xp_earned = 50
    await get_learning_progress(user_id)  # make sure a progress doc exists
    await db.learning_progress.update_one(
        {"user_id": user_id},
        {
            "$inc": {"total_xp": xp_earned},
            "$addToSet": {"courses_in_progress": course_id, "modules_done": f"{course_id}:{module_id}"},
        },
    )

    progress = await db.learning_progress.find_one({"user_id": user_id})
    new_level = (progress.get("total_xp", 0) // 500) + 1
    if new_level > progress.get("level", 1):
        await db.learning_progress.update_one({"user_id": user_id}, {"$set": {"level": new_level}})

    reward = await game.award(user_id, "module_complete")
    return {
        "message": "Module completed!",
        "xp_earned": xp_earned,
        "total_xp": progress.get("total_xp", 0),
        "level": new_level,
        "reward": reward,
    }
