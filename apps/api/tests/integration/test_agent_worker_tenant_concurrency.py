"""H6 P1 (migration 257): hotel A and hotel B workers running AT THE SAME TIME, against the real restricted principal
(Kong -> PostgREST -> PostgreSQL as agent_worker), plus fail-closed drift of the pinned H1-H3 originals.

What is proven here (the sequential single-hotel properties live in test_agent_worker_tenant_binding.py):
  * simultaneous claims by two workers per hotel are disjoint (no run is claimed twice), tenant-pure, one fencing
    token each, and FIFO-fair inside the hotel;
  * SKIP LOCKED survives the tenant-scoped claim: a locked message of hotel A never blocks hotel B's claim, nor a second
    hotel-A claim (it skips, it does not wait);
  * lease fencing: a takeover by a second hotel-A worker fences out the first, and a hotel-B worker holding the CURRENT
    fencing token of hotel A's run still changes nothing;
  * concurrent recovery sweeps of A and B touch only their own hotel, and two sweeps of the same hotel never double-process;
  * billing settlement: concurrent settles of one attempt settle it once; the foreign hotel is always refused;
  * approval validity: approvals of both hotels execute concurrently, each consumed once by its own hotel's worker;
    a foreign worker racing to execute the same approval is refused and consumes nothing;
  * drift: any change to an original that a scoped copy reproduces (body or a new overload) fails the schema contract.
Contamination: hotels/runs/credentials created here persist in the disposable database (see the sibling module).
"""
from __future__ import annotations

import subprocess
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, wait
from decimal import Decimal
from pathlib import Path

import pytest
from postgrest.exceptions import APIError

from agent_execution_support import admit, make_hotel, requires_db, reset_execution_state, store
from agent_gateway_support import (
    ASSIGN,
    admit as admit_tool,
    approval_for,
    assign_args,
    assigned_to,
    gstore,
    make_gateway_hotel,
    reset_gateway_state,
    run_sql,
    sql_value,
)
from agent_orchestrator_support import attempt_state, events_of, ledger, planning_run, reserve, reset_spend_state, set_budgets
from agent_worker_identity_support import (
    ensure_test_deployment_identity,
    issue_token,
    raw_worker_client,
    restricted_process,
    restricted_worker,
)
from agent_worker_scoped_copies import SCOPED_COPIES
from batch_support import new_client, psql_command
from services.agent_execution.worker_identity import bound_worker_id
from services.agent_gateway import approvals

pytestmark = requires_db
REPO = Path(__file__).resolve().parents[4]
MISMATCH = "agent_worker_tenant_mismatch"
CLAIM = "agent_worker_rpc__agent_run_claim"


@pytest.fixture(autouse=True)
def _clean():
    reset_gateway_state()
    ensure_test_deployment_identity()
    yield
    reset_gateway_state()


def _race(*calls):
    """Run the callables at the same instant (barrier) on separate threads/HTTP clients; return their results in order."""
    barrier = threading.Barrier(len(calls))

    def go(fn):
        barrier.wait(timeout=30)
        try:
            return fn()
        except APIError as err:  # a refusal is a result, not a crash
            return {"error": f"{err.code}:{err.message}"}

    with ThreadPoolExecutor(max_workers=len(calls)) as pool:
        return [f.result(timeout=120) for f in [pool.submit(go, c) for c in calls]]


def _run_row(run_id: str) -> str:
    return sql_value(f"SELECT tenant_id || '|' || state || '|' || fencing_token || '|' || COALESCE(lease_owner, '') "
                     f"FROM public.agent_runs WHERE id = '{run_id}';")


