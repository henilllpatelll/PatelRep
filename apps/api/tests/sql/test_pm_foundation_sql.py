"""Exercises migration 232's functions against a REAL, DISPOSABLE Postgres, including concurrent callers.

Skipped unless PM_SQL_TEST_CONTAINER names a running Docker container whose name starts with `pm-sql-disposable`, e.g.:

    docker run -d --name pm-sql-disposable -e POSTGRES_PASSWORD=disposable postgres:16-alpine
    PM_SQL_TEST_CONTAINER=pm-sql-disposable pytest tests/sql -q

Safety: the test only ever talks to that container, creates its own `disposable_<random>` database inside it and drops it
afterwards, and refuses to run if the container name or database name does not match. It has no way to reach staging or
production: no connection string or credential is read from the environment.
"""

from __future__ import annotations

import json
import os
import subprocess
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import pytest

CONTAINER = os.environ.get("PM_SQL_TEST_CONTAINER", "")
ROOT = Path(__file__).resolve().parents[4]
STUB = Path(__file__).with_name("pm_foundation_stub_schema.sql")
MIGRATION = ROOT / "supabase" / "migrations" / "232_engineering_pm_assets_foundation.sql"

pytestmark = pytest.mark.skipif(
    not CONTAINER.startswith("pm-sql-disposable"),
    reason="needs PM_SQL_TEST_CONTAINER=pm-sql-disposable* (a throwaway Postgres container)",
)


def _psql(database: str, sql: str, *, input_sql: bool = False) -> str:
    assert database.startswith("disposable_") or database == "postgres"
    args = ["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-tA", "-q"]
    if not input_sql:
        args += ["-c", sql]
    result = subprocess.run(args, input=sql if input_sql else None, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())
    return result.stdout.strip()


