"""Preview contracts: parser output is compared with live state but never written."""

from types import SimpleNamespace

from routers import housekeeping as hk_router

from .fake_supabase import FakeDB


def test_hk_preview_calculates_changes_without_mutating(monkeypatch):
    db = FakeDB({
        "rooms": [{"id": "room-1", "tenant_id": "hotel-a", "room_number": "312"}],
        "room_status": [{"room_id": "room-1", "tenant_id": "hotel-a", "status": "CLEAN", "fo_status": "VAC", "clean_type": "DEP", "checkout_time": "2026-09-30T11:00:00+00:00"}],
        "room_status_history": [],
        "room_assignments": [],
    })
    monkeypatch.setattr(hk_router, "supabase", db)

    preview = hk_router._build_opera_import_preview([
        SimpleNamespace(room_number="312", our_status="DIRTY", fo_status="VAC"),
        SimpleNamespace(room_number="999", our_status="DIRTY", fo_status="VAC"),
    ], [], "hotel-a", "hk-details")

    assert preview["total_parsed"] == 2
    assert preview["will_update"] == 1
    assert preview["not_found"] == 1
    assert preview["changes"][0]["room_number"] == "312"
    assert db.rows["room_status"][0]["status"] == "CLEAN"
    assert db.rows["room_status_history"] == []


def test_preview_skips_active_room_with_the_same_protection_as_apply(monkeypatch):
    db = FakeDB({
        "rooms": [{"id": "room-1", "tenant_id": "hotel-a", "room_number": "312"}],
        "room_status": [{"room_id": "room-1", "tenant_id": "hotel-a", "status": "IN_PROGRESS", "fo_status": "VAC", "clean_type": "DEP", "checkout_time": None}],
    })
    monkeypatch.setattr(hk_router, "supabase", db)

    preview = hk_router._build_opera_import_preview([
        SimpleNamespace(room_number="312", our_status="DIRTY", fo_status="VAC"),
    ], [], "hotel-a", "hk-details")

    assert preview["will_update"] == 0
    assert preview["skipped_active"] == 1
