"""Which shift occurrences are due an AI handoff summary right now — pure, no I/O.

An *occurrence* is one shift template on one hotel-local calendar start date
(`shift_date`), exactly the identity `shift_summaries` is keyed on. The cron
may only summarise an occurrence when ALL of these hold:

  1. it actually ran that day (the caller supplies the set of "worked" keys:
     a published schedule assignment or a logbook entry for that shift/date);
  2. it has ENDED, in the tenant's own timezone, at least GRACE ago (staff get
     time to finish logging);
  3. it ended no more than LOOKBACK ago (a bounded catch-up window).

LOOKBACK must exceed the cron cadence plus GRACE, otherwise an occurrence can
end, wait out its grace, and age out between two runs without ever being seen.
`tests/test_shift_summary_eligibility.py` asserts that against CRON_SCHEDULE.
"""
from dataclasses import dataclass
from datetime import date, datetime, time as time_cls, timedelta, timezone, tzinfo
from typing import Iterable, Optional

from dateutil import tz as dateutil_tz

GRACE = timedelta(hours=2)
LOOKBACK = timedelta(hours=24)


def parse_wall_time(value) -> time_cls:
    hours, minutes, *_ = str(value).split(":")
    return time_cls(int(hours), int(minutes))


def local_to_utc(day: date, wall: time_cls, tz: tzinfo, *, later: bool) -> datetime:
    """Resolve a hotel-local wall-clock time to a real UTC instant across DST.

    Spring-forward gap (that wall time never happened): moved forward by the gap,
    the same instant a clock reading it would show. Fall-back overlap (it
    happened twice): `later=True` picks the second pass, which is what an END
    must use so a shift is never treated as finished while still running;
    `later=False` picks the first pass (used for starts).
    """
    naive = datetime.combine(day, wall.replace(tzinfo=None))
    local = naive.replace(tzinfo=tz)
    if not dateutil_tz.datetime_exists(local):
        local = dateutil_tz.resolve_imaginary(local)
    elif dateutil_tz.datetime_ambiguous(local):
        local = dateutil_tz.enfold(local, fold=1 if later else 0)
    return local.astimezone(timezone.utc)


def occurrence_window(tz: tzinfo, start_time, end_time, shift_date: date) -> tuple[datetime, datetime]:
    """Real UTC [start, end) of a template on a local start date. Overnight
    templates (end <= start) end on the following local day."""
    start_wall = parse_wall_time(start_time)
    end_wall = parse_wall_time(end_time)
    end_day = shift_date if end_wall > start_wall else shift_date + timedelta(days=1)
    return (
        local_to_utc(shift_date, start_wall, tz, later=False),
        local_to_utc(end_day, end_wall, tz, later=True),
    )


@dataclass(frozen=True)
class Occurrence:
    tenant_id: str
    shift_id: str
    shift_date: str
    ends_at: datetime


def candidate_dates(tz: tzinfo, now: datetime, lookback: timedelta = LOOKBACK) -> list[date]:
    """Local start dates that could still own an eligible occurrence: from one
    day before the lookback horizon (overnight shifts start the day before they
    end) through the tenant's current local date."""
    first = (now - lookback).astimezone(tz).date() - timedelta(days=1)
    last = now.astimezone(tz).date()
    days = (last - first).days
    return [first + timedelta(days=i) for i in range(days + 1)]


def due_occurrences(
    tenant_id: str,
    tz: tzinfo,
    shifts: Iterable[dict],
    worked: set[tuple[str, str]],
    now: datetime,
    *,
    published_ends: Optional[dict[tuple[str, str], datetime]] = None,
    grace: timedelta = GRACE,
    lookback: timedelta = LOOKBACK,
) -> list[Occurrence]:
    """Occurrences of `shifts` that are worked, finished, past grace and in lookback.

    `worked` holds (shift_id, 'YYYY-MM-DD'). `published_ends` optionally carries
    the latest published-assignment end for an occurrence; the LATER of that and
    the template end wins so an edited-longer occurrence is never summarised early.
    """
    published_ends = published_ends or {}
    due: list[Occurrence] = []
    for shift in shifts:
        if not shift.get("start_time") or not shift.get("end_time"):
            continue
        for day in candidate_dates(tz, now, lookback):
            key = (shift["id"], day.isoformat())
            if key not in worked:
                continue
            _, ends_at = occurrence_window(tz, shift["start_time"], shift["end_time"], day)
            ends_at = max(ends_at, published_ends.get(key, ends_at))
            if now - ends_at < grace:
                continue  # still running, or inside the staff logging grace
            if now - ends_at > lookback:
                continue  # aged out of the catch-up window
            due.append(Occurrence(tenant_id, shift["id"], day.isoformat(), ends_at))
    due.sort(key=lambda o: (o.ends_at, o.shift_id))
    return due


def max_gap_between_runs(hours_spec, minute: int = 0) -> timedelta:
    """Longest wall gap between consecutive daily runs of an APScheduler
    `hour` spec such as "7,15,23" (including the wrap past midnight)."""
    hours = sorted({int(h) for h in str(hours_spec).split(",")})
    gaps = [(b - a) for a, b in zip(hours, hours[1:])] + [24 - hours[-1] + hours[0]]
    return timedelta(hours=max(gaps))