# ---------------------------------------------------------------- claims
def test_simultaneous_claims_by_hotel_a_and_b_workers_are_disjoint_and_tenant_pure():
    reset_execution_state()
    a, _ = make_hotel(new_client())
    b, _ = make_hotel(new_client())
    runs = {a: [], b: []}
    for _ in range(4):  # interleaved: A, B, A, B, ... so every claim has a foreign message ahead of or behind it
        for tenant in (a, b):
            runs[tenant].append(admit(store(), tenant, spec={"operation": "noop", "steps": 1})["run_id"])
    tokens = {t: issue_token(f"it-p1-cc-{i}", tenant_id=t)[1] for i, t in enumerate((a, b))}
    workers = [(a, "a1"), (a, "a2"), (b, "b1"), (b, "b2")]

    def drain(tenant, name):
        client, wid, got = raw_worker_client(tokens[tenant]), bound_worker_id(tenant, f"it-p1-cc-{name}"), []
        for _ in range(8):
            out = client.rpc(CLAIM, {"p_worker": wid, "p_lease_seconds": 120}).execute().data
            if out["outcome"] == "empty":
                return got
            got.append((wid, out))
        return got

    results = _race(*[(lambda t=t, n=n: drain(t, n)) for t, n in workers])
    claimed = {a: [], b: []}
    for (tenant, _), got in zip(workers, results):
        for wid, out in got:
            assert out["outcome"] == "claimed" and out["run"]["tenant_id"] == tenant, out
            assert out["fencing_token"] == 1 and out["takeover"] is False, out
            claimed[tenant].append(out["run"]["id"])
            assert _run_row(out["run"]["id"]) == f"{tenant}|running|1|{wid}"
    for tenant in (a, b):
        assert sorted(claimed[tenant]) == sorted(runs[tenant]), (tenant, claimed[tenant])  # every run, exactly once
    ids = "', '".join(runs[a] + runs[b])
    assert sql_value(f"SELECT count(*) FROM public.agent_run_events WHERE event_type = 'claimed' "
                     f"AND run_id IN ('{ids}');") == "8"


class _RowLockHolder:
    """A psql session that holds FOR UPDATE on the given rows until release() — no timer decides how long.

    The session tags itself with application_name '<tag>-<locked row count>' only AFTER the FOR UPDATE statement has
    completed inside the open transaction, so 'idle in transaction' + that exact tag proves the lock is held right now.
    """

    def __init__(self, table: str, where: str):
        self.tag = f"it-p1-sl-{uuid.uuid4().hex[:12]}"
        self.process = subprocess.Popen(psql_command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.PIPE, text=True)
        self._send("BEGIN;\n"
                   f"SELECT set_config('application_name', '{self.tag}-' || "
                   f"(SELECT count(*) FROM (SELECT 1 FROM {table} WHERE {where} FOR UPDATE) locked), false);\n")
        self._released = False

    def _send(self, sql: str) -> None:
        assert self.process.stdin is not None
        self.process.stdin.write(sql)
        self.process.stdin.flush()

    def holding(self, rows: int) -> bool:
        return sql_value("SELECT count(*) FROM pg_stat_activity "
                         f"WHERE application_name = '{self.tag}-{rows}' AND state = 'idle in transaction';") == "1"

    def wait_until_holding(self, rows: int, timeout: float = 60) -> None:
        deadline = time.monotonic() + timeout
        while not self.holding(rows):
            assert self.process.poll() is None, f"lock holder exited: {self.process.stderr.read() if self.process.stderr else ''}"
            assert time.monotonic() < deadline, "lock holder did not acquire the row lock"
            time.sleep(0.1)

    def release(self) -> None:
        if self._released:
            return
        self._released = True
        # communicate() writes the COMMIT, then closes stdin itself (closing it first breaks communicate() on POSIX)
        _, err = self.process.communicate(input="COMMIT;\n", timeout=60)
        assert self.process.returncode == 0, f"lock holder failed: {err}"


def test_skip_locked_a_locked_message_of_one_hotel_never_blocks_a_claim():
    reset_execution_state()
    a, _ = make_hotel(new_client())
    b, _ = make_hotel(new_client())
    a_run = admit(store(), a, spec={"operation": "noop", "steps": 1})["run_id"]  # FIRST in the queue
    b_run = admit(store(), b, spec={"operation": "noop", "steps": 1})["run_id"]
    holder = _RowLockHolder("pgmq.q_patelrep_agent_runs_v1", f"message->>'run_id' = '{a_run}'")
    try:
        holder.wait_until_holding(rows=1)  # exactly hotel A's message is locked, and the transaction is still open
        raw_a, raw_b = raw_worker_client(tenant_id=a), raw_worker_client(tenant_id=b)
        barrier = threading.Barrier(2)

        def claim(client, tenant):
            barrier.wait(timeout=30)
            return client.rpc(CLAIM, {"p_worker": bound_worker_id(tenant, "it-p1-sl")}).execute().data

        pool = ThreadPoolExecutor(max_workers=2)
        futures = [pool.submit(claim, raw_b, b), pool.submit(claim, raw_a, a)]
        done, pending = wait(futures, timeout=60)
        if pending:  # a claim is WAITING on the held row lock: release it so the claim can finish, then fail
            holder.release()
            pool.shutdown(wait=True)
            pytest.fail("a claim blocked on hotel A's locked queue message instead of skipping it (no SKIP LOCKED)")
        pool.shutdown(wait=True)
        got_b, got_a = (f.result() for f in futures)
        # Both claims returned while the lock was provably still held, so neither of them waited for it.
        assert holder.holding(rows=1), "the row lock was released before the claims returned; the race proves nothing"
        assert got_b["outcome"] == "claimed" and got_b["run"]["id"] == b_run, got_b
        assert got_a == {"outcome": "empty"}, got_a  # skipped the locked row instead of waiting on it
        assert _run_row(a_run).split("|")[1] == "queued"
    finally:
        holder.release()
    claimed = raw_worker_client(tenant_id=a).rpc(CLAIM, {"p_worker": bound_worker_id(a, "it-p1-sl2")}).execute().data
    assert claimed["outcome"] == "claimed" and claimed["run"]["id"] == a_run


