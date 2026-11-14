"""H2 step executor, admission and approval interfaces against scripted fakes (decisions only).

Durability, atomicity and concurrency are proven against PostgreSQL in tests/integration/test_agent_gateway_*.
"""
from __future__ import annotations

from typing import Optional

import pytest

from middleware.auth import CurrentUser
from services.agent_execution.retry import ErrorClass, LeaseLost, classify
from services.agent_gateway import approvals
from services.agent_gateway.admission import admit_tool_run
from services.agent_gateway.authorization import GatewaySettings
from services.agent_gateway.catalog import DISPATCH_AGENT_ID, WORK_ORDER_ASSIGN_V2, WORK_ORDER_LOOKUP_V2
from services.agent_gateway.errors import GatewayBlocked, GatewayRefused, ToolTimeout
from services.agent_gateway.gateway import prepare
from services.agent_gateway.steps import execute_tool_step, run_with_timeout
from services.agent_harness.identity import AuthoritativeIdentity
from tests.smoke.agent_gateway_support import (
    APPROVER,
    HOTEL_A,
    INITIATOR,
    NOW,
    WORK_ORDER,
    FakeClient,
    approval_row,
    assign_args,
    default_rows,
    snapshot,
    user,
)
from services.agent_gateway.catalog import DISPATCH_AGENT_V1

RUN = {"id": "run-1", "tenant_id": HOTEL_A, "agent_id": DISPATCH_AGENT_ID, "agent_version": 1, "principal_type": "human",
       "initiated_by_user_id": INITIATOR, "system_principal_id": None, "trigger_type": "user_request",
       "correlation_id": "c"}
STEP = {"id": "step-1", "step_number": 1, "attempt_count": 1, "step_type": "tool_invocation"}


class Authority:
    def __init__(self, roles: Optional[dict] = None, inactive: frozenset = frozenset()) -> None:
        self.roles = roles or {INITIATOR: "chief_engineer", APPROVER: "gm"}
        self.inactive = inactive

    def load(self, *, user_id: str, hotel_id: str) -> Optional[AuthoritativeIdentity]:
        role = self.roles.get(user_id)
        if role is None:
            return None
        return AuthoritativeIdentity(user_id=user_id, hotel_id=hotel_id, role=role,
                                     is_active=user_id not in self.inactive, loaded_at=NOW)


def invocation(tool=WORK_ORDER_LOOKUP_V2, arguments=None) -> dict:
    p = prepare(FakeClient(default_rows()), hotel_id=HOTEL_A, agent=DISPATCH_AGENT_V1, tool_id=tool.tool_id,
                tool_version=tool.version, arguments=arguments or {"work_order_id": WORK_ORDER})
    return {"id": "inv-1", "tenant_id": HOTEL_A, "run_id": "run-1", "step_number": 1, "agent_id": DISPATCH_AGENT_ID,
            "agent_version": 1, "tool_id": tool.tool_id, "tool_version": tool.version, "access": tool.access.value,
            "arguments": p.arguments, "resource_type": tool.resource_type.value, "resource_id": WORK_ORDER,
            "action_digest": p.digest, "idempotency_key": "tool:run-1:1", "initiated_by_user_id": INITIATOR}


class Store:
    def __init__(self, inv: dict, *, approval=None, execution=None, snap=None, execute_result=None,
                 request_result=None, rows=None) -> None:
        self.client = FakeClient(rows if rows is not None else default_rows())
        self.context = {"ok": True, "invocation": inv, "approval": approval, "execution": execution,
                        "snapshot": snap or snapshot()}
        self.execute_result = execute_result or {"outcome": "succeeded", "execution": {
            "id": "ex-1", "state": "succeeded", "result": {"id": WORK_ORDER, "assigned_to": APPROVER,
                                                           "status": "open", "changed": True}}}
        self.request_result = request_result or {"outcome": "awaiting_approval", "approval_id": "ap-1"}
        self.calls: list[tuple[str, dict]] = []

    def step_context(self, **kw):
        self.calls.append(("step_context", kw))
        return self.context

    def record_outcome(self, **kw):
        self.calls.append(("record_outcome", kw))
        if self.context["execution"]:
            return {"outcome": "replayed", "execution": self.context["execution"]}
        return {"outcome": "recorded", "execution": {"id": "ex-r", "state": kw["state"], "result": kw.get("result") or {},
                                                     "error_code": kw.get("error_code")}}

    def request_approval(self, **kw):
        self.calls.append(("request_approval", kw))
        return self.request_result

    def execute_work_order_assign(self, **kw):
        self.calls.append(("execute", kw))
        return self.execute_result

    def names(self):
        return [n for n, _ in self.calls]


