"""One list of scheduling requests, two audiences: the supervisor's Requests inbox and the employee's My Requests.

Time-off requests and shift swaps share one list shape (`type` tells them apart) so no screen keeps a second copy of either.
Rows are lean on purpose -- details, the verified shift impact, the analysis and the timeline are read per request.

VISIBILITY. A supervisor sees only requests whose department their role covers (gm: all). An employee sees only requests they
are part of. Neither list ever carries another employee's note, reason or availability.
"""
import logging
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Query

from core.database import supabase
from core.roles import ALL_ROLES, SCHEDULE_MANAGER_ROLES
from middleware.auth import CurrentUser, require_role
from routers.scheduling import _existing_rows
from routers.scheduling_swaps import _shift_rows
from services import coverage_store as store
from services.request_common import person, shift_brief
from services.scheduling_access import hotel_today, hotel_zone, load_departments, load_staff, manager_scope
from services.scheduling_availability import effective_swap_status, shifts_overlapping
from services.scheduling_coverage import _ts

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/schedules", tags=["scheduling-requests"])

ROW_CAP = 300
LEAVE_GROUP = {"pending": "pending", "approved": "approved", "denied": "denied", "cancelled": "cancelled"}
SWAP_GROUP = {"proposed": "pending", "accepted": "pending", "approved": "approved", "denied": "denied",
              "declined": "denied", "cancelled": "cancelled", "expired": "cancelled"}


def _leave_item(row: dict, people: dict[str, dict], impact: Optional[dict]) -> dict:
    return {
        "type": "time_off", "id": row["id"], "status": row["status"], "status_group": LEAVE_GROUP.get(row["status"], "pending"),
        "user": people.get(str(row["user_id"])), "counterpart": None,
        "date_from": str(row["start_date"])[:10], "date_to": str(row["end_date"])[:10], "submitted_at": row.get("created_at"),
        "version": row["version"], "needs_action": row["status"] == "pending",
        "leave": {"partial": row.get("partial"), "start_time": row.get("start_time"), "end_time": row.get("end_time"),
                  "reason_category": row.get("reason_category")},
        "swap": None, "impact": impact,
    }


def _swap_item(row: dict, people: dict[str, dict], shifts: dict[str, dict], now, me: Optional[str]) -> dict:
    state = effective_swap_status(row, now)
    a, b = shifts.get(str(row["requester_assignment_id"])), shifts.get(str(row["counterpart_assignment_id"]))
    days = sorted(str(s["work_date"])[:10] for s in (a, b) if s)
    return {
        "type": "shift_swap", "id": row["id"], "status": state, "status_group": SWAP_GROUP.get(state, "pending"),
        "user": people.get(str(row["requester_id"])), "counterpart": people.get(str(row["counterpart_id"])),
        "date_from": days[0] if days else None, "date_to": days[-1] if days else None, "submitted_at": row.get("created_at"),
        "version": row["version"], "needs_action": state == "accepted",
        "needs_my_response": state == "proposed" and me is not None and str(row["counterpart_id"]) == me,
        "leave": None, "impact": None,
        "swap": {"requester_shift": shift_brief(a) if a else None, "counterpart_shift": shift_brief(b) if b else None,
                 "expires_at": row.get("expires_at")},
    }


def _leave_impact(hotel_id: str, rows: list[dict]) -> dict[str, dict]:
    """Per request: how many of the person's published shifts fall inside the window (verified from the schedule, no estimates)."""
    live = [r for r in rows if r["status"] in ("pending", "approved")]
    if not live:
        return {}
    try:
        low = min(date.fromisoformat(str(r["start_date"])[:10]) for r in live)
        high = max(date.fromisoformat(str(r["end_date"])[:10]) for r in live)
        shifts = _existing_rows(hotel_id, sorted({str(r["user_id"]) for r in live}), low, high)
    except Exception:
        logger.warning("requests inbox: schedule read failed hotel_id=%s", hotel_id)
        return {str(r["id"]): {"verified": False, "shift_count": None} for r in live}
    by_user: dict[str, list[dict]] = {}
    for s in shifts:
        by_user.setdefault(str(s["user_id"]), []).append(s)
    out = {}
    for r in live:
        window = (_ts(r["starts_at"]), _ts(r["ends_at"]))
        hits = shifts_overlapping(window, by_user.get(str(r["user_id"]), []))
        out[str(r["id"])] = {"verified": True, "shift_count": len(hits)}
    return out


def _in_range(item: dict, date_from: Optional[date], date_to: Optional[date]) -> bool:
    low, high = item["date_from"], item["date_to"]
    if (date_from and high and high < date_from.isoformat()) or (date_to and low and low > date_to.isoformat()):
        return False
    return True


