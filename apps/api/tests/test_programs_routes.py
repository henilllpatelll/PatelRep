"""Route-level contracts for the maintenance/housekeeping programs domain.

Proves the LIVE programs.py router (and the pm-completion path it shares
with assets.py) obey the locked cross-phase contracts: manager-only reads,
correct RBAC including chief_engineer, tenant isolation on PM schedules,
and bug-449 None-safety on maybe_single() reads.

Mirrors the TestClient + real-JWT harness used in
tests/smoke/test_tenant_isolation.py for true HTTP-level RBAC checks, and
the direct-router-call + FakeDB harness used in test_evidence_foundation.py
for logic/tenant-isolation checks that need database-state assertions.
"""

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from main import app
from middleware.auth import CurrentUser
from models.requests import CompletePMProgramRequest
from routers import assets as assets_router
from routers import evidence as evidence_router
from routers import programs as programs_router
from tests.smoke.fake_supabase import FakeDB


def _auth_header(role: str, hotel_id: str = "hotel-a", user_id: str = "user-a-1") -> dict[str, str]:
    payload = {"sub": user_id, "role": role, "hotel_id": hotel_id, "aud": "authenticated"}
    token = jwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def _pm_complete_payload() -> dict:
    return {"items": [{"key": "check", "label": "Visual check", "result": "passed"}]}


def test_overview_requires_manager_role(monkeypatch):
    """A housekeeper cannot read the program overview (DND policy, pars, sampling rules)."""
    monkeypatch.setattr(programs_router, "supabase", FakeDB())
    client = TestClient(app)

    response = client.get("/v1/programs/overview", headers=_auth_header("housekeeper"))

    assert response.status_code == 403


def test_overview_allows_manager(monkeypatch):
    """gm and chief_engineer can read the program overview."""
    monkeypatch.setattr(programs_router, "supabase", FakeDB())
    client = TestClient(app)

    for role in ("gm", "chief_engineer"):
        response = client.get("/v1/programs/overview", headers=_auth_header(role))
        assert response.status_code == 200, f"{role} should be able to read the program overview"


def test_pm_complete_rbac(monkeypatch):
    """housekeeper is blocked from PM completion; engineer/chief_engineer/gm can complete."""
    db = FakeDB({
        "pm_schedules": [{"id": "sched-1", "tenant_id": "hotel-a", "asset_id": "asset-1", "interval_days": 30}],
    })
    monkeypatch.setattr(assets_router, "supabase", db)
    client = TestClient(app)

    housekeeper_response = client.post(
        "/v1/assets/pm-schedules/sched-1/complete",
        headers=_auth_header("housekeeper"),
        json=_pm_complete_payload(),
    )
    assert housekeeper_response.status_code == 403

    for role in ("engineer", "chief_engineer", "gm"):
        response = client.post(
            "/v1/assets/pm-schedules/sched-1/complete",
            headers=_auth_header(role),
            json=_pm_complete_payload(),
        )
        assert response.status_code != 403, f"{role} should be allowed to reach the PM-complete handler"


@pytest.mark.asyncio
async def test_cross_tenant_pm_schedule_404(monkeypatch):
    """A PM schedule owned by tenant B is invisible to tenant A and no completion row is written."""
    db = FakeDB({
        "pm_schedules": [{"id": "sched-b", "tenant_id": "hotel-b", "asset_id": "asset-b", "interval_days": 30}],
    })
    monkeypatch.setattr(assets_router, "supabase", db)

    with pytest.raises(HTTPException) as exc:
        await assets_router.complete_pm_schedule(
            "sched-b",
            CompletePMProgramRequest(items=[{"key": "check", "label": "Visual check", "result": "passed"}]),
            current_user=CurrentUser(user_id="user-a-1", hotel_id="hotel-a", role="gm"),
        )

    assert exc.value.status_code == 404
    assert db.rows.get("pm_completion_records", []) == []


class _NoneReturningQuery:
    """Mirrors the real supabase-py shape: maybe_single().execute() returns None outright
    (not an object whose .data is None) when there is no matching row (bug-449)."""

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def maybe_single(self):
        return self

    def execute(self):
        return None


