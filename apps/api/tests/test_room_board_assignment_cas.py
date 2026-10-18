"""Room Board V2 phase 7: POST /housekeeping/assignments compare-and-set.

Clients that show the current owner send `expected_assigned_to` / `expect_unassigned`. The server must then
refuse (409) instead of overwriting a newer assignment or moving a room whose cleaning already started, and the
original unconditional upsert must keep working for clients that send neither (web, AI assignment).
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from main import app
from routers import housekeeping as housekeeping_router
from tests.smoke.fake_supabase import FakeDB

HOTEL = "hotel-a"
OTHER_HOTEL = "hotel-b"
DATE = "2026-10-18"
HK_A, HK_B, HK_C = (str(uuid.uuid4()) for _ in range(3))
ROOMS = {name: str(uuid.uuid4()) for name in ["free", "owned", "mirror", "busy", "done", "inspected", "ooo", "foreign"]}


def _auth(role="housekeeping_supervisor"):
    payload = {"sub": "sup-1", "role": role, "hotel_id": HOTEL, "aud": "authenticated"}
    token = jwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def db(monkeypatch):
    def rs(room, status, assigned_to=None, tenant=HOTEL):
        return {"room_id": ROOMS[room], "tenant_id": tenant, "status": status, "assigned_to": assigned_to, "clean_type": None}

    fake = FakeDB(
        {
            "rooms": [
                {"id": rid, "tenant_id": OTHER_HOTEL if name == "foreign" else HOTEL, "room_number": name}
                for name, rid in ROOMS.items()
            ],
            "room_status": [
                rs("free", "DIRTY"),
                rs("owned", "DIRTY", HK_A),
                rs("mirror", "DIRTY", HK_A),
                rs("busy", "IN_PROGRESS", HK_A),
                rs("done", "CLEAN", HK_A),
                rs("inspected", "INSPECTED", HK_A),
                rs("ooo", "OOO"),
                rs("foreign", "DIRTY", tenant=OTHER_HOTEL),
            ],
            "room_assignments": [
                {"id": "ra-owned", "tenant_id": HOTEL, "room_id": ROOMS["owned"], "assigned_to": HK_A, "assignment_date": DATE},
                {"id": "ra-busy", "tenant_id": HOTEL, "room_id": ROOMS["busy"], "assigned_to": HK_A, "assignment_date": DATE},
            ],
            "user_roles": [
                {"id": f"ur-{hk}", "user_id": hk, "tenant_id": HOTEL, "role": "housekeeper", "is_active": True}
                for hk in (HK_A, HK_B, HK_C)
            ],
        },
        unique_indexes=[("room_assignments", "room_assignments_room_date", ["room_id", "assignment_date"], {})],
    )

    async def _no_push(**_kwargs):
        return None

    monkeypatch.setattr(housekeeping_router, "supabase", fake)
    monkeypatch.setattr(housekeeping_router, "send_push", _no_push)
    return fake


@pytest.fixture
def client(db):
    return TestClient(app)


def _post(client, room, to, role="housekeeping_supervisor", **extra):
    item = {"room_id": ROOMS[room], "housekeeper_id": to, **extra}
    return client.post("/v1/housekeeping/assignments", json={"date": DATE, "assignments": [item]}, headers=_auth(role))


def _owner(db, room):
    row = next((r for r in db.rows["room_assignments"] if r["room_id"] == ROOMS[room]), None)
    return row["assigned_to"] if row else None


def _mirror(db, room):
    return next(r for r in db.rows["room_status"] if r["room_id"] == ROOMS[room])["assigned_to"]


class TestConditionalAssignment:
    def test_assigns_an_unassigned_room_when_it_is_still_unassigned(self, client, db):
        response = _post(client, "free", HK_B, expect_unassigned=True)
        assert response.status_code == 200
        assert _owner(db, "free") == HK_B
        assert _mirror(db, "free") == HK_B

    def test_refuses_to_assign_when_someone_else_got_there_first(self, client, db):
        db.rows["room_assignments"].append(
            {"id": "ra-new", "tenant_id": HOTEL, "room_id": ROOMS["free"], "assigned_to": HK_C, "assignment_date": DATE}
        )
        response = _post(client, "free", HK_B, expect_unassigned=True)
        assert response.status_code == 409
        assert _owner(db, "free") == HK_C

    def test_reassigns_when_the_owner_is_who_the_supervisor_reviewed(self, client, db):
        response = _post(client, "owned", HK_B, expected_assigned_to=HK_A)
        assert response.status_code == 200
        assert _owner(db, "owned") == HK_B
        assert _mirror(db, "owned") == HK_B

    def test_refuses_to_overwrite_a_newer_assignment(self, client, db):
        next(r for r in db.rows["room_assignments"] if r["room_id"] == ROOMS["owned"])["assigned_to"] = HK_C
        response = _post(client, "owned", HK_B, expected_assigned_to=HK_A)
        assert response.status_code == 409
        assert _owner(db, "owned") == HK_C

    def test_a_mirror_only_owner_is_compared_and_reassigned_with_a_dated_row(self, client, db):
        assert _post(client, "mirror", HK_B, expected_assigned_to=HK_C).status_code == 409
        assert _owner(db, "mirror") is None
        assert _post(client, "mirror", HK_B, expected_assigned_to=HK_A).status_code == 200
        assert _owner(db, "mirror") == HK_B

    def test_expecting_unassigned_on_an_owned_room_is_refused(self, client, db):
        assert _post(client, "owned", HK_B, expect_unassigned=True).status_code == 409
        assert _owner(db, "owned") == HK_A

    def test_a_repeated_submission_cannot_apply_twice(self, client, db):
        assert _post(client, "free", HK_B, expect_unassigned=True).status_code == 200
        assert _post(client, "free", HK_B, expect_unassigned=True).status_code == 409
        assert len([r for r in db.rows["room_assignments"] if r["room_id"] == ROOMS["free"]]) == 1

    @pytest.mark.parametrize("room", ["busy", "done", "inspected", "ooo"])
    def test_a_room_that_is_started_finished_or_out_of_service_is_never_moved(self, client, db, room):
        before_owner, before_mirror = _owner(db, room), _mirror(db, room)
        if before_mirror:
            response = _post(client, room, HK_B, expected_assigned_to=before_mirror)
        else:
            response = _post(client, room, HK_B, expect_unassigned=True)
        assert response.status_code == 409
        assert _owner(db, room) == before_owner
        assert _mirror(db, room) == before_mirror

    def test_status_progress_is_never_rewritten(self, client, db):
        _post(client, "owned", HK_B, expected_assigned_to=HK_A, clean_type="FULL")
        status = next(r for r in db.rows["room_status"] if r["room_id"] == ROOMS["owned"])["status"]
        assert status in {"DIRTY", "PICKUP"}

    def test_both_expectations_at_once_is_rejected(self, client, db):
        response = _post(client, "owned", HK_B, expected_assigned_to=HK_A, expect_unassigned=True)
        assert response.status_code == 422
        assert _owner(db, "owned") == HK_A

    def test_a_room_in_another_hotel_is_not_found(self, client, db):
        assert _post(client, "foreign", HK_B, expect_unassigned=True).status_code == 404

    def test_a_batch_with_one_stale_item_writes_nothing(self, client, db):
        body = {
            "date": DATE,
            "assignments": [
                {"room_id": ROOMS["free"], "housekeeper_id": HK_B, "expect_unassigned": True},
                {"room_id": ROOMS["owned"], "housekeeper_id": HK_B, "expected_assigned_to": HK_C},
            ],
        }
        assert client.post("/v1/housekeeping/assignments", json=body, headers=_auth()).status_code == 409
        assert _owner(db, "free") is None
        assert _owner(db, "owned") == HK_A

    def test_a_housekeeper_cannot_assign(self, client, db):
        assert _post(client, "free", HK_B, role="housekeeper", expect_unassigned=True).status_code == 403


class TestLegacyClientsKeepWorking:
    def test_without_expectations_the_original_upsert_still_overwrites(self, client, db):
        assert _post(client, "owned", HK_B).status_code == 200
        assert _owner(db, "owned") == HK_B

    def test_without_expectations_a_new_assignment_is_created(self, client, db):
        assert _post(client, "free", HK_C).status_code == 200
        assert _owner(db, "free") == HK_C
