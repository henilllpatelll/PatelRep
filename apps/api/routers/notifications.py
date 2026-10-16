from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from middleware.auth import get_current_user, require_role, CurrentUser
from core.database import supabase
from models.requests import SetNotificationPreferenceRequest
from services.notify import CATEGORIES, categories_for_roles, critical_category_keys, roles_in_play

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _caller_roles(current_user: CurrentUser) -> set[str]:
    """Roles the caller acts in today (JWT role, active role rows and any schedule override). Decided on the
    server for every request; a stored preference never widens it."""
    return {current_user.role} | roles_in_play(current_user.hotel_id, [current_user.user_id]).get(current_user.user_id, set())


@router.get("/preferences")
async def get_notification_preferences(current_user: CurrentUser = Depends(get_current_user)):
    """The push categories relevant to the caller's current role(s), with their saved on/off state (a
    category with no saved row is on). Opt-outs saved under an earlier role are kept but not listed."""
    visible = categories_for_roles(_caller_roles(current_user))
    critical = critical_category_keys()
    saved = (
        supabase.table("notification_preferences")
        .select("category, enabled")
        .eq("tenant_id", current_user.hotel_id)
        .eq("user_id", current_user.user_id)
        .execute()
        .data
        or []
    )
    enabled_by_key = {row["category"]: bool(row["enabled"]) for row in saved}
    return {
        "data": {
            "categories": [
                {"key": c.key, "enabled": enabled_by_key.get(c.key, True), "has_critical": c.key in critical}
                for c in visible
            ]
        }
    }


