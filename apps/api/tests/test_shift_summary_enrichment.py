"""collect_shift_handoff_context() enrichment tests (Phase 5).

Covers VIP arrivals, pending guest issues, low-stock engineering parts, SLA
breaches, staff-flagged follow-ups, tenant isolation, and the corrected
shift-window-bound "tasks completed" query (found problem F: the old query
used the whole calendar day regardless of the shift's actual start/end).

collect_shift_handoff_context() is pure data collection (no AI call), so these
tests call it directly — no Anthropic mocking needed. A final full-flow test
covers stats + handoff_data via the real generate_or_get_shift_summary() path.
"""
from datetime import date, datetime, timezone
from types import SimpleNamespace

import pytest

from core.config import settings
from middleware import credits as credits_module
from services.ai import shift_summary as shift_summary_module
from services.ai.shift_summary import collect_shift_handoff_context, generate_or_get_shift_summary
from tests.smoke.fake_supabase import FakeDB, FakeQuery

HOTEL = "hotel-1"
FOREIGN_HOTEL = "hotel-2"
SHIFT = "shift-1"
SHIFT_DATE = "2026-09-16"
NIGHT_SHIFT = {"start_time": "23:00", "end_time": "07:00"}


class _RpcQuery:
    def __init__(self, db, name, params):
        self.db = db
        self.name = name
        self.params = params

    def execute(self):
        self.db.rpc_calls.append((self.name, self.params))
        return SimpleNamespace(data=[])


class CreditAwareFakeDB(FakeDB):
    def __init__(self, rows=None):
        super().__init__(rows)
        self.rpc_calls = []

    def table(self, name):
        return FakeQuery(self, name)

    def rpc(self, name, params):
        return _RpcQuery(self, name, params)


def _seed() -> dict:
    return {
        "tenants": [{"id": HOTEL, "timezone": "UTC"}],
        "logbook_entries": [
            {"id": "log-1", "tenant_id": HOTEL, "shift_id": SHIFT, "entry_date": SHIFT_DATE,
             "content": "Quiet night", "created_at": "2026-09-16T23:30:00", "category": "general",
             "status": "informational", "priority": "normal", "archived_at": None, "expires_at": None},
            {"id": "log-2", "tenant_id": HOTEL, "shift_id": SHIFT, "entry_date": SHIFT_DATE,
             "content": "Room 412 leak, ping AM engineer", "created_at": "2026-09-17T05:00:00",
             "category": "maintenance", "status": "follow_up", "priority": "important",
             "follow_up_at": "2026-09-17T08:00:00", "assigned_to": "user-eng-1",
             "archived_at": None, "expires_at": None},
            {"id": "log-3", "tenant_id": HOTEL, "shift_id": SHIFT, "entry_date": SHIFT_DATE,
             "content": "Archived note", "created_at": "2026-09-16T23:45:00",
             "category": "general", "status": "informational", "archived_at": "2026-09-17T06:00:00",
             "expires_at": None},
            {"id": "log-4", "tenant_id": FOREIGN_HOTEL, "shift_id": SHIFT, "entry_date": SHIFT_DATE,
             "content": "Wrong tenant", "created_at": "2026-09-16T23:30:00", "category": "general",
             "status": "informational", "archived_at": None, "expires_at": None},
        ],
        "room_status": [
            {"tenant_id": HOTEL, "room_id": "room-101", "clean_type": "DEP", "vip_flag": True, "rooms": {"room_number": "101"}},
            {"tenant_id": HOTEL, "room_id": "room-102", "clean_type": "DEP", "vip_flag": True, "rooms": {"room_number": "102"}},
            {"tenant_id": HOTEL, "room_id": "room-103", "clean_type": "DEP", "vip_flag": False, "rooms": {"room_number": "103"}},
            {"tenant_id": HOTEL, "room_id": "room-104", "clean_type": "STAY", "vip_flag": True, "rooms": {"room_number": "104"}},
            {"tenant_id": FOREIGN_HOTEL, "room_id": "room-999", "clean_type": "DEP", "vip_flag": True, "rooms": {"room_number": "999"}},
        ],
        "guest_requests": [
            {"id": "gr-1", "tenant_id": HOTEL, "status": "new", "title": "Extra towels", "room_id": None, "rooms": None},
            {"id": "gr-2", "tenant_id": HOTEL, "status": "in_progress", "title": "AC not cooling", "room_id": None, "rooms": None},
            {"id": "gr-3", "tenant_id": HOTEL, "status": "open", "title": "Late checkout", "room_id": None, "rooms": None},
            {"id": "gr-4", "tenant_id": HOTEL, "status": "resolved", "title": "Done thing", "room_id": None, "rooms": None},
            {"id": "gr-5", "tenant_id": HOTEL, "status": "verified", "title": "Verified thing", "room_id": None, "rooms": None},
            {"id": "gr-6", "tenant_id": HOTEL, "status": "cancelled", "title": "Cancelled thing", "room_id": None, "rooms": None},
        ],
        "engineering_parts": [
            {"id": "part-1", "tenant_id": HOTEL, "name": "HVAC Filter", "minimum_stock": 10, "is_active": True},
            {"id": "part-2", "tenant_id": HOTEL, "name": "Fan Belt", "minimum_stock": 8, "is_active": True},
            {"id": "part-3", "tenant_id": HOTEL, "name": "Light Bulb", "minimum_stock": 5, "is_active": True},
            {"id": "part-4", "tenant_id": HOTEL, "name": "Screws", "minimum_stock": None, "is_active": True},
            {"id": "part-5", "tenant_id": HOTEL, "name": "Retired Pump", "minimum_stock": 99, "is_active": False},
        ],
        "engineering_part_stock": [
            {"tenant_id": HOTEL, "part_id": "part-1", "quantity": 3},
            {"tenant_id": HOTEL, "part_id": "part-2", "quantity": 1},
            {"tenant_id": HOTEL, "part_id": "part-3", "quantity": 10},
            {"tenant_id": HOTEL, "part_id": "part-4", "quantity": 0},
        ],
        "work_orders": [
            {"id": "wo-1", "tenant_id": HOTEL, "title": "Overdue WO", "status": "open", "priority": "high",
             "category": "hvac", "due_at": "2026-09-16T20:00:00+00:00", "rooms": {"room_number": "205"}},
            {"id": "wo-2", "tenant_id": HOTEL, "title": "Future WO", "status": "open", "priority": "low",
             "category": "plumbing", "due_at": "2026-09-18T00:00:00+00:00", "rooms": None},
            {"id": "wo-3", "tenant_id": HOTEL, "title": "Completed WO", "status": "completed", "priority": "low",
             "category": "elec", "due_at": "2026-09-16T20:00:00+00:00", "rooms": None},
        ],
        "tasks": [
            # Inside the Night shift window (23:00 -> next day 07:00 UTC)
            {"id": "task-1", "tenant_id": HOTEL, "title": "Cleaned lobby", "status": "completed",
             "priority": "normal", "task_type": "cleaning", "completed_at": "2026-09-17T05:00:00+00:00", "due_at": None},
            # Just before the shift starts -> excluded
            {"id": "task-2", "tenant_id": HOTEL, "title": "Evening task", "status": "completed",
             "priority": "normal", "task_type": "cleaning", "completed_at": "2026-09-16T20:00:00+00:00", "due_at": None},
            # Exactly at the shift end boundary -> excluded ([start, end) is half-open)
            {"id": "task-3", "tenant_id": HOTEL, "title": "Boundary task", "status": "completed",
             "priority": "normal", "task_type": "cleaning", "completed_at": "2026-09-17T07:00:00+00:00", "due_at": None},
            {"id": "task-4", "tenant_id": HOTEL, "title": "Overdue task", "status": "in_progress",
             "priority": "high", "task_type": "maintenance", "completed_at": None, "due_at": "2026-09-16T20:00:00+00:00"},
        ],
    }


