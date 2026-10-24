"""Sliding-window rate limits stored in the database (shared by all API instances)."""
from datetime import datetime, timedelta

from fastapi import HTTPException, Request

from .db import db


async def limit(key: str, max_hits: int, window_seconds: int) -> None:
    """Record a hit for `key`; raise 429 once more than `max_hits` happen within the window.

    The hit is written before counting, so a burst of parallel requests can't all read a low
    count and slip through together: every request sees the others' hits."""
    now = datetime.utcnow()
    since = now - timedelta(seconds=window_seconds)
    await db.rate_limits.insert_one({"key": key, "at": now, "expires_at": now + timedelta(seconds=window_seconds)})
    recent = await db.rate_limits.count_documents({"key": key, "at": {"$gte": since}})
    if recent > max_hits:
        oldest = await db.rate_limits.find_one({"key": key, "at": {"$gte": since}}, sort=[("at", 1)])
        retry = int(window_seconds - (now - oldest["at"]).total_seconds()) + 1 if oldest else window_seconds
        minutes = max(1, round(retry / 60))
        raise HTTPException(
            status_code=429,
            detail=f"Too many attempts. Try again in {minutes} minute{'s' if minutes != 1 else ''}.",
            headers={"Retry-After": str(retry)},
        )


def client_ip(request: Request) -> str:
    """The caller's address. Never read X-Forwarded-For here: the client controls it.

    Behind the proxy, uvicorn's --proxy-headers already replaces request.client with the address
    nginx saw, and only for connections from --forwarded-allow-ips (see backend/Dockerfile)."""
    return request.client.host if request.client else "unknown"
