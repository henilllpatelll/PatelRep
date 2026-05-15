"""
Tenant isolation smoke-tests.

Two "hotels" are simulated in FakeMultiTenantDB:
  - Hotel B: seeded with rooms, tasks, work orders, SOPs, guest requests, etc.
  - Hotel A: no seeded data at all.

Every test authenticates as a Hotel A GM (USER_A) and asserts that
attempting to access a Hotel B resource ID always yields an empty list, a
404 exception, or a silent no-op — never Hotel B's data.

Coverage:
  rooms / room_status / tasks / work_orders / staff / guest_requests /
  lost_found / logbook / sop_documents / billing subscriptions
"""
from types import SimpleNamespace
from datetime import date
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from main import app
from middleware.auth import CurrentUser
from models.requests import (
    BulkShiftAssignmentItem,
    BulkShiftAssignmentRequest,
    CreateAssignmentsRequest,
    CreateShiftAssignmentRequest,
    CreateShiftRequest,
    CreateTaskRequest,
    CreateWorkOrderRequest,
    RoomAssignmentItem,
    UpdateRoomStatusRequest,
    UpdateTaskRequest,
    UpdateWorkOrderRequest,
)
from routers import rooms as rooms_router
from routers import tasks as tasks_router
from routers import work_orders as wo_router
from routers import staff as staff_router
from routers import guest_requests as gr_router
from routers import lost_found as lf_router
from routers import logbook as logbook_router
from routers import billing as billing_router
from routers import sop as sop_router
from routers import housekeeping as housekeeping_router
from routers import scheduling as scheduling_router


# ---------------------------------------------------------------------------
# Test principals
# ---------------------------------------------------------------------------

USER_A = CurrentUser(user_id="user-a-1", hotel_id="hotel-a", role="gm", email="gm@hotel-a.com")
ENGINEER_A = CurrentUser(user_id="engineer-a-1", hotel_id="hotel-a", role="engineer", email="eng@hotel-a.com")
ROOM_B_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
DEPT_B_UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
STAFF_B_UUID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
ASSET_B_UUID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
SHIFT_B_UUID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"


def _auth_header(role: str = "gm", hotel_id: str | None = "hotel-a", user_id: str = "user-a-1") -> dict[str, str]:
    payload = {
        "sub": user_id,
        "role": role,
        "email": f"{role}@example.com",
        "aud": "authenticated",
    }
    if hotel_id is not None:
        payload["hotel_id"] = hotel_id
    token = jwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# In-memory multi-tenant database stub
# ---------------------------------------------------------------------------

class _FakeAdminAuth:
    def __init__(self):
        self.invites = []

    def list_users(self):
        return []

    def invite_user_by_email(self, email, options=None):
        self.invites.append((email, options or {}))
        return SimpleNamespace(user=SimpleNamespace(id="invited-user"))


class _FakeAuth:
    admin = _FakeAdminAuth()


