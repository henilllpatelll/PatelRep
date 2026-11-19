"""Migration 259: no DELETE of agent safety controls, grants or approvals, on a REAL migrated database.

Before 259 the service role (holding DELETE under the CI / Staging Candidate fixture GRANT ALL) could DELETE the row whose
ABSENCE the gates read as "no restriction" -- a platform / hotel / agent pause, the cost emergency stop, a tool pause, or
customer billing enforcement -- and the Control Center journal (INSERT/UPDATE triggers only) recorded nothing.

259 adds a BEFORE DELETE row guard on exactly seven tables that refuses every role, the owner included, except a
hotel-scoped row whose tenant row is already gone (the tenant offboarding cascade), and removes DELETE from every
application role on the 33 protected tables. Every probe runs in a transaction that is rolled back.
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

GUARDED = ("agent_customer_billing_controls", "agent_execution_enablement", "agent_model_enablement",
           "agent_runtime_controls", "agent_tool_approvals", "agent_tool_controls", "agent_tool_grants")
TOOL = ASSIGN[0]
BLANKET_GRANT = "GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;"
NEVER_DELETED = "rows are never deleted"

# pg_temp helpers created inside each rolled-back probe: attempt() runs one DELETE as a role and reports the outcome
# without aborting the transaction; gate() reads exactly what the execution / dispatch gates read.
HELPERS = """
CREATE FUNCTION pg_temp.attempt(p_role text, p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE n bigint;
BEGIN
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    EXECUTE 'WITH d AS (' || p_sql || ' RETURNING 1) SELECT count(*) FROM d' INTO n;
    RESET ROLE;
    RETURN 'deleted:' || n;
  EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ':' || SQLERRM;
  END;
END $f$;
CREATE FUNCTION pg_temp.gate(p_tenant uuid) RETURNS text LANGUAGE sql AS $f$
  SELECT 'block=' || coalesce(public.agent__control_block_reason(p_tenant, 'engineering.dispatch_assistant'), 'none')
      || ';tool_paused=' || EXISTS (SELECT 1 FROM public.agent_tool_controls WHERE tool_id = '""" + TOOL + """' AND paused)
      || ';exec=' || coalesce((SELECT enabled FROM public.agent_execution_enablement WHERE id = 1), false)
      || ';paid=' || coalesce((SELECT enabled FROM public.agent_model_enablement WHERE id = 1), false)
      || ';billing=' || public.agent__billing_mode();
$f$;
"""

# (label, legitimate journaled setup, DELETE that would lift / erase it, gate fragment that must survive)
SCENARIOS = [
    ("platform pause", "SELECT public.agent_runtime_control_set('platform', NULL, NULL, true, false, 'it-op', 'incident');",
     "DELETE FROM public.agent_runtime_controls WHERE scope = 'platform'", "block=platform_paused"),
    ("hotel pause", "SELECT public.agent_runtime_control_set('hotel', '{tenant}', NULL, true, false, 'it-op', 'incident');",
     "DELETE FROM public.agent_runtime_controls WHERE scope = 'hotel' AND tenant_id = '{tenant}'", "block=hotel_paused"),
    ("agent pause",
     "SELECT public.agent_runtime_control_set('agent', NULL, 'engineering.dispatch_assistant', true, false, 'it-op', 'incident');",
     "DELETE FROM public.agent_runtime_controls WHERE scope = 'agent'", "block=agent_paused"),
    ("cost emergency stop",
     "SELECT public.agent_runtime_control_set('platform', NULL, NULL, false, true, 'it-op', 'cost_incident');",
     "DELETE FROM public.agent_runtime_controls WHERE scope = 'platform'", "block=cost_emergency_stop"),
    ("tool pause", f"SELECT public.agent_tool_control_set('{TOOL}', true, 'it-op', 'incident');",
     f"DELETE FROM public.agent_tool_controls WHERE tool_id = '{TOOL}'", "tool_paused=true"),
    ("execution switch", "SELECT public.agent_execution_enablement_set(true, 'it-op', 'it');",
     "DELETE FROM public.agent_execution_enablement", "exec=true"),
    ("paid model switch", "SELECT public.agent_model_enablement_set(true, 'it-op', 'it');",
     "DELETE FROM public.agent_model_enablement", "paid=true"),
    ("billing enforcement", "SELECT public.agent_customer_billing_controls_set('enforced', false, 'it-op', 'it');",
     "DELETE FROM public.agent_customer_billing_controls", "billing=enforced"),
]


@pytest.fixture(autouse=True)
def _clean():
    reset_gateway_state()
    yield
    reset_gateway_state()


@pytest.fixture(scope="module")
def hotel():
    return make_gateway_hotel()


def _probe(body: str) -> str:
    return run_sql("\\pset tuples_only on\n\\pset format unaligned\nBEGIN;\n" + HELPERS + body + "\nROLLBACK;", timeout=120)


# --- catalog ---------------------------------------------------------------------------------------------------------

def test_the_guard_is_exactly_seven_plain_before_delete_row_triggers_on_the_reviewed_tables():
    found = sql_value("""
      SELECT string_agg(c.relname, ',' ORDER BY c.relname) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE t.tgname = 'agent_control_delete_guard' AND t.tgenabled = 'O' AND t.tgtype = 11 AND NOT t.tgisinternal
         AND t.tgconstraint = 0 AND t.tgqual IS NULL AND t.tgnargs = 0
         AND t.tgfoid = 'public.agent__guard_control_delete()'::regprocedure
         AND c.relnamespace = 'public'::regnamespace;""")
    assert tuple(found.split(",")) == GUARDED
    assert sql_value("SELECT count(*) FROM pg_trigger WHERE tgfoid = 'public.agent__guard_control_delete()'::regprocedure;") == "7"
    assert sql_value("SELECT prosecdef::text || ',' || array_to_string(proconfig, ';') || ',' || pg_get_userbyid(proowner) "
                     "FROM pg_proc WHERE oid = 'public.agent__guard_control_delete()'::regprocedure;") == \
        'false,search_path="",postgres'
    for role in ("anon", "authenticated", "agent_worker"):
        assert sql_value(f"SELECT has_function_privilege('{role}', 'public.agent__guard_control_delete()', 'EXECUTE');") == "f"
    with pytest.raises(AssertionError) as err:
        run_sql("SELECT public.agent__guard_control_delete();")
    assert "trigger functions can only be called as triggers" in str(err.value)


def test_no_application_role_holds_delete_on_a_protected_table():
    assert sql_value("""
      SELECT count(*) FROM public.agent__audit_protected_tables() t
       CROSS JOIN unnest(ARRAY['public', 'anon', 'authenticated', 'service_role', 'agent_worker']) g
       WHERE has_table_privilege(g, format('public.%I', t.table_name), 'DELETE');""") == "0"
    assert sql_value("SELECT count(*) FROM public.agent_audit_privilege_violations();") == "0"


# --- direct SQL DELETE: service role (least privilege and under a blanket grant) and the owner ----------------------

@pytest.mark.parametrize("label,setup,delete,survives", SCENARIOS, ids=[s[0] for s in SCENARIOS])
def test_a_delete_cannot_lift_a_restriction(hotel, label, setup, delete, survives):
    setup, delete = setup.format(tenant=hotel.tenant_id), delete.format(tenant=hotel.tenant_id)
    body = (f"{setup}\n"
            f"SELECT 'journal0=' || count(*) FROM public.agent_control_center_events;\n"
            f"SELECT 'svc=' || pg_temp.attempt('service_role', $q${delete}$q$);\n"
            f"SELECT 'gate1=' || pg_temp.gate('{hotel.tenant_id}');\n"
            f"{BLANKET_GRANT}\n"
            f"SELECT 'svc_granted=' || pg_temp.attempt('service_role', $q${delete}$q$);\n"
            f"SELECT 'owner=' || pg_temp.attempt('postgres', $q${delete}$q$);\n"
            f"SELECT 'gate2=' || pg_temp.gate('{hotel.tenant_id}');\n"
            f"SELECT 'journal1=' || count(*) FROM public.agent_control_center_events;\n")
    out = {k: v for k, v in (line.strip().split("=", 1) for line in _probe(body).splitlines() if "=" in line)}
    assert out["svc"].startswith("42501:") and "permission denied" in out["svc"], (label, out)
    assert out["svc_granted"].startswith("P0001:") and NEVER_DELETED in out["svc_granted"], (label, out)
    assert out["owner"].startswith("P0001:") and NEVER_DELETED in out["owner"], (label, out)
    assert survives in out["gate1"] and survives in out["gate2"], (label, out)
    assert out["journal0"] == out["journal1"], (label, out)  # nothing was removed, so nothing to journal


def test_grants_and_decided_approvals_cannot_be_deleted(hotel):
    admitted = admit(hotel, ASSIGN, assign_args(hotel))
    assert drain_run(gateway_worker(), admitted.run_id) == ["awaiting_approval"]
    approval = approval_for(hotel, admitted.run_id)
    approvals.reject(gstore(), hotel.user(hotel.gm, "gm"), approval["id"], reason_code="unsafe_action")
    run_sql(f"SELECT pgmq.purge_queue('{QUEUE}');")
    for delete in (f"DELETE FROM public.agent_tool_approvals WHERE id = '{approval['id']}'",
                   f"DELETE FROM public.agent_tool_grants WHERE tenant_id = '{hotel.tenant_id}'"):
        out = _probe(f"SELECT 'svc=' || pg_temp.attempt('service_role', $q${delete}$q$);\n{BLANKET_GRANT}\n"
                     f"SELECT 'svc_granted=' || pg_temp.attempt('service_role', $q${delete}$q$);\n"
                     f"SELECT 'owner=' || pg_temp.attempt('postgres', $q${delete}$q$);")
        assert "svc=42501:" in out and out.count(NEVER_DELETED) == 2, (delete, out)
    # the rejection stands: the one-per-invocation slot was not freed for a fresh request
    assert sql_value(f"SELECT state FROM public.agent_tool_approvals WHERE id = '{approval['id']}';") == "rejected"
    assert int(sql_value(f"SELECT count(*) FROM public.agent_tool_grants WHERE tenant_id = '{hotel.tenant_id}';")) >= 1


def test_the_service_role_api_cannot_delete_a_control_row():
    run_sql("SELECT public.agent_runtime_control_set('platform', NULL, NULL, true, true, 'it-op', 'incident');")
    db = new_client()
    for table, column, value in (("agent_runtime_controls", "scope", "platform"), ("agent_execution_enablement", "id", 1),
                                 ("agent_model_enablement", "id", 1), ("agent_customer_billing_controls", "id", 1)):
        with pytest.raises(Exception) as err:
            db.table(table).delete().eq(column, value).execute()
        assert "42501" in str(err.value) or "permission denied" in str(err.value), (table, err.value)
    assert sql_value("SELECT public.agent__control_block_reason(NULL, 'x.y');") == "cost_emergency_stop"


# --- the offboarding exception cannot be reached without deleting the hotel -----------------------------------------

def test_the_offboarding_exception_is_not_reachable_through_orphans_or_deferred_constraints(hotel):
    run_sql(f"SELECT public.agent_runtime_control_set('hotel', '{hotel.tenant_id}', NULL, true, false, 'it-op', 'incident');")
    assert sql_value("""
      SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND condeferrable
         AND conrelid IN ('public.agent_runtime_controls'::regclass, 'public.agent_tool_grants'::regclass,
                          'public.agent_tool_approvals'::regclass, 'public.agent_runs'::regclass);""") == "0"
    # pointing the row at a tenant that does not exist (to make "tenant gone" true) is refused immediately, even with
    # every constraint deferred, by the owner and by the service role under a blanket grant
    orphan = (f"UPDATE public.agent_runtime_controls SET tenant_id = gen_random_uuid() "
              f"WHERE scope = 'hotel' AND tenant_id = '{hotel.tenant_id}'")
    for prefix in ("SET CONSTRAINTS ALL DEFERRED;", f"{BLANKET_GRANT}\nSET CONSTRAINTS ALL DEFERRED;\nSET LOCAL ROLE service_role;"):
        with pytest.raises(AssertionError) as err:
            run_sql(f"BEGIN;\n{prefix}\n{orphan};\nROLLBACK;")
        assert "violates foreign key constraint" in str(err.value), (prefix, err.value)
    assert sql_value("SELECT count(*) FROM public.agent_tool_approvals a "
                     "WHERE NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = a.tenant_id);") == "0"
    assert sql_value(f"SELECT public.agent__control_block_reason('{hotel.tenant_id}', 'x.y');") == "hotel_paused"


def test_service_role_cannot_switch_the_guard_off():
    for statement, message in (
        ("ALTER TABLE public.agent_runtime_controls DISABLE TRIGGER agent_control_delete_guard;", "must be owner"),
        ("DROP TRIGGER agent_control_delete_guard ON public.agent_tool_controls;", "must be owner"),
        ("CREATE OR REPLACE FUNCTION public.agent__guard_control_delete() RETURNS trigger LANGUAGE plpgsql "
         "AS 'BEGIN RETURN OLD; END';", "permission denied"),
        ("SET LOCAL session_replication_role = replica;", "permission denied"),
    ):
        with pytest.raises(AssertionError) as err:
            run_sql(f"BEGIN;\n{BLANKET_GRANT}\nSET LOCAL ROLE service_role;\n{statement}\nROLLBACK;")
        assert message in str(err.value), (statement, err.value)


# --- legitimate control changes are unchanged and journaled ---------------------------------------------------------

def test_legitimate_control_changes_still_work_and_are_journaled(hotel):
    out = run_sql("\\pset tuples_only on\n\\pset format unaligned\nBEGIN;\n"
                  "SELECT 'j0=' || count(*) FROM public.agent_control_center_events;\n"
                  "SET LOCAL ROLE service_role;\n"
                  "SELECT public.agent_runtime_control_set('platform', NULL, NULL, true, false, 'it-op', 'incident');\n"
                  "SELECT public.agent_runtime_control_set('platform', NULL, NULL, false, false, 'it-op', 'resolved');\n"
                  f"SELECT public.agent_control_center_hotel_pause_set('{hotel.tenant_id}', '{hotel.gm}', true, 'incident');\n"
                  f"SELECT public.agent_control_center_hotel_pause_set('{hotel.tenant_id}', '{hotel.gm}', false, 'resolved');\n"
                  f"SELECT public.agent_tool_control_set('{TOOL}', true, 'it-op', 'incident');\n"
                  f"SELECT public.agent_tool_control_set('{TOOL}', false, 'it-op', 'resolved');\n"
                  "SELECT public.agent_model_enablement_set(true, 'it-op', 'it');\n"
                  "SELECT public.agent_model_enablement_set(false, 'it-op', 'it');\n"
                  "SELECT public.agent_customer_billing_controls_set('enforced', false, 'it-op', 'it');\n"
                  "SELECT public.agent_customer_billing_controls_set('disabled', false, 'it-op', 'it');\n"
                  f"SELECT 'grant=' || public.agent_tool_grant_set('{hotel.tenant_id}', '{hotel.gm}', 'engineering.dispatch_assistant',"
                  f" 2, '{TOOL}', 2, 2, NULL, true)::text;\n"
                  "RESET ROLE;\n"
                  "SELECT 'j1=' || count(*) FROM public.agent_control_center_events;\n"
                  "SELECT 'types=' || string_agg(DISTINCT event_type, ',' ORDER BY event_type) FROM public.agent_control_center_events;\n"
                  "ROLLBACK;")
    lines = dict(line.strip().split("=", 1) for line in out.splitlines() if line.strip().startswith(("j0=", "j1=", "types=", "grant=")))
    assert '"ok": true' in lines["grant"], out
    assert int(lines["j1"]) - int(lines["j0"]) >= 10, out
    assert {"runtime_control_changed", "tool_control_changed", "model_enablement_changed",
            "customer_billing_controls_changed", "tool_grant_changed"} <= set(lines["types"].split(",")), out
