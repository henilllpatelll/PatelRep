"""POST /work-orders/{id}/assign - the chief engineer's server-authoritative assignment.

Chief engineers cannot claim or transition, so this is their one write on a work order. The contract:
tenant and role are enforced on the server, the change applies only when the order still has the assignee the
caller saw (a conditional update, so two managers never silently overwrite each other), closed orders are
refused, audit history is appended, and the new assignee is told exactly once.

Since H2 the rules live in ONE database operation, ``work_order_assign_apply`` (migration 242), shared with the Agent
Harness Tool Gateway. These route tests use a faithful in-memory double of that RPC to pin the route's own contract
(HTTP mapping, actor/source passed, notifications). The real SQL -- including the check-then-write race that is now
closed by a row lock -- is exercised against PostgreSQL in tests/integration/test_agent_gateway_work_order_assign.py.
"""
import asyncio
import uuid

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from middleware.auth import CurrentUser, get_current_user
from models.requests import AssignWorkOrderRequest
from routers import work_orders as wo_router
from tests.smoke.fake_supabase import FakeDB

H1, H2 = "hotel-1", "hotel-2"
CHIEF = CurrentUser(user_id="chief-1", hotel_id=H1, role="chief_engineer", email="c@h.com")
GM = CurrentUser(user_id="gm-1", hotel_id=H1, role="gm", email="g@h.com")
ENG_A, ENG_B, ENG_OTHER_HOTEL, HK = (str(uuid.uuid4()) for _ in range(4))
WO = "5a0e5a0e-0000-4000-8000-000000000001"
WO_H2 = "5a0e5a0e-0000-4000-8000-000000000002"
ASSIGNABLE = ("open", "escalated", "in_progress", "on_hold")