class FakeMultiTenantDB:
    """Supabase stub seeded exclusively with Hotel B data.

    Any query that includes .eq("tenant_id", "hotel-a") finds nothing because
    every seeded row carries tenant_id="hotel-b". Likewise, a cross-tenant
    get-by-id such as .eq("id", "room-b-1").eq("tenant_id", "hotel-a") also
    finds nothing — the compound filter never matches.
    """

    auth = _FakeAuth()

    def __init__(self):
        self._rows: dict[str, list[dict]] = {
            "rooms": [
                {
                    "id": "room-b-1",
                    "tenant_id": "hotel-b",
                    "room_number": "101",
                    "floor": 1,
                    "room_type_id": "rt-1",
                },
                {
                    "id": ROOM_B_UUID,
                    "tenant_id": "hotel-b",
                    "room_number": "102",
                    "floor": 1,
                    "room_type_id": "rt-1",
                },
            ],
            "room_status": [
                {
                    "id": "rs-b-1",
                    "room_id": "room-b-1",
                    "tenant_id": "hotel-b",
                    "status": "DIRTY",
                    "updated_at": "2026-01-01T00:00:00+00:00",
                },
            ],
            "room_status_history": [],
            "room_types": [],
            "housekeeper_profiles": [],
            "tasks": [
                {
                    "id": "task-b-1",
                    "tenant_id": "hotel-b",
                    "title": "Hotel B Task",
                    "status": "open",
                    "priority": "normal",
                },
            ],
            "task_comments": [],
            "work_orders": [
                {
                    "id": "wo-b-1",
                    "tenant_id": "hotel-b",
                    "title": "Hotel B WO",
                    "status": "open",
                    "priority": "normal",
                },
            ],
            "work_order_comments": [],
            "work_order_photos": [],
            "sop_documents": [
                {
                    "id": "sop-b-1",
                    "tenant_id": "hotel-b",
                    "title": "Hotel B SOP",
                    "created_at": "2026-01-01T00:00:00+00:00",
                },
            ],
            "sop_chunks": [],
            "guest_requests": [
                {
                    "id": "gr-b-1",
                    "tenant_id": "hotel-b",
                    "title": "Hotel B Guest Request",
                    "status": "open",
                    "task_id": "task-b-1",
                },
            ],
            "lost_found_items": [
                {
                    "id": "lf-b-1",
                    "tenant_id": "hotel-b",
                    "description": "Gold watch",
                    "status": "unclaimed",
                    "created_at": "2026-01-01T00:00:00+00:00",
                },
            ],
            "logbook_entries": [
                {
                    "id": "le-b-1",
                    "tenant_id": "hotel-b",
                    "content": "Hotel B shift log",
                    "created_at": "2026-01-01T00:00:00+00:00",
                    "expires_at": None,
                },
            ],
            "user_roles": [
                {
                    "id": "ur-b-1",
                    "tenant_id": "hotel-b",
                    "user_id": "user-b-1",
                    "role": "gm",
                    "is_active": True,
                    "custom_role_id": None,
                    "department_id": None,
                    "created_at": "2026-01-01T00:00:00+00:00",
                },
                {
                    "id": "ur-b-2",
                    "tenant_id": "hotel-b",
                    "user_id": STAFF_B_UUID,
                    "role": "housekeeper",
                    "is_active": True,
                    "custom_role_id": None,
                    "department_id": DEPT_B_UUID,
                    "created_at": "2026-01-01T00:00:00+00:00",
                },
            ],
            "user_profiles": [],
            "subscriptions": [
                {
                    "id": "sub-b-1",
                    "tenant_id": "hotel-b",
                    "stripe_customer_id": "cus_hotel_b",
                    "cap_cents": 25000,
                },
            ],
            "credit_ledger": [],
            "custom_roles": [],
            "staff_role_schedules": [],
            "staff_invitations": [],
            "departments": [
                {
                    "id": DEPT_B_UUID,
                    "tenant_id": "hotel-b",
                    "name": "Hotel B Housekeeping",
                    "code": "HK",
                },
            ],
            "assets": [
                {
                    "id": ASSET_B_UUID,
                    "tenant_id": "hotel-b",
                    "name": "Hotel B PTAC",
                },
            ],
            "shifts": [
                {
                    "id": SHIFT_B_UUID,
                    "tenant_id": "hotel-b",
                    "name": "Hotel B AM",
                },
            ],
            "room_assignments": [],
            "shift_assignments": [],
        }
        # Audit log — test assertions use these to prove no Hotel B mutation occurred
        self.inserts: list[tuple[str, dict]] = []
        self.updates: list[tuple[str, dict, dict]] = []
        self.deletes: list[tuple[str, dict]] = []

    def table(self, name: str) -> "_Q":
        return _Q(self, name)

    # Convenience: snapshot Hotel B row by ID
    def b_row(self, table: str, row_id: str) -> dict | None:
        return next(
            (r for r in self._rows.get(table, []) if r.get("id") == row_id),
            None,
        )


