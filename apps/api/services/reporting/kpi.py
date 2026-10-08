"""Standard KPI payload + shared ReportContext used by every view builder."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from services.reporting.definitions import DEFINITIONS, higher_is_better
from services.reporting.metrics import LOW_SAMPLE_THRESHOLD, compare
from services.reporting.periods import ReportPeriod


@dataclass
class ReportContext:
    supabase: Any
    hotel_id: str
    user_id: str
    role: str
    tz: ZoneInfo
    period: ReportPeriod
    compare_period: Optional[ReportPeriod] = None
    departments: tuple[str, ...] = ()
    user: Any = None  # the authenticated CurrentUser (for delegating to role-gated calculators)
    now: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def has_department(self, name: str) -> bool:
        return name in self.departments


def kpi(
    key: str,
    value: Optional[float],
    *,
    previous: Optional[float] = None,
    kind: str = "rate",
    eligible: Optional[int] = None,
    numerator: Optional[int] = None,
    sample_size: Optional[int] = None,
    absent: str = "not_enough_data",
    note: Optional[str] = None,
    secondary: Optional[dict] = None,
    unit: Optional[str] = None,
) -> dict:
    """One KPI card payload.

    ``value=None`` is never rendered as zero: ``availability`` says why it is missing
    (not_enough_data | not_applicable | not_configured | unavailable). Live metrics carry
    scope='live' and never get a historical comparison.
    """
    definition = DEFINITIONS.get(key, {})
    scope = definition.get("scope", "period")
    comparison = None if scope != "period" else compare(value, previous, kind=kind, higher_is_better=higher_is_better(key))
    sample = sample_size if sample_size is not None else eligible
    return {
        "key": key,
        "label": definition.get("label", key),
        "unit": unit or definition.get("unit"),
        "value": value,
        "availability": "available" if value is not None else absent,
        "scope": scope,
        "comparison": comparison,
        # Flat copies keep exports/PDF rendering trivial.
        "previous": comparison["previous"] if comparison else None,
        "change": comparison["change"] if comparison else None,
        "change_kind": comparison["change_kind"] if comparison else None,
        "direction": comparison["direction"] if comparison else None,
        "eligible": eligible,
        "numerator": numerator,
        "sample_size": sample,
        "low_sample": bool(value is not None and sample is not None and sample < LOW_SAMPLE_THRESHOLD),
        "note": note,
        "secondary": secondary,
    }


def exception(
    key: str,
    severity: str,
    title: str,
    detail: str,
    count: int,
    *,
    target: Optional[dict] = None,
    department: Optional[str] = None,
) -> dict:
    """A ranked 'needs attention' row. ``target`` is a drawer or an existing app route."""
    return {
        "key": key,
        "severity": severity,
        "title": title,
        "detail": detail,
        "count": count,
        "department": department,
        "target": target,
    }


SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "info": 3}


def rank_exceptions(items: list[dict]) -> list[dict]:
    """De-duplicate by key (keep the most severe), then order by urgency then size."""
    best: dict[str, dict] = {}
    for item in items:
        if item["count"] <= 0:
            continue
        current = best.get(item["key"])
        if current is None or SEVERITY_ORDER[item["severity"]] < SEVERITY_ORDER[current["severity"]]:
            best[item["key"]] = item
    return sorted(best.values(), key=lambda i: (SEVERITY_ORDER[i["severity"]], -i["count"], i["key"]))
