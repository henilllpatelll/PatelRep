"""Phase 28-01 tests for room-readiness batch reassign / batch acknowledge.

Both new endpoints (`batch_reassign_rooms` / `batch_acknowledge_rooms`) are
thin per-item loops over Phase 27's existing single-item coroutines
(`reassign_at_risk_room` / `acknowledge_at_risk_room`). These tests exercise
the loop/aggregation behavior only — the single-item business logic itself
(least-loaded housekeeper selection, ack-column writes, etc.) is already
covered by test_room_readiness_actions.py.

Covers:
A. Batch-reassign happy path (all succeed).
B. Partial failure — one 409, one 404 — batch is best-effort, not aborted.
C. Escalate-no-capacity path counted as a success alongside a sibling success.
D. Batch-acknowledge happy path + idempotency (no duplicate write).
E. Per-item live re-read — each room is fetched individually, no bulk .in_().
F. Concurrent-mutation — a room that changed state before the per-item write
   still yields a per-item error without affecting sibling rooms.
G. Request validation — empty / over-cap room_ids rejected by the model.
H. RBAC — shared gate 403s non-supervisor roles.
I. Tenant isolation — a cross-tenant room_id is a per-item 404, not a leak.
"""

import uuid

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from middleware.auth import CurrentUser, require_role
from models.requests import BatchRoomReadinessRequest
from routers import housekeeping as housekeeping_router
from services.ai import predictions as predictions_module
from tests.smoke.fake_supabase import FakeDB

GM = CurrentUser(user_id="gm-1", hotel_id="hotel-1", role="gm", email="gm@example.com")
SUPERVISOR = CurrentUser(
    user_id="sup-1", hotel_id="hotel-1", role="housekeeping_supervisor", email="sup@example.com"
)

ROOM_OK_1 = str(uuid.uuid4())
ROOM_OK_2 = str(uuid.uuid4())
ROOM_OK_3 = str(uuid.uuid4())
ROOM_OCCUPIED = str(uuid.uuid4())
ROOM_MISSING = str(uuid.uuid4())
ROOM_NO_CAPACITY = str(uuid.uuid4())
ROOM_UNACK = str(uuid.uuid4())
ROOM_ALREADY_ACK = str(uuid.uuid4())
ROOM_OTHER_TENANT = str(uuid.uuid4())
HK_1 = str(uuid.uuid4())


def date_today_str() -> str:
    from datetime import date
    return date.today().isoformat()


def _multi_room_db(room_specs: list[dict]) -> FakeDB:
    rooms, room_status, predictions = [], [], []
    for spec in room_specs:
        rid = spec["room_id"]
        tenant = spec.get("tenant_id", "hotel-1")
        if not spec.get("omit_room_row"):
            rooms.append({"id": rid, "tenant_id": tenant, "room_number": spec.get("room_number", "101")})
        if not spec.get("omit_status_row"):
            room_status.append({"room_id": rid, "tenant_id": tenant, "status": spec.get("status", "DIRTY")})
        if not spec.get("omit_prediction_row"):
            predictions.append({
                "id": f"pred-{rid}",
                "room_id": rid,
                "tenant_id": tenant,
                "risk_level": spec.get("risk_level", "HIGH"),
                "is_acknowledged": spec.get("is_acknowledged", False),
                "acknowledged_at": spec.get("acknowledged_at"),
                "acknowledged_by": spec.get("acknowledged_by"),
                "predicted_ready_at": "2026-08-12T15:00:00+00:00",
            })
    return FakeDB({
        "rooms": rooms,
        "room_status": room_status,
        "room_readiness_predictions": predictions,
        "room_assignments": [],
        # Deliberately a single shift-assigned/active housekeeper: _active_housekeepers
        # builds its candidate id set via a Python `set`, so any tie between two equally
        # "eligible" mocked counts would tie-break on nondeterministic set-iteration order.
        # Multi-candidate least-loaded selection is already covered by
        # test_room_readiness_actions.py's test_reassign_assigns_least_loaded_eligible_housekeeper.
        "shift_assignments": [
            {"user_id": HK_1, "tenant_id": "hotel-1", "work_date": date_today_str()},
        ],
        "user_roles": [
            {"user_id": HK_1, "tenant_id": "hotel-1", "role": "housekeeper", "is_active": True},
        ],
        "notifications": [],
        "user_profiles": [
            {"user_id": "sup-1", "tenant_id": "hotel-1", "role": "housekeeping_supervisor"},
        ],
    })


