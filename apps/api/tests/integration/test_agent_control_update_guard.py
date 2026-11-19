"""Migration 260: UPDATE integrity of agent safety controls, grants and approvals, on a REAL migrated database.

Before 260 the 256 Control Center journal compared only the state columns, so a direct UPDATE (service role, under the
CI / Staging Candidate fixture GRANT ALL, or the owner) could move an active pause to another hotel / agent / tool, move a
grant to another hotel / agent version / tool / tool version, relabel an operator pause as a GM's (lifting the operator
lock), or change a grant's risk ceiling and granting user -- with nothing journaled. A direct UPDATE could also decide a
pending approval in the name of someone without current authority.

260 adds a BEFORE UPDATE row guard (identity immutable; approval decisions need agent__human_authority) on exactly four
tables, and widens the journal comparison to updated_by (runtime controls) and max_risk / granted_by / revoked_by
(grants). Every probe that changes state runs in a transaction that is rolled back.
"""
from __future__ import annotations

import pytest

from agent_execution_support import QUEUE, requires_db
from agent_gateway_support import (
    ASSIGN,
    admit,
    approval_for,
    assign_args,
    drain_run,
    gateway_worker,
    gstore,
    make_gateway_hotel,
    reset_gateway_state,
    run_sql,
    sql_value,
)
from batch_support import new_client
from services.agent_gateway import approvals

pytestmark = requires_db

GUARDED = ("agent_runtime_controls", "agent_tool_approvals", "agent_tool_controls", "agent_tool_grants")
TOOL = ASSIGN[0]
OTHER_TOOL = "engineering.work_orders.lookup"
AGENT = "engineering.dispatch_assistant"
BLANKET_GRANT = "GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;"
IMMUTABLE = "identity is immutable"
NO_AUTHORITY = "decided only by a current member holding one of its approver roles"

# attempt() runs one UPDATE as a role and reports the outcome without aborting the transaction; gate() reads exactly
# what the execution / dispatch gates read for a hotel.
HELPERS = """
CREATE FUNCTION pg_temp.attempt(p_role text, p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE n bigint;
BEGIN
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    EXECUTE 'WITH d AS (' || p_sql || ' RETURNING 1) SELECT count(*) FROM d' INTO n;
    RESET ROLE;
    RETURN 'updated:' || n;
  EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ':' || SQLERRM;
  END;
END $f$;
CREATE FUNCTION pg_temp.gate(p_tenant uuid, p_agent text) RETURNS text LANGUAGE sql AS $f$
  SELECT 'block=' || coalesce(public.agent__control_block_reason(p_tenant, p_agent), 'none')
      || ';tool_paused=' || EXISTS (SELECT 1 FROM public.agent_tool_controls WHERE tool_id = '""" + TOOL + """' AND paused);
$f$;
"""


@pytest.fixture(autouse=True)
def _clean():
    reset_gateway_state()
    yield
    reset_gateway_state()


@pytest.fixture(scope="module")
def hotel():
    return make_gateway_hotel()


@pytest.fixture(scope="module")
def other():
    return make_gateway_hotel()


def _probe(body: str) -> dict:
    out = run_sql("\\pset tuples_only on\n\\pset format unaligned\nBEGIN;\n" + HELPERS + body + "\nROLLBACK;", timeout=120)
    return {k: v for k, v in (line.strip().split("=", 1) for line in out.splitlines() if "=" in line and not line.startswith(" "))}


def _three_ways(update: str) -> str:
    """The same UPDATE as the least-privileged service role, the service role under a blanket grant, and the owner."""
    return (f"SELECT 'svc=' || pg_temp.attempt('service_role', $q${update}$q$);\n"
            f"{BLANKET_GRANT}\n"
            f"SELECT 'svc_granted=' || pg_temp.attempt('service_role', $q${update}$q$);\n"
            f"SELECT 'owner=' || pg_temp.attempt('postgres', $q${update}$q$);\n")