def test_lease_fencing_holds_across_takeover_and_against_a_foreign_worker_with_the_current_token():
    reset_execution_state()
    a, _ = make_hotel(new_client())
    b, _ = make_hotel(new_client())
    a_run = admit(store(), a, spec={"operation": "noop", "steps": 2})["run_id"]
    raw_a1, raw_a2, raw_b = (raw_worker_client(tenant_id=a), raw_worker_client(tenant_id=a),
                             raw_worker_client(tenant_id=b))
    w1, w2, wb = bound_worker_id(a, "it-p1-f1"), bound_worker_id(a, "it-p1-f2"), bound_worker_id(b, "it-p1-fb")
    first = raw_a1.rpc(CLAIM, {"p_worker": w1, "p_lease_seconds": 5}).execute().data
    assert first["outcome"] == "claimed" and first["fencing_token"] == 1
    run_sql(f"UPDATE public.agent_runs SET lease_expires_at = now() - interval '1 second' WHERE id = '{a_run}';"
            f"UPDATE pgmq.q_patelrep_agent_runs_v1 SET vt = now() - interval '1 second' WHERE message->>'run_id' = '{a_run}';")
    second = raw_a2.rpc(CLAIM, {"p_worker": w2, "p_lease_seconds": 60}).execute().data
    assert second["outcome"] == "claimed" and second["fencing_token"] == 2 and second["takeover"] is True, second
    step = second["step"]["id"]
    # the fenced-out first worker and a hotel-B worker holding the CURRENT token race the rightful owner
    stale, foreign, owner = _race(
        lambda: raw_a1.rpc("agent_worker_rpc__agent_step_complete", {
            "p_run_id": a_run, "p_step_id": step, "p_fencing_token": 1, "p_worker": w1, "p_result_meta": {}}).execute().data,
        lambda: raw_b.rpc("agent_worker_rpc__agent_step_complete", {
            "p_run_id": a_run, "p_step_id": step, "p_fencing_token": 2, "p_worker": wb, "p_result_meta": {}}).execute().data,
        lambda: raw_a2.rpc("agent_worker_rpc__agent_run_heartbeat", {
            "p_run_id": a_run, "p_fencing_token": 2, "p_worker": w2, "p_lease_seconds": 60}).execute().data)
    assert stale["outcome"] == "lease_lost", stale
    assert MISMATCH in foreign["error"], foreign
    assert owner["ok"] is True, owner
    assert _run_row(a_run) == f"{a}|running|2|{w2}"
    assert sql_value(f"SELECT state FROM public.agent_run_steps WHERE id = '{step}';") == "running"


# ---------------------------------------------------------------- recovery sweeps
def test_concurrent_recovery_sweeps_of_two_hotels_touch_only_their_own_runs_once():
    reset_execution_state()
    a, _ = make_hotel(new_client())
    b, _ = make_hotel(new_client())
    runs = {t: [admit(store(), t, spec={"operation": "noop", "steps": 1})["run_id"] for _ in range(3)] for t in (a, b)}
    run_sql("UPDATE public.agent_runs SET deadline_at = now() - interval '1 second' WHERE id IN ('"
            + "', '".join(runs[a] + runs[b]) + "');")
    clients = [raw_worker_client(tenant_id=t) for t in (a, a, b, b)]
    results = _race(*[(lambda c=c: c.rpc("agent_worker_rpc__agent_runs_recover", {"p_limit": 1000}).execute().data)
                      for c in clients])
    # two sweeps per hotel: together they fail each of that hotel's 3 runs exactly once, never the other hotel's
    assert results[0]["deadline_failed"] + results[1]["deadline_failed"] == 3, results
    assert results[2]["deadline_failed"] + results[3]["deadline_failed"] == 3, results
    for tenant in (a, b):
        for run in runs[tenant]:
            assert _run_row(run).startswith(f"{tenant}|failed|"), run


