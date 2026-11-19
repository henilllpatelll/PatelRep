"""Migration 258: exact backend privilege matrix on the protected harness tables, no structural rights anywhere in public.

Regression guard for the staging fixture privilege drift: Staging Candidate's "Grant staging fixture service access" and
CI's service-role grant run ``GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role``. Before 258 the enforcement
left REFERENCES, TRIGGER and MAINTAIN behind, so the reviewed Control Center journal postcondition (service_role:
SELECT only) was false on persistent staging, and the structural rights were broader than any application path needs.
DELETE on the mutable tables is the reviewed backend right and is tolerated here (not required, not removed).

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
    assert len(tables) == 33
    for table in tables:
        append_only = state[table + "#append_only"] == {"t"} or state[table + "#append_only"] == {"true"}
        allowed = _allowed(table, append_only)
        required = allowed - {"DELETE"}
        assert required <= state[table] <= allowed, (table, sorted(state[table]))
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
                   "GRANT it_grantor TO current_user WITH SET TRUE, INHERIT FALSE;\n"
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
