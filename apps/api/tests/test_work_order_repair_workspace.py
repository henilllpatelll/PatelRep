"""Read contracts the mobile repair workspace depends on: the detail row's enrichment and the audit timeline."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from middleware.auth import CurrentUser, get_current_user
from routers import work_orders as work_orders_router
from tests.test_work_order_list_queue import TENANT, ME, OTHER, _Db, _Query, _iso, _wo


class _MaybeSingleQuery(_Query):
    """The shared in-memory query plus `maybe_single`, which the timing guard uses."""

    def maybe_single(self):
        self.single = True
        return self

    def execute(self):
        result = super().execute()
        if getattr(self, "single", False):
            return type("Result", (), {"data": result.data[0] if result.data else None})()
        return result


class _SingleDb(_Db):
    def table(self, name):
        return _MaybeSingleQuery(self, name)


def _client(monkeypatch, db, role="engineer", user_id=ME):
    monkeypatch.setattr(work_orders_router, "supabase", db)
    app = FastAPI()
    app.include_router(work_orders_router.router)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        user_id=user_id, hotel_id=TENANT, role=role, email="x@example.com"
    )
    return TestClient(app)


def _audit(resource_id, action, minute, **over):
    row = {
        "id": f"a-{minute}",
        "tenant_id": TENANT,
        "resource_type": "work_order",
        "resource_id": resource_id,
        "action": action,
        "actor_id": ME,
        "actor_role": "engineer",
        "old_state": {},
        "new_state": {},
        "reason_code": None,
        "reason_note": None,
        "created_at": _iso(minute),
    }
    row.update(over)
    return row


def test_detail_carries_hold_reason_and_assignee_name(monkeypatch):
    db = _SingleDb(
        work_orders=[_wo(1, status="on_hold", assigned_to=ME)],
        user_profiles=[{"id": ME, "tenant_id": TENANT, "full_name": "Eli Park", "preferred_name": None}],
        operational_audit_events=[
            _audit("wo-0001", "work_order.transitioned", 5, new_state={"status": "on_hold"}, reason_code="awaiting_parts")
        ],
    )
    response = _client(monkeypatch, db).get("/work-orders/wo-0001")
    assert response.status_code == 200, response.text
    body = response.json()
    row = body["data"]
    assert row["assigned_to_name"] == "Eli Park"
    assert row["hold_reason_code"] == "awaiting_parts"
    assert row["held_since"] == _iso(5)


def test_audit_timeline_is_ordered_scoped_and_attributed(monkeypatch):
    db = _SingleDb(
        work_orders=[_wo(1, status="in_progress", assigned_to=ME), _wo(2, status="in_progress", assigned_to=ME)],
        user_profiles=[{"id": ME, "tenant_id": TENANT, "full_name": "Eli Park", "preferred_name": "Eli"}],
        operational_audit_events=[
            _audit("wo-0001", "work_order.transitioned", 9, new_state={"status": "escalated"}, reason_note="Needs the vendor"),
            _audit("wo-0001", "work_order.diagnosis_updated", 3, new_state={"problem_other_text": "No cooling"}),
            _audit("wo-0002", "work_order.transitioned", 4, new_state={"status": "on_hold"}),
        ],
    )
    response = _client(monkeypatch, db).get("/work-orders/wo-0001/audit")
    assert response.status_code == 200, response.text
    rows = response.json()["data"]
    # Chronological, only this work order's own rows, with the actor's preferred name.
    assert [r["action"] for r in rows] == ["work_order.diagnosis_updated", "work_order.transitioned"]
    assert rows[1]["reason_note"] == "Needs the vendor"
    assert {r["actor_name"] for r in rows} == {"Eli"}


def test_audit_is_refused_for_an_order_assigned_to_a_colleague(monkeypatch):
    db = _SingleDb(work_orders=[_wo(1, status="in_progress", assigned_to=OTHER)])
    assert _client(monkeypatch, db).get("/work-orders/wo-0001/audit").status_code == 403