class _AssignDB(FakeDB):
    """FakeDB plus an in-memory double of the work_order_assign_apply RPC (same outcomes as the SQL)."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.rpc_calls = []

    def rpc(self, name, params):
        assert name == "work_order_assign_apply", name
        self.rpc_calls.append(params)
        db = self

        class _Call:
            def execute(self_inner):
                return type("R", (), {"data": db._apply(params)})()

        return _Call()

    def _apply(self, p):
        wo = next((w for w in self.rows["work_orders"]
                   if w["id"] == p["p_work_order_id"] and w["tenant_id"] == p["p_tenant_id"]), None)
        if wo is None:
            return {"outcome": "not_found"}
        if wo["status"] not in ASSIGNABLE:
            return {"outcome": "closed", "status": wo["status"]}
        if not any(r["tenant_id"] == p["p_tenant_id"] and r["user_id"] == p["p_assignee_user_id"]
                   and r["role"] == "engineer" and r["is_active"] for r in self.rows["user_roles"]):
            return {"outcome": "assignee_not_eligible"}
        view = {k: wo[k] for k in ("id", "title", "status", "priority", "assigned_to", "work_order_number")}
        previous = wo["assigned_to"]
        if previous == p["p_assignee_user_id"]:
            return {"outcome": "unchanged", "work_order": view}
        if previous != p["p_expected_assigned_to"]:
            return {"outcome": "stale"}
        wo["assigned_to"] = p["p_assignee_user_id"]
        self.rows["operational_audit_events"].append({
            "tenant_id": p["p_tenant_id"], "resource_type": "work_order", "resource_id": wo["id"],
            "action": "work_order.reassigned" if previous else "work_order.assigned", "actor_id": p["p_actor_id"],
            "actor_role": p["p_actor_role"], "old_state": {"assigned_to": previous},
            "new_state": {"assigned_to": p["p_assignee_user_id"]}, "reason_note": p["p_reason_note"],
            "reason_code": p["p_reason_code"], "source": p["p_source"]})
        return {"outcome": "reassigned" if previous else "assigned", "previous_assigned_to": previous,
                "work_order": {**view, "assigned_to": wo["assigned_to"]}}


def _db(**wo_over):
    wo = {"id": WO, "tenant_id": H1, "title": "Sink leaking", "status": "open", "priority": "urgent",
          "assigned_to": None, "work_order_number": 1042}
    wo.update(wo_over)
    return _AssignDB({
        "work_orders": [wo, {**wo, "id": WO_H2, "tenant_id": H2}],
        "user_roles": [
            {"tenant_id": H1, "user_id": ENG_A, "role": "engineer", "is_active": True},
            {"tenant_id": H1, "user_id": ENG_B, "role": "engineer", "is_active": True},
            {"tenant_id": H1, "user_id": HK, "role": "housekeeper", "is_active": True},
            {"tenant_id": H2, "user_id": ENG_OTHER_HOTEL, "role": "engineer", "is_active": True},
        ],
        "notifications": [], "operational_audit_events": [],
    })


@pytest.fixture
def pushes(monkeypatch):
    sent = []

    async def fake_push(**kwargs):
        sent.append(kwargs)
        return {}

    monkeypatch.setattr(wo_router, "send_push", fake_push)
    return sent


def _install(monkeypatch, db):
    monkeypatch.setattr(wo_router, "supabase", db)
    return db


def _body(to, expected=None, note=None):
    return AssignWorkOrderRequest(assigned_to=to, expected_assigned_to=expected, note=note)


async def _assign(to, expected=None, user=CHIEF, wo_id=WO, note=None):
    result = await wo_router.assign_work_order(wo_id, _body(to, expected, note), user)
    await asyncio.sleep(0)  # let the fire-and-forget push run
    return result


@pytest.mark.asyncio
async def test_assigns_unassigned_order_records_audit_and_notifies_once(monkeypatch, pushes):
    db = _install(monkeypatch, _db())
    result = await _assign(ENG_A, note="Closest to 4th floor")
    assert result["data"]["changed"] is True
    assert db.rows["work_orders"][0]["assigned_to"] == ENG_A
    assert db.rows["work_orders"][0]["status"] == "open"  # assigning never starts the work
    [event] = db.rows["operational_audit_events"]
    assert event["action"] == "work_order.assigned" and event["actor_id"] == CHIEF.user_id
    assert event["old_state"] == {"assigned_to": None} and event["new_state"] == {"assigned_to": ENG_A}
    assert event["reason_note"] == "Closest to 4th floor"
    [inbox] = db.rows["notifications"]
    assert (inbox["user_id"], inbox["type"], inbox["data"]["url"]) == (ENG_A, "wo_assignment", f"/(app)/work-orders/{WO}")
    assert [p["recipient_ids"] for p in pushes] == [[ENG_A]]
    assert pushes[0]["notification_ids"] == {ENG_A: inbox["id"]}


@pytest.mark.asyncio
async def test_reassign_with_current_assignee_moves_it_and_tells_the_previous_engineer(monkeypatch, pushes):
    db = _install(monkeypatch, _db(assigned_to=ENG_A, status="in_progress"))
    await _assign(ENG_B, expected=ENG_A)
    assert db.rows["work_orders"][0]["assigned_to"] == ENG_B
    assert db.rows["operational_audit_events"][0]["action"] == "work_order.reassigned"
    types = {(n["user_id"], n["type"]) for n in db.rows["notifications"]}
    assert types == {(ENG_B, "wo_assignment"), (ENG_A, "wo_reassigned")}
    assert [p["recipient_ids"] for p in pushes] == [[ENG_B]]  # the previous assignee gets an inbox row, not a push
    away = next(n for n in db.rows["notifications"] if n["type"] == "wo_reassigned")
    assert "url" not in away["data"]  # they can no longer open the order, so the row must not link to it


@pytest.mark.asyncio
async def test_a_stale_view_is_refused_and_nothing_changes(monkeypatch, pushes):
    db = _install(monkeypatch, _db(assigned_to=ENG_B))
    with pytest.raises(HTTPException) as err:
        await _assign(ENG_A, expected=None)  # the caller saw it unassigned; someone else assigned ENG_B first
    assert err.value.status_code == 409
    assert db.rows["work_orders"][0]["assigned_to"] == ENG_B
    assert not db.rows["operational_audit_events"] and not db.rows["notifications"] and not pushes


@pytest.mark.asyncio
async def test_the_route_delegates_to_the_shared_locked_operation_and_never_writes_the_order_itself(monkeypatch, pushes):
    """The check-then-write race is closed in the database (row lock in work_order_assign_apply); the route must not
    reintroduce it with its own read or update of work_orders."""
    db = _install(monkeypatch, _db())
    await _assign(ENG_A, note="n")
    [call] = db.rpc_calls
    assert call["p_tenant_id"] == H1 and call["p_work_order_id"] == WO and call["p_assignee_user_id"] == ENG_A
    assert call["p_expected_assigned_to"] is None and call["p_actor_id"] == CHIEF.user_id
    assert call["p_actor_role"] == "chief_engineer" and call["p_source"] == "api" and call["p_reason_note"] == "n"
    assert not [table for table, _ in db.updates if table == "work_orders"]
    assert not [table for table, _ in db.select_calls if table == "work_orders"]


@pytest.mark.asyncio
async def test_a_malformed_work_order_id_is_not_found_without_reaching_the_database(monkeypatch, pushes):
    db = _install(monkeypatch, _db())
    with pytest.raises(HTTPException) as err:
        await _assign(ENG_A, wo_id="wo-1")
    assert err.value.status_code == 404 and not db.rpc_calls


@pytest.mark.asyncio
async def test_assigning_to_the_current_assignee_is_a_quiet_success(monkeypatch, pushes):
    db = _install(monkeypatch, _db(assigned_to=ENG_A))
    result = await _assign(ENG_A, expected=None)  # a double tap, or another manager already did this
    assert result["data"]["changed"] is False
    assert not db.rows["operational_audit_events"] and not db.rows["notifications"] and not pushes


@pytest.mark.asyncio
async def test_the_assignee_is_not_alerted_twice_for_the_same_unread_assignment(monkeypatch, pushes):
    db = _install(monkeypatch, _db())
    await _assign(ENG_A)
    await _assign(ENG_B, expected=ENG_A)
    await _assign(ENG_A, expected=ENG_B)  # back to A while A's first alert is still unread
    mine = [n for n in db.rows["notifications"] if n["user_id"] == ENG_A and n["type"] == "wo_assignment"]
    assert len(mine) == 1
    assert [p["recipient_ids"] for p in pushes] == [[ENG_A], [ENG_B]]


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["completed", "cancelled"])
async def test_closed_orders_cannot_be_assigned(monkeypatch, pushes, status):
    db = _install(monkeypatch, _db(status=status))
    with pytest.raises(HTTPException) as err:
        await _assign(ENG_A)
    assert err.value.status_code == 409
    assert db.rows["work_orders"][0]["assigned_to"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("target", [HK, ENG_OTHER_HOTEL, str(uuid.uuid4())])
async def test_only_active_engineers_of_this_hotel_can_be_assigned(monkeypatch, pushes, target):
    db = _install(monkeypatch, _db())
    with pytest.raises(HTTPException) as err:
        await _assign(target)
    assert err.value.status_code == 422
    assert db.rows["work_orders"][0]["assigned_to"] is None


@pytest.mark.asyncio
async def test_a_deactivated_engineer_is_not_assignable(monkeypatch, pushes):
    db = _install(monkeypatch, _db())
    db.rows["user_roles"][0]["is_active"] = False
    with pytest.raises(HTTPException) as err:
        await _assign(ENG_A)
    assert err.value.status_code == 422


@pytest.mark.asyncio
async def test_another_hotels_order_is_not_found(monkeypatch, pushes):
    _install(monkeypatch, _db())
    with pytest.raises(HTTPException) as err:
        await _assign(ENG_A, wo_id=WO_H2)
    assert err.value.status_code == 404


@pytest.mark.asyncio
async def test_a_gm_may_assign_too(monkeypatch, pushes):
    db = _install(monkeypatch, _db())
    await _assign(ENG_A, user=GM)
    assert db.rows["work_orders"][0]["assigned_to"] == ENG_A


def _client(monkeypatch, role):
    monkeypatch.setattr(wo_router, "supabase", _db())
    app = FastAPI()
    app.include_router(wo_router.router)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(user_id="u-1", hotel_id=H1, role=role, email="x@h.com")
    return TestClient(app)


@pytest.mark.parametrize("role", ["engineer", "housekeeper", "housekeeping_supervisor", "front_desk"])
def test_only_chief_engineer_and_gm_reach_the_endpoint(monkeypatch, role):
    response = _client(monkeypatch, role).post(f"/work-orders/{WO}/assign", json={"assigned_to": ENG_A, "expected_assigned_to": None})
    assert response.status_code == 403


def test_the_expected_assignee_must_be_stated(monkeypatch):
    response = _client(monkeypatch, "chief_engineer").post(f"/work-orders/{WO}/assign", json={"assigned_to": ENG_A})
    assert response.status_code == 422
