"""logbook.shift-summary cron must report failures honestly in cron_health.

Regression: a run where every summary failed (AI provider not configured, DB
timeouts) was recorded as a success, and a failed shifts lookup recorded nothing.
"""
from datetime import datetime, timezone

import pytest

from routers import internal
import services.ai.providers as providers
import services.ai.shift_summary as summary
import services.ai.shift_summary_due as due_module
from services.ai.shift_summary_claims import ShiftSummaryClaimLost, ShiftSummaryClaimUnavailable
from services.ai.shift_summary_due import DueSelection
from services.ai.shift_summary_schedule import Occurrence


def _select(rows=None, exc=None, already_present=0, tenant_errors=()):
    """Stand in for the DB-backed eligibility lookup; eligibility itself is
    covered in test_shift_summary_eligibility.py."""
    def load(_db, *_a, **_k):
        if exc:
            raise exc
        return DueSelection(due=list(rows or []), already_present=already_present,
                            tenant_errors=list(tenant_errors))
    return load


@pytest.fixture
def recorded(monkeypatch):
    calls = []
    monkeypatch.setattr(internal, "verify_cron", lambda secret: None)
    monkeypatch.setattr(internal, "_record_cron_run", lambda name, error=None: calls.append((name, error)))
    return calls


def _configured(monkeypatch):
    monkeypatch.setattr(providers, "get_anthropic_client", lambda: object())


_END = datetime(2030, 1, 8, 15, tzinfo=timezone.utc)
ROWS = [Occurrence("t1", "s1", "2030-01-08", _END), Occurrence("t1", "s2", "2030-01-08", _END)]


@pytest.mark.asyncio
async def test_unconfigured_provider_is_skipped_not_success(monkeypatch, recorded):
    def boom():
        raise providers.AIProviderConfigurationError("AI provider is not configured")
    monkeypatch.setattr(providers, "get_anthropic_client", boom)
    monkeypatch.setattr(due_module, "load_due_occurrences", _select(exc=AssertionError("must not query shifts")))
    result = await internal.generate_shift_summaries("x")
    assert result["status"] == "skipped"
    assert recorded == [("logbook.shift-summary", "skipped: AI provider is not configured")]


@pytest.mark.asyncio
async def test_failed_summaries_record_failure_not_success(monkeypatch, recorded):
    _configured(monkeypatch)
    monkeypatch.setattr(due_module, "load_due_occurrences", _select(ROWS))

    async def fail(*_a):
        raise RuntimeError("connect timeout")
    monkeypatch.setattr(summary, "generate_or_get_shift_summary", fail)
    result = await internal.generate_shift_summaries("x")
    assert result["status"] == "failed" and result["errors"] == 2 and result["summaries_generated"] == 0
    assert len(recorded) == 1 and recorded[0][1].startswith("failed: 2 shift summary failure(s)")


@pytest.mark.asyncio
async def test_partial_failure_is_still_a_failure(monkeypatch, recorded):
    _configured(monkeypatch)
    monkeypatch.setattr(due_module, "load_due_occurrences", _select(ROWS))

    async def flaky(tenant, shift, date):
        if shift == "s2":
            raise RuntimeError("timeout")
        return {"was_generated": True}
    monkeypatch.setattr(summary, "generate_or_get_shift_summary", flaky)
    result = await internal.generate_shift_summaries("x")
    assert (result["status"], result["summaries_generated"], result["errors"]) == ("partial", 1, 1)
    assert recorded[0][1].startswith("partial:")


@pytest.mark.asyncio
async def test_shift_lookup_failure_is_recorded_and_raised(monkeypatch, recorded):
    _configured(monkeypatch)
    monkeypatch.setattr(due_module, "load_due_occurrences", _select(exc=RuntimeError("supabase timeout")))
    with pytest.raises(RuntimeError):
        await internal.generate_shift_summaries("x")
    assert recorded and recorded[0][1].startswith("failed: shift lookup failed")


@pytest.mark.asyncio
async def test_clean_run_records_success(monkeypatch, recorded):
    _configured(monkeypatch)
    monkeypatch.setattr(due_module, "load_due_occurrences", _select(ROWS))

    async def ok(*_a):
        return {"was_generated": False}
    monkeypatch.setattr(summary, "generate_or_get_shift_summary", ok)
    result = await internal.generate_shift_summaries("x")
    assert result["status"] == "ok" and result["already_present"] == 2 and result["summaries_generated"] == 0
    assert recorded == [("logbook.shift-summary", None)]


@pytest.mark.asyncio
async def test_all_generated_is_ok_and_counts_generation(monkeypatch, recorded):
    _configured(monkeypatch)
    monkeypatch.setattr(due_module, "load_due_occurrences", _select(ROWS))

    async def gen(*_a):
        return {"was_generated": True}
    monkeypatch.setattr(summary, "generate_or_get_shift_summary", gen)
    result = await internal.generate_shift_summaries("x")
    assert (result["status"], result["summaries_generated"]) == ("ok", 2)


