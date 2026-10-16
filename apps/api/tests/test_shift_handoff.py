"""Supervisor shift handoff: typed contract, authoritative inspection counts, Housekeeping department,
replay safety and notification recovery for POST/GET /v1/housekeeping/end-shift-summary."""

import copy
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from main import app
from routers import housekeeping as hk_router
from routers import logbook as logbook_router
from tests.smoke.fake_supabase import FakeDB

HOTEL = "hotel-a"
OTHER_HOTEL = "hotel-b"
SUPERVISOR = "77777777-7777-4777-8777-777777777777"
OTHER_SUPERVISOR = "88888888-8888-4888-8888-888888888888"
GM_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
GM_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
HK_DEPT = "11111111-1111-4111-8111-111111111111"
ENG_DEPT = "22222222-2222-4222-8222-222222222222"
OTHER_HOTEL_HK_DEPT = "33333333-3333-4333-8333-333333333333"

# America/Chicago is UTC-5 in October: the hotel day 2026-10-16 is [05:00Z, next day 05:00Z).
HOTEL_ZONE = "America/Chicago"
REPORT_DATE = "2026-10-16"


class FrozenNow(datetime):
    @classmethod
    def now(cls, tz=None):
        base = datetime(2026, 10, 16, 21, 30, tzinfo=timezone.utc)  # 16:30 hotel time on 2026-10-16
        return base.astimezone(tz) if tz else base


@pytest.fixture(autouse=True)
def frozen_clock(monkeypatch):
    monkeypatch.setattr(hk_router, "datetime", FrozenNow)


def _auth(user_id: str = SUPERVISOR, role: str = "housekeeping_supervisor", hotel: str = HOTEL) -> dict[str, str]:
    token = jwt.encode(
        {"sub": user_id, "role": role, "hotel_id": hotel, "aud": "authenticated"},
        settings.supabase_jwt_secret,
        algorithm="HS256",
    )
    return {"Authorization": f"Bearer {token}"}


def _inspection(result: str, completed_at: str, hotel: str = HOTEL, room: str = "r1") -> dict:
    return {
        "id": str(uuid4()),
        "tenant_id": hotel,
        "room_id": room,
        "overall_result": result,
        "completed_at": completed_at,
    }


def _db(**overrides) -> FakeDB:
    rows = {
        "tenants": [{"id": HOTEL, "timezone": HOTEL_ZONE}, {"id": OTHER_HOTEL, "timezone": HOTEL_ZONE}],
        "departments": [
            {"id": HK_DEPT, "tenant_id": HOTEL, "name": "Housekeeping", "code": "HK"},
            {"id": ENG_DEPT, "tenant_id": HOTEL, "name": "Engineering", "code": "ENG"},
            {"id": OTHER_HOTEL_HK_DEPT, "tenant_id": OTHER_HOTEL, "name": "Housekeeping", "code": "HK"},
        ],
        "shifts": [],
        "logbook_entries": [],
        "notifications": [],
        "user_roles": [
            {"user_id": GM_1, "tenant_id": HOTEL, "role": "gm", "is_active": True},
            {"user_id": GM_2, "tenant_id": HOTEL, "role": "gm", "is_active": True},
            {"user_id": SUPERVISOR, "tenant_id": HOTEL, "role": "housekeeping_supervisor", "is_active": True},
            {"user_id": "99999999-9999-4999-8999-999999999999", "tenant_id": OTHER_HOTEL, "role": "gm", "is_active": True},
        ],
        "inspections": [
            _inspection("passed", "2026-10-16T14:00:00+00:00"),
            _inspection("passed", "2026-10-16T15:00:00+00:00", room="r2"),
            _inspection("failed", "2026-10-16T16:00:00+00:00"),
            _inspection("conditional", "2026-10-16T17:00:00+00:00", room="r3"),
        ],
    }
    rows.update(overrides)
    return FakeDB(rows, unique_indexes=[("logbook_entries", "logbook_entries_client_request_uniq", ["tenant_id", "author_id", "client_request_id"], {})])


@pytest.fixture
def db(monkeypatch):
    database = _db()
    monkeypatch.setattr(hk_router, "supabase", database)
    monkeypatch.setattr(logbook_router, "supabase", database)
    return database