class _NoneReturningDB:
    def table(self, _name):
        return _NoneReturningQuery()


def test_maybe_single_none_returns_404_not_500(monkeypatch):
    """_get_pm_schedule must not raise AttributeError when maybe_single() returns None outright."""
    monkeypatch.setattr(programs_router, "supabase", _NoneReturningDB())

    with pytest.raises(HTTPException) as exc:
        programs_router._get_pm_schedule(
            "missing-sched",
            CurrentUser(user_id="user-a-1", hotel_id="hotel-a", role="gm"),
        )

    assert exc.value.status_code == 404


# --- PM completion evidence linkage (D-06, G1) ---

def test_pm_completion_returns_signed_urls(monkeypatch):
    """A completion's attachments read back as short-lived signed URLs, never a raw storage_path."""
    db = FakeDB({
        "pm_schedules": [{"id": "sched-1", "tenant_id": "hotel-a", "asset_id": "asset-1", "interval_days": 30}],
        "evidence_records": [
            {"id": "evidence-1", "tenant_id": "hotel-a", "storage_path": "hotel-a/evidence-1/proof.jpg", "file_name": "proof.jpg"},
        ],
    })
    monkeypatch.setattr(assets_router, "supabase", db)
    monkeypatch.setattr(evidence_router, "supabase", db)
    client = TestClient(app)

    complete_response = client.post(
        "/v1/assets/pm-schedules/sched-1/complete",
        headers=_auth_header("gm"),
        json={
            "photos": ["evidence-1"],
            "items": [{"key": "check", "label": "Visual check", "result": "passed"}],
        },
    )
    assert complete_response.status_code == 200
    completion_id = complete_response.json()["data"]["id"]

    read_response = client.get(
        f"/v1/assets/pm-schedules/sched-1/completions/{completion_id}",
        headers=_auth_header("gm"),
    )
    assert read_response.status_code == 200
    body = read_response.json()["data"]

    assert body["photos"][0]["url"].startswith("https://storage.test/signed/evidence-files/")
    assert "token=fake" in body["photos"][0]["url"]
    assert "storage_path" not in body["photos"][0]
    assert "storage_path" not in read_response.text


def test_cross_tenant_evidence_rejected(monkeypatch):
    """An evidence_record owned by tenant B cannot be attached to a tenant-A completion."""
    db = FakeDB({
        "pm_schedules": [{"id": "sched-1", "tenant_id": "hotel-a", "asset_id": "asset-1", "interval_days": 30}],
        "evidence_records": [{"id": "evidence-b", "tenant_id": "hotel-b"}],
    })
    monkeypatch.setattr(assets_router, "supabase", db)
    client = TestClient(app)

    response = client.post(
        "/v1/assets/pm-schedules/sched-1/complete",
        headers=_auth_header("gm"),
        json={
            "photos": ["evidence-b"],
            "items": [{"key": "check", "label": "Visual check", "result": "passed"}],
        },
    )

    assert response.status_code == 422
    assert db.rows.get("pm_completion_records", []) == []


def test_evidence_required_item_422_route(monkeypatch):
    """A controlled checklist item with requires_evidence and no evidence is rejected at the route."""
    db = FakeDB({
        "pm_schedules": [{"id": "sched-1", "tenant_id": "hotel-a", "asset_id": "asset-1", "interval_days": 30}],
    })
    monkeypatch.setattr(assets_router, "supabase", db)
    client = TestClient(app)

    response = client.post(
        "/v1/assets/pm-schedules/sched-1/complete",
        headers=_auth_header("gm"),
        json={
            "items": [{"key": "gauge", "label": "Pressure gauge", "result": "passed", "requires_evidence": True}],
        },
    )

    assert response.status_code == 422
    assert db.rows.get("pm_completion_records", []) == []


# --- PM deferral separation of duty + containment audit (G2, G4, G8) ---

def _deferral_payload(approved_by: str) -> dict:
    return {
        "reason": "Vendor unavailable until next week",
        "deferred_until": "2026-08-01T00:00:00Z",
        "approved_by": approved_by,
    }


