"""Phase 29-04 tests for asset-failure single-item action escalation-watermark reset.

`acknowledge_failure_prediction` and `create_work_order_from_prediction` are the
two human-action paths (besides the prediction engine's own risk-drop carry-forward
handled in Plan 29-02) that must stop AI-13's GM-escalation clock the instant a
human engages with a HIGH-risk asset-failure prediction.

Covers:
A. Acknowledge resets escalation_level/high_risk_since alongside the existing
   ack-column behavior.
B. create_work_order_from_prediction resets the same two columns as a side
   effect of creating a work order — the reset call site this phase's own
   research flagged as easiest to skip, since the function otherwise never
   touches `failure_predictions` at all.
"""

import pytest

from middleware.auth import CurrentUser
from routers import assets as assets_router
from tests.smoke.fake_supabase import FakeDB

GM = CurrentUser(user_id="gm-1", hotel_id="hotel-1", role="gm", email="gm@example.com")


def _base_rows(risk_score=85, is_acknowledged=False, escalation_level=1, high_risk_since="2026-08-13T08:00:00+00:00"):
    return {
        "failure_predictions": [{
            "id": "pred-1", "asset_id": "asset-1", "tenant_id": "hotel-1",
            "risk_score": risk_score, "is_acknowledged": is_acknowledged,
            "escalation_level": escalation_level, "high_risk_since": high_risk_since,
            "acknowledged_at": None, "acknowledged_by": None,
            "assets": {"name": "Boiler #1", "id": "asset-1", "room_id": None},
        }],
        "work_orders": [],
    }


# ---------------------------------------------------------------------------
# A. acknowledge_failure_prediction
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_acknowledge_resets_escalation_watermark(monkeypatch):
    db = FakeDB(_base_rows())
    monkeypatch.setattr(assets_router, "supabase", db)

    response = await assets_router.acknowledge_failure_prediction(prediction_id="pred-1", current_user=GM)

    assert response["data"]["is_acknowledged"] is True
    row = next(r for r in db.rows["failure_predictions"] if r["id"] == "pred-1")
    assert row["is_acknowledged"] is True
    assert row["escalation_level"] == 0
    assert row["high_risk_since"] is None


# ---------------------------------------------------------------------------
# B. create_work_order_from_prediction
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_work_order_resets_escalation_watermark(monkeypatch):
    db = FakeDB(_base_rows())
    monkeypatch.setattr(assets_router, "supabase", db)

    response = await assets_router.create_work_order_from_prediction(prediction_id="pred-1", current_user=GM)

    assert response["data"] is not None
    assert len(db.rows["work_orders"]) == 1

    row = next(r for r in db.rows["failure_predictions"] if r["id"] == "pred-1")
    assert row["escalation_level"] == 0
    assert row["high_risk_since"] is None
