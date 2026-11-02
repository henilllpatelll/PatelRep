"""Contract tests for the Chief Engineer PM management API (routers/pm_management.py) and the criticality / schedule
version guards. A small in-memory Supabase stand-in really evaluates filters, so these prove who sees what and which
rows a write is allowed to touch. The assignment transaction itself is covered against real Postgres in tests/sql."""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from middleware.auth import CurrentUser, get_current_user
from routers import assets as assets_router
from routers import pm_management as pm_router
from services.reporting.periods import local_midnight_utc, local_today
from services.programs.assignment import annotate_assignee, effective_assignee

TENANT = "hotel-1"
OTHER_TENANT = "hotel-2"
CHIEF = "11111111-1111-4111-8111-111111111111"
TECH_A = "22222222-2222-4222-8222-222222222222"
TECH_B = "33333333-3333-4333-8333-333333333333"
NOW = datetime.now(timezone.utc)


def iso(delta_hours: float) -> str:
    return (NOW + timedelta(hours=delta_hours)).isoformat()


class _Result:
    def __init__(self, data):
        self.data = data


class _Rpc:
    def __init__(self, db, name, params):
        self.db, self.name, self.params = db, name, params

    def execute(self):
        self.db.rpc_calls.append((self.name, self.params))
        return _Result(self.db.rpc_handler(self.name, self.params))


class _Query:
    def __init__(self, db, table):
        self.db, self.table_name = db, table
        self.filters, self.orders, self.max_rows = [], [], None
        self.single, self.mode, self.payload = False, "select", None

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self.filters.append(lambda r: r.get(col) == val)
        return self

    def in_(self, col, vals):
        vals = {str(v) for v in vals}
        self.filters.append(lambda r: str(r.get(col)) in vals)
        return self

    def is_(self, col, val):
        self.filters.append(lambda r: (r.get(col) is None) == (val == "null"))
        return self

    def gte(self, col, val):
        self.filters.append(lambda r: r.get(col) is not None and r[col] >= val)
        return self

    def lt(self, col, val):
        self.filters.append(lambda r: r.get(col) is not None and r[col] < val)
        return self

    def order(self, col, desc=False, **_k):
        self.orders.append((col, desc))
        return self

    def limit(self, n):
        self.max_rows = n
        return self

    def maybe_single(self):
        self.single = True
        return self

    def update(self, payload):
        self.mode, self.payload = "update", payload
        return self

    def insert(self, payload):
        self.mode, self.payload = "insert", payload
        return self

    def execute(self):
        rows = self.db.tables.setdefault(self.table_name, [])
        if self.mode == "insert":
            row = dict(self.payload, id=self.payload.get("id", f"new-{len(rows)}"))
            rows.append(row)
            return _Result([dict(row)])
        matched = [r for r in rows if all(f(r) for f in self.filters)]
        if self.mode == "update":
            for r in matched:
                r.update(self.payload)
            return _Result([dict(r) for r in matched])
        out = [dict(r) for r in matched]
        for col, desc in reversed(self.orders):
            out.sort(key=lambda r: (r.get(col) is None, r.get(col) or ""), reverse=desc)
        if self.max_rows is not None:
            out = out[: self.max_rows]
        if self.single:
            return _Result(out[0] if out else None)
        return _Result(out)


class _Db:
    def __init__(self, rpc_handler=None, **tables):
        self.tables, self.rpc_calls = tables, []
        self.rpc_handler = rpc_handler or (lambda name, params: None)

    def table(self, name):
        return _Query(self, name)

    def rpc(self, name, params):
        return _Rpc(self, name, params)


def schedule(n, *, due=24, tenant=TENANT, active=True, **over):
    row = {
        "id": f"00000000-0000-4000-8000-{n:012d}", "tenant_id": tenant, "name": f"PM {n}", "asset_id": f"a-{n}",
        "interval_type": "monthly", "interval_days": None, "recurrence_basis": "scheduled_date", "estimated_minutes": 30,
        "next_due_at": iso(due), "last_completed_at": None, "is_active": active, "assigned_to_role": "engineer",
        "assigned_to": None, "assigned_for_due_at": None, "assigned_at": None, "assigned_by": None, "row_version": 1,
        "checklist_template_id": None, "checklist_template_code": None,
        "assets": {"name": f"Unit {n}", "asset_tag": f"T{n}", "location_text": "Roof", "is_active": True,
                   "category_id": "cat-1", "criticality": "medium", "asset_categories": {"name": "HVAC"}},
    }
    row.update(over)
    return row


