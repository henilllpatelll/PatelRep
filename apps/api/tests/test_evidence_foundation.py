"""Phase 2 evidence-foundation contracts.

As a GM, I need controlled procedures, their acknowledgements, and missing
evidence to produce one trustworthy exception queue for property review.
"""

import io
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, UploadFile

from middleware.auth import CurrentUser
from models.requests import (
    AssignControlledDocumentRequest,
    CreateControlledDocumentRequest,
    CreateEvidenceRecordRequest,
    DocumentLifecycleActionRequest,
    ExceptionActionRequest,
    EvaluateDocumentCompetencyRequest,
    UpdatePropertyApplicabilityRequest,
)
from routers import evidence as evidence_router
from services.evidence.contracts import (
    BRAND_REQUIREMENT_OPTIONS,
    FACILITY_OPTIONS,
    SERVICE_OPTIONS,
    build_exception_queue,
    build_inspector_export_rows,
    build_reminder_actions,
    build_retraining_assignments,
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
        "review_date": "2026-06-01",
        "expiration_date": "2027-01-01",
        "applicability": ["pool"],
        "retention_class": "safety_7_years",
        "document_type": "safety",
        "owner_id": "owner-1",
        "source_sop_document_id": "sop-1",
    }

    successor = create_superseding_version(previous, actor_id="gm-1")

    assert successor == {
        "title": "Pool opening procedure",
        "version_number": 2,
        "approval_state": "draft",
        "supersedes_id": "doc-v1",
        "owner_id": "owner-1",
        "retention_class": "safety_7_years",
        "document_type": "safety",
        "effective_date": "2026-01-01",
        "review_date": "2026-06-01",
        "expiration_date": "2027-01-01",
        "applicability": ["pool"],
        "source_sop_document_id": "sop-1",
        "created_by": "gm-1",
    }


def test_superseding_rejects_a_document_that_is_not_approved():
    with pytest.raises(ValueError, match="approved"):
        create_superseding_version(
            {"id": "doc-v1", "approval_state": "draft", "version_number": 1},
            actor_id="gm-1",
        )


def test_controlled_document_dates_and_lifecycle_reasons_are_validated():
    with pytest.raises(ValueError, match="review_date"):
        CreateControlledDocumentRequest(
            title="Pool opening procedure",
            document_type="safety",
            effective_date="2026-07-20",
            review_date="2026-07-19",
        )

    with pytest.raises(ValueError, match="reason_note"):
        DocumentLifecycleActionRequest(reason_code="override")

    assert DocumentLifecycleActionRequest(reason_code="correction", reason_note="Corrected legal retention date").reason_code == "correction"


@pytest.mark.asyncio
async def test_document_owner_source_and_approver_are_verified_within_the_tenant(monkeypatch):
    from tests.smoke.fake_supabase import FakeDB

    db = FakeDB({
        "user_roles": [
            {"tenant_id": "hotel-1", "user_id": "owner-1", "is_active": True},
            {"tenant_id": "hotel-2", "user_id": "other-owner", "is_active": True},
        ],
        "sop_documents": [{"id": "sop-1", "tenant_id": "hotel-1"}],
        "controlled_documents": [{
            "id": "doc-1", "tenant_id": "hotel-1", "title": "Pool opening",
            "owner_id": "gm-1", "approval_state": "draft", "applicability": [],
        }],
    })
    monkeypatch.setattr(evidence_router, "supabase", db)

    with pytest.raises(HTTPException, match="owner is not active"):
        await evidence_router.create_controlled_document(
            CreateControlledDocumentRequest(
                title="Pool opening procedure", document_type="safety", owner_id="other-owner",
            ),
            _gm(),
        )

    with pytest.raises(HTTPException, match="cannot approve their own"):
        await evidence_router.approve_controlled_document(
            "doc-1", DocumentLifecycleActionRequest(), _gm(),
        )


