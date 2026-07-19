"""Phase 2 evidence-foundation contracts.

As a GM, I need controlled procedures, their acknowledgements, and missing
evidence to produce one trustworthy exception queue for property review.
"""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from middleware.auth import CurrentUser
from models.requests import (
    AssignControlledDocumentRequest,
    CreateControlledDocumentRequest,
    UpdatePropertyApplicabilityRequest,
)
from routers import evidence as evidence_router
from services.evidence.contracts import (
    BRAND_REQUIREMENT_OPTIONS,
    FACILITY_OPTIONS,
    SERVICE_OPTIONS,
    build_exception_queue,
    build_reminder_actions,
    create_superseding_version,
)


NOW = datetime(2026, 7, 16, 16, 0, tzinfo=timezone.utc)


def _gm() -> CurrentUser:
    return CurrentUser(user_id="gm-1", hotel_id="hotel-1", role="gm")


def test_property_applicability_accepts_only_canonical_values():
    request = UpdatePropertyApplicabilityRequest(
        facilities=["pool", "spa", "elevator", "boiler", "cooling_tower"],
        services=["breakfast"],
        brand_requirements=["brand_standard"],
    )

    assert set(request.facilities) <= set(FACILITY_OPTIONS)
    assert set(request.services) <= set(SERVICE_OPTIONS)
    assert set(request.brand_requirements) <= set(BRAND_REQUIREMENT_OPTIONS)

    with pytest.raises(ValueError, match="unsupported property applicability"):
        UpdatePropertyApplicabilityRequest(facilities=["parking"])


@pytest.mark.asyncio
async def test_applicability_update_is_gm_gated_and_tenant_scoped(monkeypatch):
    from tests.smoke.fake_supabase import FakeDB

    db = FakeDB({
        "property_applicability": [
            {"tenant_id": "hotel-2", "facilities": ["pool"], "services": [], "brand_requirements": []},
        ],
    })
    monkeypatch.setattr(evidence_router, "supabase", db)

    route = next(route for route in evidence_router.router.routes if route.path == "/evidence/applicability" and "PUT" in route.methods)
    role_check = route.dependant.dependencies[0].call
    with pytest.raises(HTTPException, match="not authorized"):
        await role_check(CurrentUser(user_id="staff-1", hotel_id="hotel-1", role="housekeeper"))

    response = await evidence_router.update_property_applicability(
        UpdatePropertyApplicabilityRequest(facilities=["pool"], services=["breakfast"]),
        _gm(),
    )

    assert response["data"]["tenant_id"] == "hotel-1"
    assert db.rows["property_applicability"] == [
        {"tenant_id": "hotel-2", "facilities": ["pool"], "services": [], "brand_requirements": []},
        {"id": "property_applicability-1", "tenant_id": "hotel-1", "facilities": ["pool"], "services": ["breakfast"], "brand_requirements": [], "updated_by": "gm-1"},
    ]
    assert db.rows["operational_audit_events"][0]["tenant_id"] == "hotel-1"


@pytest.mark.asyncio
async def test_non_applicable_document_cannot_be_assigned(monkeypatch):
    from tests.smoke.fake_supabase import FakeDB

    db = FakeDB({
        "property_applicability": [{
            "tenant_id": "hotel-1", "facilities": ["spa"], "services": [], "brand_requirements": [],
        }],
        "controlled_documents": [{
            "id": "pool-procedure", "tenant_id": "hotel-1", "title": "Pool opening", "applicability": ["pool"],
        }],
        "user_roles": [{"tenant_id": "hotel-1", "user_id": "engineer-1", "is_active": True}],
    })
    monkeypatch.setattr(evidence_router, "supabase", db)

    with pytest.raises(HTTPException, match="not applicable"):
        await evidence_router.assign_controlled_document(
            "pool-procedure",
            AssignControlledDocumentRequest(assigned_to="engineer-1", due_date="2026-07-20"),
            _gm(),
        )

    assert db.rows.get("document_acknowledgements", []) == []


@pytest.mark.asyncio
async def test_document_list_hides_obligations_not_applicable_to_property(monkeypatch):
    from tests.smoke.fake_supabase import FakeDB

    db = FakeDB({
        "property_applicability": [{
            "tenant_id": "hotel-1", "facilities": ["pool"], "services": [], "brand_requirements": [],
        }],
        "controlled_documents": [
            {"id": "pool-procedure", "tenant_id": "hotel-1", "title": "Pool opening", "applicability": ["pool"]},
            {"id": "spa-procedure", "tenant_id": "hotel-1", "title": "Spa opening", "applicability": ["spa"]},
            {"id": "all-properties", "tenant_id": "hotel-1", "title": "Emergency contacts", "applicability": []},
            {"id": "other-tenant", "tenant_id": "hotel-2", "title": "Other hotel pool", "applicability": ["pool"]},
        ],
    })
    monkeypatch.setattr(evidence_router, "supabase", db)

    response = await evidence_router.list_controlled_documents(_gm())

    assert {document["id"] for document in response["data"]} == {"all-properties", "pool-procedure"}