def assigned(n, who, *, due=24, **over):
    return schedule(n, due=due, assigned_to=who, assigned_for_due_at=iso(due), **over)


def base_tables(**extra):
    tables = dict(
        tenants=[{"id": TENANT, "timezone": "America/Chicago"}],
        user_roles=[
            {"tenant_id": TENANT, "user_id": TECH_A, "role": "engineer", "is_active": True},
            {"tenant_id": TENANT, "user_id": TECH_B, "role": "engineer", "is_active": True},
            {"tenant_id": TENANT, "user_id": CHIEF, "role": "chief_engineer", "is_active": True},
            {"tenant_id": TENANT, "user_id": "hk-1", "role": "housekeeper", "is_active": True},
            {"tenant_id": TENANT, "user_id": "gone", "role": "engineer", "is_active": False},
            {"tenant_id": OTHER_TENANT, "user_id": "far", "role": "engineer", "is_active": True},
        ],
        user_profiles=[
            {"id": TECH_A, "tenant_id": TENANT, "full_name": "Ana Technician", "is_active": True},
            {"id": TECH_B, "tenant_id": TENANT, "full_name": "Bo Technician", "is_active": True},
            {"id": CHIEF, "tenant_id": TENANT, "full_name": "Cy Chief", "is_active": True},
            {"id": "hk-1", "tenant_id": TENANT, "full_name": "Hk Person", "is_active": True},
            {"id": "gone", "tenant_id": TENANT, "full_name": "Left Company", "is_active": False},
            {"id": "far", "tenant_id": OTHER_TENANT, "full_name": "Other Hotel", "is_active": True},
        ],
        pm_deferrals=[], pm_deferral_decisions=[], pm_completion_records=[], pm_checklist_templates=[],
        pm_schedule_assignment_events=[], assets=[], operational_audit_events=[],
    )
    tables.update(extra)
    return tables


def make_client(monkeypatch, db, role="chief_engineer", user_id=CHIEF):
    for module in (pm_router, assets_router):
        monkeypatch.setattr(module, "supabase", db)
    app = FastAPI()
    app.include_router(pm_router.router)
    app.include_router(assets_router.router)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        user_id=user_id, hotel_id=TENANT, role=role, email="x@example.com"
    )
    return TestClient(app)


# --- assignment semantics ----------------------------------------------------

def test_assignment_lapses_when_the_due_date_moves():
    current = assigned(1, TECH_A, due=24)
    assert effective_assignee(current) == TECH_A
    advanced = {**current, "next_due_at": iso(24 * 31)}  # completed, schedule advanced a cycle
    assert effective_assignee(advanced) is None
    assert annotate_assignee(dict(advanced))["assignment_lapsed"] is True
    assert annotate_assignee(dict(schedule(2)))["assignment_lapsed"] is False


# --- summary -----------------------------------------------------------------

def test_summary_counts_are_distinct_scoped_and_exclude_retired_equipment(monkeypatch):
    retired = schedule(5, due=-30)
    retired["assets"] = {**retired["assets"], "is_active": False}
    db = _Db(**base_tables(
        pm_schedules=[
            schedule(1, due=-48),                      # overdue, unassigned
            assigned(2, TECH_A, due=-5),               # overdue, assigned
            schedule(3, due=1),                        # due soon (inside the week unless the week ends first), unassigned
            schedule(4, due=24 * 40),                  # far future
            retired,                                   # retired equipment is not coverage
            schedule(6, due=-48, tenant=OTHER_TENANT), # another property
            schedule(7, due=-48, active=False),        # inactive schedule
        ],
        pm_deferrals=[
            {"id": "d1", "tenant_id": TENANT, "pm_schedule_id": "s", "approved_by": None, "created_at": iso(-3)},
            {"id": "d2", "tenant_id": TENANT, "pm_schedule_id": "s", "approved_by": None, "created_at": iso(-2)},
            {"id": "d3", "tenant_id": OTHER_TENANT, "pm_schedule_id": "s", "approved_by": None, "created_at": iso(-2)},
        ],
        pm_deferral_decisions=[{"tenant_id": TENANT, "deferral_id": "d2", "decision": "rejected"}],
    ))
    body = make_client(monkeypatch, db).get("/pm-management/summary").json()["data"]
    assert body["overdue"] == 2
    assert body["pending_approvals"] == 1          # d2 is decided, d3 is another hotel
    assert body["active_schedules"] == 4
    assert body["unassigned"] >= 1 and body["unassigned"] <= 2   # PM 1 always; PM 3 only if it falls inside the local week
    assert body["timezone"] == "America/Chicago"


