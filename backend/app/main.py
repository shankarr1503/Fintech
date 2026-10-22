import logging
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware

from .auth import require_user
from .config import settings
from .db import client, db
from .services import audit
from .routers import (
    aa,
    admin,
    accounts,
    analytics,
    auth,
    bills,
    credit,
    dashboard,
    debts,
    game,
    kyc,
    learn,
    loans,
    notifications,
    rewards,
    savings,
    security,
    transactions,
    upi,
    users,
    webhooks,
)

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Expire rate-limit hits and revoked tokens automatically (TTL indexes on real MongoDB).
    await db.rate_limits.create_index("expires_at", expireAfterSeconds=0)
    await db.rate_limits.create_index([("key", 1), ("at", 1)])
    await db.sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.sessions.create_index("sid", unique=True)
    await db.users.create_index("phone", unique=True)
    await db.otp_codes.create_index("phone", unique=True)
    await db.otp_codes.create_index("expires_at", expireAfterSeconds=0)
    await db.audit_logs.create_index("seq", unique=True)
    await db.idempotency.create_index([("user_id", 1), ("key", 1)], unique=True)
    await db.idempotency.create_index("expires_at", expireAfterSeconds=0)
    await db.webhook_events.create_index("event_id", unique=True)
    await db.game_claims.create_index("key", unique=True)
    await db.payment_locks.create_index("user_id", unique=True)
    await db.payment_locks.create_index("expires_at", expireAfterSeconds=0)
    await db.game_claims.create_index("expires_at", expireAfterSeconds=0)
    await db.upi_transactions.create_index([("user_id", 1), ("timestamp", -1)])
    await db.upi_transactions.create_index("rail_ref")
    await db.audit_logs.create_index([("user_id", 1), ("seq", -1)])
    yield
    client.close()


app = FastAPI(title=settings.app_name, version="2.0.0", lifespan=lifespan)

api = APIRouter(prefix="/api")


@api.get("/")
async def root():
    return {"message": settings.app_name, "version": "2.0.0"}


@api.get("/app-config")
async def app_config():
    """Public flags the app needs before sign-in."""
    from .routers.auth import TERMS_VERSION

    return {"demo_mode": settings.demo_mode, "terms_version": TERMS_VERSION}


@api.api_route("/health", methods=["GET", "HEAD"])
async def health_check():
    return {"status": "healthy", "timestamp": datetime.utcnow()}


# Public: sign-in plus static catalogue content.
api.include_router(auth.router)
api.include_router(learn.public_router)
api.include_router(security.public_router)
api.include_router(admin.router)
api.include_router(webhooks.router)
api.include_router(notifications.public_router)

# Everything else needs a session token and may only touch the caller's own data.
for module in (
    users, transactions, analytics, debts, savings, dashboard, credit, rewards,
    bills, learn, aa, security, upi, loans, accounts, game, notifications, kyc,
):
    api.include_router(module.router, dependencies=[Depends(require_user)])

app.include_router(api)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    """HTTPS-only in production, plus defensive headers on every response."""
    if settings.require_https and request.url.path.startswith("/api/"):
        proto = request.headers.get("x-forwarded-proto", request.url.scheme)
        if proto != "https":
            return JSONResponse({"detail": "HTTPS is required"}, status_code=403)
    response = await call_next(request)
    response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"  # account data must not sit in shared caches
        csp = "default-src 'none'; frame-ancestors 'none'"
        if response.headers.get("content-type", "").startswith("text/html"):
            csp += "; style-src 'unsafe-inline'; form-action 'self'"  # the few server-rendered pages (unsubscribe)
        response.headers["Content-Security-Policy"] = csp
    return response


@app.middleware("http")
async def audit_every_change(request: Request, call_next):
    """Append every state-changing API call to the audit trail (route, outcome, caller; never the body)."""
    response = await call_next(request)
    if request.method in ("POST", "PUT", "PATCH", "DELETE") and request.url.path.startswith("/api/"):
        route = request.scope.get("route")
        try:
            await audit.record(
                f"api:{request.method} {getattr(route, 'path', request.url.path)}",
                getattr(request.state, "user_id", None),
                {"status": response.status_code},
                request,
            )
        except Exception:  # auditing must never take the API down; failures are logged
            logging.getLogger("audit").exception("Failed to write audit entry")
    return response

app.add_middleware(
    CORSMiddleware,
    allow_credentials=settings.cors_origins != ["*"],
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)