def _body(**overrides) -> dict:
    body = {
        "client_request_id": str(uuid4()),
        "report_date": REPORT_DATE,
        "rooms": {"total": 100, "out_of_order": 2, "ready": 68, "awaiting_inspection": 5, "in_progress": 3, "to_clean": 22},
        "inspections": {"passed": 2, "failed": 1, "conditional": 1},
        "unresolved": {
            "unassigned_rooms": 4,
            "unassigned_room_numbers": ["101", "102"],
            "awaiting_inspection_room_numbers": ["201"],
            "blocked_tasks": 2,
        },
        "notes": "Watch 312, deep clean after checkout.",
    }
    body.update(overrides)
    return body


def _post(body: dict, **auth):
    return TestClient(app).post("/v1/housekeeping/end-shift-summary", headers=_auth(**auth), json=body)


# ── Contract ────────────────────────────────────────────────────────────────


def test_pre_contract_mobile_payload_is_rejected_not_saved_as_zeros(db):
    legacy = {
        "rooms_completed": 68,
        "rooms_inspected": 68,
        "rooms_failed": 0,
        "rooms_ooo": 2,
        "supervisor_notes": "old shape",
    }
    response = _post(legacy)
    assert response.status_code == 422
    assert db.inserts == []


@pytest.mark.parametrize("missing", ["client_request_id", "report_date", "rooms", "inspections", "unresolved"])
def test_missing_authoritative_metric_blocks_are_rejected(db, missing):
    body = _body()
    del body[missing]
    assert _post(body).status_code == 422
    assert db.inserts == []


def test_a_missing_single_count_is_rejected_not_defaulted_to_zero(db):
    body = _body()
    del body["inspections"]["failed"]
    assert _post(body).status_code == 422
    body = _body()
    del body["rooms"]["ready"]
    assert _post(body).status_code == 422


@pytest.mark.parametrize(
    "mutate",
    [
        lambda b: b["rooms"].update(ready=-1),
        lambda b: b["rooms"].update(ready=99, to_clean=22),  # status counts exceed in-service rooms
        lambda b: b["rooms"].update(out_of_order=101),
        lambda b: b["inspections"].update(passed="many"),
        lambda b: b["unresolved"].update(unassigned_room_numbers=["1", "2", "3", "4", "5"]),  # more numbers than count
        lambda b: b["unresolved"].update(awaiting_inspection_room_numbers=["1"] * 6),
        lambda b: b.update(client_request_id="not-a-uuid"),
        lambda b: b.update(unexpected_field=1),
    ],
)
def test_malformed_metrics_are_rejected(db, mutate):
    body = _body()
    mutate(body)
    assert _post(body).status_code == 422
    assert db.inserts == []


def test_blocked_task_count_may_be_unknown_and_is_reported_as_not_verified(db):
    body = _body()
    body["unresolved"]["blocked_tasks"] = None
    response = _post(body)
    assert response.status_code == 200
    content = db.rows["logbook_entries"][0]["content"]
    assert "blocked tasks: not verified" in content
    assert "0 blocked" not in content


def test_report_date_must_be_today_or_yesterday_in_the_hotel_zone(db):
    assert _post(_body(report_date="2026-10-17")).status_code == 422  # tomorrow
    assert _post(_body(report_date="2026-10-14")).status_code == 422  # two days back
    assert db.inserts == []


# ── Authorization & tenancy ─────────────────────────────────────────────────


@pytest.mark.parametrize("role", ["housekeeper", "front_desk", "engineer"])
def test_other_roles_cannot_submit_or_read(db, role):
    assert _post(_body(), role=role).status_code == 403
    response = TestClient(app).get(f"/v1/housekeeping/end-shift-summary/{uuid4()}", headers=_auth(role=role))
    assert response.status_code == 403


def test_gm_may_submit(db):
    assert _post(_body(), user_id=GM_1, role="gm").status_code == 200


# ── Authoritative inspection counts ─────────────────────────────────────────


def test_saves_the_housekeeping_entry_with_reviewed_figures(db):
    response = _post(_body())
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["id"]
    assert response.json()["idempotent_replay"] is False
    entry = db.rows["logbook_entries"][0]
    assert entry["department_id"] == HK_DEPT
    assert entry["tenant_id"] == HOTEL
    assert entry["author_id"] == SUPERVISOR
    assert entry["entry_date"] == REPORT_DATE
    for text in ["68 of 98 in-service rooms ready", "2 passed, 1 failed, 1 conditional", "101, 102", "Watch 312"]:
        assert text in entry["content"]
    assert "does not complete work or clock anyone out" in entry["content"]


