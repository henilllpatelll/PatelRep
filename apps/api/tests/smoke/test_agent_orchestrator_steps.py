"""H3 planning step executor and its H1 worker integration (fakes only; real-DB coverage is in tests/integration)."""
from __future__ import annotations

import json
from typing import Any, Optional

import pytest

from services.agent_execution.retry import ErrorClass, classify
from services.agent_harness.errors import IdentityError
from services.agent_orchestrator import ORCHESTRATOR_AGENT_ID
from services.agent_orchestrator import steps as steps_mod
from services.agent_orchestrator.config import OrchestratorSettings
from services.agent_orchestrator.errors import (
    BudgetDenied,
    PlanningBlocked,
    PlanningDeadlineExceeded,
    PlanningLeaseLost,
    ProviderCallFailed,
    ProviderOutcomeUncertain,
    ErrorKind,
)
from services.agent_orchestrator.steps import execute_planning_step
from tests.smoke.agent_execution_support import (
    HOTEL_A,
    NOW,
    FakeAuthority,
    FakeStore,
    claimed,
    run_row,
    step_row,
)
from tests.smoke.agent_orchestrator_support import FakeLedger, Transport, adapters, openai_ok
from tests.smoke.fake_supabase import FakeDB
from tests.smoke.test_agent_orchestrator_plans import WO, draft

DEADLINE = "2026-11-14T12:10:00+00:00"


class FakePlanningStore:
    def __init__(self, *, recorded: Optional[dict] = None, context_reason: Optional[str] = None,
                 record_reason: Optional[str] = None, controls: Optional[list] = None, deadline: str = DEADLINE):
        self.client = FakeDB({"agent_runtime_controls": list(controls or [])})
        self.recorded, self.context_reason, self.record_reason, self.deadline = recorded, context_reason, record_reason, deadline
        self.records: list[dict] = []

    def step_context(self, **_: Any) -> dict:
        if self.context_reason:
            return {"ok": False, "reason": self.context_reason}
        planning = {"intent": "engineering.work_order_dispatch_plan", "intent_version": 1, "resource_type": "work_order",
                    "resource_id": WO, "plan_outcome": None}
        if self.recorded:
            planning.update(self.recorded)
        return {"ok": True, "planning": planning, "deadline_at": self.deadline, "db_now": NOW.isoformat()}

    def record_plan(self, **kw: Any) -> dict:
        self.records.append(kw)
        if self.record_reason:
            return {"ok": False, "reason": self.record_reason}
        return {"ok": True, "planning": {}}


def orch_run(**changes):
    return run_row(agent_id=ORCHESTRATOR_AGENT_ID, agent_version=1, synthetic_spec={}, **changes)


def execute(pstore=None, *, ledger=None, transport=None, authority=None, heartbeat=None, factory=None):
    ledger = ledger or FakeLedger()
    transport = transport or Transport([openai_ok(text=json.dumps(draft()))], ledger=ledger)
    calls = {"factory": 0}

    def default_factory():
        calls["factory"] += 1
        return adapters(transport)

    meta = execute_planning_step(
        pstore=pstore or FakePlanningStore(), ledger=ledger, run=orch_run(), step=step_row(), fencing_token=7,
        worker_id="worker-test", authority=authority or FakeAuthority("chief_engineer"), clock=lambda: NOW,
        adapters_factory=factory or default_factory, heartbeat=heartbeat or (lambda: {"ok": True}),
        monotonic=lambda: 0.0)
    return meta, ledger, transport, calls


def test_planning_step_records_a_validated_plan_and_returns_metadata_only():
    pstore = FakePlanningStore()
    meta, ledger, transport, _ = execute(pstore)
    assert meta["plan_outcome"] == "proposed" and meta["proposal_count"] == 2 and meta["authorizes_execution"] is False
    assert len(json.dumps(meta)) < 2048 and WO not in json.dumps(meta)  # no plan content in H1 run metadata
    [record] = pstore.records
    assert record["outcome"] == "proposed" and len(record["plan_digest"]) == 64 and record["model_attempts"] == 1
    assert ledger.states() == ["settled"] and len(transport.requests) == 1


