"""Migration 258: exact backend privilege matrix on the protected harness tables, no structural rights anywhere in public.

Regression guard for the staging fixture privilege drift: Staging Candidate's "Grant staging fixture service access" and
CI's service-role grant run ``GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role``. Before 258 the enforcement
left REFERENCES, TRIGGER and MAINTAIN behind, so the reviewed Control Center journal postcondition (service_role:
SELECT only) was false on persistent staging, and the structural rights were broader than any application path needs.
DELETE on the mutable tables is the reviewed backend right and is tolerated here (not required, not removed).

Two matrices, kept apart on purpose:
  * MAXIMUM (``_allowed``): what a role may hold. Derived from the reviewed registry flag (the journal: SELECT; append-only:
    SELECT, INSERT; mutable-registered: SELECT, INSERT, UPDATE, DELETE). Anything beyond it is a violation.
  * MINIMUM (``MINIMUM``): what service_role must keep. Listed per table from the creating migrations' grants. It is NOT
    derived from the flag: agent_model_price_schedules is mutable-registered but 244 granted it SELECT, INSERT only, and the
    first 258 derived UPDATE from the flag, which failed every pristine replay (CI run 44465879069).

The grant statements are read from the real workflow files, so a workflow change that the database enforcement cannot
reverse fails here. Every probe runs in a transaction that is rolled back.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from agent_execution_support import requires_db
from agent_gateway_support import run_sql, sql_value

pytestmark = requires_db

REPO = Path(__file__).resolve().parents[4]
JOURNAL = "agent_control_center_events"
STRUCTURAL = ("TRIGGER", "REFERENCES", "MAINTAIN")


def _staging_fixture_grant() -> str:
    workflow = (REPO / ".github/workflows/staging-candidate.yml").read_text(encoding="utf-8")
    match = re.search(r'--command "(grant usage on schema public to service_role;[^"]*)"', workflow)
    assert match, "Staging Candidate fixture grant step not found"
    return match.group(1).replace("\\$", "$")


def _ci_service_role_grant() -> str:
    workflow = (REPO / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    match = re.search(r"<<'SQL'\n(.*?GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;.*?)\n\s*SQL\n", workflow, re.S)
    assert match, "CI service-role grant heredoc not found"
    return "\n".join(line.strip() for line in match.group(1).splitlines())


SIU = frozenset({"SELECT", "INSERT", "UPDATE"})
SI = frozenset({"SELECT", "INSERT"})
# Rights each protected table's creating migration granted to service_role (238, 241, 244, 247, 248, 250, 252, 255, 256).
MINIMUM: dict[str, frozenset[str]] = {
    "agent_runs": SIU, "agent_run_steps": SIU, "agent_run_events": SI, "agent_runtime_controls": SIU,
    "agent_worker_heartbeats": SIU,
    "agent_execution_enablement": SIU, "agent_tool_controls": SIU, "agent_tool_grants": SIU, "agent_tool_approvals": SIU,
    "agent_tool_invocations": SI, "agent_tool_executions": SI, "agent_tool_events": SI,
    "agent_model_enablement": SIU, "agent_model_budget_policies": SIU, "agent_model_budget_counters": SIU,
    "agent_model_attempts": SIU, "agent_model_price_schedules": SI, "agent_model_spend_events": SI,
    "agent_planning_runs": SIU,
    "agent_customer_billing_controls": SIU, "agent_customer_pricing_policies": SIU, "agent_customer_credit_holds": SIU,
    "agent_customer_credit_charges": SIU, "agent_billing_operations": SIU, "agent_customer_overage_authorizations": SI,
    "agent_customer_billing_events": SI, "agent_billing_operation_events": SI,
    "billing_trueup_operations": SIU, "billing_trueup_operation_events": SI,
    "agent_planning_events": SI, "agent_proposal_handoffs": SI,
    "agent_worker_credentials": SIU, JOURNAL: frozenset({"SELECT"}),
}
PRICE = "agent_model_price_schedules"


def _allowed(table: str, append_only: bool) -> set[str]:
    if table == JOURNAL:
        return {"SELECT"}
    if append_only:
        return {"SELECT", "INSERT"}
    return {"SELECT", "INSERT", "UPDATE", "DELETE"}  # DELETE: tolerated reviewed 254/H6 backend right


def _state_after(prefix_sql: str) -> dict[str, set[str]]:
    """service_role rights per registered table after ``prefix_sql`` (rolled back)."""
    out = run_sql("\\pset tuples_only on\n\\pset format unaligned\nBEGIN;\n" + prefix_sql + "\n"
                  "SELECT t.table_name || '|' || t.append_only || '|' || coalesce((SELECT string_agg(p, ',' ORDER BY p)"
                  "  FROM (SELECT DISTINCT a.privilege_type AS p FROM aclexplode(acldefault('r', 10::oid)) a) u"
                  "  WHERE has_table_privilege('service_role', format('public.%I', t.table_name), u.p)"
                  "     OR (u.p IN ('SELECT','INSERT','UPDATE','REFERENCES')"
                  "         AND has_any_column_privilege('service_role', format('public.%I', t.table_name), u.p))), '')"
                  " FROM public.agent__audit_protected_tables() t ORDER BY 1;\n"
                  "SELECT 'structural=' || count(*) FROM pg_class c"
                  " CROSS JOIN unnest(ARRAY['public','anon','authenticated','service_role','agent_worker']) g"
                  " CROSS JOIN (SELECT DISTINCT a.privilege_type AS p FROM aclexplode(acldefault('r', 10::oid)) a"
                  "             WHERE a.privilege_type IN ('TRIGGER','REFERENCES','MAINTAIN')) s"
                  " WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f')"
                  "   AND has_table_privilege(g, c.oid, s.p);\n"
                  "SELECT 'violations=' || count(*) FROM public.agent_audit_privilege_violations();\n"
                  "ROLLBACK;")
    rights: dict[str, set[str]] = {}
    extra: dict[str, set[str]] = {}
    for line in out.splitlines():
        line = line.strip()
        if line.startswith(("structural=", "violations=")):
            key, value = line.split("=")
            extra[key] = {value}
        elif line.count("|") == 2:
            name, flag, privs = line.split("|")
            rights[name] = {p for p in privs.split(",") if p}
            rights[name + "#append_only"] = {flag}
    rights.update({"#" + k: v for k, v in extra.items()})
    return rights


def _assert_exact(state: dict[str, set[str]]) -> None:
    tables = [k for k in state if not k.startswith("#") and "#" not in k]
    assert len(tables) == 33 and set(tables) == set(MINIMUM)
    for table in tables:
        append_only = state[table + "#append_only"] == {"t"} or state[table + "#append_only"] == {"true"}
        allowed = _allowed(table, append_only)
        assert MINIMUM[table] <= allowed, table  # the floor never exceeds the ceiling
        assert MINIMUM[table] <= state[table] <= allowed, (table, sorted(state[table]))
    assert state[JOURNAL] == {"SELECT"}
    assert state["#structural"] == {"0"}
    assert state["#violations"] == {"0"}


def test_matrix_is_exact_at_rest():
    _assert_exact(_state_after(""))


def test_staging_candidate_fixture_grant_leaves_exactly_the_reviewed_matrix():
    _assert_exact(_state_after(_staging_fixture_grant()))


def test_ci_service_role_grant_leaves_exactly_the_reviewed_matrix():
    _assert_exact(_state_after(_ci_service_role_grant()))


def test_a_blanket_grant_without_enforcement_is_fully_reported():
    out = run_sql("\\pset tuples_only on\n\\pset format unaligned\nBEGIN;\n"
                  "GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;\n"
                  "SELECT privilege || '=' || count(*) FROM public.agent_audit_privilege_violations()"
                  " WHERE role_name = 'service_role' GROUP BY privilege ORDER BY privilege;\n"
                  "SELECT 'journal=' || string_agg(privilege, ',' ORDER BY privilege) FROM public.agent_audit_privilege_violations()"
                  " WHERE table_name = 'agent_control_center_events';\nROLLBACK;")
    counts = dict(line.strip().split("=") for line in out.splitlines() if "=" in line and not line.startswith("journal"))
    journal = next(line.split("=")[1] for line in out.splitlines() if line.startswith("journal="))
    relations = int(sql_value("SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace"
                              " AND relkind IN ('r','p','v','m','f');"))
    assert set(journal.strip().split(",")) == {"DELETE", "INSERT", "MAINTAIN", "REFERENCES", "TRIGGER", "TRUNCATE",
                                               "UPDATE"}
    for privilege in STRUCTURAL:
        assert int(counts[privilege]) == relations, (privilege, counts)  # every relation in public, registry included
    assert int(counts["TRUNCATE"]) == 33
    assert int(counts["UPDATE"]) == 12 and int(counts["DELETE"]) == 12  # append-only tables + the journal


def test_each_structural_or_column_grant_is_reported_and_removed():
    for grant, expected in (
        (f"GRANT TRIGGER ON public.{JOURNAL} TO service_role", f"{JOURNAL}:service_role:TRIGGER"),
        ("GRANT REFERENCES (id) ON public.agent_runs TO service_role", "agent_runs:service_role:REFERENCES"),
        ("GRANT MAINTAIN ON public.agent_tool_events TO service_role", "agent_tool_events:service_role:MAINTAIN"),
        ("GRANT TRIGGER ON public.tenants TO service_role", "tenants:service_role:TRIGGER"),
        ("GRANT TRIGGER ON public.work_order_vendor_engagements TO authenticated",
         "work_order_vendor_engagements:authenticated:TRIGGER"),
        (f"GRANT INSERT ON public.{JOURNAL} TO service_role", f"{JOURNAL}:service_role:INSERT"),
    ):
        out = run_sql("\\pset tuples_only on\n\\pset format unaligned\nBEGIN;\n" + grant + ";\n"
                      "SELECT 'found=' || string_agg(table_name || ':' || role_name || ':' || privilege, ',')"
                      " FROM public.agent_audit_privilege_violations();\n"
                      "SELECT public.agent_audit_privileges_enforce();\n"
                      "SELECT 'left=' || count(*) FROM public.agent_audit_privilege_violations();\nROLLBACK;")
        assert f"found={expected}" in out and "left=0" in out, (grant, out)


def _refused(sql: str) -> str:
    """Run ``sql`` in a transaction that always rolls back; return the error text (fails if the SQL succeeded)."""
    with pytest.raises(AssertionError) as err:
        run_sql(f"BEGIN;\n{sql}\nROLLBACK;")
    return str(err.value)


def test_service_role_cannot_attach_triggers_or_take_maintenance_locks_even_after_a_fixture_grant():
    # service_role may not attach triggers or take maintenance locks, at rest or right after a fixture grant; covers the
    # journal and domain tables that SECURITY DEFINER code writes.
    for grant in ("", _staging_fixture_grant()):
        for table in (JOURNAL, "tenants", "work_order_vendor_engagements"):
            err = _refused(f"{grant}\nSET LOCAL ROLE service_role;\n"
                           "CREATE FUNCTION pg_temp.it_t() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NULL; END';\n"
                           f"CREATE TRIGGER it_t AFTER INSERT ON public.{table} FOR EACH ROW EXECUTE FUNCTION pg_temp.it_t();")
            assert "permission denied" in err, (bool(grant), table, err)
        err = _refused(f"{grant}\nSET LOCAL ROLE service_role;\nLOCK TABLE public.{JOURNAL} IN ACCESS EXCLUSIVE MODE;")
        assert "permission denied" in err, (bool(grant), err)


def test_enforcement_fails_closed_on_an_inherited_structural_right():
    # a right reaching service_role through membership cannot be revoked from service_role; the check sees it
    err = _refused("CREATE ROLE it_inherited_trigger NOLOGIN;\n"
                   "GRANT TRIGGER ON public.tenants TO it_inherited_trigger;\n"
                   "GRANT it_inherited_trigger TO service_role;\n"
                   "SELECT public.agent_audit_privileges_enforce();")
    assert "could not be enforced" in err and "tenants:service_role:TRIGGER" in err


def test_enforcement_fails_closed_on_a_grant_made_by_an_unexpected_grantor():
    # the owner's REVOKE does not remove a grant whose grantor is another role; the check still sees it
    err = _refused("CREATE ROLE it_grantor NOLOGIN;\n"
                   "GRANT TRIGGER ON public.tenants TO it_grantor WITH GRANT OPTION;\n"
                   # explicit role name: "GRANT ... TO current_user WITH SET ..." crashes the local Supabase image
                   "GRANT it_grantor TO postgres WITH SET TRUE, INHERIT FALSE;\n"
                   "SET LOCAL ROLE it_grantor;\n"
                   "GRANT TRIGGER ON public.tenants TO service_role;\n"
                   "RESET ROLE;\n"
                   "SELECT public.agent_audit_privileges_enforce();")
    assert "could not be enforced" in err and "tenants:service_role:TRIGGER" in err


def test_enforcement_is_repeatable():
    out = run_sql("\\pset tuples_only on\n\\pset format unaligned\nBEGIN;\n"
                  "SELECT 'first=' || public.agent_audit_privileges_enforce();\n"
                  "SELECT 'second=' || public.agent_audit_privileges_enforce();\n"
                  "SELECT 'left=' || count(*) FROM public.agent_audit_privilege_violations();\nROLLBACK;")
    assert "first=33" in out and "second=33" in out and "left=0" in out


def test_workflow_grants_and_cleanup_share_one_transaction():
    # No window: the blanket grant and the enforcement commit together or not at all.
    staging = (REPO / ".github/workflows/staging-candidate.yml").read_text(encoding="utf-8")
    step = re.search(r'psql --set ON_ERROR_STOP=1 "\$STAGING_SUPABASE_DB_URL" --command "(grant usage on schema public[^"]*)"',
                     staging)
    assert step, "one psql --command (one implicit transaction) must carry the fixture grant"
    body = step.group(1).lower()
    assert "begin" not in body.replace("do \\$\\$ begin", "").replace("do $$ begin", "") and "commit" not in body
    assert body.index("grant all privileges on all tables") < body.index("agent_audit_privileges_enforce()")
    ci = (REPO / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    assert re.search(r"psql --set ON_ERROR_STOP=1 --single-transaction \"postgresql://postgres:postgres@127\.0\.0\.1:54322/postgres\""
                     r" <<'SQL'\n\s*GRANT USAGE ON SCHEMA public TO service_role;\n\s*GRANT ALL ON ALL TABLES", ci)
    grant = _ci_service_role_grant()
    assert "COMMIT" not in grant.upper() and grant.index("GRANT ALL ON ALL TABLES") < grant.index("agent_audit_privileges_enforce()")


# ─── Minimum vs maximum, and the pristine-replay regression (CI run 44465879069) ─────────────────────────────────────

_MIGRATIONS = REPO / "supabase/migrations"
_GRANT = re.compile(r"\bGRANT\s+([A-Z, ]+?)\s+ON\s+(?:TABLE\s+)?((?:public\.\w+\s*,?\s*)+)\s+TO\s+([^;]+);", re.I)


def _released_service_role_grants() -> dict[str, set[str]]:
    """Table rights granted to service_role by released migrations 238-257, read from the files."""
    granted: dict[str, set[str]] = {}
    for path in sorted(_MIGRATIONS.glob("2[3-5][0-9]_*.sql")):
        if not 238 <= int(path.name[:3]) <= 257:
            continue
        text = re.sub(r"--[^\n]*", "", path.read_text(encoding="utf-8"))
        for rights, tables, grantees in _GRANT.findall(text):
            if "service_role" not in grantees:
                continue
            for table in re.findall(r"public\.(\w+)", tables):
                granted.setdefault(table, set()).update(r.strip().upper() for r in rights.split(","))
    return granted


def test_minimum_matrix_is_exactly_what_the_released_migrations_granted():
    granted = _released_service_role_grants()
    assert {t: frozenset(granted.get(t, set())) for t in MINIMUM} == MINIMUM
    assert granted[PRICE] == {"SELECT", "INSERT"}  # 244: price rows are immutable, no UPDATE was ever granted
    # no released migration grants DELETE (or anything structural) on a protected table: DELETE is fixture-only
    assert not any(rights - {"SELECT", "INSERT", "UPDATE"} for t, rights in granted.items() if t in MINIMUM)


def _contract() -> str:
    # run_sql pipes text in the platform encoding; the contract's only non-ASCII characters are in comments
    return (REPO / "scripts/schema-contracts.sql").read_text(encoding="utf-8").encode("ascii", "replace").decode("ascii")


def _post_block() -> str:
    text = (_MIGRATIONS / "258_agent_audit_exact_backend_privileges.sql").read_text(encoding="utf-8")
    start = text.index("DO $post$")
    return text[start:text.index("$post$;", start) + len("$post$;")]


def _pristine_release_grants() -> str:
    """Rewind service_role on the 33 tables to exactly what the released migrations granted (a clean replay's state)."""
    lines = [f"REVOKE ALL ON public.{t} FROM service_role;" for t in MINIMUM]
    lines += [f"GRANT {', '.join(sorted(r))} ON public.{t} TO service_role;" for t, r in MINIMUM.items()]
    return "\n".join(lines)


# the first 258's floor, derived from the registry flag (kept here only to prove the regression)
_FLAG_DERIVED_FLOOR = ("SELECT 'flagfloor=' || coalesce(string_agg(t.table_name || ':' || p.privilege, ','), '')"
                       " FROM public.agent__audit_protected_tables() t CROSS JOIN LATERAL unnest(CASE"
                       " WHEN t.table_name = 'agent_control_center_events' THEN ARRAY['SELECT']"
                       " WHEN t.append_only THEN ARRAY['SELECT','INSERT'] ELSE ARRAY['SELECT','INSERT','UPDATE'] END)"
                       " p(privilege)"
                       " WHERE NOT has_table_privilege('service_role', format('public.%I', t.table_name), p.privilege);")


def test_pristine_release_grants_pass_the_258_postcondition_and_the_contract():
    contract = _contract()
    out = run_sql("\\pset tuples_only on\n\\pset format unaligned\nBEGIN;\n" + _pristine_release_grants() + "\n"
                  + _FLAG_DERIVED_FLOOR + "\n"
                  "SELECT 'violations=' || count(*) FROM public.agent_audit_privilege_violations();\n"
                  + _post_block() + "\nSELECT 'post=ok';\n" + contract + "\nSELECT 'contract=ok';\nROLLBACK;", timeout=180)
    # exactly the clean-replay failure of the first 258: the flag-derived floor wanted UPDATE on price schedules
    assert f"flagfloor={PRICE}:UPDATE" in out, out
    assert "violations=0" in out and "post=ok" in out and "contract=ok" in out, out


def test_losing_a_released_right_still_fails_closed_in_the_postcondition_and_the_contract():
    contract = _contract()
    for table, privilege in ((PRICE, "INSERT"), ("agent_runs", "UPDATE"), (JOURNAL, "SELECT")):
        lose = _pristine_release_grants() + f"\nREVOKE {privilege} ON public.{table} FROM service_role;"
        err = _refused(lose + "\n" + _post_block())
        assert f"service_role lost a reviewed backend right: {table}:{privilege}" in err, (table, err)
        err = _refused(lose + "\n" + contract)
        assert f"{table}:service_role (missing):{privilege}" in err, (table, err)


def test_price_schedules_keep_their_rights_and_stay_immutable():
    state = _state_after("")
    assert MINIMUM[PRICE] <= state[PRICE] <= {"SELECT", "INSERT", "UPDATE", "DELETE"}
    assert not state[PRICE] & {"TRUNCATE", "TRIGGER", "REFERENCES", "MAINTAIN"}
    model = sql_value(f"SELECT model FROM public.{PRICE} WHERE effective_to IS NULL ORDER BY model LIMIT 1;")
    assert model and int(sql_value(f"SELECT count(*) FROM public.{PRICE};")) > 0
    for statement, message in (
        (f"UPDATE public.{PRICE} SET output_per_mtok = 0 WHERE model = '{model}'", "may only be closed once"),
        (f"DELETE FROM public.{PRICE} WHERE model = '{model}'", "rows are immutable"),
    ):
        # under a fixture grant (UPDATE/DELETE tolerated by the maximum) the row guard refuses the change
        err = _refused(f"{_staging_fixture_grant()}\nSET LOCAL ROLE service_role;\n{statement};")
        assert message in err, (statement, err)
        # on pristine released grants service_role has no UPDATE/DELETE at all
        err = _refused(f"{_pristine_release_grants()}\nSET LOCAL ROLE service_role;\n{statement};")
        assert "permission denied" in err, (statement, err)
    err = _refused(f"SET LOCAL ROLE service_role;\nTRUNCATE public.{PRICE};")
    assert "permission denied" in err, err
