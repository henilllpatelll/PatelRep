from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException

from middleware.auth import CurrentUser
from models.requests import (
    CreateGuestRequestRequest,
    CreateGuestRequestSlaPolicyRequest,
    RecordGuestSatisfactionRequest,
)
from routers import guest_requests as guest_requests_router
from services.guest_recovery.contracts import (
    AccessibilityPriorityError,
    InvalidGuestRequestTransition,
    MissingCustodyVerificationError,
    calculate_guest_request_metrics,
    resolve_sla_minutes,
    validate_guest_request_transition,
    validate_lost_found_custody_event,
)
from tests.smoke.fake_supabase import FakeDB


def test_sla_policy_prefers_exact_category_priority_and_guest_impact_match():
    policies = [
        {"category": None, "priority": "normal", "guest_impact": None, "sla_minutes": 240},
        {"category": "accessibility", "priority": "urgent", "guest_impact": "high", "sla_minutes": 30},
    ]

    assert resolve_sla_minutes(
        policies, category="accessibility", priority="urgent", guest_impact="high"
    ) == 30


def test_accessibility_request_requires_urgent_priority():
    with pytest.raises(AccessibilityPriorityError):
        validate_guest_request_transition(
            current_status="open",
            next_status="acknowledged",
            category="accessibility",
            priority="normal",
        )


def test_guest_request_lifecycle_rejects_skipping_required_milestones():
    validate_guest_request_transition(
        current_status="acknowledged",
        next_status="dispatched",
        category="service",
        priority="normal",
    )

    with pytest.raises(InvalidGuestRequestTransition):
        validate_guest_request_transition(
            current_status="acknowledged",
            next_status="verified",
            category="service",
            priority="normal",
        )


def test_lost_found_release_requires_identity_verification():
    with pytest.raises(MissingCustodyVerificationError):
        validate_lost_found_custody_event(
            event_type="released",
            verification_method=None,
            recipient_name="Guest",
        )


def test_guest_recovery_metrics_reconcile_known_fixture_data():
    metrics = calculate_guest_request_metrics([
        {
            "created_at": "2026-07-16T10:00:00+00:00",
            "acknowledged_at": "2026-07-16T10:05:00+00:00",
            "verified_at": "2026-07-16T10:25:00+00:00",
            "due_at": "2026-07-16T10:30:00+00:00",
            "status": "verified",
        },
        {
            "created_at": "2026-07-16T10:00:00+00:00",
            "acknowledged_at": "2026-07-16T10:20:00+00:00",
            "verified_at": None,
            "due_at": "2026-07-16T10:10:00+00:00",
            "status": "resolved",
        },
    ])

    assert metrics == {
        "total_requests": 2,
        "verified_resolution_rate_pct": 50.0,
        "sla_met_rate_pct": 50.0,
        "average_acknowledgement_minutes": 12.5,
        "average_verified_resolution_minutes": 25.0,
    }


def test_phase_five_migration_preserves_auditable_guest_and_custody_records():
    migration = Path(__file__).parents[3] / "supabase" / "migrations" / "072_guest_recovery_and_roi.sql"
    sql = migration.read_text(encoding="utf-8")

    assert "CREATE TABLE public.guest_request_events" in sql
    assert "CREATE TABLE public.guest_messages" in sql
    assert "CREATE TABLE public.accessible_room_features" in sql
    assert "CREATE TABLE public.lost_found_custody_events" in sql
    assert "guest_request_events_immutable" in sql
    assert "lost_found_custody_events_immutable" in sql
    assert "excluded_from_ai" in sql


# --- Plan 05-05 Task 1: SLA policy CRUD ---

GM = CurrentUser(user_id="gm-1", hotel_id="hotel-a", role="gm", email="gm@example.com")
SUPERVISOR = CurrentUser(
    user_id="sup-1", hotel_id="hotel-a", role="housekeeping_supervisor", email="sup@example.com"
)
FRONT_DESK = CurrentUser(user_id="fd-1", hotel_id="hotel-a", role="front_desk", email="fd@example.com")
HOUSEKEEPER = CurrentUser(user_id="hk-1", hotel_id="hotel-a", role="housekeeper", email="hk@example.com")


