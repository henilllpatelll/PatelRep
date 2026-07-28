"""RED regression tests for the AI credit-accounting + SOP double-log bugs.

Bug 1 (CLAUDE.md A3 violation): middleware/credits.py::check_and_deduct_credits
charges a flat CREDIT_COSTS lookup instead of deriving the charge from the real
prompt_tokens/completion_tokens every parser already returns.

Bug 2: services/ai/sop_rag.py::query_sop() writes its own ai_interactions row
AND routers/ai_copilot.py::copilot_chat() writes a second row for the same
SOP query, double-logging the audit trail.

These tests invoke routers.ai_copilot.copilot_chat() directly (the pattern
established in tests/smoke/test_ai_assignment_confirm.py), mocking only the
LLM provider boundary and the Supabase client — never TestClient.
"""

from datetime import date
from types import SimpleNamespace

import pytest

from middleware import credits
from middleware.auth import CurrentUser
from models.requests import CopilotChatRequest
from routers import ai_copilot
from services.ai import sop_rag
from tests.smoke.fake_supabase import FakeDB, FakeQuery


GM = CurrentUser(
    user_id="11111111-1111-4111-8111-111111111111",
    hotel_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    role="gm",
    email="gm@example.com",
)


# ---------------------------------------------------------------------------
# Fake Supabase plumbing: extends the shared FakeDB with .rpc() and
# count="exact" select support, neither of which the shared fixture provides.
# ---------------------------------------------------------------------------

class _RpcQuery:
    def __init__(self, db, name, params):
        self.db = db
        self.name = name
        self.params = params

    def execute(self):
        self.db.rpc_calls.append((self.name, self.params))
        if self.name == "match_sop_chunks":
            return SimpleNamespace(data=self.db.sop_chunks_response)
        return SimpleNamespace(data=[])


class _CountingFakeQuery(FakeQuery):
    def select(self, *args, **kwargs):
        self._count_requested = "count" in kwargs
        return super().select(*args, **kwargs)

    def execute(self):
        result = super().execute()
        if self.action == "select" and getattr(self, "_count_requested", False):
            result.count = len(result.data) if isinstance(result.data, list) else (1 if result.data else 0)
        return result


class CopilotFakeDB(FakeDB):
    """FakeDB extended with .rpc() (increment_credits_used / match_sop_chunks)
    and count="exact" select support (the sop_documents indexed-check)."""

    def __init__(self, rows=None, sop_chunks_response=None):
        super().__init__(rows)
        self.sop_chunks_response = sop_chunks_response or []
        self.rpc_calls = []

    def table(self, name):
        return _CountingFakeQuery(self, name)

    def rpc(self, name, params):
        return _RpcQuery(self, name, params)


def _seeded_ledger_rows(hotel_id: str) -> dict:
    """A credit_ledger row covering "today" so check_and_deduct_credits skips
    the ledger-creation branch entirely."""
    today = date.today()
    return {
        "credit_ledger": [{
            "id": "ledger-1",
            "tenant_id": hotel_id,
            "period_start": date(today.year, 1, 1).isoformat(),
            "period_end": date(today.year, 12, 31).isoformat(),
            "credits_included": 5000,
            "overage_cost_cents": 0,
        }],
    }


# ---------------------------------------------------------------------------
# Fake LLM provider clients (sop_rag path)
# ---------------------------------------------------------------------------

class _FakeEmbeddings:
    def create(self, model, input):
        return SimpleNamespace(data=[SimpleNamespace(embedding=[0.1, 0.2, 0.3])])


class _FakeOpenAIClient:
    def __init__(self):
        self.embeddings = _FakeEmbeddings()


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
    def __init__(self, prompt_tokens, completion_tokens, answer_text="Step 1: Do the thing."):
        self.messages = _FakeMessages(prompt_tokens, completion_tokens, answer_text)


def _fake_parse_nl_tasks(prompt_tokens: int, completion_tokens: int):
    def _parser(**_kwargs):
        return {
            "tasks": [{
                "title": "Test task",
                "description": None,
                "task_type": "general",
                "priority": "normal",
                "room_number": None,
                "due_at": None,
                "confidence": 0.8,
            }],
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
        }
    return _parser


async def _run_task_creation(monkeypatch, db, prompt_tokens: int, completion_tokens: int) -> float:
    monkeypatch.setattr(ai_copilot, "supabase", db)
    monkeypatch.setattr(credits, "supabase", db)
    monkeypatch.setattr(ai_copilot, "try_fast_path", lambda message: None)
    monkeypatch.setattr(ai_copilot, "parse_nl_tasks", _fake_parse_nl_tasks(prompt_tokens, completion_tokens))

    request = CopilotChatRequest(
        message="please handle this operational item",
        context={"intent_hint": "task_creation"},
    )
    response = await ai_copilot.copilot_chat(request, current_user=GM)
    return response["data"]["credits_used"]


@pytest.mark.asyncio
async def test_credits_charged_varies_with_token_count(monkeypatch):
    """A call with far more tokens must bill strictly more credits than a
    call with few tokens — the flat CREDIT_COSTS lookup makes them equal."""
    db = CopilotFakeDB(_seeded_ledger_rows(GM.hotel_id))

    credits_small = await _run_task_creation(monkeypatch, db, 100, 50)
    credits_large = await _run_task_creation(monkeypatch, db, 5000, 3000)

    assert credits_large > credits_small


@pytest.mark.asyncio
async def test_credits_not_flat_lookup(monkeypatch):
    """For a call whose real token cost clearly exceeds the flat per-type
    amount, credits_charged must differ from CREDIT_COSTS[interaction_type]."""
    db = CopilotFakeDB(_seeded_ledger_rows(GM.hotel_id))

    credits_charged = await _run_task_creation(monkeypatch, db, 50_000, 30_000)

    assert credits_charged != credits.CREDIT_COSTS["task_creation"]


@pytest.mark.asyncio
async def test_sop_query_writes_single_ai_interactions_row(monkeypatch):
    """A single /ai/copilot/chat sop_query request must write exactly one
    ai_interactions row — sop_rag.query_sop() currently writes its own
    (hardcoded credits_charged=2.0) in addition to the router's final log."""
    hotel_id = GM.hotel_id
    rows = _seeded_ledger_rows(hotel_id)
    rows["sop_documents"] = [{
        "id": "doc-1",
        "tenant_id": hotel_id,
        "indexing_status": "indexed",
        "title": "Cleaning SOP",
    }]
    db = CopilotFakeDB(
        rows,
        sop_chunks_response=[{
            "document_id": "doc-1",
            "content": "Step 1: Strip the bed.",
            "similarity": 0.92,
            "metadata": {"page_number": 3},
        }],
    )

    monkeypatch.setattr(ai_copilot, "supabase", db)
    monkeypatch.setattr(credits, "supabase", db)
    monkeypatch.setattr(sop_rag, "supabase", db)
    monkeypatch.setattr(sop_rag, "get_openai_client", lambda: _FakeOpenAIClient())
    monkeypatch.setattr(sop_rag, "get_anthropic_client", lambda: _FakeClaudeClient(200, 100))

    request = CopilotChatRequest(
        message="how do I clean a room",
        context={"intent_hint": "sop_query"},
    )
    response = await ai_copilot.copilot_chat(request, current_user=GM)

    assert response["data"]["response_type"] == "answer"
    ai_interaction_inserts = [row for (table, row) in db.inserts if table == "ai_interactions"]
    assert len(ai_interaction_inserts) == 1
