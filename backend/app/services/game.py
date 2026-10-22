"""Game layer: XP, levels, streaks, daily quests and achievements.

Every money action in the app (paying, saving, learning, beating debt) calls
`award()`, which records the event, grants XP + coins and reports level-ups,
quest completions and newly unlocked achievements back to the client so the UI
can celebrate them.
"""
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from pymongo.errors import DuplicateKeyError

from ..db import db

# action -> (xp, coins)
ACTIONS: Dict[str, tuple] = {
    "daily_checkin": (10, 5),
    "payment_sent": (20, 0),  # UPI already pays coins per rupee
    "bill_paid": (30, 0),
    "goal_created": (15, 10),
    "goal_contribution": (25, 0),
    "goal_completed": (250, 100),
    "debt_added": (10, 5),
    "debt_payment": (25, 0),
    "boss_defeated": (300, 150),
    "module_complete": (50, 10),
    "account_linked": (60, 30),
    "transaction_categorised": (10, 0),
    "reward_redeemed": (10, 0),
    "profile_updated": (5, 0),
}

# How many times a day an action can pay XP and coins. Stops farming by creating and deleting
# goals, debts or consents in a loop; anything past the cap is still recorded, just unpaid.
DAILY_CAPS: Dict[str, int] = {
    "goal_created": 3,
    "goal_completed": 2,
    "debt_added": 3,
    "debt_payment": 5,
    "boss_defeated": 2,
    "bill_paid": 5,
    "module_complete": 5,
    "account_linked": 1,
    "transaction_categorised": 10,
    "reward_redeemed": 5,
    "profile_updated": 1,
    "goal_contribution": 5,
    "payment_sent": 20,
}

TITLES = [
    "Rookie Saver", "Coin Collector", "Budget Knight", "Bill Buster", "Debt Slayer",
    "Savings Sage", "Wealth Wizard", "Money Master", "Finance Legend",
]

ACHIEVEMENTS = [
    {"id": "first_coin", "name": "First Coin", "desc": "Make your first payment", "icon": "coin"},
    {"id": "bill_buster", "name": "Bill Buster", "desc": "Pay 3 bills", "icon": "brick"},
    {"id": "piggy_hero", "name": "Piggy Hero", "desc": "Add money to a savings goal", "icon": "piggy"},
    {"id": "castle_clear", "name": "Castle Clear", "desc": "Complete a savings goal", "icon": "castle"},
    {"id": "boss_slayer", "name": "Boss Slayer", "desc": "Pay off a debt completely", "icon": "sword"},
    {"id": "scholar", "name": "Scholar", "desc": "Finish a lesson in the Academy", "icon": "book"},
    {"id": "warp_master", "name": "Warp Master", "desc": "Link accounts via Account Aggregator", "icon": "pipe"},
    {"id": "on_fire", "name": "On Fire", "desc": "Keep a 7-day streak", "icon": "fire"},
    {"id": "level_5", "name": "Power Up", "desc": "Reach level 5", "icon": "star"},
]

# Pool of daily quests; three are picked per day, rotating by date.
QUEST_POOL = [
    {"id": "q_checkin", "title": "Daily Check-in", "desc": "Open the app and check in", "action": "daily_checkin", "target": 1, "reward_coins": 10},
    {"id": "q_sort", "title": "Sorting Hat", "desc": "Fix the category of a transaction", "action": "transaction_categorised", "target": 1, "reward_coins": 15},
    {"id": "q_save", "title": "Piggy Bank", "desc": "Add money to any goal", "action": "goal_contribution", "target": 1, "reward_coins": 30},
    {"id": "q_bill", "title": "Brick Breaker", "desc": "Pay a bill", "action": "bill_paid", "target": 1, "reward_coins": 30},
    {"id": "q_learn", "title": "Brain Boost", "desc": "Complete a lesson", "action": "module_complete", "target": 1, "reward_coins": 20},
    {"id": "q_debt", "title": "Boss Attack", "desc": "Make a debt payment", "action": "debt_payment", "target": 1, "reward_coins": 40},
    {"id": "q_save2", "title": "Double Stash", "desc": "Add to your goals twice", "action": "goal_contribution", "target": 2, "reward_coins": 50},
]

def xp_for_level(level: int) -> int:
    """Total XP needed to reach `level` (level 1 = 0 XP). Each level costs 200 more than the last."""
    return 100 * (level - 1) * level


