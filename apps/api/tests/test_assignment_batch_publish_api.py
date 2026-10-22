"""Assignments V2 phase 5: POST /housekeeping/assignments/batch-publish and its read-only result check.

The all-or-nothing guarantee lives in the database function and is proven against a real database in
tests/integration/test_assignment_batch_publish*.py. These tests cover what the HTTP layer owns: the request
contract, who may call it, how a refusal is reported (`applied: false`), when notifications go out, and that an
unclear outcome is never reported as a definite one.
"""

import uuid
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient
from jose import jwt
from postgrest.exceptions import APIError

from core.config import settings
from main import app
from routers import housekeeping as housekeeping_router
from tests.smoke.fake_supabase import FakeDB

HOTEL = "00000000-0000-4000-8000-00000000000a"
OTHER_HOTEL = "00000000-0000-4000-8000-00000000000b"
SUPERVISOR = "00000000-0000-4000-8000-0000000000a1"
HK_A = str(uuid.uuid4())
HK_B = str(uuid.uuid4())
ROOM_1, ROOM_2, ROOM_3 = (str(uuid.uuid4()) for _ in range(3))
DATE = "2026-10-22"


def _auth(role="housekeeping_supervisor", hotel=HOTEL, user=SUPERVISOR):
    token = jwt.encode({"sub": user, "role": role, "hotel_id": hotel, "aud": "authenticated"}, settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def _assign(room, to):
    return {"room_id": room, "kind": "assign", "housekeeper_id": to, "expect_unassigned": True}


def _body(changes=None, operation_id=None):
    return {"operation_id": operation_id or str(uuid.uuid4()), "date": DATE, "changes": changes if changes is not None else [_assign(ROOM_1, HK_A)]}


def _committed(**extra):
    return {
        "operation_id": "op",
        "status": "committed",
        "assignment_date": DATE,
        "counts": {"total": 2, "assign": 2, "reassign": 0, "remove": 0},
        "rooms": [
            {"room_id": ROOM_1, "room_number": "101", "kind": "assign", "previous_assigned_to": None, "assigned_to": HK_A},
            {"room_id": ROOM_2, "room_number": "102", "kind": "assign", "previous_assigned_to": None, "assigned_to": HK_A},
        ],
        "affected_room_ids": [ROOM_1, ROOM_2],
        "affected_housekeeper_ids": [HK_A],
        "replayed": False,
        **extra,
    }


class RpcDB(FakeDB):
    """A FakeDB that also answers supabase.rpc(): returns `reply`, or raises it when it is an exception."""

    def __init__(self, *args, reply=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.reply = reply
        self.rpc_calls = []

    def rpc(self, name, params):
        self.rpc_calls.append((name, params))
        reply = self.reply

        class _Call:
            def execute(_self):
                if isinstance(reply, Exception):
                    raise reply
                return SimpleNamespace(data=reply)

        return _Call()


def _refusal(code, message, details=None):
    return APIError({"code": code, "message": message, "details": details, "hint": None})


@pytest.fixture
def db(monkeypatch):
    fake = RpcDB(reply=_committed())
    pushes = []
    monkeypatch.setattr(housekeeping_router, "supabase", fake)

    async def _noop():
        return None

    def _record(tenant_id, rooms):
        pushes.append((tenant_id, rooms))
        return _noop()

    monkeypatch.setattr(housekeeping_router, "_push_batch_assignments", _record)
    fake.pushes = pushes
    return fake


@pytest.fixture
def client(db):
    return TestClient(app)


def _publish(client, body=None, **auth):
    return client.post("/v1/housekeeping/assignments/batch-publish", json=body or _body(), headers=_auth(**auth))


class TestRequestContract:
    def test_a_valid_request_reaches_the_database_with_the_session_identity(self, client, db):
        body = _body([_assign(ROOM_1, HK_A), {"room_id": ROOM_2, "kind": "reassign", "housekeeper_id": HK_B, "expected_assigned_to": HK_A}, {"room_id": ROOM_3, "kind": "remove", "expected_assigned_to": HK_B}])
        response = _publish(client, body)
        assert response.status_code == 200
        (name, params), = db.rpc_calls
        assert name == "publish_assignment_batch"
        # The tenant and the acting user come from the verified token, never from the body.
        assert (params["p_tenant_id"], params["p_actor_id"]) == (HOTEL, SUPERVISOR)
        assert params["p_operation_id"] == body["operation_id"] and params["p_date"] == DATE
        assert [(c["kind"], c["housekeeper_id"], c["expected_assigned_to"]) for c in params["p_changes"]] == [
            ("assign", HK_A, None), ("reassign", HK_B, HK_A), ("remove", None, HK_B)]

    def test_each_changes_ai_provenance_is_forwarded_untouched_and_defaults_to_manual(self, client, db):
        body = _body([{**_assign(ROOM_1, HK_A), "is_ai_suggested": True}, _assign(ROOM_2, HK_B), {"room_id": ROOM_3, "kind": "reassign", "housekeeper_id": HK_A, "expected_assigned_to": HK_B, "is_ai_suggested": False}])
        assert _publish(client, body).status_code == 200
        (_, params), = db.rpc_calls
        assert [(c["room_id"], c["is_ai_suggested"]) for c in params["p_changes"]] == [(ROOM_1, True), (ROOM_2, False), (ROOM_3, False)]

    def test_a_removal_can_never_carry_ai_provenance(self, client, db):
        body = _body([{"room_id": ROOM_1, "kind": "remove", "expected_assigned_to": HK_A, "is_ai_suggested": True}])
        assert _publish(client, body).status_code == 422
        assert db.rpc_calls == []

    def test_provenance_must_be_a_boolean(self, client, db):
        assert _publish(client, _body([{**_assign(ROOM_1, HK_A), "is_ai_suggested": "yes please"}])).status_code == 422
        assert db.rpc_calls == []

    @pytest.mark.parametrize("field", ["tenant_id", "assigned_by", "hotel_id", "acknowledged_blocks", "atomic"])
    def test_a_client_cannot_name_the_tenant_assigner_or_extra_fields(self, client, db, field):
        body = _body()
        body[field] = HOTEL
        assert _publish(client, body).status_code == 422
        body = _body([{**_assign(ROOM_1, HK_A), field: "x"}])
        assert _publish(client, body).status_code == 422
        assert db.rpc_calls == []

    @pytest.mark.parametrize(
        "change",
        [
            {"room_id": ROOM_1, "kind": "assign", "housekeeper_id": HK_A},  # no expect_unassigned
            {"room_id": ROOM_1, "kind": "assign", "housekeeper_id": HK_A, "expect_unassigned": True, "expected_assigned_to": HK_B},
            {"room_id": ROOM_1, "kind": "assign", "expect_unassigned": True},
            {"room_id": ROOM_1, "kind": "reassign", "housekeeper_id": HK_A},
            {"room_id": ROOM_1, "kind": "reassign", "housekeeper_id": HK_A, "expected_assigned_to": HK_A},
            {"room_id": ROOM_1, "kind": "reassign", "housekeeper_id": HK_A, "expected_assigned_to": HK_B, "expect_unassigned": True},
            {"room_id": ROOM_1, "kind": "remove"},
            {"room_id": ROOM_1, "kind": "remove", "housekeeper_id": HK_A, "expected_assigned_to": HK_B},
            {"room_id": ROOM_1, "kind": "remove", "expected_assigned_to": HK_A, "expect_unassigned": True},
            {"room_id": ROOM_1, "kind": "swap", "housekeeper_id": HK_A},
            {"room_id": "not-a-uuid", "kind": "assign", "housekeeper_id": HK_A, "expect_unassigned": True},
        ],
    )
    def test_contradictory_changes_are_rejected_before_the_database(self, client, db, change):
        assert _publish(client, _body([change])).status_code == 422
        assert db.rpc_calls == []

    def test_a_room_twice_empty_and_oversized_batches_are_rejected(self, client, db):
        assert _publish(client, _body([_assign(ROOM_1, HK_A), _assign(ROOM_1, HK_B)])).status_code == 422
        assert _publish(client, _body([])).status_code == 422
        assert _publish(client, _body([_assign(str(uuid.uuid4()), HK_A) for _ in range(151)])).status_code == 422
        assert _publish(client, _body([_assign(str(uuid.uuid4()), HK_A) for _ in range(150)])).status_code == 200
        assert len(db.rpc_calls) == 1

    @pytest.mark.parametrize("operation_id", [None, "not-a-uuid", str(uuid.uuid1())])
    def test_an_operation_id_is_required_and_must_be_a_uuid4(self, client, db, operation_id):
        body = _body()
        body.pop("operation_id")
        if operation_id:
            body["operation_id"] = operation_id
        assert _publish(client, body).status_code == 422
        assert db.rpc_calls == []

    @pytest.mark.parametrize("role", ["housekeeper", "front_desk", "engineer", "chief_engineer"])
    def test_only_a_gm_or_housekeeping_supervisor_may_publish(self, client, db, role):
        assert _publish(client, role=role).status_code == 403
        assert db.rpc_calls == []

    @pytest.mark.parametrize("role", ["gm", "housekeeping_supervisor"])
    def test_a_gm_and_a_supervisor_may_publish(self, client, role):
        assert _publish(client, role=role).status_code == 200

    def test_it_requires_authentication(self, client, db):
        assert client.post("/v1/housekeeping/assignments/batch-publish", json=_body()).status_code in (401, 403)
        assert db.rpc_calls == []


class TestOutcomes:
    def test_a_commit_returns_the_database_result_unchanged(self, client, db):
        response = _publish(client)
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["status"] == "committed" and data["counts"]["total"] == 2 and data["replayed"] is False
        assert data["affected_room_ids"] == [ROOM_1, ROOM_2]

    @pytest.mark.parametrize(
        "code,message,status,details",
        [
            ("P0409", "assignment_batch_conflict", 409, '{"conflicts":[{"room_id":"r","code":"assignment_changed","current_assigned_to":"u"}]}'),
            ("P0409", "operation_id_reused", 409, '{"reason":"different_request"}'),
            ("P0409", "date_mismatch", 409, '{"reason":"not_hotel_today","expected_date":"2026-10-23"}'),
            ("P0422", "invalid_request", 422, '{"reason":"duplicate_room","rooms":["r"]}'),
            ("P0403", "not_authorized", 403, '{"reason":"role"}'),
        ],
    )
    def test_a_database_refusal_is_reported_as_not_applied_with_its_details(self, client, db, code, message, status, details):
        db.reply = _refusal(code, message, details)
        response = _publish(client)
        assert response.status_code == status
        detail = response.json()["detail"]
        assert detail["applied"] is False and detail["code"] == message and detail["message"]
        for key, value in __import__("json").loads(details).items():
            assert detail[key] == value
        assert db.pushes == []  # nothing was committed, so nobody is told

    @pytest.mark.parametrize("code", ["23514", "40P01", "40001", "XX000", None])
    def test_any_other_database_error_is_a_rolled_back_failure_not_a_success(self, client, db, code):
        db.reply = _refusal(code, "boom")
        response = _publish(client)
        assert response.status_code == 500
        assert response.json()["detail"] == {"code": "publish_failed", "applied": False, "message": "The assignments could not be published. Nothing was changed."}
        assert db.pushes == []

    @pytest.mark.parametrize("reply", [None, [], {"status": "pending"}, {"status": "committed-ish"}, "ok"])
    def test_a_reply_the_handler_cannot_vouch_for_is_never_called_a_success(self, client, db, reply):
        db.reply = reply
        response = _publish(client)
        assert response.status_code == 500
        assert response.json()["detail"]["code"] == "publish_unverified"
        assert "applied" not in response.json()["detail"]  # unverified is not "not applied" either
        assert db.pushes == []

    def test_a_lost_connection_is_an_unknown_outcome_never_reported_as_not_applied(self, db, monkeypatch):
        db.reply = httpx.ReadTimeout("the response never arrived")
        response = TestClient(app, raise_server_exceptions=False).post("/v1/housekeeping/assignments/batch-publish", json=_body(), headers=_auth())
        assert response.status_code == 500
        assert "applied" not in response.text  # the client must read the result back, not assume
        assert db.pushes == []


class TestNotifications:
    def test_a_new_commit_notifies_after_the_commit(self, client, db):
        _publish(client)
        (tenant, rooms), = db.pushes
        assert tenant == HOTEL and [r["room_id"] for r in rooms] == [ROOM_1, ROOM_2]

    def test_a_replay_never_notifies_again(self, client, db):
        db.reply = _committed(replayed=True)
        assert _publish(client).status_code == 200
        assert db.pushes == []


class TestPushContent:
    """The push composer itself (called after the commit): one push per person who gained rooms."""

    @pytest.fixture
    def sent(self, monkeypatch):
        calls = []

        async def send_push(**kwargs):
            calls.append(kwargs)

        async def single(tenant_id, housekeeper_id, room_number, room_id=""):
            calls.append({"single": (housekeeper_id, room_number, room_id)})

        monkeypatch.setattr(housekeeping_router, "send_push", send_push)
        monkeypatch.setattr(housekeeping_router, "_send_assignment_push", single)
        return calls

    def _run(self, rooms):
        import asyncio

        asyncio.run(housekeeping_router._push_batch_assignments(HOTEL, rooms))

    def test_one_room_keeps_the_existing_single_room_push(self, sent):
        self._run([{"room_id": ROOM_1, "room_number": "101", "kind": "assign", "assigned_to": HK_A}])
        assert sent == [{"single": (HK_A, "101", ROOM_1)}]

    def test_several_rooms_for_one_person_are_one_push_with_the_count(self, sent):
        self._run([{"room_id": r, "room_number": n, "kind": "assign", "assigned_to": HK_A} for r, n in ((ROOM_1, "101"), (ROOM_2, "102"), (ROOM_3, "103"))]
                  + [{"room_id": str(uuid.uuid4()), "room_number": "104", "kind": "reassign", "assigned_to": HK_B}])
        counts = {c["recipient_ids"][0]: c["body"] for c in sent if "recipient_ids" in c}
        assert counts == {HK_A: "3 rooms have been assigned to you"}
        assert {"single": (HK_B, "104", sent[-1]["single"][2])} in sent
        assert all(c.get("event_type", "room_assignment") == "room_assignment" for c in sent)

    def test_a_removal_notifies_nobody(self, sent):
        self._run([{"room_id": ROOM_1, "room_number": "101", "kind": "remove", "assigned_to": None, "previous_assigned_to": HK_A}])
        assert sent == []

    def test_a_push_failure_is_swallowed_and_never_raises_into_a_committed_publication(self, monkeypatch):
        async def explode(**_kwargs):
            raise RuntimeError("expo is down")

        monkeypatch.setattr(housekeeping_router, "send_push", explode)
        self._run([{"room_id": r, "room_number": n, "kind": "assign", "assigned_to": HK_A} for r, n in ((ROOM_1, "101"), (ROOM_2, "102"))])


class TestResultCheck:
    def _row(self, requested_by=SUPERVISOR, tenant=HOTEL, op="11111111-1111-4111-8111-111111111111"):
        return {"tenant_id": tenant, "operation_id": op, "requested_by": requested_by, "assignment_date": DATE, "result": _committed(operation_id=op)}

    def _check(self, client, op="11111111-1111-4111-8111-111111111111", **auth):
        return client.get(f"/v1/housekeeping/assignments/batch-publish/{op}", headers=_auth(**auth))

    def test_a_committed_operation_is_read_back_without_writing(self, client, db):
        db.rows["assignment_batch_operations"] = [self._row()]
        response = self._check(client)
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["status"] == "committed" and data["result"]["counts"]["total"] == 2 and data["result"]["replayed"] is True
        assert db.rpc_calls == [] and db.inserts == [] and db.updates == [] and db.deletes == []

    def test_an_operation_that_did_not_commit_reads_as_not_found(self, client, db):
        db.rows["assignment_batch_operations"] = []
        assert self._check(client).json() == {"data": {"status": "not_found"}}

    def test_another_persons_or_another_hotels_operation_reads_as_not_found(self, client, db):
        db.rows["assignment_batch_operations"] = [self._row(requested_by=str(uuid.uuid4())), self._row(tenant=OTHER_HOTEL, op="22222222-2222-4222-8222-222222222222")]
        assert self._check(client).json()["data"] == {"status": "not_found"}
        assert self._check(client, op="22222222-2222-4222-8222-222222222222").json()["data"] == {"status": "not_found"}

    def test_a_malformed_id_is_a_422_and_a_housekeeper_is_a_403(self, client, db):
        assert client.get("/v1/housekeeping/assignments/batch-publish/not-a-uuid", headers=_auth()).status_code == 422
        assert self._check(client, role="housekeeper").status_code == 403
