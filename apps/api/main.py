import logging
import re
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from postgrest.exceptions import APIError
from contextlib import asynccontextmanager
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest

from core.config import settings
from middleware.rate_limit import RateLimitMiddleware, RateLimitRule
from routers import (
    auth,
    hotels,
    rooms,
    housekeeping,
    cleaning_checklists,
    clean_sessions,
    shifts,
    tasks,
    work_orders,
    assets,
    ai_copilot,
    sop,
    billing,
    webhooks,
    integrations,
    internal,
    notifications,
    scheduling,
    guest_requests,
    logbook,
    management_roi,
    reports,
    onboarding,
    staff,
    lost_found,
    feedback,
    late_checkout,
    evidence,
    safety,
    programs,
)

logger = logging.getLogger(__name__)

_ALLOWED_ORIGINS = [
    settings.app_url,
    "https://app.patelrep.com",
    "https://patelrep-production.up.railway.app",
    "https://patelrep-web.vercel.app",
]
_ALLOWED_METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"]
_ALLOWED_HEADERS = ["Authorization", "Content-Type", "Accept", "X-Requested-With"]
_EXPOSE_HEADERS = [
    "X-RateLimit-Limit",
    "X-RateLimit-Remaining",
    "X-RateLimit-Reset",
    "Retry-After",
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("PatelRep API starting in %s mode", settings.app_env)

    from core.scheduler import build_scheduler, should_run_scheduler, CRON_SCHEDULE

    scheduler = None
    if should_run_scheduler():
        scheduler = build_scheduler()
        scheduler.start()
        logger.info("In-process cron scheduler started (%d jobs)", len(CRON_SCHEDULE))

    yield

    if scheduler is not None:
        scheduler.shutdown(wait=False)
        logger.info("Cron scheduler stopped")

    from core.database import close_supabase

    close_supabase()
    logger.info("PatelRep API shutting down")


app = FastAPI(
    title="PatelRep API",
    description="AI-powered hotel staff operations platform",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.app_env != "production" else None,
    redoc_url=None,
    redirect_slashes=False,
)

# Middleware pipeline — Starlette adds in LIFO: last add_middleware = outermost = first on request.
# Execution order on request: SecurityHeaders → RateLimit → CORS → App
# Execution order on response: App → CORS → RateLimit → SecurityHeaders

# 1. CORS (innermost — handles preflight and sets Access-Control-* headers)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=True,
    allow_methods=_ALLOWED_METHODS,
    allow_headers=_ALLOWED_HEADERS,
    expose_headers=_EXPOSE_HEADERS,
    max_age=600,
)

# 2. Rate limiting (middle — applied after CORS preflight is resolved)
app.add_middleware(
    RateLimitMiddleware,
    enabled=settings.api_rate_limit_enabled,
    default_rule=RateLimitRule(settings.api_rate_limit_default_per_minute, 60),
    anonymous_rule=RateLimitRule(settings.api_rate_limit_anonymous_per_minute, 60),
    per_ip_authenticated_rule=RateLimitRule(
        settings.api_rate_limit_authenticated_ip_per_minute, 60
    ),
    ai_rule=RateLimitRule(settings.api_rate_limit_ai_per_minute, 60),
    auth_rule=RateLimitRule(settings.api_rate_limit_auth_per_minute, 60),
    webhook_rule=RateLimitRule(settings.api_rate_limit_webhook_per_minute, 60),
    health_rule=RateLimitRule(settings.api_rate_limit_health_per_minute, 60),
)

# 3. Security headers (outermost — applied to every response regardless of outcome)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: StarletteRequest, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = (
            "camera=(), microphone=(), geolocation=()"
        )
        response.headers["X-Permitted-Cross-Domain-Policies"] = "none"
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        forwarded_proto = request.headers.get("x-forwarded-proto", "")
        if (
            request.url.scheme == "https"
            or forwarded_proto.split(",", 1)[0].strip() == "https"
        ):
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return response


app.add_middleware(SecurityHeadersMiddleware)


# Per-job cron staleness tolerance in minutes. A single flat threshold wrongly
# reported daily/monthly jobs as "stale" ~23h/day even when they ran exactly on
# schedule; each job is only stale once it is past its own cadence + slack for
# GitHub Actions scheduled-run delivery lag.
CRON_TOLERANCE_MINUTES = {
    # Frequent group (*/30) — 30-min cadence + slack.
    "predictions.run": 65,
    "opera.sync-reservations": 65,
    "escalations.check": 65,
    # Shift summaries (0 7,15,23) — up to 8h between runs + slack.
    "logbook.shift-summary": 600,
    # Daily jobs (0 6 / 0 0 / 0 3) — 24h cadence + generous delivery slack.
    "pm.check-due": 1560,
    "reports.daily-summary-email": 1560,
    "evidence.reminders": 1560,
    "safety.training-assignments": 1560,
    "safety.drill-follow-up": 1560,
    "lost-found.retention-check": 1560,
    "ai.failure-predictions": 1560,
    # Month-end billing (0 0 28-31) — up to ~1 month between runs.
    "billing.monthly-trueup": 46080,
}
DEFAULT_CRON_TOLERANCE_MINUTES = 1560


def _cron_status(job_name: str, last_success_at: str | None, now: datetime) -> str:
    """Health status for one cron job: 'pending' (never run), 'ok', or 'stale'.

    Staleness is judged against the job's own cadence (CRON_TOLERANCE_MINUTES),
    not one flat threshold, so once-a-day and once-a-month jobs are not reported
    stale in the long gaps between their scheduled runs.
    """
    if not last_success_at:
        return "pending"
    tolerance = CRON_TOLERANCE_MINUTES.get(job_name, DEFAULT_CRON_TOLERANCE_MINUTES)
    threshold = (now - timedelta(minutes=tolerance)).isoformat()
    return "ok" if last_success_at > threshold else "stale"