def test_superseding_an_approved_document_preserves_controlled_history():
    previous = {
        "id": "doc-v1",
        "title": "Pool opening procedure",
        "version_number": 1,
        "approval_state": "approved",
        "effective_date": "2026-01-01",
        "retention_class": "safety_7_years",
    }

    successor = create_superseding_version(previous, actor_id="gm-1")

    assert successor == {
        "title": "Pool opening procedure",
        "version_number": 2,
        "approval_state": "draft",
        "supersedes_id": "doc-v1",
        "owner_id": "gm-1",
        "retention_class": "safety_7_years",
    }


def test_superseding_rejects_a_document_that_is_not_approved():
    with pytest.raises(ValueError, match="approved"):
        create_superseding_version(
            {"id": "doc-v1", "approval_state": "draft", "version_number": 1},
            actor_id="gm-1",
        )


def test_exception_queue_combines_expired_documents_missing_evidence_and_overdue_acknowledgements():
    exceptions = build_exception_queue(
        documents=[
            {
                "id": "expired-doc",
                "title": "Elevator emergency procedure",
                "expiration_date": "2026-07-15",
                "approval_state": "approved",
            }
        ],
        assignments=[
            {
                "id": "assignment-1",
                "document_id": "expired-doc",
                "document_title": "Elevator emergency procedure",
                "assigned_to": "engineer-1",
                "due_date": "2026-07-14",
                "acknowledged_at": None,
            }
        ],
        evidence=[
            {
                "id": "evidence-1",
                "label": "Monthly elevator certificate",
                "expires_at": "2026-07-10T00:00:00+00:00",
            },
            {
                "id": "evidence-2",
                "label": "Pool safety test",
                "required_by": "2026-07-15T00:00:00+00:00",
                "collected_at": None,
            },
        ],
        now=NOW,
    )

    assert [(item["state"], item["reference_id"]) for item in exceptions] == [
        ("expired", "expired-doc"),
        ("overdue", "assignment-1"),
        ("expired", "evidence-1"),
        ("missing", "evidence-2"),
    ]


def test_reminder_actions_target_staff_then_gm_when_an_acknowledgement_becomes_overdue():
    actions = build_reminder_actions(
        [
            {
                "id": "due-soon",
                "assigned_to": "staff-1",
                "due_date": (NOW.date() + timedelta(days=1)).isoformat(),
                "acknowledged_at": None,
            },
            {
                "id": "overdue",
                "assigned_to": "staff-2",
                "due_date": (NOW.date() - timedelta(days=2)).isoformat(),
                "acknowledged_at": None,
            },
            {
                "id": "done",
                "assigned_to": "staff-3",
                "due_date": (NOW.date() - timedelta(days=3)).isoformat(),
                "acknowledged_at": NOW.isoformat(),
            },
        ],
        now=NOW,
    )

    assert actions == [
        {"assignment_id": "due-soon", "recipient_type": "staff", "recipient_id": "staff-1", "state": "due_soon"},
        {"assignment_id": "overdue", "recipient_type": "staff", "recipient_id": "staff-2", "state": "overdue"},
        {"assignment_id": "overdue", "recipient_type": "role", "recipient_role": "gm", "state": "overdue"},
    ]


def test_exception_queue_keeps_failed_deferred_and_not_yet_due_records_visible():
    exceptions = build_exception_queue(
        documents=[],
        assignments=[{"id": "pending", "assigned_to": "staff-1", "due_date": "2026-07-20", "acknowledged_at": None}],
        evidence=[
            {"id": "failed", "label": "Fire-door check", "result": "failed"},
            {"id": "deferred", "label": "Vendor certificate", "result": "deferred"},
        ],
        now=NOW,
    )

    assert [(item["state"], item["reference_id"]) for item in exceptions] == [
        ("unacknowledged", "pending"), ("failed", "failed"), ("deferred", "deferred"),
    ]


@pytest.mark.asyncio
async def test_document_creation_persists_tenant_and_append_only_actor_audit(monkeypatch):
    from tests.smoke.fake_supabase import FakeDB

    db = FakeDB()
    monkeypatch.setattr(evidence_router, "supabase", db)

    response = await evidence_router.create_controlled_document(
        CreateControlledDocumentRequest(
            title="Pool opening procedure",
            document_type="safety",
            retention_class="safety_7_years",
        ),
        _gm(),
    )

    assert response["data"]["tenant_id"] == "hotel-1"
    assert db.rows["operational_audit_events"] == [{
        "id": "operational_audit_events-2",
        "tenant_id": "hotel-1",
        "resource_type": "controlled_document",
        "resource_id": "controlled_documents-1",
        "action": "controlled_document.created",
        "actor_id": "gm-1",
        "actor_role": "gm",
        "old_state": {},
        "new_state": {"approval_state": "draft", "version_number": 1},
        "source": "api",
    }]


@pytest.mark.asyncio
async def test_acknowledgement_cannot_be_read_or_changed_by_another_staff_member(monkeypatch):
    from tests.smoke.fake_supabase import FakeDB

    db = FakeDB({
        "document_acknowledgements": [{
            "id": "assignment-1", "tenant_id": "hotel-1", "assigned_to": "staff-1",
            "acknowledged_at": None,
        }],
    })
    monkeypatch.setattr(evidence_router, "supabase", db)

    with pytest.raises(HTTPException, match="Document assignment not found"):
        await evidence_router.acknowledge_controlled_document(
            "assignment-1",
            CurrentUser(user_id="staff-2", hotel_id="hotel-1", role="housekeeper"),
        )
