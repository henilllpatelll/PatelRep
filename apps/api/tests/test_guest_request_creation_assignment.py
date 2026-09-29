"""POST /guest-requests now accepts assigned_to (Tasks Phase 5): assignment for
a guest request is written to its auto-created linked task, never to a
frontend-only field on guest_requests itself — see taskNextAction.ts's
"assignment is always written to the backing Task" contract. Mirrors the
FakeDB + real-JWT TestClient harness in test_guest_request_work_order_bridge.py.
"""

from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from main import app
from routers import guest_requests as guest_requests_router
from tests.smoke.fake_supabase import FakeDB


def _auth_header(role: str = "front_desk", hotel_id: str = "hotel-a", user_id: str = "user-a-1") -> dict[str, str]:
    payload = {"sub": user_id, "role": role, "hotel_id": hotel_id, "aud": "authenticated"}
    token = jwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


ROOM_ID = "c796256e-f3c9-4f98-98a9-1427d9861c02"
STAFF_ID = "e2e49a60-b584-41b9-93b1-430f8bc6167b"
OUTSIDE_STAFF_ID = "412e6065-040e-454d-b91d-191b31d54cbd"


def _base_rows(**overrides) -> dict:
    rows = {
        "guest_request_sla_policies": [],
        "guest_requests": [],
        "tasks": [],
        "user_roles": [
            {"tenant_id": "hotel-a", "user_id": STAFF_ID, "role": "housekeeper", "is_active": True},
        ],
    }
    rows.update(overrides)
    return rows


def _client(db: FakeDB) -> TestClient:
    guest_requests_router.supabase = db
    return TestClient(app)


def test_create_guest_request_assigns_the_linked_task():
    db = FakeDB(_base_rows())
    client = _client(db)

    response = client.post(
        "/v1/guest-requests",
        json={"title": "Extra towels", "room_id": ROOM_ID, "assigned_to": STAFF_ID},
        headers=_auth_header(),
    )

    assert response.status_code == 200, response.text
    assert len(db.rows["tasks"]) == 1
    task = db.rows["tasks"][0]
    assert task["assigned_to"] == STAFF_ID
    assert task["assigned_by"] == "user-a-1"


def test_create_guest_request_rejects_assignee_outside_tenant():
    db = FakeDB(_base_rows(user_roles=[]))
    client = _client(db)

    response = client.post(
        "/v1/guest-requests",
        json={"title": "Extra towels", "room_id": ROOM_ID, "assigned_to": OUTSIDE_STAFF_ID},
        headers=_auth_header(),
    )

    assert response.status_code == 404
    assert db.rows["tasks"] == []
    assert db.rows["guest_requests"] == []


def test_create_guest_request_without_assigned_to_leaves_task_unassigned():
    db = FakeDB(_base_rows())
    client = _client(db)

    response = client.post(
        "/v1/guest-requests",
        json={"title": "Extra towels", "room_id": ROOM_ID},
        headers=_auth_header(),
    )

    assert response.status_code == 200, response.text
    assert db.rows["tasks"][0]["assigned_to"] is None
    assert db.rows["tasks"][0]["assigned_by"] is None