# ---------------------------------------------------------------------------
# A. Batch-reassign happy path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_batch_reassign_happy_path_all_succeed(monkeypatch):
    db = _multi_room_db([{"room_id": ROOM_OK_1}, {"room_id": ROOM_OK_2}, {"room_id": ROOM_OK_3}])
    monkeypatch.setattr(housekeeping_router, "supabase", db)
    monkeypatch.setattr(predictions_module, "supabase", db)
    monkeypatch.setattr(housekeeping_router, "count_rooms_ahead", lambda *a, **k: 1)

    body = BatchRoomReadinessRequest(room_ids=[ROOM_OK_1, ROOM_OK_2, ROOM_OK_3])
    response = await housekeeping_router.batch_reassign_rooms(body=body, current_user=SUPERVISOR)

    data = response["data"]
    assert data["succeeded"] == 3
    assert data["failed"] == 0
    assert [r["room_id"] for r in data["results"]] == [ROOM_OK_1, ROOM_OK_2, ROOM_OK_3]
    assert all(r["action"] == "reassigned" for r in data["results"])


# ---------------------------------------------------------------------------
# B. Partial failure — best-effort, not all-or-nothing
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_batch_reassign_partial_failure_continues_batch(monkeypatch):
    db = _multi_room_db([
        {"room_id": ROOM_OK_1},
        {"room_id": ROOM_OCCUPIED, "status": "OCCUPIED"},
        {"room_id": ROOM_MISSING, "omit_room_row": True, "omit_status_row": True, "omit_prediction_row": True},
    ])
    monkeypatch.setattr(housekeeping_router, "supabase", db)
    monkeypatch.setattr(predictions_module, "supabase", db)
    monkeypatch.setattr(housekeeping_router, "count_rooms_ahead", lambda *a, **k: 1)

    body = BatchRoomReadinessRequest(room_ids=[ROOM_OK_1, ROOM_OCCUPIED, ROOM_MISSING])
    response = await housekeeping_router.batch_reassign_rooms(body=body, current_user=SUPERVISOR)

    data = response["data"]
    assert data["succeeded"] == 1
    assert data["failed"] == 2
    results = data["results"]
    assert results[0] == {"room_id": ROOM_OK_1, "action": "reassigned", "housekeeper_id": HK_1}
    assert results[1]["room_id"] == ROOM_OCCUPIED
    assert results[1]["action"] == "error"
    assert results[1]["status"] == 409
    assert results[2]["room_id"] == ROOM_MISSING
    assert results[2]["action"] == "error"
    assert results[2]["status"] == 404


# ---------------------------------------------------------------------------
# C. Escalate-no-capacity path counted as success alongside a sibling success
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_batch_reassign_escalate_no_capacity_counts_as_success(monkeypatch):
    db = _multi_room_db([{"room_id": ROOM_OK_1}, {"room_id": ROOM_NO_CAPACITY}])
    monkeypatch.setattr(housekeeping_router, "supabase", db)
    monkeypatch.setattr(predictions_module, "supabase", db)

    def fake_count(hk_id, room_id, hotel_id, target_date):
        return 1 if room_id == ROOM_OK_1 else 10

    monkeypatch.setattr(housekeeping_router, "count_rooms_ahead", fake_count)

    body = BatchRoomReadinessRequest(room_ids=[ROOM_OK_1, ROOM_NO_CAPACITY])
    response = await housekeeping_router.batch_reassign_rooms(body=body, current_user=SUPERVISOR)

    data = response["data"]
    assert data["succeeded"] == 2
    assert data["failed"] == 0
    results = {r["room_id"]: r for r in data["results"]}
    assert results[ROOM_OK_1]["action"] == "reassigned"
    assert results[ROOM_NO_CAPACITY]["action"] == "escalated"
    assert results[ROOM_NO_CAPACITY]["reason"] == "no_eligible_housekeeper"


# ---------------------------------------------------------------------------
# D. Batch-acknowledge happy path + idempotency
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_batch_acknowledge_happy_path_and_idempotency(monkeypatch):
    db = _multi_room_db([
        {"room_id": ROOM_UNACK, "is_acknowledged": False},
        {
            "room_id": ROOM_ALREADY_ACK,
            "is_acknowledged": True,
            "acknowledged_at": "2026-08-01T00:00:00+00:00",
            "acknowledged_by": "user-1",
        },
    ])
    monkeypatch.setattr(housekeeping_router, "supabase", db)
    updates_before = len(db.updates)

    body = BatchRoomReadinessRequest(room_ids=[ROOM_UNACK, ROOM_ALREADY_ACK])
    response = await housekeeping_router.batch_acknowledge_rooms(body=body, current_user=SUPERVISOR)

    data = response["data"]
    assert data["succeeded"] == 2
    assert data["failed"] == 0
    results = {r["room_id"]: r for r in data["results"]}
    assert results[ROOM_UNACK]["action"] == "acknowledged"
    assert results[ROOM_ALREADY_ACK]["action"] == "already_acknowledged"
    assert len(db.updates) == updates_before + 1