# Health check (no auth required)
@app.get("/health")
async def health():
    from core.database import supabase

    db_ok = True
    try:
        supabase.table("rooms").select("id").limit(1).execute()
    except Exception as e:
        db_ok = False
        logger.warning("Health database ping failed: %s", e)

    # Cron staleness: each job is judged against its own cadence (see
    # CRON_TOLERANCE_MINUTES), so daily/monthly jobs are not flagged stale in the
    # normal gaps between scheduled runs. "pending" = seeded but never run yet.
    cron_payload: dict = {}
    try:
        rows = supabase.table("cron_health").select("job_name, last_success_at").execute()
        now = datetime.now(timezone.utc)
        for row in (rows.data or []):
            cron_payload[row["job_name"]] = _cron_status(
                row["job_name"], row.get("last_success_at"), now
            )
    except Exception as e:
        logger.warning("Health cron_health query failed: %s", e)
        cron_payload = {"error": "unavailable"}

    # Notification delivery: timestamp of last successful in-app delivery.
    notif_payload: dict = {}
    try:
        notif = supabase.table("notification_deliveries") \
            .select("created_at") \
            .eq("status", "delivered") \
            .order("created_at", desc=True) \
            .limit(1) \
            .execute()
        notif_payload["last_delivery"] = (notif.data[0]["created_at"] if notif.data else None)
    except Exception as e:
        logger.warning("Health notification_deliveries query failed: %s", e)
        notif_payload = {"error": "unavailable"}

    # PMS sync: last successful Opera reservation sync.
    pms_payload: dict = {}
    try:
        pms_row = supabase.table("cron_health") \
            .select("last_success_at") \
            .eq("job_name", "opera.sync-reservations") \
            .maybe_single() \
            .execute()
        pms_data = pms_row.data if pms_row else None
        pms_payload["last_sync"] = (pms_data or {}).get("last_success_at")
    except Exception as e:
        logger.warning("Health pms_sync query failed: %s", e)
        pms_payload = {"error": "unavailable"}

    payload = {
        "status": "ok" if db_ok else "degraded",
        "env": settings.app_env,
        "db": "ok" if db_ok else "unavailable",
        "version": "1.0.0",
        "cron": cron_payload,
        "notifications": notif_payload,
        "pms_sync": pms_payload,
    }
    return JSONResponse(
        status_code=200 if db_ok else 503,
        content=payload,
        headers={"Cache-Control": "no-store"},
    )


# API v1 prefix
PREFIX = "/v1"

app.include_router(auth.router, prefix=PREFIX)
app.include_router(hotels.router, prefix=PREFIX)
app.include_router(rooms.router, prefix=PREFIX)
app.include_router(housekeeping.router, prefix=PREFIX)
app.include_router(cleaning_checklists.router, prefix=PREFIX)
app.include_router(clean_sessions.router, prefix=PREFIX)
app.include_router(shifts.router, prefix=PREFIX)
app.include_router(tasks.router, prefix=PREFIX)
app.include_router(work_orders.router, prefix=PREFIX)
app.include_router(assets.router, prefix=PREFIX)
app.include_router(ai_copilot.router, prefix=PREFIX)
app.include_router(sop.router, prefix=PREFIX)
app.include_router(billing.router, prefix=PREFIX)
app.include_router(webhooks.router, prefix=PREFIX)
app.include_router(integrations.router, prefix=PREFIX)
app.include_router(internal.router, prefix=PREFIX)
app.include_router(notifications.router, prefix=PREFIX)
app.include_router(scheduling.router, prefix=PREFIX)
app.include_router(guest_requests.router, prefix=PREFIX)
app.include_router(logbook.router, prefix=PREFIX)
app.include_router(management_roi.router, prefix=PREFIX)
app.include_router(reports.router, prefix=PREFIX)
app.include_router(onboarding.router, prefix=PREFIX)
app.include_router(staff.router, prefix=PREFIX)
app.include_router(lost_found.router, prefix=PREFIX)
app.include_router(feedback.router, prefix=PREFIX)
app.include_router(late_checkout.router, prefix=PREFIX)
app.include_router(evidence.router, prefix=PREFIX)
app.include_router(safety.router, prefix=PREFIX)
app.include_router(programs.router, prefix=PREFIX)


def _cors_headers_for(request: Request) -> dict[str, str]:
    """CORS headers for exception handlers, which bypass middleware."""
    origin = request.headers.get("origin", "")
    if origin in _ALLOWED_ORIGINS or re.match(
        r"http://(localhost|127\.0\.0\.1):\d+$", origin
    ):
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Methods": ",".join(_ALLOWED_METHODS),
            "Access-Control-Allow-Headers": ",".join(_ALLOWED_HEADERS),
            "Access-Control-Expose-Headers": ",".join(_EXPOSE_HEADERS),
            "Vary": "Origin",
        }
    return {}


@app.exception_handler(APIError)
async def postgrest_exception_handler(request: Request, exc: APIError):
    code = getattr(exc, "code", None) or "DATABASE_ERROR"
    message = getattr(exc, "message", "") or ""
    status_code = (
        422 if code == "PGRST204" or "schema cache" in message.lower() else 400
    )
    safe_message = (
        "One or more fields are not supported by this endpoint."
        if status_code == 422
        else "Database request failed. Please check the request and try again."
    )
    logger.warning("PostgREST request failed: code=%s path=%s", code, request.url.path)
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": safe_message}},
        headers=_cors_headers_for(request),
    )


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled API error on %s", request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "Unexpected server error. Please try again.",
            }
        },
        headers=_cors_headers_for(request),
    )
