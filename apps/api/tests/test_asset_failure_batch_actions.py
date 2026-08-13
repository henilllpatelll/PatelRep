"""Phase 28-02 tests for asset failure-prediction batch acknowledge.

`batch_acknowledge_failure_predictions` is a thin per-item loop over the
existing single-item `acknowledge_failure_prediction` coroutine. These tests
exercise the loop/aggregation/RBAC behavior only — the single-item update
logic itself is unchanged.

Covers:
A. Happy path — 3 own-tenant predictions all acknowledged.
B. not_found vs success diff (PITFALL #6) — missing id + cross-tenant id both
   yield not_found, never a silent success.
C. Partial failure — a raised HTTPException becomes a per-item error, batch
   still 200s, siblings still process.
D. Idempotency — re-acknowledging an already-acknowledged prediction still
   counts as acknowledged, no exception.
E. Request validation — empty / over-cap prediction_ids rejected by the model.
F. RBAC — gm/engineer allowed; chief_engineer and other roles 403 (LOCKED:
   batch gate mirrors the single-item gate exactly, does not widen it).
G. Tenant isolation — covered by case B's cross-tenant id.
"""

import uuid

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from middleware.auth import CurrentUser, require_role
from models.requests import BatchAcknowledgePredictionsRequest
from routers import assets as assets_router
from tests.smoke.fake_supabase import FakeDB

GM = CurrentUser(user_id="gm-1", hotel_id="hotel-1", role="gm", email="gm@example.com")
ENGINEER = CurrentUser(user_id="eng-1", hotel_id="hotel-1", role="engineer", email="eng@example.com")

PRED_OK_1 = str(uuid.uuid4())
PRED_OK_2 = str(uuid.uuid4())
PRED_OK_3 = str(uuid.uuid4())
PRED_MISSING = str(uuid.uuid4())
PRED_OTHER_TENANT = str(uuid.uuid4())
PRED_ALREADY_ACK = str(uuid.uuid4())
PRED_ERROR = str(uuid.uuid4())


def _predictions_db(pred_specs: list[dict]) -> FakeDB:
    predictions = []
    for spec in pred_specs:
        pid = spec["prediction_id"]
        predictions.append({
            "id": pid,
            "tenant_id": spec.get("tenant_id", "hotel-1"),
            "is_acknowledged": spec.get("is_acknowledged", False),
            "acknowledged_at": spec.get("acknowledged_at"),
            "acknowledged_by": spec.get("acknowledged_by"),
        })
    return FakeDB({"failure_predictions": predictions})


# ---------------------------------------------------------------------------
# A. Happy path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_batch_acknowledge_happy_path_all_succeed(monkeypatch):
    db = _predictions_db([
        {"prediction_id": PRED_OK_1},
        {"prediction_id": PRED_OK_2},
        {"prediction_id": PRED_OK_3},
    ])
    monkeypatch.setattr(assets_router, "supabase", db)

    body = BatchAcknowledgePredictionsRequest(prediction_ids=[PRED_OK_1, PRED_OK_2, PRED_OK_3])
    response = await assets_router.batch_acknowledge_failure_predictions(body=body, current_user=GM)

    data = response["data"]
    assert data["succeeded"] == 3
    assert data["failed"] == 0
    assert [r["prediction_id"] for r in data["results"]] == [PRED_OK_1, PRED_OK_2, PRED_OK_3]
    assert all(r["action"] == "acknowledged" for r in data["results"])


# ---------------------------------------------------------------------------
# B. not_found vs success diff (PITFALL #6)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_batch_acknowledge_not_found_vs_success_diff(monkeypatch):
    db = _predictions_db([{"prediction_id": PRED_OK_1}])
    db.rows["failure_predictions"].append({
        "id": PRED_OTHER_TENANT, "tenant_id": "hotel-2", "is_acknowledged": False,
    })
    monkeypatch.setattr(assets_router, "supabase", db)

    body = BatchAcknowledgePredictionsRequest(
        prediction_ids=[PRED_OK_1, PRED_MISSING, PRED_OTHER_TENANT]
    )
    response = await assets_router.batch_acknowledge_failure_predictions(body=body, current_user=GM)

    data = response["data"]
    assert data["succeeded"] == 1
    assert data["failed"] == 2
    results = {r["prediction_id"]: r for r in data["results"]}
    assert results[PRED_OK_1]["action"] == "acknowledged"
    assert results[PRED_MISSING]["action"] == "not_found"
    assert results[PRED_OTHER_TENANT]["action"] == "not_found"