def _refused(out: dict, message: str) -> bool:
    return all(out[k].startswith("P0001:") and message in out[k] for k in ("svc", "svc_granted", "owner"))


# --- catalog ---------------------------------------------------------------------------------------------------------

def test_the_guard_is_exactly_four_plain_before_update_row_triggers_on_the_reviewed_tables():
    found = sql_value("""
      SELECT string_agg(c.relname, ',' ORDER BY c.relname) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE t.tgname = 'agent_control_update_guard' AND t.tgenabled = 'O' AND t.tgtype = 19 AND NOT t.tgisinternal
         AND t.tgconstraint = 0 AND t.tgqual IS NULL AND t.tgnargs = 0 AND t.tgattr = ''::int2vector
         AND t.tgfoid = 'public.agent__guard_control_update()'::regprocedure
         AND c.relnamespace = 'public'::regnamespace;""")
    assert tuple(found.split(",")) == GUARDED
    assert sql_value("SELECT count(*) FROM pg_trigger WHERE tgfoid = 'public.agent__guard_control_update()'::regprocedure;") == "4"
    assert sql_value("SELECT prosecdef::text || ',' || array_to_string(proconfig, ';') || ',' || pg_get_userbyid(proowner) "
                     "FROM pg_proc WHERE oid = 'public.agent__guard_control_update()'::regprocedure;") == \
        'false,search_path="",postgres'
    # the journal trigger function stays the single reviewed SECURITY DEFINER writer on all seven control tables
    assert sql_value("SELECT prosecdef::text || ',' || array_to_string(proconfig, ';') || ',' || pg_get_userbyid(proowner) "
                     "FROM pg_proc WHERE oid = 'public.agent__journal_control_change()'::regprocedure;") == \
        'true,search_path="",postgres'
    assert sql_value("SELECT count(*) FROM pg_trigger WHERE tgname = 'agent_control_center_journal' AND tgenabled = 'O' "
                     "AND tgfoid = 'public.agent__journal_control_change()'::regprocedure;") == "7"
    for role in ("anon", "authenticated", "agent_worker"):
        for fn in ("agent__guard_control_update()", "agent__journal_control_change()"):
            assert sql_value(f"SELECT has_function_privilege('{role}', 'public.{fn}', 'EXECUTE');") == "f", (role, fn)
    with pytest.raises(AssertionError) as err:
        run_sql("SELECT public.agent__guard_control_update();")
    assert "trigger functions can only be called as triggers" in str(err.value)
    assert sql_value("SELECT count(*) FROM public.agent_audit_privilege_violations();") == "0"


# --- a pause cannot be retargeted (direct SQL: service role, service role under a blanket grant, owner) --------------

PAUSES = [
    ("hotel pause -> other hotel",
     "SELECT public.agent_runtime_control_set('hotel', '{tenant}', NULL, true, false, 'it-op', 'incident');",
     "UPDATE public.agent_runtime_controls SET tenant_id = '{other}' WHERE scope = 'hotel' AND tenant_id = '{tenant}'",
     "block=hotel_paused"),
    ("agent pause -> other agent",
     f"SELECT public.agent_runtime_control_set('agent', NULL, '{AGENT}', true, false, 'it-op', 'incident');",
     f"UPDATE public.agent_runtime_controls SET agent_id = 'housekeeping.other_agent' WHERE scope = 'agent' AND agent_id = '{AGENT}'",
     "block=agent_paused"),
    ("hotel pause -> agent scope",
     "SELECT public.agent_runtime_control_set('hotel', '{tenant}', NULL, true, false, 'it-op', 'incident');",
     "UPDATE public.agent_runtime_controls SET scope = 'agent', tenant_id = NULL, agent_id = 'housekeeping.other_agent' "
     "WHERE scope = 'hotel' AND tenant_id = '{tenant}'",
     "block=hotel_paused"),
    ("tool pause -> other tool",
     f"SELECT public.agent_tool_control_set('{TOOL}', true, 'it-op', 'incident');",
     f"UPDATE public.agent_tool_controls SET tool_id = '{OTHER_TOOL}' WHERE tool_id = '{TOOL}'",
     "tool_paused=true"),
]