def level_for_xp(xp: int) -> int:
    level = 1
    while xp >= xp_for_level(level + 1):
        level += 1
    return level


def title_for_level(level: int) -> str:
    return TITLES[min(level, len(TITLES)) - 1]


def world_for_level(level: int) -> str:
    return f"{(level - 1) // 4 + 1}-{(level - 1) % 4 + 1}"


def today_key(now: Optional[datetime] = None) -> str:
    return (now or datetime.utcnow()).strftime("%Y-%m-%d")


def quests_for_day(day: str) -> List[Dict]:
    """Check-in is always first; two more rotate daily."""
    others = QUEST_POOL[1:]
    offset = datetime.strptime(day, "%Y-%m-%d").toordinal()
    picks = [others[offset % len(others)], others[(offset + 3) % len(others)]]
    if picks[0]["id"] == picks[1]["id"]:
        picks[1] = others[(offset + 1) % len(others)]
    return [QUEST_POOL[0], *picks]


async def _get_profile(user_id: str) -> Dict:
    profile = await db.game_profiles.find_one({"user_id": user_id})
    if not profile:
        profile = {
            "user_id": user_id,
            "xp": 0,
            "streak": 0,
            "best_streak": 0,
            "last_checkin": None,
            "achievements": [],
            "quests_done": {},  # day -> [quest ids]
            "created_at": datetime.utcnow(),
        }
        await db.game_profiles.insert_one(profile)
    return profile


async def claim_once(key: str, ttl: Optional[timedelta] = None) -> bool:
    """Atomically claim `key`; True for exactly one caller, however many race for it.

    Backed by a unique index on game_claims.key, so check-then-act gaps can't pay a reward twice."""
    doc = {"key": key, "at": datetime.utcnow()}
    if ttl:
        doc["expires_at"] = datetime.utcnow() + ttl
    try:
        await db.game_claims.insert_one(doc)
        return True
    except DuplicateKeyError:
        return False


async def _within_daily_cap(user_id: str, action: str, day: str) -> bool:
    cap = DAILY_CAPS.get(action)
    if cap is None:
        return True
    for slot in range(cap):
        if await claim_once(f"cap:{user_id}:{action}:{day}:{slot}", ttl=timedelta(days=2)):
            return True
    return False


async def _count_today(user_id: str, action: str, day: str) -> int:
    return await db.game_events.count_documents({"user_id": user_id, "action": action, "day": day})


async def _check_achievements(user_id: str, profile: Dict, level: int) -> List[Dict]:
    unlocked = set(profile.get("achievements", []))
    counts = {}
    for action in ("payment_sent", "bill_paid", "goal_contribution", "goal_completed",
                   "boss_defeated", "module_complete", "account_linked"):
        counts[action] = await db.game_events.count_documents({"user_id": user_id, "action": action})
    rules = {
        "first_coin": counts["payment_sent"] >= 1,
        "bill_buster": counts["bill_paid"] >= 3,
        "piggy_hero": counts["goal_contribution"] >= 1,
        "castle_clear": counts["goal_completed"] >= 1,
        "boss_slayer": counts["boss_defeated"] >= 1,
        "scholar": counts["module_complete"] >= 1,
        "warp_master": counts["account_linked"] >= 1,
        "on_fire": profile.get("best_streak", 0) >= 7,
        "level_5": level >= 5,
    }
    new = [a for a in ACHIEVEMENTS if rules.get(a["id"]) and a["id"] not in unlocked]
    if new:
        await db.game_profiles.update_one(
            {"user_id": user_id},
            {"$addToSet": {"achievements": {"$each": [a["id"] for a in new]}}},
        )
    return new