def test_a_recorded_plan_is_replayed_without_any_model_call():
    pstore = FakePlanningStore(recorded={"plan_outcome": "proposed", "plan_digest": "a" * 64, "model_attempts": 1,
                                         "plan": {"steps": [{}, {}]}, "reason_codes": []})
    meta, ledger, transport, calls = execute(pstore)
    assert meta["replayed"] is True and meta["proposal_count"] == 2
    assert transport.requests == [] and ledger.attempts == {} and calls["factory"] == 0 and pstore.records == []


@pytest.mark.parametrize("authority", [
    lambda: FakeAuthority("engineer"), lambda: FakeAuthority("housekeeper"), lambda: FakeAuthority("front_desk"),
    lambda: FakeAuthority("gm", active=False), lambda: FakeAuthority(missing=True),
])
def test_initiator_is_revalidated_from_current_membership(authority):
    with pytest.raises(IdentityError) as exc:
        execute(authority=authority())
    c = classify(exc.value)
    assert c.error_class is ErrorClass.AUTHORIZATION_DENIED and not c.retryable


def test_runtime_controls_and_closed_process_gate_block_before_any_reservation():
    paused = FakePlanningStore(controls=[{"scope": "hotel", "tenant_id": HOTEL_A, "paused": True}])
    with pytest.raises(PlanningBlocked) as exc:
        execute(paused)
    assert exc.value.reason == "hotel_paused"

    def closed():
        raise RuntimeError("paid calls disabled")

    with pytest.raises(PlanningBlocked) as exc:
        execute(factory=closed)
    assert exc.value.reason == "paid_calls_disabled"


@pytest.mark.parametrize("beat, reason, action", [
    ({"ok": True, "cancel_requested": True}, "run_cancel_requested", "cancel"),
    ({"ok": True, "pause_requested": True}, "run_pause_requested", "pause"),
    ({"ok": True, "blocked_reason": "cost_emergency_stop"}, "cost_emergency_stop", "yield"),
])
def test_heartbeat_stops_planning_before_the_next_paid_attempt(beat, reason, action):
    ledger = FakeLedger()
    transport = Transport([openai_ok(text=json.dumps(draft()))], ledger=ledger)
    with pytest.raises(PlanningBlocked) as exc:
        execute(ledger=ledger, transport=transport, heartbeat=lambda: beat)
    assert (exc.value.reason, exc.value.action) == (reason, action)
    assert transport.requests == [] and ledger.attempts == {}


def test_lease_loss_anywhere_stops_without_writing():
    with pytest.raises(PlanningLeaseLost):
        execute(FakePlanningStore(context_reason="lease_lost"))
    with pytest.raises(PlanningLeaseLost):
        execute(heartbeat=lambda: {"ok": False, "reason": "lease_lost"})
    with pytest.raises(PlanningLeaseLost):
        execute(FakePlanningStore(record_reason="lease_lost"))


def test_an_expired_run_deadline_refuses_to_plan():
    with pytest.raises(PlanningDeadlineExceeded):
        execute(FakePlanningStore(deadline=NOW.isoformat()))


def test_orchestrator_errors_map_to_h1_classes_without_unsafe_retries():
    assert classify(BudgetDenied("hotel_budget_exceeded")).retryable is False
    assert classify(ProviderOutcomeUncertain()).retryable is False
    rate = classify(ProviderCallFailed(ErrorKind.RATE_LIMITED, retryable=True))
    assert rate.retryable and rate.code == "provider_rate_limited"
    assert classify(PlanningDeadlineExceeded()).error_class is ErrorClass.DEADLINE_EXCEEDED


# --- worker integration ---------------------------------------------------------------------------------------------

def orch_worker(*, app_env="test", enabled_gate=False, synthetic=False, store=None, **kw):
    from services.agent_execution.config import WorkerSettings
    from services.agent_execution.worker import Worker

    ws = WorkerSettings(enabled=True, synthetic_enabled=synthetic, worker_id="worker-test")
    store = store or FakeStore(claim=claimed(run=orch_run(), step=step_row(step_type="model_planning")))
    w = Worker(ws, app_env=app_env, version="t", store_factory=lambda: store,
               authority_factory=lambda _c: FakeAuthority("chief_engineer"), clock=lambda: NOW,
               orchestrator_settings=OrchestratorSettings(execution_enabled=enabled_gate), **kw)
    return w, store