@pytest.mark.asyncio
async def test_supersession_uses_the_transactional_audit_rpc_with_structured_reason(monkeypatch):
    from tests.smoke.fake_supabase import FakeDB

    class RpcFakeDB(FakeDB):
        def rpc(self, name, params):
            self.rpc_name = name
            self.rpc_params = params
            return SimpleNamespace(execute=lambda: SimpleNamespace(data=[{
                "id": "doc-v2", "tenant_id": "hotel-1", "version_number": 2,
                "approval_state": "draft", "supersedes_id": "doc-v1",
            }]))

    db = RpcFakeDB({
        "property_applicability": [{"tenant_id": "hotel-1", "facilities": [], "services": [], "brand_requirements": []}],
        "controlled_documents": [{
            "id": "doc-v1", "tenant_id": "hotel-1", "title": "Pool procedure",
            "approval_state": "approved", "version_number": 1, "applicability": [],
        }],
    })
    monkeypatch.setattr(evidence_router, "supabase", db)

    response = await evidence_router.supersede_controlled_document(
        "doc-v1",
        DocumentLifecycleActionRequest(reason_code="correction", reason_note="Annual legal review update"),
        _gm(),
    )

    assert response["data"]["supersedes_id"] == "doc-v1"
    assert db.rpc_name == "supersede_controlled_document_with_audit"
    assert db.rpc_params["p_tenant_id"] == "hotel-1"
    assert db.rpc_params["p_reason_code"] == "correction"
    assert db.rpc_params["p_reason_note"] == "Annual legal review update"


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

    db = FakeDB({
        "user_roles": [{"tenant_id": "hotel-1", "user_id": "gm-1", "is_active": True}],
    })
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
        "reason_code": "creation",
        "reason_note": None,
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


@pytest.mark.asyncio
async def test_assignment_requires_an_approved_applicable_document_and_is_duplicate_safe(monkeypatch):
    from tests.smoke.fake_supabase import FakeDB

    db = FakeDB({
        "property_applicability": [{"tenant_id": "hotel-1", "facilities": ["pool"], "services": [], "brand_requirements": []}],
        "controlled_documents": [{
            "id": "doc-1", "tenant_id": "hotel-1", "title": "Pool opening",
            "approval_state": "approved", "applicability": ["pool"],
        }],
        "user_roles": [{"tenant_id": "hotel-1", "user_id": "staff-1", "is_active": True}],
    })
    monkeypatch.setattr(evidence_router, "supabase", db)
    request = AssignControlledDocumentRequest(
        assigned_to="staff-1", due_date="2026-07-20", competency_required=True,
    )

    first = await evidence_router.assign_controlled_document("doc-1", request, _gm())
    duplicate = await evidence_router.assign_controlled_document("doc-1", request, _gm())

    assert first["data"]["id"] == duplicate["data"]["id"]
    assert len(db.rows["document_acknowledgements"]) == 1
    assert db.rows["operational_audit_events"][-1]["action"] == "document_acknowledgement.assigned"

    db.rows["controlled_documents"][0]["approval_state"] = "draft"
    with pytest.raises(HTTPException, match="approved"):
        await evidence_router.assign_controlled_document("doc-1", request, _gm())


@pytest.mark.asyncio
async def test_manager_records_observed_or_quiz_competency_with_pass_fail_audit(monkeypatch):
    from tests.smoke.fake_supabase import FakeDB

    db = FakeDB({"document_acknowledgements": [{
        "id": "assignment-1", "tenant_id": "hotel-1", "document_id": "doc-1",
        "assigned_to": "staff-1", "competency_required": True, "competency_status": "pending",
    }]})
    monkeypatch.setattr(evidence_router, "supabase", db)

    response = await evidence_router.evaluate_document_competency(
        "assignment-1",
        EvaluateDocumentCompetencyRequest(assessment_method="quiz", outcome="failed", notes="Retry floor-safety questions."),
        _gm(),
    )

    assert response["data"]["competency_status"] == "failed"
    assert response["data"]["competency_method"] == "quiz"
    assert db.rows["operational_audit_events"][-1]["action"] == "document_acknowledgement.competency_evaluated"

    route = next(route for route in evidence_router.router.routes if route.path == "/evidence/acknowledgements/{assignment_id}/competency")
    role_check = route.dependant.dependencies[0].call
    with pytest.raises(HTTPException, match="not authorized"):
        await role_check(CurrentUser(user_id="engineer-1", hotel_id="hotel-1", role="engineer"))


def test_retraining_assignments_copy_only_competency_required_staff_to_the_approved_successor():
    assignments = build_retraining_assignments(
        [
            {"id": "required-1", "assigned_to": "staff-1", "competency_required": True},
            {"id": "read-only-1", "assigned_to": "staff-2", "competency_required": False},
        ],
        successor_document_id="doc-v2",
        due_date="2026-08-01",
        assigned_by="gm-1",
    )

    assert assignments == [{
        "document_id": "doc-v2", "assigned_to": "staff-1", "assigned_by": "gm-1",
        "due_date": "2026-08-01", "competency_required": True,
        "competency_status": "pending", "assignment_type": "retraining",
        "retraining_from_assignment_id": "required-1",
    }]