@pytest.mark.parametrize("label,setup,update,survives", PAUSES, ids=[p[0] for p in PAUSES])
def test_a_pause_cannot_be_retargeted(hotel, other, label, setup, update, survives):
    setup = setup.format(tenant=hotel.tenant_id)
    update = update.format(tenant=hotel.tenant_id, other=other.tenant_id)
    out = _probe(f"{setup}\n"
                 f"SELECT 'journal0=' || count(*) FROM public.agent_control_center_events;\n"
                 + _three_ways(update) +
                 f"SELECT 'gate=' || pg_temp.gate('{hotel.tenant_id}', '{AGENT}');\n"
                 f"SELECT 'gate_other=' || pg_temp.gate('{other.tenant_id}', 'housekeeping.other_agent');\n"
                 f"SELECT 'journal1=' || count(*) FROM public.agent_control_center_events;\n")
    assert _refused(out, IMMUTABLE), (label, out)
    assert survives in out["gate"], (label, out)
    assert "block=none" in out["gate_other"], (label, out)          # nothing was moved onto the other target
    assert out["journal0"] == out["journal1"], (label, out)


def test_postgrest_cannot_retarget_a_pause(hotel, other):
    run_sql(f"SELECT public.agent_runtime_control_set('hotel', '{hotel.tenant_id}', NULL, true, false, 'it-op', 'incident');"
            f"SELECT public.agent_tool_control_set('{TOOL}', true, 'it-op', 'incident');")
    db = new_client()
    for table, change, column, value in (
            ("agent_runtime_controls", {"tenant_id": other.tenant_id}, "tenant_id", hotel.tenant_id),
            ("agent_runtime_controls", {"scope": "agent", "tenant_id": None, "agent_id": "housekeeping.other_agent"},
             "tenant_id", hotel.tenant_id),
            ("agent_tool_controls", {"tool_id": OTHER_TOOL}, "tool_id", TOOL)):
        with pytest.raises(Exception) as err:
            db.table(table).update(change).eq(column, value).execute()
        assert IMMUTABLE in str(err.value), (table, change, err.value)
    assert sql_value(f"SELECT public.agent__control_block_reason('{hotel.tenant_id}', 'x.y');") == "hotel_paused"
    assert sql_value(f"SELECT public.agent__control_block_reason('{other.tenant_id}', 'x.y') IS NULL;") == "t"
    assert sql_value(f"SELECT paused FROM public.agent_tool_controls WHERE tool_id = '{TOOL}';") == "t"
    # the legitimate state change through the same API path still works and is journaled
    before = int(sql_value("SELECT count(*) FROM public.agent_control_center_events;"))
    db.table("agent_tool_controls").update({"paused": False, "updated_by": "it-op", "reason_code": "resolved"}) \
        .eq("tool_id", TOOL).execute()
    assert int(sql_value("SELECT count(*) FROM public.agent_control_center_events;")) == before + 1


# --- grants: identity frozen; risk ceiling and granting user journaled ----------------------------------------------

def _grant(hotel, tool: str = TOOL) -> str:
    return sql_value(f"SELECT id FROM public.agent_tool_grants WHERE tenant_id = '{hotel.tenant_id}' "
                     f"AND agent_id = '{AGENT}' AND tool_id = '{tool}' AND revoked_at IS NULL;")


@pytest.mark.parametrize("assignment", [
    "tenant_id = '{other}'", "tool_id = 'engineering.work_orders.close'", "tool_version = tool_version + 1",
    "agent_version = agent_version + 1", "agent_id = 'housekeeping.other_agent'", "id = gen_random_uuid()"])
