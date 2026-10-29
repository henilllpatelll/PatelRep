"""Pure rules for employee availability, approved time off and shift-swap eligibility (no database access).

READ THIS BEFORE CHANGING A VERDICT. Three different things are easy to confuse and must stay apart:

  * AVAILABILITY is what an employee SAYS they can work. It is evidence for a supervisor, never a promise and never
    attendance. Silence is UNKNOWN, never "available": a day with no submitted rule yields `unknown`.
  * APPROVED TIME OFF is a supervisor's decision. It is an enforceable restriction: a shift that overlaps approved leave
    is a hard blocker (`approved_time_off`), mirrored by a database trigger (migration 227) so no write path can skip it.
    PENDING leave is only a warning; the employee has asked, nobody has decided.
  * A published SHIFT is the plan. Neither availability nor leave ever edits or deletes one; a mismatch is surfaced as a
    conflict for a supervisor to resolve through shift management or coverage.

Window convention: hotel-local wall-clock {"start": "HH:MM", "end": "HH:MM"}. `end` before `start` runs past midnight into
the next day (the window belongs to the weekday it starts on). `start == end` means a full 24 hours from that clock
(the editor's "All day" is 00:00-00:00). Everything is resolved with services.scheduling.resolve_occurrence, which
handles DST exactly as PostgreSQL's AT TIME ZONE does, so the API and the database agree.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone, tzinfo
from typing import Iterable, Optional, Sequence

from services.scheduling import _local_instant, parse_clock, resolve_occurrence

MAX_WINDOWS_PER_DAY = 4
FRESH_FOR = timedelta(days=90)          # availability not touched for this long is "stale", not "wrong"
Window = tuple[time, time]
Interval = tuple[datetime, datetime]

# Codes shared with coverage candidates, the shift form and the mobile i18n tables.
APPROVED_TIME_OFF = "approved_time_off"          # blocker
PENDING_TIME_OFF = "pending_time_off"            # warning
MARKED_UNAVAILABLE = "marked_unavailable"        # warning (employee said they cannot work that day)
OUTSIDE_AVAILABILITY = "outside_availability"    # warning (employee gave hours that do not cover the shift)
AVAILABILITY_UNKNOWN = "availability_unknown"    # informational
WITHIN_AVAILABILITY = "within_availability"      # reason

# Warnings a supervisor must acknowledge before committing (the rest only inform).
ACK_AVAILABILITY_WARNINGS = frozenset({MARKED_UNAVAILABLE, OUTSIDE_AVAILABILITY, PENDING_TIME_OFF})

_SEVERITY = {"unavailable": 3, "outside": 2, "unknown": 1, "available": 0}


# ---------------------------------------------------------------------------
# Windows
# ---------------------------------------------------------------------------

def parse_window(raw: object) -> Optional[Window]:
    if not isinstance(raw, dict):
        return None
    start, end = parse_clock(raw.get("start")), parse_clock(raw.get("end"))
    return (start, end) if start is not None and end is not None else None


def parse_windows(raw: object) -> list[Window]:
    """Valid windows only; a malformed entry is dropped rather than guessed at."""
    if not isinstance(raw, list):
        return []
    return [w for w in (parse_window(item) for item in raw) if w is not None]


def format_window(window: Window) -> dict:
    return {"start": window[0].strftime("%H:%M"), "end": window[1].strftime("%H:%M")}


def _minutes(window: Window) -> tuple[int, int]:
    start = window[0].hour * 60 + window[0].minute
    end = window[1].hour * 60 + window[1].minute
    if end <= start:  # overnight, or start == end = a full day
        end += 24 * 60
    return start, end


def window_error(windows: Sequence[Window]) -> Optional[str]:
    """None when the windows of ONE day are usable; else a stable code."""
    if not windows:
        return "windows_required"
    if len(windows) > MAX_WINDOWS_PER_DAY:
        return "too_many_windows"
    spans = sorted(_minutes(w) for w in windows)
    for (_, prev_end), (next_start, _) in zip(spans, spans[1:]):
        if next_start < prev_end:
            return "windows_overlap"
    return None


# ---------------------------------------------------------------------------
# Which rule applies to a date
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Rule:
    mode: str                       # 'available' | 'unavailable'
    windows: tuple[Window, ...]
    source: str                     # 'exception' | 'weekly'
    row_id: Optional[str] = None


def _as_date(value: object) -> Optional[date]:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def rule_for(day: date, weekly: Iterable[dict], exceptions: Iterable[dict]) -> Optional[Rule]:
    """A date-specific exception beats the recurring weekday rule; no rule at all means nothing was submitted."""
    for row in exceptions:
        if row.get("status", "active") == "active" and _as_date(row.get("exception_date")) == day:
            return Rule(str(row["mode"]), tuple(parse_windows(row.get("windows"))), "exception", str(row.get("id") or "") or None)
    best: Optional[dict] = None
    best_from: Optional[date] = None
    for row in weekly:
        if row.get("status", "active") != "active" or row.get("weekday") != day.weekday():
            continue
        start, end = _as_date(row.get("effective_from")), _as_date(row.get("effective_to"))
        if start is None or start > day or (end is not None and end < day):
            continue
        if best_from is None or start > best_from:
            best, best_from = row, start
    if best is None:
        return None
    return Rule(str(best["mode"]), tuple(parse_windows(best.get("windows"))), "weekly", str(best.get("id") or "") or None)


def local_day_bounds(day: date, zone: tzinfo) -> Interval:
    return _local_instant(day, time(0, 0), zone), _local_instant(day + timedelta(days=1), time(0, 0), zone)


def rule_intervals(day: date, rule: Rule, zone: tzinfo) -> list[Interval]:
    if rule.mode != "available":
        return []
    return [resolve_occurrence(day, start, end, zone) for start, end in rule.windows]


def _merge(intervals: list[Interval]) -> list[Interval]:
    merged: list[Interval] = []
    for start, end in sorted(intervals):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def _covered(segment: Interval, merged: list[Interval]) -> bool:
    return any(start <= segment[0] and segment[1] <= end for start, end in merged)


# ---------------------------------------------------------------------------
# Verdict for one shift window
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class AvailabilityVerdict:
    status: str                      # 'available' | 'outside' | 'unavailable' | 'unknown'
    days: tuple[tuple[str, str, Optional[str]], ...] = ()    # (iso date, day status, rule source)

    def as_dict(self) -> dict:
        return {"status": self.status, "days": [{"date": d, "status": s, "source": src} for d, s, src in self.days]}


def evaluate_availability(
    starts_at: datetime, ends_at: datetime, weekly: Sequence[dict], exceptions: Sequence[dict], zone: tzinfo,
) -> AvailabilityVerdict:
    """
    Does the submitted availability cover [starts_at, ends_at)? A shift that spans midnight is judged day by day, and an
    overnight window from the day before can cover the early hours of the next. The worst day wins:
    unavailable > outside > unknown > available.
    """
    first = starts_at.astimezone(zone).date()
    last = (ends_at - timedelta(microseconds=1)).astimezone(zone).date()
    covered: list[Interval] = []
    day = first - timedelta(days=1)
    while day <= last:
        rule = rule_for(day, weekly, exceptions)
        if rule is not None:
            covered.extend(rule_intervals(day, rule, zone))
        day += timedelta(days=1)
    merged = _merge(covered)

    per_day: list[tuple[str, str, Optional[str]]] = []
    day = first
    while day <= last:
        low, high = local_day_bounds(day, zone)
        segment = (max(starts_at, low), min(ends_at, high))
        if segment[0] < segment[1]:
            rule = rule_for(day, weekly, exceptions)
            if rule is not None and rule.mode == "unavailable":
                state = "unavailable"
            elif _covered(segment, merged):
                state = "available"
            elif rule is None:
                state = "unknown"
            else:
                state = "outside"
            per_day.append((day.isoformat(), state, rule.source if rule else None))
        day += timedelta(days=1)
    if not per_day:
        return AvailabilityVerdict("unknown")
    worst = max((s for _, s, _ in per_day), key=_SEVERITY.__getitem__)
    return AvailabilityVerdict(worst, tuple(per_day))


# ---------------------------------------------------------------------------
# Leave overlap and the combined assessment
# ---------------------------------------------------------------------------

def _ts(value: object) -> Optional[datetime]:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def leave_overlapping(starts_at: datetime, ends_at: datetime, leave_rows: Iterable[dict], status: str) -> list[dict]:
    out = []
    for row in leave_rows:
        if row.get("status") != status:
            continue
        low, high = _ts(row.get("starts_at")), _ts(row.get("ends_at"))
        if low is not None and high is not None and low < ends_at and starts_at < high:
            out.append(row)
    return out


@dataclass
class Assessment:
    """Everything a supervisor needs to know about putting ONE person on ONE window, with reasons."""
    status: str = "unknown"                       # availability verdict
    blockers: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    reasons: list[str] = field(default_factory=list)
    leave: list[dict] = field(default_factory=list)     # leave rows that overlap (id/status/dates only)
    detail: dict = field(default_factory=dict)


def assess_window(
    starts_at: datetime, ends_at: datetime, *, weekly: Sequence[dict], exceptions: Sequence[dict],
    leave: Sequence[dict], zone: tzinfo,
) -> Assessment:
    out = Assessment()
    approved = leave_overlapping(starts_at, ends_at, leave, "approved")
    pending = leave_overlapping(starts_at, ends_at, leave, "pending")
    if approved:
        out.blockers.append(APPROVED_TIME_OFF)
    if pending:
        out.warnings.append(PENDING_TIME_OFF)
    out.leave = [{"id": r.get("id"), "status": r.get("status"), "start_date": str(r.get("start_date"))[:10],
                  "end_date": str(r.get("end_date"))[:10]} for r in approved + pending]
    verdict = evaluate_availability(starts_at, ends_at, weekly, exceptions, zone)
    out.status = verdict.status
    out.detail = verdict.as_dict()
    if verdict.status == "unavailable":
        out.warnings.append(MARKED_UNAVAILABLE)
    elif verdict.status == "outside":
        out.warnings.append(OUTSIDE_AVAILABILITY)
    elif verdict.status == "unknown":
        out.warnings.append(AVAILABILITY_UNKNOWN)
    else:
        out.reasons.append(WITHIN_AVAILABILITY)
    return out


# ---------------------------------------------------------------------------
# Weekly view (what the editor and the supervisor list show)
# ---------------------------------------------------------------------------

def weekly_summary(on: date, weekly: Sequence[dict]) -> list[dict]:
    """
    Seven entries Monday..Sunday: the rule that applies from the NEXT occurrence of each weekday on or after `on`
    (available with windows / unavailable / unset). Used for "what is in force now" and, with a later date, "what takes over".
    """
    out = []
    for weekday in range(7):
        rule = rule_for(on + timedelta(days=(weekday - on.weekday()) % 7), weekly, [])
        if rule is None:
            out.append({"weekday": weekday, "state": "unset", "windows": []})
        else:
            out.append({"weekday": weekday, "state": rule.mode, "windows": [format_window(w) for w in rule.windows],
                        "rule_id": rule.row_id})
    return out


def freshness(last_updated: Optional[datetime], now: datetime) -> str:
    """'none' (nothing submitted), 'current' (touched within 90 days) or 'stale'. Recency, not verification."""
    if last_updated is None:
        return "none"
    return "current" if now - last_updated <= FRESH_FOR else "stale"


# ---------------------------------------------------------------------------
# Time-off request windows and validation
# ---------------------------------------------------------------------------

MAX_LEAVE_DAYS = 60
LEAVE_REASONS = ("vacation", "personal", "family", "appointment", "health", "other")


def leave_window(
    start_date: date, end_date: date, zone: tzinfo, *, partial: bool = False,
    start_time: Optional[time] = None, end_time: Optional[time] = None,
) -> Interval:
    """The resolved UTC window of a request: whole local days, or one day's partial hours (overnight allowed)."""
    if partial:
        assert start_time is not None and end_time is not None
        return resolve_occurrence(start_date, start_time, end_time, zone)
    return _local_instant(start_date, time(0, 0), zone), _local_instant(end_date + timedelta(days=1), time(0, 0), zone)