# ---------------------------------------------------------------------------
# E. Per-item live re-read — no bulk .in_() pre-fetch
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_batch_reassign_reads_each_room_individually_not_bulk(monkeypatch):
    db = _multi_room_db([{"room_id": ROOM_OK_1}, {"room_id": ROOM_OK_2}])
    monkeypatch.setattr(housekeeping_router, "supabase", db)
    monkeypatch.setattr(predictions_module, "supabase", db)
    monkeypatch.setattr(housekeeping_router, "count_rooms_ahead", lambda *a, **k: 1)

    body = BatchRoomReadinessRequest(room_ids=[ROOM_OK_1, ROOM_OK_2])
    await housekeeping_router.batch_reassign_rooms(body=body, current_user=SUPERVISOR)

    # reassign_at_risk_room's own status re-read plus create_assignments' internal
    # status re-read = 2 room_status selects per room. If the batch endpoint instead
    # pre-fetched all rooms in one shortcut .in_() call, this count would not scale
    # linearly with the number of requested rooms.
    room_status_selects = [c for c in db.select_calls if c[0] == "room_status"]
    assert len(room_status_selects) == 2 * len(body.room_ids)


# ---------------------------------------------------------------------------
# F. Concurrent-mutation — caught by the per-item live re-read
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_batch_reassign_concurrent_mutation_caught_by_live_reread(monkeypatch):
    db = _multi_room_db([{"room_id": ROOM_OK_1}, {"room_id": ROOM_OCCUPIED, "status": "DIRTY"}])
    # Simulate the room's status changing (e.g. a front-desk check-in) after
    # the batch request was formed but before this room's per-item write runs.
    for row in db.rows["room_status"]:
        if row["room_id"] == ROOM_OCCUPIED:
            row["status"] = "OCCUPIED"
    monkeypatch.setattr(housekeeping_router, "supabase", db)
    monkeypatch.setattr(predictions_module, "supabase", db)
    monkeypatch.setattr(housekeeping_router, "count_rooms_ahead", lambda *a, **k: 1)

    body = BatchRoomReadinessRequest(room_ids=[ROOM_OK_1, ROOM_OCCUPIED])
    response = await housekeeping_router.batch_reassign_rooms(body=body, current_user=SUPERVISOR)

    data = response["data"]
    assert data["succeeded"] == 1
    assert data["failed"] == 1
    results = {r["room_id"]: r for r in data["results"]}
    assert results[ROOM_OK_1]["action"] == "reassigned"
    assert results[ROOM_OCCUPIED]["action"] == "error"
    assert results[ROOM_OCCUPIED]["status"] == 409


# ---------------------------------------------------------------------------
# G. Request validation
# ---------------------------------------------------------------------------


def test_batch_request_rejects_empty_room_ids():
    with pytest.raises(ValidationError):
        BatchRoomReadinessRequest(room_ids=[])


def test_batch_request_rejects_over_cap_room_ids():
    with pytest.raises(ValidationError):
        BatchRoomReadinessRequest(room_ids=[str(uuid.uuid4()) for _ in range(51)])


def test_batch_request_accepts_cap_of_50():
    body = BatchRoomReadinessRequest(room_ids=[str(uuid.uuid4()) for _ in range(50)])
    assert len(body.room_ids) == 50


# ---------------------------------------------------------------------------
# H. RBAC — non-supervisor roles blocked (shared gate with the single-item routes)
# ---------------------------------------------------------------------------

_NON_SUPERVISOR_ROLES = ["housekeeper", "front_desk", "engineer", "chief_engineer"]


@pytest.mark.parametrize("role", _NON_SUPERVISOR_ROLES)
@pytest.mark.asyncio
async def test_non_supervisor_roles_blocked_from_batch_room_readiness_actions(role):
    check = require_role("gm", "housekeeping_supervisor")
    with pytest.raises(HTTPException) as exc:
        await check(current_user=CurrentUser(user_id="u1", hotel_id="hotel-1", role=role, email=f"{role}@example.com"))
    assert exc.value.status_code == 403


# ---------------------------------------------------------------------------
# I. Tenant isolation — cross-tenant room is a per-item 404, not a leak
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_batch_reassign_cross_tenant_room_is_per_item_404_not_leak(monkeypatch):
    db = _multi_room_db([{"room_id": ROOM_OK_1}])
    db.rows["rooms"].append({"id": ROOM_OTHER_TENANT, "tenant_id": "hotel-2", "room_number": "999"})
    db.rows["room_status"].append({"room_id": ROOM_OTHER_TENANT, "tenant_id": "hotel-2", "status": "DIRTY"})
    monkeypatch.setattr(housekeeping_router, "supabase", db)
    monkeypatch.setattr(predictions_module, "supabase", db)
    monkeypatch.setattr(housekeeping_router, "count_rooms_ahead", lambda *a, **k: 1)

    body = BatchRoomReadinessRequest(room_ids=[ROOM_OK_1, ROOM_OTHER_TENANT])
    response = await housekeeping_router.batch_reassign_rooms(body=body, current_user=SUPERVISOR)

    data = response["data"]
    assert data["succeeded"] == 1
    assert data["failed"] == 1
    results = {r["room_id"]: r for r in data["results"]}
    assert results[ROOM_OK_1]["action"] == "reassigned"
    assert results[ROOM_OTHER_TENANT]["action"] == "error"
    assert results[ROOM_OTHER_TENANT]["status"] == 404
