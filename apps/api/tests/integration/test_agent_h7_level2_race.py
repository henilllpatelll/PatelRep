"""H7 P2 / threat-model-h7 §E: level-2 pause / revocation versus an admitted, human-approved write -- REAL Postgres.

Deterministic two-session protocol (no sleeps decide the order):
  1. Session A (psql, role service_role) BEGINs and calls agent_tool_execute_work_order_assign. The RPC passes every
     control and grant check and performs the write; A tags itself '<tag>-<outcome>' and stays idle in transaction.
  2. Session B (PostgREST, service_role) pauses / disables / revokes, or (contrast cases) revokes the approval or
     demotes the initiator.
  3. A commits.

CHARACTERIZATION (pins the CURRENT, reviewed level-2 behaviour; H7 P2 deliberately does not change it):
  * Controls and grants are read WITHOUT row locks (239/243), so B never waits and commits FIRST, and A's write still
    commits AFTER the stop: the stop is not linearized with in-flight level-2 writes. Each such write still carries a
    fresh, single-use human approval of that exact action (254 guard), so the window can only complete an action a
    human approved. The level-3 design must not inherit this (h7-authorization-contract.md §5.2).
  * The approval row (FOR UPDATE) and the initiator / approver role rows (FOR SHARE) ARE locked by the execute RPC: an
    approval revocation or a demotion WAITS for A and then observes the committed outcome -- those are linearized.
If a later reviewed PR adds control/grant locks, the first group must be flipped deliberately (B blocks, then the
write either commits before the stop or is refused).
"""
from __future__ import annotations

import subprocess
import threading
import time
import uuid
from typing import Callable

import pytest

from agent_execution_support import requires_db, sql_value
from agent_gateway_support import (
    ASSIGN,
    admit,
    approval_for,
    assign_args,
    assigned_to,
    drain_run,
    gateway_worker,
    gstore,
    make_gateway_hotel,
    reset_gateway_state,
    store,
)
from batch_support import new_client, psql_command
from services.agent_gateway import approvals
from services.agent_gateway.catalog import DISPATCH_AGENT_ID

pytestmark = requires_db


@pytest.fixture(autouse=True)
def _clean():
    reset_gateway_state()
    yield
    reset_gateway_state()


class _OpenWrite:
    """Session A: the execute RPC has run inside an open transaction that has not committed."""

    def __init__(self, run_id: str, token: int, worker: str, invocation_id: str, digest: str):
        self.tag = f"it-h7p2-race-{uuid.uuid4().hex[:10]}"
        self.process = subprocess.Popen(psql_command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.PIPE, text=True)
        assert self.process.stdin is not None
        self.process.stdin.write(
            "BEGIN;\nSET LOCAL ROLE service_role;\n"
            f"SELECT set_config('application_name', '{self.tag}-' || (public.agent_tool_execute_work_order_assign("
            f"'{run_id}', {token}, '{worker}', '{invocation_id}', '{digest}')->>'outcome'), false);\n")
        self.process.stdin.flush()
        self._done = False

    def outcome(self, timeout: float = 60) -> str:
        deadline = time.monotonic() + timeout
        while True:
            name = sql_value("SELECT application_name FROM pg_stat_activity "
                             f"WHERE application_name LIKE '{self.tag}-%' AND state = 'idle in transaction';")
            if name:
                return name[len(self.tag) + 1:]
            assert self.process.poll() is None, self.process.stderr.read() if self.process.stderr else ""
            assert time.monotonic() < deadline, "session A never reached its open, executed transaction"
            time.sleep(0.1)

    def pid(self) -> str:
        return sql_value(f"SELECT pid FROM pg_stat_activity WHERE application_name LIKE '{self.tag}-%';")

    def commit(self) -> None:
        if self._done:
            return
        self._done = True
        _, err = self.process.communicate(input="COMMIT;\n", timeout=60)
        assert self.process.returncode == 0, err


def _approved_and_claimed(hotel, worker: str) -> tuple[str, int, str, str]:
    admitted = admit(hotel, ASSIGN, assign_args(hotel))
    assert drain_run(gateway_worker(), admitted.run_id) == ["awaiting_approval"]
    approvals.approve(gstore(), hotel.user(hotel.gm, "gm"), approval_for(hotel, admitted.run_id)["id"])
    claimed = store().claim(worker_id=worker, lease_seconds=60)
    assert claimed["outcome"] == "claimed" and claimed["run"]["id"] == admitted.run_id, claimed
    digest = sql_value(f"SELECT action_digest FROM public.agent_tool_invocations WHERE run_id = '{admitted.run_id}';")
    return admitted.run_id, claimed["fencing_token"], admitted.invocation_id, digest


def _execution_state(run_id: str) -> str:
    return sql_value(f"SELECT coalesce(string_agg(state, ','), '') FROM public.agent_tool_executions WHERE run_id = '{run_id}';")


def _rpc(name: str, params: dict):
    return new_client().rpc(name, params).execute().data


