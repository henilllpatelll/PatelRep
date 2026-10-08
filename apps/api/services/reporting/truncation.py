"""Row-cap awareness for report aggregates.

Every cohort query is bounded (``data.MAX_ROWS``). A figure computed from a capped cohort
describes only part of the hotel, so it must never be shown as if it were complete.

``data.fetch_all`` records the *source* of any cohort that hit the cap in a request-scoped
tracker. The view builders are wrapped with :func:`tracked`: afterwards every KPI whose
inputs include a truncated source is withheld (value ``None``, availability ``unavailable``,
no comparison) and the payload carries ``truncated`` / ``truncated_sources`` /
``truncation_notice`` so screens and exports can say so.
"""
from __future__ import annotations

import inspect
from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps
from typing import Any, Callable, Iterable, Iterator, Optional

_SEEN: ContextVar[Optional[set]] = ContextVar("report_truncated_sources", default=None)

SOURCE_LABELS = {
    "guest_requests": "guest requests",
    "work_orders": "work orders",
    "open_work_orders": "open work orders",
    "tasks": "tasks",
    "inspections": "inspections",
    "inspection_results": "inspection results",
    "room_status_history": "room status history",
    "room_status": "room status",
    "pm_records": "preventive-maintenance records",
    "ai_interactions": "AI usage records",
    "live_guest_requests": "open guest requests",
}

# KPI key -> the cohorts its value is computed from.
KPI_SOURCES: dict[str, frozenset] = {
    "guest_verified_resolution": frozenset({"guest_requests"}),
    "guest_sla": frozenset({"guest_requests"}),
    "guest_ack_time": frozenset({"guest_requests"}),
    "guest_resolution_time": frozenset({"guest_requests"}),
    "guest_requests_total": frozenset({"guest_requests"}),
    "maintenance_sla": frozenset({"work_orders"}),
    "maintenance_response": frozenset({"work_orders"}),
    "maintenance_repair": frozenset({"work_orders"}),
    "maintenance_completion": frozenset({"work_orders"}),
    "tasks_completed": frozenset({"tasks"}),
    "wo_completed": frozenset({"work_orders"}),
    "team_sla": frozenset({"tasks", "work_orders"}),
    "labor_hours": frozenset({"work_orders"}),
    "rooms_serviced": frozenset({"room_status_history"}),
    "cleaning_minutes": frozenset({"room_status_history"}),
    "inspection_pass": frozenset({"inspections"}),
    "repeat_defects": frozenset({"inspections", "inspection_results"}),
    "out_of_order": frozenset({"room_status"}),
}


def record(source: str) -> None:
    """Called by ``fetch_all`` when a cohort hit the row cap."""
    seen = _SEEN.get()
    if seen is not None:
        seen.add(source)


def is_truncated(*sources: str) -> bool:
    """Whether any of ``sources`` hit the cap so far in the current request scope."""
    seen = _SEEN.get()
    return bool(seen) and any(s in seen for s in sources)


@contextmanager
def track() -> Iterator[set]:
    """Open a tracking scope; on exit its findings also propagate to an enclosing scope."""
    parent = _SEEN.get()
    seen: set = set()
    token = _SEEN.set(seen)
    try:
        yield seen
    finally:
        _SEEN.reset(token)
        if parent is not None:
            parent |= seen


def notice(sources: Iterable[str]) -> str:
    names = ", ".join(SOURCE_LABELS.get(s, s) for s in sorted(sources))
    return (
        f"Some source data ({names}) exceeded the reporting record limit, so figures that depend on it are "
        "hidden rather than shown as hotel-wide results. Narrow the date range to see them."
    )


def withhold(item: dict, seen: set) -> dict:
    """A KPI whose inputs were capped: no value, no comparison, an explicit reason."""
    sources = KPI_SOURCES.get(item.get("key", ""), frozenset())
    if not (sources & seen):
        return item
    return {
        **item,
        "value": None,
        "availability": "unavailable",
        "comparison": None,
        "previous": None,
        "change": None,
        "change_kind": None,
        "direction": None,
        "eligible": None,
        "numerator": None,
        "sample_size": None,
        "low_sample": False,
        "secondary": None,
        "note": "Hidden: the data behind this figure exceeded the reporting record limit. Narrow the date range.",
    }


def _withhold_all(items: Any, seen: set) -> Any:
    if isinstance(items, list):
        return [withhold(i, seen) if isinstance(i, dict) and "key" in i and "availability" in i else i for i in items]
    return items


def apply_truncation(result: dict, seen: set) -> dict:
    """Withhold affected KPIs everywhere a view carries them and stamp the truncation fields."""
    result["truncated"] = bool(seen)
    result["truncated_sources"] = sorted(seen)
    result["truncation_notice"] = notice(seen) if seen else None
    if not seen:
        return result
    if "kpis" in result:
        result["kpis"] = _withhold_all(result["kpis"], seen)
    for dept in result.get("departments") or []:
        if isinstance(dept, dict) and "measures" in dept:
            dept["measures"] = _withhold_all(dept["measures"], seen)
    for section in ("time_labor", "quality_risk", "guest_response"):
        block = result.get(section)
        if isinstance(block, dict) and "kpis" in block:
            block["kpis"] = _withhold_all(block["kpis"], seen)
    return result


def tracked(fn: Callable) -> Callable:
    """Decorator for a view builder returning a dict (sync or async)."""
    if inspect.iscoroutinefunction(fn):

        @wraps(fn)
        async def awrapper(*args, **kwargs):
            with track() as seen:
                return apply_truncation(await fn(*args, **kwargs), seen)

        return awrapper

    @wraps(fn)
    def wrapper(*args, **kwargs):
        with track() as seen:
            return apply_truncation(fn(*args, **kwargs), seen)

    return wrapper