@router.put("/preferences/{category}")
async def set_notification_preference(
    category: str,
    body: SetNotificationPreferenceRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Save one on/off preference for the caller. The person comes from the JWT only; an unknown category is
    a 404 and a category that is not relevant to the caller's role is a 403. Idempotent."""
    definition = CATEGORIES.get(category)
    if definition is None:
        raise HTTPException(status_code=404, detail="Unknown notification category")
    if not (_caller_roles(current_user) & set(definition.roles)):
        raise HTTPException(status_code=403, detail="This notification category does not apply to your role")
    now = datetime.now(timezone.utc).isoformat()
    supabase.table("notification_preferences").upsert(
        {
            "tenant_id": current_user.hotel_id,
            "user_id": current_user.user_id,
            "category": category,
            "enabled": body.enabled,
            "updated_at": now,
        },
        on_conflict="tenant_id,user_id,category",
    ).execute()
    return {"data": {"key": category, "enabled": body.enabled}}


@router.get("/unread-count")
async def unread_count(current_user: CurrentUser = Depends(get_current_user)):
    """Exact number of unread inbox rows for the caller (the list endpoint is capped, so counting its rows
    undercounts past the cap)."""
    result = (
        supabase.table("notifications")
        .select("id", count="exact")
        .eq("tenant_id", current_user.hotel_id)
        .eq("user_id", current_user.user_id)
        .eq("is_read", False)
        .limit(1)
        .execute()
    )
    return {"data": {"count": int(result.count or 0)}}


@router.get("")
async def list_notifications(
    is_read: bool = Query(False),
    limit: int = Query(20),
    current_user: CurrentUser = Depends(get_current_user)
):
    query = supabase.table("notifications")\
        .select("*")\
        .eq("tenant_id", current_user.hotel_id)\
        .eq("user_id", current_user.user_id)\
        .order("created_at", desc=True)\
        .limit(limit)

    if not is_read:
        query = query.eq("is_read", False)

    result = query.execute()
    return {"data": result.data}


@router.patch("/{notification_id}/read")
async def mark_read(notification_id: str, current_user: CurrentUser = Depends(get_current_user)):
    supabase.table("notifications")\
        .update({"is_read": True})\
        .eq("id", notification_id)\
        .eq("user_id", current_user.user_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()
    return {"data": {"success": True}}


@router.post("/mark-all-read")
async def mark_all_read(current_user: CurrentUser = Depends(get_current_user)):
    supabase.table("notifications")\
        .update({"is_read": True})\
        .eq("user_id", current_user.user_id)\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()
    return {"data": {"success": True}}


MAX_MESSAGE_CHARS = 1000
_HOUSEKEEPING_ROLES = {"housekeeper", "housekeeping_supervisor"}
_ALL_ROLES = _HOUSEKEEPING_ROLES | {"engineer", "chief_engineer", "front_desk", "gm"}


def _clean_message(raw) -> str:
    message = raw.strip() if isinstance(raw, str) else ""
    if not message:
        raise HTTPException(status_code=422, detail="message is required")
    if len(message) > MAX_MESSAGE_CHARS:
        raise HTTPException(status_code=422, detail=f"message must be {MAX_MESSAGE_CHARS} characters or fewer")
    return message


# A housekeeping supervisor reaches housekeeping accounts only; a GM or an engineer reaches any role.
_REACHABLE_ROLES = {"gm": _ALL_ROLES, "engineer": _ALL_ROLES, "housekeeping_supervisor": _HOUSEKEEPING_ROLES}


def _allowed_roles(current_user: CurrentUser) -> set[str]:
    return set(_REACHABLE_ROLES.get(current_user.role, _HOUSEKEEPING_ROLES))


@router.post("/broadcast")
async def broadcast_message(
    body: dict = Body(...),
    current_user: CurrentUser = Depends(
        require_role("gm", "housekeeping_supervisor")
    ),
):
    """Add a message to the inbox of every active account holding one of `roles` on this property.

    `roles` defaults to housekeepers and housekeeping supervisors. It is validated against the roles the
    caller may reach. This writes inbox rows only: it says nothing about who is clocked in, and nothing
    about whether anyone has read it or received a push."""
    message = _clean_message(body.get("message"))
    requested = body.get("roles")
    if requested is None:
        requested = ["housekeeper", "housekeeping_supervisor"]
    if (
        not isinstance(requested, list)
        or not requested
        or not all(isinstance(role, str) for role in requested)
    ):
        raise HTTPException(status_code=422, detail="roles must be a non-empty list of role names")
    roles = set(requested)
    if not roles <= _allowed_roles(current_user):
        raise HTTPException(status_code=403, detail="You cannot message one of those roles")

    staff_result = (
        supabase.table("user_roles")
        .select("user_id")
        .eq("tenant_id", current_user.hotel_id)
        .eq("is_active", True)
        .in_("role", sorted(roles))
        .execute()
    )
    # One inbox row per person, even when they hold more than one matching role row.
    recipients = sorted(
        {
            r["user_id"]
            for r in (staff_result.data or [])
            if r.get("user_id") and r["user_id"] != current_user.user_id
        }
    )

    if not recipients:
        return {"data": {"sent": 0}}

    rows = [
        {
            "tenant_id": current_user.hotel_id,
            "user_id": uid,
            "type": "broadcast",
            "title": "Team message",
            "body": message,
            "is_read": False,
        }
        for uid in recipients
    ]
    supabase.table("notifications").insert(rows).execute()
    return {"data": {"sent": len(rows)}}


@router.post("/direct")
async def send_direct_message(
    body: dict = Body(...),
    current_user: CurrentUser = Depends(
        require_role("gm", "housekeeping_supervisor", "engineer")
    ),
):
    """Send a direct in-app message to one active staff member of this property."""
    recipient_id = body.get("recipient_id")
    if not isinstance(recipient_id, str) or not recipient_id.strip():
        raise HTTPException(status_code=422, detail="recipient_id and message are required")
    recipient_id = recipient_id.strip()
    message = _clean_message(body.get("message"))
    if recipient_id == current_user.user_id:
        raise HTTPException(status_code=422, detail="You cannot message yourself")

    # The recipient must hold an ACTIVE role in the caller's property. A supervisor reaches housekeeping accounts only.
    rows = (
        supabase.table("user_roles")
        .select("user_id, role")
        .eq("user_id", recipient_id)
        .eq("tenant_id", current_user.hotel_id)
        .eq("is_active", True)
        .execute()
    )
    held = {r.get("role") for r in (rows.data or [])}
    if not held:
        raise HTTPException(status_code=404, detail="Recipient not found in this property")
    if not (held & _allowed_roles(current_user)):
        raise HTTPException(status_code=404, detail="Recipient not found in this property")

    supabase.table("notifications").insert({
        "tenant_id": current_user.hotel_id,
        "user_id": recipient_id,
        "type": "direct_message",
        "title": "Message from supervisor",
        "body": message,
        "is_read": False,
    }).execute()

    return {"data": {"success": True}}
