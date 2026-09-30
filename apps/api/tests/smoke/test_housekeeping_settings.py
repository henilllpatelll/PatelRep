import pytest

from middleware.auth import CurrentUser
from models.requests import UpdateHousekeepingSettingsRequest
from routers import hotels
from .fake_supabase import FakeDB


GM = CurrentUser(user_id="gm-1", hotel_id="hotel-a", role="gm", email="gm@example.com")
SUPERVISOR = CurrentUser(user_id="sup-1", hotel_id="hotel-a", role="housekeeping_supervisor", email="sup@example.com")


def make_db():
    return FakeDB({"tenants": [{"id": "hotel-a", "housekeeping_target_credits": None, "housekeeping_credit_weights": None, "housekeeping_capacity_overrides": None}]})


@pytest.mark.asyncio
async def test_housekeeping_settings_uses_safe_legacy_defaults(monkeypatch):
    monkeypatch.setattr(hotels, "supabase", make_db())
    response = await hotels.get_housekeeping_settings("hotel-a", SUPERVISOR)
    assert response["data"]["default_target_credits"] == 16
    assert response["data"]["credit_weights"] == {"DEP": 3, "FULL": 2, "LIGHT": 1}


@pytest.mark.asyncio
async def test_housekeeping_settings_update_is_tenant_scoped(monkeypatch):
    db = make_db()
    monkeypatch.setattr(hotels, "supabase", db)
    response = await hotels.update_housekeeping_settings(
        "hotel-a",
        UpdateHousekeepingSettingsRequest(
            default_target_credits=18,
            credit_weights={"DEP": 2.0, "FULL": 1.0, "LIGHT": 0.5},
            capacity_overrides={"hk-1": 14},
        ),
        GM,
    )
    assert response["data"]["default_target_credits"] == 18
    assert db.rows["tenants"][0]["housekeeping_target_credits"] == 18
    assert db.rows["tenants"][0]["housekeeping_capacity_overrides"] == {"hk-1": 14}


def test_housekeeping_settings_rejects_invalid_workload_values():
    with pytest.raises(ValueError):
        UpdateHousekeepingSettingsRequest(default_target_credits=0)