async def award(user_id: str, action: str, bonus_coins: int = 0) -> Dict:
    """Record an action and grant its XP/coins. Returns a reward summary for the UI."""
    if not user_id or action not in ACTIONS:
        return {}
    xp, coins = ACTIONS[action]
    coins += max(0, bonus_coins)
    now = datetime.utcnow()
    day = today_key(now)

    profile = await _get_profile(user_id)
    old_level = level_for_xp(profile.get("xp", 0))

    capped = not await _within_daily_cap(user_id, action, day)
    if capped:
        xp, coins = 0, 0
    await db.game_events.insert_one({
        "user_id": user_id, "action": action, "xp": xp, "coins": coins, "day": day, "timestamp": now,
        **({"capped": True} if capped else {}),
    })

    # Daily quest completion: fires once when the count of paid actions reaches the target.
    # The claim makes sure concurrent requests can't each pay the same quest.
    quests_completed = []
    for quest in [] if capped else quests_for_day(day):
        if quest["action"] != action:
            continue
        paid_today = await db.game_events.count_documents({"user_id": user_id, "action": action, "day": day, "capped": {"$ne": True}})
        if paid_today >= quest["target"] and await claim_once(f"quest:{user_id}:{day}:{quest['id']}"):
            quests_completed.append(quest)
            coins += quest["reward_coins"]
            xp += 20
    if quests_completed:
        await db.game_profiles.update_one(
            {"user_id": user_id},
            {"$addToSet": {f"quests_done.{day}": {"$each": [q["id"] for q in quests_completed]}}},
        )

    await db.game_profiles.update_one({"user_id": user_id}, {"$inc": {"xp": xp}})
    if coins:
        await db.users.update_one({"id": user_id}, {"$inc": {"reward_coins": coins}})

    profile = await _get_profile(user_id)
    total_xp = profile.get("xp", 0)
    level = level_for_xp(total_xp)
    new_achievements = await _check_achievements(user_id, profile, level)

    return {
        "action": action,
        "capped": capped,
        "xp_earned": xp,
        "coins_earned": coins,
        "total_xp": total_xp,
        "level": level,
        "leveled_up": level > old_level,
        "title": title_for_level(level),
        "quests_completed": [{"id": q["id"], "title": q["title"], "reward_coins": q["reward_coins"]} for q in quests_completed],
        "new_achievements": new_achievements,
    }


async def check_in(user_id: str) -> Dict:
    """Once-per-day check-in that maintains the streak. Bonus coins scale with streak."""
    profile = await _get_profile(user_id)
    now = datetime.utcnow()
    day = today_key(now)
    last = profile.get("last_checkin")
    if last == day:
        return {"already_checked_in": True, "streak": profile.get("streak", 0)}

    if not await claim_once(f"checkin:{user_id}:{day}"):
        return {"already_checked_in": True, "streak": profile.get("streak", 0)}

    yesterday = today_key(now - timedelta(days=1))
    streak = profile.get("streak", 0) + 1 if last == yesterday else 1
    best = max(streak, profile.get("best_streak", 0))
    await db.game_profiles.update_one(
        {"user_id": user_id},
        {"$set": {"last_checkin": day, "streak": streak, "best_streak": best}},
    )
    reward = await award(user_id, "daily_checkin", bonus_coins=min(streak, 10) * 2)
    return {"already_checked_in": False, "streak": streak, "reward": reward}


async def get_game_profile(user_id: str) -> Dict:
    profile = await _get_profile(user_id)
    user = await db.users.find_one({"id": user_id}) or {}
    xp = profile.get("xp", 0)
    level = level_for_xp(xp)
    floor, ceiling = xp_for_level(level), xp_for_level(level + 1)
    day = today_key()
    done_today = set(profile.get("quests_done", {}).get(day, []))

    quests = []
    for quest in quests_for_day(day):
        progress = min(await _count_today(user_id, quest["action"], day), quest["target"])
        quests.append({
            **{k: quest[k] for k in ("id", "title", "desc", "target", "reward_coins")},
            "progress": progress,
            "done": quest["id"] in done_today,
        })

    unlocked = set(profile.get("achievements", []))
    return {
        "user_id": user_id,
        "name": user.get("name") or "You",
        "avatar": user.get("avatar", "hero"),
        "coins": user.get("reward_coins", 0),
        "xp": xp,
        "level": level,
        "title": title_for_level(level),
        "world": world_for_level(level),
        "xp_into_level": xp - floor,
        "xp_for_next": ceiling - floor,
        "progress": round((xp - floor) / (ceiling - floor) * 100, 1),
        "streak": profile.get("streak", 0),
        "best_streak": profile.get("best_streak", 0),
        "checked_in_today": profile.get("last_checkin") == day,
        "quests": quests,
        "achievements": [{**a, "unlocked": a["id"] in unlocked} for a in ACHIEVEMENTS],
    }
