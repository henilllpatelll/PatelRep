"""Tenant-scoped data access for reports. Every query filters ``tenant_id``.

All cohort queries use the half-open ``[start_utc, end_utc)`` interval from
``ReportPeriod`` so the whole final local day is included and KPI, trend and
drill-down read the exact same rows.
"""
from __future__ import annotations

from typing import Callable, Optional

from services.reporting.periods import ReportPeriod

PAGE_SIZE = 1000  # PostgREST default max rows per request
MAX_ROWS = 20000  # hard bound per cohort; callers surface ``truncated``

WORK_ORDER_COLUMNS = (
    "id, title, category, priority, status, room_id, asset_id, assigned_to, "
    "due_at, started_at, completed_at, created_at, labor_hours, guest_reported"
)
GUEST_REQUEST_COLUMNS = (
    "id, request_number, title, category, priority, status, room_id, "
    "created_at, acknowledged_at, verified_at, due_at"
)
INSPECTION_COLUMNS = "id, room_id, overall_result, completed_at"
TASK_COLUMNS = "id, title, status, priority, room_id, assigned_to, due_at, completed_at, created_at"

# Guest request category -> department. Only categories that are unambiguous are
# attributed; everything else stays unattributed (we never guess).
CATEGORY_DEPARTMENT = {"housekeeping": "housekeeping", "maintenance": "engineering"}
DEPARTMENT_CATEGORIES = {"housekeeping": ("housekeeping",), "engineering": ("maintenance",)}


def fetch_all(make_query: Callable[[], object], *, max_rows: int = MAX_ROWS) -> tuple[list[dict], bool]:
    """Page through a query. ``make_query`` must return a fresh builder each call."""
    rows: list[dict] = []
    offset = 0
    while offset < max_rows:
        page = make_query().range(offset, offset + PAGE_SIZE - 1).execute().data or []
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            return rows, False
        offset += PAGE_SIZE
    return rows, True


def work_orders_created(
    supabase, hotel_id: str, period: ReportPeriod, *, columns: str = WORK_ORDER_COLUMNS
) -> tuple[list[dict], bool]:
    return fetch_all(
        lambda: supabase.table("work_orders")
        .select(columns)
        .eq("tenant_id", hotel_id)
        .gte("created_at", period.start_iso)
        .lt("created_at", period.end_iso)
        .order("created_at")
    )


def work_orders_open(supabase, hotel_id: str, *, columns: str = WORK_ORDER_COLUMNS) -> tuple[list[dict], bool]:
    """Live inventory of unfinished work orders — NOT limited to any reporting period."""
    return fetch_all(
        lambda: supabase.table("work_orders")
        .select(columns)
        .eq("tenant_id", hotel_id)
        .in_("status", ["open", "in_progress", "on_hold"])
        .order("created_at")
    )


def guest_requests_created(
    supabase,
    hotel_id: str,
    period: ReportPeriod,
    *,
    departments: Optional[tuple[str, ...]] = None,
    columns: str = GUEST_REQUEST_COLUMNS,
) -> tuple[list[dict], bool]:
    categories: Optional[list[str]] = None
    if departments is not None and set(departments) != {"housekeeping", "engineering"}:
        categories = [c for d in departments for c in DEPARTMENT_CATEGORIES.get(d, ())]

    def make():
        query = (
            supabase.table("guest_requests")
            .select(columns)
            .eq("tenant_id", hotel_id)
            .gte("created_at", period.start_iso)
            .lt("created_at", period.end_iso)
        )
        if categories is not None:
            query = query.in_("category", categories or ["__none__"])
        return query.order("created_at")

    return fetch_all(make)


def inspections_completed(supabase, hotel_id: str, period: ReportPeriod) -> tuple[list[dict], bool]:
    return fetch_all(
        lambda: supabase.table("inspections")
        .select(INSPECTION_COLUMNS)
        .eq("tenant_id", hotel_id)
        .gte("completed_at", period.start_iso)
        .lt("completed_at", period.end_iso)
        .order("completed_at")
    )


def tasks_created(supabase, hotel_id: str, period: ReportPeriod, *, columns: str = TASK_COLUMNS) -> tuple[list[dict], bool]:
    return fetch_all(
        lambda: supabase.table("tasks")
        .select(columns)
        .eq("tenant_id", hotel_id)
        .gte("created_at", period.start_iso)
        .lt("created_at", period.end_iso)
        .order("created_at")
    )


def staff_directory(supabase, hotel_id: str) -> dict[str, dict]:
    """user_id -> {name, role} for active staff of this hotel only."""
    profiles = (
        supabase.table("user_profiles").select("id, full_name, preferred_name").eq("tenant_id", hotel_id).execute().data or []
    )
    roles = (
        supabase.table("user_roles").select("user_id, role").eq("tenant_id", hotel_id).eq("is_active", True).execute().data or []
    )
    role_map = {r["user_id"]: r["role"] for r in roles}
    directory: dict[str, dict] = {}
    for profile in profiles:
        uid = profile["id"]
        if uid not in role_map:
            continue  # inactive / no role in this hotel
        directory[uid] = {
            "user_id": uid,
            "name": profile.get("preferred_name") or profile.get("full_name") or "Unknown",
            "role": role_map[uid],
        }
    return directory


def room_lookup(supabase, hotel_id: str) -> dict[str, dict]:
    rooms = (
        supabase.table("rooms").select("id, room_number, floor, room_type_id").eq("tenant_id", hotel_id).execute().data or []
    )
    return {r["id"]: r for r in rooms}


def current_room_status_counts(supabase, hotel_id: str) -> dict[str, int]:
    rows, _ = fetch_all(lambda: supabase.table("room_status").select("status").eq("tenant_id", hotel_id))
    counts: dict[str, int] = {}
    for row in rows:
        status = row.get("status") or "UNKNOWN"
        counts[status] = counts.get(status, 0) + 1
    return counts
