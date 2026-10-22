from datetime import datetime, timedelta, timezone

from bson import ObjectId


def serialize_doc(doc):
    """Convert MongoDB document(s) to JSON-serializable dicts."""
    if doc is None:
        return None
    if isinstance(doc, list):
        return [serialize_doc(d) for d in doc]
    if isinstance(doc, dict):
        result = {}
        for key, value in doc.items():
            if key == "_id":
                continue
            if isinstance(value, ObjectId):
                result[key] = str(value)
            elif isinstance(value, datetime):
                result[key] = value.isoformat()
            elif isinstance(value, dict):
                result[key] = serialize_doc(value)
            elif isinstance(value, list):
                result[key] = [serialize_doc(v) if isinstance(v, dict) else v for v in value]
            else:
                result[key] = value
        return result
    return doc


# Indian Standard Time has no daylight saving, so a fixed offset is exact.
IST = timezone(timedelta(hours=5, minutes=30), "IST")
IST_OFFSET = timedelta(hours=5, minutes=30)


def to_ist(utc_naive: datetime) -> datetime:
    """A stored naive-UTC timestamp as naive IST wall-clock time."""
    return utc_naive + IST_OFFSET


def ist_day_start_utc(now: datetime | None = None) -> datetime:
    """Naive UTC instant of the most recent IST midnight: when "today" began for our users."""
    local = to_ist(now or datetime.utcnow())
    return local.replace(hour=0, minute=0, second=0, microsecond=0) - IST_OFFSET


def ist_month_start_utc(now: datetime | None = None) -> datetime:
    local = to_ist(now or datetime.utcnow())
    return local.replace(day=1, hour=0, minute=0, second=0, microsecond=0) - IST_OFFSET


def months_ago_label(n: int, now: datetime | None = None) -> str:
    """'Sep 2026'-style label for the month n months before now."""
    now = now or datetime.utcnow()
    year, month = now.year, now.month - n
    while month <= 0:
        month += 12
        year -= 1
    return datetime(year, month, 1).strftime("%b %Y")
