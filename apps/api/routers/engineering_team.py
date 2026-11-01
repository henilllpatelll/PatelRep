"""Chief-engineer team view for the mobile Engineering app.

Read-only and server-computed: counts, per-technician workload and the short "needs attention" list all come
from the work-order, PM and room-unavailability tables for the caller's hotel. Nothing here guesses presence:
the app has no shift or clock-in data for engineers, so a technician with no open jobs is reported as having no
open jobs and nothing more. Assigning work lives on ``POST /work-orders/{id}/assign``.
"""

import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends

from core.database import supabase
from middleware.auth import CurrentUser, require_role
from routers.work_orders import _enrich_list_rows

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/engineering/team", tags=["engineering-team"])

TEAM_ROLES = ("chief_engineer", "gm")
ACTIVE_STATUSES = ("open", "escalated", "in_progress", "on_hold")
# Roles that can actually do a repair (claim / complete are engineer + gm guards), so the only people the
# assign sheet offers. A chief engineer manages the work but is not in the repair queue.
TECHNICIAN_ROLE = "engineer"
URGENT_PRIORITIES = ("emergency", "urgent")
ORDER_LIMIT = 1000
ATTENTION_LIMIT = 20
WO_COLUMNS = (
    "id, work_order_number, title, priority, status, assigned_to, due_at, room_id, asset_id, created_at, "
    "updated_at, rooms(room_number)"
)


def _parse(value) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _hotel_zone(tenant_id: str) -> ZoneInfo:
    try:
        row = supabase.table("tenants").select("timezone").eq("id", tenant_id).maybe_single().execute()
        name = (row.data or {}).get("timezone") if row else None
        return ZoneInfo(name or "America/Chicago")
    except Exception:  # noqa: BLE001 - a bad tz string must not break the view
        return ZoneInfo("America/Chicago")


def _active_work_orders(tenant_id: str) -> tuple[list[dict], bool]:
    rows = (
        supabase.table("work_orders")
        .select(WO_COLUMNS)
        .eq("tenant_id", tenant_id)
        .in_("status", list(ACTIVE_STATUSES))
        .is_("archived_at", "null")
        .limit(ORDER_LIMIT)
        .execute()
    ).data or []
    return rows, len(rows) >= ORDER_LIMIT


def _technicians(tenant_id: str) -> list[dict]:
    roles = (
        supabase.table("user_roles")
        .select("user_id")
        .eq("tenant_id", tenant_id)
        .eq("role", TECHNICIAN_ROLE)
        .eq("is_active", True)
        .execute()
    ).data or []
    ids = sorted({str(r["user_id"]) for r in roles})
    if not ids:
        return []
    profiles = (
        supabase.table("user_profiles")
        .select("id, full_name, preferred_name")
        .eq("tenant_id", tenant_id)
        .in_("id", ids)
        .execute()
    ).data or []
    names = {str(p["id"]): (p.get("preferred_name") or p.get("full_name")) for p in profiles}
    return [{"user_id": uid, "name": names.get(uid)} for uid in ids]


def _is_overdue(row: dict, now: datetime) -> bool:
    due = _parse(row.get("due_at"))
    return bool(due and due < now and row.get("status") != "on_hold")


def _workloads(technicians: list[dict], orders: list[dict], now: datetime) -> list[dict]:
    """Plain counts per technician. ``active`` is work they can be doing now (not on hold); held work is
    counted separately so a blocked job never reads as busy time."""
    by_user: dict[str, dict] = {
        t["user_id"]: {**t, "active": 0, "urgent": 0, "on_hold": 0, "overdue": 0} for t in technicians
    }
    for row in orders:
        entry = by_user.get(str(row.get("assigned_to")))
        if entry is None:
            continue
        if row["status"] == "on_hold":
            entry["on_hold"] += 1
            continue
        entry["active"] += 1
        if row.get("priority") in URGENT_PRIORITIES:
            entry["urgent"] += 1
        if _is_overdue(row, now):
            entry["overdue"] += 1
    return sorted(by_user.values(), key=lambda t: (-t["urgent"], -t["active"], (t["name"] or "").lower()))


def _attention_kind(row: dict, now: datetime) -> str | None:
    priority = row.get("priority")
    if priority == "emergency" and not row.get("assigned_to"):
        return "emergency_unassigned"
    if priority in URGENT_PRIORITIES and _is_overdue(row, now):
        return "urgent_overdue"
    if row["status"] == "escalated":
        return "escalated"
    if row["status"] == "on_hold":
        return "on_hold"
    return None


_ATTENTION_RANK = {"emergency_unassigned": 0, "urgent_overdue": 1, "escalated": 2, "on_hold": 3}


def _attention_item(kind: str, row: dict) -> dict:
    room = row.get("rooms") if isinstance(row.get("rooms"), dict) else None
    return {
        "kind": kind,
        "id": row["id"],
        "work_order_number": row.get("work_order_number"),
        "title": row.get("title"),
        "priority": row.get("priority"),
        "status": row.get("status"),
        "assigned_to": row.get("assigned_to"),
        "due_at": row.get("due_at"),
        "room_id": row.get("room_id"),
        "room_number": room.get("room_number") if room else None,
        "hold_reason_code": row.get("hold_reason_code"),
        "hold_reason_note": row.get("hold_reason_note"),
        "held_since": row.get("held_since"),
        "assigned_to_name": row.get("assigned_to_name"),
    }


