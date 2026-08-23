"""Tests for the 4 new per-role mobile copilot briefing endpoints (supervisor,
engineer, front_desk, gm) added alongside the existing housekeeping briefing
for the Mobile Copilot corner-card design import.

Mirrors the pattern in test_ai_copilot_credits.py: invoke the router coroutine
directly (never TestClient), mock Supabase via the shared FakeDB + a local
.rpc()-capable subclass, and mock each service module's get_anthropic_client
independently since each service imports its own reference.
"""

from datetime import date
from types import SimpleNamespace

import pytest

from middleware import credits
from middleware.auth import CurrentUser
from models.requests import (
    EngineerBriefingRequest,
    FrontDeskBriefingRequest,
    SupervisorBriefingRequest,
    WorkOrderBriefingItem,
    GuestRequestBriefingItem,
    StaffProgressItem,
)
from models.requests import BriefingRoomItem
from routers import ai_copilot
from services.ai import engineer_briefing as engineer_briefing_svc
from services.ai import front_desk_briefing as front_desk_briefing_svc
from services.ai import gm_briefing as gm_briefing_svc
from services.ai import insights as insights_svc
from services.ai import supervisor_briefing as supervisor_briefing_svc
from tests.smoke.fake_supabase import FakeDB, FakeQuery


SUPERVISOR = CurrentUser(
    user_id="11111111-1111-4111-8111-111111111111",
    hotel_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    role="housekeeping_supervisor",
)
ENGINEER = CurrentUser(
    user_id="22222222-2222-4222-8222-222222222222",
    hotel_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    role="engineer",
)
FRONT_DESK = CurrentUser(
    user_id="33333333-3333-4333-8333-333333333333",
    hotel_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    role="front_desk",
)
GM = CurrentUser(
    user_id="44444444-4444-4444-8444-444444444444",
    hotel_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    role="gm",
)


class _RpcQuery:
    def __init__(self, db, name, params):
        self.db = db
        self.name = name
        self.params = params

    def execute(self):
        self.db.rpc_calls.append((self.name, self.params))
        return SimpleNamespace(data=[])


class BriefingFakeDB(FakeDB):
    """FakeDB extended with .rpc() support for increment_credits_used."""

    def __init__(self, rows=None):
        super().__init__(rows)
        self.rpc_calls = []

    def table(self, name):
        return FakeQuery(self, name)

    def rpc(self, name, params):
        return _RpcQuery(self, name, params)


def _seeded_ledger_rows(hotel_id: str, extra: dict = None) -> dict:
    today = date.today()
    rows = {
        "credit_ledger": [{
            "id": "ledger-1",
            "tenant_id": hotel_id,
            "period_start": date(today.year, 1, 1).isoformat(),
            "period_end": date(today.year, 12, 31).isoformat(),
            "credits_included": 5000,
            "overage_cost_cents": 0,
        }],
    }
    if extra:
        rows.update(extra)
    return rows


class _FakeMessages:
    def __init__(self, prompt_tokens, completion_tokens, answer_text):
        self.prompt_tokens = prompt_tokens
        self.completion_tokens = completion_tokens
        self.answer_text = answer_text

    def create(self, **_kwargs):
        return SimpleNamespace(
            usage=SimpleNamespace(input_tokens=self.prompt_tokens, output_tokens=self.completion_tokens),
            content=[SimpleNamespace(text=self.answer_text)],
        )


class _FakeClaudeClient:
    def __init__(self, prompt_tokens, completion_tokens, answer_text):
        self.messages = _FakeMessages(prompt_tokens, completion_tokens, answer_text)


_BRIEFING_JSON = """{
  "headline": "Test headline",
  "confidence": 88,
  "sources": ["source a", "source b"],
  "stats": [
    {"label": "A", "value": "1", "sub": "x"},
    {"label": "B", "value": "2", "sub": "y"},
    {"label": "C", "value": "3", "sub": "z"}
  ],
  "rows": [
    {"title": "Row 1", "sub": "detail", "meta": "meta"}
  ],
  "primary_action": "Do the thing",
  "secondary_action": "Not now",
  "chips": ["Question one?"]
}"""


# --- Supervisor briefing ---

@pytest.mark.asyncio
async def test_supervisor_briefing_success_and_single_log_row(monkeypatch):
    db = BriefingFakeDB(_seeded_ledger_rows(SUPERVISOR.hotel_id))
    monkeypatch.setattr(ai_copilot, "supabase", db)
    monkeypatch.setattr(credits, "supabase", db)
    monkeypatch.setattr(
        supervisor_briefing_svc, "get_anthropic_client",
        lambda: _FakeClaudeClient(500, 200, _BRIEFING_JSON),
    )

    request = SupervisorBriefingRequest(
        rooms=[BriefingRoomItem(room_number="101", status="DIRTY")],
        staff=[StaffProgressItem(name="Ana", floor="3", rooms_done=4, rooms_total=13, minutes_behind=40)],
    )
    response = await ai_copilot.supervisor_shift_briefing(request, current_user=SUPERVISOR)

    assert response["data"]["headline"] == "Test headline"
    assert len(response["data"]["stats"]) == 3
    ai_interaction_inserts = [row for (table, row) in db.inserts if table == "ai_interactions"]
    assert len(ai_interaction_inserts) == 1
    assert ai_interaction_inserts[0]["interaction_type"] == "supervisor_briefing"