def test_a_grant_cannot_be_retargeted(hotel, other, assignment):
    grant = _grant(hotel)
    out = _probe("SELECT 'journal0=' || count(*) FROM public.agent_control_center_events;\n"
                 + _three_ways(f"UPDATE public.agent_tool_grants SET {assignment.format(other=other.tenant_id)} "
                               f"WHERE id = '{grant}'") +
                 "SELECT 'journal1=' || count(*) FROM public.agent_control_center_events;\n")
    assert _refused(out, IMMUTABLE), (assignment, out)
    assert out["journal0"] == out["journal1"], (assignment, out)


def test_risk_ceiling_and_granting_user_changes_are_journaled(hotel):
    grant = _grant(hotel)
    out = _probe(f"""
      SELECT 'j0=' || count(*) FROM public.agent_control_center_events;
      {BLANKET_GRANT}
      SET LOCAL ROLE service_role;
      UPDATE public.agent_tool_grants SET max_risk = CASE max_risk WHEN 'high' THEN 'low' ELSE 'high' END WHERE id = '{grant}';
      UPDATE public.agent_tool_grants SET granted_by_user_id = '{hotel.chief}' WHERE id = '{grant}';
      UPDATE public.agent_tool_grants SET revoked_at = now(), revoked_by_user_id = '{hotel.gm}' WHERE id = '{grant}';
      UPDATE public.agent_tool_grants SET revoked_by_user_id = '{hotel.chief}' WHERE id = '{grant}';
      RESET ROLE;
      SELECT 'j1=' || count(*) FROM public.agent_control_center_events;
      SELECT 'keys=' || string_agg(DISTINCT k, ',' ORDER BY k) FROM public.agent_control_center_events e,
             jsonb_object_keys(e.detail) k
       WHERE e.tenant_id = '{hotel.tenant_id}' AND e.event_type = 'tool_grant_changed' AND k LIKE '%\\_before';
    """)
    assert int(out["j1"]) - int(out["j0"]) == 4, out
    assert out["keys"] == "granted_by_user_id_before,max_risk_before,revoked_by_user_id_before", out


# --- runtime controls: relabeling an operator pause is journaled ---------------------------------------------------

def test_relabeling_an_operator_pause_is_journaled_and_identity_cannot_change(hotel):
    out = _probe(f"""
      SELECT public.agent_runtime_control_set('hotel', '{hotel.tenant_id}', NULL, true, false, 'it-op', 'incident');
      SELECT 'locked=' || (public.agent_control_center_hotel_pause_set('{hotel.tenant_id}', '{hotel.gm}', false, 'resolved')->>'reason');
      SELECT 'j0=' || count(*) FROM public.agent_control_center_events;
      {BLANKET_GRANT}
      SET LOCAL ROLE service_role;
      UPDATE public.agent_runtime_controls SET updated_by = 'user:{hotel.gm}' WHERE scope = 'hotel' AND tenant_id = '{hotel.tenant_id}';
      RESET ROLE;
      SELECT 'j1=' || count(*) FROM public.agent_control_center_events;
      SELECT 'relabel=' || (detail->>'updated_by_before') || '|' || actor_kind || '|' || (detail->>'paused')
        FROM public.agent_control_center_events
       WHERE tenant_id = '{hotel.tenant_id}' AND event_type = 'runtime_control_changed' ORDER BY id DESC LIMIT 1;
    """)
    assert out["locked"] == "operator_pause_locked", out
    assert int(out["j1"]) - int(out["j0"]) == 1, out
    assert out["relabel"] == "it-op|human|true", out


