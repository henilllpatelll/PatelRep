"""Phase 7: a hotel at its AI cap is refused BEFORE any provider is contacted.

Before this, `check_and_deduct_credits` ran only after the model had answered, so a hotel past its cap
still paid the provider for every retry and none of that usage was recorded. These tests pin the
pre-flight (`assert_ai_allowance`), its tenant scoping, that free paths keep working, and — as a
structural guard — that no paid route can be added without it.
"""

import ast
from datetime import date
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
import jwt

from core.config import settings
from main import app
from middleware import credits
from routers import ai_copilot as ai_router
from tests.smoke.fake_supabase import FakeDB

API_ROOT = Path(__file__).resolve().parent.parent
BASE_FEE_CENTS = credits.BASE_FEE_CENTS


def _db(*, hotel="hotel-a", cap_cents=12_900, overage_cents=0):
    today = date.today()
    return FakeDB({
        "credit_ledger": [{
            "id": f"ledger-{hotel}", "tenant_id": hotel,
            "period_start": date(today.year, 1, 1).isoformat(), "period_end": date(today.year, 12, 31).isoformat(),
            "credits_included": 5000, "overage_cost_cents": overage_cents,
        }],
        "subscriptions": [{"tenant_id": hotel, "cap_cents": cap_cents, "plan_status": "active"}],
        "ai_interactions": [],
    })