def _context():
    return collect_shift_handoff_context(HOTEL, SHIFT, SHIFT_DATE, NIGHT_SHIFT)


def test_tasks_completed_uses_real_shift_window_not_calendar_day(monkeypatch):
    """Found problem F: only the task inside [23:00, next-day 07:00) counts —
    not the whole calendar day, and not the exact end boundary."""
    monkeypatch.setattr(shift_summary_module, "supabase", CreditAwareFakeDB(_seed()))
    monkeypatch.setattr(shift_summary_module, "_get_hotel_tz", lambda hotel_id: timezone.utc)

    context = _context()

    completed_titles = [t["title"] for t in context["completed_tasks"]]
    assert completed_titles == ["Cleaned lobby"]


def test_archived_logbook_entries_excluded(monkeypatch):
    monkeypatch.setattr(shift_summary_module, "supabase", CreditAwareFakeDB(_seed()))
    monkeypatch.setattr(shift_summary_module, "_get_hotel_tz", lambda hotel_id: timezone.utc)

    context = _context()

    contents = [e["content"] for e in context["logbook_entries"]]
    assert "Archived note" not in contents
    assert "Wrong tenant" not in contents  # tenant isolation


def test_follow_ups_extracted_with_structured_fields(monkeypatch):
    monkeypatch.setattr(shift_summary_module, "supabase", CreditAwareFakeDB(_seed()))
    monkeypatch.setattr(shift_summary_module, "_get_hotel_tz", lambda hotel_id: timezone.utc)

    context = _context()

    assert len(context["follow_ups"]) == 1
    follow_up = context["follow_ups"][0]
    assert follow_up["priority"] == "important"
    assert follow_up["assigned_to"] == "user-eng-1"


def test_vip_arrivals_tenant_scoped_and_dep_vip_only(monkeypatch):
    monkeypatch.setattr(shift_summary_module, "supabase", CreditAwareFakeDB(_seed()))
    monkeypatch.setattr(shift_summary_module, "_get_hotel_tz", lambda hotel_id: timezone.utc)

    context = _context()

    room_numbers = {v["room_number"] for v in context["vip_arrivals"]}
    assert room_numbers == {"101", "102"}