class _Q:
    """Minimal Supabase query builder that applies only .eq() filters."""

    def __init__(self, db: FakeMultiTenantDB, table: str):
        self._db = db
        self._t = table
        self._filters: dict[str, object] = {}
        self._action = "select"
        self._payload: dict = {}
        self._single = False

    # ---- filter chain ----
    def eq(self, col: str, val):
        self._filters[col] = val
        return self

    # These filter types are ignored — not needed for tenant isolation proofs
    def gte(self, *_a, **_k):
        return self

    def lte(self, *_a, **_k):
        return self

    def is_(self, *_a, **_k):
        return self

    def in_(self, *_a, **_k):
        return self

    def or_(self, *_a, **_k):
        return self

    # ---- result shaping ----
    def select(self, *_a, **_k):
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def range(self, *_a, **_k):
        return self

    def maybe_single(self):
        self._single = True
        return self

    def single(self):
        self._single = True
        return self

    # ---- mutations ----
    def insert(self, payload: dict):
        self._action = "insert"
        self._payload = payload
        return self

    def update(self, payload: dict):
        self._action = "update"
        self._payload = payload
        return self

    def upsert(self, payload: dict, **_kw):
        self._action = "insert"
        self._payload = payload
        return self

    def delete(self):
        self._action = "delete"
        return self

    # ---- execute ----
    def _match(self, row: dict) -> bool:
        return all(row.get(c) == v for c, v in self._filters.items())

    def execute(self):
        rows = self._db._rows.get(self._t, [])

        if self._action == "select":
            matched = [r for r in rows if self._match(r)]
            if self._single:
                return SimpleNamespace(data=matched[0] if matched else None)
            return SimpleNamespace(data=matched)

        if self._action == "insert":
            self._db.inserts.append((self._t, self._payload))
            row = {"id": f"new-{len(self._db.inserts)}", **self._payload}
            self._db._rows.setdefault(self._t, []).append(row)
            return SimpleNamespace(data=[row])

        if self._action == "update":
            matched = [r for r in rows if self._match(r)]
            for r in matched:
                r.update(self._payload)
            self._db.updates.append((self._t, self._payload, dict(self._filters)))
            return SimpleNamespace(data=matched)

        if self._action == "delete":
            matched = [r for r in rows if self._match(r)]
            self._db._rows[self._t] = [r for r in rows if not self._match(r)]
            self._db.deletes.append((self._t, dict(self._filters)))
            return SimpleNamespace(data=matched)

        return SimpleNamespace(data=[])


# ===========================================================================
# Rooms
# ===========================================================================


@pytest.mark.asyncio
async def test_rooms_list_returns_empty_for_hotel_a(monkeypatch):
    db = FakeMultiTenantDB()
    monkeypatch.setattr(rooms_router, "supabase", db)

    result = await rooms_router.list_rooms(
        status=None, floor=None, assigned_to=None, risk_level=None,
        include_predictions=False, current_user=USER_A,
    )

    assert result["data"] == []


