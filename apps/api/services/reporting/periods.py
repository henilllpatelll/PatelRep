"""Reporting date semantics shared by every report endpoint.

Contract
--------
* A reporting period is a pair of hotel-local calendar dates (``start`` and
  ``end``, both inclusive from the user's point of view).
* Internally it is the half-open UTC interval ``[start_utc, end_utc)`` where
  ``start_utc`` is local midnight of ``start`` and ``end_utc`` is local midnight
  of the day AFTER ``end`` — so the whole final calendar day is included and
  DST days (23h/25h) are measured correctly.
* ``end`` may not be in the future (hotel-local) and ``start`` may not be after
  ``end``; ranges are bounded to ``MAX_RANGE_DAYS`` so aggregation stays cheap.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException

DEFAULT_TIMEZONE = "America/Chicago"  # Texas hotels (product scope)
DEFAULT_RANGE_DAYS = 30
MAX_RANGE_DAYS = 366


def resolve_timezone(name: Optional[str]) -> ZoneInfo:
    """Return the hotel's ZoneInfo, falling back to the product default."""
    for candidate in (name, DEFAULT_TIMEZONE):
        if not candidate:
            continue
        try:
            return ZoneInfo(candidate)
        except (ZoneInfoNotFoundError, ValueError):
            continue
    return ZoneInfo("UTC")


def hotel_timezone(supabase, hotel_id: str) -> ZoneInfo:
    """Look up ``tenants.timezone`` for the hotel (never raises)."""
    try:
        row = supabase.table("tenants").select("timezone").eq("id", hotel_id).maybe_single().execute()
        name = (row.data or {}).get("timezone") if row else None
    except Exception:  # pragma: no cover - defensive: reporting must not 500 on tz lookup
        name = None
    return resolve_timezone(name)


def local_today(tz: ZoneInfo, now: Optional[datetime] = None) -> date:
    moment = now or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(tz).date()


def local_midnight_utc(day: date, tz: ZoneInfo) -> datetime:
    """UTC instant of local midnight at the start of ``day`` (DST-safe)."""
    return datetime.combine(day, time.min, tzinfo=tz).astimezone(timezone.utc)


@dataclass(frozen=True)
class ReportPeriod:
    start: date
    end: date  # inclusive local calendar day
    tz_name: str
    start_utc: datetime  # inclusive
    end_utc: datetime  # exclusive

    @property
    def days(self) -> int:
        return (self.end - self.start).days + 1

    def as_dict(self) -> dict:
        return {
            "start": self.start.isoformat(),
            "end": self.end.isoformat(),
            "timezone": self.tz_name,
            "days": self.days,
        }

    @property
    def start_iso(self) -> str:
        return self.start_utc.isoformat()

    @property
    def end_iso(self) -> str:
        return self.end_utc.isoformat()


def build_period(start: date, end: date, tz: ZoneInfo) -> ReportPeriod:
    return ReportPeriod(
        start=start,
        end=end,
        tz_name=getattr(tz, "key", "UTC"),
        start_utc=local_midnight_utc(start, tz),
        end_utc=local_midnight_utc(end + timedelta(days=1), tz),
    )


def resolve_period(
    start_date: Optional[date],
    end_date: Optional[date],
    tz: ZoneInfo,
    *,
    default_days: int = DEFAULT_RANGE_DAYS,
    now: Optional[datetime] = None,
    allow_future_end: bool = False,
) -> ReportPeriod:
    """Validate and resolve a user-supplied range into a ``ReportPeriod``.

    Missing ``end_date`` -> hotel-local today. Missing ``start_date`` -> ``default_days``
    before ``end`` (so a default of 30 covers 30 calendar days *including* the end day,
    matching the "Last 30 days" preset). Raises HTTP 422 for invalid ranges.
    """
    today = local_today(tz, now)
    end = end_date or today
    start = start_date or (end - timedelta(days=default_days - 1))
    if start > end:
        raise HTTPException(status_code=422, detail="start_date must be on or before end_date")
    if end > today and not allow_future_end:
        raise HTTPException(status_code=422, detail="end_date cannot be in the future")
    if (end - start).days + 1 > MAX_RANGE_DAYS:
        raise HTTPException(status_code=422, detail=f"Reporting range cannot exceed {MAX_RANGE_DAYS} days")
    return build_period(start, end, tz)


def previous_period(period: ReportPeriod, tz: ZoneInfo) -> ReportPeriod:
    """The immediately preceding window of identical length."""
    length = period.days
    end = period.start - timedelta(days=1)
    start = end - timedelta(days=length - 1)
    return build_period(start, end, tz)


def same_period_last_year(period: ReportPeriod, tz: ZoneInfo) -> ReportPeriod:
    """Same calendar dates one year earlier (Feb 29 clamps to Feb 28)."""

    def shift(day: date) -> date:
        try:
            return day.replace(year=day.year - 1)
        except ValueError:
            return day.replace(year=day.year - 1, day=28)

    return build_period(shift(period.start), shift(period.end), tz)


def comparison_period(
    period: ReportPeriod, mode: Optional[str], tz: ZoneInfo
) -> Optional[ReportPeriod]:
    if mode in (None, "", "none"):
        return None
    if mode == "previous":
        return previous_period(period, tz)
    if mode == "last_year":
        return same_period_last_year(period, tz)
    raise HTTPException(status_code=422, detail="compare must be one of: none, previous, last_year")


# ── Trend buckets ────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Bucket:
    label: str  # ISO date of the bucket's first local day
    start: date
    end: date  # inclusive local day
    start_utc: datetime
    end_utc: datetime  # exclusive


def bucket_granularity(days: int) -> str:
    if days <= 31:
        return "day"
    if days <= 120:
        return "week"
    return "month"


def build_buckets(period: ReportPeriod, tz: ZoneInfo, granularity: Optional[str] = None) -> list[Bucket]:
    """Hotel-local calendar buckets covering the period; edge buckets are clipped to it."""
    gran = granularity or bucket_granularity(period.days)
    buckets: list[Bucket] = []
    cursor = period.start
    while cursor <= period.end:
        if gran == "day":
            nxt = cursor
        elif gran == "week":  # 7-day blocks anchored at the period start so a comparison
            # window of equal length yields the same number of buckets (exact index alignment).
            nxt = min(cursor + timedelta(days=6), period.end)
        else:  # month
            first_next = (cursor.replace(day=1) + timedelta(days=32)).replace(day=1)
            nxt = min(first_next - timedelta(days=1), period.end)
        buckets.append(
            Bucket(
                label=cursor.isoformat(),
                start=cursor,
                end=nxt,
                start_utc=local_midnight_utc(cursor, tz),
                end_utc=local_midnight_utc(nxt + timedelta(days=1), tz),
            )
        )
        cursor = nxt + timedelta(days=1)
    return buckets


def parse_timestamp(value) -> Optional[datetime]:
    """Parse an ISO timestamp from PostgREST (aware) into aware UTC; None on junk."""
    if not value:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def bucket_index(buckets: list[Bucket], moment: Optional[datetime]) -> Optional[int]:
    """Index of the bucket containing ``moment`` (None if outside every bucket)."""
    if moment is None:
        return None
    for idx, bucket in enumerate(buckets):
        if bucket.start_utc <= moment < bucket.end_utc:
            return idx
    return None
