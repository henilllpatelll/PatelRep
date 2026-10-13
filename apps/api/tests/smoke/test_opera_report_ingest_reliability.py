"""Reliability contracts for Opera SFTP report ingestion (services/opera/report_ingest.py).

Sanitized synthetic fixtures only ("Guest A" style names); no real guest data, no
network. Covers file-level outcome semantics (processed vs failed vs skipped),
retry idempotency, conflict de-duplication, SFTP failure reporting and the
last_sync_at / cron-health contract.
"""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from routers import internal
from services.opera import report_ingest
from services.opera.sftp_client import SftpAuthError, SftpConnectionError, SftpDownloadError, SftpListError

from .fake_supabase import FakeDB

HOTEL = "hotel-1"
GIB_HEADERS = ["ROOM", "FULL_NAME", "VIP", "RESV_NAME_ID", "ARRIVAL", "DEPARTURE", "ADULTS"]
TRAILER = "LOGO\tSUM_ADULTS\n\t2\n"


def _report(rows, headers=GIB_HEADERS, trailer=True):
    lines = ["\t".join(headers)] + ["\t".join(r) for r in rows]
    return ("\n".join(lines) + "\n" + (TRAILER if trailer else "")).encode("utf-8")


def _row(room, name, rid, vip=""):
    return [room, name, vip, rid, "10-12-26", "10-15-26", "1"]


def _db(rooms=("101", "102", "103"), extra=None, pilot=True):
    rows = {
        "tenants": [{"id": HOTEL, "opera_pilot_enabled": pilot}],
        "opera_credentials": [{"tenant_id": HOTEL, "connection_mode": "sftp_report", "last_sync_at": None}],
        "rooms": [{"id": f"room-{n}", "tenant_id": HOTEL, "room_number": n} for n in rooms],
        "room_status": [{"room_id": f"room-{n}", "tenant_id": HOTEL, "guest_name": None, "vip_flag": False,
                         "checkin_time": None, "checkout_time": None} for n in rooms],
        "opera_reservations": [], "opera_report_files": [],
        "integration_sync_conflicts": [], "integration_sync_conflict_events": [],
        "cron_health": [],
    }
    rows.update(extra or {})
    return FakeDB(rows=rows)


def _install(monkeypatch, db, content=None, creds=None):
    monkeypatch.setattr(report_ingest, "supabase", db)
    if content is not None:
        monkeypatch.setattr(report_ingest, "download_file", lambda c, f: content)
    return creds or {"connection_mode": "sftp_report"}


def _meta(name="gibyroom_1.txt", mtime=None):
    return {"filename": name, "mtime": mtime, "size": 1}


def _file_row(db, name="gibyroom_1.txt"):
    return next(r for r in db.rows["opera_report_files"] if r["remote_filename"] == name)


# ---------------------------------------------------------------------------
# File-level outcome
# ---------------------------------------------------------------------------

def test_clean_file_is_processed_with_accurate_counts(monkeypatch):
    db = _db()
    creds = _install(monkeypatch, db, _report([_row("101", "Guest A", "1"), _row("102", "Guest B", "2")]))
    result = report_ingest.ingest_report_file(HOTEL, creds, _meta())
    assert result["status"] == "processed" and result["rows_parsed"] == 2 and result["rows_upserted"] == 2
    row = _file_row(db)
    assert row["status"] == "processed" and row["rows_parsed"] == 2 and row["rows_upserted"] == 2
    assert row["error_detail"] is None
    assert {r["guest_name"] for r in db.rows["room_status"] if r["guest_name"]} == {"Guest A", "Guest B"}


def test_valid_skips_do_not_fail_the_file_and_are_counted(monkeypatch):
    db = _db(rooms=("101",))
    creds = _install(monkeypatch, db, _report([_row("101", "Guest A", "1"), _row("777", "Guest B", "2")]))
    result = report_ingest.ingest_report_file(HOTEL, creds, _meta())
    assert result["status"] == "processed" and result["rows_skipped"] == 1 and result["rows_upserted"] == 1
    assert "skipped=1" in _file_row(db)["error_detail"]
    assert len(db.rows["opera_reservations"]) == 2  # reservation caching still happens for unknown rooms