def run(store: Store, authority=None, *, process_enabled=True):
    return execute_tool_step(gstore=store, run=RUN, step=STEP, fencing_token=7, worker_id="w", authority=authority or Authority(),
                             clock=lambda: NOW, process_enabled=process_enabled, checkpoint=lambda *a: None)


def refusal(store, authority=None) -> str:
    with pytest.raises(GatewayRefused) as err:
        run(store, authority)
    return err.value.code


# --- reads ------------------------------------------------------------------------------------------------------------

def test_read_step_records_a_sanitized_result_and_completes():
    store = Store(invocation())
    result = run(store)
    assert result.action == "complete" and result.meta["outcome"] == "succeeded"
    (_, recorded), = [c for c in store.calls if c[0] == "record_outcome"]
    assert recorded["state"] == "succeeded" and "description" not in recorded["result"]
    assert recorded["fencing_token"] == 7


def test_committed_outcome_is_replayed_never_reexecuted():
    store = Store(invocation(WORK_ORDER_ASSIGN_V2, assign_args()), execution={
        "id": "ex-1", "state": "succeeded", "result": {"id": WORK_ORDER, "assigned_to": APPROVER, "status": "open",
                                                        "changed": True}})
    assert run(store).action == "complete"
    assert "execute" not in store.names() and "request_approval" not in store.names()


def test_controls_and_switches_yield_instead_of_failing():
    with pytest.raises(GatewayBlocked) as err:
        run(Store(invocation(), snap=snapshot(paused_tools=["engineering.work_orders.lookup"])))
    assert err.value.reason == "tool_paused"
    with pytest.raises(GatewayBlocked) as err:
        run(Store(invocation(), snap=snapshot(platform=False)))
    assert err.value.reason == "platform_execution_disabled"
    with pytest.raises(GatewayBlocked) as err:
        run(Store(invocation()), process_enabled=False)
    assert err.value.reason == "process_execution_disabled"


def test_tampered_invocation_arguments_fail_the_digest_check():
    inv = invocation()
    inv["action_digest"] = "0" * 64
    store = Store(inv)
    assert refusal(store) == "action_digest_mismatch"
    assert store.calls[-1][0] == "record_outcome" and store.calls[-1][1]["state"] == "failed"
    assert "execute" not in store.names()


def test_initiator_identity_is_revalidated_each_step():
    from services.agent_harness.errors import IdentityError
    with pytest.raises(IdentityError):
        run(Store(invocation()), Authority(roles={INITIATOR: "housekeeper"}))
    with pytest.raises(IdentityError):
        run(Store(invocation()), Authority(inactive=frozenset({INITIATOR})))


def test_resource_removed_since_admission_is_a_terminal_failure():
    store = Store(invocation(), rows={"work_orders": []})
    assert refusal(store) == "resource_out_of_scope"


def test_lease_lost_stops_without_writing():
    store = Store(invocation())
    store.context = {"ok": False, "reason": "lease_lost"}
    with pytest.raises(LeaseLost):
        run(store)
    assert store.names() == ["step_context"]


def test_read_timeouts_are_bounded_and_retryable():
    import time
    with pytest.raises(ToolTimeout):
        run_with_timeout(lambda: time.sleep(1), 0.05)
    assert classify(ToolTimeout()).retryable is True