@router.get("/requests")
async def manager_requests(
    type: str = Query("all", pattern="^(all|time_off|shift_swap)$"),
    status: str = Query("pending", pattern="^(pending|approved|denied|all)$"),
    date_from: Optional[date] = Query(None), date_to: Optional[date] = Query(None),
    q: Optional[str] = Query(None, max_length=80),
    current_user: CurrentUser = Depends(require_role(*SCHEDULE_MANAGER_ROLES)),
):
    """
    The supervisor inbox. `pending` = needs a supervisor: leave not yet decided, and swaps the coworker has ACCEPTED (a swap still
    waiting for the coworker is not yours to decide yet and shows only under `all`).
    """
    hotel_id = current_user.hotel_id
    departments = load_departments(hotel_id)
    scope = manager_scope(current_user)
    allowed = sorted(departments.ids_in_scope(scope))
    now = store.now_utc()
    leave_rows, swap_rows = [], []
    if type in ("all", "time_off"):
        query = supabase.table("time_off_requests").select("*").eq("tenant_id", hotel_id)
        leave_rows = (query if scope is None else query.in_("department_id", allowed)).order("created_at", desc=True).limit(ROW_CAP).execute().data or []
    if type in ("all", "shift_swap"):
        query = supabase.table("shift_swap_requests").select("*").eq("tenant_id", hotel_id)
        swap_rows = (query if scope is None else query.in_("department_id", allowed)).order("created_at", desc=True).limit(ROW_CAP).execute().data or []
    staff = load_staff(hotel_id, departments, sorted({str(r["user_id"]) for r in leave_rows} | {str(r["requester_id"]) for r in swap_rows}
                                                    | {str(r["counterpart_id"]) for r in swap_rows}))
    ids = {str(r["user_id"]) for r in leave_rows} | {str(r["requester_id"]) for r in swap_rows} | {str(r["counterpart_id"]) for r in swap_rows}
    people = person(hotel_id, ids, staff)
    shifts = _shift_rows(hotel_id, sorted({str(r[c]) for r in swap_rows for c in ("requester_assignment_id", "counterpart_assignment_id")})) if swap_rows else {}
    impact = _leave_impact(hotel_id, leave_rows)
    items = [_leave_item(r, people, impact.get(str(r["id"]))) for r in leave_rows] + [_swap_item(r, people, shifts, now, None) for r in swap_rows]
    items = [i for i in items if _in_range(i, date_from, date_to)]
    if q:
        needle = q.casefold()
        items = [i for i in items if needle in ((i["user"] or {}).get("name") or "").casefold() or needle in ((i["counterpart"] or {}).get("name") or "").casefold()]

    def count(group: str) -> int:
        if group == "pending":
            return sum(1 for i in items if i["needs_action"])
        if group == "all":
            return len(items)
        return sum(1 for i in items if i["status"] == group)

    counts = {g: count(g) for g in ("pending", "approved", "denied", "all")}
    if status == "pending":
        shown = sorted((i for i in items if i["needs_action"]), key=lambda i: str(i["submitted_at"]))
    elif status == "all":
        shown = items
    else:
        shown = [i for i in items if i["status"] == status]
    return {"data": shown, "meta": {"counts": counts, "truncated": len(leave_rows) >= ROW_CAP or len(swap_rows) >= ROW_CAP,
                                     "hotel_today": hotel_today(hotel_zone(hotel_id)).isoformat()}}


@router.get("/me/requests")
async def my_requests(current_user: CurrentUser = Depends(require_role(*ALL_ROLES))):
    """Everything I asked for or was asked about. `needs_my_response` marks swap proposals waiting for MY answer."""
    hotel_id, me = current_user.hotel_id, current_user.user_id
    now = store.now_utc()
    leave_rows = (supabase.table("time_off_requests").select("*").eq("tenant_id", hotel_id).eq("user_id", me)
                  .order("created_at", desc=True).limit(100).execute().data or [])
    swaps = {}
    for column in ("requester_id", "counterpart_id"):
        for row in supabase.table("shift_swap_requests").select("*").eq("tenant_id", hotel_id).eq(column, me).order("created_at", desc=True).limit(100).execute().data or []:
            swaps[str(row["id"])] = row
    swap_rows = sorted(swaps.values(), key=lambda r: str(r.get("created_at") or ""), reverse=True)
    departments = load_departments(hotel_id)
    ids = {me} | {str(r["requester_id"]) for r in swap_rows} | {str(r["counterpart_id"]) for r in swap_rows}
    people = person(hotel_id, ids, load_staff(hotel_id, departments, sorted(ids)))
    shifts = _shift_rows(hotel_id, sorted({str(r[c]) for r in swap_rows for c in ("requester_assignment_id", "counterpart_assignment_id")})) if swap_rows else {}
    items = [_leave_item(r, people, None) for r in leave_rows] + [_swap_item(r, people, shifts, now, me) for r in swap_rows]
    items.sort(key=lambda i: str(i["submitted_at"]), reverse=True)
    for item in items:
        item["needs_action"] = bool(item.get("needs_my_response"))
    counts = {g: sum(1 for i in items if i["status_group"] == g) for g in ("pending", "approved", "denied", "cancelled")}
    counts["action_required"] = sum(1 for i in items if i["needs_action"])
    return {"data": items, "meta": {"counts": counts, "hotel_today": hotel_today(hotel_zone(hotel_id)).isoformat()}}
