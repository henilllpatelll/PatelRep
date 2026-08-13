"""Single-tier GM escalation cron for HIGH-risk predictions (AI-12, AI-14).

Mirrors test_lost_found_retention.py / test_failure_prediction_notifications.py's
FakeDB + monkeypatch(module, "supabase", db) harness pattern.
"""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from core.config import settings
from routers import internal as internal_router
from tests.smoke.fake_supabase import FakeDB


def _room_row(*, minutes_ago=90, is_acknowledged=False, escalation_level=0):
    high_risk_since = (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()
    return {
        "room_id": "room-1",
        "tenant_id": "hotel-1",
        "risk_level": "HIGH",
        "is_acknowledged": is_acknowledged,
        "escalation_level": escalation_level,
        "high_risk_since": high_risk_since,
        "rooms": {"room_number": "204"},
    }


def _asset_row(*, minutes_ago=90, is_acknowledged=False, escalation_level=0, risk_score=95):
    high_risk_since = (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()
    return {
        "id": "pred-1",
        "asset_id": "asset-1",
        "tenant_id": "hotel-1",
        "risk_score": risk_score,
        "is_acknowledged": is_acknowledged,
        "escalation_level": escalation_level,
        "high_risk_since": high_risk_since,
        "assets": {"name": "Boiler #1"},
    }


def _gm_role():
    return {"user_id": "gm-1", "tenant_id": "hotel-1", "role": "gm", "is_active": True}


@pytest.mark.asyncio
async def test_overdue_high_risk_room_notifies_gm_and_sets_escalation_level(monkeypatch):
    db = FakeDB({
        "room_readiness_predictions": [_room_row()],
        "user_roles": [_gm_role()],
    })
    monkeypatch.setattr(internal_router, "supabase", db)

    await internal_router.check_prediction_escalations(x_cron_secret=settings.cron_secret)

    assert len(db.rows["notifications"]) == 1
    notification = db.rows["notifications"][0]
    assert notification["type"] == "escalation_auto"
    assert notification["data"] == {"room_id": "room-1"}
    room = next(row for row in db.rows["room_readiness_predictions"] if row["room_id"] == "room-1")
    assert room["escalation_level"] == 1


@pytest.mark.asyncio
async def test_overdue_high_risk_asset_notifies_gm_and_sets_escalation_level(monkeypatch):
    db = FakeDB({
        "failure_predictions": [_asset_row()],
        "user_roles": [_gm_role()],
    })
    monkeypatch.setattr(internal_router, "supabase", db)

    await internal_router.check_prediction_escalations(x_cron_secret=settings.cron_secret)

    assert len(db.rows["notifications"]) == 1
    notification = db.rows["notifications"][0]
    assert notification["type"] == "escalation_auto_asset"
    assert notification["data"] == {"asset_id": "asset-1"}
    prediction = next(row for row in db.rows["failure_predictions"] if row["id"] == "pred-1")
    assert prediction["escalation_level"] == 1


@pytest.mark.asyncio
async def test_three_consecutive_runs_notify_exactly_once_room(monkeypatch):
    db = FakeDB({
        "room_readiness_predictions": [_room_row()],
        "user_roles": [_gm_role()],
    })
    monkeypatch.setattr(internal_router, "supabase", db)

    await internal_router.check_prediction_escalations(x_cron_secret=settings.cron_secret)
    await internal_router.check_prediction_escalations(x_cron_secret=settings.cron_secret)
    await internal_router.check_prediction_escalations(x_cron_secret=settings.cron_secret)

    assert len(db.rows["notifications"]) == 1


@pytest.mark.asyncio
async def test_three_consecutive_runs_notify_exactly_once_asset(monkeypatch):
    db = FakeDB({
        "failure_predictions": [_asset_row()],
        "user_roles": [_gm_role()],
    })
    monkeypatch.setattr(internal_router, "supabase", db)

    await internal_router.check_prediction_escalations(x_cron_secret=settings.cron_secret)
    await internal_router.check_prediction_escalations(x_cron_secret=settings.cron_secret)
    await internal_router.check_prediction_escalations(x_cron_secret=settings.cron_secret)

    assert len(db.rows["notifications"]) == 1


@pytest.mark.asyncio
async def test_not_yet_past_threshold_room_not_escalated(monkeypatch):
    db = FakeDB({
        "room_readiness_predictions": [_room_row(minutes_ago=10)],
        "user_roles": [_gm_role()],
    })
    monkeypatch.setattr(internal_router, "supabase", db)

    await internal_router.check_prediction_escalations(x_cron_secret=settings.cron_secret)

    assert db.rows.get("notifications", []) == []
    room = next(row for row in db.rows["room_readiness_predictions"] if row["room_id"] == "room-1")
    assert room["escalation_level"] == 0


@pytest.mark.asyncio
async def test_acknowledged_room_not_escalated_even_if_overdue(monkeypatch):
    db = FakeDB({
        "room_readiness_predictions": [_room_row(is_acknowledged=True)],
        "user_roles": [_gm_role()],
    })
    monkeypatch.setattr(internal_router, "supabase", db)

    await internal_router.check_prediction_escalations(x_cron_secret=settings.cron_secret)

    assert db.rows.get("notifications", []) == []


@pytest.mark.asyncio
async def test_below_threshold_risk_score_asset_not_escalated(monkeypatch):
    db = FakeDB({
        "failure_predictions": [_asset_row(risk_score=40)],
        "user_roles": [_gm_role()],
    })
    monkeypatch.setattr(internal_router, "supabase", db)

    await internal_router.check_prediction_escalations(x_cron_secret=settings.cron_secret)

    assert db.rows.get("notifications", []) == []


@pytest.mark.asyncio
async def test_invalid_cron_secret_returns_401():
    with pytest.raises(HTTPException) as exc:
        await internal_router.check_prediction_escalations(x_cron_secret="wrong-secret")

    assert exc.value.status_code == 401