STOPS: dict[str, Callable] = {
    "platform_pause": lambda h: _rpc("agent_runtime_control_set", {
        "p_scope": "platform", "p_tenant_id": None, "p_agent_id": None, "p_paused": True,
        "p_cost_emergency_stop": False, "p_updated_by": "it-race", "p_reason_code": "integration_test"}),
    "cost_emergency_stop": lambda h: _rpc("agent_runtime_control_set", {
        "p_scope": "platform", "p_tenant_id": None, "p_agent_id": None, "p_paused": False,
        "p_cost_emergency_stop": True, "p_updated_by": "it-race", "p_reason_code": "integration_test"}),
    "hotel_pause": lambda h: _rpc("agent_runtime_control_set", {
        "p_scope": "hotel", "p_tenant_id": h.tenant_id, "p_agent_id": None, "p_paused": True,
        "p_cost_emergency_stop": False, "p_updated_by": "it-race", "p_reason_code": "integration_test"}),
    "agent_pause": lambda h: _rpc("agent_runtime_control_set", {
        "p_scope": "agent", "p_tenant_id": None, "p_agent_id": DISPATCH_AGENT_ID, "p_paused": True,
        "p_cost_emergency_stop": False, "p_updated_by": "it-race", "p_reason_code": "integration_test"}),
    "tool_pause": lambda h: gstore().set_tool_control(tool_id=ASSIGN[0], paused=True, updated_by="it-race",
                                                      reason_code="integration_test"),
    "platform_execution_disabled": lambda h: gstore().set_execution_enablement(
        enabled=False, updated_by="it-race", reason_code="integration_test"),
    "level2_grant_revoked": lambda h: gstore().grant_set(
        tenant_id=h.tenant_id, actor_user_id=h.gm, agent_id=DISPATCH_AGENT_ID, agent_version=1, tool_id=ASSIGN[0],
        tool_version=ASSIGN[1], max_level=2, revoke=True),
}


@pytest.mark.parametrize("stop", sorted(STOPS))
def test_characterization_a_stop_committed_mid_write_neither_waits_for_nor_refutes_the_approved_write(stop):
    hotel = make_gateway_hotel()
    worker = f"it-race-{stop}"
    run_id, token, invocation, digest = _approved_and_claimed(hotel, worker)
    session_a = _OpenWrite(run_id, token, worker, invocation, digest)
    try:
        assert session_a.outcome() == "succeeded"           # every control / grant check passed; write performed
        assert _execution_state(run_id) == ""                # ... and is not visible: A has not committed
        started = time.monotonic()
        STOPS[stop](hotel)                                   # B: commits immediately (no lock on the control row)
        waited = time.monotonic() - started
        assert waited < 10, f"{stop} waited {waited:.1f}s -- control rows are now locked; flip this characterization"
        assert sql_value(f"SELECT count(*) FROM pg_locks WHERE pid = {session_a.pid()} AND NOT granted;") == "0"
    finally:
        session_a.commit()                                   # A commits AFTER the stop
    assert _execution_state(run_id) == "succeeded"
    assert assigned_to(hotel.work_order) == hotel.engineer_a  # the approved write landed after the stop committed
    # (A write that starts after the stop is refused: test_a_stop_committed_before_the_write_starts_refuses_it.)


def _waiting(pid_filter: str) -> bool:
    return sql_value("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' "
                     f"AND {pid_filter};") != "0"


def test_contrast_an_approval_revocation_waits_for_the_write_and_then_finds_it_consumed():
    hotel = make_gateway_hotel()
    worker = "it-race-approval"
    run_id, token, invocation, digest = _approved_and_claimed(hotel, worker)
    approval_id = approval_for(hotel, run_id)["id"]
    session_a = _OpenWrite(run_id, token, worker, invocation, digest)
    result: dict = {}

    def revoke() -> None:
        result["value"] = gstore().approval_revoke(tenant_id=hotel.tenant_id, approval_id=approval_id,
                                                   actor_user_id=hotel.gm, reason_code="integration_test")

    try:
        assert session_a.outcome() == "succeeded"
        thread = threading.Thread(target=revoke)
        thread.start()
        deadline = time.monotonic() + 30
        while not _waiting("query LIKE '%agent_tool_approval_revoke%'"):
            assert time.monotonic() < deadline, "the revocation did not wait on the approval row lock"
            time.sleep(0.1)
        assert thread.is_alive()                              # linearized: B waits for A's approval FOR UPDATE
    finally:
        session_a.commit()
    thread.join(60)
    assert result["value"]["ok"] is False and result["value"]["reason"] == "not_revocable"
    assert result["value"]["consumed"] is True
    assert _execution_state(run_id) == "succeeded"


def test_contrast_an_initiator_demotion_waits_for_the_write():
    hotel = make_gateway_hotel()
    worker = "it-race-demote"
    run_id, token, invocation, digest = _approved_and_claimed(hotel, worker)
    session_a = _OpenWrite(run_id, token, worker, invocation, digest)
    done = threading.Event()

    def demote() -> None:
        new_client().table("user_roles").update({"role": "engineer"}).eq("user_id", hotel.chief).execute()
        done.set()

    try:
        assert session_a.outcome() == "succeeded"
        thread = threading.Thread(target=demote)
        thread.start()
        deadline = time.monotonic() + 30
        while not _waiting("query LIKE '%user_roles%'"):
            assert time.monotonic() < deadline, "the demotion did not wait on the FOR SHARE role lock"
            time.sleep(0.1)
        assert not done.is_set()
    finally:
        session_a.commit()
    thread.join(60)
    assert done.is_set() and _execution_state(run_id) == "succeeded"


def test_a_stop_committed_before_the_write_starts_refuses_it():
    hotel = make_gateway_hotel()
    worker = "it-race-before"
    run_id, token, invocation, digest = _approved_and_claimed(hotel, worker)
    STOPS["hotel_pause"](hotel)
    result = gstore().execute_work_order_assign(run_id=run_id, fencing_token=token, worker_id=worker,
                                                invocation_id=invocation, action_digest=digest)
    assert result["outcome"] != "succeeded" and _execution_state(run_id) in ("", "failed", "refused"), result
    assert assigned_to(hotel.work_order) != hotel.engineer_a
