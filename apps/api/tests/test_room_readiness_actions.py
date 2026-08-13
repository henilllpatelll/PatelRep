"""Phase 27 tests for room-readiness one-click reassign / escalate / acknowledge.

Covers:
A. Characterization test proving FakeDB's upsert preserves omitted columns on
   conflict (load-bearing assumption for the acknowledge-suppression design).
B. run_room_predictions acknowledgement-awareness (preserve while HIGH, clear
   on drop below HIGH, still notify on a fresh HIGH when not acknowledged).
C. RBAC — non-supervisor roles blocked from the shared require_role gate used
   by all three new endpoints.
D. Endpoint behavior for reassign / escalate / acknowledge, calling the
   not-yet-existing router handler functions directly with a monkeypatched
   FakeDB, mirroring test_work_order_archive.py's direct-call pattern.

GREEN-implementer reminder: all three new route decorators
(reassign_at_risk_room / escalate_at_risk_room / acknowledge_at_risk_room)
must use `Depends(require_role("gm", "housekeeping_supervisor"))` literally —
the RBAC test below only proves the shared gate 403s correctly, not that
every endpoint actually wires it in.
"""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from middleware.auth import CurrentUser, require_role
from routers import housekeeping as housekeeping_router
from services.ai import predictions as predictions_module
from tests.smoke.fake_supabase import FakeDB

GM = CurrentUser(user_id="gm-1", hotel_id="hotel-1", role="gm", email="gm@example.com")
SUPERVISOR = CurrentUser(
    user_id="sup-1", hotel_id="hotel-1", role="housekeeping_supervisor", email="sup@example.com"
)


# ---------------------------------------------------------------------------
# A. Upsert omitted-column-preservation characterization test
# ---------------------------------------------------------------------------


def test_upsert_preserves_omitted_ack_columns_on_conflict():
    db = FakeDB({
        "room_readiness_predictions": [{
            "id": "pred-1", "room_id": "room-1", "tenant_id": "hotel-1",
            "risk_level": "HIGH", "is_acknowledged": True,
            "acknowledged_at": "2026-08-01T00:00:00+00:00", "acknowledged_by": "user-1",
        }],
    })
    db.table("room_readiness_predictions").upsert(
        {"room_id": "room-1", "risk_level": "HIGH", "last_calculated_at": "2026-08-02T00:00:00+00:00"},
        on_conflict="room_id",
    ).execute()
    row = next(r for r in db.rows["room_readiness_predictions"] if r["room_id"] == "room-1")
    assert row["is_acknowledged"] is True
    assert row["acknowledged_at"] == "2026-08-01T00:00:00+00:00"
    assert row["acknowledged_by"] == "user-1"


# ---------------------------------------------------------------------------
# B. run_room_predictions acknowledgement tests
# ---------------------------------------------------------------------------


def _at_risk_room(
    room_id: str,
    checkin_in_minutes: int,
    assigned_to: str | None = None,
    status: str = "DIRTY",
    vip_flag: bool = False,
) -> dict:
    checkin_time = (datetime.now(timezone.utc) + timedelta(minutes=checkin_in_minutes)).isoformat()
    return {
        "room_id": room_id,
        "status": status,
        "assigned_to": assigned_to,
        "vip_flag": vip_flag,
        "checkin_time": checkin_time,
        "rooms": {
            "room_number": "101",
            "room_type_id": "rt-1",
            "room_types": {"name": "Standard", "code": "standard", "base_clean_minutes": 25},
        },
    }