def test_deferral_self_approval_rejected(monkeypatch):
    """D-07: approved_by == requester is rejected with 422 and writes zero pm_deferrals rows."""
    db = FakeDB({
        "pm_schedules": [{"id": "sched-1", "tenant_id": "hotel-a", "asset_id": "asset-1", "interval_days": 30}],
    })
    monkeypatch.setattr(programs_router, "supabase", db)
    client = TestClient(app)

    response = client.post(
        "/v1/programs/pm-schedules/sched-1/deferrals",
        headers=_auth_header("gm", user_id="user-a-1"),
        json=_deferral_payload("user-a-1"),
    )

    assert response.status_code == 422
    assert db.rows.get("pm_deferrals", []) == []


def test_deferral_approval_writes_audit(monkeypatch):
    """A distinct, active approver succeeds and writes one pm_deferral.approved audit event."""
    db = FakeDB({
        "pm_schedules": [{"id": "sched-1", "tenant_id": "hotel-a", "asset_id": "asset-1", "interval_days": 30}],
        "user_roles": [{"tenant_id": "hotel-a", "user_id": "user-a-2", "is_active": True}],
    })
    monkeypatch.setattr(programs_router, "supabase", db)
    client = TestClient(app)

    response = client.post(
        "/v1/programs/pm-schedules/sched-1/deferrals",
        headers=_auth_header("gm", user_id="user-a-1"),
        json=_deferral_payload("user-a-2"),
    )

    assert response.status_code == 200
    deferral_id = response.json()["data"]["id"]
    audit_events = [
        row for row in db.rows.get("operational_audit_events", [])
        if row["action"] == "pm_deferral.approved"
    ]
    assert len(audit_events) == 1
    assert audit_events[0]["resource_id"] == deferral_id
    assert audit_events[0]["reason_code"] == "pm_deferral"


def test_deferral_inactive_approver_rejected(monkeypatch):
    """An approver not active at this tenant is rejected with 404, zero pm_deferrals rows."""
    db = FakeDB({
        "pm_schedules": [{"id": "sched-1", "tenant_id": "hotel-a", "asset_id": "asset-1", "interval_days": 30}],
        "user_roles": [{"tenant_id": "hotel-a", "user_id": "user-a-2", "is_active": False}],
    })
    monkeypatch.setattr(programs_router, "supabase", db)
    client = TestClient(app)

    response = client.post(
        "/v1/programs/pm-schedules/sched-1/deferrals",
        headers=_auth_header("gm", user_id="user-a-1"),
        json=_deferral_payload("user-a-2"),
    )

    assert response.status_code == 404
    assert db.rows.get("pm_deferrals", []) == []


def test_failed_check_writes_containment_audit(monkeypatch):
    """A failed PM checklist item creates a corrective WO AND an append-only containment
    audit event (G2/T-04-11), not just the follow-up work order."""
    db = FakeDB({
        "pm_schedules": [{"id": "sched-1", "tenant_id": "hotel-a", "asset_id": "asset-1", "interval_days": 30}],
    })
    monkeypatch.setattr(assets_router, "supabase", db)
    client = TestClient(app)

    response = client.post(
        "/v1/assets/pm-schedules/sched-1/complete",
        headers=_auth_header("engineer"),
        json={
            "items": [{"key": "check", "label": "Fire extinguisher pressure", "result": "failed", "note": "Low pressure"}],
        },
    )

    assert response.status_code == 200
    completion_id = response.json()["data"]["id"]
    assert db.rows["work_orders"][0]["pm_completion_id"] == completion_id
    assert db.rows["work_orders"][0]["due_at"]

    containment_events = [
        row for row in db.rows.get("operational_audit_events", [])
        if row["action"] == "pm_check.failed_containment"
    ]
    assert len(containment_events) == 1
    assert containment_events[0]["resource_id"] == completion_id
    assert containment_events[0]["reason_code"] == "failed_check"
    assert containment_events[0]["new_state"]["work_order_id"] == db.rows["work_orders"][0]["id"]


# --- Template library: applicability gating, editor, generic builder (D-05, G5, PM-08) ---

def _template_items_payload() -> list[dict]:
    return [
        {"key": "gauge_in_range", "label": "Pressure gauge reads in the operable range", "requires_evidence": False},
        {"key": "tag_signed_photo", "label": "Inspection tag signed and dated", "requires_evidence": True},
    ]


