import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import UUID4

from core.config import settings
from core.database import supabase
from middleware.auth import CurrentUser, get_current_user, require_role
from models.requests import CreateFeedbackRequest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/feedback", tags=["feedback"])

# Mobile reports may carry technical diagnostics, but only these fields, as short plain values. Anything else
# the client sends (tokens, payloads, guest data) is dropped here no matter what the app attached.
MOBILE_DIAGNOSTIC_KEYS = (
    "app_version",
    "build",
    "platform",
    "os_version",
    "role",
    "language",
    "online",
    "last_synced_at",
    "pending_changes",
    "failed_changes",
    "sync_status",
    "source_screen",
)
# Per person, across every source: a client can label a report "web" or "mobile" however it likes, so the
# cap must not depend on the label.
MOBILE_REPORTS_PER_HOUR = 10
OWN_REPORT_COLUMNS = "id, category, area, severity, message, status, source, created_at, updated_at"


def _allowlisted_context(context: dict[str, Any]) -> dict[str, Any]:
    clean: dict[str, Any] = {}
    for key in MOBILE_DIAGNOSTIC_KEYS:
        value = context.get(key)
        if isinstance(value, bool) or value is None:
            if value is not None:
                clean[key] = value
        elif isinstance(value, (int, float)):
            clean[key] = value
        elif isinstance(value, str):
            clean[key] = value[:80]
    return clean


def _is_mobile_report(request: CreateFeedbackRequest) -> bool:
    """Mobile diagnostics rules apply to anything that declares itself mobile OR carries a mobile-only field.

    `source` is client-supplied, so it can only ADD protections, never remove them: a report that sets the mobile
    area / retry id, or any allow-listed diagnostic key (the browser form never sends these), is treated as mobile
    and stored as such even when it says source="web".
    """
    return (
        request.source == "mobile"
        or request.area is not None
        or request.client_request_id is not None
        or any(key in request.client_context for key in MOBILE_DIAGNOSTIC_KEYS)
    )


def _feedback_summary(row: dict[str, Any]) -> str:
    page = row.get("pathname") or row.get("page_url") or "unknown page"
    return f"{row.get('severity', 'feedback')} {row.get('category', 'feedback')} on {page}"


async def _send_feedback_webhook(row: dict[str, Any]) -> tuple[str, str | None]:
    if not settings.feedback_webhook_url:
        return "not_configured", None

    payload = {
        "text": "New PatelRep feedback",
        "feedback_id": row.get("id"),
        "hotel_id": row.get("tenant_id"),
        "user_id": row.get("user_id"),
        "role": row.get("user_role"),
        "category": row.get("category"),
        "severity": row.get("severity"),
        "message": row.get("message"),
        "page": row.get("pathname") or row.get("page_url"),
        "created_at": row.get("created_at"),
    }
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.post(settings.feedback_webhook_url, json=payload)
            response.raise_for_status()
        return "sent", None
    except Exception as exc:
        logger.warning("Feedback webhook failed for id=%s: %s", row.get("id"), exc)
        return "failed", "Webhook notification failed"


def _notify_gms(row: dict[str, Any]) -> None:
    gm_rows = (
        supabase.table("user_roles")
        .select("user_id")
        .eq("tenant_id", row["tenant_id"])
        .eq("role", "gm")
        .execute()
    )
    notifications = [
        {
            "tenant_id": row["tenant_id"],
            "user_id": gm["user_id"],
            "type": "feedback_submitted",
            "title": "New staff feedback",
            "body": _feedback_summary(row),
            "data": {
                "feedback_id": row["id"],
                "category": row["category"],
                "severity": row["severity"],
                "pathname": row.get("pathname"),
            },
        }
        for gm in (gm_rows.data or [])
        if gm.get("user_id")
    ]
    if notifications:
        supabase.table("notifications").insert(notifications).execute()


def _safe_row(row: dict[str, Any]) -> dict[str, Any]:
    safe_row = dict(row)
    if safe_row.get("notification_error"):
        safe_row["notification_error"] = "Notification failed"
    return safe_row