def _auth(role="housekeeper", hotel_id="hotel-a", user_id="hk-1"):
    token = jwt.encode({"sub": user_id, "role": role, "hotel_id": hotel_id, "aud": "authenticated"},
                       settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def _hosted_provider(monkeypatch):
    monkeypatch.setattr(settings, "ai_provider", "hosted")


# ---- unit: the pre-flight ------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_under_the_cap_passes_and_deducts_nothing(monkeypatch):
    db = _db(overage_cents=0)
    monkeypatch.setattr(credits, "supabase", db)
    await credits.assert_ai_allowance("hotel-a", "hk-1", "task_creation")
    assert db.rows["ai_interactions"] == []
    assert db.rows["credit_ledger"][0]["overage_cost_cents"] == 0  # read-only


@pytest.mark.asyncio
async def test_at_the_cap_is_402_and_the_refusal_is_recorded_without_usage(monkeypatch):
    db = _db(cap_cents=12_900, overage_cents=12_900 - BASE_FEE_CENTS)  # exactly at the limit
    monkeypatch.setattr(credits, "supabase", db)
    with pytest.raises(HTTPException) as err:
        await credits.assert_ai_allowance("hotel-a", "hk-1", "task_creation")
    assert err.value.status_code == 402
    (row,) = db.rows["ai_interactions"]
    assert row["success"] is False and row["error_message"] == credits.CREDIT_LIMIT_MARKER
    assert row["prompt_tokens"] == 0 and row["completion_tokens"] == 0 and row["credits_charged"] == 0
    assert row["tenant_id"] == "hotel-a" and row["model_used"] == "none"


@pytest.mark.asyncio
async def test_just_under_the_cap_still_passes(monkeypatch):
    monkeypatch.setattr(credits, "supabase", _db(cap_cents=12_900, overage_cents=12_900 - BASE_FEE_CENTS - 1))
    await credits.assert_ai_allowance("hotel-a", "hk-1", "task_creation")


@pytest.mark.asyncio
async def test_another_hotels_cap_does_not_affect_this_hotel(monkeypatch):
    db = _db(hotel="hotel-b", cap_cents=12_900, overage_cents=5_000)  # B is over its cap
    db.rows["credit_ledger"].append({
        "id": "ledger-a", "tenant_id": "hotel-a",
        "period_start": date(date.today().year, 1, 1).isoformat(), "period_end": date(date.today().year, 12, 31).isoformat(),
        "credits_included": 5000, "overage_cost_cents": 0,
    })
    db.rows["subscriptions"].append({"tenant_id": "hotel-a", "cap_cents": 12_900, "plan_status": "active"})
    monkeypatch.setattr(credits, "supabase", db)
    await credits.assert_ai_allowance("hotel-a", "hk-1", "task_creation")
    with pytest.raises(HTTPException):
        await credits.assert_ai_allowance("hotel-b", "hk-9", "task_creation")


@pytest.mark.asyncio
async def test_a_refusal_whose_log_cannot_be_written_is_still_a_clean_402(monkeypatch):
    db = _db(overage_cents=10_000)
    monkeypatch.setattr(credits, "supabase", db)

    async def broken_log(**_kwargs):
        raise RuntimeError("log table unavailable")

    monkeypatch.setattr(credits, "log_ai_interaction", broken_log)
    with pytest.raises(HTTPException) as err:
        await credits.assert_ai_allowance("hotel-a", "hk-1", "task_creation")
    assert err.value.status_code == 402


@pytest.mark.asyncio
async def test_local_ollama_has_no_provider_bill_so_no_cap(monkeypatch):
    monkeypatch.setattr(credits, "supabase", _db(overage_cents=999_999))
    monkeypatch.setattr(settings, "ai_provider", "ollama")
    await credits.assert_ai_allowance("hotel-a", "hk-1", "task_creation")


@pytest.mark.asyncio
@pytest.mark.parametrize("deduct_result", [False, []], ids=["atomic_refusal", "function_not_deployed"])
async def test_the_post_call_deduction_uses_the_same_cap_rule(monkeypatch, deduct_result):
    # The atomic deduct_ai_credits() refusing, and the pre-migration read-then-increment path, both end in the same 402.
    db = _db(overage_cents=10_000)
    db.rpc = lambda name, params: SimpleNamespace(execute=lambda: SimpleNamespace(data=deduct_result))
    monkeypatch.setattr(credits, "supabase", db)
    with pytest.raises(HTTPException) as err:
        await credits.check_and_deduct_credits("hotel-a", "task_creation", 100, 50)
    assert err.value.status_code == 402 and err.value.detail == credits.CAP_REACHED_MESSAGE


# ---- routes: no provider spend when over the cap -------------------------------------------------------

def _forbid(name):
    def fail(*_a, **_k):
        raise AssertionError(f"{name} contacted the provider although the hotel is over its cap")
    return fail


def test_a_paid_briefing_over_the_cap_never_reaches_the_provider(monkeypatch):
    db = _db(overage_cents=10_000)
    monkeypatch.setattr(credits, "supabase", db)
    monkeypatch.setattr(ai_router, "supabase", db)
    monkeypatch.setattr(ai_router, "generate_shift_briefing", _forbid("generate_shift_briefing"))
    res = TestClient(app).post(
        "/v1/ai/housekeeping/briefing", json={"rooms": [{"room_number": "101", "status": "DIRTY"}], "language": "en"}, headers=_auth(),
    )
    assert res.status_code == 402
    assert res.json()["detail"] == credits.CAP_REACHED_MESSAGE


def test_chat_task_parsing_over_the_cap_is_402_but_free_paths_still_work(monkeypatch):
    db = _db(overage_cents=10_000)
    monkeypatch.setattr(credits, "supabase", db)
    monkeypatch.setattr(ai_router, "supabase", db)
    monkeypatch.setattr(ai_router, "parse_nl_tasks", _forbid("parse_nl_tasks"))
    monkeypatch.setattr(ai_router, "try_fast_path", lambda _message: None)
    client = TestClient(app)
    paid = client.post("/v1/ai/copilot/chat", json={"message": "please create a task to restock towels on floor 3"}, headers=_auth())
    assert paid.status_code == 402

    # A reply that needs no model (nothing paid) still answers for an over-cap hotel.
    free = client.post("/v1/ai/copilot/chat", json={"message": "hello"}, headers=_auth())
    assert free.status_code == 200
    assert free.json()["data"]["credits_used"] == 0


def test_sop_query_over_the_cap_never_reaches_retrieval(monkeypatch):
    from routers import sop as sop_router

    db = _db(overage_cents=10_000)
    monkeypatch.setattr(credits, "supabase", db)
    monkeypatch.setattr(sop_router, "query_sop", _forbid("query_sop"))
    res = TestClient(app).post("/v1/sop/query", json={"query": "how do I clean a bathroom"}, headers=_auth())
    assert res.status_code == 402


# ---- structure: a paid call can never ship without the pre-flight --------------------------------------

def _functions_with_charge(path: Path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            calls = [(n.lineno, n.func.id) for n in ast.walk(node) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)]
            charges = sorted(line for line, name in calls if name == "check_and_deduct_credits")
            gates = sorted(line for line, name in calls if name == "assert_ai_allowance")
            if charges:
                yield node.name, charges, gates


@pytest.mark.parametrize("relative", ["routers/ai_copilot.py", "routers/sop.py", "services/ai/shift_summary.py"])
def test_every_paid_ai_function_checks_the_allowance_before_it_charges(relative):
    problems = []
    for name, charges, gates in _functions_with_charge(API_ROOT / relative):
        if not gates:
            problems.append(f"{relative}::{name} charges credits without assert_ai_allowance")
        elif gates[0] > charges[0]:
            problems.append(f"{relative}::{name} checks the allowance only after charging")
    assert not problems, "\n".join(problems)