def test_conflicts_are_reconciliation_outcomes_not_failures(monkeypatch):
    db = _db()
    db.rows["room_status"][0]["guest_name"] = "Staff Typed Name"
    creds = _install(monkeypatch, db, _report([_row("101", "Guest A", "1")]))
    result = report_ingest.ingest_report_file(HOTEL, creds, _meta())
    assert result["status"] == "processed" and result["rows_conflict"] == 1 and result["rows_upserted"] == 0
    assert "conflicts=1" in _file_row(db)["error_detail"]
    assert db.rows["room_status"][0]["guest_name"] == "Staff Typed Name"


def test_row_exception_marks_file_failed_but_keeps_ingesting_other_rows(monkeypatch):
    db = _db()
    creds = _install(monkeypatch, db, _report([_row("101", "Guest A", "1"), _row("102", "Guest B", "2"), _row("103", "Guest C", "3")]))
    real = report_ingest.ingest_report_row
    calls = {"n": 0}

    def flaky(hotel_id, report_type, mapped):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("Guest B exploded")
        return real(hotel_id, report_type, mapped)

    monkeypatch.setattr(report_ingest, "ingest_report_row", flaky)
    result = report_ingest.ingest_report_file(HOTEL, creds, _meta())
    assert result["status"] == "failed" and result["rows_failed"] == 1 and result["rows_upserted"] == 2
    row = _file_row(db)
    assert row["status"] == "failed" and row["rows_parsed"] == 3 and row["rows_upserted"] == 2
    assert "failed=1" in row["error_detail"] and "row 2 (RuntimeError)" in row["error_detail"]
    # The audit log carries row numbers and exception types only -- never row content.
    assert "Guest" not in row["error_detail"]


def test_failed_file_is_retried_and_retry_is_idempotent(monkeypatch):
    db = _db()
    content = _report([_row("101", "Guest A", "1"), _row("102", "Guest B", "2")])
    creds = _install(monkeypatch, db, content)
    real = report_ingest.ingest_report_row
    state = {"fail_second": True}

    def flaky(hotel_id, report_type, mapped):
        if state["fail_second"] and mapped.get("opera_reservation_id") == "2":
            raise RuntimeError("transient")
        return real(hotel_id, report_type, mapped)

    monkeypatch.setattr(report_ingest, "ingest_report_row", flaky)
    assert report_ingest.ingest_report_file(HOTEL, creds, _meta())["status"] == "failed"
    assert report_ingest.list_unprocessed_files(HOTEL, [_meta()]) == [_meta()]  # failed files are retried

    state["fail_second"] = False
    assert report_ingest.ingest_report_file(HOTEL, creds, _meta())["status"] == "processed"
    assert report_ingest.ingest_report_file(HOTEL, creds, _meta())["status"] == "processed"  # and again

    assert len(db.rows["opera_report_files"]) == 1
    assert sorted(r["opera_reservation_id"] for r in db.rows["opera_reservations"]) == ["1", "2"]
    assert {r["guest_name"] for r in db.rows["room_status"] if r["guest_name"]} == {"Guest A", "Guest B"}
    assert report_ingest.list_unprocessed_files(HOTEL, [_meta()]) == []  # done files are not retried


def test_repeating_a_conflicting_row_never_duplicates_the_conflict(monkeypatch):
    db = _db()
    db.rows["room_status"][0]["guest_name"] = "Staff Typed Name"
    creds = _install(monkeypatch, db, _report([_row("101", "Guest A", "1")]))
    for _ in range(3):
        report_ingest.ingest_report_file(HOTEL, creds, _meta())
    assert len(db.rows["integration_sync_conflicts"]) == 1
    assert len(db.rows["integration_sync_conflict_events"]) == 1


def test_missing_required_header_fails_the_file_without_touching_state(monkeypatch):
    db = _db()
    headers = [h for h in GIB_HEADERS if h != "FULL_NAME"]
    content = _report([["101", "", "1", "10-12-26", "10-15-26", "1"]], headers=headers)
    creds = _install(monkeypatch, db, content)
    result = report_ingest.ingest_report_file(HOTEL, creds, _meta())
    assert result["status"] == "failed"
    assert "missing_required_columns" in _file_row(db)["error_detail"] and "guest_name" in _file_row(db)["error_detail"]
    assert all(r["guest_name"] is None for r in db.rows["room_status"])
    assert db.rows["opera_reservations"] == []


