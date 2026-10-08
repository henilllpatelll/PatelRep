"""
Settings redesign Phase 6: successful Settings mutations append a correct, safe audit event.

Consistency note (matches services/settings_audit.py): the audit row is written right AFTER the mutation
succeeds and is NOT atomic with it - tests below assert what IS guaranteed: no event for a failed mutation,
one event per change, nothing sensitive stored, and an audit failure never breaks the request.
"""
import logging

import pytest
from fastapi import HTTPException

from middleware.auth import CurrentUser
from models.requests import (
    CreateCustomRoleRequest, CreateGuestRequestSlaPolicyRequest, OperaConnectRequest, ResolveOperaSyncConflictRequest,
    UpdateCustomRoleRequest, UpdateHotelRequest, UpdateHousekeepingSettingsRequest,
)
from routers import guest_requests as guest_router
from routers import hotels as hotels_router
from routers import integrations as integrations_router
from routers import staff as staff_router
from services import settings_audit
from tests.smoke.fake_supabase import FakeDB

HOTEL = "11111111-1111-4111-8111-111111111111"
OTHER = "22222222-2222-4222-8222-222222222222"
GM = CurrentUser(user_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", hotel_id=HOTEL, role="gm", email="gm@example.com")
SUP = CurrentUser(user_id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", hotel_id=HOTEL, role="housekeeping_supervisor", email="s@example.com")


def audit_rows(db: FakeDB) -> list[dict]:
    return [row for table, row in db.inserts if table == "operational_audit_events"]


def hotel_db(**tenant) -> FakeDB:
    base = {"id": HOTEL, "name": "Old Name", "phone": "555-0100", "front_desk_modules": ["housekeeping", "tasks"],
            "housekeeping_target_credits": 16, "housekeeping_credit_weights": {"DEP": 1, "FULL": 1, "LIGHT": 0.5},
            "housekeeping_capacity_overrides": {}, "housekeeping_assignment_preferences": {"balance_workload": True, "prefer_same_floor": False}}
    return FakeDB({"tenants": [{**base, **tenant}, {"id": OTHER, "name": "Other Hotel"}]})


@pytest.mark.asyncio
async def test_property_update_records_actor_hotel_resource_and_only_changed_values(monkeypatch):
    db = hotel_db()
    monkeypatch.setattr(hotels_router, "supabase", db)

    await hotels_router.update_hotel(HOTEL, UpdateHotelRequest(name="New Name", phone="555-0100"), current_user=GM)

    [event] = audit_rows(db)  # exactly one - no duplicate writers
    assert event["tenant_id"] == HOTEL
    assert event["actor_id"] == GM.user_id and event["actor_role"] == "gm"
    assert event["action"] == "settings.property.updated"
    assert (event["resource_type"], event["resource_id"]) == ("property_profile", HOTEL)
    assert event["old_state"] == {"name": "Old Name"}  # unchanged phone is not recorded as a change
    assert event["new_state"] == {"name": "New Name"}
    assert event["source"] == "api"


@pytest.mark.asyncio
async def test_front_desk_access_change_is_its_own_event_with_before_and_after(monkeypatch):
    db = hotel_db()
    monkeypatch.setattr(hotels_router, "supabase", db)

    await hotels_router.update_hotel(HOTEL, UpdateHotelRequest(front_desk_modules=["housekeeping", "tasks", "logbook"]), current_user=GM)

    [event] = audit_rows(db)
    assert event["action"] == "settings.front_desk_access.updated"
    assert event["old_state"] == {"modules": ["housekeeping", "tasks"]}
    assert set(event["new_state"]["modules"]) == {"housekeeping", "tasks", "logbook"}


@pytest.mark.asyncio
async def test_failed_or_rejected_mutation_records_nothing(monkeypatch):
    db = hotel_db()
    monkeypatch.setattr(hotels_router, "supabase", db)

    with pytest.raises(HTTPException):  # another hotel's id
        await hotels_router.update_hotel(OTHER, UpdateHotelRequest(name="Hijack"), current_user=GM)
    with pytest.raises(HTTPException):  # nothing to update
        await hotels_router.update_hotel(HOTEL, UpdateHotelRequest(), current_user=GM)
    with pytest.raises(HTTPException):  # modules Front Desk cannot open
        await hotels_router.update_hotel(HOTEL, UpdateHotelRequest(front_desk_modules=["not-a-module"]), current_user=GM)

    assert audit_rows(db) == []


@pytest.mark.asyncio
async def test_housekeeping_settings_events_summarise_without_staff_level_values(monkeypatch):
    db = hotel_db()
    monkeypatch.setattr(hotels_router, "supabase", db)
    body = UpdateHousekeepingSettingsRequest(
        default_target_credits=18, capacity_overrides={"staff-1": 12, "staff-2": 10},
        assignment_preferences={"balance_workload": False, "prefer_same_floor": False},
    )

    await hotels_router.update_housekeeping_settings(HOTEL, body, current_user=SUP)

    events = {e["action"]: e for e in audit_rows(db)}
    assert set(events) == {"settings.housekeeping_workload.updated", "settings.housekeeping_assignment.updated"}
    workload = events["settings.housekeeping_workload.updated"]
    assert workload["actor_role"] == "housekeeping_supervisor"  # the role at the time, not 'gm'
    assert workload["old_state"] == {"default_target_credits": 16, "capacity_override_count": 0}
    assert workload["new_state"] == {"default_target_credits": 18, "capacity_override_count": 2}
    assert "staff-1" not in str(events)
    prefs = events["settings.housekeeping_assignment.updated"]
    assert prefs["old_state"]["preferences"]["balance_workload"] is True and prefs["new_state"]["preferences"]["balance_workload"] is False


@pytest.mark.asyncio
async def test_sequential_updates_keep_independent_evidence(monkeypatch):
    db = hotel_db()
    monkeypatch.setattr(hotels_router, "supabase", db)

    await hotels_router.update_hotel(HOTEL, UpdateHotelRequest(name="Second"), current_user=GM)
    await hotels_router.update_hotel(HOTEL, UpdateHotelRequest(name="Third"), current_user=SUP.__class__(**{**SUP.__dict__, "role": "gm"}))

    first, second = audit_rows(db)
    assert (first["old_state"], first["new_state"]) == ({"name": "Old Name"}, {"name": "Second"})
    assert (second["old_state"], second["new_state"]) == ({"name": "Second"}, {"name": "Third"})
    assert first["id"] != second["id"]


# ─── helper-level guarantees ──────────────────────────────────────────────────

def test_helper_drops_unknown_and_sensitive_keys_and_never_stores_credentials():
    db = FakeDB({})
    settings_audit.record_settings_event(
        db=db, current_user=GM, action="settings.integration.opera_connected", resource_type="integration", resource_id=HOTEL,
        new_state={
            "property_code": "SAND01", "endpoint": "https://ohip.example.com", "auth_updated": True,
            "integration_password": "hunter2", "access_token": "tok", "client_secret": "s", "raw_payload": {"x": 1},
        },
        only_changes=False,
    )
    [event] = audit_rows(db)
    assert event["new_state"] == {"property_code": "SAND01", "endpoint": "https://ohip.example.com", "auth_updated": True}
    assert "hunter2" not in str(event) and "tok" not in str(event["new_state"])


def test_helper_rejects_unknown_actions_without_raising():
    db = FakeDB({})
    assert settings_audit.record_settings_event(db=db, current_user=GM, action="made.up", resource_type="room", resource_id=HOTEL) is False
    assert audit_rows(db) == []


def test_audit_write_failure_is_retried_logged_with_sanitized_payload_and_never_raises(caplog):
    class Boom(FakeDB):
        attempts = 0

        def table(self, name):
            if name == "operational_audit_events":
                Boom.attempts += 1
                raise RuntimeError("db down")
            return super().table(name)

    caplog.set_level(logging.CRITICAL)
    ok = settings_audit.record_settings_event(
        db=Boom({}), current_user=GM, action="settings.room.created", resource_type="room", resource_id=HOTEL,
        new_state={"room_number": "101", "password": "nope"}, only_changes=False,
    )
    assert ok is False and Boom.attempts == 2
    critical = [r for r in caplog.records if "AUDIT_WRITE_FAILED" in r.getMessage()]
    assert critical and '"room_number": "101"' in critical[0].getMessage() and "nope" not in critical[0].getMessage()


# ─── roles, SLAs, integrations ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_custom_role_lifecycle_is_audited_with_module_changes(monkeypatch):
    db = FakeDB({"custom_roles": [], "user_roles": []})
    monkeypatch.setattr(staff_router, "supabase", db)

    created = (await staff_router.create_custom_role(
        CreateCustomRoleRequest(name="Lead", base_role="housekeeping_supervisor", allowed_modules=["housekeeping"]), current_user=GM,
    ))["data"]
    db.rows["custom_roles"][0]["is_active"] = True  # the real table defaults this; the fake does not
    await staff_router.update_custom_role(
        created["id"], UpdateCustomRoleRequest(allowed_modules=["housekeeping", "tasks"]), current_user=GM,
    )
    await staff_router.delete_custom_role(created["id"], current_user=GM)

    c, u, d = audit_rows(db)
    assert (c["action"], u["action"], d["action"]) == (
        "settings.custom_role.created", "settings.custom_role.updated", "settings.custom_role.deleted")
    assert {c["resource_id"], u["resource_id"], d["resource_id"]} == {created["id"]}
    assert c["new_state"]["name"] == "Lead"
    assert u["old_state"]["allowed_modules"] == ["housekeeping"] and "tasks" in u["new_state"]["allowed_modules"]
    assert d["old_state"]["name"] == "Lead"
    assert all(e["tenant_id"] == HOTEL and e["actor_id"] == GM.user_id for e in (c, u, d))


@pytest.mark.asyncio
async def test_sla_rule_lifecycle_is_audited(monkeypatch):
    db = FakeDB({"guest_request_sla_policies": []})
    monkeypatch.setattr(guest_router, "supabase", db)

    rule = (await guest_router.create_guest_request_sla_policy(
        CreateGuestRequestSlaPolicyRequest(category="maintenance", sla_minutes=30), current_user=GM))["data"]
    await guest_router.update_guest_request_sla_policy(
        rule["id"], CreateGuestRequestSlaPolicyRequest(category="maintenance", sla_minutes=45), current_user=GM)
    await guest_router.delete_guest_request_sla_policy(rule["id"], current_user=GM)

    c, u, d = audit_rows(db)
    assert c["new_state"]["sla_minutes"] == 30
    assert (u["old_state"], u["new_state"]) == ({"sla_minutes": 30}, {"sla_minutes": 45})
    assert d["old_state"]["sla_minutes"] == 45
    assert [e["action"] for e in (c, u, d)] == ["settings.sla_policy.created", "settings.sla_policy.updated", "settings.sla_policy.deleted"]


@pytest.mark.asyncio
async def test_failed_sla_mutations_record_nothing(monkeypatch):
    db = FakeDB({"guest_request_sla_policies": []})
    monkeypatch.setattr(guest_router, "supabase", db)
    with pytest.raises(HTTPException):
        await guest_router.update_guest_request_sla_policy(
            "missing", CreateGuestRequestSlaPolicyRequest(category="service", sla_minutes=10), current_user=GM)
    with pytest.raises(HTTPException):
        await guest_router.delete_guest_request_sla_policy("missing", current_user=GM)
    assert audit_rows(db) == []


@pytest.mark.asyncio
async def test_opera_connect_is_audited_without_any_credential_values(monkeypatch):
    db = FakeDB({"tenants": [{"id": HOTEL, "opera_pilot_enabled": True}], "opera_credentials": []})
    monkeypatch.setattr(integrations_router, "supabase", db)
    monkeypatch.setattr(integrations_router, "acquire_new_token", lambda *a: {"access_token": "ACCESS-TOKEN-XYZ", "refresh_token": "REFRESH-XYZ"})
    monkeypatch.setattr(integrations_router, "bootstrap_opera_data", lambda hotel_id: None)
    monkeypatch.setattr(integrations_router, "encrypt_opera_secrets", lambda row: row)

    await integrations_router.opera_connect(
        OperaConnectRequest(ohip_base_url="https://user:pw123@ohip.example.com/api/?token=abc#frag", hotel_id_opera="SAND01",
                            integration_username="svc", integration_password="S3cret-PW"),
        current_user=GM,
    )

    [event] = audit_rows(db)
    assert event["action"] == "settings.integration.opera_connected"
    assert event["new_state"] == {"property_code": "SAND01", "endpoint": "https://ohip.example.com/api", "connection_mode": "api", "auth_updated": True}
    blob = str(event)
    for secret in ("S3cret-PW", "ACCESS-TOKEN-XYZ", "REFRESH-XYZ", "pw123", "token=abc", "svc"):
        assert secret not in blob


@pytest.mark.asyncio
async def test_failed_opera_connect_records_nothing(monkeypatch):
    db = FakeDB({"tenants": [{"id": HOTEL, "opera_pilot_enabled": True}], "opera_credentials": []})
    monkeypatch.setattr(integrations_router, "supabase", db)

    def boom(*_a):
        raise RuntimeError("unreachable")

    monkeypatch.setattr(integrations_router, "acquire_new_token", boom)
    with pytest.raises(HTTPException):
        await integrations_router.opera_connect(
            OperaConnectRequest(ohip_base_url="https://ohip.example.com", hotel_id_opera="SAND01"), current_user=GM)
    assert audit_rows(db) == []


@pytest.mark.asyncio
async def test_conflict_resolution_and_disconnect_are_audited_without_guest_data(monkeypatch):
    db = FakeDB({
        "tenants": [{"id": HOTEL, "opera_pilot_enabled": True}],
        "opera_credentials": [{"tenant_id": HOTEL, "is_connected": True, "hotel_id_opera": "SAND01", "ohip_base_url": "https://ohip.example.com", "connection_mode": "api"}],
        "integration_sync_conflicts": [{
            "id": "c-1", "tenant_id": HOTEL, "provider": "opera", "status": "open", "entity_type": "reservation",
            "external_id": "R-1001", "local_entity_id": None,
            "remote_snapshot": {"guest_name": "Jane Guest", "guest_email": "jane@example.com"},
        }],
    })
    monkeypatch.setattr(integrations_router, "supabase", db)

    await integrations_router.resolve_opera_sync_conflict("c-1", ResolveOperaSyncConflictRequest(resolution="local_wins"), current_user=GM)
    await integrations_router.opera_disconnect(current_user=GM)

    resolved, disconnected = audit_rows(db)
    assert resolved["action"] == "settings.integration.opera_conflict_resolved"
    assert resolved["new_state"] == {"resolution": "local_wins", "entity_type": "reservation", "external_id": "R-1001"}
    assert disconnected["action"] == "settings.integration.opera_disconnected"
    assert disconnected["old_state"]["property_code"] == "SAND01"
    assert "Jane" not in str(audit_rows(db)) and "jane@example.com" not in str(audit_rows(db))
