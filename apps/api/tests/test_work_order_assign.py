"""POST /work-orders/{id}/assign - the chief engineer's server-authoritative assignment.

Chief engineers cannot claim or transition, so this is their one write on a work order. The contract:
tenant and role are enforced on the server, the change applies only when the order still has the assignee the
caller saw (a conditional update, so two managers never silently overwrite each other), closed orders are
refused, audit history is appended, and the new assignee is told exactly once.
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
WO = "wo-1"


def _db(**wo_over):
    wo = {"id": WO, "tenant_id": H1, "title": "Sink leaking", "status": "open", "priority": "urgent",
          "assigned_to": None, "work_order_number": 1042}
    wo.update(wo_over)
    return FakeDB({
        "work_orders": [wo, {**wo, "id": "wo-h2", "tenant_id": H2}],
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
async def test_losing_a_race_between_check_and_write_is_a_conflict(monkeypatch, pushes):
    db = _install(monkeypatch, _db())
    real = db.table

    def racing_table(name):
        query = real(name)
        if name == "work_orders" and getattr(db, "_armed", False):
            db.rows["work_orders"][0]["assigned_to"] = ENG_B  # another manager wins between our read and write
        return query

    original_execute = None
    # arm the race only for the conditional update: flip the assignee just before it runs
    from tests.smoke import fake_supabase as fs

    original_execute = fs.FakeQuery.execute

    def execute(self):
        if self.table_name == "work_orders" and self.action == "update":
            db.rows["work_orders"][0]["assigned_to"] = ENG_B
        return original_execute(self)

    monkeypatch.setattr(fs.FakeQuery, "execute", execute)
    with pytest.raises(HTTPException) as err:
        await _assign(ENG_A, expected=None)
    assert err.value.status_code == 409
    assert db.rows["work_orders"][0]["assigned_to"] == ENG_B
    assert not db.rows["operational_audit_events"] and not pushes


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
        await _assign(ENG_A, wo_id="wo-h2")
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