def leave_error(
    start_date: date, end_date: date, today: date, *, partial: bool, start_time: Optional[time], end_time: Optional[time],
) -> Optional[str]:
    """None when a request is well formed; else a stable code. (No notice-period policy exists, so none is enforced.)"""
    if end_date < start_date:
        return "end_before_start"
    if end_date < today:
        return "dates_in_past"
    if (end_date - start_date).days + 1 > MAX_LEAVE_DAYS:
        return "range_too_long"
    if partial:
        if start_date != end_date:
            return "partial_must_be_one_day"
        if start_time is None or end_time is None or start_time == end_time:
            return "invalid_partial_times"
    elif start_time is not None or end_time is not None:
        return "times_need_partial"
    return None


def shifts_overlapping(window: Interval, shifts: Iterable[dict]) -> list[dict]:
    """The published shifts that overlap a window (the staffing consequence of leave, from real schedule rows)."""
    out = []
    for row in shifts:
        low, high = _ts(row.get("starts_at")), _ts(row.get("ends_at"))
        if low is not None and high is not None and low < window[1] and window[0] < high:
            out.append(row)
    return sorted(out, key=lambda r: str(r.get("starts_at")))


# ---------------------------------------------------------------------------
# Swaps
# ---------------------------------------------------------------------------

SWAP_TTL = timedelta(hours=72)
SWAP_MIN_LEAD = timedelta(hours=2)       # a shift that starts sooner than this cannot be swapped through the app


