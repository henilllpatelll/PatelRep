import logging
from typing import Any

import httpx
from fastapi import APIRouter, Depends, Query

from core.config import settings
from core.database import supabase
from middleware.auth import CurrentUser, get_current_user, require_role
from models.requests import CreateFeedbackRequest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/feedback", tags=["feedback"])


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


@router.post("")
async def submit_feedback(
    request: CreateFeedbackRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
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
        "client_context": request.client_context,
        "notification_status": "pending",
    }

    result = supabase.table("feedback_submissions").insert(payload).execute()
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

    safe_row = dict(row)
    if safe_row.get("notification_error"):
        safe_row["notification_error"] = "Notification failed"
    return {"data": safe_row}


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