# ---------------------------------------------------------------- billing settlement
def _settle(client, attempt: str, token: int):
    return lambda: client.rpc("agent_worker_rpc__agent_billing_attempt_settle", {
        "p_attempt_id": attempt, "p_fencing_token": token, "p_outcome": "settled", "p_cost_usd": 0.0001,
        "p_usage_status": "reported", "p_usage": {"uncached_input": 100, "output": 10}, "p_cost_status": "costed",
        "p_cost_cause": None, "p_cost_tier": None, "p_reported_model": "gpt-6-luna", "p_provider_request_id": "req_1",
        "p_provider_response_id": "resp_1", "p_error_code": None}).execute().data


def test_concurrent_settlement_settles_once_and_the_foreign_hotel_is_always_refused():
    reset_spend_state()
    a, b = make_gateway_hotel(grant=False), make_gateway_hotel(grant=False)
    set_budgets(b)
    claimed = planning_run(b, worker="it-p1-settle")
    reserved = reserve(claimed)
    assert reserved.ok, reserved
    attempt = reserved.attempt.attempt_id
    assert ledger().dispatch(attempt_id=attempt, run_id=claimed.run_id, fencing_token=claimed.token,
                             worker_id=claimed.worker).ok
    raw_a1, raw_a2 = raw_worker_client(tenant_id=a.tenant_id), raw_worker_client(tenant_id=a.tenant_id)
    raw_b1, raw_b2 = raw_worker_client(tenant_id=b.tenant_id), raw_worker_client(tenant_id=b.tenant_id)
    fa1, fa2, b1, b2 = _race(_settle(raw_a1, attempt, claimed.token), _settle(raw_a2, attempt, claimed.token),
                             _settle(raw_b1, attempt, claimed.token), _settle(raw_b2, attempt, claimed.token))
    assert MISMATCH in fa1["error"] and MISMATCH in fa2["error"], (fa1, fa2)
    assert "error" not in b1 and "error" not in b2, (b1, b2)
    assert attempt_state(attempt) == "settled"
    assert events_of(claimed.run_id).count("settled:") == 1, events_of(claimed.run_id)
    settled = sql_value(f"SELECT state || '|' || settled_usd::numeric FROM public.agent_model_attempts WHERE id = '{attempt}';")
    assert settled.split("|")[0] == "settled" and Decimal(settled.split("|")[1]) == Decimal("0.0001"), settled


# ---------------------------------------------------------------- approval validity
def test_approvals_of_two_hotels_execute_concurrently_and_a_racing_foreign_worker_consumes_nothing():
    ga, gb = make_gateway_hotel(), make_gateway_hotel()
    admitted = {h.tenant_id: admit_tool(h, ASSIGN, assign_args(h, note="p1 concurrency")) for h in (ga, gb)}
    workers = {h.tenant_id: restricted_worker(f"it-p1-ap-{i}", tenant_id=h.tenant_id, gateway=True)
               for i, h in enumerate((ga, gb))}
    waiting = _race(*[(lambda t=t: restricted_process(*workers[t])) for t in (ga.tenant_id, gb.tenant_id)])
    assert waiting == ["awaiting_approval", "awaiting_approval"], waiting
    approval = {h.tenant_id: approval_for(h, admitted[h.tenant_id].run_id) for h in (ga, gb)}
    for h in (ga, gb):
        assert approvals.approve(gstore(), h.user(h.gm, "gm"), approval[h.tenant_id]["id"])["state"] == "approved"
    # hotel B's raw worker races hotel A's own worker for hotel A's approved execution
    raw_b = raw_worker_client(tenant_id=gb.tenant_id)
    a_app = approval[ga.tenant_id]
    foreign_execute = lambda: raw_b.rpc("agent_worker_rpc__agent_tool_execute_work_order_assign", {  # noqa: E731
        "p_run_id": admitted[ga.tenant_id].run_id, "p_fencing_token": 1, "p_worker": bound_worker_id(gb.tenant_id, "x"),
        "p_invocation_id": a_app["invocation_id"], "p_action_digest": a_app["action_digest"]}).execute().data
    outcomes = _race(lambda: restricted_process(*workers[ga.tenant_id]),
                     lambda: restricted_process(*workers[gb.tenant_id]), foreign_execute)
    assert outcomes[0] == "run_succeeded" and outcomes[1] == "run_succeeded", outcomes
    assert MISMATCH in outcomes[2]["error"], outcomes[2]
    for h in (ga, gb):
        assert assigned_to(h.work_order) == h.engineer_a
        row = approval_for(h, admitted[h.tenant_id].run_id)
        assert row["consumed_at"] is not None
        executions = sql_value(f"SELECT count(*) || '|' || min(state) FROM public.agent_tool_executions "
                               f"WHERE run_id = '{admitted[h.tenant_id].run_id}';")
        assert executions == "1|succeeded", (h.tenant_id, executions)


