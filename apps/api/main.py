import logging
import re

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from postgrest.exceptions import APIError
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from contextlib import asynccontextmanager
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest

from core.config import settings
from routers import (
    auth, hotels, rooms, housekeeping, tasks, work_orders,
    assets, ai_copilot, sop, billing, webhooks,
    integrations, internal, notifications, scheduling,
    guest_requests, logbook, reports, onboarding, staff, lost_found
)

logger = logging.getLogger(__name__)
limiter = Limiter(key_func=get_remote_address)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    print(f"PatelRep API starting in {settings.app_env} mode")
    yield
    # Shutdown
    print("PatelRep API shutting down")


app = FastAPI(
    title="PatelRep API",
    description="AI-powered hotel staff operations platform",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.app_env != "production" else None,
    redoc_url=None,
    redirect_slashes=False,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.app_url,
        "https://app.patelrep.com",
        "https://patelrepweb-production.up.railway.app",
        "https://patelrep-web.vercel.app",
    ],
    allow_origin_regex=r"http://localhost:\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: StarletteRequest, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        if request.url.scheme == "https":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

app.add_middleware(SecurityHeadersMiddleware)


# Health check (no auth required)
@app.get("/health")
async def health():
    db_ok = True
    db_error = None
    try:
        # Quick ping to check DB connectivity (rooms is confirmed accessible)
        from core.database import supabase
        supabase.table("rooms").select("id").limit(1).execute()
        db_ok = True
    except Exception as e:
        db_ok = False
        db_error = str(e)[:300]

    return {
        "status": "ok" if db_ok else "degraded",
        "env": settings.app_env,
        "db": "ok" if db_ok else f"error: {db_error}",
        "version": "1.0.0",
    }


# API v1 prefix
PREFIX = "/v1"

app.include_router(auth.router, prefix=PREFIX)
app.include_router(hotels.router, prefix=PREFIX)
app.include_router(rooms.router, prefix=PREFIX)
app.include_router(housekeeping.router, prefix=PREFIX)
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
app.include_router(reports.router, prefix=PREFIX)
app.include_router(onboarding.router, prefix=PREFIX)
app.include_router(staff.router, prefix=PREFIX)
app.include_router(lost_found.router, prefix=PREFIX)


def _cors_headers_for(request: Request) -> dict[str, str]:
    origin = request.headers.get("origin", "")
    allowed = [
        settings.app_url,
        "https://patelrepweb-production.up.railway.app",
        "https://patelrep-web.vercel.app",
    ]
    if origin in allowed or re.match(r"http://localhost:\d+$", origin):
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
        }
    return {}


@app.exception_handler(APIError)
async def postgrest_exception_handler(request: Request, exc: APIError):
    code = getattr(exc, "code", None) or "DATABASE_ERROR"
    message = getattr(exc, "message", "") or ""
    status_code = 422 if code == "PGRST204" or "schema cache" in message.lower() else 400
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