def test_pending_guest_issues_excludes_terminal_statuses(monkeypatch):
    monkeypatch.setattr(shift_summary_module, "supabase", CreditAwareFakeDB(_seed()))
    monkeypatch.setattr(shift_summary_module, "_get_hotel_tz", lambda hotel_id: timezone.utc)

    context = _context()

    assert len(context["pending_guest_issues"]) == 3


def test_low_stock_predicate_boundaries(monkeypatch):
    monkeypatch.setattr(shift_summary_module, "supabase", CreditAwareFakeDB(_seed()))
    monkeypatch.setattr(shift_summary_module, "_get_hotel_tz", lambda hotel_id: timezone.utc)

    context = _context()

    names = {p["name"] for p in context["low_stock_parts"]}
    assert names == {"HVAC Filter", "Fan Belt"}  # part-3 not low, part-4 null min, part-5 inactive


def test_sla_breaches_excludes_future_and_non_open(monkeypatch):
    monkeypatch.setattr(shift_summary_module, "supabase", CreditAwareFakeDB(_seed()))
    monkeypatch.setattr(shift_summary_module, "_get_hotel_tz", lambda hotel_id: timezone.utc)
    _freeze(monkeypatch, "2026-09-17T06:00:00")

    context = _context()

    types = {(b["type"], b["title"]) for b in context["sla_breaches"]}
    assert types == {("work_order", "Overdue WO"), ("task", "Overdue task")}


def test_open_work_orders_snapshot_includes_room_number(monkeypatch):
    monkeypatch.setattr(shift_summary_module, "supabase", CreditAwareFakeDB(_seed()))
    monkeypatch.setattr(shift_summary_module, "_get_hotel_tz", lambda hotel_id: timezone.utc)

    context = _context()

    wo = next(w for w in context["open_work_orders"] if w["id"] == "wo-1")
    assert wo["rooms"]["room_number"] == "205"


class _FrozenDateTime(datetime):
    """datetime subclass whose .now() always returns a fixed UTC instant."""

    _frozen_instant = None

    @classmethod
    def now(cls, tz=None):
        instant = cls._frozen_instant
        if tz is not None:
            return instant.astimezone(tz)
        return instant


def _freeze(monkeypatch, utc_iso: str):
    frozen = type("_Frozen", (_FrozenDateTime,), {
        "_frozen_instant": datetime.fromisoformat(utc_iso).replace(tzinfo=timezone.utc),
    })
    monkeypatch.setattr(shift_summary_module, "datetime", frozen)


class _FakeMessages:
    def create(self, **_kw):
        return SimpleNamespace(
            content=[SimpleNamespace(text="Handoff narrative.")],
            usage=SimpleNamespace(input_tokens=400, output_tokens=150),
        )


class _FakeAnthropic:
    def __init__(self, *_a, **_kw):
        self.messages = _FakeMessages()


@pytest.mark.asyncio
async def test_full_generation_stores_stats_and_handoff_data_snapshot(monkeypatch):
    rows = _seed()
    rows["shifts"] = [{"id": SHIFT, "tenant_id": HOTEL, "name": "Night", **NIGHT_SHIFT,
                        "department_id": None, "departments": None}]
    rows["shift_summaries"] = []
    rows["credit_ledger"] = [{
        "id": "ledger-1", "tenant_id": HOTEL,
        "period_start": date(date.today().year, 1, 1).isoformat(),
        "period_end": date(date.today().year, 12, 31).isoformat(),
        "credits_included": 5000, "overage_cost_cents": 0,
    }]
    db = CreditAwareFakeDB(rows)
    monkeypatch.setattr(shift_summary_module, "supabase", db)
    monkeypatch.setattr(credits_module, "supabase", db)
    monkeypatch.setattr(shift_summary_module, "_get_hotel_tz", lambda hotel_id: timezone.utc)
    monkeypatch.setattr(settings, "ai_provider", "hosted")
    monkeypatch.setattr(shift_summary_module, "get_anthropic_client", lambda: _FakeAnthropic())

    result = await generate_or_get_shift_summary(HOTEL, SHIFT, SHIFT_DATE)

    assert result["was_generated"] is True
    stats = result["stats"]
    assert stats["tasks_completed"] == 1
    assert stats["vip_arrivals_count"] == 2
    assert stats["pending_guest_issues_count"] == 3
    assert stats["low_stock_parts_count"] == 2
    assert stats["follow_up_count"] == 1
    assert stats["model_used"] == "claude-sonnet-4-6"

    handoff_data = result["handoff_data"]
    assert handoff_data["logbook"]["entry_count"] == 2  # log-1 + log-2, log-3 archived
    assert len(handoff_data["open_work_orders"]) == 2
    assert handoff_data["follow_ups"][0]["assigned_to"] == "user-eng-1"
    # No tenant leakage into the stored snapshot
    assert all("999" != v.get("room_number") for v in handoff_data["vip_arrivals"])