def test_orchestrator_runs_are_never_processed_by_default():
    w, store = orch_worker(synthetic=True)
    assert w.orchestrator_allowed is False
    assert w.process_one(store, FakeAuthority()) == "run_yielded"
    assert [c for c in store.calls if c[0] == "acknowledge"][0][1]["reason"] == "orchestrator_disabled"


@pytest.mark.parametrize("app_env", ["production", "prod", "", "staging-prod"])
def test_production_refuses_orchestration_whatever_the_flags(app_env):
    w, store = orch_worker(app_env=app_env, enabled_gate=True)
    assert w.orchestrator_allowed is False and w.may_process is False
    assert w.process_one(store, FakeAuthority()) == "disabled" and store.calls == []


def test_worker_routes_planning_steps_and_maps_outcomes(monkeypatch):
    from services.agent_execution import worker as worker_mod

    seen = {}

    def fake_step(**kw):
        seen.update(kw)
        return {"kind": "planning", "plan_outcome": "proposed"}

    monkeypatch.setattr(worker_mod, "execute_planning_step", fake_step)
    w, store = orch_worker(enabled_gate=True)
    assert w.process_one(store, FakeAuthority()) == "run_succeeded"
    assert seen["fencing_token"] == 7 and seen["run"]["agent_id"] == ORCHESTRATOR_AGENT_ID
    [complete] = [c for c in store.calls if c[0] == "complete_step"]
    assert complete[1]["result_meta"]["plan_outcome"] == "proposed" and complete[1]["next_step_type"] is None

    for exc, outcome, call in ((PlanningBlocked("cost_emergency_stop"), "run_yielded", "acknowledge"),
                               (PlanningBlocked("run_cancel_requested", action="cancel"), "run_cancelled", "acknowledge"),
                               (BudgetDenied("hotel_budget_exceeded"), "run_failed", "fail_step")):
        def make_raiser(error):
            def raising(**_kw):
                raise error
            return raising
        monkeypatch.setattr(worker_mod, "execute_planning_step", make_raiser(exc))
        w, store = orch_worker(enabled_gate=True)
        assert w.process_one(store, FakeAuthority()) == outcome
        assert [c[0] for c in store.calls][-1] == call

    def lost(**_kw):
        raise PlanningLeaseLost()

    monkeypatch.setattr(worker_mod, "execute_planning_step", lost)
    w, store = orch_worker(enabled_gate=True)
    assert w.process_one(store, FakeAuthority()) == "lease_lost"
    assert not any(c[0] in ("complete_step", "fail_step", "acknowledge") for c in store.calls)


def test_worker_rejects_foreign_step_types_for_the_orchestrator():
    store = FakeStore(claim=claimed(run=orch_run(), step=step_row(step_type="tool_invocation")))
    w, _ = orch_worker(enabled_gate=True, store=store)
    assert w.process_one(store, FakeAuthority()) == "run_failed"
    [fail] = [c for c in store.calls if c[0] == "fail_step"]
    assert fail[1]["error_class"] == "invalid_job" and fail[1]["retryable"] is False


def test_live_provider_factory_is_closed_unless_the_paid_gate_is_open():
    from services.agent_orchestrator.errors import ConfigurationError
    from services.agent_orchestrator.providers_factory import build_live_adapters

    for app_env, settings in (("test", OrchestratorSettings()), ("test", OrchestratorSettings(execution_enabled=True)),
                              ("production", OrchestratorSettings(execution_enabled=True, paid_calls_enabled=True))):
        with pytest.raises(ConfigurationError) as exc:
            build_live_adapters(app_env=app_env, settings=settings)
        assert exc.value.code == "paid_calls_disabled"
    built = build_live_adapters(app_env="test", settings=OrchestratorSettings(execution_enabled=True,
                                                                              paid_calls_enabled=True))
    assert set(built) and all(a._client.max_retries == 0 for a in built.values())  # constructed only; nothing sent
    assert steps_mod.heartbeat_probe(lambda: None)() == "lease_lost"
