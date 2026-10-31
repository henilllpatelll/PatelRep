"""Scheduling rules shared by routers/scheduling.py (the plan) and routers/shifts.py (actual attendance).

Pure functions and small typed contracts only -- no database access -- so every rule is unit-testable and the two
routers cannot drift apart. It sits in services/ because two domains use it (the CLAUDE.md A1 rule).

SCHEDULE vs ATTENDANCE (the rules every consumer must follow)
  * A shift_assignments row is a PLAN. It never proves anyone is working.
  * Actual attendance has exactly one source of truth: hk_shift_sessions (routers/shifts.py). The legacy
    shift_assignments.is_on_shift / clocked_in_at / clocked_out_at columns are kept for the existing web consumer and
    are NOT read here.
  * Room assignments (room_assignments) say nothing about attendance either.
  * `derive_workforce_status` is the single server-side interpretation of the two together; it mirrors the mobile
    `normalizeRoster` rules (apps/mobile/lib/housekeeping/supervisorTeam.ts) and a contract test pins the shared
    16-hour "implausibly old open shift" threshold.

  scheduled        has a shift in the plan; no attendance claim is made (future/past day, or attendance not asked for)
  working          a verified, recent, open hk_shift_sessions row with status active
  on_break         a verified, recent, open session with status on_break
  clocked_out      the person's session for the day has ended
  not_clocked_in   attendance WAS verified and there is no session for a scheduled person. This is NOT "absent":
                   being absent needs an explicit absence record (a later phase); until then nobody is confirmed_absent
  unknown          attendance could not be verified (read failed, or an open session too old to trust)
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone, tzinfo
from typing import Iterable, Literal, Optional

from dateutil import tz

# An open hk_shift_sessions row older than this was almost certainly never closed out. Same value as the mobile app's
# MAX_PLAUSIBLE_OPEN_SHIFT_MS (pinned by tests/smoke/test_scheduling_foundation.py).
MAX_PLAUSIBLE_OPEN_SHIFT = timedelta(hours=16)

DEFAULT_TIMEZONE = "America/Chicago"

WorkforceStatus = Literal["scheduled", "working", "on_break", "clocked_out", "not_clocked_in", "unknown"]


# ---------------------------------------------------------------------------
# Time: hotel-local wall clock -> UTC instants (overnight + DST)
# ---------------------------------------------------------------------------

def parse_clock(value: object) -> Optional[time]:
    """'07:00' / '07:00:00' -> time, else None. Seconds are accepted but dropped (shifts are minute-granular)."""
    if isinstance(value, time):
        return value.replace(second=0, microsecond=0)
    if not isinstance(value, str):
        return None
    parts = value.strip().split(":")
    if len(parts) not in (2, 3) or not all(p.isdigit() and len(p) in (1, 2) for p in parts):
        return None
    hour, minute = int(parts[0]), int(parts[1])
    if hour > 23 or minute > 59 or (len(parts) == 3 and int(parts[2]) > 59):
        return None
    return time(hour, minute)


def format_clock(value: time) -> str:
    return value.strftime("%H:%M:%S")


def _local_instant(day: date, clock: time, zone: tzinfo) -> datetime:
    """
    Wall-clock `day clock` in `zone` as a UTC instant, resolved exactly as PostgreSQL's AT TIME ZONE does so the
    API and the migration-225 trigger can never disagree:
      * a time that does not exist (spring-forward gap) uses the offset from BEFORE the transition
        (02:30 -> 08:30Z in Chicago, i.e. 03:30 CDT);
      * a time that occurs twice (fall-back) uses standard time, the LATER of the two instants.
    """
    naive = datetime.combine(day, clock)
    if not tz.datetime_exists(naive, zone):
        # dateutil shifts a gap time forward by the gap width, which is the same instant as the pre-transition offset.
        naive = tz.resolve_imaginary(naive.replace(tzinfo=zone)).replace(tzinfo=None)
    aware = naive.replace(tzinfo=zone, fold=1 if tz.datetime_ambiguous(naive, zone) else 0)
    return aware.astimezone(timezone.utc)


def resolve_occurrence(work_date: date, start: time, end: time, zone: tzinfo) -> tuple[datetime, datetime]:
    """
    (starts_at, ends_at) in UTC for a shift worked on `work_date`. An end at or before the start is an overnight
    shift that ends on the next calendar day. Computed on wall-clock time, so a DST change makes the shift 1h
    shorter or longer in real time instead of producing an error.
    """
    starts = _local_instant(work_date, start, zone)
    end_day = work_date + timedelta(days=1) if end <= start else work_date
    return starts, _local_instant(end_day, end, zone)


# ---------------------------------------------------------------------------
# Occurrences, conflicts and warnings
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Occurrence:
    """One person on one dated, timed shift (a row of shift_assignments, existing or proposed)."""
    user_id: str
    shift_id: str
    work_date: date
    starts_at: datetime
    ends_at: datetime
    id: Optional[str] = None

    @property
    def hours(self) -> float:
        return (self.ends_at - self.starts_at).total_seconds() / 3600


def overlaps(a: Occurrence, b: Occurrence) -> bool:
    """Half-open [starts_at, ends_at): back-to-back shifts (one ends exactly when the next starts) do not overlap."""
    return a.starts_at < b.ends_at and b.starts_at < a.ends_at


@dataclass(frozen=True)
class Conflict:
    code: Literal["duplicate_assignment", "overlapping_shift"]
    user_id: str
    work_date: date
    with_assignment_id: Optional[str]  # None when the other side is part of the same request

    def as_dict(self) -> dict:
        return {
            "code": self.code,
            "user_id": self.user_id,
            "work_date": self.work_date.isoformat(),
            "with_assignment_id": self.with_assignment_id,
        }


def find_conflicts(proposed: Iterable[Occurrence], existing: Iterable[Occurrence]) -> list[Conflict]:
    """
    Hard scheduling errors. `existing` is what is already stored (callers exclude the row being edited).
    Within `proposed`, two entries for the same person on the same shift and date are a duplicate; any other
    overlap between a proposed entry and another proposed or stored entry is an overlapping shift.
    """
    proposed = list(proposed)
    existing = list(existing)
    conflicts: list[Conflict] = []
    for index, item in enumerate(proposed):
        for other in proposed[index + 1:]:
            if other.user_id != item.user_id:
                continue
            if other.shift_id == item.shift_id and other.work_date == item.work_date:
                conflicts.append(Conflict("duplicate_assignment", item.user_id, item.work_date, None))
            elif overlaps(item, other):
                conflicts.append(Conflict("overlapping_shift", item.user_id, item.work_date, None))
        for other in existing:
            if other.user_id == item.user_id and overlaps(item, other):
                conflicts.append(Conflict("overlapping_shift", item.user_id, item.work_date, other.id))
    return conflicts


WarningSeverity = Literal["warn", "block", "off"]

# Operational warnings are policy, not law: a hotel may decide that overtime is acceptable (warn) or forbidden
# (block). Phase 1 ships every rule as `warn` so existing callers keep working; the mapping is the seam a later
# phase connects to a per-hotel setting. Hard errors (overlap, duplicate, invalid time, inactive employee,
# department mismatch) are never configurable.
DEFAULT_WARNING_POLICY: dict[str, WarningSeverity] = {
    "insufficient_rest": "warn",
    "weekly_overtime": "warn",
    "long_shift": "warn",
    "past_date": "warn",
    "employee_department_unknown": "warn",
}
MIN_REST = timedelta(hours=8)
WEEKLY_OVERTIME_HOURS = 40.0
LONG_SHIFT_HOURS = 12.0


@dataclass(frozen=True)
class ScheduleWarning:
    code: str
    user_id: str
    work_date: date
    detail: str
    severity: WarningSeverity = "warn"

    def as_dict(self) -> dict:
        return {
            "code": self.code,
            "user_id": self.user_id,
            "work_date": self.work_date.isoformat(),
            "detail": self.detail,
            "severity": self.severity,
        }


def _week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())  # Monday


def compute_warnings(
    proposed: Iterable[Occurrence],
    existing: Iterable[Occurrence],
    *,
    hotel_today: date,
    unknown_department_users: Iterable[str] = (),
    policy: Optional[dict[str, WarningSeverity]] = None,
) -> list[ScheduleWarning]:
    """
    Operational warnings for `proposed` against everything else the person is scheduled on (`existing` should
    include the neighbouring days and the whole Monday-Sunday week of each proposed date). Rules set to 'off' are
    dropped; rules set to 'block' are returned with severity 'block' for the caller to refuse.
    """
    rules = {**DEFAULT_WARNING_POLICY, **(policy or {})}
    proposed = list(proposed)
    others = list(existing)
    found: list[ScheduleWarning] = []

    def add(code: str, item: Occurrence, detail: str) -> None:
        severity = rules.get(code, "warn")
        if severity != "off":
            found.append(ScheduleWarning(code, item.user_id, item.work_date, detail, severity))

    unknown = set(unknown_department_users)
    for item in proposed:
        peers = [o for o in others + proposed if o.user_id == item.user_id and o is not item and (item.id is None or o.id != item.id)]
        if item.hours > LONG_SHIFT_HOURS:
            add("long_shift", item, f"Shift is {item.hours:.1f} hours long.")
        if item.work_date < hotel_today:
            add("past_date", item, "Shift is on a date that has already passed.")
        if item.user_id in unknown:
            add("employee_department_unknown", item, "The employee's department could not be determined.")
        for other in peers:
            gap = (item.starts_at - other.ends_at) if item.starts_at >= other.ends_at else (other.starts_at - item.ends_at)
            if timedelta(0) <= gap < MIN_REST and not overlaps(item, other):
                add("insufficient_rest", item, f"Only {gap.total_seconds() / 3600:.1f} hours between two shifts.")
                break
        week = _week_start(item.work_date)
        total = item.hours + sum(o.hours for o in peers if _week_start(o.work_date) == week)
        if total > WEEKLY_OVERTIME_HOURS:
            add("weekly_overtime", item, f"{total:.1f} scheduled hours in the week of {week.isoformat()}.")
    return found


# ---------------------------------------------------------------------------
# Attendance interpretation (reuses the roster rows from routers/shifts.py)
# ---------------------------------------------------------------------------

def _parse_ts(value: object) -> Optional[datetime]:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def derive_workforce_status(
    *,
    scheduled: bool,
    session: Optional[dict],
    attendance_verified: bool,
    now: datetime,
) -> WorkforceStatus:
    """
    One person's status for the day being asked about. `session` is that person's latest hk_shift_sessions row from
    the roster read (or None); `attendance_verified` is whether that roster read succeeded. See the module docstring
    for what each value means. Never infers attendance from rooms or from the plan.
    """
    if not attendance_verified:
        return "unknown"
    if session is None:
        return "not_clocked_in" if scheduled else "scheduled"
    status = session.get("status")
    if status == "ended":
        return "clocked_out"
    if status in ("active", "on_break"):
        started = _parse_ts(session.get("started_at"))
        if started is None or now - started > MAX_PLAUSIBLE_OPEN_SHIFT:
            return "unknown"
        return "working" if status == "active" else "on_break"
    return "unknown"


# ---------------------------------------------------------------------------
# Capacity vs demand contract (consumed by the later coverage engine; no new model here)
# ---------------------------------------------------------------------------

DataQuality = Literal["verified", "estimate", "unavailable"]


@dataclass(frozen=True)
class QuantityFact:
    """
    A number with its provenance, so a UI can tell a verified fact from an estimate from missing data.
    verified     = read from a system of record (e.g. scheduled minutes from published assignments)
    estimate     = derived from PatelRep's existing workload data (room_types.base_clean_minutes, housekeeper_profiles
                   rolling averages, the property's workload/capacity settings) -- never a new duration model
    unavailable  = the inputs needed to know it are missing; `value` is None and `reason` says what is missing
    """
    value: Optional[float]
    quality: DataQuality
    source: str
    reason: Optional[str] = None

    def __post_init__(self) -> None:
        if (self.quality == "unavailable") != (self.value is None):
            raise ValueError("a QuantityFact is unavailable if and only if it has no value")


@dataclass(frozen=True)
class CapacityComparison:
    """
    Scheduled capacity against expected housekeeping demand. `status` is 'unknown' unless BOTH sides are known:
    PatelRep never reports staffing as sufficient (or short) from missing data. `basis` is 'verified' only when
    both inputs are verified; any estimate makes the comparison an estimate.
    """
    status: Literal["sufficient", "short", "unknown"]
    basis: DataQuality
    capacity_minutes: QuantityFact
    demand_minutes: QuantityFact
    gap_minutes: Optional[float] = None
    reasons: tuple[str, ...] = field(default_factory=tuple)


def compare_capacity(capacity: QuantityFact, demand: QuantityFact) -> CapacityComparison:
    missing = tuple(
        f"{name}: {fact.reason or 'unavailable'}"
        for name, fact in (("capacity", capacity), ("demand", demand))
        if fact.quality == "unavailable"
    )
    if missing:
        return CapacityComparison("unknown", "unavailable", capacity, demand, None, missing)
    gap = float(capacity.value) - float(demand.value)  # type: ignore[arg-type]
    basis: DataQuality = "verified" if capacity.quality == demand.quality == "verified" else "estimate"
    return CapacityComparison("sufficient" if gap >= 0 else "short", basis, capacity, demand, gap)