def test_run_room_predictions_preserves_ack_while_still_high(monkeypatch):
    db = FakeDB({
        "room_readiness_predictions": [{
            "id": "pred-1", "room_id": "room-1", "tenant_id": "hotel-1",
            "risk_level": "HIGH", "is_acknowledged": True,
            "acknowledged_at": "2026-08-01T00:00:00+00:00", "acknowledged_by": "user-1",
        }],
        "notifications": [],
        "user_profiles": [],
    })
    monkeypatch.setattr(predictions_module, "supabase", db)
    monkeypatch.setattr(
        predictions_module,
        "get_at_risk_rooms",
        lambda hotel_id: [_at_risk_room("room-1", checkin_in_minutes=1)],
    )

    result = predictions_module.run_room_predictions("hotel-1")

    row = next(r for r in db.rows["room_readiness_predictions"] if r["room_id"] == "room-1")
    assert row["risk_level"] == "HIGH"
    assert row["is_acknowledged"] is True
    assert row["acknowledged_at"] == "2026-08-01T00:00:00+00:00"
    assert row["acknowledged_by"] == "user-1"
    assert result["notifications_sent"] == 0


def test_run_room_predictions_clears_ack_when_risk_drops_below_high(monkeypatch):
    db = FakeDB({
        "room_readiness_predictions": [{
            "id": "pred-1", "room_id": "room-1", "tenant_id": "hotel-1",
            "risk_level": "HIGH", "is_acknowledged": True,
            "acknowledged_at": "2026-08-01T00:00:00+00:00", "acknowledged_by": "user-1",
        }],
        "notifications": [],
        "user_profiles": [],
    })
    monkeypatch.setattr(predictions_module, "supabase", db)
    monkeypatch.setattr(
        predictions_module,
        "get_at_risk_rooms",
        lambda hotel_id: [_at_risk_room("room-1", checkin_in_minutes=600)],
    )

    predictions_module.run_room_predictions("hotel-1")

    row = next(r for r in db.rows["room_readiness_predictions"] if r["room_id"] == "room-1")
    assert row["risk_level"] != "HIGH"
    assert row["is_acknowledged"] is False
    assert row["acknowledged_at"] is None
    assert row["acknowledged_by"] is None


def test_run_room_predictions_notifies_on_fresh_high_when_not_acknowledged(monkeypatch):
    db = FakeDB({
        "room_readiness_predictions": [{
            "id": "pred-1", "room_id": "room-1", "tenant_id": "hotel-1",
            "risk_level": "MEDIUM", "is_acknowledged": False,
            "acknowledged_at": None, "acknowledged_by": None,
        }],
        "notifications": [],
        "user_profiles": [{
            "user_id": "sup-1", "tenant_id": "hotel-1", "role": "housekeeping_supervisor",
        }],
    })
    monkeypatch.setattr(predictions_module, "supabase", db)
    monkeypatch.setattr(
        predictions_module,
        "get_at_risk_rooms",
        lambda hotel_id: [_at_risk_room("room-1", checkin_in_minutes=1)],
    )

    result = predictions_module.run_room_predictions("hotel-1")

    row = next(r for r in db.rows["room_readiness_predictions"] if r["room_id"] == "room-1")
    assert row["risk_level"] == "HIGH"
    assert result["notifications_sent"] == 1


# ---------------------------------------------------------------------------
# B2. run_room_predictions escalation-watermark carry-forward (AI-13 prereq)
# ---------------------------------------------------------------------------


def test_run_room_predictions_preserves_escalation_watermark_while_still_high(monkeypatch):
    db = FakeDB({
        "room_readiness_predictions": [{
            "id": "pred-1", "room_id": "room-1", "tenant_id": "hotel-1",
            "risk_level": "HIGH", "is_acknowledged": False,
            "acknowledged_at": None, "acknowledged_by": None,
            "escalation_level": 1, "high_risk_since": "2026-08-01T00:00:00+00:00",
        }],
        "notifications": [],
        "user_profiles": [],
    })
    monkeypatch.setattr(predictions_module, "supabase", db)
    monkeypatch.setattr(
        predictions_module,
        "get_at_risk_rooms",
        lambda hotel_id: [_at_risk_room("room-1", checkin_in_minutes=1)],
    )

    predictions_module.run_room_predictions("hotel-1")

    row = next(r for r in db.rows["room_readiness_predictions"] if r["room_id"] == "room-1")
    assert row["risk_level"] == "HIGH"
    assert row["escalation_level"] == 1
    assert row["high_risk_since"] == "2026-08-01T00:00:00+00:00"