def test_concurrent_approval_sweeps_expire_only_their_own_hotels_approvals():
    ga, gb = make_gateway_hotel(), make_gateway_hotel()
    pending = {}
    for i, h in enumerate((ga, gb)):
        pending[h.tenant_id] = admit_tool(h, ASSIGN, assign_args(h)).run_id
        assert restricted_process(*restricted_worker(f"it-p1-sw-{i}", tenant_id=h.tenant_id, gateway=True)) \
            == "awaiting_approval"
    ids = "', '".join(pending.values())
    run_sql("BEGIN; ALTER TABLE public.agent_tool_approvals DISABLE TRIGGER agent_tool_approvals_guard_update;"
            f"UPDATE public.agent_tool_approvals SET created_at = now() - interval '2 hours', "
            f"expires_at = now() - interval '1 second' WHERE run_id IN ('{ids}');"
            "ALTER TABLE public.agent_tool_approvals ENABLE TRIGGER agent_tool_approvals_guard_update; COMMIT;")
    before_b = approval_for(gb, pending[gb.tenant_id])["state"]
    sweeps = _race(*[(lambda: raw_worker_client(tenant_id=ga.tenant_id).rpc(
        "agent_worker_rpc__agent_tool_approvals_expire", {"p_limit": 1000}).execute().data) for _ in range(2)])
    assert sum(s["approvals_expired"] for s in sweeps) == 1, sweeps  # A's single approval, once
    assert approval_for(ga, pending[ga.tenant_id])["state"] == "expired"
    assert approval_for(gb, pending[gb.tenant_id])["state"] == before_b == "requested"
    swept_b = raw_worker_client(tenant_id=gb.tenant_id).rpc("agent_worker_rpc__agent_tool_approvals_expire",
                                                           {"p_limit": 1000}).execute().data
    assert swept_b["approvals_expired"] == 1 and approval_for(gb, pending[gb.tenant_id])["state"] == "expired", swept_b


# ---------------------------------------------------------------- drift of the pinned originals fails closed
def _contract() -> str:
    return (REPO / "scripts" / "schema-contracts.sql").read_text(encoding="utf-8")


@pytest.mark.parametrize("original", sorted(SCOPED_COPIES))
def test_a_changed_original_or_a_new_overload_fails_the_contract(original):
    """If a later migration changes an original that a scoped copy reproduces (even by one comment), or adds an
    overload under its name, the schema contract refuses the database, so the copy can never silently diverge."""
    definition = run_sql("\\pset tuples_only on\n\\pset format unaligned\n"
                         f"SELECT pg_get_functiondef('{original}'::regprocedure);").rstrip("\n")
    assert definition.rstrip().endswith("$function$")
    marker = f"-- p1 drift probe {uuid.uuid4().hex}"
    body_changed = definition.replace("\nEND;\n$function$", f"\n{marker}\nEND;\n$function$", 1)
    assert body_changed != definition
    name = original.split("(")[0]
    # owner-only (no PUBLIC/anon/authenticated EXECUTE), so only the P1 body/overload pin can catch it
    overload = (f"CREATE FUNCTION {name}(p_drift_probe boolean) RETURNS jsonb LANGUAGE sql SET search_path = '' "
                f"AS $f$ SELECT '{{}}'::jsonb $f$;\n"
                f"REVOKE ALL ON FUNCTION {name}(boolean) FROM PUBLIC, anon, authenticated, service_role")
    for label, mutation in (("body", body_changed), ("overload", overload)):
        with pytest.raises(AssertionError) as err:
            run_sql(f"BEGIN;\n{mutation};\n{_contract()}\nROLLBACK;")
        assert "body changed" in str(err.value) or "overloaded" in str(err.value), (label, str(err.value)[-400:])
    # rolled back: the live original is untouched and the contract still passes
    assert sql_value(f"SELECT count(*) FROM pg_proc WHERE proname = '{name.split('.')[1]}' "
                     f"AND pronamespace = 'public'::regnamespace;") == "1"
    run_sql(f"BEGIN;\n{_contract()}\nROLLBACK;")
