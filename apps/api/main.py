from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
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
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.app_url, "http://localhost:3000", "http://localhost:19006"],
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
        # Quick ping to check DB connectivity
        from core.database import supabase
        supabase.table("tenants").select("id").limit(1).execute()
        db_ok = True
    except Exception as e:
        db_ok = False
        db_error = str(e)[:100]

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


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"error": {"code": "INTERNAL_ERROR", "message": str(exc)}}
    )