@pytest.mark.asyncio
async def test_rooms_get_hotel_b_room_raises_404(monkeypatch):
    db = FakeMultiTenantDB()
    monkeypatch.setattr(rooms_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await rooms_router.get_room("room-b-1", current_user=USER_A)

    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_rooms_update_status_hotel_b_raises_404(monkeypatch):
    """Hotel A GM cannot update Hotel B room status — fetch by (room_id + tenant_id) misses."""
    db = FakeMultiTenantDB()
    monkeypatch.setattr(rooms_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await rooms_router.update_room_status(
            "room-b-1",
            UpdateRoomStatusRequest(status="IN_PROGRESS"),
            current_user=USER_A,
        )

    assert exc.value.status_code == 404
    # Hotel B room status is untouched
    assert db.b_row("room_status", "rs-b-1")["status"] == "DIRTY"


@pytest.mark.asyncio
async def test_rooms_add_note_hotel_b_raises_404(monkeypatch):
    db = FakeMultiTenantDB()
    monkeypatch.setattr(rooms_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await rooms_router.add_room_note(
            "room-b-1",
            rooms_router.AddRoomNoteRequest(text="sneaky note"),
            current_user=USER_A,
        )

    assert exc.value.status_code == 404
    assert db._rows["room_status_history"] == []


# ===========================================================================
# Tasks
# ===========================================================================


@pytest.mark.asyncio
async def test_tasks_list_returns_empty_for_hotel_a(monkeypatch):
    db = FakeMultiTenantDB()
    monkeypatch.setattr(tasks_router, "supabase", db)

    result = await tasks_router.list_tasks(
        status=None, task_type=None, priority=None,
        assigned_to=None, room_id=None, page=1, per_page=20,
        current_user=USER_A,
    )

    assert result["data"] == []


@pytest.mark.asyncio
async def test_tasks_create_rejects_cross_tenant_references(monkeypatch):
    db = FakeMultiTenantDB()
    monkeypatch.setattr(tasks_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await tasks_router.create_task(
            CreateTaskRequest(
                title="Inspect room",
                task_type="housekeeping",
                room_id=ROOM_B_UUID,
                department_id=DEPT_B_UUID,
                assigned_to=STAFF_B_UUID,
            ),
            current_user=USER_A,
        )

    assert exc.value.status_code == 404
    assert not [i for i in db.inserts if i[0] == "tasks"]


@pytest.mark.asyncio
async def test_tasks_get_hotel_b_raises_404(monkeypatch):
    db = FakeMultiTenantDB()
    monkeypatch.setattr(tasks_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await tasks_router.get_task("task-b-1", current_user=USER_A)

    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_tasks_update_hotel_b_raises_404_and_leaves_data_intact(monkeypatch):
    db = FakeMultiTenantDB()
    monkeypatch.setattr(tasks_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await tasks_router.update_task(
            "task-b-1",
            UpdateTaskRequest(status="completed"),
            current_user=USER_A,
        )

    assert exc.value.status_code == 404
    # Hotel B task is unchanged
    assert db.b_row("tasks", "task-b-1")["status"] == "open"
    assert db._rows["task_comments"] == []


@pytest.mark.asyncio
async def test_tasks_delete_hotel_b_raises_404_and_leaves_data_intact(monkeypatch):
    db = FakeMultiTenantDB()
    monkeypatch.setattr(tasks_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await tasks_router.delete_task("task-b-1", current_user=USER_A)

    assert exc.value.status_code == 404
    assert db.b_row("tasks", "task-b-1") is not None


# ===========================================================================
# Work Orders
# ===========================================================================


@pytest.mark.asyncio
async def test_work_orders_list_returns_empty_for_hotel_a(monkeypatch):
    db = FakeMultiTenantDB()
    monkeypatch.setattr(wo_router, "supabase", db)

    result = await wo_router.list_work_orders(
        status=None, category=None, priority=None, assigned_to=None,
        page=1, per_page=20, current_user=USER_A,
    )

    assert result["data"] == []


@pytest.mark.asyncio
async def test_work_orders_create_rejects_cross_tenant_references(monkeypatch):
    db = FakeMultiTenantDB()
    monkeypatch.setattr(wo_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await wo_router.create_work_order(
            CreateWorkOrderRequest(
                title="Fix AC",
                category="hvac",
                room_id=ROOM_B_UUID,
                asset_id=ASSET_B_UUID,
                assigned_to=STAFF_B_UUID,
            ),
            current_user=USER_A,
        )

    assert exc.value.status_code == 404
    assert not [i for i in db.inserts if i[0] == "work_orders"]


@pytest.mark.asyncio
async def test_work_orders_get_hotel_b_raises_404(monkeypatch):
    db = FakeMultiTenantDB()
    monkeypatch.setattr(wo_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await wo_router.get_work_order("wo-b-1", current_user=USER_A)

    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_work_orders_claim_hotel_b_raises_404(monkeypatch):
    """claim_work_order pre-checks tenant ownership — cross-tenant claim returns 404."""
    db = FakeMultiTenantDB()
    monkeypatch.setattr(wo_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await wo_router.claim_work_order("wo-b-1", current_user=USER_A)

    assert exc.value.status_code == 404
    assert db.b_row("work_orders", "wo-b-1")["status"] == "open"


@pytest.mark.asyncio
async def test_work_orders_complete_hotel_b_raises_404(monkeypatch):
    """complete_work_order pre-checks tenant ownership — cross-tenant complete returns 404."""
    from models.requests import CompleteWorkOrderRequest
    db = FakeMultiTenantDB()
    monkeypatch.setattr(wo_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await wo_router.complete_work_order(
            "wo-b-1",
            CompleteWorkOrderRequest(notes="done", labor_hours=1.0),
            current_user=USER_A,
        )

    assert exc.value.status_code == 404
    assert db.b_row("work_orders", "wo-b-1")["status"] == "open"


@pytest.mark.asyncio
async def test_work_orders_update_hotel_b_raises_404(monkeypatch):
    db = FakeMultiTenantDB()
    monkeypatch.setattr(wo_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await wo_router.update_work_order(
            "wo-b-1",
            UpdateWorkOrderRequest(priority="urgent"),
            current_user=USER_A,
        )

    assert exc.value.status_code == 404
    assert db.b_row("work_orders", "wo-b-1")["priority"] == "normal"


@pytest.mark.asyncio
async def test_work_orders_delete_hotel_b_raises_404_and_leaves_data_intact(monkeypatch):
    db = FakeMultiTenantDB()
    monkeypatch.setattr(wo_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await wo_router.delete_work_order("wo-b-1", current_user=USER_A)

    assert exc.value.status_code == 404
    assert db.b_row("work_orders", "wo-b-1") is not None


@pytest.mark.asyncio
async def test_engineer_cannot_update_work_order_assigned_to_someone_else(monkeypatch):
    db = FakeMultiTenantDB()
    db._rows["work_orders"].append({
        "id": "wo-a-assigned-other",
        "tenant_id": "hotel-a",
        "title": "Assigned to someone else",
        "status": "in_progress",
        "priority": "normal",
        "assigned_to": "engineer-a-2",
    })
    monkeypatch.setattr(wo_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await wo_router.update_work_order(
            "wo-a-assigned-other",
            UpdateWorkOrderRequest(priority="urgent"),
            current_user=ENGINEER_A,
        )

    assert exc.value.status_code == 403
    assert db.b_row("work_orders", "wo-a-assigned-other")["priority"] == "normal"


@pytest.mark.asyncio
async def test_engineer_can_update_unassigned_open_work_order(monkeypatch):
    db = FakeMultiTenantDB()
    db._rows["work_orders"].append({
        "id": "wo-a-open",
        "tenant_id": "hotel-a",
        "title": "Open work order",
        "status": "open",
        "priority": "normal",
        "assigned_to": None,
    })
    monkeypatch.setattr(wo_router, "supabase", db)

    response = await wo_router.update_work_order(
        "wo-a-open",
        UpdateWorkOrderRequest(priority="urgent"),
        current_user=ENGINEER_A,
    )

    assert response["data"]["priority"] == "urgent"


@pytest.mark.asyncio
async def test_engineer_cannot_complete_unassigned_work_order(monkeypatch):
    from models.requests import CompleteWorkOrderRequest
    db = FakeMultiTenantDB()
    db._rows["work_orders"].append({
        "id": "wo-a-open",
        "tenant_id": "hotel-a",
        "title": "Open work order",
        "status": "open",
        "priority": "normal",
        "assigned_to": None,
    })
    monkeypatch.setattr(wo_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await wo_router.complete_work_order(
            "wo-a-open",
            CompleteWorkOrderRequest(notes="done"),
            current_user=ENGINEER_A,
        )

    assert exc.value.status_code == 403
    assert db.b_row("work_orders", "wo-a-open")["status"] == "open"


def test_engineer_cannot_delete_work_order(monkeypatch):
    db = FakeMultiTenantDB()
    monkeypatch.setattr(wo_router, "supabase", db)
    client = TestClient(app)

    response = client.delete(
        "/v1/work-orders/wo-b-1",
        headers=_auth_header(role="engineer", hotel_id="hotel-a", user_id="engineer-a-1"),
    )

    assert response.status_code == 403
    assert db.deletes == []


# ===========================================================================
# Staff
# ===========================================================================


@pytest.mark.asyncio
async def test_staff_list_hotel_a_sees_no_hotel_b_staff(monkeypatch):
    """user_roles query is scoped to tenant_id so Hotel A staff list is empty."""
    db = FakeMultiTenantDB()
    monkeypatch.setattr(staff_router, "supabase", db)

    result = await staff_router.list_staff(current_user=USER_A)

    assert result["data"]["staff"] == []
    assert result["data"]["total"] == 0


def test_staff_invite_rejects_non_gm_before_insert(monkeypatch):
    db = FakeMultiTenantDB()
    monkeypatch.setattr(staff_router, "supabase", db)
    client = TestClient(app)

    response = client.post(
        "/v1/staff/invite",
        headers=_auth_header(role="housekeeper", hotel_id="hotel-a"),
        json={
            "email": "new-gm@example.com",
            "full_name": "New GM",
            "role": "gm",
            "hotel_id": "hotel-b",
        },
    )

    assert response.status_code == 403
    assert db.inserts == []


def test_staff_invite_uses_jwt_hotel_not_body_hotel(monkeypatch):
    db = FakeMultiTenantDB()
    monkeypatch.setattr(staff_router, "supabase", db)
    client = TestClient(app)

    response = client.post(
        "/v1/staff/invite",
        headers=_auth_header(role="gm", hotel_id="hotel-a"),
        json={
            "email": "housekeeper@example.com",
            "full_name": "Hotel A Housekeeper",
            "role": "housekeeper",
            "hotel_id": "hotel-b",
        },
    )

    assert response.status_code == 200
    assert db.inserts[0][0] == "staff_invitations"
    assert db.inserts[0][1]["tenant_id"] == "hotel-a"


def test_onboarding_invite_requires_active_gm_ownership(monkeypatch):
    db = FakeMultiTenantDB()
    monkeypatch.setattr(staff_router, "supabase", db)
    client = TestClient(app)

    response = client.post(
        "/v1/staff/onboarding-invite",
        headers=_auth_header(role="none", hotel_id=None, user_id="user-a-1"),
        json={
            "email": "housekeeper@example.com",
            "full_name": "Hotel B Housekeeper",
            "role": "housekeeper",
            "hotel_id": "hotel-b",
        },
    )

    assert response.status_code == 403
    assert db.inserts == []


def test_onboarding_invite_allows_new_hotel_owner(monkeypatch):
    db = FakeMultiTenantDB()
    db._rows["user_roles"].append({
        "id": "ur-a-1",
        "tenant_id": "hotel-a",
        "user_id": "user-a-1",
        "role": "gm",
        "is_active": True,
        "custom_role_id": None,
        "department_id": None,
        "created_at": "2026-01-01T00:00:00+00:00",
    })
    monkeypatch.setattr(staff_router, "supabase", db)
    client = TestClient(app)

    response = client.post(
        "/v1/staff/onboarding-invite",
        headers=_auth_header(role="none", hotel_id=None, user_id="user-a-1"),
        json={
            "email": "housekeeper@example.com",
            "full_name": "Hotel A Housekeeper",
            "role": "housekeeper",
            "hotel_id": "hotel-a",
        },
    )

    assert response.status_code == 200
    assert db.inserts[0][0] == "staff_invitations"
    assert db.inserts[0][1]["tenant_id"] == "hotel-a"


# ===========================================================================
# Housekeeping Assignments
# ===========================================================================


@pytest.mark.asyncio
async def test_housekeeping_assignment_rejects_cross_tenant_room_and_housekeeper(monkeypatch):
    db = FakeMultiTenantDB()
    monkeypatch.setattr(housekeeping_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await housekeeping_router.create_assignments(
            CreateAssignmentsRequest(
                date=date(2026, 5, 14),
                assignments=[
                    RoomAssignmentItem(room_id=ROOM_B_UUID, housekeeper_id=STAFF_B_UUID)
                ],
            ),
            current_user=USER_A,
        )

    assert exc.value.status_code == 404
    assert not [i for i in db.inserts if i[0] == "room_assignments"]


# ===========================================================================
# Scheduling
# ===========================================================================


@pytest.mark.asyncio
async def test_create_shift_rejects_cross_tenant_department(monkeypatch):
    db = FakeMultiTenantDB()
    monkeypatch.setattr(scheduling_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await scheduling_router.create_shift(
            CreateShiftRequest(
                name="AM",
                department_id=DEPT_B_UUID,
                start_time="07:00:00",
                end_time="15:00:00",
            ),
            current_user=USER_A,
        )

    assert exc.value.status_code == 404
    assert not [i for i in db.inserts if i[0] == "shifts"]


@pytest.mark.asyncio
async def test_create_shift_assignment_rejects_cross_tenant_user_and_shift(monkeypatch):
    db = FakeMultiTenantDB()
    monkeypatch.setattr(scheduling_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await scheduling_router.create_shift_assignment(
            CreateShiftAssignmentRequest(
                user_id=STAFF_B_UUID,
                shift_id=SHIFT_B_UUID,
                work_date=date(2026, 5, 14),
            ),
            current_user=USER_A,
        )

    assert exc.value.status_code == 404
    assert not [i for i in db.inserts if i[0] == "shift_assignments"]


@pytest.mark.asyncio
async def test_bulk_shift_assignment_rejects_cross_tenant_user_and_shift(monkeypatch):
    db = FakeMultiTenantDB()
    monkeypatch.setattr(scheduling_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await scheduling_router.bulk_create_assignments(
            BulkShiftAssignmentRequest(assignments=[
                BulkShiftAssignmentItem(
                    user_id=STAFF_B_UUID,
                    shift_id=SHIFT_B_UUID,
                    work_date=date(2026, 5, 14),
                )
            ]),
            current_user=USER_A,
        )

    assert exc.value.status_code == 404
    assert not [i for i in db.inserts if i[0] == "shift_assignments"]


# ===========================================================================
# Guest Requests
# ===========================================================================


@pytest.mark.asyncio
async def test_guest_requests_list_returns_empty_for_hotel_a(monkeypatch):
    db = FakeMultiTenantDB()
    monkeypatch.setattr(gr_router, "supabase", db)

    result = await gr_router.list_guest_requests(
        status=None, room_id=None, page=1, per_page=20, current_user=USER_A,
    )

    assert result["data"] == []


@pytest.mark.asyncio
async def test_guest_requests_update_hotel_b_raises_404(monkeypatch):
    db = FakeMultiTenantDB()
    monkeypatch.setattr(gr_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await gr_router.update_guest_request(
            "gr-b-1",
            {"status": "resolved"},
            current_user=USER_A,
        )

    assert exc.value.status_code == 404
    # Hotel B GR status unchanged
    assert db.b_row("guest_requests", "gr-b-1")["status"] == "open"


@pytest.mark.asyncio
async def test_guest_requests_delete_hotel_b_raises_404(monkeypatch):
    db = FakeMultiTenantDB()
    monkeypatch.setattr(gr_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await gr_router.delete_guest_request("gr-b-1", current_user=USER_A)

    assert exc.value.status_code == 404
    assert db.b_row("guest_requests", "gr-b-1") is not None


# ===========================================================================
# Lost & Found
# ===========================================================================


@pytest.mark.asyncio
async def test_lost_found_list_returns_empty_for_hotel_a(monkeypatch):
    db = FakeMultiTenantDB()
    monkeypatch.setattr(lf_router, "supabase", db)

    result = await lf_router.list_lost_found_items(
        status=None, date_from=None, date_to=None, search=None,
        page=1, per_page=20, current_user=USER_A,
    )

    assert result["data"] == []


@pytest.mark.asyncio
async def test_lost_found_get_hotel_b_item_raises_404(monkeypatch):
    db = FakeMultiTenantDB()
    monkeypatch.setattr(lf_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await lf_router.get_lost_found_item("lf-b-1", current_user=USER_A)

    assert exc.value.status_code == 404


# ===========================================================================
# Logbook
# ===========================================================================


@pytest.mark.asyncio
async def test_logbook_list_returns_empty_for_hotel_a(monkeypatch):
    db = FakeMultiTenantDB()
    monkeypatch.setattr(logbook_router, "supabase", db)

    result = await logbook_router.list_logbook_entries(
        department_id=None, shift_id=None, entry_date=None,
        page=1, per_page=20, current_user=USER_A,
    )

    assert result["data"] == []


# ===========================================================================
# SOP Documents
# ===========================================================================


@pytest.mark.asyncio
async def test_sop_documents_list_returns_empty_for_hotel_a(monkeypatch):
    db = FakeMultiTenantDB()
    monkeypatch.setattr(sop_router, "supabase", db)

    result = await sop_router.list_sop_documents(current_user=USER_A)

    assert result["data"] == []


# ===========================================================================
# Billing
# ===========================================================================


@pytest.mark.asyncio
async def test_billing_subscription_hotel_a_raises_404(monkeypatch):
    """Hotel A has no subscription row; Hotel B's row is invisible behind tenant filter."""
    db = FakeMultiTenantDB()
    monkeypatch.setattr(billing_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await billing_router.get_subscription(current_user=USER_A)

    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_billing_credits_hotel_a_returns_no_data_message(monkeypatch):
    """credit_ledger has no Hotel A row — endpoint returns the safe empty-period message."""
    db = FakeMultiTenantDB()
    monkeypatch.setattr(billing_router, "supabase", db)

    result = await billing_router.get_credits(current_user=USER_A)

    assert result["data"].get("message") == "No billing period found"


# ===========================================================================
# Cross-domain: verify Hotel B data is fully intact after all Hotel A probes
# ===========================================================================


@pytest.mark.asyncio
async def test_hotel_b_data_untouched_after_hotel_a_probes(monkeypatch):
    """End-to-end: run several Hotel A operations; confirm Hotel B data is pristine."""
    db = FakeMultiTenantDB()
    for module in (
        rooms_router, tasks_router, wo_router, gr_router, lf_router,
        logbook_router, sop_router, billing_router, staff_router,
    ):
        monkeypatch.setattr(module, "supabase", db)

    # These should all fail with 404 or return empty — no mutation should touch hotel-b rows
    with pytest.raises(HTTPException):
        await rooms_router.get_room("room-b-1", current_user=USER_A)
    with pytest.raises(HTTPException):
        await tasks_router.get_task("task-b-1", current_user=USER_A)
    with pytest.raises(HTTPException):
        await wo_router.get_work_order("wo-b-1", current_user=USER_A)
    with pytest.raises(HTTPException):
        await gr_router.update_guest_request("gr-b-1", {"status": "resolved"}, current_user=USER_A)
    with pytest.raises(HTTPException):
        await lf_router.get_lost_found_item("lf-b-1", current_user=USER_A)

    # Hardened 404s (claim, complete, and update now pre-check tenant ownership)
    with pytest.raises(HTTPException):
        await wo_router.claim_work_order("wo-b-1", current_user=USER_A)
    with pytest.raises(HTTPException):
        await wo_router.update_work_order("wo-b-1", UpdateWorkOrderRequest(priority="urgent"), current_user=USER_A)

    # Verify original Hotel B state is completely unchanged
    assert db.b_row("room_status", "rs-b-1")["status"] == "DIRTY"
    assert db.b_row("tasks", "task-b-1")["status"] == "open"
    assert db.b_row("work_orders", "wo-b-1")["status"] == "open"
    assert db.b_row("work_orders", "wo-b-1")["priority"] == "normal"
    assert db.b_row("guest_requests", "gr-b-1")["status"] == "open"
    assert db.b_row("lost_found_items", "lf-b-1") is not None
    assert db.b_row("sop_documents", "sop-b-1") is not None

    # No inserts or deletes should have touched Hotel B tables
    hotel_b_inserts = [i for i in db.inserts if i[1].get("tenant_id") == "hotel-b"]
    hotel_b_deletes = [d for d in db.deletes if d[1].get("tenant_id") == "hotel-b"]
    assert hotel_b_inserts == [], f"Unexpected Hotel B inserts: {hotel_b_inserts}"
    assert hotel_b_deletes == [], f"Unexpected Hotel B deletes: {hotel_b_deletes}"