def test_evidence_record_requires_complete_supported_entity_linkage():
    with pytest.raises(ValueError, match="related_entity_id"):
        CreateEvidenceRecordRequest(
            label="Boiler gauge", evidence_type="measurement", related_entity_type="asset"
        )

    with pytest.raises(ValueError, match="related_entity_type"):
        CreateEvidenceRecordRequest(
            label="Boiler gauge", evidence_type="measurement", related_entity_id="asset-1"
        )


@pytest.mark.asyncio
async def test_evidence_creation_validates_linked_records_within_the_tenant(monkeypatch):
    from tests.smoke.fake_supabase import FakeDB

    db = FakeDB({
        "controlled_documents": [{"id": "doc-1", "tenant_id": "hotel-1", "applicability": []}],
        "document_acknowledgements": [{"id": "assignment-1", "tenant_id": "hotel-2", "document_id": "doc-1"}],
        "assets": [{"id": "asset-1", "tenant_id": "hotel-2"}],
    })
    monkeypatch.setattr(evidence_router, "supabase", db)

    with pytest.raises(HTTPException, match="Document assignment not found"):
        await evidence_router.create_evidence_record(
            CreateEvidenceRecordRequest(
                label="Boiler reading", evidence_type="measurement", document_id="doc-1",
                assignment_id="assignment-1",
            ),
            _gm(),
        )

    with pytest.raises(HTTPException, match="Related asset not found"):
        await evidence_router.create_evidence_record(
            CreateEvidenceRecordRequest(
                label="Boiler reading", evidence_type="measurement", related_entity_type="asset",
                related_entity_id="asset-1",
            ),
            _gm(),
        )


@pytest.mark.asyncio
async def test_evidence_upload_uses_opaque_private_path_and_records_an_audit_event(monkeypatch):
    from tests.smoke.fake_supabase import FakeDB

    db = FakeDB({"evidence_records": [{"id": "evidence-1", "tenant_id": "hotel-1"}]})
    monkeypatch.setattr(evidence_router, "supabase", db)
    file = UploadFile(filename="guest-floor-plan.pdf", file=io.BytesIO(b"safe evidence"), headers={"content-type": "application/pdf"})

    response = await evidence_router.upload_evidence_file("evidence-1", file, _gm())

    path = response["data"]["storage_path"]
    assert path.startswith("hotel-1/evidence-1/")
    assert path.endswith(".pdf")
    assert "guest-floor-plan" not in path
    assert response["data"].get("url") is None
    assert db.storage_uploads[0][0] == "evidence-files"
    assert db.rows["operational_audit_events"][0]["action"] == "evidence_record.file_uploaded"


@pytest.mark.asyncio
async def test_evidence_upload_rejects_unsafe_type_and_cross_tenant_record(monkeypatch):
    from tests.smoke.fake_supabase import FakeDB

    db = FakeDB({"evidence_records": [{"id": "evidence-2", "tenant_id": "hotel-2"}]})
    monkeypatch.setattr(evidence_router, "supabase", db)

    with pytest.raises(HTTPException, match="Evidence record not found"):
        await evidence_router.upload_evidence_file(
            "evidence-2",
            UploadFile(filename="proof.pdf", file=io.BytesIO(b"proof"), headers={"content-type": "application/pdf"}),
            _gm(),
        )

    db.rows["evidence_records"] = [{"id": "evidence-1", "tenant_id": "hotel-1"}]
    with pytest.raises(HTTPException, match="PDF, JPEG, PNG, or WebP"):
        await evidence_router.upload_evidence_file(
            "evidence-1",
            UploadFile(filename="proof.exe", file=io.BytesIO(b"proof"), headers={"content-type": "application/octet-stream"}),
            _gm(),
        )