def _pm_overdue_count(tenant_id: str, zone: ZoneInfo, now: datetime) -> int | None:
    """Active PM schedules whose due day (hotel calendar) is before today; None when it could not be read."""
    try:
        rows = (
            supabase.table("pm_schedules")
            .select("next_due_at")
            .eq("tenant_id", tenant_id)
            .eq("is_active", True)
            .limit(ORDER_LIMIT)
            .execute()
        ).data or []
    except Exception:  # noqa: BLE001
        logger.warning("team overview: PM lookup failed", exc_info=True)
        return None
    today = now.astimezone(zone).date()
    return sum(1 for r in rows if (d := _parse(r.get("next_due_at"))) and d.astimezone(zone).date() < today)


PM_ITEM_LIMIT = 5
REPEAT_DEFECT_DAYS = 90
REPEAT_DEFECT_MIN = 2


def _pm_oversight(tenant_id: str, zone: ZoneInfo, now: datetime) -> dict | None:
    """The oldest overdue inspections, and equipment whose recent inspections keep recording defects. Both come from
    the PM tables as they are; None when they could not be read (unknown, never "all clear")."""
    try:
        schedules = (
            supabase.table("pm_schedules").select("id, name, next_due_at, assets(name)")
            .eq("tenant_id", tenant_id).eq("is_active", True).order("next_due_at").limit(ORDER_LIMIT).execute()
        ).data or []
        since = (now - timedelta(days=REPEAT_DEFECT_DAYS)).isoformat()
        completions = (
            supabase.table("pm_completion_records").select("asset_id, defects, assets(name)")
            .eq("tenant_id", tenant_id).gte("completed_at", since).limit(ORDER_LIMIT).execute()
        ).data or []
    except Exception:  # noqa: BLE001
        logger.warning("team overview: PM oversight lookup failed", exc_info=True)
        return None
    today = now.astimezone(zone).date()
    overdue = []
    for row in schedules:
        due = _parse(row.get("next_due_at"))
        if due and due.astimezone(zone).date() < today:
            asset = row.get("assets") if isinstance(row.get("assets"), dict) else None
            overdue.append({"id": row.get("id"), "name": row.get("name"), "asset_name": asset.get("name") if asset else None, "next_due_at": row.get("next_due_at")})
    repeats: dict[str, dict] = {}
    for row in completions:
        if not row.get("asset_id") or not (row.get("defects") or 0) > 0:
            continue
        entry = repeats.setdefault(str(row["asset_id"]), {"asset_id": str(row["asset_id"]), "asset_name": None, "count": 0})
        asset = row.get("assets") if isinstance(row.get("assets"), dict) else None
        entry["asset_name"] = entry["asset_name"] or (asset.get("name") if asset else None)
        entry["count"] += 1
    repeat_defects = sorted((e for e in repeats.values() if e["count"] >= REPEAT_DEFECT_MIN), key=lambda e: -e["count"])
    return {"overdue": overdue[:PM_ITEM_LIMIT], "overdue_total": len(overdue), "repeat_defects": repeat_defects[:PM_ITEM_LIMIT], "repeat_window_days": REPEAT_DEFECT_DAYS}


def _rooms_down(tenant_id: str, now: datetime) -> dict | None:
    """Rooms currently out of order / service, and how many have passed their expected return."""
    try:
        rows = (
            supabase.table("room_unavailability_periods")
            .select("id, expected_return_at")
            .eq("tenant_id", tenant_id)
            .eq("status", "ACTIVE")
            .limit(ORDER_LIMIT)
            .execute()
        ).data or []
    except Exception:  # noqa: BLE001
        logger.warning("team overview: room availability lookup failed", exc_info=True)
        return None
    late = sum(1 for r in rows if (d := _parse(r.get("expected_return_at"))) and d < now)
    return {"total": len(rows), "past_expected_return": late}


@router.get("/technicians")
async def list_technicians(current_user: CurrentUser = Depends(require_role(*TEAM_ROLES))):
    """The people work can be assigned to, each with their current workload counts."""
    now = datetime.now(timezone.utc)
    orders, _ = _active_work_orders(current_user.hotel_id)
    return {"data": {"technicians": _workloads(_technicians(current_user.hotel_id), orders, now)}}


@router.get("/overview")
async def team_overview(current_user: CurrentUser = Depends(require_role(*TEAM_ROLES))):
    tenant_id = current_user.hotel_id
    now = datetime.now(timezone.utc)
    zone = _hotel_zone(tenant_id)
    orders, truncated = _active_work_orders(tenant_id)

    attention_counts = {kind: 0 for kind in _ATTENTION_RANK}
    candidates: list[tuple[int, str, dict]] = []
    for row in orders:
        kind = _attention_kind(row, now)
        if kind:
            attention_counts[kind] += 1
            candidates.append((_ATTENTION_RANK[kind], str(_parse(row.get("due_at")) or "~"), {"kind": kind, **row}))
    candidates.sort(key=lambda c: (c[0], c[1]))
    chosen = [c[2] for c in candidates[:ATTENTION_LIMIT]]
    _enrich_list_rows(chosen, tenant_id)

    counts = {
        "open": len(orders),
        "overdue": sum(1 for r in orders if _is_overdue(r, now)),
        "on_hold": sum(1 for r in orders if r["status"] == "on_hold"),
        "emergency": sum(1 for r in orders if r.get("priority") == "emergency"),
        "unassigned": sum(1 for r in orders if not r.get("assigned_to")),
        "pm_overdue": _pm_overdue_count(tenant_id, zone, now),
    }
    return {
        "data": {
            "generated_at": now.isoformat(),
            "counts": counts,
            "rooms_down": _rooms_down(tenant_id, now),
            "pm_oversight": _pm_oversight(tenant_id, zone, now),
            "technicians": _workloads(_technicians(tenant_id), orders, now),
            "attention_counts": attention_counts,
            "needs_attention": [_attention_item(row["kind"], row) for row in chosen],
            "truncated": truncated,
        }
    }