def test_stale_inspection_counts_are_refused_with_the_current_figures(db):
    body = _body(inspections={"passed": 63, "failed": 0, "conditional": 0})  # what the old modal could send
    response = _post(body)
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["code"] == "inspection_counts_changed"
    assert detail["inspections"] == {"passed": 2, "failed": 1, "conditional": 1}
    assert db.rows["logbook_entries"] == []


def test_inspection_window_is_the_hotel_local_day_not_the_utc_day(db):
    # 04:59Z is 23:59 the previous hotel day; 05:00Z opens 2026-10-16; the next day starts 05:00Z on the 17th.
    db.rows["inspections"] = [
        _inspection("failed", "2026-10-16T04:59:00+00:00"),
        _inspection("passed", "2026-10-16T05:00:00+00:00"),
        _inspection("passed", "2026-10-17T04:59:00+00:00"),
        _inspection("failed", "2026-10-17T05:00:00+00:00"),
    ]
    ok = _post(_body(inspections={"passed": 2, "failed": 0, "conditional": 0}))
    assert ok.status_code == 200


def test_same_room_inspected_twice_counts_twice_and_other_hotels_are_excluded(db):
    db.rows["inspections"] = [
        _inspection("failed", "2026-10-16T14:00:00+00:00", room="r1"),
        _inspection("passed", "2026-10-16T18:00:00+00:00", room="r1"),
        _inspection("passed", "2026-10-16T18:00:00+00:00", hotel=OTHER_HOTEL, room="x"),
    ]
    ok = _post(_body(inspections={"passed": 1, "failed": 1, "conditional": 0}))
    assert ok.status_code == 200


def test_a_hotel_with_no_inspections_reports_a_true_zero(db):
    db.rows["inspections"] = []
    assert _post(_body(inspections={"passed": 0, "failed": 0, "conditional": 0})).status_code == 200


# ── Department safety ───────────────────────────────────────────────────────


def test_no_housekeeping_department_fails_instead_of_using_another(monkeypatch):
    database = _db(departments=[{"id": ENG_DEPT, "tenant_id": HOTEL, "name": "Engineering", "code": "ENG"}])
    monkeypatch.setattr(hk_router, "supabase", database)
    response = _post(_body())
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "housekeeping_department_missing"
    assert database.rows["logbook_entries"] == []


def test_another_hotels_housekeeping_department_is_never_used(monkeypatch):
    database = _db(departments=[{"id": OTHER_HOTEL_HK_DEPT, "tenant_id": OTHER_HOTEL, "name": "Housekeeping", "code": "HK"}])
    monkeypatch.setattr(hk_router, "supabase", database)
    assert _post(_body()).status_code == 422


def test_two_housekeeping_departments_are_ambiguous_not_guessed(monkeypatch):
    departments = [
        {"id": HK_DEPT, "tenant_id": HOTEL, "name": "Housekeeping", "code": "HK"},
        {"id": ENG_DEPT, "tenant_id": HOTEL, "name": "Housekeeping", "code": "HK2"},
    ]
    database = _db(departments=departments)
    monkeypatch.setattr(hk_router, "supabase", database)
    response = _post(_body())
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "housekeeping_department_ambiguous"


# ── Replay safety ───────────────────────────────────────────────────────────


def test_same_request_twice_saves_one_report_and_one_set_of_notifications(db):
    body = _body()
    first = _post(body)
    second = _post(body)
    assert first.status_code == second.status_code == 200
    assert len(db.rows["logbook_entries"]) == 1
    assert second.json()["data"]["id"] == first.json()["data"]["id"]
    assert second.json()["idempotent_replay"] is True
    recipients = sorted(n["user_id"] for n in db.rows["notifications"])
    assert recipients == sorted([GM_1, GM_2])


def test_replay_answers_even_if_the_inspection_counts_have_moved_on(db):
    body = _body()
    assert _post(body).status_code == 200
    db.rows["inspections"].append(_inspection("failed", "2026-10-16T19:00:00+00:00"))
    again = _post(body)
    assert again.status_code == 200
    assert again.json()["idempotent_replay"] is True
    assert len(db.rows["logbook_entries"]) == 1


def test_distinct_requests_are_distinct_reports(db):
    assert _post(_body()).status_code == 200
    assert _post(_body()).status_code == 200
    assert len(db.rows["logbook_entries"]) == 2