def test_summary_is_forbidden_to_a_line_engineer(monkeypatch):
    client = make_client(monkeypatch, _Db(**base_tables(pm_schedules=[])), role="engineer", user_id=TECH_A)
    assert client.get("/pm-management/summary").status_code == 403
    assert client.get("/pm-management/workload").status_code == 403
    assert client.get("/pm-management/performance").status_code == 403
    assert client.get("/pm-management/programs").status_code == 403


# --- technicians -------------------------------------------------------------

def test_technician_list_is_this_property_active_engineers_only(monkeypatch):
    client = make_client(monkeypatch, _Db(**base_tables(pm_schedules=[])), role="engineer", user_id=TECH_A)
    ids = {t["id"] for t in client.get("/pm-management/technicians").json()["data"]}
    assert ids == {TECH_A, TECH_B, CHIEF}   # not the housekeeper, the deactivated user or the other property's engineer


# --- assignment endpoint -----------------------------------------------------

def _ok_handler(action="assigned"):
    def handler(name, params):
        assert name == "assign_pm_schedule"
        return {"status": "ok", "action": action, "schedule": assigned(1, params["p_assignee_id"], row_version=2)}
    return handler


def test_assign_calls_the_transaction_as_the_authenticated_actor(monkeypatch):
    db = _Db(rpc_handler=_ok_handler(), **base_tables(pm_schedules=[]))
    response = make_client(monkeypatch, db).put(
        "/pm-management/schedules/00000000-0000-4000-8000-000000000001/assignment",
        json={"assignee_id": TECH_A, "expected_version": 1, "actor_id": TECH_B},
    )
    assert response.status_code == 200, response.text
    params = db.rpc_calls[0][1]
    assert params["p_actor_id"] == CHIEF and params["p_actor_role"] == "chief_engineer"   # a body-supplied actor is ignored
    assert params["p_tenant_id"] == TENANT and params["p_expected_version"] == 1
    data = response.json()["data"]
    assert data["effective_assigned_to"] == TECH_A and data["assignee_name"] == "Ana Technician"
    assert response.json()["meta"] == {"action": "assigned", "changed": True}


@pytest.mark.parametrize("status,code,key", [
    ("conflict", 409, "version_conflict"),
    ("schedule_inactive", 409, "schedule_inactive"),
    ("assignee_ineligible", 422, "assignee_ineligible"),
    ("not_found", 404, "not_found"),
])
def test_assign_refusals_map_to_actionable_errors(monkeypatch, status, code, key):
    db = _Db(rpc_handler=lambda n, p: {"status": status, "current_version": 5}, **base_tables(pm_schedules=[]))
    response = make_client(monkeypatch, db).put(
        "/pm-management/schedules/00000000-0000-4000-8000-000000000001/assignment",
        json={"assignee_id": TECH_A, "expected_version": 1},
    )
    assert response.status_code == code
    assert response.json()["detail"]["code"] == key


def test_assign_requires_a_manager_and_a_version_and_a_real_id(monkeypatch):
    db = _Db(rpc_handler=_ok_handler(), **base_tables(pm_schedules=[]))
    url = "/pm-management/schedules/00000000-0000-4000-8000-000000000001/assignment"
    assert make_client(monkeypatch, db, role="engineer", user_id=TECH_A).put(url, json={"assignee_id": TECH_A, "expected_version": 1}).status_code == 403
    assert db.rpc_calls == []
    client = make_client(monkeypatch, db)
    assert client.put(url, json={"assignee_id": TECH_A}).status_code == 422             # version is mandatory
    assert client.put(url, json={"assignee_id": "not-a-uuid", "expected_version": 1}).status_code == 422
    assert client.put("/pm-management/schedules/nope/assignment", json={"expected_version": 1}).status_code == 404


def test_unassign_passes_a_null_assignee(monkeypatch):
    db = _Db(rpc_handler=lambda n, p: {"status": "ok", "action": "unassigned", "schedule": schedule(1, row_version=3)}, **base_tables(pm_schedules=[]))
    response = make_client(monkeypatch, db).put(
        "/pm-management/schedules/00000000-0000-4000-8000-000000000001/assignment",
        json={"assignee_id": None, "expected_version": 2},
    )
    assert response.status_code == 200 and db.rpc_calls[0][1]["p_assignee_id"] is None
    assert response.json()["data"]["effective_assigned_to"] is None


