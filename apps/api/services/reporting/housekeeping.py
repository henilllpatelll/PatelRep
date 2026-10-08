"""Housekeeping report data: clean sessions, inspections quality, room downtime."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from services.guest_recovery.contracts import (
    calculate_housekeeping_efficiency,
    calculate_inspection_trends,
    calculate_room_downtime_hours,
)
from services.reporting import data as report_data
from services.reporting.periods import ReportPeriod, parse_timestamp

PRIOR_STATE_LOOKBACK_DAYS = 30
CLEAN_OPEN = "IN_PROGRESS"
CLEAN_CLOSE = ("CLEAN", "INSPECTED")


def _transitions(supabase, hotel_id: str, period: ReportPeriod) -> list[dict]:
    """Status transitions in the period plus each room's last prior transition (bounded lookback)."""
    history, _ = report_data.fetch_all(
        lambda: supabase.table("room_status_history")
        .select("room_id, to_status, created_at")
        .eq("tenant_id", hotel_id)
        .gte("created_at", period.start_iso)
        .lt("created_at", period.end_iso)
        .order("created_at")
    )
    lookback_start = period.start_utc - timedelta(days=PRIOR_STATE_LOOKBACK_DAYS)
    prior_rows = (
        supabase.table("room_status_history")
        .select("room_id, to_status, created_at")
        .eq("tenant_id", hotel_id)
        .gte("created_at", lookback_start.isoformat())
        .lt("created_at", period.start_iso)
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )
    prior: dict[str, dict] = {}
    for row in prior_rows:
        prior.setdefault(row["room_id"], row)
    return [
        {"room_id": r["room_id"], "to_status": r["to_status"], "at": r["created_at"]}
        for r in list(prior.values()) + history
    ]


def clean_sessions(
    supabase, hotel_id: str, period: ReportPeriod, tz: ZoneInfo, room_type_by_room: dict[str, str]
) -> list[dict]:
    """Closed IN_PROGRESS -> CLEAN/INSPECTED sessions whose CLOSE falls inside the period."""
    by_room: dict[str, list[dict]] = {}
    for t in _transitions(supabase, hotel_id, period):
        at = parse_timestamp(t["at"])
        if at is not None:
            by_room.setdefault(t["room_id"], []).append({"to": t["to_status"], "at": at})
    sessions: list[dict] = []
    for room_id, entries in by_room.items():
        entries.sort(key=lambda e: e["at"])
        opened: Optional[datetime] = None
        for entry in entries:
            if entry["to"] == CLEAN_OPEN:
                opened = entry["at"]
            elif entry["to"] in CLEAN_CLOSE and opened is not None:
                closed = entry["at"]
                if period.start_utc <= closed < period.end_utc:
                    sessions.append({
                        "room_id": room_id,
                        "room_type_id": room_type_by_room.get(room_id),
                        "date": closed.astimezone(tz).date().isoformat(),
                        "closed_at": closed.isoformat(),
                        "minutes": round((closed - opened).total_seconds() / 60, 1),
                    })
                opened = None
    return sessions


def efficiency(sessions: list[dict], baselines: dict[str, float]) -> dict:
    """Reuse the Management ROI calculator so Housekeeping and Management never disagree."""
    result = calculate_housekeeping_efficiency(sessions, room_type_baselines=baselines)
    if not sessions:  # no sessions -> unavailable, not 0 minutes
        result = {**result, "minutes_per_occupied_room": None}
    return result


def room_type_baselines(supabase, hotel_id: str) -> tuple[dict[str, float], dict[str, dict]]:
    rows = supabase.table("room_types").select("id, code, name, base_clean_minutes").eq("tenant_id", hotel_id).execute().data or []
    baselines = {r["id"]: r["base_clean_minutes"] for r in rows if r.get("base_clean_minutes") is not None}
    return baselines, {r["id"]: r for r in rows}


def inspection_quality(inspections: list[dict], results: list[dict]) -> dict:
    """ROI trend calculator + failure-category ranking; pass rate is None with no inspections."""
    metrics = calculate_inspection_trends(inspections, results)
    if not inspections:
        metrics = {**metrics, "pass_rate_pct": None}
    return metrics


def downtime(supabase, hotel_id: str, period: ReportPeriod) -> dict:
    """OOO downtime from recorded transitions only (current OOO inventory is NOT downtime)."""
    transitions = []
    history, _ = report_data.fetch_all(
        lambda: supabase.table("room_status_history")
        .select("room_id, to_status, created_at")
        .eq("tenant_id", hotel_id)
        .gte("created_at", period.start_iso)
        .lt("created_at", period.end_iso)
        .order("created_at")
    )
    lookback_start = period.start_utc - timedelta(days=PRIOR_STATE_LOOKBACK_DAYS)
    prior_rows = (
        supabase.table("room_status_history")
        .select("room_id, to_status, created_at")
        .eq("tenant_id", hotel_id)
        .gte("created_at", lookback_start.isoformat())
        .lt("created_at", period.start_iso)
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )
    prior: dict[str, dict] = {}
    for row in prior_rows:
        prior.setdefault(row["room_id"], row)
    for room_id, row in prior.items():  # clamp pre-window intervals to the window start
        transitions.append({"room_id": room_id, "to_status": row["to_status"], "at": period.start_iso})
    transitions += [{"room_id": r["room_id"], "to_status": r["to_status"], "at": r["created_at"]} for r in history]
    return calculate_room_downtime_hours(transitions, window_end=period.end_utc)