@pytest.mark.parametrize("content,expected", [
    (b"", "empty file"),
    (b"\n\n   \n", "empty file"),
    (b"\x00\x01\x02binary\x00", "binary"),
    ("﻿R\x00O\x00O\x00M\x00".encode("utf-8"), "binary"),
])
def test_structurally_malformed_files_fail_safely(monkeypatch, content, expected):
    db = _db()
    creds = _install(monkeypatch, db, content)
    result = report_ingest.ingest_report_file(HOTEL, creds, _meta())
    assert result["status"] == "failed"
    assert expected in _file_row(db)["error_detail"] and "malformed_file" in _file_row(db)["error_detail"]
    assert all(r["guest_name"] is None for r in db.rows["room_status"])


def test_truncated_final_record_fails_the_file_but_complete_rows_are_ingested(monkeypatch):
    db = _db()
    content = ("\t".join(GIB_HEADERS) + "\n" + "\t".join(_row("101", "Guest A", "1")) + "\n102\tGuest").encode()
    creds = _install(monkeypatch, db, content)
    result = report_ingest.ingest_report_file(HOTEL, creds, _meta())
    assert result["status"] == "failed" and result["rows_upserted"] == 1
    assert "incomplete final record" in _file_row(db)["error_detail"]
    assert db.rows["room_status"][1]["guest_name"] is None


def test_download_failure_is_recorded_and_retryable(monkeypatch):
    db = _db()
    monkeypatch.setattr(report_ingest, "supabase", db)

    def boom(creds, name):
        raise SftpDownloadError("SFTP download failed: OSError")

    monkeypatch.setattr(report_ingest, "download_file", boom)
    result = report_ingest.ingest_report_file(HOTEL, {}, _meta())
    assert result["status"] == "failed"
    assert _file_row(db)["error_detail"].startswith("download_failed")
    assert report_ingest.list_unprocessed_files(HOTEL, [_meta()]) == [_meta()]


def test_unsupported_report_type_is_skipped_not_failed(monkeypatch):
    db = _db()
    creds = _install(monkeypatch, db, b"irrelevant")
    result = report_ingest.ingest_report_file(HOTEL, creds, _meta("somethingelse_9.txt"))
    assert result["status"] == "skipped"
    assert _file_row(db, "somethingelse_9.txt")["error_detail"] == "unrecognized_report_type"


def test_existing_report_types_still_resolve_and_ingest(monkeypatch):
    db = _db()
    res_headers = ["ROOM_NO", "FULL_NAME", "VIP", "RESV_NAME_ID", "ARRIVAL", "DEPARTURE", "ADULTS"]
    creds = _install(monkeypatch, db, _report([["", "Guest Z", "", "55", "10-13-26", "10-14-26", "2"]], headers=res_headers))
    result = report_ingest.ingest_report_file(HOTEL, creds, _meta("res_detail_77.txt"))
    assert result["status"] == "processed" and result["rows_skipped"] == 1  # no room yet: cached only
    assert db.rows["opera_reservations"][0]["opera_reservation_id"] == "55"
    assert db.rows["opera_reservations"][0]["status"] == "RESERVED"


# ---------------------------------------------------------------------------
# sync_report_files: SFTP health and last_sync_at
# ---------------------------------------------------------------------------

def _sync(monkeypatch, db, lister, content=None):
    monkeypatch.setattr(report_ingest, "supabase", db)
    monkeypatch.setattr(report_ingest, "get_opera_credentials", lambda hotel_id: {"connection_mode": "sftp_report"})
    monkeypatch.setattr(report_ingest, "list_report_files", lambda creds: lister())
    if content is not None:
        monkeypatch.setattr(report_ingest, "download_file", lambda c, f: content)
    return report_ingest.sync_report_files(HOTEL)


def _last_sync(db):
    return db.rows["opera_credentials"][0]["last_sync_at"]


@pytest.mark.parametrize("error", [
    SftpAuthError("SFTP authentication failed"),
    SftpListError("SFTP directory listing failed: OSError"),
    SftpConnectionError("SFTP connection failed: ConnectionRefusedError"),
])
def test_listing_failure_is_a_failed_sync_and_never_advances_last_sync_at(monkeypatch, error):
    db = _db()

    def lister():
        raise error

    result = _sync(monkeypatch, db, lister)
    assert result["status"] == "failed" and result["error"] == str(error) and result["synced"] == 0
    assert _last_sync(db) is None


def test_unexpected_listing_crash_is_reported_as_failed(monkeypatch):
    db = _db()

    def lister():
        raise ValueError("boom")

    result = _sync(monkeypatch, db, lister)
    assert result["status"] == "failed" and "ValueError" in result["error"] and _last_sync(db) is None


