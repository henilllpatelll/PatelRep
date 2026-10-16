"""Phase 7: AI usage observability from the existing ai_interactions log.

Synthetic rows only. Pins the aggregation, the honesty rules (unmetered is not free; cache hits and cap
refusals are separate), GM-only access, hotel scoping, and that nothing identifying leaves the endpoint.
"""

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from main import app
from middleware import credits
from routers import ai_copilot as ai_router
from services.ai import usage_summary as usage
from tests.smoke.fake_supabase import FakeDB


def row(feature, model="claude-sonnet-4-6", *, pt=1000, ct=200, credits_charged=3.0, latency=1200, success=True, error=None, tenant="hotel-a", user="hk-1"):
    return {
        "tenant_id": tenant, "user_id": user, "interaction_type": feature, "model_used": model,
        "prompt_tokens": pt, "completion_tokens": ct, "credits_charged": credits_charged,
        "latency_ms": latency, "success": success, "error_message": error,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def test_counts_tokens_credits_and_latency_per_feature_and_model():
    summary = usage.summarize([
        row("housekeeping_briefing", latency=1000),
        row("housekeeping_briefing", latency=3000),
        row("task_creation", "gpt-4o-mini", pt=400, ct=100, credits_charged=1.0, latency=500),
    ])
    totals = summary["totals"]
    assert totals["requests"] == 3 and totals["succeeded"] == 3 and totals["failed"] == 0
    assert totals["prompt_tokens"] == 2400 and totals["completion_tokens"] == 500
    assert totals["credits"] == 7.0
    feature = summary["by_feature"]["housekeeping_briefing"]
    assert feature["requests"] == 2 and feature["avg_latency_ms"] == 2000 and feature["p95_latency_ms"] == 3000
    assert set(summary["by_model"]) == {"claude-sonnet-4-6", "gpt-4o-mini"}


def test_failures_timeouts_cap_refusals_and_cache_hits_are_separate_things():
    summary = usage.summarize([
        row("sop_query", success=False, error="Connection timed out", pt=0, ct=0, credits_charged=0),
        row("sop_query", success=False, error="provider exploded", pt=0, ct=0, credits_charged=0),
        row("sop_query", model="none", success=False, error=credits.CREDIT_LIMIT_MARKER, pt=0, ct=0, credits_charged=0, latency=0),
        row("translation", model=credits.CACHE_HIT_MODEL, pt=0, ct=0, credits_charged=0, latency=0),
        row("translation", "gpt-4o-mini", pt=200, ct=80),
    ])
    sop = summary["by_feature"]["sop_query"]
    assert (sop["failed"], sop["timeouts"], sop["credit_limit_rejections"]) == (1, 1, 1)
    assert sop["avg_latency_ms"] == 1200  # the instant refusal does not flatter the latency
    translation = summary["by_feature"]["translation"]
    assert translation["cache_hits"] == 1 and translation["cache_hit_rate"] == 0.5
    assert summary["totals"]["credit_limit_rejections"] == 1


def test_a_request_with_no_recorded_usage_is_unmetered_not_free():
    summary = usage.summarize([
        row("housekeeper_shift_recap", pt=0, ct=0, credits_charged=3.0),  # a model ran but nothing was recorded
        row("general", model="none", pt=0, ct=0, credits_charged=0),  # nothing ran
        row("task_creation", model="rule_engine", pt=0, ct=0, credits_charged=0),
    ])
    assert summary["totals"]["unmetered"] == 1


def test_estimated_cost_comes_only_from_recorded_tokens_and_excludes_cache_hits():
    one_million_each = row("housekeeping_briefing", pt=1_000_000, ct=1_000_000)  # sonnet: 3.00 + 15.00
    cached = row("housekeeping_briefing", model=credits.CACHE_HIT_MODEL, pt=1_000_000, ct=1_000_000)
    failed = row("housekeeping_briefing", success=False, error="x", pt=1_000_000, ct=1_000_000)
    assert usage.summarize([one_million_each, cached, failed])["totals"]["estimated_provider_cost_usd"] == 18.0


def test_empty_history_is_all_zeros_and_no_divisions_by_zero():
    summary = usage.summarize([])
    assert summary["totals"]["requests"] == 0
    assert summary["totals"]["avg_latency_ms"] is None and summary["totals"]["cache_hit_rate"] is None
    assert summary["by_feature"] == {} and summary["by_model"] == {}


# ---- endpoint ------------------------------------------------------------------------------------------

def _auth(role="gm", hotel_id="hotel-a", user_id="gm-1"):
    token = jwt.encode({"sub": user_id, "role": role, "hotel_id": hotel_id, "aud": "authenticated"},
                       settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def client(monkeypatch):
    db = FakeDB({"ai_interactions": [
        row("housekeeping_briefing", tenant="hotel-a", user="hk-77"),
        row("task_creation", "gpt-4o-mini", tenant="hotel-a", user="hk-78"),
        row("housekeeping_briefing", tenant="hotel-b", user="other-hotel-user", pt=999_999, ct=999_999, credits_charged=500),
    ]})
    monkeypatch.setattr(ai_router, "supabase", db)
    return TestClient(app)


def test_gm_sees_only_their_own_hotels_usage(client):
    res = client.get("/v1/ai/usage", headers=_auth())
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["totals"]["requests"] == 2  # hotel-b's row is not counted
    assert data["totals"]["prompt_tokens"] == 2000
    assert data["window_days"] == 30 and data["truncated"] is False


def test_the_summary_carries_no_person_identifiers_or_hotel_ids(client):
    body = client.get("/v1/ai/usage", headers=_auth()).text
    for secret in ("hk-77", "hk-78", "other-hotel-user", "hotel-b", "hotel-a"):
        assert secret not in body


@pytest.mark.parametrize("role", ["housekeeper", "housekeeping_supervisor", "front_desk", "engineer", "chief_engineer"])
def test_only_the_gm_can_read_usage(client, role):
    assert client.get("/v1/ai/usage", headers=_auth(role=role)).status_code == 403


def test_the_window_is_bounded(client):
    assert client.get("/v1/ai/usage?days=0", headers=_auth()).status_code == 422
    assert client.get("/v1/ai/usage?days=91", headers=_auth()).status_code == 422