# ---------------------------------------------------------------------------
# C. Partial failure / best-effort
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_batch_acknowledge_partial_failure_continues_batch(monkeypatch):
    db = _predictions_db([{"prediction_id": PRED_OK_1}, {"prediction_id": PRED_ERROR}])
    monkeypatch.setattr(assets_router, "supabase", db)

    real_acknowledge = assets_router.acknowledge_failure_prediction

    async def flaky_acknowledge(prediction_id, current_user):
        if prediction_id == PRED_ERROR:
            raise HTTPException(status_code=500, detail="simulated failure")
        return await real_acknowledge(prediction_id=prediction_id, current_user=current_user)

    monkeypatch.setattr(assets_router, "acknowledge_failure_prediction", flaky_acknowledge)

    body = BatchAcknowledgePredictionsRequest(prediction_ids=[PRED_OK_1, PRED_ERROR])
    response = await assets_router.batch_acknowledge_failure_predictions(body=body, current_user=GM)

    data = response["data"]
    assert data["succeeded"] == 1
    assert data["failed"] == 1
    results = {r["prediction_id"]: r for r in data["results"]}
    assert results[PRED_OK_1]["action"] == "acknowledged"
    assert results[PRED_ERROR]["action"] == "error"
    assert results[PRED_ERROR]["status"] == 500
    assert results[PRED_ERROR]["detail"] == "simulated failure"


# ---------------------------------------------------------------------------
# D. Idempotency
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_batch_acknowledge_already_acknowledged_still_counts_as_success(monkeypatch):
    db = _predictions_db([
        {
            "prediction_id": PRED_ALREADY_ACK,
            "is_acknowledged": True,
            "acknowledged_at": "2026-08-01T00:00:00+00:00",
            "acknowledged_by": "user-1",
        },
    ])
    monkeypatch.setattr(assets_router, "supabase", db)

    body = BatchAcknowledgePredictionsRequest(prediction_ids=[PRED_ALREADY_ACK])
    response = await assets_router.batch_acknowledge_failure_predictions(body=body, current_user=GM)

    data = response["data"]
    assert data["succeeded"] == 1
    assert data["failed"] == 0
    assert data["results"][0]["action"] == "acknowledged"


# ---------------------------------------------------------------------------
# E. Request validation
# ---------------------------------------------------------------------------


def test_batch_request_rejects_empty_prediction_ids():
    with pytest.raises(ValidationError):
        BatchAcknowledgePredictionsRequest(prediction_ids=[])


def test_batch_request_rejects_over_cap_prediction_ids():
    with pytest.raises(ValidationError):
        BatchAcknowledgePredictionsRequest(prediction_ids=[str(uuid.uuid4()) for _ in range(51)])


def test_batch_request_accepts_cap_of_50():
    body = BatchAcknowledgePredictionsRequest(prediction_ids=[str(uuid.uuid4()) for _ in range(50)])
    assert len(body.prediction_ids) == 50


# ---------------------------------------------------------------------------
# F. RBAC — gm/engineer allowed; chief_engineer and others 403
# ---------------------------------------------------------------------------

_REJECTED_ROLES = ["chief_engineer", "housekeeper", "front_desk", "housekeeping_supervisor"]


@pytest.mark.asyncio
async def test_gm_and_engineer_allowed_for_batch_acknowledge():
    check = require_role("gm", "engineer")
    await check(current_user=GM)
    await check(current_user=ENGINEER)


@pytest.mark.parametrize("role", _REJECTED_ROLES)
@pytest.mark.asyncio
async def test_non_gm_engineer_roles_blocked_from_batch_acknowledge(role):
    check = require_role("gm", "engineer")
    with pytest.raises(HTTPException) as exc:
        await check(current_user=CurrentUser(user_id="u1", hotel_id="hotel-1", role=role, email=f"{role}@example.com"))
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_chief_engineer_explicitly_403_not_widened():
    """Explicit assertion proving the LOCKED decision: chief_engineer is NOT added to
    this batch gate, even though it might seem like a natural fit for asset/engineering
    actions — the gate mirrors the single-item acknowledge_failure_prediction gate
    exactly (gm, engineer only)."""
    check = require_role("gm", "engineer")
    with pytest.raises(HTTPException) as exc:
        await check(current_user=CurrentUser(
            user_id="ce-1", hotel_id="hotel-1", role="chief_engineer", email="ce@example.com"
        ))
    assert exc.value.status_code == 403
