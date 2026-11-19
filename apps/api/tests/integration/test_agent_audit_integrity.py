"""#230 append-only audit integrity on a REAL migrated database (migration 254).

TRUNCATE bypasses row triggers, and CI/Staging Candidate re-run ``GRANT ALL ON ALL TABLES ... TO service_role`` after
every migration. These tests prove the protection holds in BOTH states: least privilege (after
``agent_audit_privileges_enforce``) and a blanket re-grant (the privilege-independent BEFORE TRUNCATE trigger).
Every destructive probe runs inside a transaction that is rolled back, so the shared test database is never emptied.
"""
from __future__ import annotations

import pytest

from agent_execution_support import QUEUE, make_hotel, requires_db
from agent_execution_support import admit as h1_admit
from agent_execution_support import store as h1_store
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

BLANKET_GRANT = "GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;"


def _registry() -> list[tuple[str, bool]]:
    out = run_sql("\\pset tuples_only on\n\\pset format unaligned\n"
                  "SELECT table_name || '|' || append_only FROM public.agent__audit_protected_tables() ORDER BY 1;")
    rows = [line.strip().split("|") for line in out.splitlines() if "|" in line]
    return [(name, flag in ("t", "true")) for name, flag in rows]


REGISTRY_CACHE: list[tuple[str, bool]] = []


def registry() -> list[tuple[str, bool]]:
    if not REGISTRY_CACHE:
        REGISTRY_CACHE.extend(_registry())
    return REGISTRY_CACHE


def refused(sql: str) -> str:
    """Run ``sql`` in a transaction that always rolls back; return the error text (fails if the SQL succeeded)."""
    with pytest.raises(AssertionError) as err:
        run_sql(f"BEGIN;\n{sql}\nROLLBACK;")
    return str(err.value)


def as_service_role(statement: str, *, blanket_grant: bool = False) -> str:
    grant = BLANKET_GRANT if blanket_grant else ""
    return refused(f"{grant}\nSET LOCAL ROLE service_role;\n{statement}")


@pytest.fixture(autouse=True)
def _clean():
    reset_gateway_state()
    yield
    reset_gateway_state()


# --- inventory ------------------------------------------------------------------------------------------------------

def test_registry_is_exactly_every_harness_table_and_each_is_trigger_protected():
    tables = {name for name, _ in registry()}
    # 254 registered 31 (11 append-only); H6 (256) adds agent_worker_credentials and the append-only journal.
    assert len(tables) == 33 and sum(flag for _, flag in registry()) == 12
    live = sql_value("SELECT string_agg(relname, ',' ORDER BY relname) FROM pg_class WHERE relkind IN ('r', 'p') "
                     "AND relnamespace = 'public'::regnamespace AND relname ~ '^(agent_|billing_trueup_)';")
    assert set(live.split(",")) == tables, "a harness table is missing from (or unknown to) the reviewed registry"
    # one enabled statement-level BEFORE TRUNCATE refusal per table: tgtype = BEFORE (2) + TRUNCATE (32), no ROW bit
    assert sql_value("""
      SELECT count(*) FROM public.agent__audit_protected_tables() t
        JOIN pg_trigger g ON g.tgrelid = format('public.%I', t.table_name)::regclass
       WHERE g.tgname = 'agent_refuse_truncate' AND g.tgenabled = 'O' AND g.tgtype = 34
         AND g.tgfoid = 'public.agent__refuse_truncate()'::regprocedure;""") == "33"
    # every append-only table keeps an enabled BEFORE UPDATE OR DELETE row guard
    assert sql_value("""
      SELECT count(DISTINCT t.table_name) FROM public.agent__audit_protected_tables() t
        JOIN pg_trigger g ON g.tgrelid = format('public.%I', t.table_name)::regclass
       WHERE t.append_only AND g.tgenabled = 'O' AND (g.tgtype & 27) = 27 AND NOT g.tgisinternal;""") == "12"


def test_least_privilege_is_in_force_and_end_users_hold_nothing():
    assert sql_value("SELECT count(*) FROM public.agent_audit_privilege_violations();") == "0"
    for name, append_only in registry():
        for role in ("anon", "authenticated"):
            assert sql_value(f"SELECT has_table_privilege('{role}', 'public.{name}', "
                             f"'SELECT,INSERT,UPDATE,DELETE,TRUNCATE');") == "f", (name, role)
        # the backend keeps exactly what legitimate flows use; the H6 journal is written only by its reviewed
        # SECURITY DEFINER writer, so service_role may read it but never insert (stricter than the 254 tables)
        assert sql_value(f"SELECT has_table_privilege('service_role', 'public.{name}', 'SELECT');") == "t", name
        expected_insert = "f" if name == "agent_control_center_events" else "t"
        assert sql_value(f"SELECT has_table_privilege('service_role', 'public.{name}', 'INSERT');") == expected_insert, name
        if not append_only:
            assert sql_value(f"SELECT has_table_privilege('service_role', 'public.{name}', 'UPDATE');") == "t", name