@pytest.fixture(scope="module")
def db():
    name = f"disposable_{uuid.uuid4().hex[:8]}"
    _psql("postgres", f"CREATE DATABASE {name}")
    try:
        _psql(name, STUB.read_text(encoding="utf-8"), input_sql=True)
        _psql(name, MIGRATION.read_text(encoding="utf-8"), input_sql=True)
        assert _psql(name, "select current_database()").startswith("disposable_")
        yield name
    finally:
        _psql("postgres", f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")


def _id() -> str:
    return str(uuid.uuid4())


@pytest.fixture
def world(db):
    """A fresh tenant with one user pair, one asset and one monthly schedule due 2026-01-31."""
    w = {"tenant": _id(), "tech": _id(), "chief": _id(), "gm": _id(), "asset": _id(), "schedule": _id()}
    _psql(db, f"""
      insert into public.tenants (id) values ('{w['tenant']}');
      insert into auth.users (id) values ('{w['tech']}'), ('{w['chief']}'), ('{w['gm']}');
      insert into public.assets (id, tenant_id, name, asset_tag) values ('{w['asset']}', '{w['tenant']}', 'Chiller', 'CH-1');
      insert into public.pm_schedules (id, tenant_id, asset_id, name, interval_type, next_due_at)
        values ('{w['schedule']}', '{w['tenant']}', '{w['asset']}', 'Monthly', 'monthly', '2026-01-31T00:00:00Z');
    """)
    return w


def _complete(db, w, *, submission=None, h="hash-a", failed=False, completion=None, schedule=None, user=None) -> dict:
    items = [{"item_key": "a", "label": "Belt", "result": "failed" if failed else "passed", "requires_evidence": False, "evidence": [], "note": None}]
    corrective = [{
        "label": "Belt", "asset_id": w["asset"], "title": "Corrective PM work: Belt", "description": "x", "category": "safety",
        "priority": "urgent", "created_by": user or w["tech"], "sla_minutes": 60, "due_at": "2026-02-01T00:00:00Z",
    }] if failed else []
    sub = f"'{submission}'" if submission else "null"
    sql = f"""select public.record_pm_completion(
      '{w['tenant']}', '{schedule or w['schedule']}', '{user or w['tech']}', 'engineer', '{completion or _id()}', {sub}, '{h}',
      '{{"labor_minutes": 5}}'::jsonb, '{json.dumps(items)}'::jsonb, '{json.dumps(corrective)}'::jsonb, '{{}}'::uuid[], now())"""
    return json.loads(_psql(db, sql))


def _scalar(db, sql):
    return _psql(db, sql)


def test_migration_is_idempotent(db):
    _psql(db, MIGRATION.read_text(encoding="utf-8"), input_sql=True)


@pytest.mark.parametrize("interval,days,base", [
    ("daily", None, "2026-01-31T10:00:00+00:00"), ("weekly", None, "2026-12-28T00:00:00+00:00"),
    ("monthly", None, "2026-01-31T00:00:00+00:00"), ("monthly", None, "2024-01-31T09:30:00+00:00"),
    ("quarterly", None, "2026-11-30T00:00:00+00:00"), ("annual", None, "2024-02-29T00:00:00+00:00"),
    ("custom", 45, "2026-03-01T00:00:00+00:00"), ("custom", None, "2026-03-01T00:00:00+00:00"), ("weird", None, "2026-03-01T00:00:00+00:00"),
])
def test_next_due_matches_python(db, interval, days, base):
    from dateutil.relativedelta import relativedelta
    deltas = {"daily": relativedelta(days=1), "weekly": relativedelta(weeks=1), "monthly": relativedelta(months=1),
              "quarterly": relativedelta(months=3), "annual": relativedelta(years=1)}
    start = datetime.fromisoformat(base)
    expected = start + (relativedelta(days=days or 1) if interval == "custom" else deltas.get(interval, relativedelta(days=1)))
    got = _scalar(db, f"select to_char(public.pm_next_due_at('{base}', '{interval}', {days if days else 'null'}) at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS')")
    assert got == expected.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")


def test_completion_is_atomic_advances_once_and_creates_one_work_order(db, world):
    sub = _id()
    first = _complete(db, world, submission=sub, failed=True)
    assert first["status"] == "created"
    assert [w["title"] for w in first["corrective_work_orders"]] == ["Corrective PM work: Belt"]
    assert _scalar(db, f"select to_char(next_due_at at time zone 'UTC','YYYY-MM-DD') from public.pm_schedules where id='{world['schedule']}'") == "2026-02-28"

    replay = _complete(db, world, submission=sub, failed=True)
    assert replay["status"] == "replayed"
    assert replay["completion"]["id"] == first["completion"]["id"]
    assert len(replay["corrective_work_orders"]) == 1
    counts = _scalar(db, f"""select (select count(*) from public.pm_completion_records where tenant_id='{world['tenant']}'),
      (select count(*) from public.work_orders where tenant_id='{world['tenant']}'),
      (select count(*) from public.operational_audit_events where tenant_id='{world['tenant']}'),
      (select to_char(next_due_at at time zone 'UTC','YYYY-MM-DD') from public.pm_schedules where id='{world['schedule']}')""")
    assert counts == "1|1|1|2026-02-28"


def test_same_key_with_different_payload_is_a_conflict_and_changes_nothing(db, world):
    sub = _id()
    assert _complete(db, world, submission=sub, h="hash-a")["status"] == "created"
    assert _complete(db, world, submission=sub, h="hash-b")["status"] == "conflict"
    assert _scalar(db, f"select count(*) from public.pm_completion_records where tenant_id='{world['tenant']}'") == "1"


def test_failed_attempt_leaves_no_partial_rows(db, world):
    # A corrective work order that violates a constraint must roll the whole completion back.
    with pytest.raises(RuntimeError):
        _psql(db, f"""select public.record_pm_completion('{world['tenant']}', '{world['schedule']}', '{world['tech']}', 'engineer', '{_id()}', null, 'h',
          '{{}}'::jsonb, '[{{"item_key":"a","label":"A","result":"not-a-valid-result"}}]'::jsonb, '[]'::jsonb, '{{}}'::uuid[], now())""")
    assert _scalar(db, f"select count(*) from public.pm_completion_records where tenant_id='{world['tenant']}'") == "0"
    assert _scalar(db, f"select to_char(next_due_at at time zone 'UTC','YYYY-MM-DD') from public.pm_schedules where id='{world['schedule']}'") == "2026-01-31"


def test_inactive_asset_refuses_new_completion_but_not_a_replay(db, world):
    sub = _id()
    assert _complete(db, world, submission=sub)["status"] == "created"
    _psql(db, f"update public.assets set is_active = false where id='{world['asset']}'")
    assert _complete(db, world, submission=sub)["status"] == "replayed"
    assert _complete(db, world, submission=_id())["status"] == "asset_inactive"


def test_unknown_or_foreign_schedule_is_not_found(db, world):
    assert _complete(db, world, schedule=_id())["status"] == "schedule_not_found"
    other_tenant = {**world, "tenant": _id()}
    _psql(db, f"insert into public.tenants (id) values ('{other_tenant['tenant']}')")
    assert _complete(db, other_tenant)["status"] == "schedule_not_found"


def test_concurrent_identical_submissions_record_once(db, world):
    sub = _id()
    items = [{"item_key": "a", "label": "Belt", "result": "failed", "requires_evidence": False, "evidence": [], "note": None}]
    corrective = [{"label": "Belt", "asset_id": world["asset"], "title": "Corrective PM work: Belt", "description": "x", "category": "safety",
                   "priority": "urgent", "created_by": world["tech"], "sla_minutes": 60, "due_at": "2026-02-01T00:00:00Z"}]

    def attempt(_):
        sql = f"""begin;
        select public.record_pm_completion('{world['tenant']}', '{world['schedule']}', '{world['tech']}', 'engineer', '{_id()}', '{sub}', 'same',
          '{{}}'::jsonb, '{json.dumps(items)}'::jsonb, '{json.dumps(corrective)}'::jsonb, '{{}}'::uuid[], now());
        select pg_sleep(1.0);
        commit;"""
        out = _psql(db, sql, input_sql=True)
        return json.loads(out.splitlines()[0])["status"]

    with ThreadPoolExecutor(max_workers=6) as pool:
        statuses = sorted(pool.map(attempt, range(6)))
    assert statuses == ["created"] + ["replayed"] * 5
    assert _scalar(db, f"""select (select count(*) from public.pm_completion_records where tenant_id='{world['tenant']}'),
      (select count(*) from public.work_orders where tenant_id='{world['tenant']}'),
      (select to_char(next_due_at at time zone 'UTC','YYYY-MM-DD') from public.pm_schedules where id='{world['schedule']}')""") == "1|1|2026-02-28"


def _defer(db, w, *, requested_by=None, until="2099-01-01T00:00:00Z", approved_by=None) -> str:
    deferral = _id()
    ab = f"'{approved_by}'" if approved_by else "null"
    _psql(db, f"""insert into public.pm_deferrals (id, tenant_id, pm_schedule_id, reason, requested_by, approved_by, deferred_until)
      values ('{deferral}', '{w['tenant']}', '{w['schedule']}', 'parts', '{requested_by or w['chief']}', {ab}, '{until}')""")
    return deferral


def _decide(db, w, deferral, reviewer, decision="approved") -> dict:
    return json.loads(_psql(db, f"select public.decide_pm_deferral('{w['tenant']}', '{deferral}', '{reviewer}', 'chief_engineer', '{decision}', 'ok')"))


def _due(db, w) -> str:
    return _scalar(db, f"select to_char(next_due_at at time zone 'UTC','YYYY-MM-DD') from public.pm_schedules where id='{w['schedule']}'")


def test_pending_request_does_not_move_the_due_date_and_self_review_is_refused(db, world):
    deferral = _defer(db, world)
    assert _due(db, world) == "2026-01-31"
    assert _decide(db, world, deferral, world["chief"])["status"] == "self_review"
    assert _due(db, world) == "2026-01-31"
    assert _scalar(db, f"select count(*) from public.pm_deferral_decisions where deferral_id='{deferral}'") == "0"


def test_independent_approval_moves_the_due_date_once_and_is_audited(db, world):
    deferral = _defer(db, world)
    ok = _decide(db, world, deferral, world["gm"])
    assert ok["status"] == "ok" and ok["decision"]["decided_by"] == world["gm"]
    assert _due(db, world) == "2099-01-01"
    again = _decide(db, world, deferral, world["gm"])
    assert again["status"] == "already_decided"
    assert _decide(db, world, deferral, world["chief"], "rejected")["status"] == "already_decided"
    audit = _scalar(db, f"select action || ':' || actor_id from public.operational_audit_events where resource_id='{deferral}'")
    assert audit == f"pm_deferral.approved:{world['gm']}"


def test_rejection_leaves_the_schedule_alone(db, world):
    deferral = _defer(db, world)
    assert _decide(db, world, deferral, world["gm"], "rejected")["status"] == "ok"
    assert _due(db, world) == "2026-01-31"
    assert _decide(db, world, deferral, world["gm"], "approved")["status"] == "already_decided"


def test_concurrent_reviewers_apply_a_deferral_at_most_once(db, world):
    second_reviewer = _id()
    _psql(db, f"insert into auth.users (id) values ('{second_reviewer}')")
    deferral = _defer(db, world)

    def attempt(reviewer):
        sql = f"""begin;
        select public.decide_pm_deferral('{world['tenant']}', '{deferral}', '{reviewer}', 'gm', 'approved', 'n');
        select pg_sleep(1.0);
        commit;"""
        return json.loads(_psql(db, sql, input_sql=True).splitlines()[0])["status"]

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = sorted(pool.map(attempt, [world["gm"], second_reviewer]))
    assert statuses == ["already_decided", "ok"]
    assert _scalar(db, f"select count(*) from public.pm_deferral_decisions where deferral_id='{deferral}'") == "1"
    assert _due(db, world) == "2099-01-01"


def test_stale_and_expired_requests_are_refused(db, world):
    earlier = _defer(db, world, until="2026-01-15T00:00:00Z")
    assert _decide(db, world, earlier, world["gm"])["status"] == "expired"
    not_later = _defer(db, world, until="2099-02-01T00:00:00Z")
    _psql(db, f"update public.pm_schedules set next_due_at = '2099-03-01' where id='{world['schedule']}'")
    assert _decide(db, world, not_later, world["gm"])["status"] == "stale"


def test_legacy_approved_rows_read_as_decided_and_other_tenants_cannot_decide(db, world):
    legacy = _defer(db, world, approved_by=world["gm"])
    assert _decide(db, world, legacy, world["gm"])["status"] == "already_decided"
    pending = _defer(db, world)
    other = {**world, "tenant": _id()}
    _psql(db, f"insert into public.tenants (id) values ('{other['tenant']}')")
    assert _decide(db, other, pending, world["gm"])["status"] == "not_found"


def test_decisions_and_completions_are_append_only(db, world):
    deferral = _defer(db, world)
    _decide(db, world, deferral, world["gm"])
    with pytest.raises(RuntimeError, match="append-only"):
        _psql(db, f"update public.pm_deferral_decisions set decision='rejected' where deferral_id='{deferral}'")
    _complete(db, world)
    with pytest.raises(RuntimeError, match="append-only"):
        _psql(db, f"update public.pm_completion_records set notes='edited' where tenant_id='{world['tenant']}'")


def test_requester_cannot_be_recorded_as_their_own_approver(db, world):
    with pytest.raises(RuntimeError, match="pm_deferrals_not_self_approved"):
        _defer(db, world, requested_by=world["gm"], approved_by=world["gm"])


def test_active_asset_tag_is_unique_per_property_ignoring_case_but_retired_tags_can_be_reused(db, world):
    with pytest.raises(RuntimeError, match="assets_tenant_active_tag_uidx"):
        _psql(db, f"insert into public.assets (id, tenant_id, name, asset_tag) values ('{_id()}', '{world['tenant']}', 'Dup', ' ch-1 ')")
    _psql(db, f"update public.assets set is_active=false where id='{world['asset']}'")
    _psql(db, f"insert into public.assets (id, tenant_id, name, asset_tag) values ('{_id()}', '{world['tenant']}', 'Replacement', 'CH-1')")
    other = _id()
    _psql(db, f"insert into public.tenants (id) values ('{other}'); insert into public.assets (id, tenant_id, name, asset_tag) values ('{_id()}', '{other}', 'Other hotel', 'CH-1')")