def test_missing_database_function_fails_closed(monkeypatch):
    def boom(name, params):
        raise RuntimeError("PGRST202 Could not find the function")
    db = _Db(rpc_handler=boom, **base_tables(pm_schedules=[]))
    response = make_client(monkeypatch, db).put(
        "/pm-management/schedules/00000000-0000-4000-8000-000000000001/assignment", json={"assignee_id": TECH_A, "expected_version": 1})
    assert response.status_code == 503 and response.json()["detail"]["code"] == "assignment_unavailable"


# --- programs ----------------------------------------------------------------

def test_programs_filter_by_assignee_overdue_and_checklist_state(monkeypatch):
    db = _Db(**base_tables(pm_schedules=[
        assigned(1, TECH_A, due=-3),
        schedule(2, due=48),
        schedule(3, due=-1, checklist_template_id="gone-id", checklist_template_code="HVAC-1"),
        schedule(4, due=10, tenant=OTHER_TENANT),
    ]))
    client = make_client(monkeypatch, db)
    everything = client.get("/pm-management/programs").json()
    assert everything["meta"]["total"] == 3
    assert [s["name"] for s in client.get("/pm-management/programs", params={"overdue_only": True}).json()["data"]] == ["PM 1", "PM 3"]
    mine = client.get("/pm-management/programs", params={"assignee_id": TECH_A}).json()["data"]
    assert [s["name"] for s in mine] == ["PM 1"] and mine[0]["assignee_name"] == "Ana Technician"
    broken = client.get("/pm-management/programs", params={"missing_checklist": True}).json()["data"]
    assert {s["name"] for s in broken} == {"PM 1", "PM 2", "PM 3"}                      # unassigned counts as needing a procedure
    flagged = {s["name"]: s["checklist_issue"] for s in everything["data"]}
    assert flagged["PM 3"] is True and flagged["PM 2"] is False                         # a missing template is an issue; never configured is not
    assert client.get("/pm-management/programs", params={"q": "unit 2"}).json()["meta"]["total"] == 1
    page = client.get("/pm-management/programs", params={"limit": 1, "offset": 1}).json()
    assert len(page["data"]) == 1 and page["meta"]["has_more"] is True


# --- workload ----------------------------------------------------------------

def test_workload_counts_only_current_assignments_and_never_hides_ineligible_assignees(monkeypatch):
    lapsed = schedule(3, due=48, assigned_to=TECH_A, assigned_for_due_at=iso(-500))
    db = _Db(**base_tables(
        pm_schedules=[assigned(1, TECH_A, due=-2), assigned(2, TECH_A, due=48), lapsed, assigned(4, "gone", due=5)],
        pm_completion_records=[
            {"tenant_id": TENANT, "technician_id": TECH_A, "completed_at": iso(-0.5)},
            {"tenant_id": TENANT, "technician_id": TECH_B, "completed_at": iso(-48 * 10)},
            {"tenant_id": OTHER_TENANT, "technician_id": TECH_A, "completed_at": iso(-0.5)},
        ],
    ))
    body = make_client(monkeypatch, db).get("/pm-management/workload", params={"period": "week"}).json()
    cards = {c["id"]: c for c in body["data"]}
    assert cards[TECH_A]["assigned"] == 2 and cards[TECH_A]["overdue"] == 1     # the lapsed assignment is not counted
    assert cards[TECH_B]["assigned"] == 0
    assert "gone" in cards and cards["gone"]["ineligible"] is True and cards["gone"]["assigned"] == 1
    assert body["meta"]["unassigned_schedules"] == 1
    assert "hk-1" not in cards and "far" not in cards


# --- performance -------------------------------------------------------------

def test_performance_classifies_only_recorded_deadlines_and_never_guesses(monkeypatch):
    tz = ZoneInfo("America/Chicago")
    moment = local_midnight_utc(local_today(tz, NOW), tz) + timedelta(hours=12)   # noon today, hotel-local: inside every period
    def completion(n, completed, due, **over):
        row = {"id": f"c{n}", "tenant_id": TENANT, "pm_schedule_id": "s", "asset_id": "a-1", "technician_id": TECH_A,
               "completed_at": completed.isoformat(), "due_at": due.isoformat() if due else None, "defects": [],
               "pm_completion_items": [{"result": "passed"}]}
        row.update(over)
        return row
    db = _Db(**base_tables(
        pm_schedules=[schedule(1, due=-24), schedule(2, due=24 * 3)],
        pm_completion_records=[
            completion(1, moment, moment + timedelta(hours=1)),                                   # on time
            completion(2, moment, moment - timedelta(hours=1)),                                   # late
            completion(3, moment, None),                                                          # before deadline capture
            completion(4, moment, moment, pm_completion_items=[{"result": "failed"}]),            # on time, with a finding
            completion(5, moment, moment, tenant_id=OTHER_TENANT),                                # another property
        ],
        pm_deferral_decisions=[],
    ))
    body = make_client(monkeypatch, db).get("/pm-management/performance", params={"period": "month"})
    data = body.json()["data"]
    assert data["completed_total"] == 4
    assert (data["completed_on_time"], data["completed_late"], data["no_recorded_deadline"]) == (2, 1, 1)
    assert data["inspections_with_findings"] == 1
    assert data["on_time_rate"] == pytest.approx(2 / 3, abs=1e-3)
    assert data["rate_basis"] == {"numerator": 2, "denominator": 3}
    assert data["still_overdue"] == 1 and data["upcoming_7_days"] == 1