def test_pause_and_unpause_journal_exactly_as_before(hotel):
    out = _probe(f"""
      SELECT 'j0=' || count(*) FROM public.agent_control_center_events;
      SET LOCAL ROLE service_role;
      SELECT public.agent_runtime_control_set('platform', NULL, NULL, true, false, 'it-op', 'incident');
      SELECT 'a=' || count(*) FROM public.agent_control_center_events;
      SELECT public.agent_runtime_control_set('platform', NULL, NULL, true, false, 'it-op', 'still_incident');
      SELECT 'b=' || count(*) FROM public.agent_control_center_events;
      SELECT public.agent_runtime_control_set('platform', NULL, NULL, false, false, 'it-op', 'resolved');
      SELECT 'c=' || count(*) FROM public.agent_control_center_events;
      SELECT public.agent_control_center_hotel_pause_set('{hotel.tenant_id}', '{hotel.gm}', true, 'incident');
      SELECT public.agent_control_center_hotel_pause_set('{hotel.tenant_id}', '{hotel.gm}', true, 'incident');
      SELECT 'd=' || count(*) FROM public.agent_control_center_events;
      SELECT public.agent_runtime_control_set('hotel', '{hotel.tenant_id}', NULL, true, false, 'it-op2', 'incident');
      SELECT 'e=' || count(*) FROM public.agent_control_center_events;
      SELECT 'locked=' || (public.agent_control_center_hotel_pause_set('{hotel.tenant_id}', '{hotel.gm}', false, 'resolved')->>'reason');
      SELECT public.agent_runtime_control_set('hotel', '{hotel.tenant_id}', NULL, false, false, 'it-op2', 'resolved');
      SELECT 'f=' || count(*) FROM public.agent_control_center_events;
      SELECT public.agent_tool_control_set('{TOOL}', true, 'it-op', 'incident');
      SELECT public.agent_tool_control_set('{TOOL}', false, 'it-op', 'resolved');
      SELECT 'g=' || count(*) FROM public.agent_control_center_events;
      RESET ROLE;
    """)
    n = {k: int(out[k]) for k in ("j0", "a", "b", "c", "d", "e", "f", "g")}
    assert n["a"] - n["j0"] == 1, out          # pause
    assert n["b"] == n["a"], out               # same state, same actor: nothing (unchanged from 256)
    assert n["c"] - n["b"] == 1, out           # unpause
    assert n["d"] - n["c"] == 1, out           # GM pause once; the repeated request is a no-op in the RPC
    assert n["e"] - n["d"] == 1, out           # 260: an operator re-asserting the GM's pause is recorded (lock moves)
    assert out["locked"] == "operator_pause_locked", out
    assert n["f"] - n["e"] == 1, out           # operator unpause
    assert n["g"] - n["f"] == 2, out           # tool pause + unpause


# --- approvals: a decision needs the decider's current authority -------------------------------------------------------

def test_an_approval_cannot_be_decided_without_current_authority(hotel, other):
    admitted = admit(hotel, ASSIGN, assign_args(hotel))
    assert drain_run(gateway_worker(), admitted.run_id) == ["awaiting_approval"]
    approval = approval_for(hotel, admitted.run_id)
    where = f"WHERE id = '{approval['id']}'"
    forged = [
        ("non-member", "state = 'approved', decided_by_user_id = gen_random_uuid(), decided_role = 'gm', decided_at = now()"),
        ("other hotel's gm", f"state = 'approved', decided_by_user_id = '{other.gm}', decided_role = 'gm', decided_at = now()"),
        ("role without authority", f"state = 'approved', decided_by_user_id = '{hotel.engineer_b}', decided_role = 'gm', "
                                   f"decided_at = now()"),
        ("mislabeled role", f"state = 'approved', decided_by_user_id = '{hotel.gm}', decided_role = 'chief_engineer', "
                            f"decided_at = now()"),
        ("rejection by a non-member", "state = 'rejected', decided_by_user_id = gen_random_uuid(), decided_role = 'gm', "
                                      "decided_at = now()"),
    ]
    for label, assignment in forged:
        out = _probe(_three_ways(f"UPDATE public.agent_tool_approvals SET {assignment} {where}"))
        assert _refused(out, NO_AUTHORITY), (label, out)
    # a deactivated approver loses authority too
    out = _probe(f"UPDATE public.user_roles SET is_active = false WHERE user_id = '{hotel.gm}';\n"
                 + _three_ways(f"UPDATE public.agent_tool_approvals SET state = 'approved', decided_by_user_id = '{hotel.gm}', "
                               f"decided_role = 'gm', decided_at = now() {where}"))
    assert _refused(out, NO_AUTHORITY), out
    assert approval_for(hotel, admitted.run_id)["state"] == "requested"
    # the reviewed RPC path is unaffected: the current GM approves and the write executes exactly once
    approvals.approve(gstore(), hotel.user(hotel.gm, "gm"), approval["id"])
    assert approval_for(hotel, admitted.run_id)["state"] == "approved"
    assert drain_run(gateway_worker(), admitted.run_id)[0] == "run_succeeded"
    run_sql(f"SELECT pgmq.purge_queue('{QUEUE}');")