@pytest.mark.asyncio
async def test_sla_policy_create_requires_manager_role(monkeypatch):
    db = FakeDB({"guest_request_sla_policies": []})
    monkeypatch.setattr(guest_requests_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await guest_requests_router.create_guest_request_sla_policy(
            CreateGuestRequestSlaPolicyRequest(category="housekeeping", sla_minutes=30),
            current_user=FRONT_DESK,
        )

    assert exc.value.status_code == 403
    assert exc.value.detail == "Not authorized to manage SLA rules"
    assert db.inserts == []


@pytest.mark.asyncio
async def test_sla_policy_create_rejects_all_null_dimensions(monkeypatch):
    db = FakeDB({"guest_request_sla_policies": []})
    monkeypatch.setattr(guest_requests_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await guest_requests_router.create_guest_request_sla_policy(
            CreateGuestRequestSlaPolicyRequest(sla_minutes=30),
            current_user=GM,
        )

    assert exc.value.status_code == 422
    assert exc.value.detail == "An SLA rule must set at least one of category, priority, or guest impact"
    assert db.inserts == []


@pytest.mark.asyncio
async def test_sla_policy_create_rejects_duplicate_combination(monkeypatch):
    db = FakeDB({
        "guest_request_sla_policies": [
            {
                "id": "p1", "tenant_id": "hotel-a", "category": "housekeeping",
                "priority": "urgent", "guest_impact": None, "sla_minutes": 30,
            },
        ],
    })
    monkeypatch.setattr(guest_requests_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await guest_requests_router.create_guest_request_sla_policy(
            CreateGuestRequestSlaPolicyRequest(category="housekeeping", priority="urgent", sla_minutes=45),
            current_user=SUPERVISOR,
        )

    assert exc.value.status_code == 409
    assert exc.value.detail == "An SLA rule already exists for this combination"
    assert db.inserts == []


@pytest.mark.asyncio
async def test_sla_policy_list_is_tenant_scoped(monkeypatch):
    db = FakeDB({
        "guest_request_sla_policies": [
            {
                "id": "p1", "tenant_id": "hotel-a", "category": "housekeeping",
                "priority": None, "guest_impact": None, "sla_minutes": 30,
                "created_at": "2026-07-20T10:00:00+00:00",
            },
            {
                "id": "p2", "tenant_id": "hotel-b", "category": "housekeeping",
                "priority": None, "guest_impact": None, "sla_minutes": 90,
                "created_at": "2026-07-20T10:00:00+00:00",
            },
        ],
    })
    monkeypatch.setattr(guest_requests_router, "supabase", db)

    response = await guest_requests_router.list_guest_request_sla_policies(current_user=FRONT_DESK)

    assert [policy["id"] for policy in response["data"]] == ["p1"]


@pytest.mark.asyncio
async def test_sla_policy_delete_other_tenant_returns_404(monkeypatch):
    db = FakeDB({
        "guest_request_sla_policies": [
            {
                "id": "p1", "tenant_id": "hotel-b", "category": "housekeeping",
                "priority": None, "guest_impact": None, "sla_minutes": 30,
            },
        ],
    })
    monkeypatch.setattr(guest_requests_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await guest_requests_router.delete_guest_request_sla_policy("p1", current_user=GM)

    assert exc.value.status_code == 404
    assert db.deletes == []


@pytest.mark.asyncio
async def test_new_request_uses_created_sla_policy_minutes(monkeypatch):
    db = FakeDB({"guest_request_sla_policies": [], "tasks": []})
    monkeypatch.setattr(guest_requests_router, "supabase", db)

    await guest_requests_router.create_guest_request_sla_policy(
        CreateGuestRequestSlaPolicyRequest(category="housekeeping", priority="urgent", sla_minutes=30),
        current_user=GM,
    )

    before = datetime.now(timezone.utc)
    response = await guest_requests_router.create_guest_request(
        CreateGuestRequestRequest(title="AC broken", category="housekeeping", priority="urgent"),
        current_user=FRONT_DESK,
    )
    after = datetime.now(timezone.utc)

    record = response["data"]
    assert record["sla_minutes"] == 30
    due_at = datetime.fromisoformat(record["due_at"])
    assert before + timedelta(minutes=30) <= due_at <= after + timedelta(minutes=30)


# --- Plan 05-05 Task 2: room-status-aware accessible-room-features listing ---


@pytest.mark.asyncio
async def test_accessibility_features_include_room_status(monkeypatch):
    db = FakeDB({
        "accessible_room_features": [
            {
                "id": "f1", "tenant_id": "hotel-a", "room_id": "room-1", "feature_code": "roll_in_shower",
                "operational_status": "operational", "guidance": None, "last_verified_at": None,
                "rooms": {
                    "room_number": "101", "floor": 1,
                    "room_status": {"status": "CLEAN", "updated_at": "2026-07-20T10:00:00+00:00"},
                },
            },
        ],
    })
    monkeypatch.setattr(guest_requests_router, "supabase", db)

    response = await guest_requests_router.list_accessible_room_features(
        feature_code=None, operational_status=None, current_user=FRONT_DESK,
    )

    assert response["data"][0]["room_status"] == "CLEAN"
    assert response["data"][0]["operational_status"] == "operational"


@pytest.mark.asyncio
async def test_accessibility_features_filter_by_feature_code(monkeypatch):
    db = FakeDB({
        "accessible_room_features": [
            {
                "id": "f1", "tenant_id": "hotel-a", "room_id": "room-1", "feature_code": "roll_in_shower",
                "rooms": {"room_number": "101", "floor": 1, "room_status": {"status": "CLEAN"}},
            },
            {
                "id": "f2", "tenant_id": "hotel-a", "room_id": "room-2", "feature_code": "grab_bars",
                "rooms": {"room_number": "102", "floor": 1, "room_status": {"status": "DIRTY"}},
            },
        ],
    })
    monkeypatch.setattr(guest_requests_router, "supabase", db)

    response = await guest_requests_router.list_accessible_room_features(
        feature_code="grab_bars", operational_status=None, current_user=FRONT_DESK
    )

    assert [feature["id"] for feature in response["data"]] == ["f2"]


@pytest.mark.asyncio
async def test_accessibility_features_are_tenant_scoped(monkeypatch):
    db = FakeDB({
        "accessible_room_features": [
            {
                "id": "f1", "tenant_id": "hotel-a", "room_id": "room-1", "feature_code": "roll_in_shower",
                "rooms": {"room_number": "101", "floor": 1, "room_status": {"status": "CLEAN"}},
            },
            {
                "id": "f2", "tenant_id": "hotel-b", "room_id": "room-2", "feature_code": "roll_in_shower",
                "rooms": {"room_number": "201", "floor": 2, "room_status": {"status": "CLEAN"}},
            },
        ],
    })
    monkeypatch.setattr(guest_requests_router, "supabase", db)

    response = await guest_requests_router.list_accessible_room_features(
        feature_code=None, operational_status=None, current_user=FRONT_DESK,
    )

    assert [feature["id"] for feature in response["data"]] == ["f1"]


# --- Plan 05-12 Task 1: satisfaction capture endpoint ---


@pytest.mark.asyncio
async def test_satisfaction_requires_guest_contact_role(monkeypatch):
    db = FakeDB({
        "guest_requests": [
            {"id": "gr-1", "tenant_id": "hotel-a", "status": "resolved", "satisfaction_score": None},
        ],
    })
    monkeypatch.setattr(guest_requests_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await guest_requests_router.record_guest_satisfaction(
            "gr-1", RecordGuestSatisfactionRequest(satisfaction_score=4), current_user=HOUSEKEEPER,
        )

    assert exc.value.status_code == 403
    assert exc.value.detail == "Not authorized to record guest satisfaction"
    assert db.updates == []


@pytest.mark.asyncio
async def test_satisfaction_rejected_before_resolved(monkeypatch):
    db = FakeDB({
        "guest_requests": [
            {"id": "gr-1", "tenant_id": "hotel-a", "status": "acknowledged", "satisfaction_score": None},
        ],
    })
    monkeypatch.setattr(guest_requests_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await guest_requests_router.record_guest_satisfaction(
            "gr-1", RecordGuestSatisfactionRequest(satisfaction_score=4), current_user=FRONT_DESK,
        )

    assert exc.value.status_code == 422
    assert exc.value.detail == "Satisfaction can only be recorded once a request is resolved or verified"
    assert db.updates == []


@pytest.mark.asyncio
async def test_satisfaction_recorded_on_resolved_request(monkeypatch):
    db = FakeDB({
        "guest_requests": [
            {"id": "gr-1", "tenant_id": "hotel-a", "status": "resolved", "satisfaction_score": None},
        ],
        "guest_request_events": [],
    })
    monkeypatch.setattr(guest_requests_router, "supabase", db)

    response = await guest_requests_router.record_guest_satisfaction(
        "gr-1", RecordGuestSatisfactionRequest(satisfaction_score=4), current_user=FRONT_DESK,
    )

    assert response["data"]["satisfaction_score"] == 4


@pytest.mark.asyncio
async def test_satisfaction_recorded_on_verified_request(monkeypatch):
    db = FakeDB({
        "guest_requests": [
            {"id": "gr-1", "tenant_id": "hotel-a", "status": "verified", "satisfaction_score": None},
        ],
        "guest_request_events": [],
    })
    monkeypatch.setattr(guest_requests_router, "supabase", db)

    response = await guest_requests_router.record_guest_satisfaction(
        "gr-1", RecordGuestSatisfactionRequest(satisfaction_score=5), current_user=SUPERVISOR,
    )

    assert response["data"]["satisfaction_score"] == 5


@pytest.mark.asyncio
async def test_satisfaction_rejects_second_capture(monkeypatch):
    db = FakeDB({
        "guest_requests": [
            {"id": "gr-1", "tenant_id": "hotel-a", "status": "verified", "satisfaction_score": 3},
        ],
    })
    monkeypatch.setattr(guest_requests_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await guest_requests_router.record_guest_satisfaction(
            "gr-1", RecordGuestSatisfactionRequest(satisfaction_score=1), current_user=GM,
        )

    assert exc.value.status_code == 409
    assert exc.value.detail == "Satisfaction has already been recorded for this request"
    assert db.updates == []


@pytest.mark.asyncio
async def test_satisfaction_other_tenant_returns_404(monkeypatch):
    db = FakeDB({
        "guest_requests": [
            {"id": "gr-1", "tenant_id": "hotel-b", "status": "resolved", "satisfaction_score": None},
        ],
    })
    monkeypatch.setattr(guest_requests_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await guest_requests_router.record_guest_satisfaction(
            "gr-1", RecordGuestSatisfactionRequest(satisfaction_score=4), current_user=FRONT_DESK,
        )

    assert exc.value.status_code == 404
    assert db.updates == []


@pytest.mark.asyncio
async def test_satisfaction_capture_writes_note_event_with_score(monkeypatch):
    db = FakeDB({
        "guest_requests": [
            {"id": "gr-1", "tenant_id": "hotel-a", "status": "resolved", "satisfaction_score": None},
        ],
        "guest_request_events": [],
    })
    monkeypatch.setattr(guest_requests_router, "supabase", db)

    await guest_requests_router.record_guest_satisfaction(
        "gr-1", RecordGuestSatisfactionRequest(satisfaction_score=4), current_user=FRONT_DESK,
    )

    events = db.rows["guest_request_events"]
    assert len(events) == 1
    assert events[0]["event_type"] == "note"
    assert events[0]["detail"] == "Guest satisfaction recorded"
    assert events[0]["metadata"] == {"satisfaction_score": 4}