def swap_expiry(now: datetime, *shift_starts: datetime) -> datetime:
    """A proposal lapses after 72 hours or when the earlier shift starts, whichever is first."""
    return min([now + SWAP_TTL, *shift_starts])


def effective_swap_status(swap: dict, now: datetime) -> str:
    """A `proposed` swap past its expiry reads as `expired` even before anything has written that down."""
    if swap.get("status") == "proposed":
        expires = _ts(swap.get("expires_at"))
        if expires is not None and expires <= now:
            return "expired"
    return str(swap.get("status"))


def swap_problem(a: dict, b: dict, now: datetime) -> Optional[str]:
    """
    Reasons two shifts can never be exchanged, from their own rows (the database function re-checks them under lock).
    `a` is the requester's shift, `b` the counterpart's.
    """
    for row in (a, b):
        if row.get("publication_state") != "published":
            return "shift_not_published"
        low = _ts(row.get("starts_at"))
        if low is None or low - now < SWAP_MIN_LEAD:
            return "shift_too_soon"
        if row.get("clocked_in_at"):
            return "shift_has_attendance"
    if a.get("department_id") != b.get("department_id"):
        return "different_departments"
    if str(a.get("user_id")) == str(b.get("user_id")):
        return "same_person"
    a_low, a_high, b_low, b_high = _ts(a.get("starts_at")), _ts(a.get("ends_at")), _ts(b.get("starts_at")), _ts(b.get("ends_at"))
    if None in (a_low, a_high, b_low, b_high):
        return "shift_times_unknown"
    if a_low < b_high and b_low < a_high:
        return "shifts_overlap"
    return None