def test_performance_rate_is_null_without_classified_completions(monkeypatch):
    db = _Db(**base_tables(pm_schedules=[]))
    data = make_client(monkeypatch, db).get("/pm-management/performance").json()["data"]
    assert data["on_time_rate"] is None and data["completed_total"] == 0


# --- criticality -------------------------------------------------------------

def _asset(**over):
    row = {"id": "00000000-0000-4000-8000-0000000000aa", "tenant_id": TENANT, "name": "Boiler", "is_active": True,
           "criticality": "medium", "row_version": 3}
    row.update(over)
    return row


def test_criticality_change_is_audited_versioned_and_manager_only(monkeypatch):
    db = _Db(**base_tables(assets=[_asset()]))
    url = "/assets/00000000-0000-4000-8000-0000000000aa/criticality"
    assert make_client(monkeypatch, db, role="engineer", user_id=TECH_A).put(url, json={"criticality": "high"}).status_code == 403
    client = make_client(monkeypatch, db)
    stale = client.put(url, json={"criticality": "high", "expected_row_version": 2})
    assert stale.status_code == 409 and db.tables["assets"][0]["criticality"] == "medium"
    ok = client.put(url, json={"criticality": "life_safety", "reason": "Heats the whole building", "expected_row_version": 3})
    assert ok.status_code == 200 and ok.json()["meta"]["changed"] is True
    assert db.tables["assets"][0]["criticality"] == "life_safety" and db.tables["assets"][0]["row_version"] == 4
    audit = db.tables["operational_audit_events"][-1]
    assert audit["action"] == "asset.criticality_changed" and audit["actor_id"] == CHIEF
    assert audit["old_state"] == {"criticality": "medium"} and audit["reason_note"] == "Heats the whole building"
    same = client.put(url, json={"criticality": "life_safety"})
    assert same.json()["meta"]["changed"] is False and len(db.tables["operational_audit_events"]) == 1


def test_criticality_rejects_unknown_values_retired_and_foreign_assets(monkeypatch):
    db = _Db(**base_tables(assets=[
        _asset(),
        _asset(id="00000000-0000-4000-8000-0000000000bb", is_active=False),
        _asset(id="00000000-0000-4000-8000-0000000000cc", tenant_id=OTHER_TENANT),
    ]))
    client = make_client(monkeypatch, db)
    assert client.put("/assets/00000000-0000-4000-8000-0000000000aa/criticality", json={"criticality": "critical"}).status_code == 422
    assert client.put("/assets/00000000-0000-4000-8000-0000000000bb/criticality", json={"criticality": "high"}).status_code == 409
    assert client.put("/assets/00000000-0000-4000-8000-0000000000cc/criticality", json={"criticality": "high"}).status_code == 404


# --- schedule edit version guard ----------------------------------------------

def test_schedule_patch_refuses_a_stale_version_and_bumps_the_version(monkeypatch):
    db = _Db(**base_tables(pm_schedules=[schedule(1, row_version=4)]))
    client = make_client(monkeypatch, db)
    url = "/assets/pm-schedules/00000000-0000-4000-8000-000000000001"
    stale = client.patch(url, json={"name": "Renamed", "expected_version": 3})
    assert stale.status_code == 409 and stale.json()["detail"]["current_version"] == 4
    assert db.tables["pm_schedules"][0]["name"] == "PM 1"
    ok = client.patch(url, json={"name": "Renamed", "expected_version": 4})
    assert ok.status_code == 200 and db.tables["pm_schedules"][0]["row_version"] == 5
    assert client.patch(url, json={"name": "x", "expected_version": 0}).status_code == 422
