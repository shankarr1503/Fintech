"""Runtime configuration, read once from the environment (or backend/.env)."""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def _bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


class Settings:
    app_name: str = "CoinQuest API"
    # Leave MONGO_URL empty to run against an in-memory database (great for demos/tests).
    mongo_url: str = os.environ.get("MONGO_URL", "")
    db_name: str = os.environ.get("DB_NAME", "coinquest")
    # AI is optional: without a key, insights fall back to the rule engine.
    openai_api_key: str = os.environ.get("OPENAI_API_KEY", "")
    openai_base_url: str = os.environ.get("OPENAI_BASE_URL", "")
    openai_model: str = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
    # Signs session tokens. Set a long random value in production.
    secret_key: str = os.environ.get("SECRET_KEY", "")
    # Enables /api/admin endpoints (audit verification, AML review). Leave empty to disable.
    admin_api_key: str = os.environ.get("ADMIN_API_KEY", "")
    # Abuse limit for OTP requests from one IP address per hour.
    otp_sends_per_ip_hour: int = int(os.environ.get("OTP_SENDS_PER_IP_HOUR", "20"))
    otp_verifies_per_ip_10min: int = int(os.environ.get("OTP_VERIFIES_PER_IP_10MIN", "30"))
    # AES-256 key (base64, 32 bytes) for encrypting identity fields. Required when DEMO_MODE is off.
    field_encryption_key: str = os.environ.get("FIELD_ENCRYPTION_KEY", "")
    # Shared secret the payment provider uses to sign webhooks.
    webhook_secret: str = os.environ.get("WEBHOOK_SECRET", "")
    # Reject plain-HTTP API calls (TLS terminates at the proxy, which sets X-Forwarded-Proto).
    require_https: bool = _bool("REQUIRE_HTTPS", not _bool("DEMO_MODE", False))
    # Sign out after this many minutes without any API activity.
    idle_timeout_minutes: int = int(os.environ.get("IDLE_TIMEOUT_MINUTES", "15"))
    # Send push notifications through Expo (needs outbound internet).
    push_enabled: bool = _bool("PUSH_ENABLED", False)
    # Public base URL of this API, used to build links in emails (e.g. unsubscribe).
    public_api_url: str = os.environ.get("PUBLIC_API_URL", "http://localhost:8001").rstrip("/")
    # Demo mode echoes the OTP back to the client instead of sending an SMS. Off unless asked for,
    # so a deployment that forgets the variable fails closed instead of handing out OTPs.
    demo_mode: bool = _bool("DEMO_MODE", False)
    cors_origins: list[str] = [
        o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()
    ]


def production_problems(s: "Settings") -> list[str]:
    """Settings a real (non-demo) deployment can't run safely without."""
    if s.demo_mode:
        return []
    problems = []
    if len(s.secret_key) < 32:
        problems.append("SECRET_KEY must be set to a random value of at least 32 characters")
    if not s.field_encryption_key:
        problems.append("FIELD_ENCRYPTION_KEY must be set")
    if not s.mongo_url:
        problems.append("MONGO_URL must be set (the in-memory database is for demos and tests only)")
    if not s.webhook_secret:
        problems.append("WEBHOOK_SECRET must be set")
    return problems


settings = Settings()

_problems = production_problems(settings)
if _problems:
    raise RuntimeError(
        "Refusing to start with DEMO_MODE off: " + "; ".join(_problems)
        + ". For a local demo, set DEMO_MODE=true (see backend/.env.example)."
    )
