"""Static contracts for the pre-H6 hardening migration 254 (#230 append-only audit integrity, #231 independent approval).

The real-database behaviour is proven in tests/integration/test_agent_audit_integrity.py and
test_agent_approval_independence.py; these checks pin the reviewed SHAPE of the migration so a later edit cannot
silently widen it."""
from __future__ import annotations

import re
from pathlib import Path

from services.agent_gateway.catalog import GATEWAY_AGENTS
from services.agent_harness.autonomy import APPROVAL_POLICIES

API_ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = API_ROOT.parents[1] / "supabase" / "migrations"
NAME = "254_agent_audit_integrity_and_independent_approval.sql"
DESTRUCTIVE = re.compile(r"\b(?:DROP\s+(?:TABLE|COLUMN|TYPE|SCHEMA|FUNCTION|POLICY|INDEX)|TRUNCATE\b|DELETE\s+FROM\b|"
                         r"ALTER\s+(?:TABLE|TYPE)\b[^;]*\b(?:DROP|RENAME|TYPE)\b)", re.I)
NEW_FUNCTIONS = {"public.agent__audit_protected_tables", "public.agent__refuse_truncate",
                 "public.agent_audit_privilege_violations", "public.agent_audit_privileges_enforce",
                 "public.agent__guard_approval_independence", "public.agent__guard_execution_approval"}


def _sql() -> str:
    return (MIGRATIONS / NAME).read_text(encoding="utf-8")


def _code(sql: str) -> str:
    return "\n".join(line for line in sql.splitlines() if not line.lstrip().startswith("--"))


def test_254_is_the_next_forward_migration_and_nothing_after_253_is_rewritten():
    versions = sorted(int(p.name.split("_", 1)[0]) for p in MIGRATIONS.glob("*.sql"))
    assert versions[-1] == 254 and versions.count(254) == 1


def test_the_only_destructive_token_is_truncate_and_the_migration_is_reviewed():
    sql = _sql()
    assert "-- migration-safety: destructive-reviewed" in sql and "-- rollback-plan:" in sql
    hits = {m.group(0).upper().split()[0] for m in DESTRUCTIVE.finditer(_code(sql))}
    assert hits == {"TRUNCATE"}, hits
    code = _code(sql)
    # TRUNCATE appears only as the refusal trigger event, its message, the revocation and the registry comment
    for line in (ln for ln in code.splitlines() if re.search(r"\bTRUNCATE\b", ln)):
        assert re.search(r"BEFORE TRUNCATE ON public\.|TRUNCATE is refused|REVOKE TRUNCATE ON TABLE|'TRUNCATE'|"
                         r"harness tables protected from TRUNCATE;", line), line
    assert not re.search(r"\b(DROP\s+(TABLE|COLUMN|FUNCTION|POLICY|INDEX|CONSTRAINT)|DELETE\s+FROM|ALTER\s+TABLE)\b",
                         code, re.I)
    assert "UPDATE public." not in code and "INSERT INTO public." not in code  # no data is rewritten


def test_every_function_is_new_invoker_pinned_and_revoked():
    sql = _sql()
    defined = set(re.findall(r"CREATE OR REPLACE FUNCTION (public\.[a-z_]+)\(", sql))
    assert defined == NEW_FUNCTIONS
    assert "SECURITY DEFINER" not in _code(sql)
    for fn in defined:
        body = sql[sql.index(f"CREATE OR REPLACE FUNCTION {fn}("):]
        body = body[:body.index("$function$;")]
        assert "SET search_path = ''" in body, fn
        assert re.search(rf"REVOKE ALL ON FUNCTION {re.escape(fn)}\(\) FROM PUBLIC, anon, authenticated, service_role;",
                         sql), fn
    # none of them existed before 254, so no reviewed H1-H5 body is replaced
    earlier = "\n".join(p.read_text(encoding="utf-8") for p in MIGRATIONS.glob("*.sql") if p.name != NAME)
    for fn in defined:
        assert f"FUNCTION {fn}(" not in earlier, fn


def test_every_registered_table_gets_exactly_one_truncate_refusal():
    sql = _sql()
    registry = re.findall(r"\('([a-z_]+)', (true|false)\)", sql.split("AS v(table_name, append_only)")[0])
    tables = [t for t, _ in registry]
    assert len(tables) == len(set(tables)) == 31 and sum(flag == "true" for _, flag in registry) == 11
    triggered = re.findall(r"CREATE TRIGGER agent_refuse_truncate BEFORE TRUNCATE ON public\.([a-z_]+)\s+"
                           r"FOR EACH STATEMENT EXECUTE FUNCTION public\.agent__refuse_truncate\(\);", sql)
    assert sorted(triggered) == sorted(tables)
    append_only = {t for t, flag in registry if flag == "true"}
    assert append_only == {
        "agent_run_events", "agent_tool_invocations", "agent_tool_executions", "agent_tool_events",
        "agent_model_spend_events", "agent_customer_overage_authorizations", "agent_customer_billing_events",
        "agent_billing_operation_events", "billing_trueup_operation_events", "agent_planning_events",
        "agent_proposal_handoffs"}
    # mutable approval / state / control tables are NOT made append-only
    for mutable in ("agent_tool_approvals", "agent_runs", "agent_run_steps", "agent_tool_grants",
                    "agent_model_budget_counters", "agent_planning_runs", "billing_trueup_operations"):
        assert mutable in tables and mutable not in append_only


def test_independence_is_derived_from_the_reviewed_spec_not_the_caller_flag():
    sql = _sql()
    guard = sql.split("FUNCTION public.agent__guard_approval_independence()", 1)[1].split("$function$;", 1)[0]
    assert "public.agent__gateway_tool_spec(NEW.agent_id, NEW.agent_version, NEW.tool_id, NEW.tool_version)" in guard
    assert "COALESCE(v_spec->>'risk', 'unknown') <> 'low'" in guard  # unknown risk fails closed
    assert "v_independent AND NEW.approver_may_be_initiator" in guard
    assert "BEFORE INSERT OR UPDATE ON public.agent_tool_approvals" in sql
    assert "BEFORE INSERT ON public.agent_tool_executions" in sql


def test_every_executable_agent_uses_only_independent_approval_policies():
    # Python alignment with the database rule: no gateway agent may name a self-approvable policy.
    agents = list(GATEWAY_AGENTS.all().values())
    assert {a.agent_id for a in agents} >= {"engineering.dispatch_assistant", "housekeeping.room_readiness_assistant"}
    for agent in agents:
        for policy_id in agent.approval_policies:
            assert APPROVAL_POLICIES[policy_id].approver_may_be_initiator is False, (agent.agent_id, policy_id)
