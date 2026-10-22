"""Assignments V2 phase 6: POST /housekeeping/smart-balance/plan.

The solver itself is covered in test_smart_balance_solver.py. These tests cover what the HTTP layer owns: who may
call it, that the tenant and identity come from the session, that every room and person is VERIFIED against the
database before they are planned, and - above all - that generating a plan WRITES NOTHING.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from dateutil import tz
from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from main import app
from routers import housekeeping as housekeeping_router
from tests.smoke.fake_supabase import FakeDB
from tests.test_reports_views import reset_rate_limits

HOTEL = "00000000-0000-4000-8000-00000000000a"
OTHER_HOTEL = "00000000-0000-4000-8000-00000000000b"
SUPERVISOR = "00000000-0000-4000-8000-0000000000a1"
HK_A, HK_B, HK_OTHER_HOTEL = (str(uuid.uuid4()) for _ in range(3))
ROOMS = [str(uuid.uuid4()) for _ in range(6)]
FOREIGN_ROOM = str(uuid.uuid4())
TODAY = datetime.now(tz.gettz("America/Chicago")).date().isoformat()


class ReadOnlyDB(FakeDB):
    """A FakeDB that fails loudly if the plan endpoint ever tries to write or call a database function."""

    def rpc(self, *_args, **_kwargs):
        raise AssertionError("planning must not call a database function")


def _auth(role="housekeeping_supervisor", hotel=HOTEL):
    token = jwt.encode({"sub": SUPERVISOR, "role": role, "hotel_id": hotel, "aud": "authenticated"}, settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def _status(room_id, **kw):
    return {"room_id": room_id, "tenant_id": HOTEL, "status": "DIRTY", "assigned_to": None, "dnd_flag": False, "do_not_service": False, "dnd_retry_at": None, **kw}


def _room(room_id, number, owner=None, **kw):
    return {"room_id": room_id, "room_number": number, "floor": 1, "building": "A", "expected_owner_id": owner, "minutes": 30, "minutes_basis": "room_type", "credits": 3, "reasons": [], **kw}


def _person(user_id, **kw):
    return {"user_id": user_id, "base_minutes": 0, "base_unknown_rooms": 0, "base_rooms": 0, "base_credits": 0, "credits_complete": True, "floors": [], "buildings": [], **kw}


def _body(rooms=None, staff=None, **extra):
    return {
        "date": TODAY,
        "scope": "unassigned",
        "rooms": rooms if rooms is not None else [_room(ROOMS[0], "101"), _room(ROOMS[1], "102")],
        "staff": staff if staff is not None else [_person(HK_A), _person(HK_B)],
        "preferences": {},
        **extra,
    }


@pytest.fixture(autouse=True)
def _fresh_rate_limits():
    """This suite sends many requests in one process; clear the in-process limiter so it cannot throttle other suites."""
    reset_rate_limits()
    yield
    reset_rate_limits()


@pytest.fixture
def db(monkeypatch):
    fake = ReadOnlyDB(
        rows={
            "tenants": [{"id": HOTEL, "timezone": "America/Chicago"}],
            "room_status": [_status(room) for room in ROOMS],
            "room_assignments": [],
            "room_occupancy_discrepancies": [],
            "user_roles": [
                {"tenant_id": HOTEL, "user_id": HK_A, "role": "housekeeper", "is_active": True},
                {"tenant_id": HOTEL, "user_id": HK_B, "role": "housekeeping_supervisor", "is_active": True},
                {"tenant_id": OTHER_HOTEL, "user_id": HK_OTHER_HOTEL, "role": "housekeeper", "is_active": True},
            ],
        }
    )
    monkeypatch.setattr(housekeeping_router, "supabase", fake)
    return fake


@pytest.fixture
def client(db):
    return TestClient(app)


def _plan(client, body=None, **auth):
    return client.post("/v1/housekeeping/smart-balance/plan", json=body or _body(), headers=_auth(**auth))


def _assert_nothing_written(db):
    assert db.inserts == [] and db.updates == [] and db.deletes == []


class TestAccessAndIdentity:
    @pytest.mark.parametrize("role", ["housekeeper", "engineer", "front_desk"])
    def test_only_a_gm_or_housekeeping_supervisor_may_plan(self, client, role):
        assert _plan(client, role=role).status_code == 403

    @pytest.mark.parametrize("role", ["gm", "housekeeping_supervisor"])
    def test_supervisors_and_gms_may_plan(self, client, role):
        assert _plan(client, role=role).status_code == 200

    @pytest.mark.parametrize("field", ["tenant_id", "hotel_id", "actor_id", "assigned_by", "apply"])
    def test_the_body_cannot_name_a_tenant_an_actor_or_ask_to_apply(self, client, db, field):
        body = _body()
        body[field] = HOTEL
        assert _plan(client, body).status_code == 422
        _assert_nothing_written(db)

    def test_unknown_preference_and_room_fields_are_refused(self, client):
        assert _plan(client, _body(preferences={"disable_safety": True})).status_code == 422
        assert _plan(client, _body(rooms=[{**_room(ROOMS[0], "101"), "status": "READY"}])).status_code == 422

    def test_duplicates_and_oversized_requests_are_refused(self, client):
        assert _plan(client, _body(rooms=[_room(ROOMS[0], "101"), _room(ROOMS[0], "101")])).status_code == 422
        assert _plan(client, _body(staff=[_person(HK_A), _person(HK_A)])).status_code == 422
        many = [_room(str(uuid.uuid4()), str(i)) for i in range(301)]
        assert _plan(client, _body(rooms=many)).status_code == 422


class TestPlanningIsReadOnly:
    def test_a_plan_is_returned_and_nothing_is_written_anywhere(self, client, db):
        response = _plan(client)
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["read_only"] is True and data["scope"] == "unassigned" and data["date"] == TODAY
        assert data["status"] in ("optimal", "feasible")
        assert sorted(a["room_id"] for a in data["assignments"]) == sorted(ROOMS[:2])
        assert {a["to_user_id"] for a in data["assignments"]} == {HK_A, HK_B}
        assert data["counts"]["new"] == 2 and data["counts"]["moved"] == 0 and data["counts"]["unallocated"] == 0
        _assert_nothing_written(db)
        assert not [call for call in db.select_calls if call[0] in ("notifications", "push_tokens")]

    def test_the_answer_for_identical_input_is_identical(self, client):
        first = _plan(client).json()["data"]
        second = _plan(client).json()["data"]
        assert first["plan_id"] == second["plan_id"]
        assert first["assignments"] == second["assignments"]

    def test_the_snapshot_time_is_echoed_so_a_stale_answer_can_be_recognised(self, client):
        data = _plan(client, _body(snapshot_verified_at=1_700_000_000_000)).json()["data"]
        assert data["snapshot_verified_at"] == 1_700_000_000_000


class TestTheOperatingDay:
    def test_a_plan_for_another_day_is_refused_with_the_hotels_own_day(self, client, db):
        yesterday = (datetime.now(tz.gettz("America/Chicago")).date() - timedelta(days=1)).isoformat()
        response = _plan(client, _body(date=yesterday))
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "date_mismatch" and response.json()["detail"]["expected_date"] == TODAY
        _assert_nothing_written(db)


class TestRoomsAreVerifiedNotTrusted:
    def test_a_room_of_another_hotel_is_not_planned_and_looks_like_a_missing_room(self, client, db):
        db.rows["room_status"].append({**_status(FOREIGN_ROOM), "tenant_id": OTHER_HOTEL})
        data = _plan(client, _body(rooms=[_room(ROOMS[0], "101"), _room(FOREIGN_ROOM, "999")])).json()["data"]
        assert [a["room_id"] for a in data["assignments"]] == [ROOMS[0]]
        assert data["rejected_rooms"] == [{"room_id": FOREIGN_ROOM, "room_number": "999", "reason": "not_found"}]

    def test_a_room_that_is_not_in_an_assignable_stage_is_never_planned(self, client, db):
        db.rows["room_status"][0]["status"] = "IN_PROGRESS"
        db.rows["room_status"][1]["status"] = "CLEAN"
        data = _plan(client).json()["data"]
        assert data["assignments"] == []
        assert {r["reason"] for r in data["rejected_rooms"]} == {"not_assignable"}

    @pytest.mark.parametrize(
        "patch,block",
        [
            ({"dnd_flag": True}, "dnd"),
            ({"do_not_service": True}, "service_declined"),
            ({"dnd_retry_at": (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()}, "return_later"),
        ],
    )
    def test_soft_blocked_rooms_are_never_planned(self, client, db, patch, block):
        db.rows["room_status"][0].update(patch)
        data = _plan(client).json()["data"]
        assert ROOMS[0] not in [a["room_id"] for a in data["assignments"]]
        rejected = next(r for r in data["rejected_rooms"] if r["room_id"] == ROOMS[0])
        assert rejected["reason"] == "room_blocked" and block in rejected["blocks"]

    def test_an_open_occupancy_discrepancy_blocks_the_room(self, client, db):
        db.rows["room_occupancy_discrepancies"].append({"tenant_id": HOTEL, "room_id": ROOMS[0], "status": "open"})
        data = _plan(client).json()["data"]
        assert next(r for r in data["rejected_rooms"] if r["room_id"] == ROOMS[0])["blocks"] == ["occupancy_discrepancy"]

    def test_a_past_return_time_blocks_nothing(self, client, db):
        db.rows["room_status"][0]["dnd_retry_at"] = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        assert ROOMS[0] in [a["room_id"] for a in _plan(client).json()["data"]["assignments"]]

    def test_a_room_whose_owner_changed_since_the_supervisor_looked_is_returned_not_planned(self, client, db):
        db.rows["room_status"][0]["assigned_to"] = HK_B
        data = _plan(client).json()["data"]  # the app expected it unassigned
        assert ROOMS[0] not in [a["room_id"] for a in data["assignments"]]
        assert data["rejected_rooms"][0] == {"room_id": ROOMS[0], "room_number": "101", "reason": "owner_changed", "current_owner_id": HK_B}

    def test_the_dated_assignment_wins_over_the_status_mirror(self, client, db):
        db.rows["room_status"][0]["assigned_to"] = HK_A
        db.rows["room_assignments"].append({"tenant_id": HOTEL, "room_id": ROOMS[0], "assignment_date": TODAY, "assigned_to": HK_B})
        body = _body(scope="all_unstarted", rooms=[_room(ROOMS[0], "101", owner=HK_B)])
        data = _plan(client, body).json()["data"]
        assert data["rejected_rooms"] == []
        assert data["assignments"][0]["from_user_id"] == HK_B

    def test_an_expected_owner_that_matches_is_planned_as_retained_or_moved_never_as_new(self, client, db):
        db.rows["room_status"][0]["assigned_to"] = HK_A
        body = _body(scope="all_unstarted", rooms=[_room(ROOMS[0], "101", owner=HK_A)])
        data = _plan(client, body).json()["data"]
        assert [a["kind"] for a in data["assignments"]] == ["retained"]
        assert data["counts"]["retained"] == 1 and data["counts"]["new"] == 0


class TestPeopleAreVerifiedNotTrusted:
    def test_an_employee_of_another_hotel_never_receives_a_room(self, client):
        data = _plan(client, _body(staff=[_person(HK_A), _person(HK_OTHER_HOTEL)])).json()["data"]
        assert {a["to_user_id"] for a in data["assignments"]} == {HK_A}
        assert data["rejected_staff"] == [{"user_id": HK_OTHER_HOTEL, "reason": "not_eligible"}]

    def test_an_inactive_or_non_housekeeping_employee_is_not_eligible(self, client, db):
        db.rows["user_roles"][0]["is_active"] = False
        db.rows["user_roles"].append({"tenant_id": HOTEL, "user_id": SUPERVISOR, "role": "gm", "is_active": True})
        data = _plan(client, _body(staff=[_person(HK_A), _person(SUPERVISOR)])).json()["data"]
        assert {r["user_id"] for r in data["rejected_staff"]} == {HK_A, SUPERVISOR}
        assert data["status"] == "no_staff"

    def test_with_no_eligible_staff_the_rooms_are_reported_not_invented(self, client):
        data = _plan(client, _body(staff=[_person(HK_OTHER_HOTEL)])).json()["data"]
        assert data["status"] == "no_staff" and data["assignments"] == []
        assert {u["reason"] for u in data["unallocated"]} == {"no_eligible_staff"}


class TestFailureIsNotZero:
    def test_a_verification_failure_is_an_error_not_an_empty_plan(self, client, monkeypatch):
        def boom(*_args, **_kwargs):
            raise RuntimeError("database unreachable")

        monkeypatch.setattr(housekeeping_router, "_verify_smart_balance_rooms", boom)
        response = _plan(client)
        assert response.status_code == 503 and response.json()["detail"]["code"] == "verification_unavailable"

    def test_capacity_limits_become_unallocated_rooms_with_a_reason_not_a_forced_assignment(self, client):
        rooms = [_room(ROOMS[i], str(101 + i)) for i in range(3)]
        data = _plan(client, _body(rooms=rooms, staff=[_person(HK_A, credit_target=3)])).json()["data"]
        assert len(data["assignments"]) == 1 and len(data["unallocated"]) == 2
        assert {u["reason"] for u in data["unallocated"]} == {"insufficient_capacity"}