@pytest.mark.asyncio
async def test_evidence_detail_and_signed_url_are_tenant_safe_and_one_hour(monkeypatch):
    from tests.smoke.fake_supabase import FakeDB

    class SignedStorage:
        def __init__(self):
            self.bucket = None
            self.path = None
            self.expires_in = None

        def from_(self, bucket):
            self.bucket = bucket
            return self

        def create_signed_url(self, path, expires_in):
            self.path = path
            self.expires_in = expires_in
            return {"signedURL": "https://signed.test/evidence"}

    db = FakeDB({
        "evidence_records": [
            {"id": "evidence-1", "tenant_id": "hotel-1", "storage_path": "hotel-1/evidence-1/opaque.pdf"},
            {"id": "evidence-2", "tenant_id": "hotel-2", "storage_path": "hotel-2/evidence-2/opaque.pdf"},
        ],
    })
    db.storage = SignedStorage()
    monkeypatch.setattr(evidence_router, "supabase", db)

    detail = await evidence_router.get_evidence_record("evidence-1", _gm())
    signed = await evidence_router.get_evidence_file_url("evidence-1", _gm())

    assert detail["data"].get("signed_url") is None
    assert signed["data"] == {"url": "https://signed.test/evidence", "expires_in_seconds": 3600}
    assert db.storage.bucket == "evidence-files"
    assert db.storage.path == "hotel-1/evidence-1/opaque.pdf"
    assert db.storage.expires_in == 3600

    with pytest.raises(HTTPException, match="Evidence record not found"):
        await evidence_router.get_evidence_record("evidence-2", _gm())


def test_evidence_route_matrix_is_explicit_and_all_mutations_are_role_gated():
    assert evidence_router.EVIDENCE_CAPTURE_ROLES == (
        "housekeeper", "housekeeping_supervisor", "engineer", "chief_engineer", "front_desk", "gm",
    )
    routes = [route for route in evidence_router.router.routes if "POST" in route.methods]
    for path in ("/evidence/records", "/evidence/records/{record_id}/file"):
        dependency = next(route for route in routes if route.path == path).dependant.dependencies[0].call
        with pytest.raises(HTTPException, match="not authorized"):
            import asyncio
            asyncio.run(dependency(CurrentUser(user_id="other", hotel_id="hotel-1", role="unsupported")))


def test_exception_queue_retains_all_six_operational_states_for_a_mixed_property():
    exceptions = build_exception_queue(
        documents=[{"id": "doc-expired", "title": "Pool permit", "approval_state": "approved", "expiration_date": "2026-07-15"}],
        assignments=[
            {"id": "ack-overdue", "due_date": "2026-07-15", "acknowledged_at": None, "document_title": "Fire drill"},
            {"id": "ack-open", "due_date": "2026-07-20", "acknowledged_at": None, "document_title": "Safety briefing"},
        ],
        evidence=[
            {"id": "evidence-missing", "label": "Boiler log", "required_by": "2026-07-15T16:00:00Z", "collected_at": None},
            {"id": "evidence-failed", "label": "Pool test", "result": "failed"},
            {"id": "evidence-deferred", "label": "Elevator certificate", "result": "deferred"},
        ],
        now=NOW,
    )

    assert {item["state"] for item in exceptions} == {
        "missing", "overdue", "expired", "failed", "deferred", "unacknowledged",
    }


def test_inspector_export_rows_include_applicability_documents_staff_evidence_exceptions_and_audit_history():
    rows = build_inspector_export_rows(
        applicability={"facilities": ["pool"], "services": [], "brand_requirements": ["brand_safety"]},
        documents=[{"id": "doc-1", "title": "Pool opening", "version_number": 2, "approval_state": "approved", "retention_class": "safety_7_years"}],
        assignments=[{"id": "ack-1", "document_id": "doc-1", "assigned_to": "staff-1", "acknowledged_at": None, "competency_status": "pending"}],
        evidence=[{"id": "evidence-1", "label": "Pool log", "evidence_type": "checklist_result", "result": "failed"}],
        exceptions=[{"reference_id": "evidence-1", "kind": "evidence", "state": "failed", "label": "Pool log"}],
        actions=[{"reference_id": "evidence-1", "exception_kind": "evidence", "lifecycle_state": "escalated", "owner_id": "gm-1", "reason_code": "safety_risk"}],
        audits=[{"resource_id": "evidence-1", "action": "evidence_exception.escalated", "reason_code": "safety_risk"}],
    )

    assert [row["section"] for row in rows] == [
        "property_applicability", "controlled_document", "acknowledgement_competency",
        "evidence_metadata", "exception", "exception_action", "audit_history",
    ]
    assert rows[-1]["reason_code"] == "safety_risk"


