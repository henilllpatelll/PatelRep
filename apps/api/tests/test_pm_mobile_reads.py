"""Read contracts the mobile PM experience depends on: property-wide completion history and the template list."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from middleware.auth import CurrentUser, get_current_user
from routers import assets as assets_router
from routers import programs as programs_router
from tests.test_work_order_list_queue import TENANT, ME, _Db, _Query, _iso


class _Q(_Query):
    def maybe_single(self):
        self.single = True
        return self


class _TestDb(_Db):
    def table(self, name):
        return _Q(self, name)


def _client(monkeypatch, db, role="engineer"):
    monkeypatch.setattr(assets_router, "supabase", db)
    monkeypatch.setattr(programs_router, "supabase", db)
    app = FastAPI()
    app.include_router(assets_router.router)
    app.include_router(programs_router.router)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        user_id=ME, hotel_id=TENANT, role=role, email="x@example.com"
    )
    return TestClient(app)


def _completion(n, tenant=TENANT, **over):
    row = {
        "id": f"c-{n}",
        "tenant_id": tenant,
        "pm_schedule_id": "s-1",
        "asset_id": "a-1",
        "technician_id": ME,
        "completed_at": _iso(n),
        "checklist_template_id": "t-1",
        "checklist_version": 2,
        "labor_minutes": 15,
        "defects": [],
        "pm_completion_items": [{"result": "passed"}, {"result": "failed"}, {"result": "not_applicable"}],
    }
    row.update(over)
    return row


def _db(completions):
    return _TestDb(
        pm_completion_records=completions,
        pm_schedules=[{"id": "s-1", "tenant_id": TENANT, "name": "HVAC filter"}],
        assets=[{"id": "a-1", "tenant_id": TENANT, "name": "AHU-02"}],
        user_profiles=[{"id": ME, "tenant_id": TENANT, "full_name": "Eli Park", "preferred_name": "Eli"}],
    )


def test_history_is_newest_first_scoped_and_summarised(monkeypatch):
    db = _db([_completion(1), _completion(3), _completion(2, tenant="other-hotel")])
    response = _client(monkeypatch, db).get("/assets/pm-completions")
    assert response.status_code == 200, response.text
    body = response.json()
    assert [r["id"] for r in body["data"]] == ["c-3", "c-1"]
    first = body["data"][0]
    assert (first["passed_count"], first["failed_count"], first["not_applicable_count"]) == (1, 1, 1)
    assert first["schedule_name"] == "HVAC filter"
    assert first["asset_name"] == "AHU-02"
    assert first["technician_name"] == "Eli"
    assert "pm_completion_items" not in first
    assert body["meta"]["has_more"] is False


def test_history_pages_and_reports_more(monkeypatch):
    db = _db([_completion(n) for n in range(1, 6)])
    client = _client(monkeypatch, db)
    page = client.get("/assets/pm-completions?limit=2&offset=0").json()
    assert [r["id"] for r in page["data"]] == ["c-5", "c-4"]
    assert page["meta"]["has_more"] is True
    last = client.get("/assets/pm-completions?limit=2&offset=4").json()
    assert [r["id"] for r in last["data"]] == ["c-1"]
    assert last["meta"]["has_more"] is False


def test_history_can_be_limited_to_one_asset(monkeypatch):
    db = _db([_completion(1), _completion(2, asset_id="a-2")])
    rows = _client(monkeypatch, db).get("/assets/pm-completions?asset_id=a-2").json()["data"]
    assert [r["id"] for r in rows] == ["c-2"]


def test_templates_are_engineering_active_and_tenant_scoped(monkeypatch):
    base = {"tenant_id": TENANT, "is_active": True, "program_area": "engineering", "version": 3}
    db = _TestDb(pm_checklist_templates=[
        {**base, "id": "t-1", "name": "Boiler"},
        {**base, "id": "t-2", "name": "Linen", "program_area": "housekeeping"},
        {**base, "id": "t-3", "name": "Old", "is_active": False},
        {**base, "id": "t-4", "name": "Elsewhere", "tenant_id": "other-hotel"},
    ])
    rows = _client(monkeypatch, db).get("/programs/pm-templates").json()["data"]
    assert [r["id"] for r in rows] == ["t-1"]


def test_templates_are_refused_to_housekeepers(monkeypatch):
    db = _TestDb(pm_checklist_templates=[])
    assert _client(monkeypatch, db, role="housekeeper").get("/programs/pm-templates").status_code == 403