def test_run_room_predictions_resets_escalation_watermark_when_risk_drops_below_high(monkeypatch):
    db = FakeDB({
        "room_readiness_predictions": [{
            "id": "pred-1", "room_id": "room-1", "tenant_id": "hotel-1",
            "risk_level": "HIGH", "is_acknowledged": False,
            "acknowledged_at": None, "acknowledged_by": None,
            "escalation_level": 1, "high_risk_since": "2026-08-01T00:00:00+00:00",
        }],
        "notifications": [],
        "user_profiles": [],
    })
    monkeypatch.setattr(predictions_module, "supabase", db)
    monkeypatch.setattr(
        predictions_module,
        "get_at_risk_rooms",
        lambda hotel_id: [_at_risk_room("room-1", checkin_in_minutes=600)],
    )

    predictions_module.run_room_predictions("hotel-1")

    row = next(r for r in db.rows["room_readiness_predictions"] if r["room_id"] == "room-1")
    assert row["risk_level"] != "HIGH"
    assert row["escalation_level"] == 0
    assert row["high_risk_since"] is None


def test_run_room_predictions_stamps_fresh_high_risk_since_on_new_crossing(monkeypatch):
    db = FakeDB({
        "room_readiness_predictions": [{
            "id": "pred-1", "room_id": "room-1", "tenant_id": "hotel-1",
            "risk_level": "MEDIUM", "is_acknowledged": False,
            "acknowledged_at": None, "acknowledged_by": None,
            "escalation_level": 0, "high_risk_since": None,
        }],
        "notifications": [],
        "user_profiles": [],
    })
    monkeypatch.setattr(predictions_module, "supabase", db)
    monkeypatch.setattr(
        predictions_module,
        "get_at_risk_rooms",
        lambda hotel_id: [_at_risk_room("room-1", checkin_in_minutes=1)],
    )

    predictions_module.run_room_predictions("hotel-1")

    row = next(r for r in db.rows["room_readiness_predictions"] if r["room_id"] == "room-1")
    assert row["risk_level"] == "HIGH"
    assert row["escalation_level"] == 0
    assert row["high_risk_since"] is not None
    # must be a valid ISO string
    datetime.fromisoformat(row["high_risk_since"])


# ---------------------------------------------------------------------------
# C. RBAC — non-supervisor roles blocked
# ---------------------------------------------------------------------------

_NON_SUPERVISOR_ROLES = ["housekeeper", "front_desk", "engineer", "chief_engineer"]


@pytest.mark.parametrize("role", _NON_SUPERVISOR_ROLES)
@pytest.mark.asyncio
async def test_non_supervisor_roles_blocked_from_room_readiness_actions(role):
    check = require_role("gm", "housekeeping_supervisor")
    with pytest.raises(HTTPException) as exc:
        await check(current_user=CurrentUser(user_id="u1", hotel_id="hotel-1", role=role, email=f"{role}@example.com"))
    assert exc.value.status_code == 403


# ---------------------------------------------------------------------------
# D. Endpoint-behavior tests
# ---------------------------------------------------------------------------


def _base_rows(room_status: str = "DIRTY", risk_level: str = "HIGH", is_acknowledged: bool = False) -> dict:
    return {
        "rooms": [{"id": "room-1", "tenant_id": "hotel-1", "room_number": "101"}],
        "room_status": [{"room_id": "room-1", "tenant_id": "hotel-1", "status": room_status}],
        "room_readiness_predictions": [{
            "id": "pred-1", "room_id": "room-1", "tenant_id": "hotel-1",
            "risk_level": risk_level, "is_acknowledged": is_acknowledged,
            "acknowledged_at": None, "acknowledged_by": None,
            "predicted_ready_at": "2026-08-12T15:00:00+00:00",
        }],
        "room_assignments": [],
        "shift_assignments": [
            {"user_id": "hk-1", "tenant_id": "hotel-1", "work_date": date_today_str()},
            {"user_id": "hk-2", "tenant_id": "hotel-1", "work_date": date_today_str()},
        ],
        "user_roles": [
            {"user_id": "hk-1", "tenant_id": "hotel-1", "role": "housekeeper", "is_active": True},
        ],
        "notifications": [],
        "user_profiles": [{
            "user_id": "sup-1", "tenant_id": "hotel-1", "role": "housekeeping_supervisor",
        }],
    }