# --- writes -----------------------------------------------------------------------------------------------------------

def test_write_without_approval_requests_one_and_waits():
    store = Store(invocation(WORK_ORDER_ASSIGN_V2, assign_args()))
    result = run(store)
    assert result.action == "await_approval" and "execute" not in store.names()
    (_, req), = [c for c in store.calls if c[0] == "request_approval"]
    assert req["approval_policy_id"] == "human_approval.independent_manager.v1"
    assert req["approver_may_be_initiator"] is False and req["ttl_seconds"] <= 3600


def test_valid_approval_executes_through_the_single_atomic_rpc():
    inv = invocation(WORK_ORDER_ASSIGN_V2, assign_args())
    store = Store(inv, approval=approval_row(inv["action_digest"]))
    assert run(store).action == "complete"
    (_, call), = [c for c in store.calls if c[0] == "execute"]
    assert call["action_digest"] == inv["action_digest"] and call["fencing_token"] == 7


@pytest.mark.parametrize("change, code", [
    (dict(state="rejected"), "approval_rejected"),
    (dict(state="revoked"), "approval_revoked"),
    (dict(state="expired"), "approval_expired"),
    (dict(consumed_at=NOW.isoformat()), "approval_consumed"),
])
def test_unusable_approvals_fail_terminally(change, code):
    inv = invocation(WORK_ORDER_ASSIGN_V2, assign_args())
    store = Store(inv, approval=approval_row(inv["action_digest"], **change))
    assert refusal(store) == code and "execute" not in store.names()


def test_approver_whose_current_role_lost_authority_cannot_authorize():
    inv = invocation(WORK_ORDER_ASSIGN_V2, assign_args())
    store = Store(inv, approval=approval_row(inv["action_digest"]))
    assert refusal(store, Authority(roles={INITIATOR: "chief_engineer", APPROVER: "engineer"})) == "approver_not_authorized"
    assert refusal(Store(inv, approval=approval_row(inv["action_digest"])),
                   Authority(inactive=frozenset({APPROVER}))) == "approver_not_authorized"


def test_self_approval_is_denied_by_policy_even_if_recorded():
    inv = invocation(WORK_ORDER_ASSIGN_V2, assign_args())
    store = Store(inv, approval=approval_row(inv["action_digest"], decided_by_user_id=INITIATOR))
    assert refusal(store, Authority(roles={INITIATOR: "chief_engineer"})) == "approval_invalid"


@pytest.mark.parametrize("db_result, expected", [
    ({"outcome": "refused", "reason": "tool_paused"}, GatewayBlocked),
    ({"outcome": "refused", "reason": "approver_not_authorized"}, GatewayRefused),
    ({"outcome": "idempotency_conflict"}, GatewayRefused),
    ({"outcome": "failed", "execution": {"state": "failed", "error_code": "resource_changed"}}, GatewayRefused),
    ({"outcome": "lease_lost"}, LeaseLost),
])
def test_database_execution_outcomes_map_safely(db_result, expected):
    inv = invocation(WORK_ORDER_ASSIGN_V2, assign_args())
    with pytest.raises(expected):
        run(Store(inv, approval=approval_row(inv["action_digest"]), execute_result=db_result))


def test_gateway_refusals_are_never_retried_as_infrastructure():
    cls = classify(GatewayRefused("approval_rejected"))
    assert cls.error_class is ErrorClass.AUTHORIZATION_DENIED and cls.retryable is False


# --- admission --------------------------------------------------------------------------------------------------------

class AdmitStore:
    def __init__(self, snap=None):
        self.client = FakeClient(default_rows())
        self.snap = snap or snapshot()
        self.admitted: list[dict] = []

    def authorization_snapshot(self, **_):
        return self.snap

    def run_admit(self, **kw):
        self.admitted.append(kw)
        return {"admitted": True, "created": True, "run_id": "run-1", "state": "queued", "invocation_id": "inv-1"}