# --- TRUNCATE ------------------------------------------------------------------------------------------------------

def test_service_role_cannot_truncate_any_protected_table_under_least_privilege():
    for name, _ in registry():
        assert "permission denied" in as_service_role(f"TRUNCATE public.{name} CASCADE;"), name


def test_truncate_is_refused_even_after_a_blanket_re_grant_and_through_cascade():
    for name, _ in registry():
        assert "TRUNCATE is refused" in as_service_role(f"TRUNCATE public.{name} CASCADE;", blanket_grant=True), name
    # the owner is refused too (only disabling the trigger, an owner/superuser power, could bypass it)
    assert "TRUNCATE is refused" in refused("TRUNCATE public.agent_tool_events;")
    # truncating a referenced parent reaches the append-only children through CASCADE, which fires their triggers
    assert "TRUNCATE is refused" in refused("TRUNCATE public.tenants CASCADE;")


# --- UPDATE / DELETE on append-only tables --------------------------------------------------------------------------

def _plain_column(table: str) -> str:
    return sql_value(f"SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' "
                     f"AND table_name = '{table}' AND is_identity = 'NO' AND is_generated = 'NEVER' "
                     f"ORDER BY ordinal_position LIMIT 1;")


def test_append_only_tables_refuse_service_role_mutation_with_and_without_grants():
    hotel = make_gateway_hotel()
    admitted = admit(hotel, ASSIGN, assign_args(hotel))
    assert drain_run(gateway_worker(), admitted.run_id) == ["awaiting_approval"]
    guarded = set()
    for name, append_only in registry():
        if not append_only:
            continue
        column = _plain_column(name)
        for mutation in (f"UPDATE public.{name} SET {column} = {column};", f"DELETE FROM public.{name};"):
            assert "permission denied" in as_service_role(mutation), (name, mutation)
            if sql_value(f"SELECT count(*) FROM public.{name};") != "0":  # row triggers fire only for existing rows
                err = as_service_role(mutation, blanket_grant=True)
                assert "append-only" in err or "immutable" in err, (name, mutation, err)
                guarded.add(name)
    # at least the tables this real flow wrote were proven guarded by their row triggers under a blanket grant
    assert {"agent_run_events", "agent_tool_invocations", "agent_tool_events"} <= guarded
    assert int(sql_value(f"SELECT count(*) FROM public.agent_tool_events WHERE run_id = '{admitted.run_id}';")) >= 2


def test_column_level_update_grants_are_detected_and_removed():
    # a column privilege is invisible to has_table_privilege but still permits UPDATE of that column
    out = run_sql("BEGIN;\n"
                  "GRANT UPDATE (reason_code) ON public.agent_tool_events TO service_role;\n"
                  "SELECT 'before=' || count(*) FROM public.agent_audit_privilege_violations();\n"
                  "SELECT public.agent_audit_privileges_enforce();\n"
                  "SELECT 'after=' || count(*) FROM public.agent_audit_privilege_violations();\n"
                  "ROLLBACK;")
    assert "before=1" in out and "after=0" in out


def test_enforcement_reverses_a_blanket_grant_in_the_same_transaction():
    out = run_sql("BEGIN;\n" + BLANKET_GRANT + "\n"
                  "SELECT 'granted=' || count(*) FROM public.agent_audit_privilege_violations();\n"
                  "SELECT 'enforced=' || public.agent_audit_privileges_enforce();\n"
                  "SELECT 'left=' || count(*) FROM public.agent_audit_privilege_violations();\n"
                  "ROLLBACK;")
    granted = int(out.split("granted=")[1].split()[0])
    relations = int(sql_value("SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace"
                              " AND relkind IN ('r', 'p', 'v', 'm', 'f');"))
    # TRUNCATE on 33 tables + UPDATE/DELETE on 12 append-only + INSERT on the H6 journal, and (migration 258) TRIGGER,
    # REFERENCES and MAINTAIN on every relation in public, the 33 included
    assert granted == 33 + 2 * 12 + 1 + 3 * relations and "enforced=33" in out and "left=0" in out