def date_today_str() -> str:
    from datetime import date
    return date.today().isoformat()


# create_assignments (called for real by the winning reassign path) constructs
# a pydantic CreateAssignmentsRequest/RoomAssignmentItem, whose room_id and
# housekeeper_id fields are UUID4 — plain strings like "room-1"/"hk-1" fail
# pydantic validation. This is the only scenario that exercises that real
# code path, so it gets its own valid-UUID fixture instead of _base_rows().
_UUID_ROOM = "d290f1ee-6c54-4b01-90e6-d701748f0851"
_UUID_HK1 = "3fa85f64-5717-4562-b3fc-2c963f66afa6"
_UUID_HK2 = "3fa85f64-5717-4562-b3fc-2c963f66afa7"


@pytest.mark.asyncio
async def test_reassign_assigns_least_loaded_eligible_housekeeper(monkeypatch):
    db = FakeDB({
        "rooms": [{"id": _UUID_ROOM, "tenant_id": "hotel-1", "room_number": "101"}],
        "room_status": [{"room_id": _UUID_ROOM, "tenant_id": "hotel-1", "status": "DIRTY"}],
        "room_readiness_predictions": [{
            "id": "pred-1", "room_id": _UUID_ROOM, "tenant_id": "hotel-1",
            "risk_level": "HIGH", "is_acknowledged": False,
            "predicted_ready_at": "2026-08-12T15:00:00+00:00",
        }],
        "room_assignments": [],
        "shift_assignments": [
            {"user_id": _UUID_HK1, "tenant_id": "hotel-1", "work_date": date_today_str()},
            {"user_id": _UUID_HK2, "tenant_id": "hotel-1", "work_date": date_today_str()},
        ],
        "user_roles": [
            {"user_id": _UUID_HK1, "tenant_id": "hotel-1", "role": "housekeeper", "is_active": True},
        ],
        "notifications": [],
        "user_profiles": [],
    })
    monkeypatch.setattr(housekeeping_router, "supabase", db)
    monkeypatch.setattr(
        housekeeping_router,
        "count_rooms_ahead",
        lambda hk_id, room_id, hotel_id, target_date: {_UUID_HK1: 2, _UUID_HK2: 5}.get(hk_id, 99),
    )

    response = await housekeeping_router.reassign_at_risk_room(room_id=_UUID_ROOM, current_user=SUPERVISOR)

    assert response == {"data": {"action": "reassigned", "housekeeper_id": _UUID_HK1}}
    assigned = [r for r in db.rows["room_assignments"] if r["room_id"] == _UUID_ROOM]
    assert len(assigned) == 1
    assert assigned[0]["assigned_to"] == _UUID_HK1


@pytest.mark.asyncio
async def test_reassign_degrades_to_escalate_when_no_eligible_housekeeper(monkeypatch):
    db = FakeDB(_base_rows())
    monkeypatch.setattr(housekeeping_router, "supabase", db)
    # notify_supervisors_high_risk is imported by reference into
    # housekeeping_router, but its function body still resolves `supabase`
    # against predictions_module's own globals, not the caller's — must
    # patch both to the same db or it silently hits the real project.
    monkeypatch.setattr(predictions_module, "supabase", db)
    monkeypatch.setattr(
        housekeeping_router,
        "count_rooms_ahead",
        lambda hk_id, room_id, hotel_id, target_date: 5,
    )

    response = await housekeeping_router.reassign_at_risk_room(room_id="room-1", current_user=SUPERVISOR)

    assert response == {"data": {"action": "escalated", "reason": "no_eligible_housekeeper"}}
    assigned = [r for r in db.rows["room_assignments"] if r["room_id"] == "room-1"]
    assert assigned == []
    assert len(db.rows["notifications"]) == 1


