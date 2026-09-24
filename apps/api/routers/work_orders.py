import asyncio
import logging
import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from typing import Literal, Optional
from middleware.auth import get_current_user, require_role, CurrentUser
from models.requests import (
    CreateWorkOrderRequest,
    CompleteWorkOrderRequest,
    TransitionWorkOrderRequest,
    UpdateWorkOrderRequest,
    AddCommentRequest,
    BulkArchiveWorkOrdersRequest,
    BulkArchiveByAgeRequest,
    BulkUnarchiveWorkOrdersRequest,
    SnoozeWorkOrderRequest,
    CreateChecklistItemRequest,
    UpdateChecklistItemRequest,
    MergeWorkOrderRequest,
)
from core.database import supabase
from core.config import settings
from datetime import datetime, timedelta, timezone
from services.work_orders.transitions import TransitionRequest, validate_work_order_transition

ALLOWED_PHOTO_TYPES = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}
MAX_PHOTO_BYTES = 5 * 1024 * 1024

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/work-orders", tags=["work-orders"])

SLA_MINUTES = {"urgent": 60, "emergency": 30, "normal": 240, "low": 480}
_ARCHIVABLE_STATUSES = {"completed", "cancelled"}

# Best-effort category → room-unavailability reason mapping (migration 108/109
# seeds these codes for every tenant). Categories with no clean match fall
# back to OTHER rather than guessing.
_OOO_REASON_BY_CATEGORY = {
    "plumbing": ("PLUMBING", "Plumbing"),
    "electrical": ("ELECTRICAL", "Electrical"),
    "hvac": ("HVAC", "HVAC"),
    "furniture": ("FURNITURE_FIXTURE", "Furniture / fixture"),
    "safety": ("SAFETY", "Safety"),
}
_OOO_DEFAULT_REASON = ("OTHER", "Other")
_OOO_DEFAULT_WINDOW_HOURS = 24


def _mark_room_out_of_order(wo: dict, request: CreateWorkOrderRequest, current_user: CurrentUser) -> bool:
    """Open a room-unavailability period linked to this new work order (the
    same RPC the dedicated Out-of-Order screen uses, migration 108). Never
    blocks work order creation — a failure here is logged and swallowed."""
    if not request.room_id:
        return False
    reason_code, reason_label = _OOO_REASON_BY_CATEGORY.get(request.category, _OOO_DEFAULT_REASON)
    expected_return_at = datetime.now(timezone.utc) + timedelta(hours=_OOO_DEFAULT_WINDOW_HOURS)
    try:
        supabase.rpc(
            "create_room_unavailability",
            {
                "p_room_id": str(request.room_id),
                "p_tenant_id": current_user.hotel_id,
                "p_reason_code": reason_code,
                "p_reason_label": reason_label,
                "p_details": f"Reported via work order: {wo.get('title') or 'Untitled'}",
                "p_expected_return_at": expected_return_at.isoformat(),
                "p_owner_id": None,
                "p_work_order_id": wo["id"],
                "p_created_by": current_user.user_id,
                "p_source": "WEB",
            },
        ).execute()
        return True
    except Exception:
        logger.exception(
            "Failed to mark room %s out of order for work order %s",
            request.room_id,
            wo.get("id"),
        )
        return False


def _ensure_engineer_can_update_work_order(
    current_user: CurrentUser, work_order: dict, update_data: dict | None = None
) -> None:
    if current_user.role != "engineer":
        return

    assigned_to = work_order.get("assigned_to")
    is_assigned_to_me = assigned_to == current_user.user_id
    is_claimable = assigned_to is None and work_order.get("status") == "open"

    if not (is_assigned_to_me or is_claimable):
        raise HTTPException(
            status_code=403,
            detail="Engineers can only update assigned or unassigned open work orders",
        )

    if (
        update_data
        and "assigned_to" in update_data
        and update_data["assigned_to"] != current_user.user_id
    ):
        raise HTTPException(
            status_code=403,
            detail="Engineers cannot reassign work orders to another user",
        )


def _ensure_engineer_can_complete_work_order(
    current_user: CurrentUser, work_order: dict
) -> None:
    if (
        current_user.role == "engineer"
        and work_order.get("assigned_to") != current_user.user_id
    ):
        raise HTTPException(
            status_code=403,
            detail="Engineers can only complete work orders assigned to them",
        )


def _ensure_tenant_row(table: str, row_id: str, hotel_id: str, label: str) -> None:
    result = (
        supabase.table(table)
        .select("id")
        .eq("id", row_id)
        .eq("tenant_id", hotel_id)
        .maybe_single()
        .execute()
    )
    if not result or not result.data:
        raise HTTPException(status_code=404, detail=f"{label} not found")


def _ensure_tenant_staff(
    user_id: str, hotel_id: str, label: str = "Staff member"
) -> None:
    result = (
        supabase.table("user_roles")
        .select("id")
        .eq("user_id", user_id)
        .eq("tenant_id", hotel_id)
        .eq("is_active", True)
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail=f"{label} not found")


def _validate_work_order_references(
    request: CreateWorkOrderRequest, hotel_id: str
) -> None:
    if request.room_id:
        _ensure_tenant_row("rooms", str(request.room_id), hotel_id, "Room")
    if request.asset_id:
        _ensure_tenant_row("assets", str(request.asset_id), hotel_id, "Asset")
    if request.assigned_to:
        _ensure_tenant_staff(str(request.assigned_to), hotel_id)


