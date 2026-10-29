"""Housekeeping demand for the staffing forecast: which rooms need cleaning and how long that is estimated to take.

Pure (no database access). There is deliberately NO new duration model here. A room's minutes follow the rule the
mobile Assignments workload already uses (apps/mobile/lib/housekeeping/roomAssignment.ts `estimateRoom`):

  1. this hotel's learned figure for the room type + clean type (services/cleaning_estimates.py, served by
     GET /clean-sessions/estimates) -- never for a stayover pickup;
  2. otherwise the room type's configured `base_clean_minutes`;
  3. otherwise NO estimate. The room is counted as unestimated; it is never padded with a default.

Which rooms count follows GET /housekeeping/board: the effective status and clean type are resolved with the same
precedence, and only rooms still to clean or being cleaned are remaining work. A guest who declined service is known,
zero work. A room appears at most once.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Iterable, Optional

from services.cleaning_estimates import KNOWN_CLEAN_TYPES
from services.housekeeping_assignments import effective_room_status

# Mirrors the mobile `classifyRoomStatus` stages: these four are work still to do; CLEAN/INSPECTED are done; the
# out-of-service spellings and anything unrecognised are not housekeeping demand.
REMAINING_STATUSES = frozenset({"DIRTY", "OCCUPIED", "PICKUP", "IN_PROGRESS"})
CATEGORIES = ("departure", "stayover", "vacant_dirty", "other")

# (room_type_code, clean_type) -> learned minutes, or None.
Learned = Callable[[Optional[str], Optional[str]], Optional[float]]


@dataclass(frozen=True)
class RoomWork:
    room_id: str
    category: str                 # one of CATEGORIES
    minutes: Optional[int]        # None = unestimated
    basis: Optional[str]          # 'history' | 'room_type' | None
    source: str                   # 'room_board' (or a future-demand feed)
    assigned: Optional[bool]      # None where assignment does not apply (an expected PMS departure)


def resolve_clean_type(status_row: dict, assignment: Optional[dict]) -> Optional[str]:
    """Same precedence as GET /housekeeping/board: a checked-out room's own clean type wins over a dated assignment's."""
    if status_row.get("actual_checkout_at"):
        value = status_row.get("clean_type") or (assignment or {}).get("clean_type")
    else:
        value = (assignment or {}).get("clean_type") or status_row.get("clean_type")
    return value if value in KNOWN_CLEAN_TYPES else None


def category_of(clean_type: Optional[str], effective_status: Optional[str]) -> str:
    if clean_type == "DEP":
        return "departure"
    if clean_type in ("FULL", "LIGHT") or effective_status in ("PICKUP", "OCCUPIED"):
        return "stayover"
    if effective_status == "DIRTY":
        return "vacant_dirty"
    return "other"


def estimate_minutes(
    base_minutes: Optional[float],
    room_type_code: Optional[str],
    clean_type: Optional[str],
    effective_status: Optional[str],
    learned: Optional[Learned],
) -> tuple[Optional[int], Optional[str]]:
    if effective_status != "PICKUP" and learned is not None:
        found = learned(room_type_code, clean_type)
        if isinstance(found, (int, float)) and found > 0:
            return int(round(found)), "history"
    if isinstance(base_minutes, (int, float)) and base_minutes > 0:
        return int(round(base_minutes)), "room_type"
    return None, None


def board_work(
    rooms: Iterable[dict],
    assignments: dict[str, dict],
    learned: Optional[Learned],
) -> tuple[list[RoomWork], int]:
    """
    Remaining work from the live board. `rooms` are pre-joined room_status rows: room_id, status, fo_status, clean_type,
    actual_checkout_at, do_not_service, assigned_to, is_active, room_type_code, base_clean_minutes.
    Returns (work, rooms whose guest declined service).
    """
    work: list[RoomWork] = []
    seen: set[str] = set()
    declined = 0
    for row in rooms:
        room_id = str(row.get("room_id") or "")
        if not room_id or room_id in seen or row.get("is_active") is False:
            continue
        seen.add(room_id)
        assignment = assignments.get(room_id)
        clean_type = resolve_clean_type(row, assignment)
        status = effective_room_status(row.get("status"), clean_type, row.get("fo_status"))
        if status not in REMAINING_STATUSES:
            continue
        if row.get("do_not_service") is True:
            declined += 1
            continue
        minutes, basis = estimate_minutes(row.get("base_clean_minutes"), row.get("room_type_code"), clean_type, status, learned)
        assigned = bool(assignment.get("assigned_to") if assignment else row.get("assigned_to"))
        work.append(RoomWork(room_id, category_of(clean_type, status), minutes, basis, "room_board", assigned))
    return work, declined


def summarize(work: Iterable[RoomWork]) -> dict:
    """Totals and the per-category breakdown. `minutes` sums only estimated rooms: a LOWER BOUND when any is unestimated."""
    rows = list(work)
    by_category = []
    for category in CATEGORIES:
        items = [w for w in rows if w.category == category]
        if not items and category == "other":
            continue
        by_category.append({
            "category": category,
            "rooms": len(items),
            "minutes": sum(w.minutes for w in items if w.minutes is not None),
            "unestimated_rooms": sum(1 for w in items if w.minutes is None),
        })
    return {
        "rooms": len(rows),
        "minutes": sum(w.minutes for w in rows if w.minutes is not None),
        "unestimated_rooms": sum(1 for w in rows if w.minutes is None),
        "history_rooms": sum(1 for w in rows if w.basis == "history"),
        "by_category": by_category,
    }