def test_initialize_gated(monkeypatch):
    """A property without the 'pool' facility does not get pool_check seeded; a property
    that has 'pool' configured does."""
    db_without_pool = FakeDB({
        "property_applicability": [{"tenant_id": "hotel-a", "facilities": []}],
    })
    monkeypatch.setattr(programs_router, "supabase", db_without_pool)
    client = TestClient(app)

    response = client.post("/v1/programs/templates/initialize", headers=_auth_header("gm"))
    assert response.status_code == 200
    codes_without_pool = {row["code"] for row in db_without_pool.rows.get("pm_checklist_templates", [])}
    assert "pool_check" not in codes_without_pool
    assert "fire_extinguisher" in codes_without_pool
    assert len(db_without_pool.rows["pm_checklist_templates"][0]["items"]["checklist"]) > 1

    db_with_pool = FakeDB({
        "property_applicability": [{"tenant_id": "hotel-a", "facilities": ["pool"]}],
    })
    monkeypatch.setattr(programs_router, "supabase", db_with_pool)

    response = client.post("/v1/programs/templates/initialize", headers=_auth_header("gm"))
    assert response.status_code == 200
    codes_with_pool = {row["code"] for row in db_with_pool.rows.get("pm_checklist_templates", [])}
    assert "pool_check" in codes_with_pool


def test_edit_template(monkeypatch):
    """A manager can update a template's frequency and checklist items in place."""
    db = FakeDB({
        "pm_checklist_templates": [{
            "id": "tmpl-1", "tenant_id": "hotel-a", "code": "fire_extinguisher",
            "program_area": "engineering", "name": "Fire extinguisher inspection", "name_es": None,
            "version": 1, "items": {"checklist": [], "default_frequency_days": 30}, "is_active": True,
        }],
    })
    monkeypatch.setattr(programs_router, "supabase", db)
    client = TestClient(app)

    response = client.put(
        "/v1/programs/templates/tmpl-1",
        headers=_auth_header("gm"),
        json={"items": _template_items_payload(), "default_frequency_days": 60},
    )

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["items"]["default_frequency_days"] == 60
    assert len(body["items"]["checklist"]) == 2
    assert db.rows["pm_checklist_templates"][0]["id"] == "tmpl-1"


def test_generic_builder(monkeypatch):
    """A manager can build a custom template for an obligation outside the 9 named ones,
    and a duplicate code is rejected with 409."""
    db = FakeDB()
    monkeypatch.setattr(programs_router, "supabase", db)
    client = TestClient(app)

    payload = {
        "code": "ice_machine_sanitation",
        "program_area": "engineering",
        "name": "Ice machine sanitation",
        "items": _template_items_payload(),
        "default_frequency_days": 90,
    }
    response = client.post("/v1/programs/templates", headers=_auth_header("gm"), json=payload)
    assert response.status_code == 200
    body = response.json()["data"]
    assert body["code"] == "ice_machine_sanitation"
    assert body["program_area"] == "engineering"

    dup_response = client.post("/v1/programs/templates", headers=_auth_header("gm"), json=payload)
    assert dup_response.status_code == 409


def test_edit_rbac(monkeypatch):
    """A housekeeper cannot edit an existing template or create a new one."""
    db = FakeDB({
        "pm_checklist_templates": [{
            "id": "tmpl-1", "tenant_id": "hotel-a", "code": "fire_extinguisher",
            "items": {"checklist": [], "default_frequency_days": 30},
        }],
    })
    monkeypatch.setattr(programs_router, "supabase", db)
    client = TestClient(app)

    edit_response = client.put(
        "/v1/programs/templates/tmpl-1",
        headers=_auth_header("housekeeper"),
        json={"items": _template_items_payload()},
    )
    assert edit_response.status_code == 403

    create_response = client.post(
        "/v1/programs/templates",
        headers=_auth_header("housekeeper"),
        json={
            "code": "custom_x", "program_area": "engineering", "name": "Custom obligation",
            "items": _template_items_payload(),
        },
    )
    assert create_response.status_code == 403