def _execute_work_order_transition(
    *,
    work_order_id: str,
    current_user: CurrentUser,
    decision,
    source: str,
    assigned_to: str | None = None,
):
    payload = {
        "p_work_order_id": work_order_id,
        "p_tenant_id": current_user.hotel_id,
        "p_new_status": decision.status,
        "p_actor_id": current_user.user_id,
        "p_actor_role": current_user.role,
        "p_reason_code": decision.reason_code,
        "p_reason_note": decision.reason_note,
        "p_source": source,
        "p_is_override": decision.is_override,
    }
    if assigned_to is not None:
        payload["p_assigned_to"] = assigned_to
    result = supabase.rpc("transition_work_order_with_audit", payload).execute()

    if decision.status == "completed":
        wo = (
            supabase.table("work_orders")
            .select("pm_schedule_id")
            .eq("id", work_order_id)
            .eq("tenant_id", current_user.hotel_id)
            .maybe_single()
            .execute()
        )
        pm_schedule_id = (wo.data or {}).get("pm_schedule_id") if wo else None
        if pm_schedule_id:
            from services.pm_schedules import advance_pm_schedule_on_completion
            advance_pm_schedule_on_completion(pm_schedule_id, current_user.hotel_id)

    return result


@router.post("")
async def create_work_order(
    request: CreateWorkOrderRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    sla = SLA_MINUTES.get(request.priority, 240)
    due_at = datetime.now(timezone.utc) + timedelta(minutes=sla)
    _validate_work_order_references(request, current_user.hotel_id)

    wo_data = {
        "tenant_id": current_user.hotel_id,
        "title": request.title or request.nl_input,
        "description": request.description,
        "original_nl_input": request.nl_input,
        "category": request.category,
        "priority": request.priority,
        "room_id": str(request.room_id) if request.room_id else None,
        "location_text": request.location_text,
        "asset_id": str(request.asset_id) if request.asset_id else None,
        "assigned_to": str(request.assigned_to) if request.assigned_to else None,
        "created_by": current_user.user_id,
        "sla_minutes": sla,
        "due_at": due_at.isoformat(),
        "guest_reported": request.guest_reported,
    }
    result = supabase.table("work_orders").insert(wo_data).execute()
    wo = result.data[0] if result.data else None
    room_marked_out_of_order = False
    if wo:
        _seed_checklist_from_template(wo["id"], request.category, current_user.hotel_id)
        if request.mark_room_out_of_order:
            room_marked_out_of_order = _mark_room_out_of_order(wo, request, current_user)
    return {"data": wo, "room_marked_out_of_order": room_marked_out_of_order}


def _seed_checklist_from_template(wo_id: str, category: str, hotel_id: str) -> None:
    """Snapshot the tenant's default checklist for this category (migration 110)
    onto the new work order. No-op when the category has no template — the WO
    simply starts with an empty, manually-built checklist."""
    template = (
        supabase.table("work_order_checklist_templates")
        .select("id")
        .eq("tenant_id", hotel_id)
        .eq("category", category)
        .eq("is_active", True)
        .maybe_single()
        .execute()
    )
    template_id = (template.data or {}).get("id") if template else None
    if not template_id:
        return
    items = (
        supabase.table("work_order_checklist_template_items")
        .select("label, estimated_minutes, sort_order")
        .eq("template_id", template_id)
        .order("sort_order")
        .execute()
    ).data or []
    if not items:
        return
    supabase.table("work_order_checklist_items").insert(
        [
            {
                "tenant_id": hotel_id,
                "work_order_id": wo_id,
                "label": item["label"],
                "estimated_minutes": item.get("estimated_minutes"),
                "sort_order": item.get("sort_order", 0),
            }
            for item in items
        ]
    ).execute()


@router.get("")
async def list_work_orders(
    status: Optional[
        Literal["open", "escalated", "in_progress", "on_hold", "completed", "cancelled"]
    ] = Query(None),
    category: Optional[
        Literal[
            "plumbing",
            "electrical",
            "hvac",
            "furniture",
            "appliance",
            "structural",
            "safety",
            "general",
        ]
    ] = Query(None),
    priority: Optional[Literal["emergency", "urgent", "normal", "low"]] = Query(None),
    assigned_to: Optional[str] = Query(None),
    room_id: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    sort_by: Literal["created_at", "due_at", "priority"] = Query("created_at"),
    sort_dir: Literal["asc", "desc"] = Query("desc"),
    overdue: bool = Query(False),
    unassigned: bool = Query(False),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    archived: bool = Query(False),
    current_user: CurrentUser = Depends(get_current_user),
):
    # Priority has no natural SQL ordering (its enum values don't sort by
    # urgency alphabetically), so priority sort is applied client-side on the
    # loaded page; server-side ordering falls back to created_at for it.
    order_col = "due_at" if sort_by == "due_at" else "created_at"
    order_desc = sort_dir == "desc"
    active_statuses = ["open", "escalated", "in_progress", "on_hold"]
    now_iso = datetime.now(timezone.utc).isoformat()
    if current_user.role == "engineer":
        # OR-filter (assigned_to=me OR assigned_to IS NULL) forces a seq-scan.
        # Two indexed queries + Python merge is faster under concurrent load.
        fetch_up_to = page * per_page  # enough rows to slice the requested page

        def _base():
            query = (
                supabase.table("work_orders")
                .select("*, rooms(room_number), assets(name)")
                .eq("tenant_id", current_user.hotel_id)
                .order(order_col, desc=order_desc)
                .range(0, fetch_up_to - 1)
            )
            if archived:
                query = query.not_.is_("archived_at", "null")
            else:
                query = query.is_("archived_at", "null")
            if status:
                query = query.eq("status", status)
            if category:
                query = query.eq("category", category)
            if priority:
                query = query.eq("priority", priority)
            if room_id:
                query = query.eq("room_id", room_id)
            if q:
                query = query.ilike("title", f"%{q}%")
            if overdue:
                query = query.lt("due_at", now_iso)
                if not status:
                    query = query.in_("status", active_statuses)
            return query

        r_mine = _base().eq("assigned_to", current_user.user_id).execute()
        r_open = _base().is_("assigned_to", "null").execute()

        seen: set = set()
        merged = []
        for row in (r_mine.data or []) + (r_open.data or []):
            if row["id"] not in seen:
                seen.add(row["id"])
                merged.append(row)
        merged.sort(key=lambda r: r.get(order_col) or "", reverse=order_desc)

        start = (page - 1) * per_page
        return {
            "data": merged[start : start + per_page],
            "meta": {"page": page, "per_page": per_page},
        }

    query = (
        supabase.table("work_orders")
        .select("*, rooms(room_number), assets(name)")
        .eq("tenant_id", current_user.hotel_id)
        .order(order_col, desc=order_desc)
        .range((page - 1) * per_page, page * per_page - 1)
    )
    if archived:
        query = query.not_.is_("archived_at", "null")
    else:
        query = query.is_("archived_at", "null")

    if status:
        query = query.eq("status", status)
    if category:
        query = query.eq("category", category)
    if priority:
        query = query.eq("priority", priority)
    if assigned_to:
        query = query.eq("assigned_to", assigned_to)
    if unassigned:
        query = query.is_("assigned_to", "null")
    if room_id:
        query = query.eq("room_id", room_id)
    if q:
        query = query.ilike("title", f"%{q}%")
    if overdue:
        query = query.lt("due_at", now_iso)
        if not status:
            query = query.in_("status", active_statuses)

    result = query.execute()
    return {"data": result.data, "meta": {"page": page, "per_page": per_page}}


@router.get("/stats")
async def work_order_stats(current_user: CurrentUser = Depends(get_current_user)):
    """GM/engineering command-center KPIs. Tenant-scoped; engineers see only
    their own + claimable work orders. cost_this_month is GM-only (hourly-rate
    derived costs are not exposed to non-GM roles — migration 104)."""
    hotel_id = current_user.hotel_id
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = today_start.replace(day=1)
    thirty_days_ago = now - timedelta(days=30)
    is_engineer = current_user.role == "engineer"
    active_statuses = ["open", "escalated", "in_progress", "on_hold"]

    def _active_base():
        return (
            supabase.table("work_orders")
            .select("id, status, priority, assigned_to, due_at")
            .eq("tenant_id", hotel_id)
            .is_("archived_at", "null")
            .in_("status", active_statuses)
        )

    if is_engineer:
        mine = _active_base().eq("assigned_to", current_user.user_id).execute().data or []
        claimable = (
            _active_base().eq("status", "open").is_("assigned_to", "null").execute().data
            or []
        )
        seen: set = set()
        active_rows = []
        for row in mine + claimable:
            if row["id"] not in seen:
                seen.add(row["id"])
                active_rows.append(row)
    else:
        active_rows = _active_base().execute().data or []

    counts = {"open": 0, "escalated": 0, "in_progress": 0, "on_hold": 0}
    overdue = unassigned = urgent = 0
    for row in active_rows:
        st = row.get("status")
        if st in counts:
            counts[st] += 1
        if row.get("priority") in ("urgent", "emergency"):
            urgent += 1
        if not row.get("assigned_to"):
            unassigned += 1
        due = row.get("due_at")
        if due:
            try:
                if datetime.fromisoformat(due.replace("Z", "+00:00")) < now:
                    overdue += 1
            except (ValueError, AttributeError):
                pass

    completed_today_q = (
        supabase.table("work_orders")
        .select("id", count="exact")
        .eq("tenant_id", hotel_id)
        .eq("status", "completed")
        .gte("completed_at", today_start.isoformat())
    )
    if is_engineer:
        completed_today_q = completed_today_q.eq("assigned_to", current_user.user_id)
    completed_today = completed_today_q.execute().count or 0

    resolved_q = (
        supabase.table("work_orders")
        .select("started_at, completed_at")
        .eq("tenant_id", hotel_id)
        .eq("status", "completed")
        .gte("completed_at", thirty_days_ago.isoformat())
        .not_.is_("started_at", "null")
    )
    if is_engineer:
        resolved_q = resolved_q.eq("assigned_to", current_user.user_id)
    durations = []
    for row in resolved_q.execute().data or []:
        try:
            started = datetime.fromisoformat(row["started_at"].replace("Z", "+00:00"))
            done = datetime.fromisoformat(row["completed_at"].replace("Z", "+00:00"))
            minutes = (done - started).total_seconds() / 60
            if minutes >= 0:
                durations.append(minutes)
        except (ValueError, AttributeError, KeyError, TypeError):
            pass
    avg_resolution_minutes = round(sum(durations) / len(durations)) if durations else None

    stats = {
        "open": counts["open"],
        "escalated": counts["escalated"],
        "in_progress": counts["in_progress"],
        "on_hold": counts["on_hold"],
        "overdue": overdue,
        "unassigned": unassigned,
        "urgent": urgent,
        "completed_today": completed_today,
        "avg_resolution_minutes": avg_resolution_minutes,
        "cost_this_month": None,
    }

    if current_user.role == "gm":
        cost_rows = (
            supabase.table("work_orders")
            .select("total_cost")
            .eq("tenant_id", hotel_id)
            .eq("status", "completed")
            .gte("completed_at", month_start.isoformat())
            .not_.is_("total_cost", "null")
            .execute()
        ).data or []
        stats["cost_this_month"] = round(
            sum(float(r["total_cost"]) for r in cost_rows if r.get("total_cost") is not None), 2
        )

    return {"data": stats}


@router.get("/{wo_id}")
async def get_work_order(
    wo_id: str, current_user: CurrentUser = Depends(get_current_user)
):
    result = (
        supabase.table("work_orders")
        .select(
            "*, rooms(room_number, floor), assets(*), work_order_photos(*), work_order_comments(*)"
        )
        .eq("id", wo_id)
        .eq("tenant_id", current_user.hotel_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Work order not found")
    return {"data": result.data[0]}


async def _send_wo_assignment_push(engineer_id: str, wo_id: str, title: str) -> None:
    """Fire-and-forget push notification to engineer on work order assignment."""
    try:
        profile = (
            supabase.table("user_profiles")
            .select("expo_push_token")
            .eq("id", engineer_id)
            .maybe_single()
            .execute()
        )
        token = (profile.data or {}).get("expo_push_token")
        if not token:
            return
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(
                "https://exp.host/--/api/v2/push/send",
                json={
                    "to": token,
                    "title": "Work Order Assigned",
                    "body": title,
                    "data": {
                        "type": "wo_assignment",
                        "url": f"/(app)/work-orders/{wo_id}",
                        "wo_id": wo_id,
                    },
                },
            )
    except Exception:
        pass  # Never block claim response on push failure


def _notify_guest_request_of_wo_completion(
    *, tenant_id: str, guest_request_id: str, wo_title: str
) -> None:
    """Guest-request bridge (see guest_requests.create_work_order_from_guest_request):
    tell front desk the linked repair is done so they can update the guest. Best-effort —
    a notification failure must never fail the underlying WO completion."""
    try:
        staff = (
            supabase.table("user_roles")
            .select("user_id")
            .eq("tenant_id", tenant_id)
            .eq("is_active", True)
            .in_("role", ["front_desk", "housekeeping_supervisor"])
            .execute()
        )
        recipients = {r["user_id"] for r in (staff.data or [])}
        if recipients:
            supabase.table("notifications").insert(
                [
                    {
                        "tenant_id": tenant_id,
                        "user_id": uid,
                        "type": "guest_request_wo_completed",
                        "title": "Work order completed",
                        "body": f"'{wo_title}' is done — update the guest if needed.",
                        "data": {"guest_request_id": guest_request_id},
                    }
                    for uid in recipients
                ]
            ).execute()
        supabase.table("guest_request_events").insert(
            {
                "tenant_id": tenant_id,
                "guest_request_id": guest_request_id,
                "event_type": "note",
                "source": "automation",
                "detail": "Linked engineering work order completed",
            }
        ).execute()
    except Exception:
        logger.exception("Failed to notify front desk of WO completion for guest_request=%s", guest_request_id)


@router.post("/{wo_id}/claim")
async def claim_work_order(
    wo_id: str,
    current_user: CurrentUser = Depends(
        require_role("engineer", "gm")
    ),
):
    wo_check = (
        supabase.table("work_orders")
        .select("id, status")
        .eq("id", wo_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not wo_check or not wo_check.data:
        raise HTTPException(status_code=404, detail="Work order not found")
    if wo_check.data["status"] != "open":
        raise HTTPException(status_code=409, detail="Work order is no longer open")

    decision = validate_work_order_transition(
        current_status=wo_check.data["status"],
        request=TransitionRequest(status="in_progress"),
        actor_role=current_user.role,
    )
    result = _execute_work_order_transition(
        work_order_id=wo_id,
        current_user=current_user,
        decision=decision,
        source="api",
        assigned_to=current_user.user_id,
    )
    wo = result.data[0] if result.data else None
    if wo:
        asyncio.create_task(
            _send_wo_assignment_push(
                current_user.user_id, wo_id, wo.get("title", "Work order assigned")
            )
        )
    return {"data": wo}


@router.post("/{wo_id}/complete")
async def complete_work_order(
    wo_id: str,
    request: CompleteWorkOrderRequest,
    current_user: CurrentUser = Depends(
        require_role("engineer", "gm")
    ),
):
    wo_check = (
        supabase.table("work_orders")
        .select("id, assigned_to, status, title, guest_request_id")
        .eq("id", wo_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not wo_check or not wo_check.data:
        raise HTTPException(status_code=404, detail="Work order not found")
    _ensure_engineer_can_complete_work_order(current_user, wo_check.data)

    if request.parts_consumed:
        from services.inventory import ensure_sufficient_stock

        ensure_sufficient_stock(
            [(item.part_id, item.location_id, item.quantity) for item in request.parts_consumed],
            current_user.hotel_id,
        )

    # --- Cost computation (Phase 38) -----------------------------------
    # Labor: assignee's hourly_rate (fallback: whoever is completing the WO)
    # times labor_hours. NULL (never 0) if no rate is on file anywhere.
    labor_cost = None
    if request.labor_hours is not None:
        labor_user_id = wo_check.data.get("assigned_to") or current_user.user_id
        rate_row = (
            supabase.table("user_roles")
            .select("hourly_rate")
            .eq("user_id", labor_user_id)
            .eq("tenant_id", current_user.hotel_id)
            .eq("is_active", True)
            .execute()
        )
        hourly_rate = None
        for row in (rate_row.data or []):
            if row.get("hourly_rate") is not None:
                hourly_rate = row["hourly_rate"]
                break
        if hourly_rate is not None:
            labor_cost = round(request.labor_hours * float(hourly_rate), 2)

    # Parts: sum(quantity * unit_cost) across parts_consumed. A part with no
    # unit_cost on file contributes 0, it never blocks completion.
    parts_cost = None
    if request.parts_consumed:
        part_ids = [item.part_id for item in request.parts_consumed]
        parts_rows = (
            supabase.table("engineering_parts")
            .select("id, unit_cost")
            .eq("tenant_id", current_user.hotel_id)
            .in_("id", part_ids)
            .execute()
        )
        unit_cost_by_id = {p["id"]: p.get("unit_cost") for p in (parts_rows.data or [])}
        parts_cost = 0.0
        for item in request.parts_consumed:
            unit_cost = unit_cost_by_id.get(item.part_id)
            if unit_cost is not None:
                parts_cost += item.quantity * float(unit_cost)
        parts_cost = round(parts_cost, 2)

    # Total: NULL only when both inputs are NULL — never write 0 for "no data".
    total_cost = None
    if labor_cost is not None or parts_cost is not None:
        total_cost = round((labor_cost or 0) + (parts_cost or 0), 2)
    # ---------------------------------------------------------------------

    decision = validate_work_order_transition(
        current_status=wo_check.data["status"],
        request=TransitionRequest(status="completed"),
        actor_role=current_user.role,
    )
    _execute_work_order_transition(
        work_order_id=wo_id,
        current_user=current_user,
        decision=decision,
        source="api",
    )
    result = (
        supabase.table("work_orders")
        .update(
            {
                "notes": request.notes,
                "labor_hours": request.labor_hours,
                "parts_used": request.parts_used,
                "labor_cost": labor_cost,
                "parts_cost": parts_cost,
                "total_cost": total_cost,
            }
        )
        .eq("id", wo_id)
        .eq("tenant_id", current_user.hotel_id)
        .execute()
    )

    if request.parts_consumed:
        from services.inventory import consume_part

        for item in request.parts_consumed:
            consume_part(
                part_id=item.part_id,
                location_id=item.location_id,
                quantity=item.quantity,
                tenant_id=current_user.hotel_id,
                user_id=current_user.user_id,
                work_order_id=wo_id,
            )

    guest_request_id = wo_check.data.get("guest_request_id")
    if guest_request_id:
        _notify_guest_request_of_wo_completion(
            tenant_id=current_user.hotel_id,
            guest_request_id=guest_request_id,
            wo_title=wo_check.data.get("title") or "Work order",
        )

    return {"data": result.data[0] if result.data else None}


@router.post("/{wo_id}/transition")
async def transition_work_order(
    wo_id: str,
    request: TransitionWorkOrderRequest,
    current_user: CurrentUser = Depends(require_role("engineer", "gm")),
):
    """Apply one validated state change and append its audit event atomically."""
    work_order = (
        supabase.table("work_orders")
        .select("id, assigned_to, status")
        .eq("id", wo_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not work_order or not work_order.data:
        raise HTTPException(status_code=404, detail="Work order not found")

    _ensure_engineer_can_update_work_order(current_user, work_order.data)
    decision = validate_work_order_transition(
        current_status=work_order.data["status"],
        request=TransitionRequest(
            status=request.status,
            reason_code=request.reason_code,
            reason_note=request.reason_note,
            override=request.override,
        ),
        actor_role=current_user.role,
    )

    result = _execute_work_order_transition(
        work_order_id=wo_id,
        current_user=current_user,
        decision=decision,
        source=request.source,
    )
    return {"data": result.data[0] if result.data else None}


@router.patch("/{wo_id}")
async def update_work_order(
    wo_id: str,
    request: UpdateWorkOrderRequest,
    current_user: CurrentUser = Depends(
        require_role("engineer", "gm")
    ),
):
    if request.status is not None:
        raise HTTPException(
            status_code=422,
            detail="Use the work-order transition endpoint for status changes",
        )
    wo_check = (
        supabase.table("work_orders")
        .select("id, assigned_to, status")
        .eq("id", wo_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not (wo_check and wo_check.data):
        raise HTTPException(status_code=404, detail="Work order not found")

    update_data = request.model_dump(exclude_none=True)
    if "assigned_to" in update_data:
        update_data["assigned_to"] = str(update_data["assigned_to"])
        _ensure_tenant_staff(update_data["assigned_to"], current_user.hotel_id)
    if "room_id" in update_data:
        update_data["room_id"] = str(update_data["room_id"])
        _ensure_tenant_row(
            "rooms", update_data["room_id"], current_user.hotel_id, "Room"
        )
    if "asset_id" in update_data:
        update_data["asset_id"] = str(update_data["asset_id"])
        _ensure_tenant_row(
            "assets", update_data["asset_id"], current_user.hotel_id, "Asset"
        )
    _ensure_engineer_can_update_work_order(current_user, wo_check.data, update_data)

    result = (
        supabase.table("work_orders")
        .update(update_data)
        .eq("id", wo_id)
        .eq("tenant_id", current_user.hotel_id)
        .execute()
    )
    return {"data": result.data[0] if result.data else None}


@router.delete("/{wo_id}", status_code=204)
async def delete_work_order(
    wo_id: str,
    current_user: CurrentUser = Depends(require_role("gm")),
):
    wo_check = (
        supabase.table("work_orders")
        .select("id")
        .eq("id", wo_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not wo_check or not wo_check.data:
        raise HTTPException(status_code=404, detail="Work order not found")

    supabase.table("work_order_comments").delete().eq("work_order_id", wo_id).eq(
        "tenant_id", current_user.hotel_id
    ).execute()
    supabase.table("work_order_photos").delete().eq("work_order_id", wo_id).eq(
        "tenant_id", current_user.hotel_id
    ).execute()
    supabase.table("work_orders").delete().eq("id", wo_id).eq(
        "tenant_id", current_user.hotel_id
    ).execute()


@router.post("/bulk-archive")
async def bulk_archive_work_orders(
    body: BulkArchiveWorkOrdersRequest,
    current_user: CurrentUser = Depends(require_role("engineer", "gm")),
):
    return _bulk_archive(
        [str(i) for i in body.work_order_ids],
        current_user,
        reason_code="bulk_manual_selection",
    )


@router.post("/bulk-archive-by-age")
async def bulk_archive_work_orders_by_age(
    body: BulkArchiveByAgeRequest,
    current_user: CurrentUser = Depends(require_role("engineer", "gm")),
):
    cutoff = (datetime.now(timezone.utc) - timedelta(days=body.older_than_days)).isoformat()
    rows = (
        supabase.table("work_orders")
        .select("id")
        .eq("tenant_id", current_user.hotel_id)
        .eq("status", "completed")
        .is_("archived_at", "null")
        .lt("completed_at", cutoff)
        .execute()
    ).data or []
    return _bulk_archive(
        [r["id"] for r in rows], current_user, reason_code="bulk_by_age", allow_empty=True,
    )


def _bulk_archive(
    ids: list[str], current_user: CurrentUser, *, reason_code: str, allow_empty: bool = False,
):
    if not ids:
        if allow_empty:
            return {"data": {"archived_count": 0}}
        raise HTTPException(status_code=422, detail="No work order ids provided")

    rows = (
        supabase.table("work_orders")
        .select("id, status, archived_at")
        .eq("tenant_id", current_user.hotel_id)
        .in_("id", ids)
        .execute()
    ).data or []

    found_ids = {r["id"] for r in rows}
    missing = set(ids) - found_ids
    if missing:
        raise HTTPException(status_code=404, detail=f"Work orders not found: {sorted(missing)}")

    not_archivable = [r["id"] for r in rows if r["status"] not in _ARCHIVABLE_STATUSES]
    if not_archivable:
        raise HTTPException(
            status_code=409,
            detail=f"Only completed/cancelled work orders can be archived: {not_archivable}",
        )

    now = datetime.now(timezone.utc).isoformat()
    supabase.table("work_orders").update(
        {"archived_at": now, "archived_by": current_user.user_id}
    ).eq("tenant_id", current_user.hotel_id).in_("id", ids).execute()

    supabase.table("operational_audit_events").insert(
        [
            {
                "tenant_id": current_user.hotel_id,
                "resource_type": "work_order",
                "resource_id": wo_id,
                "action": "work_order.archived",
                "actor_id": current_user.user_id,
                "actor_role": current_user.role,
                "old_state": {"archived_at": None},
                "new_state": {"archived_at": now},
                "reason_code": reason_code,
                "source": "api",
            }
            for wo_id in ids
        ]
    ).execute()

    return {"data": {"archived_count": len(ids)}}


@router.post("/bulk-unarchive")
async def bulk_unarchive_work_orders(
    body: BulkUnarchiveWorkOrdersRequest,
    current_user: CurrentUser = Depends(require_role("engineer", "gm")),
):
    ids = [str(i) for i in body.work_order_ids]
    rows = (
        supabase.table("work_orders")
        .select("id")
        .eq("tenant_id", current_user.hotel_id)
        .in_("id", ids)
        .execute()
    ).data or []

    found_ids = {r["id"] for r in rows}
    missing = set(ids) - found_ids
    if missing:
        raise HTTPException(status_code=404, detail=f"Work orders not found: {sorted(missing)}")

    supabase.table("work_orders").update(
        {"archived_at": None, "archived_by": None}
    ).eq("tenant_id", current_user.hotel_id).in_("id", ids).execute()

    supabase.table("operational_audit_events").insert(
        [
            {
                "tenant_id": current_user.hotel_id,
                "resource_type": "work_order",
                "resource_id": wo_id,
                "action": "work_order.unarchived",
                "actor_id": current_user.user_id,
                "actor_role": current_user.role,
                "old_state": {"archived_at": "set"},
                "new_state": {"archived_at": None},
                "reason_code": None,
                "source": "api",
            }
            for wo_id in ids
        ]
    ).execute()

    return {"data": {"unarchived_count": len(ids)}}


@router.post("/{wo_id}/photos")
async def upload_work_order_photo(
    wo_id: str,
    file: UploadFile = File(...),
    photo_type: str = Form("progress"),
    caption: Optional[str] = Form(None),
    current_user: CurrentUser = Depends(
        require_role("engineer", "gm")
    ),
):
    if file.content_type not in ALLOWED_PHOTO_TYPES:
        raise HTTPException(
            status_code=400, detail="Only JPEG, PNG, or WebP images are allowed"
        )
    if photo_type not in ("before", "after", "progress"):
        raise HTTPException(
            status_code=400, detail="photo_type must be before, after, or progress"
        )

    wo_check = (
        supabase.table("work_orders")
        .select("id")
        .eq("id", wo_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not wo_check or not wo_check.data:
        raise HTTPException(status_code=404, detail="Work order not found")

    contents = await file.read(MAX_PHOTO_BYTES + 1)
    if len(contents) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="Photo must be 5 MB or smaller")

    ext = ALLOWED_PHOTO_TYPES[file.content_type]
    ts = int(datetime.now(timezone.utc).timestamp() * 1000)
    storage_path = f"{current_user.hotel_id}/{wo_id}/{ts}.{ext}"

    try:
        supabase.storage.from_("work-order-photos").upload(
            storage_path,
            contents,
            {"content-type": file.content_type, "upsert": "false"},
        )
    except Exception:
        raise HTTPException(status_code=500, detail="Photo upload failed")

    result = (
        supabase.table("work_order_photos")
        .insert(
            {
                "work_order_id": wo_id,
                "tenant_id": current_user.hotel_id,
                "uploaded_by": current_user.user_id,
                "storage_path": storage_path,
                "photo_type": photo_type,
                "caption": caption,
            }
        )
        .execute()
    )

    photo = result.data[0] if result.data else {}
    photo["photo_url"] = (
        f"{settings.supabase_url}/storage/v1/object/public/work-order-photos/{storage_path}"
    )
    return {"data": photo}


@router.post("/{wo_id}/comments")
async def add_comment(
    wo_id: str,
    request: AddCommentRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    wo_check = (
        supabase.table("work_orders")
        .select("id")
        .eq("id", wo_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not wo_check or not wo_check.data:
        raise HTTPException(status_code=404, detail="Work order not found")

    result = (
        supabase.table("work_order_comments")
        .insert(
            {
                "work_order_id": wo_id,
                "tenant_id": current_user.hotel_id,
                "user_id": current_user.user_id,
                "comment": request.comment,
                "is_system": False,
            }
        )
        .execute()
    )
    return {"data": result.data[0] if result.data else None}


# ---------------------------------------------------------------------------
# Checklist — per-category defaults snapshotted at creation (migration 110),
# editable per work order thereafter.
# ---------------------------------------------------------------------------

@router.get("/{wo_id}/checklist")
async def list_checklist_items(
    wo_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_tenant_row("work_orders", wo_id, current_user.hotel_id, "Work order")
    result = (
        supabase.table("work_order_checklist_items")
        .select("*")
        .eq("work_order_id", wo_id)
        .eq("tenant_id", current_user.hotel_id)
        .order("sort_order")
        .execute()
    )
    return {"data": result.data or []}


@router.post("/{wo_id}/checklist")
async def add_checklist_item(
    wo_id: str,
    request: CreateChecklistItemRequest,
    current_user: CurrentUser = Depends(
        require_role("engineer", "chief_engineer", "gm")
    ),
):
    _ensure_tenant_row("work_orders", wo_id, current_user.hotel_id, "Work order")
    existing = (
        supabase.table("work_order_checklist_items")
        .select("sort_order")
        .eq("work_order_id", wo_id)
        .eq("tenant_id", current_user.hotel_id)
        .order("sort_order", desc=True)
        .limit(1)
        .execute()
    )
    next_sort = ((existing.data or [{}])[0].get("sort_order") or 0) + 1
    result = (
        supabase.table("work_order_checklist_items")
        .insert(
            {
                "tenant_id": current_user.hotel_id,
                "work_order_id": wo_id,
                "label": request.label,
                "estimated_minutes": request.estimated_minutes,
                "sort_order": next_sort,
            }
        )
        .execute()
    )
    return {"data": result.data[0] if result.data else None}


@router.patch("/{wo_id}/checklist/{item_id}")
async def update_checklist_item(
    wo_id: str,
    item_id: str,
    request: UpdateChecklistItemRequest,
    current_user: CurrentUser = Depends(
        require_role("engineer", "chief_engineer", "gm")
    ),
):
    update_data = {
        "is_done": request.is_done,
        "done_by": current_user.user_id if request.is_done else None,
        "done_at": datetime.now(timezone.utc).isoformat() if request.is_done else None,
    }
    result = (
        supabase.table("work_order_checklist_items")
        .update(update_data)
        .eq("id", item_id)
        .eq("work_order_id", wo_id)
        .eq("tenant_id", current_user.hotel_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Checklist item not found")
    return {"data": result.data[0]}


# ---------------------------------------------------------------------------
# Parts — spare parts already consumed against this work order (migration
# 102's engineering_part_transactions already carries work_order_id; this is
# just the first list-by-WO view onto it). Logging a new part against an
# open WO reuses the existing POST /inventory/parts/{part_id}/transactions
# endpoint with work_order_id set — no separate write path needed here.
# ---------------------------------------------------------------------------

@router.get("/{wo_id}/parts")
async def list_work_order_parts(
    wo_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    _ensure_tenant_row("work_orders", wo_id, current_user.hotel_id, "Work order")
    result = (
        supabase.table("engineering_part_transactions")
        .select(
            "*, engineering_parts(name, unit, sku), engineering_part_locations(name)"
        )
        .eq("work_order_id", wo_id)
        .eq("tenant_id", current_user.hotel_id)
        .order("created_at", desc=True)
        .execute()
    )
    return {"data": result.data or []}


# ---------------------------------------------------------------------------
# Duplicate-signal — cheap frequency-based heuristic, same philosophy as
# GET /assets/recurring-issues (plain counting, no AI credit cost): other
# still-open work orders on the same asset, or on an asset sharing the same
# zone, within a rolling window. Not an LLM call.
# ---------------------------------------------------------------------------

_DUPLICATE_SIGNAL_WINDOW_DAYS = 30
_OPEN_STATUSES = ("open", "escalated", "in_progress", "on_hold")


@router.get("/{wo_id}/duplicate-signal")
async def get_duplicate_signal(
    wo_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    wo = (
        supabase.table("work_orders")
        .select("id, work_order_number, asset_id, room_id, category, status, created_at")
        .eq("id", wo_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not wo or not wo.data:
        raise HTTPException(status_code=404, detail="Work order not found")
    source = wo.data
    if source["status"] not in _OPEN_STATUSES or not source.get("asset_id"):
        return {"data": None}

    zone = None
    asset = (
        supabase.table("assets")
        .select("zone")
        .eq("id", source["asset_id"])
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if asset and asset.data:
        zone = asset.data.get("zone")

    zoned_asset_ids = [source["asset_id"]]
    if zone:
        zoned = (
            supabase.table("assets")
            .select("id")
            .eq("tenant_id", current_user.hotel_id)
            .eq("zone", zone)
            .execute()
        )
        zoned_asset_ids = list({a["id"] for a in (zoned.data or [])} | {source["asset_id"]})

    since = (datetime.now(timezone.utc) - timedelta(days=_DUPLICATE_SIGNAL_WINDOW_DAYS)).isoformat()
    candidates = (
        supabase.table("work_orders")
        .select("id, work_order_number, title, asset_id, status, created_at, rooms(room_number)")
        .eq("tenant_id", current_user.hotel_id)
        .in_("asset_id", zoned_asset_ids)
        .in_("status", list(_OPEN_STATUSES))
        .neq("id", wo_id)
        .gte("created_at", since)
        .order("created_at", desc=True)
        .execute()
    )
    signals = candidates.data or []
    if not signals:
        return {"data": None}

    same_asset_count = sum(1 for c in signals if c.get("asset_id") == source["asset_id"])
    # Deterministic heuristic, not a model score: base confidence for any
    # signal at all, plus a bump per corroborating WO (same asset weighted
    # higher than same-zone), capped well short of certainty.
    confidence = min(96, 55 + same_asset_count * 15 + (len(signals) - same_asset_count) * 8)

    top = signals[0]
    return {
        "data": {
            "candidate_wo_id": top["id"],
            "candidate_wo_number": top["work_order_number"],
            "confidence": confidence,
            "window_days": _DUPLICATE_SIGNAL_WINDOW_DAYS,
            "same_zone": bool(zone),
            "signals": [
                {
                    "work_order_id": c["id"],
                    "work_order_number": c["work_order_number"],
                    "title": c["title"],
                    "room_number": (c.get("rooms") or {}).get("room_number"),
                    "created_at": c["created_at"],
                }
                for c in signals
            ],
        }
    }


# ---------------------------------------------------------------------------
# Merge — cancels this WO as a duplicate of the target and leaves a linking
# comment on the target, reusing the existing "duplicate" cancellation
# reason (TransitionWorkOrderRequest) rather than introducing a new state.
# Deliberately its own endpoint (not routed through POST /{wo_id}/transition)
# so chief_engineer — who the console UI shows this action to — isn't
# blocked by that endpoint's engineer/gm-only role gate.
# ---------------------------------------------------------------------------

@router.post("/{wo_id}/merge")
async def merge_work_order(
    wo_id: str,
    request: MergeWorkOrderRequest,
    current_user: CurrentUser = Depends(require_role("chief_engineer", "gm")),
):
    target_id = str(request.target_wo_id)
    if target_id == wo_id:
        raise HTTPException(status_code=422, detail="Cannot merge a work order into itself")

    work_order = (
        supabase.table("work_orders")
        .select("id, status, work_order_number")
        .eq("id", wo_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not work_order or not work_order.data:
        raise HTTPException(status_code=404, detail="Work order not found")

    target = (
        supabase.table("work_orders")
        .select("id, work_order_number")
        .eq("id", target_id)
        .eq("tenant_id", current_user.hotel_id)
        .maybe_single()
        .execute()
    )
    if not target or not target.data:
        raise HTTPException(status_code=404, detail="Target work order not found")

    decision = validate_work_order_transition(
        current_status=work_order.data["status"],
        request=TransitionRequest(
            status="cancelled",
            reason_code="duplicate",
            reason_note=f"Merged into WO-{target.data['work_order_number']}",
        ),
        actor_role=current_user.role,
    )
    result = _execute_work_order_transition(
        work_order_id=wo_id,
        current_user=current_user,
        decision=decision,
        source="web",
    )

    supabase.table("work_order_comments").insert(
        {
            "work_order_id": target_id,
            "tenant_id": current_user.hotel_id,
            "user_id": current_user.user_id,
            "comment": f"WO-{work_order.data['work_order_number']} was merged into this work order as a duplicate.",
            "is_system": True,
        }
    ).execute()

    return {"data": result.data[0] if result.data else None}


# ---------------------------------------------------------------------------
# Snooze — display-only hint on the console panel (does not affect queue
# sort, AI triage ordering, or SLA-breach styling elsewhere).
# ---------------------------------------------------------------------------

@router.post("/{wo_id}/snooze")
async def snooze_work_order(
    wo_id: str,
    request: SnoozeWorkOrderRequest,
    current_user: CurrentUser = Depends(
        require_role("engineer", "chief_engineer", "gm")
    ),
):
    snoozed_until = datetime.now(timezone.utc) + timedelta(hours=request.hours)
    result = (
        supabase.table("work_orders")
        .update({"snoozed_until": snoozed_until.isoformat()})
        .eq("id", wo_id)
        .eq("tenant_id", current_user.hotel_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Work order not found")
    return {"data": result.data[0]}
