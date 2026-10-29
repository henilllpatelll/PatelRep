"""Housekeeping staffing forecast: demand + scheduled capacity -> an honest coverage statement per hotel-local day.

Pure (no database access); the loaders live in services/forecast_store.py. It builds on the Phase 1 contracts
(`QuantityFact`, `compare_capacity`) and never fabricates a number:

  verified      read from a system of record (a published shift, a room status, an open coverage gap)
  estimate      derived from real inputs by a stated rule (cleaning minutes, productive minutes)
  unavailable   the inputs are missing -- the value is null and the reason says what is missing

Coverage is `unknown` unless BOTH sides are known. When some demand is unestimated or not yet knowable, the demand is a
LOWER BOUND: it can prove "short" (even the known work exceeds the labour) but never "sufficient".

DEMAND SOURCES
  today    the live board (room_status): rooms still to clean, sized with the Assignments estimate rule. Departures that
           have not happened yet are not on the board, so they are not in the figure (a disclosed limitation).
  future   NONE today. The Opera sync (services/opera/sync.py) pulls ARRIVALS for today and tomorrow only and never
           refreshes cancellations, so opera_reservations is not a trustworthy departure forecast, and PatelRep has no
           stayover-service policy. A future day is therefore `unknown` -- never "sufficient". `ForecastData.future_work`
           is the seam: a feed that supplies reliable RoomWork per date makes those days calculable without other changes.
  Demand is a daily total. No service-window data exists, so no hourly gap is ever claimed (`time_window.available`).
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Callable, Optional

from services.scheduling import CapacityComparison, QuantityFact, compare_capacity, derive_workforce_status
from services.staffing_capacity import CapacityResult, additional_shifts, compute_capacity
from services.staffing_demand import Learned, RoomWork, board_work, summarize

MAX_FORECAST_DAYS = 7
MAX_BREAK_MINUTES = 120

ROOM_BOARD, FUTURE_DEMAND, SCHEDULED_SHIFTS = "room_board", "future_demand", "scheduled_shifts"


@dataclass
class ForecastData:
    now: datetime
    today: date
    assignments: list[dict]                          # shift_assignments for the window (incl. cancelled; ignored)
    person_kind: Callable[[str], str]
    absences: Optional[list[dict]]                   # None = unreadable
    leaves: Optional[list[dict]]
    gaps: list[dict]                                 # coverage_gaps for the HK department
    board: Optional[list[dict]]                      # None = unreadable
    board_assignments: dict[str, dict] = field(default_factory=dict)
    room_info: dict[str, dict] = field(default_factory=dict)
    learned: Optional[Learned] = None
    learned_available: bool = False
    hotel_name: Optional[str] = None
    pms_connected: Optional[bool] = None             # tenants.opera_pilot_enabled; only explains WHY future demand is missing
    future_work: Optional[dict[str, list[RoomWork]]] = None  # date -> reliable work from a future-demand feed (none exists yet)
    attendance: Optional[dict[str, dict]] = None     # today's latest hk_shift_sessions per user; None = not verified
    break_minutes: int = 0


# ---------------------------------------------------------------------------------------------------------------------

def fact_json(fact: QuantityFact, unit: str, calculated_at: datetime, assumptions: tuple[str, ...] = ()) -> dict:
    return {
        "value": fact.value, "unit": unit, "quality": fact.quality, "source": fact.source, "reason": fact.reason,
        "calculated_at": calculated_at.isoformat(), "assumptions": list(assumptions),
    }


def _unavailable(source: str, reason: str) -> QuantityFact:
    return QuantityFact(None, "unavailable", source, reason)


@dataclass
class _Demand:
    fact: QuantityFact
    complete: bool
    scope: str
    summary: Optional[dict] = None
    incomplete: list[str] = field(default_factory=list)
    limitations: list[str] = field(default_factory=list)
    declined: int = 0
    unassigned: Optional[int] = None
    sources: list[dict] = field(default_factory=list)


def _demand(day: date, d: ForecastData) -> _Demand:
    now = d.now
    limitations: list[str] = []
    if day == d.today:
        if d.board is None:
            return _Demand(_unavailable(ROOM_BOARD, "room_board_unreadable"), False, "unavailable", incomplete=["room_board_unreadable"],
                           sources=[{"code": ROOM_BOARD, "as_of": None, "quality": "unavailable", "stale": False}])
        work, declined = board_work(d.board, d.board_assignments, d.learned)
        limitations.append("later_departures_unknown")
        sources = [{"code": ROOM_BOARD, "as_of": now.isoformat(), "quality": "estimate", "stale": False}]
        scope, unassigned = "identified_work", sum(1 for w in work if w.assigned is False)
    else:
        feed = d.future_work.get(day.isoformat()) if d.future_work is not None else None
        if feed is None:
            reason = "pms_not_connected" if d.pms_connected is False else "future_demand_unavailable"
            return _Demand(_unavailable(FUTURE_DEMAND, reason), False, "unavailable", incomplete=[reason],
                           sources=[{"code": FUTURE_DEMAND, "as_of": None, "quality": "unavailable", "stale": False}])
        work, declined, unassigned = feed, 0, None
        sources, scope = [{"code": FUTURE_DEMAND, "as_of": now.isoformat(), "quality": "estimate", "stale": False}], "future_feed"

    summary = summarize(work)
    incomplete = ["unestimated_rooms"] if summary["unestimated_rooms"] else []
    if not d.learned_available:
        limitations.append("learned_estimates_unavailable")
    fact = QuantityFact(float(summary["minutes"]), "estimate", scope, None)
    return _Demand(fact, not incomplete, scope, summary, incomplete, limitations, declined, unassigned, sources)


def _compare(capacity: QuantityFact, demand: _Demand) -> tuple[CapacityComparison, bool]:
    """(comparison, is_minimum). Incomplete demand is a lower bound: it can prove 'short', never 'sufficient'."""
    if capacity.quality == "unavailable" or demand.fact.quality == "unavailable" or demand.complete:
        return compare_capacity(capacity, demand.fact), False
    gap = float(capacity.value) - float(demand.fact.value)  # type: ignore[arg-type]
    reasons = tuple(demand.incomplete)
    if gap < 0:
        return CapacityComparison("short", "estimate", capacity, demand.fact, gap, reasons), True
    return CapacityComparison("unknown", "unavailable", capacity, demand.fact, None, reasons), False


def _capacity(day: date, d: ForecastData) -> tuple[Optional[CapacityResult], QuantityFact, tuple[str, ...]]:
    assumptions = ("paid_shift_minutes_no_break_policy",) if d.break_minutes == 0 else ("scenario_break_minutes",)
    if d.absences is None or d.leaves is None:
        reason = "absences_unreadable" if d.absences is None else "leave_unreadable"
        return None, _unavailable(SCHEDULED_SHIFTS, reason), assumptions
    iso = day.isoformat()
    rows = [a for a in d.assignments if str(a.get("work_date"))[:10] == iso]
    filled = [str(g.get("filled_assignment_id")) for g in d.gaps if g.get("status") == "filled" and g.get("filled_assignment_id")]
    result = compute_capacity(
        rows, person_kind=d.person_kind, absences=d.absences, leaves=d.leaves, filled_assignment_ids=filled,
        now=d.now, is_today=day == d.today, break_minutes=d.break_minutes,
    )
    minutes = result.remaining_minutes if day == d.today else result.scheduled_minutes
    return result, QuantityFact(float(minutes or 0.0), "estimate", SCHEDULED_SHIFTS, None), assumptions


def _current(cap: CapacityResult, d: ForecastData) -> dict:
    if d.attendance is None:
        return {"verified": False, "scheduled_people": len(cap.attendant_ids)}
    tally: dict[str, int] = {}
    for user_id in cap.attendant_ids:
        status = derive_workforce_status(scheduled=True, session=d.attendance.get(user_id), attendance_verified=True, now=d.now)
        tally[status] = tally.get(status, 0) + 1
    return {"verified": True, "source": "hk_shift_sessions", "scheduled_people": len(cap.attendant_ids),
            "working": tally.get("working", 0), "on_break": tally.get("on_break", 0),
            "not_clocked_in": tally.get("not_clocked_in", 0), "clocked_out": tally.get("clocked_out", 0), "unknown": tally.get("unknown", 0)}


def forecast_day(day: date, d: ForecastData) -> dict:
    now = d.now
    demand = _demand(day, d)
    cap, cap_fact, assumptions = _capacity(day, d)
    cmp, is_minimum = _compare(cap_fact, demand)

    limitations = list(demand.limitations)
    blockers = list(demand.incomplete)
    if cap is not None:
        if cap.pending_callouts:
            limitations.append("pending_callouts")
        if cap.unknown_department_shifts:
            limitations.append("unknown_department_shifts")
        if cap.pending_leave_shifts:
            limitations.append("pending_leave")
    shortfall = -cmp.gap_minutes if cmp.status == "short" and cmp.gap_minutes is not None else None
    extra = additional_shifts(shortfall, cap.typical_shift_minutes if cap else None) if shortfall else None

    if cmp.status == "unknown":
        quality = "unavailable" if (cap_fact.quality == "unavailable" or demand.fact.quality == "unavailable") else "partial"
    else:
        quality = "partial" if (is_minimum or any(x in limitations for x in ("pending_callouts", "unknown_department_shifts"))) else "estimated"

    if cmp.status == "unknown":
        reason = next(iter(blockers), None) or ("capacity_unavailable" if cap_fact.quality == "unavailable" else "demand_incomplete")
        headline = {"code": "unknown", "reason": reason, "gap_minutes": None, "is_minimum": False}
    else:
        headline = {"code": cmp.status, "reason": None, "gap_minutes": round(abs(cmp.gap_minutes or 0)), "is_minimum": is_minimum}

    open_gaps = [
        {"gap_id": g.get("id"), "shift_name": g.get("shift_name"), "start_time": g.get("start_time"), "end_time": g.get("end_time"),
         "status": g.get("status"), "source": g.get("source")}
        for g in sorted(d.gaps, key=lambda g: (str(g.get("start_time")), str(g.get("id"))))
        if g.get("status") in ("open", "offered") and str(g.get("work_date"))[:10] == day.isoformat()
    ]
    scheduled_fact = QuantityFact(float(cap.scheduled_minutes), "estimate", SCHEDULED_SHIFTS, None) if cap else cap_fact
    out = {
        "date": day.isoformat(),
        "is_today": day == d.today,
        "status": cmp.status,
        "basis": cmp.basis,
        "forecast_quality": quality,
        "headline": headline,
        "demand": {
            "minutes": fact_json(demand.fact, "minutes", now),
            "complete": demand.complete,
            "scope": demand.scope,
            "rooms": demand.summary["rooms"] if demand.summary else None,
            "by_category": demand.summary["by_category"] if demand.summary else [],
            "unestimated_rooms": demand.summary["unestimated_rooms"] if demand.summary else None,
            "history_estimated_rooms": demand.summary["history_rooms"] if demand.summary else None,
            "declined_service_rooms": demand.declined if day == d.today else None,
            "unassigned_rooms": demand.unassigned,
            "incomplete_reasons": demand.incomplete,
        },
        "capacity": {
            "productive_minutes": fact_json(cap_fact, "minutes", now, assumptions),
            "full_day_minutes": fact_json(scheduled_fact, "minutes", now, assumptions),
            "measured_from": "now" if day == d.today else "shift_start",
            "people": len(cap.attendant_ids) if cap else None,
            "pools": [{"pool": "room_attendant", "people": len(cap.attendant_ids), "minutes": cap.scheduled_minutes}] if cap else [],
            "shifts": cap.shifts if cap else [],
            "confirmed_callouts": cap.confirmed_callouts if cap else None,
            "pending_callouts": cap.pending_callouts if cap else None,
            "replacements": cap.replacements if cap else None,
            "leave_reduced_shifts": cap.leave_reduced_shifts if cap else None,
            "pending_leave_shifts": cap.pending_leave_shifts if cap else None,
            "draft_shifts": cap.draft_shifts if cap else None,
            "other_housekeeping_staff": cap.other_hk_people if cap else None,
            "break_policy": "scenario" if d.break_minutes else "unknown",
            "break_minutes_per_shift": d.break_minutes,
        },
        "gap": {
            "minutes": round(cmp.gap_minutes) if cmp.gap_minutes is not None else None,
            "is_minimum": is_minimum,
            "additional_shifts": ({"value": extra, "quality": "estimate", "is_minimum": is_minimum,
                                   "basis": "typical_scheduled_shift", "typical_minutes": cap.typical_shift_minutes}
                                  if extra and cap else None),
        },
        "time_window": {"available": False, "reason": "no_service_window_data"},
        "current": _current(cap, d) if (day == d.today and cap is not None) else None,
        "open_gaps": open_gaps,
        "limitations": sorted(set(limitations)),
        "sources": demand.sources + [{"code": SCHEDULED_SHIFTS, "as_of": now.isoformat(), "quality": "estimate" if cap else "unavailable", "stale": False}],
        "calculated_at": now.isoformat(),
    }
    out["recommendations"] = recommendations(day, out)
    return out


# ---------------------------------------------------------------------------------------------------------------------
# Recommendations: deterministic, each tied to the facts that support it. Nothing here executes anything.

_KIND_ORDER = ("uncovered_shift", "unresolved_callout", "shortfall", "leave_conflict", "missing_estimates", "unassigned_rooms", "pending_leave")


def recommendations(day: date, f: dict) -> list[dict]:
    iso = day.isoformat()
    cap, dem = f["capacity"], f["demand"]
    found: list[dict] = []

    def add(kind: str, severity: str, basis: str, params: dict, action: Optional[dict], suffix: str = "") -> None:
        found.append({"id": f"{kind}:{iso}{suffix}", "kind": kind, "severity": severity, "basis": basis, "params": params, "action": action})

    for gap in f["open_gaps"][:5]:
        add("uncovered_shift", "attention", "verified",
            {"shift_name": gap["shift_name"], "start_time": gap["start_time"], "end_time": gap["end_time"], "date": iso},
            {"type": "find_coverage", "gap_id": gap["gap_id"], "date": iso}, f":{gap['gap_id']}")
    if cap["pending_callouts"]:
        add("unresolved_callout", "attention", "verified", {"count": cap["pending_callouts"], "date": iso}, {"type": "view_week", "date": iso})
    if f["status"] == "short":
        add("shortfall", "attention", "estimate",
            {"gap_minutes": f["gap"]["minutes"], "is_minimum": f["gap"]["is_minimum"], "date": iso,
             "additional_shifts": (f["gap"]["additional_shifts"] or {}).get("value")},
            {"type": "add_shift", "date": iso})
    if cap["leave_reduced_shifts"]:
        add("leave_conflict", "attention", "verified", {"count": cap["leave_reduced_shifts"], "date": iso}, {"type": "review_time_off", "date": iso})
    if dem["unestimated_rooms"]:
        add("missing_estimates", "attention", "verified", {"rooms": dem["unestimated_rooms"], "date": iso}, None)
    if dem["unassigned_rooms"]:
        add("unassigned_rooms", "info", "verified", {"rooms": dem["unassigned_rooms"], "date": iso}, {"type": "view_assignments", "date": iso})
    if cap["pending_leave_shifts"]:
        add("pending_leave", "info", "verified", {"count": cap["pending_leave_shifts"], "date": iso}, {"type": "review_time_off", "date": iso})
    found.sort(key=lambda r: (r["severity"] != "attention", _KIND_ORDER.index(r["kind"]), r["id"]))
    return found


def revision(d: ForecastData) -> str:
    """A fingerprint of every input, so a client can tell a changed forecast from a re-read of the same one."""
    parts = [f"a:{a.get('id')}:{a.get('version')}:{a.get('publication_state')}" for a in d.assignments]
    parts += [f"x:{a.get('id')}:{a.get('version')}:{a.get('status')}" for a in d.absences or []]
    parts += [f"l:{a.get('id')}:{a.get('version')}:{a.get('status')}" for a in d.leaves or []]
    parts += [f"g:{g.get('id')}:{g.get('version')}:{g.get('status')}" for g in d.gaps]
    parts += [f"r:{r.get('room_id')}:{r.get('status')}:{r.get('clean_type')}:{r.get('assigned_to')}:{r.get('updated_at')}" for r in d.board or []]
    parts += [f"b:{d.break_minutes}", f"t:{d.today}"]
    return hashlib.sha256("|".join(sorted(parts)).encode()).hexdigest()[:16]


def window(start: date, days: int) -> list[date]:
    return [start + timedelta(days=i) for i in range(days)]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)