@pytest.mark.asyncio
async def test_reassign_zero_candidates_degrades_to_escalate(monkeypatch):
    rows = _base_rows()
    rows["shift_assignments"] = []
    rows["user_roles"] = []
    db = FakeDB(rows)
    monkeypatch.setattr(housekeeping_router, "supabase", db)
    monkeypatch.setattr(predictions_module, "supabase", db)

    response = await housekeeping_router.reassign_at_risk_room(room_id="room-1", current_user=SUPERVISOR)

    assert response == {"data": {"action": "escalated", "reason": "no_eligible_housekeeper"}}
    assigned = [r for r in db.rows["room_assignments"] if r["room_id"] == "room-1"]
    assert assigned == []
    assert len(db.rows["notifications"]) == 1


@pytest.mark.asyncio
async def test_reassign_409_when_room_status_no_longer_needs_cleaning(monkeypatch):
    db = FakeDB(_base_rows(room_status="INSPECTED"))
    monkeypatch.setattr(housekeeping_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await housekeeping_router.reassign_at_risk_room(room_id="room-1", current_user=SUPERVISOR)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_reassign_404_when_room_not_in_tenant(monkeypatch):
    rows = _base_rows()
    rows["rooms"] = []
    db = FakeDB(rows)
    monkeypatch.setattr(housekeeping_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await housekeeping_router.reassign_at_risk_room(room_id="room-1", current_user=SUPERVISOR)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_escalate_calls_notify_supervisors_high_risk_with_fresh_data(monkeypatch):
    db = FakeDB(_base_rows(risk_level="HIGH"))
    monkeypatch.setattr(housekeeping_router, "supabase", db)
    monkeypatch.setattr(predictions_module, "supabase", db)

    response = await housekeeping_router.escalate_at_risk_room(room_id="room-1", current_user=SUPERVISOR)

    assert response["data"]["action"] == "escalated"
    assert response["data"]["notifications_sent"] == 1
    assert len(db.rows["notifications"]) == 1


@pytest.mark.asyncio
async def test_escalate_409_when_risk_no_longer_high(monkeypatch):
    db = FakeDB(_base_rows(risk_level="MEDIUM"))
    monkeypatch.setattr(housekeeping_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await housekeeping_router.escalate_at_risk_room(room_id="room-1", current_user=SUPERVISOR)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_acknowledge_sets_ack_columns(monkeypatch):
    db = FakeDB(_base_rows(is_acknowledged=False))
    monkeypatch.setattr(housekeeping_router, "supabase", db)

    response = await housekeeping_router.acknowledge_at_risk_room(room_id="room-1", current_user=SUPERVISOR)

    assert response == {"data": {"action": "acknowledged"}}
    row = next(r for r in db.rows["room_readiness_predictions"] if r["room_id"] == "room-1")
    assert row["is_acknowledged"] is True
    assert row["acknowledged_at"] is not None
    assert row["acknowledged_by"] == SUPERVISOR.user_id


@pytest.mark.asyncio
async def test_acknowledge_idempotent_on_already_acknowledged(monkeypatch):
    db = FakeDB(_base_rows(is_acknowledged=True))
    monkeypatch.setattr(housekeeping_router, "supabase", db)
    updates_before = len(db.updates)

    response = await housekeeping_router.acknowledge_at_risk_room(room_id="room-1", current_user=SUPERVISOR)

    assert response == {"data": {"action": "already_acknowledged"}}
    assert len(db.updates) == updates_before


@pytest.mark.asyncio
async def test_acknowledge_404_when_no_prediction_row_exists(monkeypatch):
    rows = _base_rows()
    rows["room_readiness_predictions"] = []
    db = FakeDB(rows)
    monkeypatch.setattr(housekeeping_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await housekeeping_router.acknowledge_at_risk_room(room_id="room-1", current_user=SUPERVISOR)
    assert exc.value.status_code == 404
