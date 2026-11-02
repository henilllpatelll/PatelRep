"""Exercises migration 235 (corrective work order -> failed checklist item) against a REAL, DISPOSABLE Postgres.

Skipped unless PM_SQL_TEST_CONTAINER names a running throwaway container (see test_pm_foundation_sql.py for the recipe and
the safety rules; this file reuses its helpers and talks to nothing else).
"""

from __future__ import annotations

import json
import uuid

import pytest

from tests.sql.test_pm_foundation_sql import CONTAINER, MIGRATION, STUB, _id, _psql

M234 = MIGRATION.with_name("234_pm_management_assignments.sql")
M235 = MIGRATION.with_name("235_pm_corrective_item_link.sql")

pytestmark = pytest.mark.skipif(
    not CONTAINER.startswith("pm-sql-disposable"),
    reason="needs PM_SQL_TEST_CONTAINER=pm-sql-disposable* (a throwaway Postgres container)",
)


@pytest.fixture(scope="module")
def db():
    name = f"disposable_{uuid.uuid4().hex[:8]}"
    _psql("postgres", f"CREATE DATABASE {name}")
    try:
        _psql(name, STUB.read_text(encoding="utf-8"), input_sql=True)
        _psql(name, MIGRATION.read_text(encoding="utf-8"), input_sql=True)
        _psql(name, M234.read_text(encoding="utf-8"), input_sql=True)
        _psql(name, M235.read_text(encoding="utf-8"), input_sql=True)
        yield name
    finally:
        _psql("postgres", f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")


@pytest.fixture
def world(db):
    w = {k: _id() for k in ("tenant", "tech", "asset", "schedule")}
    _psql(db, f"""
      insert into public.tenants (id) values ('{w['tenant']}');
      insert into auth.users (id) values ('{w['tech']}');
      insert into public.assets (id, tenant_id, name, asset_tag) values ('{w['asset']}', '{w['tenant']}', 'Chiller', 'CH-1');
      insert into public.pm_schedules (id, tenant_id, asset_id, name, interval_type, next_due_at)
        values ('{w['schedule']}', '{w['tenant']}', '{w['asset']}', 'Monthly', 'monthly', '2026-01-31T00:00:00Z');
    """)
    return w


def _complete(db, w, failures, *, submission=None, completion=None) -> dict:
    """`failures` is a list of (item_key, label, corrective_item_key) - the last is what the API sends alongside each order."""
    items = [{"item_key": key, "label": label, "result": "failed", "requires_evidence": False, "evidence": [], "note": None}
             for key, label, _ in failures]
    corrective = [{
        "label": label, "item_key": link, "asset_id": w["asset"], "title": f"Corrective PM work: {label}", "description": "x",
        "category": "safety", "priority": "urgent", "created_by": w["tech"], "sla_minutes": 60, "due_at": "2026-02-01T00:00:00Z",
    } for _, label, link in failures]
    sub = f"'{submission}'" if submission else "null"
    sql = f"""select public.record_pm_completion(
      '{w['tenant']}', '{w['schedule']}', '{w['tech']}', 'engineer', '{completion or _id()}', {sub}, 'h',
      '{{"labor_minutes": 5}}'::jsonb, '{json.dumps(items)}'::jsonb, '{json.dumps(corrective)}'::jsonb, '{{}}'::uuid[], now())"""
    return json.loads(_psql(db, sql))


def _links(db, w) -> dict[str, str | None]:
    rows = _psql(db, f"select title || '|' || coalesce(pm_completion_item_key, '<null>') from public.work_orders where tenant_id = '{w['tenant']}' order by title")
    return dict(line.split("|", 1) for line in rows.splitlines() if line)


def test_migration_is_idempotent(db):
    _psql(db, M235.read_text(encoding="utf-8"), input_sql=True)


def test_each_corrective_order_stores_the_item_it_was_opened_for(db, world):
    out = _complete(db, world, [("belt", "Belt", "belt"), ("filter", "Filter", "filter")])
    assert out["status"] == "created" and len(out["corrective_work_orders"]) == 2
    assert _links(db, world) == {"Corrective PM work: Belt": "belt", "Corrective PM work: Filter": "filter"}


def test_replay_creates_no_second_order_and_does_not_change_the_link(db, world):
    sub = _id()
    first = _complete(db, world, [("belt", "Belt", "belt")], submission=sub)
    again = _complete(db, world, [("belt", "Belt", "belt")], submission=sub, completion=_id())
    assert first["status"] == "created" and again["status"] == "replayed"
    assert _psql(db, f"select count(*) from public.work_orders where tenant_id = '{world['tenant']}'") == "1"
    assert _links(db, world) == {"Corrective PM work: Belt": "belt"}


def test_a_missing_or_blank_key_is_stored_as_null_never_guessed_from_the_title(db, world):
    _complete(db, world, [("belt", "Belt", ""), ("filter", "Filter", None)])
    assert _links(db, world) == {"Corrective PM work: Belt": "<null>", "Corrective PM work: Filter": "<null>"}


def test_an_order_that_predates_the_column_stays_unlinked(db, world):
    _psql(db, f"""insert into public.work_orders (tenant_id, asset_id, title, is_pm_generated)
                  values ('{world['tenant']}', '{world['asset']}', 'Old corrective', true)""")
    assert _links(db, world) == {"Old corrective": "<null>"}


def test_privileges_are_unchanged_after_the_function_is_replaced(db):
    grantees = _psql(db, """select string_agg(distinct grantee, ',' order by grantee) from information_schema.routine_privileges
                            where routine_name = 'record_pm_completion' and routine_schema = 'public' and privilege_type = 'EXECUTE'""")
    assert "service_role" in grantees.split(",")
    assert "authenticated" not in grantees.split(",") and "anon" not in grantees.split(",")