@pytest.mark.asyncio
async def test_gm_exception_action_is_tenant_scoped_and_records_structured_owner_escalation_audit(monkeypatch):
    from tests.smoke.fake_supabase import FakeDB

    db = FakeDB({
        "evidence_records": [{"id": "evidence-1", "tenant_id": "hotel-1", "label": "Pool log"}],
        "user_roles": [{"tenant_id": "hotel-1", "user_id": "owner-1", "is_active": True}],
    })
    monkeypatch.setattr(evidence_router, "supabase", db)

    response = await evidence_router.act_on_evidence_exception(
        "evidence", "evidence-1",
        ExceptionActionRequest(action="escalate", owner_id="owner-1", reason_code="safety_risk", reason_note="Close pool until the test passes."),
        _gm(),
    )

    assert response["data"]["lifecycle_state"] == "escalated"
    assert response["data"]["owner_id"] == "owner-1"
    assert db.rows["operational_audit_events"][-1]["action"] == "evidence_exception.escalated"
    assert db.rows["operational_audit_events"][-1]["reason_code"] == "safety_risk"

    with pytest.raises(HTTPException, match="not found"):
        await evidence_router.act_on_evidence_exception(
            "evidence", "evidence-2",
            ExceptionActionRequest(action="defer", reason_code="vendor_delay", reason_note="Vendor scheduled."),
            _gm(),
        )


@pytest.mark.asyncio
async def test_reminders_are_queued_idempotently_and_retries_only_failed_delivery(monkeypatch):
    from tests.smoke.fake_supabase import FakeDB

    class ReminderDB(FakeDB):
        def __init__(self):
            super().__init__({
                "document_acknowledgements": [{"id": "ack-1", "tenant_id": "hotel-1", "assigned_to": "staff-1", "due_date": "2026-07-15", "acknowledged_at": None}],
                "user_roles": [{"tenant_id": "hotel-1", "user_id": "gm-1", "role": "gm", "is_active": True}],
            })
            self.rpc_calls = []
            self.seen = set()

        def rpc(self, name, params):
            self.rpc_calls.append((name, params))
            key = params["p_idempotency_key"]
            status = "queued" if key not in self.seen else "duplicate"
            self.seen.add(key)
            return SimpleNamespace(execute=lambda: SimpleNamespace(data=[{"outcome": status}]))

    db = ReminderDB()
    monkeypatch.setattr(evidence_router, "supabase", db)

    first = evidence_router.run_evidence_reminders(now=NOW)
    second = evidence_router.run_evidence_reminders(now=NOW)

    assert first == {"queued": 2, "duplicates": 0, "retry_queued": 0}
    assert second == {"queued": 0, "duplicates": 2, "retry_queued": 0}
    assert {name for name, _ in db.rpc_calls} == {"queue_evidence_reminder_delivery"}
    assert all(params["p_channel"] == "in_app" for _, params in db.rpc_calls)
    assert all(params["p_retry_failed"] is True for _, params in db.rpc_calls)


@pytest.mark.asyncio
async def test_inspector_export_is_gm_only_tenant_scoped_and_includes_mixed_state_packet(monkeypatch):
    from tests.smoke.fake_supabase import FakeDB

    db = FakeDB({
        "property_applicability": [{"tenant_id": "hotel-1", "facilities": ["pool"], "services": [], "brand_requirements": []}],
        "controlled_documents": [{"id": "doc-1", "tenant_id": "hotel-1", "title": "Pool opening", "approval_state": "approved", "expiration_date": "2026-07-15", "version_number": 1, "retention_class": "safety_7_years"}],
        "document_acknowledgements": [{"id": "ack-1", "tenant_id": "hotel-1", "document_id": "doc-1", "assigned_to": "staff-1", "due_date": "2026-07-15", "acknowledged_at": None, "competency_status": "pending"}],
        "evidence_records": [{"id": "evidence-1", "tenant_id": "hotel-1", "label": "Pool log", "evidence_type": "checklist_result", "result": "failed"}],
        "evidence_exception_actions": [{"id": "action-1", "tenant_id": "hotel-1", "reference_id": "evidence-1", "exception_kind": "evidence", "lifecycle_state": "escalated", "reason_code": "safety_risk"}],
        "operational_audit_events": [{"id": "audit-1", "tenant_id": "hotel-1", "resource_id": "evidence-1", "action": "evidence_exception.escalated", "reason_code": "safety_risk"}],
    })
    monkeypatch.setattr(evidence_router, "supabase", db)

    response = await evidence_router.export_evidence_packet(_gm())

    assert response.media_type == "text/csv"
    assert "property_applicability" in response.body.decode()
    assert "exception_action" in response.body.decode()
    route = next(route for route in evidence_router.router.routes if route.path == "/evidence/export")
    role_check = route.dependant.dependencies[0].call
    with pytest.raises(HTTPException, match="not authorized"):
        await role_check(CurrentUser(user_id="staff-1", hotel_id="hotel-1", role="housekeeper"))
