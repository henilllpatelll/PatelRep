"""Exercises migration 234 (assignments, deadline capture) against a REAL, DISPOSABLE Postgres, including a race.

Skipped unless PM_SQL_TEST_CONTAINER names a running throwaway container (see test_pm_foundation_sql.py for the recipe and
the safety rules; this file reuses its helpers and talks to nothing else).
"""

from __future__ import annotations

import json
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest

from tests.sql.test_pm_foundation_sql import CONTAINER, MIGRATION, STUB, _complete, _id, _psql

M234 = MIGRATION.with_name("234_pm_management_assignments.sql")

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
        yield name
    finally:
        _psql("postgres", f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")


@pytest.fixture
def world(db):
    w = {k: _id() for k in ("tenant", "other_tenant", "tech", "tech2", "chief", "hk", "gone", "stranger", "asset", "schedule")}
    _psql(db, f"""
      insert into public.tenants (id) values ('{w['tenant']}'), ('{w['other_tenant']}');
      insert into auth.users (id) values ('{w['tech']}'), ('{w['tech2']}'), ('{w['chief']}'), ('{w['hk']}'), ('{w['gone']}'), ('{w['stranger']}');
      insert into public.user_profiles (id, tenant_id, is_active) values
        ('{w['tech']}', '{w['tenant']}', true), ('{w['tech2']}', '{w['tenant']}', true), ('{w['chief']}', '{w['tenant']}', true),
        ('{w['hk']}', '{w['tenant']}', true), ('{w['gone']}', '{w['tenant']}', false), ('{w['stranger']}', '{w['other_tenant']}', true);
      insert into public.user_roles (user_id, tenant_id, role) values
        ('{w['tech']}', '{w['tenant']}', 'engineer'), ('{w['tech2']}', '{w['tenant']}', 'engineer'), ('{w['chief']}', '{w['tenant']}', 'chief_engineer'),
        ('{w['hk']}', '{w['tenant']}', 'housekeeper'), ('{w['gone']}', '{w['tenant']}', 'engineer'), ('{w['stranger']}', '{w['other_tenant']}', 'engineer');
      insert into public.assets (id, tenant_id, name, asset_tag) values ('{w['asset']}', '{w['tenant']}', 'Chiller', 'CH-1');
      insert into public.pm_schedules (id, tenant_id, asset_id, name, interval_type, next_due_at)
        values ('{w['schedule']}', '{w['tenant']}', '{w['asset']}', 'Monthly', 'monthly', '2026-01-31T00:00:00Z');
    """)
    return w


def _assign(db, w, assignee, version, *, tenant=None, schedule=None, actor=None) -> dict:
    who = f"'{assignee}'" if assignee else "null"
    return json.loads(_psql(db, f"""select public.assign_pm_schedule(
      '{tenant or w['tenant']}', '{schedule or w['schedule']}', '{actor or w['chief']}', 'chief_engineer', {who}, {version})"""))


def _scalar(db, sql):
    return _psql(db, sql)


def test_migration_is_idempotent(db):
    _psql(db, M234.read_text(encoding="utf-8"), input_sql=True)


def test_assign_reassign_unassign_write_history_audit_and_bump_the_version(db, world):
    first = _assign(db, world, world["tech"], 1)
    assert first["status"] == "ok" and first["action"] == "assigned" and first["schedule"]["row_version"] == 2
    assert first["schedule"]["assigned_to"] == world["tech"] and first["schedule"]["assigned_by"] == world["chief"]
    again = _assign(db, world, world["tech"], 2)
    assert again["status"] == "no_change"  # a repeat is not a new event
    moved = _assign(db, world, world["tech2"], 2)
    assert moved["action"] == "reassigned" and moved["schedule"]["row_version"] == 3
    cleared = _assign(db, world, None, 3)
    assert cleared["action"] == "unassigned" and cleared["schedule"]["assigned_to"] is None
    events = _scalar(db, f"select string_agg(action, ',') from public.pm_schedule_assignment_events where pm_schedule_id = '{world['schedule']}'")
    assert sorted(events.split(",")) == ["assigned", "reassigned", "unassigned"]
    audited = _scalar(db, f"select count(*) from public.operational_audit_events where resource_id = '{world['schedule']}' and action like 'pm_schedule.%assigned'")
    assert audited == "3"


@pytest.mark.parametrize("who", ["hk", "gone", "stranger"])
def test_assignee_must_be_an_active_engineer_of_this_property(db, world, who):
    assert _assign(db, world, world[who], 1)["status"] == "assignee_ineligible"
    assert _scalar(db, f"select assigned_to is null and row_version = 1 from public.pm_schedules where id = '{world['schedule']}'") == "t"


def test_stale_version_and_foreign_tenant_and_inactive_schedule_are_refused(db, world):
    assert _assign(db, world, world["tech"], 7)["status"] == "conflict"
    assert _assign(db, world, world["tech"], 1, tenant=world["other_tenant"])["status"] == "not_found"
    _psql(db, f"update public.pm_schedules set is_active = false where id = '{world['schedule']}'")
    assert _assign(db, world, world["tech"], 1)["status"] == "schedule_inactive"


def test_two_managers_racing_on_the_same_version_produce_exactly_one_assignment(db, world):
    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda who: _assign(db, world, who, 1), [world["tech"], world["tech2"]]))
    assert sorted(r["status"] for r in results) == ["conflict", "ok"]
    assert _scalar(db, f"select count(*) from public.pm_schedule_assignment_events where pm_schedule_id = '{world['schedule']}'") == "1"


def test_assignment_lapses_when_the_inspection_is_completed_and_never_carries_over(db, world):
    _assign(db, world, world["tech"], 1)
    done = _complete(db, world)
    assert done["status"] == "created"
    row = json.loads(_scalar(db, f"select row_to_json(s) from public.pm_schedules s where id = '{world['schedule']}'"))
    assert row["assigned_to"] == world["tech"]  # history is kept ...
    assert row["assigned_for_due_at"] != row["next_due_at"]  # ... but it no longer belongs to the new due date
    # A fresh assignment for the new cycle is a plain "assigned" only when the API treats the lapsed one as empty; the
    # database agrees: the stored assignee is compared against the CURRENT due date.
    fresh = _assign(db, world, world["tech2"], row["row_version"])
    assert fresh["action"] == "assigned"


def test_completion_records_the_deadline_it_satisfied(db, world):
    _complete(db, world)
    due = _scalar(db, f"select due_at at time zone 'utc' from public.pm_completion_records where tenant_id = '{world['tenant']}'")
    assert due.startswith("2026-01-31 00:00:00")  # the schedule's due date BEFORE it advanced