def test_enforcement_fails_closed_when_a_right_it_cannot_revoke_remains_inherited():
    # A right reaching service_role through role membership is not removed by revoking service_role's own grants;
    # the verification sees it (has_table_privilege follows membership) and the enforcement fails closed.
    err = refused("CREATE ROLE it_inherited_rights NOLOGIN;\n"
                  "GRANT TRUNCATE ON public.agent_tool_events TO it_inherited_rights;\n"
                  "GRANT it_inherited_rights TO service_role;\n"
                  "SELECT public.agent_audit_privileges_enforce();")
    assert "could not be enforced" in err and "agent_tool_events:service_role:TRUNCATE" in err


# --- the backend cannot switch the protection off -------------------------------------------------------------------

def test_service_role_cannot_disable_triggers_bypass_them_or_re_grant():
    assert "must be owner" in as_service_role(
        "ALTER TABLE public.agent_tool_events DISABLE TRIGGER agent_refuse_truncate;")
    assert "must be owner" in as_service_role("DROP TRIGGER agent_tool_events_immutable ON public.agent_tool_events;")
    assert "permission denied" in as_service_role("SET LOCAL session_replication_role = replica;")
    run_sql("BEGIN; SET LOCAL ROLE service_role; GRANT TRUNCATE ON public.agent_tool_events TO service_role; ROLLBACK;")
    assert sql_value("SELECT has_table_privilege('service_role', 'public.agent_tool_events', 'TRUNCATE');") == "f"
    assert sql_value("SELECT rolsuper OR pg_has_role('service_role', 'postgres', 'MEMBER') "
                     "FROM pg_roles WHERE rolname = 'service_role';") == "f"


OWNER_ONLY_FUNCTIONS = ("agent__audit_protected_tables", "agent__refuse_truncate", "agent_audit_privilege_violations",
                        "agent_audit_privileges_enforce", "agent__guard_approval_independence",
                        "agent__guard_execution_approval")


def test_owner_only_hardening_functions_are_not_executable_by_application_roles():
    # CI's blanket GRANT EXECUTE ON ALL FUNCTIONS re-revokes these in the same transaction, so this holds in CI exactly
    # as in staging and production (where no blanket function grant exists).
    for fn in OWNER_ONLY_FUNCTIONS:
        for role in ("anon", "authenticated", "service_role"):
            assert sql_value(f"SELECT has_function_privilege('{role}', 'public.{fn}()', 'EXECUTE');") == "f", (fn, role)
    for fn in ("agent__audit_protected_tables", "agent_audit_privilege_violations", "agent_audit_privileges_enforce"):
        assert "permission denied for function" in as_service_role(f"SELECT public.{fn}();"), fn
    # the real service-role API path (PostgREST RPC) is refused too
    with pytest.raises(Exception) as err:
        new_client().rpc("agent_audit_privilege_violations", {}).execute()
    assert "42501" in str(err.value) or "permission denied" in str(err.value)


# --- legitimate flows are unchanged ---------------------------------------------------------------------------------

def test_normal_writes_reads_and_tenant_deletion_cascade_still_work_under_least_privilege():
    hotel = make_gateway_hotel()
    admitted = admit(hotel, ASSIGN, assign_args(hotel))
    assert drain_run(gateway_worker(), admitted.run_id) == ["awaiting_approval"]
    approvals.approve(gstore(), hotel.user(hotel.gm, "gm"), approval_for(hotel, admitted.run_id)["id"])
    assert drain_run(gateway_worker(), admitted.run_id)[0] == "run_succeeded"
    events = [e["event_type"] for e in gstore().tool_events_page(tenant_id=hotel.tenant_id, run_id=admitted.run_id,
                                                                 limit=100)]
    assert {"invocation_admitted", "approval_requested", "approval_approved", "execution_succeeded"} <= set(events)
    assert sql_value("SELECT count(*) FROM public.agent_audit_privilege_violations();") == "0"


def test_hotel_offboarding_through_the_service_role_api_still_cascades_append_only_history():
    # PostgreSQL runs referential actions as the table owner, so revoking DELETE from service_role does not block the
    # cascade, and the row guards admit rows whose tenant is gone.
    db = new_client()
    tenant, _ = make_hotel(db)
    run_id = h1_admit(h1_store(), tenant)["run_id"]
    assert int(sql_value(f"SELECT count(*) FROM public.agent_run_events WHERE run_id = '{run_id}';")) >= 1
    run_sql(f"SELECT pgmq.purge_queue('{QUEUE}');")
    db.table("tenants").delete().eq("id", tenant).execute()  # the real service-role API path
    assert sql_value(f"SELECT count(*) FROM public.agent_run_events WHERE run_id = '{run_id}';") == "0"
    assert sql_value(f"SELECT count(*) FROM public.agent_runs WHERE id = '{run_id}';") == "0"