def test_a_rejection_through_the_rpc_still_works(hotel):
    admitted = admit(hotel, ASSIGN, assign_args(hotel))
    assert drain_run(gateway_worker(), admitted.run_id) == ["awaiting_approval"]
    approval = approval_for(hotel, admitted.run_id)
    approvals.reject(gstore(), hotel.user(hotel.gm, "gm"), approval["id"], reason_code="unsafe_action")
    assert approval_for(hotel, admitted.run_id)["state"] == "rejected"
    run_sql(f"SELECT pgmq.purge_queue('{QUEUE}');")


# --- the guard cannot be switched off by the service role ---------------------------------------------------------

def test_service_role_cannot_switch_the_guard_or_the_journal_off():
    for statement, message in (
        ("ALTER TABLE public.agent_tool_grants DISABLE TRIGGER agent_control_update_guard;", "must be owner"),
        ("DROP TRIGGER agent_control_update_guard ON public.agent_runtime_controls;", "must be owner"),
        ("CREATE OR REPLACE FUNCTION public.agent__guard_control_update() RETURNS trigger LANGUAGE plpgsql "
         "AS 'BEGIN RETURN NEW; END';", "permission denied"),
        ("CREATE OR REPLACE FUNCTION public.agent__journal_control_change() RETURNS trigger LANGUAGE plpgsql "
         "AS 'BEGIN RETURN NULL; END';", "permission denied"),
        ("ALTER TABLE public.agent_runtime_controls DISABLE TRIGGER agent_control_center_journal;", "must be owner"),
        ("SET LOCAL session_replication_role = replica;", "permission denied"),
    ):
        with pytest.raises(AssertionError) as err:
            run_sql(f"BEGIN;\n{BLANKET_GRANT}\nSET LOCAL ROLE service_role;\n{statement}\nROLLBACK;")
        assert message in str(err.value), (statement, err.value)


# --- tenant offboarding still removes every hotel-scoped control row -----------------------------------------------

def test_tenant_offboarding_still_works():
    doomed = make_gateway_hotel()
    admitted = admit(doomed, ASSIGN, assign_args(doomed))
    assert drain_run(gateway_worker(), admitted.run_id) == ["awaiting_approval"]
    run_sql(f"SELECT public.agent_runtime_control_set('hotel', '{doomed.tenant_id}', NULL, true, false, 'it-op', 'incident');")
    out = _probe(f"""
      DELETE FROM public.tenants WHERE id = '{doomed.tenant_id}';
      SELECT 'left=' || (SELECT count(*) FROM public.agent_runtime_controls WHERE tenant_id = '{doomed.tenant_id}')
          + (SELECT count(*) FROM public.agent_tool_grants WHERE tenant_id = '{doomed.tenant_id}')
          + (SELECT count(*) FROM public.agent_tool_approvals WHERE tenant_id = '{doomed.tenant_id}');
    """)
    assert out["left"] == "0", out
