"""Pure, fixture-testable report calculators. No I/O.

Metric contract (documented once, used by KPIs, trends, drill-down and exports so
they reconcile by construction):

* Rates are ``None`` — never ``0`` — when their denominator is empty.
* SLA compliance only counts records that have a valid SLA deadline
  (``due_at``). Records without one are excluded from the eligible denominator.
* Averages are ``None`` when there are no samples and always ship their
  ``sample_size`` so low-volume values can be flagged in the UI.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable, Optional

from services.reporting.periods import Bucket, bucket_index, parse_timestamp

LOW_SAMPLE_THRESHOLD = 5  # below this, UI shows a "low sample" notice instead of judging performance


def pct(numerator: int, denominator: int) -> Optional[float]:
    return round(numerator / denominator * 100, 1) if denominator else None


def avg(values: list[float], digits: int = 1) -> Optional[float]:
    return round(sum(values) / len(values), digits) if values else None


def hours_between(start: Optional[datetime], end: Optional[datetime]) -> Optional[float]:
    if start is None or end is None:
        return None
    return (end - start).total_seconds() / 3600


def minutes_between(start: Optional[datetime], end: Optional[datetime]) -> Optional[float]:
    if start is None or end is None:
        return None
    return (end - start).total_seconds() / 60


# ── Work orders ──────────────────────────────────────────────────────────────


def work_order_sla_outcome(wo: dict) -> Optional[bool]:
    """True/False for a completed work order with a valid deadline, else None (not eligible)."""
    if wo.get("status") != "completed":
        return None
    due = parse_timestamp(wo.get("due_at"))
    done = parse_timestamp(wo.get("completed_at"))
    if due is None or done is None:
        return None
    return done <= due


def work_order_is_active_breach(wo: dict, now: datetime) -> bool:
    """Open / in-progress / on-hold work order whose deadline has passed (live inventory)."""
    if wo.get("status") not in ("open", "in_progress", "on_hold"):
        return False
    due = parse_timestamp(wo.get("due_at"))
    return due is not None and due < now


def maintenance_stats(work_orders: list[dict]) -> dict[str, Any]:
    """KPI block for the work-order cohort (created inside the period)."""
    total = len(work_orders)
    completed = [wo for wo in work_orders if wo.get("status") == "completed"]
    outcomes = [work_order_sla_outcome(wo) for wo in completed]
    eligible = sum(1 for o in outcomes if o is not None)
    met = sum(1 for o in outcomes if o is True)

    resolution = [h for h in (hours_between(parse_timestamp(w.get("created_at")), parse_timestamp(w.get("completed_at"))) for w in completed) if h is not None]
    response = [h for h in (hours_between(parse_timestamp(w.get("created_at")), parse_timestamp(w.get("started_at"))) for w in work_orders) if h is not None]
    repair = [h for h in (hours_between(parse_timestamp(w.get("started_at")), parse_timestamp(w.get("completed_at"))) for w in completed) if h is not None]
    labor = [float(w["labor_hours"]) for w in completed if w.get("labor_hours") is not None]

    return {
        "total_work_orders": total,
        "completed": len(completed),
        "completion_rate_pct": pct(len(completed), total),
        "sla_eligible": eligible,
        "sla_met": met,
        "sla_compliance_pct": pct(met, eligible),
        "sla_excluded_no_deadline": len(completed) - eligible,
        "avg_resolution_hours": avg(resolution, 2),
        "avg_response_hours": avg(response, 2),
        "avg_repair_hours": avg(repair, 2),
        "response_sample_size": len(response),
        "repair_sample_size": len(repair),
        "resolution_sample_size": len(resolution),
        "total_labor_hours": round(sum(labor), 1) if labor else None,
        "labor_tracked_count": len(labor),
    }


# ── Guest requests ───────────────────────────────────────────────────────────


def guest_sla_outcome(request: dict, now: datetime) -> Optional[bool]:
    """True = verified on time, False = verified late or unverified past deadline, None = not eligible.

    Eligible: has a ``due_at`` AND (is verified OR its deadline already passed).
    A still-running request inside its window is neither met nor missed yet.
    """
    due = parse_timestamp(request.get("due_at"))
    if due is None:
        return None
    verified = parse_timestamp(request.get("verified_at")) if request.get("status") == "verified" else None
    if verified is not None:
        return verified <= due
    if request.get("status") == "cancelled":
        return None
    return False if due < now else None


def guest_stats(requests: list[dict], now: datetime) -> dict[str, Any]:
    total = len(requests)
    ack = [m for m in (minutes_between(parse_timestamp(r.get("created_at")), parse_timestamp(r.get("acknowledged_at"))) for r in requests) if m is not None]
    verified = [r for r in requests if r.get("status") == "verified" and parse_timestamp(r.get("verified_at"))]
    resolution = [m for m in (minutes_between(parse_timestamp(r.get("created_at")), parse_timestamp(r.get("verified_at"))) for r in verified) if m is not None]
    outcomes = [guest_sla_outcome(r, now) for r in requests]
    eligible = sum(1 for o in outcomes if o is not None)
    met = sum(1 for o in outcomes if o is True)
    return {
        "total_requests": total,
        "verified_count": len(verified),
        "verified_resolution_pct": pct(len(verified), total),
        "sla_eligible": eligible,
        "sla_met": met,
        "sla_compliance_pct": pct(met, eligible),
        "avg_acknowledgement_minutes": avg(ack),
        "acknowledgement_sample_size": len(ack),
        "avg_verified_resolution_minutes": avg(resolution),
        "resolution_sample_size": len(resolution),
    }


# ── Comparison ───────────────────────────────────────────────────────────────


def compare(
    current: Optional[float],
    previous: Optional[float],
    *,
    kind: str,
    higher_is_better: Optional[bool],
) -> Optional[dict[str, Any]]:
    """Comparison block, or None when either side is unavailable.

    ``kind='rate'``  -> percentage-point difference (value are percents).
    ``kind='value'`` -> relative percent difference (previous must be non-zero).
    Direction is ``neutral`` for a negligible change or when polarity is unknown.
    """
    if current is None or previous is None:
        return None
    if kind == "rate":
        change = round(current - previous, 1)
        change_kind = "percentage_points"
    else:
        if previous == 0:
            return None
        change = round((current - previous) / abs(previous) * 100, 1)
        change_kind = "percent"
    if change == 0 or higher_is_better is None:
        direction = "neutral"
    else:
        improved = (change > 0) == higher_is_better
        direction = "favorable" if improved else "unfavorable"
    return {"previous": previous, "change": change, "change_kind": change_kind, "direction": direction}


# ── Bucketed series ──────────────────────────────────────────────────────────


def series_from_buckets(buckets: list[Bucket], accumulators: list[dict]) -> list[dict]:
    """Zip bucket metadata with per-bucket accumulators produced by the callers below."""
    return [
        {"bucket": bucket.label, "start": bucket.start.isoformat(), "end": bucket.end.isoformat(), **acc}
        for bucket, acc in zip(buckets, accumulators)
    ]


def rate_series(
    buckets: list[Bucket],
    items: Iterable[dict],
    *,
    when: str,
    outcome,
) -> list[dict]:
    """Per-bucket eligible/met/value series. ``outcome(item)`` -> True/False/None (not eligible)."""
    accs = [{"eligible": 0, "met": 0} for _ in buckets]
    for item in items:
        idx = bucket_index(buckets, parse_timestamp(item.get(when)))
        if idx is None:
            continue
        result = outcome(item)
        if result is None:
            continue
        accs[idx]["eligible"] += 1
        accs[idx]["met"] += 1 if result else 0
    for acc in accs:
        acc["value"] = pct(acc["met"], acc["eligible"])
        acc["sample_size"] = acc["eligible"]
    return series_from_buckets(buckets, accs)


def average_series(
    buckets: list[Bucket],
    items: Iterable[dict],
    *,
    when: str,
    measure,
    digits: int = 1,
) -> list[dict]:
    """Per-bucket mean series. ``measure(item)`` -> float or None (no sample)."""
    sums = [{"total": 0.0, "n": 0} for _ in buckets]
    for item in items:
        idx = bucket_index(buckets, parse_timestamp(item.get(when)))
        if idx is None:
            continue
        value = measure(item)
        if value is None:
            continue
        sums[idx]["total"] += value
        sums[idx]["n"] += 1
    accs = [
        {"value": round(s["total"] / s["n"], digits) if s["n"] else None, "sample_size": s["n"]}
        for s in sums
    ]
    return series_from_buckets(buckets, accs)


def count_series(buckets: list[Bucket], items: Iterable[dict], *, when: str, predicate=None) -> list[dict]:
    counts = [0] * len(buckets)
    for item in items:
        if predicate is not None and not predicate(item):
            continue
        idx = bucket_index(buckets, parse_timestamp(item.get(when)))
        if idx is not None:
            counts[idx] += 1
    return series_from_buckets(buckets, [{"value": c, "sample_size": c} for c in counts])


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
