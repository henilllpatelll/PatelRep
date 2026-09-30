"""build_shift_window() + build_shift_summary_prompt() unit tests (Phase 5).

Pure functions, no Supabase/Anthropic involved — proves the real shift time
window (incl. overnight) and that the prompt no longer asks the model to
describe occupancy data that was never collected (found problem E).
"""
from datetime import datetime, timezone

from services.ai.shift_summary import build_shift_summary_prompt, build_shift_window


def test_same_day_shift_window(monkeypatch):
    from services.ai import shift_summary as mod
    monkeypatch.setattr(mod, "_get_hotel_tz", lambda hotel_id: timezone.utc)

    start_at, end_at = build_shift_window(
        "hotel-a", {"start_time": "07:00", "end_time": "15:00"}, "2026-09-29",
    )

    assert start_at == datetime(2026, 9, 29, 7, 0, tzinfo=timezone.utc)
    assert end_at == datetime(2026, 9, 29, 15, 0, tzinfo=timezone.utc)


def test_overnight_shift_window_ends_next_calendar_day(monkeypatch):
    from services.ai import shift_summary as mod
    monkeypatch.setattr(mod, "_get_hotel_tz", lambda hotel_id: timezone.utc)

    start_at, end_at = build_shift_window(
        "hotel-a", {"start_time": "23:00", "end_time": "07:00"}, "2026-09-29",
    )

    assert start_at == datetime(2026, 9, 29, 23, 0, tzinfo=timezone.utc)
    assert end_at == datetime(2026, 9, 30, 7, 0, tzinfo=timezone.utc)


def test_exact_start_and_end_boundaries_are_distinct_instants(monkeypatch):
    from services.ai import shift_summary as mod
    monkeypatch.setattr(mod, "_get_hotel_tz", lambda hotel_id: timezone.utc)

    start_at, end_at = build_shift_window(
        "hotel-a", {"start_time": "15:00", "end_time": "23:00"}, "2026-09-29",
    )

    assert start_at < end_at
    assert (end_at - start_at).total_seconds() == 8 * 3600


def _empty_context() -> dict:
    return {
        "logbook_entries": [], "follow_ups": [], "completed_tasks": [],
        "open_work_orders": [], "vip_arrivals": [], "pending_guest_issues": [],
        "low_stock_parts": [], "sla_breaches": [],
    }


def test_prompt_never_asks_model_to_describe_occupancy():
    """Found problem E: the old prompt said 'occupancy pace' as something the
    model should open with, despite zero occupancy data ever being collected.
    The rewritten prompt may only mention occupancy to explicitly forbid
    inferring it — never as a fact to report."""
    prompt = build_shift_summary_prompt("Morning", "Housekeeping", "2026-09-29", _empty_context())

    assert "occupancy pace" not in prompt.lower()
    assert "do not infer occupancy" in prompt.lower()


def test_prompt_instructs_facts_only():
    prompt = build_shift_summary_prompt("Morning", "Housekeeping", "2026-09-29", _empty_context())

    assert "only the supplied operational data" in prompt


def test_prompt_includes_staff_flagged_follow_ups_section():
    context = _empty_context()
    context["follow_ups"] = [{"content": "Room 412 plumbing leak", "priority": "important", "follow_up_at": None}]

    prompt = build_shift_summary_prompt("Morning", "Housekeeping", "2026-09-29", context)

    assert "Room 412 plumbing leak" in prompt
    assert "STAFF-FLAGGED FOLLOW-UPS" in prompt