def test_genuinely_empty_directory_is_a_successful_sync(monkeypatch):
    db = _db()
    result = _sync(monkeypatch, db, lambda: [])
    assert result["status"] == "ok" and result["error"] is None and result["files_processed"] == 0
    assert _last_sync(db) is not None


def test_successful_sync_advances_last_sync_at_and_reports_rows(monkeypatch):
    db = _db()
    old = datetime.now(timezone.utc) - timedelta(minutes=10)
    result = _sync(monkeypatch, db, lambda: [_meta(mtime=old)], content=_report([_row("101", "Guest A", "1")]))
    assert result["status"] == "ok" and result["files_processed"] == 1 and result["synced"] == 1
    assert _last_sync(db) is not None


def test_partial_failure_does_not_advance_last_sync_at(monkeypatch):
    db = _db()
    old = datetime.now(timezone.utc) - timedelta(minutes=10)
    files = [_meta("gibyroom_1.txt", old), _meta("gibyroom_2.txt", old)]

    def download(creds, name):
        if name == "gibyroom_2.txt":
            raise SftpDownloadError("SFTP download failed: OSError")
        return _report([_row("101", "Guest A", "1")])

    monkeypatch.setattr(report_ingest, "supabase", db)
    monkeypatch.setattr(report_ingest, "get_opera_credentials", lambda h: {"connection_mode": "sftp_report"})
    monkeypatch.setattr(report_ingest, "list_report_files", lambda c: files)
    monkeypatch.setattr(report_ingest, "download_file", download)
    result = report_ingest.sync_report_files(HOTEL)
    assert result["status"] == "partial" and result["files_processed"] == 1 and result["files_failed"] == 1
    assert result["error"] is None and result["synced"] == 1
    assert _last_sync(db) is None
    assert {r["remote_filename"]: r["status"] for r in db.rows["opera_report_files"]} == \
        {"gibyroom_1.txt": "processed", "gibyroom_2.txt": "failed"}


def test_a_file_that_may_still_be_uploading_is_deferred_not_recorded(monkeypatch):
    db = _db()
    fresh = datetime.now(timezone.utc) - timedelta(seconds=5)
    result = _sync(monkeypatch, db, lambda: [_meta(mtime=fresh)], content=_report([_row("101", "Guest A", "1")]))
    assert result["status"] == "ok" and result["files_deferred"] == 1 and result["files_processed"] == 0
    assert db.rows["opera_report_files"] == []
    assert db.rows["room_status"][0]["guest_name"] is None


def test_pilot_and_connection_mode_guards_are_unchanged(monkeypatch):
    db = _db(pilot=False)
    monkeypatch.setattr(report_ingest, "supabase", db)
    called = []
    monkeypatch.setattr(report_ingest, "list_report_files", lambda c: called.append(1) or [])
    assert report_ingest.sync_report_files(HOTEL) == \
        {"synced": 0, "skipped": True, "reason": "opera_pilot_not_enabled", "error": None}
    db2 = _db()
    monkeypatch.setattr(report_ingest, "supabase", db2)
    monkeypatch.setattr(report_ingest, "get_opera_credentials", lambda h: {"connection_mode": "api"})
    assert report_ingest.sync_report_files(HOTEL)["reason"] == "not_sftp_report_mode"
    assert called == []


# ---------------------------------------------------------------------------
# Cron: per-hotel isolation and honest cron_health
# ---------------------------------------------------------------------------

def _cron(monkeypatch, per_hotel):
    """Run the cron endpoint over two sftp_report tenants with scripted sync results."""
    db = FakeDB(rows={
        "opera_credentials": [{"tenant_id": "h1", "is_connected": True, "connection_mode": "sftp_report"},
                              {"tenant_id": "h2", "is_connected": True, "connection_mode": "sftp_report"}],
        "cron_health": [],
    })
    monkeypatch.setattr(internal, "supabase", db)
    import services.opera as opera_pkg

    def fake_sync(hotel_id):
        outcome = per_hotel[hotel_id]
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    monkeypatch.setattr(opera_pkg, "sync_report_files", fake_sync)
    result = asyncio.run(internal.sync_opera_report_files(x_cron_secret="test-cron-secret"))
    return db, result