@pytest.mark.asyncio
async def test_supervisor_briefing_503_on_provider_failure(monkeypatch):
    db = BriefingFakeDB(_seeded_ledger_rows(SUPERVISOR.hotel_id))
    monkeypatch.setattr(ai_copilot, "supabase", db)
    monkeypatch.setattr(credits, "supabase", db)

    def _raise():
        raise RuntimeError("provider down")

    monkeypatch.setattr(supervisor_briefing_svc, "get_anthropic_client", _raise)

    from fastapi import HTTPException

    request = SupervisorBriefingRequest(rooms=[], staff=[])
    with pytest.raises(HTTPException) as exc_info:
        await ai_copilot.supervisor_shift_briefing(request, current_user=SUPERVISOR)
    assert exc_info.value.status_code == 503

    ai_interaction_inserts = [row for (table, row) in db.inserts if table == "ai_interactions"]
    assert len(ai_interaction_inserts) == 1
    assert ai_interaction_inserts[0]["success"] is False


# --- Engineer briefing ---

@pytest.mark.asyncio
async def test_engineer_briefing_credit_variance(monkeypatch):
    """Real token-based billing, not a flat CREDIT_COSTS floor."""
    db = BriefingFakeDB(_seeded_ledger_rows(ENGINEER.hotel_id))
    monkeypatch.setattr(ai_copilot, "supabase", db)
    monkeypatch.setattr(credits, "supabase", db)

    request = EngineerBriefingRequest(
        work_orders=[
            WorkOrderBriefingItem(title="Fan-coil belt", priority="high", status="open", room_number="209"),
        ],
        pm_due_this_week=3,
    )

    monkeypatch.setattr(
        engineer_briefing_svc, "get_anthropic_client",
        lambda: _FakeClaudeClient(100, 50, _BRIEFING_JSON),
    )
    small = await ai_copilot.engineer_shift_briefing(request, current_user=ENGINEER)

    monkeypatch.setattr(
        engineer_briefing_svc, "get_anthropic_client",
        lambda: _FakeClaudeClient(200_000, 150_000, _BRIEFING_JSON),
    )
    large = await ai_copilot.engineer_shift_briefing(request, current_user=ENGINEER)

    assert large["data"]["credits_used"] > small["data"]["credits_used"]
    assert large["data"]["credits_used"] != credits.CREDIT_COSTS.get("engineer_briefing", 1.0)


# --- Front desk briefing ---

@pytest.mark.asyncio
async def test_front_desk_briefing_success(monkeypatch):
    db = BriefingFakeDB(_seeded_ledger_rows(FRONT_DESK.hotel_id))
    monkeypatch.setattr(ai_copilot, "supabase", db)
    monkeypatch.setattr(credits, "supabase", db)
    monkeypatch.setattr(
        front_desk_briefing_svc, "get_anthropic_client",
        lambda: _FakeClaudeClient(300, 150, _BRIEFING_JSON),
    )

    request = FrontDeskBriefingRequest(
        guest_requests=[
            GuestRequestBriefingItem(
                request_type="AC not cooling", room_number="301", status="open",
                sla_breached=True, minutes_open=12,
            ),
        ],
        ready_room_count=12,
        arrivals_count=41,
        vip_arrivals_count=3,
    )
    response = await ai_copilot.front_desk_shift_briefing(request, current_user=FRONT_DESK)

    assert response["data"]["headline"] == "Test headline"
    assert response["data"]["model_used"] == "claude-sonnet-4-6"


# --- GM briefing (server-computed via services.ai.insights._get_7day_stats) ---

@pytest.mark.asyncio
async def test_gm_briefing_success(monkeypatch):
    db = BriefingFakeDB(_seeded_ledger_rows(GM.hotel_id, extra={
        "tenants": [{"id": GM.hotel_id, "name": "Test Hotel"}],
    }))
    monkeypatch.setattr(ai_copilot, "supabase", db)
    monkeypatch.setattr(credits, "supabase", db)
    monkeypatch.setattr(insights_svc, "supabase", db)
    monkeypatch.setattr(
        gm_briefing_svc, "get_anthropic_client",
        lambda: _FakeClaudeClient(400, 200, _BRIEFING_JSON),
    )

    response = await ai_copilot.gm_shift_briefing(language="en", current_user=GM)

    assert response["data"]["headline"] == "Test headline"
    ai_interaction_inserts = [row for (table, row) in db.inserts if table == "ai_interactions"]
    assert len(ai_interaction_inserts) == 1
    assert ai_interaction_inserts[0]["interaction_type"] == "gm_briefing"