def _existing_by_request_id(current_user: CurrentUser, client_request_id: str) -> dict[str, Any] | None:
    found = (
        supabase.table("feedback_submissions")
        .select("*")
        .eq("tenant_id", current_user.hotel_id)
        .eq("user_id", current_user.user_id)
        .eq("client_request_id", client_request_id)
        .execute()
    )
    return (found.data or [None])[0]


def _enforce_report_cap(current_user: CurrentUser) -> None:
    since = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    recent = (
        supabase.table("feedback_submissions")
        .select("id")
        .eq("tenant_id", current_user.hotel_id)
        .eq("user_id", current_user.user_id)
        .gte("created_at", since)
        .execute()
    )
    if len(recent.data or []) >= MOBILE_REPORTS_PER_HOUR:
        raise HTTPException(status_code=429, detail="Too many reports in the last hour. Please try again later.")


@router.post("")
async def submit_feedback(
    request: CreateFeedbackRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    is_mobile = _is_mobile_report(request)
    if request.client_request_id:
        # A retry of a report the server already accepted returns that report instead of filing another.
        existing = _existing_by_request_id(current_user, str(request.client_request_id))
        if existing:
            return {"data": _safe_row(existing), "meta": {"replayed": True}}
    _enforce_report_cap(current_user)

    payload = {
        "tenant_id": current_user.hotel_id,
        "user_id": current_user.user_id,
        "user_role": current_user.role,
        "category": request.category,
        "severity": request.severity,
        "message": request.message,
        "page_url": request.page_url,
        "pathname": request.pathname,
        "user_agent": request.user_agent,
        "browser_language": request.browser_language,
        "viewport_width": request.viewport_width,
        "viewport_height": request.viewport_height,
        "client_context": _allowlisted_context(request.client_context) if is_mobile else request.client_context,
        "notification_status": "pending",
    }
    if is_mobile:
        payload["source"] = "mobile"
        payload["area"] = request.area
        payload["client_request_id"] = str(request.client_request_id) if request.client_request_id else None

    try:
        result = supabase.table("feedback_submissions").insert(payload).execute()
    except Exception:
        # Two retries racing: the unique index kept one; hand back that one.
        existing = _existing_by_request_id(current_user, str(request.client_request_id)) if request.client_request_id else None
        if existing:
            return {"data": _safe_row(existing), "meta": {"replayed": True}}
        raise
    row = result.data[0]

    try:
        _notify_gms(row)
    except Exception:
        logger.warning("Failed to create GM feedback notification for id=%s", row.get("id"))

    notification_status, notification_error = await _send_feedback_webhook(row)
    if notification_status != "pending":
        update_payload = {"notification_status": notification_status}
        if notification_error:
            update_payload["notification_error"] = notification_error
        updated = (
            supabase.table("feedback_submissions")
            .update(update_payload)
            .eq("id", row["id"])
            .eq("tenant_id", current_user.hotel_id)
            .execute()
        )
        if updated.data:
            row = updated.data[0]

    return {"data": _safe_row(row)}


@router.get("/mine")
async def list_my_feedback(
    limit: int = Query(30, ge=1, le=100),
    current_user: CurrentUser = Depends(get_current_user),
):
    """The signed-in person's own reports, newest first. Never another person's, never another hotel's."""
    result = (
        supabase.table("feedback_submissions")
        .select(OWN_REPORT_COLUMNS)
        .eq("tenant_id", current_user.hotel_id)
        .eq("user_id", current_user.user_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return {"data": result.data or [], "meta": {"limit": limit}}


@router.get("/mine/{feedback_id}")
async def get_my_feedback(
    feedback_id: UUID4,
    current_user: CurrentUser = Depends(get_current_user),
):
    result = (
        supabase.table("feedback_submissions")
        .select(OWN_REPORT_COLUMNS)
        .eq("id", str(feedback_id))
        .eq("tenant_id", current_user.hotel_id)
        .eq("user_id", current_user.user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Report not found")
    return {"data": result.data[0]}


@router.get("")
async def list_feedback(
    limit: int = Query(50, ge=1, le=200),
    current_user: CurrentUser = Depends(require_role("gm")),
):
    result = (
        supabase.table("feedback_submissions")
        .select("*")
        .eq("tenant_id", current_user.hotel_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return {"data": result.data or []}
