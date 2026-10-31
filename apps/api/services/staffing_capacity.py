"""Scheduled housekeeping labour for the staffing forecast, in elapsed productive minutes.

Pure (no database access). Inputs are the rows the scheduling phases already store:
  shift_assignments (a PLAN, with its own UTC starts_at/ends_at, so overnight shifts and DST are real elapsed time),
  absence_records (Phase 4), approved/pending time_off_requests (Phase 5), and filled coverage_gaps.

Rules (each is pinned by tests/smoke/test_staffing_forecast.py)
  * Only PUBLISHED shifts are capacity. Drafts are counted separately; cancelled shifts are ignored.
  * Only room attendants count towards room-cleaning capacity: HK department AND the `housekeeper` role. Supervisors
    and other staff are not assumed interchangeable (no inspection or public-area standard exists to size their work).
  * A confirmed or covered absence removes the original shift. A fill inserts a NEW assignment for the replacement
    (Phase 4), so the replacement is counted once, as its own shift, and the original is never counted again.
    A `reported` (unconfirmed) absence still counts but is surfaced as uncertain. `leaving_early` only shortens it.
  * Approved leave removes exactly the overlapping minutes (a partial day only part of the shift). Pending leave does
    not reduce capacity; it is surfaced.
  * Overlapping segments of one person are merged, so no minute is counted twice.
  * Breaks: PatelRep stores no break policy, so by default NO break is deducted and the figure is labelled
    "paid shift minutes". A caller may pass `break_minutes` as an explicit what-if; it is never persisted.
  * Attendance (hk_shift_sessions) is a different measure and is NOT read here -- scheduled capacity is the plan.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from math import ceil
from statistics import median
from typing import Callable, Iterable, Optional

Interval = tuple[datetime, datetime]

ATTENDANT = "attendant"
OTHER_HK = "other_hk"
OTHER_DEPARTMENT = "other_department"
UNKNOWN_DEPARTMENT = "unknown_department"


def parse_ts(value: object) -> Optional[datetime]:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _minutes(interval: Interval) -> float:
    return max((interval[1] - interval[0]).total_seconds() / 60, 0.0)


def merge_intervals(intervals: Iterable[Interval]) -> list[Interval]:
    merged: list[Interval] = []
    for start, end in sorted(intervals):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def subtract(interval: Interval, cuts: Iterable[Interval]) -> list[Interval]:
    pieces = [interval]
    for cut_start, cut_end in cuts:
        next_pieces: list[Interval] = []
        for start, end in pieces:
            if cut_end <= start or cut_start >= end:
                next_pieces.append((start, end))
                continue
            if cut_start > start:
                next_pieces.append((start, cut_start))
            if cut_end < end:
                next_pieces.append((cut_end, end))
        pieces = next_pieces
    return pieces


def classify_person(department_code: Optional[str], roles: Iterable[str]) -> str:
    if department_code is None:
        return UNKNOWN_DEPARTMENT
    if department_code != "HK":
        return OTHER_DEPARTMENT
    return ATTENDANT if "housekeeper" in set(roles) else OTHER_HK


@dataclass
class CapacityResult:
    attendant_ids: list[str] = field(default_factory=list)
    scheduled_minutes: float = 0.0
    remaining_minutes: Optional[float] = None       # today only: minutes still ahead of `now`
    shifts: list[dict] = field(default_factory=list)
    draft_shifts: int = 0
    confirmed_callouts: int = 0
    pending_callouts: int = 0
    replacements: int = 0
    leave_reduced_shifts: int = 0
    pending_leave_shifts: int = 0
    unknown_department_shifts: int = 0
    other_hk_people: int = 0
    typical_shift_minutes: Optional[float] = None
    break_minutes: int = 0


def compute_capacity(
    assignments: Iterable[dict],
    *,
    person_kind: Callable[[str], str],
    absences: Iterable[dict] = (),
    leaves: Iterable[dict] = (),
    filled_assignment_ids: Iterable[str] = (),
    now: datetime,
    is_today: bool,
    break_minutes: int = 0,
) -> CapacityResult:
    """Capacity for the assignments given (the caller passes ONE hotel-local work date's rows)."""
    result = CapacityResult(break_minutes=break_minutes)
    live_absence = {str(a.get("assignment_id")): a for a in absences if a.get("status") in ("reported", "confirmed", "covered")}
    approved: dict[str, list[Interval]] = {}
    pending: dict[str, list[Interval]] = {}
    for leave in leaves:
        window = (parse_ts(leave.get("starts_at")), parse_ts(leave.get("ends_at")))
        if window[0] is None or window[1] is None:
            continue
        target = approved if leave.get("status") == "approved" else pending if leave.get("status") == "pending" else None
        if target is not None:
            target.setdefault(str(leave.get("user_id")), []).append((window[0], window[1]))
    filled = set(filled_assignment_ids)

    per_user: dict[str, list[Interval]] = {}
    per_user_breaks: dict[str, int] = {}
    shift_rows: dict[str, dict] = {}
    segment_minutes: list[float] = []
    other_hk: set[str] = set()

    for row in assignments:
        state = row.get("publication_state")
        if state == "cancelled":
            continue
        user_id = str(row.get("user_id") or "")
        kind = person_kind(user_id)
        if kind == OTHER_DEPARTMENT:
            continue
        if kind == UNKNOWN_DEPARTMENT:
            result.unknown_department_shifts += 1
            continue
        if kind == OTHER_HK:
            other_hk.add(user_id)
            continue
        if state != "published":
            result.draft_shifts += 1
            continue
        start, end = parse_ts(row.get("starts_at")), parse_ts(row.get("ends_at"))
        if start is None or end is None or end <= start:
            continue

        absence = live_absence.get(str(row.get("id")))
        if absence is not None:
            if absence["status"] == "reported":
                result.pending_callouts += 1
            elif absence.get("kind") == "leaving_early" and parse_ts(absence.get("leaving_at")):
                end = min(end, parse_ts(absence["leaving_at"]))  # type: ignore[arg-type]
                if end <= start:
                    continue
            else:
                result.confirmed_callouts += 1
                continue

        pieces = subtract((start, end), approved.get(user_id, []))
        if sum(_minutes(p) for p in pieces) < _minutes((start, end)):
            result.leave_reduced_shifts += 1
        if any(cut_start < end and cut_end > start for cut_start, cut_end in pending.get(user_id, [])):
            result.pending_leave_shifts += 1
        if not pieces:
            continue

        if str(row.get("id")) in filled:
            result.replacements += 1
        piece_minutes = sum(_minutes(p) for p in pieces)
        deduction = min(break_minutes, piece_minutes)
        productive = piece_minutes - deduction
        per_user.setdefault(user_id, []).extend(pieces)
        per_user_breaks[user_id] = per_user_breaks.get(user_id, 0) + int(deduction)
        segment_minutes.append(productive)
        group = shift_rows.setdefault(str(row.get("shift_id") or row.get("id")), {
            "shift_id": row.get("shift_id"), "name": row.get("shift_name"), "start_time": row.get("start_time"),
            "end_time": row.get("end_time"), "people": set(), "productive_minutes": 0.0,
        })
        group["people"].add(user_id)
        group["productive_minutes"] += productive

    total = remaining = 0.0
    for user_id, pieces in per_user.items():
        merged = merge_intervals(pieces)
        union = sum(_minutes(m) for m in merged)
        ahead = sum(_minutes((max(s, now), e)) for s, e in merged if e > now) if is_today else 0.0
        breaks = per_user_breaks.get(user_id, 0)
        total += max(union - breaks, 0.0)
        if is_today and union > 0:
            remaining += max(ahead - breaks * (ahead / union), 0.0)
    result.attendant_ids = sorted(per_user)
    result.scheduled_minutes = round(total, 1)
    result.remaining_minutes = round(remaining, 1) if is_today else None
    result.other_hk_people = len(other_hk)
    result.shifts = sorted(
        ({**g, "people": len(g["people"]), "productive_minutes": round(g["productive_minutes"], 1)} for g in shift_rows.values()),
        key=lambda g: (str(g["start_time"]), str(g["name"])),
    )
    positive = [m for m in segment_minutes if m > 0]
    result.typical_shift_minutes = round(median(positive), 1) if positive else None
    return result


def additional_shifts(shortfall_minutes: float, typical_shift_minutes: Optional[float]) -> Optional[int]:
    """Whole extra typical shifts needed to close a shortfall, or None when there is no real shift length to size it."""
    if not typical_shift_minutes or typical_shift_minutes <= 0 or shortfall_minutes <= 0:
        return None
    return ceil(shortfall_minutes / typical_shift_minutes)
