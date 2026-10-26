"""Assignments V2 phase 4: guarded single-room removal and server-checked acknowledgements.

POST /housekeeping/assignments/remove must carry the owner the supervisor reviewed INTO the write, so a room that
changed hands (or started being cleaned) between the read and the delete removes nothing and answers 409. The
acknowledged_blocks check on POST /housekeeping/assignments is opt-in: omitted keeps the Room Board's behaviour.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from main import app
from routers import housekeeping as housekeeping_router
from tests.smoke.fake_supabase import FakeDB, FakeQuery

HOTEL = "hotel-a"
OTHER_HOTEL = "hotel-b"
DATE = "2026-10-22"
HK_A, HK_B, HK_C = (str(uuid.uuid4()) for _ in range(3))
NAMES = ["free", "owned", "mirror", "busy", "done", "dnd", "declined", "later", "discrepancy", "foreign", "stale_mirror"]
ROOMS = {name: str(uuid.uuid4()) for name in NAMES}
FUTURE = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()
PAST = (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat()


def _auth(role="housekeeping_supervisor", hotel=HOTEL):
    payload = {"sub": "sup-1", "role": role, "hotel_id": hotel, "aud": "authenticated"}
    token = jwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


class RacingDB(FakeDB):
    """A FakeDB whose next room_assignments DELETE first runs `before_delete` - another supervisor acting between
    the endpoint's read and its write."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.before_delete = None

    def table(self, name):
        query = FakeQuery(self, name)
        if name == "room_assignments" and self.before_delete is not None:
            original = query.delete

            def delete():
                hook, self.before_delete = self.before_delete, None
                hook()
                return original()

            query.delete = delete
        return query