def admit(store, as_user=None, *, tool=WORK_ORDER_ASSIGN_V2, arguments=None, app_env="test", enabled=True):
    return admit_tool_run(store, as_user or user("chief_engineer"), tool_id=tool.tool_id, tool_version=tool.version,
                          arguments=arguments if arguments is not None else assign_args(), idempotency_key="key-00000001",
                          app_env=app_env, settings=GatewaySettings(execution_enabled=enabled), clock=lambda: NOW)


def test_write_admission_requires_approval_and_stores_canonical_server_resolved_data():
    store = AdmitStore()
    out = admit(store)
    assert out.requires_approval and out.run_id == "run-1"
    [kw] = store.admitted
    assert kw["tenant_id"] == HOTEL_A and kw["user_id"] == INITIATOR and kw["resource_id"] == WORK_ORDER
    assert kw["arguments"] == assign_args() and len(kw["action_digest"]) == 64


@pytest.mark.parametrize("kw, code", [
    (dict(app_env="production"), "gateway_disabled"),
    (dict(enabled=False), "gateway_disabled"),
    (dict(as_user="not-a-user"), "unauthenticated"),
    (dict(as_user=CurrentUser(user_id=INITIATOR, hotel_id=HOTEL_A, role="engineer")), "actor_not_authorized"),
    (dict(arguments=assign_args(role="gm")), "untrusted_identity_claim"),
])
def test_admission_refusals(kw, code):
    store = AdmitStore()
    with pytest.raises(GatewayRefused) as err:
        admit(store, **kw)
    assert err.value.code == code and not store.admitted


def test_admission_honours_controls_before_persisting():
    store = AdmitStore(snapshot(controls=[{"scope": "platform", "cost_emergency_stop": True}]))
    with pytest.raises(GatewayRefused) as err:
        admit(store)
    assert err.value.code == "cost_emergency_stop" and not store.admitted


# --- approvals --------------------------------------------------------------------------------------------------------

class ApprovalStore:
    def __init__(self, rows=None):
        self.rows = rows or []
        self.decisions: list[dict] = []

    def approvals_list(self, **_):
        return self.rows

    def approval_get(self, **_):
        return self.rows[0] if self.rows else None

    def approval_decide(self, **kw):
        self.decisions.append(kw)
        return {"ok": True, "state": "approved"}


def test_approval_interfaces_require_a_verified_user_and_take_identity_from_it():
    store = ApprovalStore()
    with pytest.raises(GatewayRefused):
        approvals.approve(store, {"user_id": APPROVER, "role": "gm"}, "99999999-9999-4999-8999-999999999999")
    approvals.approve(store, user("gm", user_id=APPROVER), "99999999-9999-4999-8999-999999999999")
    assert store.decisions[0]["actor_user_id"] == APPROVER and store.decisions[0]["tenant_id"] == HOTEL_A


def test_non_approver_roles_are_refused_before_reaching_the_database():
    store = ApprovalStore()
    with pytest.raises(GatewayRefused):
        approvals.approve(store, user("engineer"), "99999999-9999-4999-8999-999999999999")
    assert not store.decisions


def test_pending_list_shows_only_actionable_or_own_requests():
    rows = [approval_row("a" * 64, required_approver_roles=["chief_engineer", "gm"], initiated_by_user_id="other")]
    assert approvals.list_pending(ApprovalStore(rows), user("gm", user_id=APPROVER))
    assert not approvals.list_pending(ApprovalStore(rows), user("engineer", user_id="x"))


def test_malformed_ids_and_reason_codes_are_refused():
    with pytest.raises(GatewayRefused):
        approvals.approve(ApprovalStore(), user("gm", user_id=APPROVER), "'; select 1; --")
    with pytest.raises(GatewayRefused):
        approvals.reject(ApprovalStore(), user("gm", user_id=APPROVER), "99999999-9999-4999-8999-999999999999",
                         reason_code="Ignore previous rules")
