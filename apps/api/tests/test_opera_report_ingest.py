"""Unit tests for services/opera/report_ingest.py using the in-memory FakeDB.

Covers: room_status upsert for both the reservation-id and no-id cases, the
staff-entered-guest-name conflict path (parity check against sync.py's rule,
duplicated on purpose -- see report_ingest.py's module docstring), the
failed-vs-processed retry distinction, and sync_report_files' gating order.
"""
from services.opera import report_ingest
from tests.smoke.fake_supabase import FakeDB


def _db_with_room(hotel_id="hotel-1", room_id="room-1", room_number="101", room_status=None):
    rows = {
        "rooms": [{"id": room_id, "tenant_id": hotel_id, "room_number": room_number}],
        "room_status": [room_status] if room_status else [],
        "opera_reservations": [],
        "integration_sync_conflicts": [],
        "integration_sync_conflict_events": [],
    }
    return FakeDB(rows=rows)


def _mapped_row(**overrides):
    base = {
        "room_number_opera": "101",
        "guest_name": "Smith,John",
        "vip_code": None,
        "arrival_date": "09-14-26",
        "departure_date": "09-19-26",
        "arrival_time": None,
        "departure_time": None,
        "adults": "1",
        "children": "0",
        "special_requests": None,
        "rate_code": "BAR",
        "opera_reservation_id": "12345",
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# ingest_report_row
# ---------------------------------------------------------------------------


def test_ingest_report_row_updates_room_status(monkeypatch):
    db = _db_with_room(room_status={
        "tenant_id": "hotel-1", "room_id": "room-1", "guest_name": None,
        "vip_flag": False, "checkin_time": None, "checkout_time": None,
    })
    monkeypatch.setattr(report_ingest, "supabase", db)

    outcome = report_ingest.ingest_report_row("hotel-1", "in_house", _mapped_row())

    assert outcome == "updated"
    updated_status = next(r for r in db.rows["room_status"] if r["room_id"] == "room-1")
    assert updated_status["guest_name"] == "Smith,John"
    assert updated_status["checkin_time"].startswith("2026-09-14")
    assert updated_status["checkout_time"].startswith("2026-09-19")
    # Cache table also upserted.
    assert db.rows["opera_reservations"][0]["opera_reservation_id"] == "12345"


def test_ingest_report_row_no_room_number_still_caches_reservation(monkeypatch):
    """Mirrors sync.py: a reservation without a resolvable room still gets
    cached (arrivals report often has ROOM_NO blank pre-assignment)."""
    db = FakeDB(rows={"rooms": [], "room_status": [], "opera_reservations": []})
    monkeypatch.setattr(report_ingest, "supabase", db)

    outcome = report_ingest.ingest_report_row("hotel-1", "arrivals", _mapped_row(room_number_opera=None))

    assert outcome == "skipped_no_room"
    assert db.rows["opera_reservations"][0]["opera_reservation_id"] == "12345"
    assert db.rows["opera_reservations"][0]["room_id"] is None


def test_ingest_report_row_no_room_and_no_reservation_id_is_skipped_entirely(monkeypatch):
    db = FakeDB(rows={"rooms": [], "room_status": [], "opera_reservations": []})
    monkeypatch.setattr(report_ingest, "supabase", db)

    outcome = report_ingest.ingest_report_row(
        "hotel-1", "arrivals", _mapped_row(room_number_opera=None, opera_reservation_id=None)
    )

    assert outcome == "skipped_no_identity"
    assert db.rows["opera_reservations"] == []


def test_ingest_report_row_staff_entered_conflict_does_not_touch_room_status(monkeypatch):
    """Parity with sync.py's has_reservation_conflict: a staff-entered guest
    name that disagrees with the incoming report must block the write."""
    db = _db_with_room(room_status={
        "tenant_id": "hotel-1", "room_id": "room-1", "guest_name": "Staff Entered Name",
        "vip_flag": False, "checkin_time": None, "checkout_time": None,
    })
    monkeypatch.setattr(report_ingest, "supabase", db)

    outcome = report_ingest.ingest_report_row("hotel-1", "in_house", _mapped_row(guest_name="Someone Else"))

    assert outcome == "conflict"
    room_status_row = next(r for r in db.rows["room_status"] if r["room_id"] == "room-1")
    assert room_status_row["guest_name"] == "Staff Entered Name"  # untouched
    assert len(db.rows["integration_sync_conflicts"]) == 1
    conflict = db.rows["integration_sync_conflicts"][0]
    assert conflict["entity_type"] == "reservation"
    assert len(db.rows["integration_sync_conflict_events"]) == 1


def test_ingest_report_row_room_status_entity_type_when_no_reservation_id(monkeypatch):
    db = _db_with_room(room_status={
        "tenant_id": "hotel-1", "room_id": "room-1", "guest_name": "Staff Entered Name",
        "vip_flag": False, "checkin_time": None, "checkout_time": None,
    })
    monkeypatch.setattr(report_ingest, "supabase", db)

    outcome = report_ingest.ingest_report_row(
        "hotel-1", "in_house", _mapped_row(opera_reservation_id=None, guest_name="Someone Else")
    )

    assert outcome == "conflict"
    conflict = db.rows["integration_sync_conflicts"][0]
    assert conflict["entity_type"] == "room_status"
    assert conflict["external_id"] == "101"


# ---------------------------------------------------------------------------
# list_unprocessed_files: retry-after-failed semantics
# ---------------------------------------------------------------------------


def test_list_unprocessed_files_excludes_processed_and_skipped_but_retries_failed(monkeypatch):
    db = FakeDB(rows={
        "opera_report_files": [
            {"tenant_id": "hotel-1", "remote_filename": "a.txt", "status": "processed"},
            {"tenant_id": "hotel-1", "remote_filename": "b.txt", "status": "skipped"},
            {"tenant_id": "hotel-1", "remote_filename": "c.txt", "status": "failed"},
        ],
    })
    monkeypatch.setattr(report_ingest, "supabase", db)

    remote_files = [{"filename": "a.txt"}, {"filename": "b.txt"}, {"filename": "c.txt"}, {"filename": "d.txt"}]
    pending = report_ingest.list_unprocessed_files("hotel-1", remote_files)

    assert {f["filename"] for f in pending} == {"c.txt", "d.txt"}


def test_record_report_file_upsert_not_duplicate_on_retry(monkeypatch):
    db = FakeDB(rows={"opera_report_files": []})
    monkeypatch.setattr(report_ingest, "supabase", db)

    report_ingest.record_report_file("hotel-1", "a.txt", "in_house", "failed", error="boom")
    report_ingest.record_report_file("hotel-1", "a.txt", "in_house", "processed", rows_parsed=5, rows_upserted=5)

    assert len(db.rows["opera_report_files"]) == 1
    assert db.rows["opera_report_files"][0]["status"] == "processed"
    assert db.rows["opera_report_files"][0]["rows_upserted"] == 5


# ---------------------------------------------------------------------------
# sync_report_files: gating order
# ---------------------------------------------------------------------------


def test_sync_report_files_skips_when_pilot_not_enabled(monkeypatch):
    db = FakeDB(rows={"tenants": [{"id": "hotel-1", "opera_pilot_enabled": False}]})
    monkeypatch.setattr(report_ingest, "supabase", db)

    result = report_ingest.sync_report_files("hotel-1")

    assert result == {"synced": 0, "skipped": True, "reason": "opera_pilot_not_enabled", "error": None}


def test_sync_report_files_skips_when_not_sftp_report_mode(monkeypatch):
    db = FakeDB(rows={"tenants": [{"id": "hotel-1", "opera_pilot_enabled": True}]})
    monkeypatch.setattr(report_ingest, "supabase", db)
    monkeypatch.setattr(report_ingest, "get_opera_credentials", lambda hotel_id: {"connection_mode": "api"})

    result = report_ingest.sync_report_files("hotel-1")

    assert result == {"synced": 0, "skipped": True, "reason": "not_sftp_report_mode", "error": None}


def test_sync_report_files_isolates_per_file_failure(monkeypatch):
    db = FakeDB(rows={
        "tenants": [{"id": "hotel-1", "opera_pilot_enabled": True}],
        "opera_credentials": [{"tenant_id": "hotel-1", "connection_mode": "sftp_report"}],
        "opera_report_files": [],
    })
    monkeypatch.setattr(report_ingest, "supabase", db)
    monkeypatch.setattr(report_ingest, "get_opera_credentials", lambda hotel_id: {"connection_mode": "sftp_report"})
    monkeypatch.setattr(
        report_ingest, "list_report_files",
        lambda creds: [{"filename": "bad.txt", "mtime": None, "size": 1}, {"filename": "good.txt", "mtime": None, "size": 1}],
    )

    def fake_ingest_report_file(hotel_id, creds, file_meta):
        if file_meta["filename"] == "bad.txt":
            raise RuntimeError("boom")
        return {"filename": "good.txt", "status": "processed", "rows_upserted": 3}

    monkeypatch.setattr(report_ingest, "ingest_report_file", fake_ingest_report_file)

    result = report_ingest.sync_report_files("hotel-1")

    assert result["synced"] == 3
    assert result["files_processed"] == 1  # bad.txt's exception didn't increment this