@pytest.fixture
def db(monkeypatch):
    def rs(room, status="DIRTY", assigned_to=None, tenant=HOTEL, **extra):
        return {"room_id": ROOMS[room], "tenant_id": tenant, "status": status, "assigned_to": assigned_to, "clean_type": None, **extra}

    fake = RacingDB(
        {
            "rooms": [
                {"id": rid, "tenant_id": OTHER_HOTEL if name == "foreign" else HOTEL, "room_number": name}
                for name, rid in ROOMS.items()
            ],
            "room_status": [
                rs("free"),
                rs("owned", assigned_to=HK_A),
                rs("mirror", assigned_to=HK_A),
                rs("busy", "IN_PROGRESS", HK_A),
                rs("done", "CLEAN", HK_A),
                rs("dnd", dnd_flag=True),
                rs("declined", do_not_service=True),
                rs("later", dnd_retry_at=FUTURE),
                rs("discrepancy"),
                rs("stale_mirror", dnd_retry_at=PAST),
                rs("foreign", tenant=OTHER_HOTEL, assigned_to=HK_A),
            ],
            "room_assignments": [
                {"id": "ra-owned", "tenant_id": HOTEL, "room_id": ROOMS["owned"], "assigned_to": HK_A, "assignment_date": DATE},
                {"id": "ra-busy", "tenant_id": HOTEL, "room_id": ROOMS["busy"], "assigned_to": HK_A, "assignment_date": DATE},
                {"id": "ra-foreign", "tenant_id": OTHER_HOTEL, "room_id": ROOMS["foreign"], "assigned_to": HK_A, "assignment_date": DATE},
            ],
            "room_occupancy_discrepancies": [
                {"id": "d1", "tenant_id": HOTEL, "room_id": ROOMS["discrepancy"], "status": "open"},
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


def _remove(client, room, expected, role="housekeeping_supervisor", hotel=HOTEL):
    return client.post(
        "/v1/housekeeping/assignments/remove",
        json={"date": DATE, "room_id": ROOMS[room], "expected_assigned_to": expected},
        headers=_auth(role, hotel),
    )


def _assign(client, room, to, **extra):
    item = {"room_id": ROOMS[room], "housekeeper_id": to, **extra}
    return client.post("/v1/housekeeping/assignments", json={"date": DATE, "assignments": [item]}, headers=_auth())


def _dated(db, room):
    row = next((r for r in db.rows["room_assignments"] if r["room_id"] == ROOMS[room]), None)
    return row["assigned_to"] if row else None


def _mirror(db, room):
    return next(r for r in db.rows["room_status"] if r["room_id"] == ROOMS[room])["assigned_to"]


class TestGuardedRemoval:
    def test_removes_a_dated_assignment_and_clears_the_mirror(self, client, db):
        response = _remove(client, "owned", HK_A)
        assert response.status_code == 200
        assert response.json()["data"]["source"] == "dated"
        assert _dated(db, "owned") is None
        assert _mirror(db, "owned") is None

    def test_removes_a_mirror_only_assignment(self, client, db):
        response = _remove(client, "mirror", HK_A)
        assert response.status_code == 200
        assert response.json()["data"]["source"] == "mirror"
        assert _mirror(db, "mirror") is None

    def test_keeps_the_room_status_and_clean_type(self, client, db):
        next(r for r in db.rows["room_status"] if r["room_id"] == ROOMS["owned"])["clean_type"] = "DEP"
        _remove(client, "owned", HK_A)
        state = next(r for r in db.rows["room_status"] if r["room_id"] == ROOMS["owned"])
        assert state["status"] == "DIRTY"
        assert state["clean_type"] == "DEP"

    def test_a_stale_expected_owner_removes_nothing(self, client, db):
        response = _remove(client, "owned", HK_B)
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "assignment_changed"
        assert response.json()["detail"]["current_assigned_to"] == HK_A
        assert _dated(db, "owned") == HK_A
        assert _mirror(db, "owned") == HK_A

    def test_a_mirror_only_stale_owner_removes_nothing(self, client, db):
        assert _remove(client, "mirror", HK_C).status_code == 409
        assert _mirror(db, "mirror") == HK_A

    def test_an_unassigned_room_has_nothing_to_remove(self, client, db):
        response = _remove(client, "free", HK_A)
        assert response.status_code == 409
        assert response.json()["detail"]["current_assigned_to"] is None

    def test_a_second_removal_does_not_apply_twice(self, client, db):
        assert _remove(client, "owned", HK_A).status_code == 200
        assert _remove(client, "owned", HK_A).status_code == 409

    @pytest.mark.parametrize("room", ["busy", "done"])
    def test_a_started_or_finished_room_is_never_unassigned(self, client, db, room):
        response = _remove(client, room, HK_A)
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "room_not_assignable"
        assert _mirror(db, room) == HK_A

    def test_the_write_itself_carries_the_expected_owner(self, client, db):
        """Another supervisor reassigns between the endpoint's read and its delete: their assignment survives."""

        def reassign():
            next(r for r in db.rows["room_assignments"] if r["room_id"] == ROOMS["owned"])["assigned_to"] = HK_C

        db.before_delete = reassign
        response = _remove(client, "owned", HK_A)
        assert response.status_code == 409
        assert _dated(db, "owned") == HK_C

    def test_a_newer_dated_row_wins_over_a_stale_mirror(self, client, db):
        next(r for r in db.rows["room_status"] if r["room_id"] == ROOMS["owned"])["assigned_to"] = HK_B
        assert _remove(client, "owned", HK_B).status_code == 409
        assert _dated(db, "owned") == HK_A

    def test_another_hotels_room_is_not_found(self, client, db):
        assert _remove(client, "foreign", HK_A).status_code == 404
        assert _dated(db, "foreign") == HK_A

    def test_another_hotels_token_cannot_remove(self, client, db):
        assert _remove(client, "owned", HK_A, hotel=OTHER_HOTEL).status_code == 404
        assert _dated(db, "owned") == HK_A

    @pytest.mark.parametrize("role", ["housekeeper", "front_desk", "engineer"])
    def test_only_gm_and_supervisors_may_remove(self, client, db, role):
        assert _remove(client, "owned", HK_A, role=role).status_code == 403
        assert _dated(db, "owned") == HK_A

    def test_a_gm_may_remove(self, client, db):
        assert _remove(client, "owned", HK_A, role="gm").status_code == 200

    def test_the_expected_owner_is_required(self, client, db):
        response = client.post(
            "/v1/housekeeping/assignments/remove",
            json={"date": DATE, "room_id": ROOMS["owned"]},
            headers=_auth(),
        )
        assert response.status_code == 422
        assert _dated(db, "owned") == HK_A

    def test_the_legacy_deletes_still_work(self, client, db):
        assert client.delete("/v1/housekeeping/assignments/ra-owned", headers=_auth()).status_code == 200
        assert client.delete(f"/v1/housekeeping/room-assignment/{ROOMS['mirror']}", headers=_auth()).status_code == 200


class TestAcknowledgementIsCheckedByTheServer:
    def test_an_unacknowledged_dnd_room_is_refused(self, client, db):
        response = _assign(client, "dnd", HK_B, expect_unassigned=True, acknowledged_blocks=[])
        assert response.status_code == 409
        detail = response.json()["detail"]
        assert detail["code"] == "acknowledgement_required"
        assert detail["missing"] == ["dnd"]
        assert _dated(db, "dnd") is None

    def test_the_named_condition_must_be_the_one_acknowledged(self, client, db):
        assert _assign(client, "dnd", HK_B, expect_unassigned=True, acknowledged_blocks=["service_declined"]).status_code == 409
        assert _dated(db, "dnd") is None

    def test_an_acknowledged_dnd_room_is_assigned(self, client, db):
        assert _assign(client, "dnd", HK_B, expect_unassigned=True, acknowledged_blocks=["dnd"]).status_code == 200
        assert _dated(db, "dnd") == HK_B

    @pytest.mark.parametrize(
        "room,block",
        [("declined", "service_declined"), ("later", "return_later"), ("discrepancy", "occupancy_discrepancy")],
    )
    def test_each_soft_block_is_recomputed_from_the_database(self, client, db, room, block):
        refused = _assign(client, room, HK_B, expect_unassigned=True, acknowledged_blocks=[])
        assert refused.status_code == 409
        assert refused.json()["detail"]["missing"] == [block]
        assert _assign(client, room, HK_B, expect_unassigned=True, acknowledged_blocks=[block]).status_code == 200

    def test_a_return_time_in_the_past_blocks_nothing(self, client, db):
        assert _assign(client, "stale_mirror", HK_B, expect_unassigned=True, acknowledged_blocks=[]).status_code == 200

    def test_a_clean_room_needs_no_acknowledgement(self, client, db):
        assert _assign(client, "free", HK_B, expect_unassigned=True, acknowledged_blocks=[]).status_code == 200

    def test_acknowledging_does_not_unlock_a_hard_block(self, client, db):
        response = _assign(client, "busy", HK_B, expected_assigned_to=HK_A, acknowledged_blocks=["dnd", "service_declined"])
        assert response.status_code == 409
        assert _dated(db, "busy") == HK_A

    def test_omitting_the_list_keeps_the_room_boards_behaviour(self, client, db):
        assert _assign(client, "dnd", HK_B, expect_unassigned=True).status_code == 200

    def test_an_unknown_block_name_is_rejected(self, client, db):
        assert _assign(client, "dnd", HK_B, expect_unassigned=True, acknowledged_blocks=["override_everything"]).status_code == 422
        assert _dated(db, "dnd") is None

    def test_a_stale_owner_is_still_refused_when_acknowledged(self, client, db):
        assert _assign(client, "owned", HK_B, expected_assigned_to=HK_C, acknowledged_blocks=[]).status_code == 409
        assert _dated(db, "owned") == HK_A