@pytest.mark.asyncio
async def test_claim_held_elsewhere_is_skipped_not_failed(monkeypatch, recorded):
    """Another replica/manual request owns the claim: that is concurrency working, not an outage."""
    _configured(monkeypatch)
    monkeypatch.setattr(due_module, "load_due_occurrences", _select(ROWS))

    async def busy(tenant, shift, date):
        if shift == "s1":
            raise ShiftSummaryClaimUnavailable("in_progress")
        raise ShiftSummaryClaimLost()
    monkeypatch.setattr(summary, "generate_or_get_shift_summary", busy)
    result = await internal.generate_shift_summaries("x")
    assert (result["status"], result["errors"], result["skipped_in_progress"]) == ("ok", 0, 2)
    assert recorded == [("logbook.shift-summary", None)]


@pytest.mark.asyncio
async def test_backoff_is_skipped_but_exhausted_retries_fail_the_run(monkeypatch, recorded):
    _configured(monkeypatch)
    monkeypatch.setattr(due_module, "load_due_occurrences", _select(ROWS))

    async def gen(tenant, shift, date):
        if shift == "s1":
            raise ShiftSummaryClaimUnavailable("backoff", "503")
        raise ShiftSummaryClaimUnavailable("retry_exhausted", "model timeout")
    monkeypatch.setattr(summary, "generate_or_get_shift_summary", gen)
    result = await internal.generate_shift_summaries("x")
    assert (result["status"], result["errors"], result["skipped_backoff"]) == ("failed", 1, 1)
    assert recorded[0][1].startswith("failed: 1 shift summary failure(s); last: retry exhausted")
    assert "model timeout" in recorded[0][1]


@pytest.mark.asyncio
async def test_unreadable_tenant_schedule_is_reported_not_guessed(monkeypatch, recorded):
    """A tenant whose schedule cannot be read is skipped (never assumed to have worked) and surfaces as partial."""
    _configured(monkeypatch)
    monkeypatch.setattr(due_module, "load_due_occurrences",
                        _select(ROWS[:1], tenant_errors=["tenant t9: connection reset"]))

    async def gen(*_a):
        return {"was_generated": True}
    monkeypatch.setattr(summary, "generate_or_get_shift_summary", gen)
    result = await internal.generate_shift_summaries("x")
    assert (result["status"], result["summaries_generated"], result["errors"]) == ("partial", 1, 1)
    assert "connection reset" in recorded[0][1]


@pytest.mark.asyncio
async def test_nothing_eligible_is_a_clean_success_with_zero_model_calls(monkeypatch, recorded):
    _configured(monkeypatch)
    monkeypatch.setattr(due_module, "load_due_occurrences", _select([]))

    async def never(*_a):
        raise AssertionError("no eligible shift: the model path must not run")
    monkeypatch.setattr(summary, "generate_or_get_shift_summary", never)
    result = await internal.generate_shift_summaries("x")
    assert (result["status"], result["eligible"], result["summaries_generated"]) == ("ok", 0, 0)


@pytest.mark.asyncio
async def test_skipped_run_never_counts_as_generation(monkeypatch, recorded):
    monkeypatch.setattr(providers, "get_anthropic_client",
                        lambda: (_ for _ in ()).throw(providers.AIProviderConfigurationError("x")))
    monkeypatch.setattr(due_module, "load_due_occurrences", _select(ROWS))
    result = await internal.generate_shift_summaries("x")
    assert result["status"] == "skipped" and result["summaries_generated"] == 0


class _Health:
    """Minimal cron_health fake capturing the upserted row."""

    def __init__(self):
        self.row = None

    def table(self, name):
        assert name == "cron_health"
        return self

    def select(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def maybe_single(self):
        return self

    def upsert(self, row, **_k):
        self.row = row
        return self

    def execute(self):
        return type("R", (), {"data": {"run_count": 3}})()


def test_cron_health_failure_does_not_refresh_last_success(monkeypatch):
    db = _Health()
    monkeypatch.setattr(internal, "supabase", db)
    internal._record_cron_run("logbook.shift-summary", error="failed: boom")
    assert "last_success_at" not in db.row
    assert db.row["last_error"] == "failed: boom" and db.row["last_failure_at"] and db.row["run_count"] == 4


def test_cron_health_success_sets_last_success_and_clears_error(monkeypatch):
    db = _Health()
    monkeypatch.setattr(internal, "supabase", db)
    internal._record_cron_run("logbook.shift-summary")
    assert db.row["last_success_at"] and db.row["last_error"] is None