def test_the_same_key_from_another_person_is_a_different_report(db):
    body = _body()
    assert _post(body).status_code == 200
    other = _post(body, user_id=OTHER_SUPERVISOR)
    assert other.status_code == 200
    assert other.json()["idempotent_replay"] is False
    assert len(db.rows["logbook_entries"]) == 2


def test_a_lost_race_answers_with_the_winning_report(db, monkeypatch):
    body = _body()
    winner = _post(body).json()["data"]
    real = hk_router._find_handoff
    calls = {"n": 0}

    def blind_first(*args, **kwargs):
        calls["n"] += 1
        return None if calls["n"] == 1 else real(*args, **kwargs)

    monkeypatch.setattr(hk_router, "_find_handoff", blind_first)
    response = _post(body)
    assert response.status_code == 200
    assert response.json()["idempotent_replay"] is True
    assert response.json()["data"]["id"] == winner["id"]
    assert len(db.rows["logbook_entries"]) == 1
    assert len(db.rows["notifications"]) == 2


# ── Notifications ───────────────────────────────────────────────────────────


def test_author_gm_is_not_notified_about_their_own_report(db):
    assert _post(_body(), user_id=GM_1, role="gm").status_code == 200
    assert [n["user_id"] for n in db.rows["notifications"]] == [GM_2]


def test_notification_rows_link_to_the_saved_report(db):
    entry_id = _post(_body()).json()["data"]["id"]
    for row in db.rows["notifications"]:
        assert row["type"] == "shift_summary"
        assert row["data"]["entry_id"] == entry_id
        assert row["tenant_id"] == HOTEL


class _FailingNotifications:
    def __init__(self, real, fail):
        self._real, self._fail = real, fail

    def upsert(self, *args, **kwargs):
        if self._fail["on"]:
            raise RuntimeError("notifications unavailable")
        return self._real.upsert(*args, **kwargs)

    def __getattr__(self, name):
        return getattr(self._real, name)


def test_notification_failure_keeps_the_saved_report_and_a_retry_completes_it(db, monkeypatch):
    fail = {"on": True}
    real_table = db.table
    monkeypatch.setattr(
        db, "table", lambda name: _FailingNotifications(real_table(name), fail) if name == "notifications" else real_table(name)
    )
    body = _body()
    first = _post(body)
    assert first.status_code == 200  # the report IS saved
    assert first.json()["notifications"]["status"] == "failed"
    assert len(db.rows["logbook_entries"]) == 1
    assert db.rows["notifications"] == []

    fail["on"] = False
    retry = _post(body)
    assert retry.status_code == 200
    assert retry.json()["idempotent_replay"] is True
    assert retry.json()["notifications"]["status"] == "complete"
    assert len(db.rows["logbook_entries"]) == 1
    assert len(db.rows["notifications"]) == 2

    _post(body)  # a further retry must not double them
    assert len(db.rows["notifications"]) == 2


# ── Retrieval ───────────────────────────────────────────────────────────────


def test_a_saved_report_can_be_retrieved_by_its_request_id(db):
    body = _body()
    saved = _post(body).json()["data"]
    response = TestClient(app).get(f"/v1/housekeeping/end-shift-summary/{body['client_request_id']}", headers=_auth())
    assert response.status_code == 200
    assert response.json()["data"]["id"] == saved["id"]
    assert response.json()["data"]["content"] == saved["content"]


def test_unknown_request_id_is_404_and_writes_nothing(db):
    response = TestClient(app).get(f"/v1/housekeeping/end-shift-summary/{uuid4()}", headers=_auth())
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "handoff_not_found"
    assert db.inserts == []


def test_retrieval_is_scoped_to_the_author_and_hotel(db):
    body = _body()
    _post(body)
    path = f"/v1/housekeeping/end-shift-summary/{body['client_request_id']}"
    assert TestClient(app).get(path, headers=_auth(user_id=OTHER_SUPERVISOR)).status_code == 404
    assert TestClient(app).get(path, headers=_auth(hotel=OTHER_HOTEL)).status_code == 404


# ── No side effects on operational records ──────────────────────────────────


def test_submitting_only_writes_the_logbook_entry_and_notifications(db):
    snapshot = copy.deepcopy({k: v for k, v in db.rows.items() if k not in ("logbook_entries", "notifications")})
    assert _post(_body()).status_code == 200
    assert {t for t, _ in db.inserts} == {"logbook_entries", "notifications"}
    assert db.updates == [] and db.deletes == []
    for table, rows in snapshot.items():
        assert db.rows[table] == rows