def test_one_hotels_failure_does_not_interrupt_another_hotel(monkeypatch):
    db, result = _cron(monkeypatch, {"h1": RuntimeError("boom"), "h2": {"synced": 4, "status": "ok", "error": None}})
    by_hotel = {r["hotel_id"]: r for r in result["results"]}
    assert by_hotel["h1"]["status"] == "failed" and by_hotel["h2"]["synced"] == 4
    assert result["status"] == "partial" and result["hotels_failed"] == 1 and result["hotels_synced"] == 1
    health = db.rows["cron_health"][0]
    assert health["job_name"] == "opera.sftp-sync-reports" and "last_failure_at" in health
    assert "1 of 2" in health["last_error"]


def test_cron_health_reports_success_only_when_every_hotel_synced(monkeypatch):
    db, result = _cron(monkeypatch, {"h1": {"synced": 0, "status": "ok", "error": None},
                                     "h2": {"synced": 2, "status": "ok", "error": None}})
    health = db.rows["cron_health"][0]
    assert result["status"] == "ok" and health["last_error"] is None and "last_success_at" in health


@pytest.mark.parametrize("bad", [{"status": "failed", "error": "SFTP authentication failed"},
                                 {"status": "partial", "error": None}])
def test_failed_or_partial_hotel_marks_cron_health_failure(monkeypatch, bad):
    db, result = _cron(monkeypatch, {"h1": bad, "h2": {"synced": 0, "status": "ok", "error": None}})
    assert result["status"] == "partial" and db.rows["cron_health"][0]["last_error"]


# ---------------------------------------------------------------------------
# Router surface: manual sync response and host-key remediation message
# ---------------------------------------------------------------------------

def _gm_route_setup(monkeypatch):
    from middleware.auth import CurrentUser
    from routers import integrations as integrations_router

    gm = CurrentUser(user_id="gm-1", hotel_id=HOTEL, role="gm", email="gm@example.com")
    monkeypatch.setattr(integrations_router, "supabase", _db())
    return integrations_router, gm


@pytest.mark.asyncio
async def test_manual_sync_failed_poll_is_a_503_not_a_success(monkeypatch):
    from fastapi import HTTPException

    router, gm = _gm_route_setup(monkeypatch)
    monkeypatch.setattr(router, "sync_report_files",
                        lambda h: {"synced": 0, "status": "failed", "error": "SFTP authentication failed"})
    with pytest.raises(HTTPException) as exc:
        await router.opera_sftp_sync(current_user=gm)
    assert exc.value.status_code == 503 and exc.value.detail == "SFTP authentication failed"


@pytest.mark.asyncio
async def test_manual_sync_partial_reports_failures_and_no_synced_at(monkeypatch):
    router, gm = _gm_route_setup(monkeypatch)
    monkeypatch.setattr(router, "sync_report_files", lambda h: {
        "synced": 2, "files_processed": 1, "files_failed": 1, "status": "partial", "error": None})
    data = (await router.opera_sftp_sync(current_user=gm))["data"]
    assert data["status"] == "partial" and data["files_failed"] == 1 and data["synced_rows"] == 2
    assert data["synced_at"] is None


@pytest.mark.asyncio
async def test_manual_sync_success_has_a_timestamp(monkeypatch):
    router, gm = _gm_route_setup(monkeypatch)
    monkeypatch.setattr(router, "sync_report_files", lambda h: {
        "synced": 3, "files_processed": 1, "files_failed": 0, "status": "ok", "error": None})
    data = (await router.opera_sftp_sync(current_user=gm))["data"]
    assert data["status"] == "ok" and data["synced_at"]


@pytest.mark.asyncio
async def test_connect_without_a_pinned_host_key_is_refused_with_the_fingerprint_to_verify(monkeypatch):
    from fastapi import HTTPException
    from models.requests import OperaSftpConnectRequest
    from services.opera.sftp_client import SftpHostKeyError

    router, gm = _gm_route_setup(monkeypatch)

    def refuse(creds):
        raise SftpHostKeyError("SFTP host key is not pinned. Verify the server's fingerprint (SHA256:abc) and save it")

    monkeypatch.setattr(router, "sftp_test_connection", refuse)
    body = OperaSftpConnectRequest(sftp_host="sftp.example.com", sftp_username="opera", sftp_password="pw")
    with pytest.raises(HTTPException) as exc:
        await router.opera_sftp_connect(body=body, current_user=gm)
    assert exc.value.status_code == 400 and "SHA256:abc" in exc.value.detail
    assert router.supabase.rows.get("opera_credentials") == [{"tenant_id": HOTEL, "connection_mode": "sftp_report", "last_sync_at": None}]
