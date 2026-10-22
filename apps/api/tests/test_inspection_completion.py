"""POST /housekeeping/inspections/complete and its correction / read-back companions.

FakeDB does not run database triggers or enforce the unique indexes unless told to, so `TriggerDB` models
the two database guarantees this endpoint relies on (migration 219): the room-state guard that serialises
concurrent inspections, and the room_status transition done by the existing AFTER INSERT trigger. The
unique index that dedupes correction tasks per inspection is declared the same way production declares it.
"""

import json
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from main import app
from routers import housekeeping as hk_router
from services import reclean_corrections as corrections
from services.inspection_rules import template_fingerprint
from tests.smoke.fake_supabase import FakeDB, FakeQuery

HOTEL = "hotel-a"
OTHER_HOTEL = "hotel-b"
USER = "user-1"


class PgError(Exception):
    def __init__(self, message, code):
        super().__init__(message)
        self.code = code


class _TriggerQuery(FakeQuery):
    def execute(self):
        if self.action == "insert" and self.table_name == "inspections":
            payload = self.payload
            if self.db.before_inspection_insert:
                self.db.before_inspection_insert(self.db)
            room_status = next(
                (r for r in self.db.rows["room_status"] if r["room_id"] == payload["room_id"] and r["tenant_id"] == payload["tenant_id"]),
                None,
            )
            if not room_status or room_status["status"] != "CLEAN":
                raise PgError("room_not_awaiting_inspection", "P0001")
            # the column default the real table applies, strictly increasing so "later inspection" is well defined
            self.db.clock += 1
            self.payload = {"id": str(uuid4()), "completed_at": f"2026-10-20T10:{self.db.clock:02d}:00+00:00", **payload}
            result = super().execute()
            # handle_inspection_complete() as of migration 219: only a pass releases the room
            room_status["status"] = "INSPECTED" if payload["overall_result"] == "passed" else "DIRTY"
            return result
        if self.action == "insert" and self.table_name == "tasks":
            self.payload = {"status": "open", **self.payload}  # the column default the real table applies
        if self.action == "insert" and self.table_name in ("tasks", "operational_audit_events"):
            self.db.clock += 1  # created_at DEFAULT now(), strictly increasing so event order is well defined
            self.payload = {"created_at": f"2026-10-20T10:{self.db.clock:02d}:30+00:00", **self.payload}
        if self.table_name in self.db.fail_inserts and self.action == "insert":
            remaining = self.db.fail_inserts[self.table_name]
            if remaining > 0:
                self.db.fail_inserts[self.table_name] = remaining - 1
                raise RuntimeError(f"{self.table_name} insert failed")
        return super().execute()


class TriggerDB(FakeDB):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.before_inspection_insert = None
        self.clock = 0
        self.fail_inserts: dict[str, int] = {}

    def table(self, name):
        return _TriggerQuery(self, name)


def _auth(role="housekeeping_supervisor", hotel_id=HOTEL, user=USER):
    payload = {"sub": user, "role": role, "hotel_id": hotel_id, "aud": "authenticated"}
    return {"Authorization": f"Bearer {jwt.encode(payload, settings.supabase_jwt_secret, algorithm='HS256')}"}


class Env:
    """One hotel with a clean room, a default 3-item checklist (one needs a photo on fail) and a housekeeper."""

    def __init__(self):
        self.room = str(uuid4())
        self.room_type = str(uuid4())
        self.template = str(uuid4())
        self.items = {name: str(uuid4()) for name in ("bed", "mirror", "floor")}
        self.db = TriggerDB(
            rows={
                "tenants": [{"id": HOTEL, "timezone": "America/Chicago"}],
                "rooms": [
                    {"id": self.room, "tenant_id": HOTEL, "room_number": "204", "floor": 2, "room_type_id": self.room_type},
                    {"id": "foreign-room", "tenant_id": OTHER_HOTEL, "room_number": "999", "floor": 9, "room_type_id": "x"},
                ],
                "room_status": [
                    {"room_id": self.room, "tenant_id": HOTEL, "status": "CLEAN", "clean_type": "STAY", "reclean_requested_at": None, "updated_at": "2026-10-20T09:00:00+00:00"},
                ],
                "room_status_history": [],
                "inspection_templates": [
                    {"id": self.template, "tenant_id": HOTEL, "name": "Standard", "room_type_id": None, "is_default": True, "is_active": True},
                ],
                "inspection_template_items": [
                    self._item("bed", "Bed", "Bed made", 1, photo=False),
                    self._item("mirror", "Bath", "Mirror clean", 2, photo=True),
                    self._item("floor", "Floor", "Floor vacuumed", 3, photo=False),
                ],
                "inspections": [],
                "inspection_results": [],
                "tasks": [],
                "room_assignments": [
                    {"tenant_id": HOTEL, "room_id": self.room, "assignment_date": self.today(), "assigned_to": "hk-1"},
                ],
                "room_clean_sessions": [],
                "user_profiles": [
                    {"id": USER, "tenant_id": HOTEL, "preferred_name": "Sam Supervisor"},
                    {"id": "hk-1", "tenant_id": HOTEL, "preferred_name": "Hana Housekeeper"},
                ],
            },
            unique_indexes=[
                ("inspections", "inspections_pkey", ["id"], {}),
                ("tasks", "uq_tasks_source_inspection", ["tenant_id", "source_inspection_id"], {}),
            ],
        )

    @staticmethod
    def today():
        from datetime import datetime
        from dateutil import tz

        return datetime.now(tz.gettz("America/Chicago")).date().isoformat()

    def _item(self, key, section, description, order, photo):
        return {
            "id": self.items[key], "template_id": self.template, "tenant_id": HOTEL, "section": section,
            "description": description, "is_required": True, "requires_photo_on_fail": photo, "allows_na": True, "sort_order": order,
        }

    def fingerprint(self):
        template = next(t for t in self.db.rows["inspection_templates"] if t["id"] == self.template)
        items = [i for i in self.db.rows["inspection_template_items"] if i["template_id"] == self.template]
        return template_fingerprint(template, items)


@pytest.fixture
def env(monkeypatch):
    e = Env()
    monkeypatch.setattr(hk_router, "supabase", e.db)
    return e


@pytest.fixture
def client():
    return TestClient(app)


def _payload(env, *, result="passed", fails=(), severity=None, submission=None, **extra):
    items = []
    for key, item_id in env.items.items():
        failed = key in fails
        row = {"template_item_id": item_id, "result": "fail" if failed else "pass"}
        if failed and severity:
            row["severity"] = severity
        items.append(row)
    payload = {
        "room_id": env.room,
        "template_id": env.template,
        "overall_result": result,
        "notes": "checked",
        "items": items,
        "client_submission_id": submission or str(uuid4()),
        **extra,
    }
    return payload


def _post(client, env, payload, photos=None, headers=None):
    files = [("photos", (f"{key}.jpg", b"jpegbytes", "image/jpeg")) for key in (photos or [])]
    data = {"inspection": json.dumps(payload), "photo_item_ids": [env.items[k] for k in (photos or [])]}
    return client.post("/v1/housekeeping/inspections/complete", data=data, files=files or None, headers=headers or _auth())


def _rows(env, table, **match):
    return [r for r in env.db.rows[table] if all(r.get(k) == v for k, v in match.items())]


# --- the happy paths ---------------------------------------------------------

def test_pass_persists_the_submission_id_results_history_and_clears_the_correction_flag(client, env):
    env.db.rows["room_status"][0]["reclean_requested_at"] = "2026-10-19T10:00:00+00:00"
    payload = _payload(env)
    res = _post(client, env, payload)
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["id"] == payload["client_submission_id"] and data["replayed"] is False
    assert data["overall_result"] == "passed" and data["followup_complete"] is True and data["correction"] is None
    row = _rows(env, "inspections")[0]
    assert row["id"] == payload["client_submission_id"] and row["inspected_by"] == USER
    assert row["template_fingerprint"] == env.fingerprint()
    assert len(_rows(env, "inspection_results")) == 3
    assert env.db.rows["room_status"][0]["status"] == "INSPECTED"
    assert env.db.rows["room_status"][0]["reclean_requested_at"] is None
    assert _rows(env, "room_status_history", to_status="INSPECTED")
    assert env.db.rows["tasks"] == []


def test_failure_keeps_every_failed_item_and_creates_exactly_one_correction_task_for_the_assigned_housekeeper(client, env):
    payload = _payload(env, result="failed", fails=("mirror",), severity="major")
    res = _post(client, env, payload, photos=["mirror"])
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["overall_result"] == "failed" and data["correction_kind"] == "reclean"
    assert data["correction"]["status"] == "created" and data["followup_complete"] is True
    failed = _rows(env, "inspection_results", result="fail")
    assert [r["template_item_id"] for r in failed] == [env.items["mirror"]]
    assert failed[0]["severity"] == "major"
    # Evidence goes to the PRIVATE bucket and is recorded as a path under this hotel's folder - never as a public URL.
    assert failed[0].get("photo_url") is None
    assert failed[0]["photo_path"] == f"{HOTEL}/inspections/{payload['client_submission_id']}/{env.items['mirror']}.jpg"
    assert [(bucket, path) for bucket, path, _ in env.db.storage_uploads] == [("inspection-evidence", failed[0]["photo_path"])]
    task = _rows(env, "tasks")[0]
    assert task["source_inspection_id"] == payload["client_submission_id"]
    assert task["assigned_to"] == "hk-1" and task["title"] == "Re-clean Room 204"
    assert "Mirror clean" in task["description"]
    room = env.db.rows["room_status"][0]
    assert room["status"] == "DIRTY" and room["reclean_requested_at"]  # blocked from guest-ready release


def test_all_minor_failures_are_a_touch_up_but_still_block_the_room(client, env):
    res = _post(client, env, _payload(env, result="failed", fails=("bed",), severity="minor"))
    assert res.status_code == 200, res.text
    assert res.json()["data"]["correction_kind"] == "touch_up"
    assert _rows(env, "tasks")[0]["title"] == "Touch-up Room 204"
    assert env.db.rows["room_status"][0]["status"] == "DIRTY"


def test_correction_owner_falls_back_to_whoever_last_cleaned_the_room(client, env):
    env.db.rows["room_assignments"].clear()
    env.db.rows["room_clean_sessions"].append(
        {"tenant_id": HOTEL, "room_id": env.room, "status": "completed", "housekeeper_id": "hk-9", "ended_at": "2026-10-20T09:00:00+00:00"}
    )
    _post(client, env, _payload(env, result="failed", fails=("bed",)))
    assert _rows(env, "tasks")[0]["assigned_to"] == "hk-9"


def test_correction_with_nobody_responsible_is_unassigned_not_invented(client, env):
    env.db.rows["room_assignments"].clear()
    _post(client, env, _payload(env, result="failed", fails=("bed",)))
    assert _rows(env, "tasks")[0]["assigned_to"] is None


# --- validation --------------------------------------------------------------

@pytest.mark.parametrize(
    "mutate,code",
    [
        (lambda p: p["items"].pop(), "required_items_unanswered"),
        (lambda p: p.update(overall_result="failed"), "result_mismatch"),
        (lambda p: p.update(overall_result="conditional"), "result_mismatch"),
        (lambda p: p["items"].append(dict(p["items"][0])), "duplicate_item_answer"),
        (lambda p: p["items"][0].update(template_item_id=None), "item_missing_id"),
        (lambda p: p["items"][0].update(template_item_id=str(uuid4())), "item_outside_checklist"),
        (lambda p: p["items"][0].update(severity="minor"), "severity_on_non_failed_item"),
    ],
)
def test_rule_violations_are_422_with_a_machine_code_and_a_plain_string_detail(client, env, mutate, code):
    payload = _payload(env)
    mutate(payload)
    res = _post(client, env, payload)
    assert res.status_code == 422
    body = res.json()
    assert body["code"] == code and isinstance(body["detail"], str)  # detail stays a string: the web drawer renders it
    assert env.db.rows["inspections"] == [] and env.db.rows["inspection_results"] == []


def test_a_required_failed_item_photo_is_enforced_before_anything_is_written(client, env):
    res = _post(client, env, _payload(env, result="failed", fails=("mirror",)))
    assert res.status_code == 422 and res.json()["code"] == "required_photos_missing"
    assert env.db.rows["inspections"] == [] and env.db.storage_uploads == []


def test_photos_may_only_be_attached_to_failed_items(client, env):
    res = _post(client, env, _payload(env), photos=["mirror"])
    assert res.status_code == 422 and res.json()["code"] == "photo_on_non_failed_item"


def test_non_image_and_oversize_photos_are_rejected_without_uploading(client, env):
    payload = _payload(env, result="failed", fails=("mirror",))
    data = {"inspection": json.dumps(payload), "photo_item_ids": [env.items["mirror"]]}
    bad = client.post("/v1/housekeeping/inspections/complete", data=data, files=[("photos", ("x.pdf", b"x", "application/pdf"))], headers=_auth())
    assert bad.status_code == 400 and env.db.storage_uploads == [] and env.db.rows["inspections"] == []


def test_na_is_refused_for_an_item_that_forbids_it(client, env):
    for item in env.db.rows["inspection_template_items"]:
        if item["id"] == env.items["bed"]:
            item["allows_na"] = False
    payload = _payload(env)
    payload["items"][0]["result"] = "na"
    res = _post(client, env, payload)
    assert res.status_code == 422 and res.json()["code"] == "na_not_allowed"


def test_empty_or_inactive_checklists_cannot_approve_a_room(client, env):
    env.db.rows["inspection_templates"][0]["is_active"] = False
    res = _post(client, env, _payload(env))
    assert res.status_code == 422 and res.json()["code"] == "no_checklist"
    env.db.rows["inspection_templates"][0]["is_active"] = True
    env.db.rows["inspection_template_items"].clear()
    res = _post(client, env, {**_payload(env), "items": []})
    assert res.status_code == 422 and res.json()["code"] == "no_checklist"


def test_a_template_for_another_room_type_is_refused(client, env):
    env.db.rows["inspection_templates"][0].update(room_type_id=str(uuid4()), is_default=False)
    res = _post(client, env, _payload(env))
    assert res.status_code == 422 and res.json()["code"] == "template_not_applicable"


def test_the_property_default_applies_even_when_tied_to_a_different_type(client, env):
    env.db.rows["inspection_templates"][0].update(room_type_id=str(uuid4()), is_default=True)
    assert _post(client, env, _payload(env)).status_code == 200


# --- template changed during an inspection -----------------------------------

def test_matching_fingerprint_is_accepted_and_a_stale_one_is_a_409(client, env, monkeypatch):
    ok = _post(client, env, _payload(env, template_fingerprint=env.fingerprint()))
    assert ok.status_code == 200
    env2 = Env()
    monkeypatch.setattr(hk_router, "supabase", env2.db)
    stale = env2.fingerprint()
    next(i for i in env2.db.rows["inspection_template_items"] if i["id"] == env2.items["bed"])["description"] = "Bed made, hospital corners"
    res = _post(client, env2, _payload(env2, template_fingerprint=stale))
    assert res.status_code == 409 and res.json()["code"] == "template_changed"
    assert env2.db.rows["inspections"] == []


def test_a_template_edit_that_reuses_the_template_id_is_still_detected(client, env):
    stale = env.fingerprint()
    # Settings > Inspections replaces the item rows on every edit: same template id, new item ids.
    env.db.rows["inspection_template_items"][:] = [
        {**i, "id": str(uuid4())} for i in env.db.rows["inspection_template_items"]
    ]
    payload = _payload(env, template_fingerprint=stale)
    res = _post(client, env, payload)
    # The item ids in the payload are gone too, but the fingerprint is checked first and names the real cause.
    assert res.status_code == 409 and res.json()["code"] == "template_changed"


# --- stale / concurrent / cross-tenant ----------------------------------------

def test_a_room_that_is_no_longer_clean_is_refused_with_the_state_it_is_in(client, env):
    env.db.rows["room_status"][0]["status"] = "INSPECTED"
    res = _post(client, env, _payload(env))
    assert res.status_code == 409
    assert res.json()["code"] == "room_not_awaiting_inspection" and res.json()["room_status"] == "INSPECTED"
    assert env.db.rows["inspections"] == []


def test_a_second_supervisor_who_passed_the_check_is_stopped_by_the_database_guard(client, env):
    def other_supervisor_wins(db):
        db.rows["room_status"][0]["status"] = "INSPECTED"

    env.db.before_inspection_insert = other_supervisor_wins
    payload = _payload(env, result="failed", fails=("mirror",))
    res = _post(client, env, payload, photos=["mirror"])
    assert res.status_code == 409 and res.json()["code"] == "room_not_awaiting_inspection"
    assert env.db.rows["inspections"] == [] and env.db.rows["tasks"] == []


def test_a_room_cleaned_again_since_the_queue_row_was_read_is_stale(client, env):
    env.db.rows["room_status_history"].append(
        {"id": str(uuid4()), "tenant_id": HOTEL, "room_id": env.room, "to_status": "CLEAN", "created_at": "2099-01-01T00:00:00+00:00"}
    )
    res = _post(client, env, _payload(env, expected_clean_cycle_id=str(uuid4())))
    assert res.status_code == 409 and res.json()["code"] == "room_changed_since_review"


def test_an_unrecorded_clean_cycle_cannot_cause_a_false_rejection(client, env):
    assert _post(client, env, _payload(env, expected_clean_cycle_id=str(uuid4()))).status_code == 200


def test_hotel_isolation_for_rooms_and_for_the_signed_in_hotel(client, env):
    foreign = _post(client, env, {**_payload(env), "room_id": str(uuid4())})
    assert foreign.status_code == 404
    switched = _post(client, env, _payload(env, expected_hotel_id=str(uuid4())))
    assert switched.status_code == 409 and switched.json()["code"] == "hotel_mismatch"
    assert env.db.rows["inspections"] == []


def test_a_submission_id_owned_by_another_hotel_or_person_is_spent_and_leaks_nothing(client, env):
    spent = str(uuid4())
    env.db.rows["inspections"].append({"id": spent, "tenant_id": OTHER_HOTEL, "room_id": "foreign-room", "inspected_by": "someone", "overall_result": "passed"})
    res = _post(client, env, _payload(env, submission=spent))
    assert res.status_code == 409 and res.json()["code"] == "submission_conflict"
    assert "foreign-room" not in res.text
    mine = str(uuid4())
    env.db.rows["inspections"].append({"id": mine, "tenant_id": HOTEL, "room_id": env.room, "inspected_by": "another-supervisor", "overall_result": "passed"})
    assert _post(client, env, _payload(env, submission=mine)).status_code == 409


# --- retries: the failure cases that matter -----------------------------------

def test_double_submission_returns_the_stored_inspection_and_writes_nothing_twice(client, env):
    payload = _payload(env, result="failed", fails=("bed",), severity="minor")
    first = _post(client, env, payload)
    second = _post(client, env, payload)
    assert first.status_code == second.status_code == 200
    assert second.json()["data"]["replayed"] is True and second.json()["data"]["id"] == first.json()["data"]["id"]
    assert len(env.db.rows["inspections"]) == 1 and len(env.db.rows["inspection_results"]) == 3 and len(env.db.rows["tasks"]) == 1


def test_a_lost_response_after_commit_is_recovered_by_resubmitting_even_though_the_room_moved_on(client, env):
    payload = _payload(env)
    assert _post(client, env, payload).status_code == 200
    assert env.db.rows["room_status"][0]["status"] == "INSPECTED"  # a plain 409 would be wrong here: it DID commit
    again = _post(client, env, payload)
    assert again.status_code == 200 and again.json()["data"]["replayed"] is True


def test_read_back_answers_did_my_submission_land(client, env):
    payload = _payload(env, result="failed", fails=("bed",))
    assert _post(client, env, payload).status_code == 200
    found = client.get(f"/v1/housekeeping/inspections/submissions/{payload['client_submission_id']}", headers=_auth())
    assert found.status_code == 200 and found.json()["data"]["overall_result"] == "failed"
    assert found.json()["data"]["correction"]["status"] == "assigned"
    assert client.get(f"/v1/housekeeping/inspections/submissions/{uuid4()}", headers=_auth()).status_code == 404
    assert client.get("/v1/housekeeping/inspections/submissions/not-a-uuid", headers=_auth()).status_code == 404
    other_person = client.get(f"/v1/housekeeping/inspections/submissions/{payload['client_submission_id']}", headers=_auth(user="user-2"))
    assert other_person.status_code == 404
    other_hotel = client.get(f"/v1/housekeeping/inspections/submissions/{payload['client_submission_id']}", headers=_auth(hotel_id=OTHER_HOTEL))
    assert other_hotel.status_code == 404


def test_resubmitting_a_spent_id_with_different_answers_returns_the_stored_outcome(client, env):
    payload = _payload(env)
    assert _post(client, env, payload).status_code == 200
    changed = _payload(env, result="failed", fails=("bed",), submission=payload["client_submission_id"])
    res = _post(client, env, changed)
    assert res.status_code == 200 and res.json()["data"]["replayed"] is True
    assert res.json()["data"]["overall_result"] == "passed"  # the stored outcome is authoritative


def test_photo_upload_failure_records_nothing_and_a_retry_can_succeed(client, env, monkeypatch):
    payload = _payload(env, result="failed", fails=("mirror",))

    class Boom:
        def upload(self, *args, **kwargs):
            raise RuntimeError("storage down")

    real = env.db.storage.from_
    monkeypatch.setattr(env.db.storage, "from_", lambda bucket: Boom())
    res = _post(client, env, payload, photos=["mirror"])
    assert res.status_code == 502 and res.json()["code"] == "photo_upload_failed"
    assert env.db.rows["inspections"] == [] and env.db.rows["tasks"] == []
    assert env.db.rows["room_status"][0]["status"] == "CLEAN"
    monkeypatch.setattr(env.db.storage, "from_", real)
    assert _post(client, env, payload, photos=["mirror"]).status_code == 200


def test_inspection_saved_without_its_answers_is_finished_by_the_retry_not_duplicated(client, env):
    payload = _payload(env, result="failed", fails=("bed",), severity="minor")
    env.db.fail_inserts["inspection_results"] = 1
    first = _post(client, env, payload)
    assert first.status_code == 500 and first.json()["code"] == "inspection_incomplete"
    assert len(env.db.rows["inspections"]) == 1 and env.db.rows["inspection_results"] == []
    retry = _post(client, env, payload)
    assert retry.status_code == 200, retry.text
    assert len(env.db.rows["inspections"]) == 1 and len(env.db.rows["inspection_results"]) == 3
    assert len(env.db.rows["tasks"]) == 1 and retry.json()["data"]["followup_complete"] is True


def test_correction_task_failure_still_reports_the_committed_inspection_and_the_retry_heals_it(client, env):
    payload = _payload(env, result="failed", fails=("bed",), severity="minor")
    env.db.fail_inserts["tasks"] = 1
    first = _post(client, env, payload)
    assert first.status_code == 200
    data = first.json()["data"]
    assert data["correction"]["status"] == "failed" and data["followup_complete"] is False
    assert env.db.rows["room_status"][0]["status"] == "DIRTY" and env.db.rows["room_status"][0]["reclean_requested_at"]
    assert env.db.rows["tasks"] == []
    retry = _post(client, env, payload)
    assert retry.status_code == 200 and retry.json()["data"]["replayed"] is True
    assert retry.json()["data"]["followup_complete"] is True and len(env.db.rows["tasks"]) == 1
    assert len(env.db.rows["inspections"]) == 1


def test_repeated_retries_and_the_reclean_endpoint_never_create_a_second_correction_task(client, env):
    payload = _payload(env, result="failed", fails=("bed",))
    assert _post(client, env, payload).status_code == 200
    for _ in range(3):
        again = client.post(f"/v1/housekeeping/inspections/{payload['client_submission_id']}/reclean", json={}, headers=_auth())
        assert again.status_code == 200 and again.json()["data"]["created"] is False
        assert _post(client, env, payload).status_code == 200
    assert len(env.db.rows["tasks"]) == 1


def test_reclean_does_not_reset_a_room_whose_correction_is_already_under_way(client, env):
    payload = _payload(env, result="failed", fails=("bed",))
    _post(client, env, payload)
    env.db.rows["room_status"][0]["status"] = "IN_PROGRESS"
    res = client.post(f"/v1/housekeeping/inspections/{payload['client_submission_id']}/reclean", json={}, headers=_auth())
    assert res.status_code == 200 and env.db.rows["room_status"][0]["status"] == "IN_PROGRESS"


def test_the_unique_task_index_resolves_a_concurrent_creation(client, env, monkeypatch):
    payload = _payload(env, result="failed", fails=("bed",))
    real_fetch = corrections.fetch_correction_task
    calls = {"n": 0}

    def racing_fetch(db, hotel_id, inspection_id):
        calls["n"] += 1
        if calls["n"] == 1:
            return None  # looks absent...
        return real_fetch(db, hotel_id, inspection_id)

    original_insert = env.db.rows["tasks"]
    original_insert.append({"id": "t-race", "tenant_id": HOTEL, "source_inspection_id": payload["client_submission_id"], "status": "open"})
    monkeypatch.setattr(corrections, "fetch_correction_task", racing_fetch)
    res = _post(client, env, payload)
    assert res.status_code == 200
    assert len(env.db.rows["tasks"]) == 1 and res.json()["data"]["correction"]["status"] == "existing"


# --- reinspection --------------------------------------------------------------

def _seed_failed_room(client, env):
    failed = _payload(env, result="failed", fails=("bed",), severity="minor")
    assert _post(client, env, failed).status_code == 200
    # housekeeper resubmits the correction: the room is CLEAN again, flag still set
    env.db.rows["room_status"][0]["status"] = "CLEAN"
    return failed["client_submission_id"]


def test_a_passing_reinspection_links_the_failure_and_closes_its_correction_task(client, env):
    failed_id = _seed_failed_room(client, env)
    res = _post(client, env, _payload(env))
    assert res.status_code == 200, res.text
    assert res.json()["data"]["reinspection_of"] == failed_id
    task = _rows(env, "tasks")[0]
    assert task["status"] == "completed" and task["completed_at"]
    assert env.db.rows["room_status"][0]["status"] == "INSPECTED" and env.db.rows["room_status"][0]["reclean_requested_at"] is None
    detail = client.get(f"/v1/housekeeping/inspections/{failed_id}", headers=_auth()).json()["data"]
    assert detail["correction"]["status"] == "verified"


def test_a_failed_reinspection_supersedes_and_creates_its_own_correction(client, env):
    failed_id = _seed_failed_room(client, env)
    second = _payload(env, result="failed", fails=("floor",), severity="major")
    res = _post(client, env, second)
    assert res.status_code == 200 and res.json()["data"]["reinspection_of"] == failed_id
    assert len(env.db.rows["tasks"]) == 2
    first_detail = client.get(f"/v1/housekeeping/inspections/{failed_id}", headers=_auth()).json()["data"]
    assert first_detail["correction"]["status"] == "superseded"


def test_a_client_reinspection_claim_that_disagrees_with_the_open_correction_is_stale(client, env, monkeypatch):
    _seed_failed_room(client, env)
    res = _post(client, env, _payload(env, reinspection_of=str(uuid4())))
    assert res.status_code == 409 and res.json()["code"] == "correction_changed"
    plain = Env()
    monkeypatch.setattr(hk_router, "supabase", plain.db)
    res = _post(client, plain, _payload(plain, reinspection_of=str(uuid4())))
    assert res.status_code == 409 and res.json()["code"] == "correction_changed"


# --- reads ----------------------------------------------------------------------

def test_detail_returns_answers_in_configured_order_with_evidence_and_correction(client, env):
    payload = _payload(env, result="failed", fails=("mirror", "floor"), severity="major")
    assert _post(client, env, payload, photos=["mirror"]).status_code == 200
    detail = client.get(f"/v1/housekeeping/inspections/{payload['client_submission_id']}", headers=_auth()).json()["data"]
    assert [i["description"] for i in detail["items"]] == ["Bed made", "Mirror clean", "Floor vacuumed"]
    assert detail["items"][1]["photo_url"] and detail["items"][1]["severity"] == "major"
    assert detail["inspector_name"] == "Sam Supervisor" and detail["room_number"] == "204"
    assert detail["correction"]["task"]["assigned_name"] == "Hana Housekeeper"
    assert detail["correction"]["status"] == "assigned" and detail["correction"]["kind"] == "reclean"


def test_detail_is_tenant_scoped_role_gated_and_tolerates_bad_ids(client, env):
    payload = _payload(env)
    _post(client, env, payload)
    url = f"/v1/housekeeping/inspections/{payload['client_submission_id']}"
    assert client.get(url, headers=_auth(hotel_id=OTHER_HOTEL)).status_code == 404
    assert client.get(url, headers=_auth(role="housekeeper")).status_code == 403
    assert client.get("/v1/housekeeping/inspections/not-a-uuid", headers=_auth()).status_code == 404
    assert client.get(f"/v1/housekeeping/inspections/{uuid4()}", headers=_auth()).status_code == 404


def test_historical_conditional_inspections_still_read_back_without_a_correction(client, env):
    old = str(uuid4())
    env.db.rows["inspections"].append(
        {"id": old, "tenant_id": HOTEL, "room_id": env.room, "template_id": env.template, "inspected_by": USER,
         "overall_result": "conditional", "notes": "minor smudge", "completed_at": "2026-01-01T10:00:00+00:00"}
    )
    detail = client.get(f"/v1/housekeeping/inspections/{old}", headers=_auth()).json()["data"]
    assert detail["overall_result"] == "conditional" and detail["correction"] is None and detail["items"] == []
    assert detail["correction_kind"] is None and detail["reinspection_of"] is None


def test_templates_expose_a_fingerprint_that_matches_what_completion_checks(client, env):
    res = client.get("/v1/housekeeping/inspections/templates", headers=_auth())
    template = res.json()["data"][0]
    assert template["fingerprint"] == env.fingerprint()
    assert all("allows_na" in item and "requires_photo_on_fail" in item for item in template["items"])
    assert _post(client, env, _payload(env, template_fingerprint=template["fingerprint"])).status_code == 200


def test_queue_exposes_room_type_clean_cycle_and_the_previous_failure_to_reinspect(client, env):
    cycle = str(uuid4())
    env.db.rows["room_status_history"].append(
        {"id": cycle, "tenant_id": HOTEL, "room_id": env.room, "to_status": "CLEAN", "created_at": "2099-01-01T00:00:00+00:00"}
    )
    # the join the real query performs: FakeDB has no embedded selects
    env.db.rows["room_status"][0]["rooms"] = {"room_number": "204", "floor": 2, "room_type_id": env.room_type}
    plain = client.get("/v1/housekeeping/ready-for-inspection", headers=_auth()).json()["data"][0]
    assert plain["room_type_id"] == env.room_type and plain["clean_cycle_id"] == cycle and plain["previous_failure"] is None

    _seed = _payload(env, result="failed", fails=("bed",), severity="minor")
    # re-open as a failed + cleaned-again room
    env.db.rows["room_status"][0]["status"] = "CLEAN"
    assert _post(client, env, _seed).status_code == 200
    env.db.rows["room_status"][0]["status"] = "CLEAN"
    row = client.get("/v1/housekeeping/ready-for-inspection", headers=_auth()).json()["data"][0]
    failure = row["previous_failure"]
    assert failure["inspection_id"] == _seed["client_submission_id"] and failure["correction_kind"] == "touch_up"
    assert [i["label"] for i in failure["items"]] == ["Bed made"]


# --- the legacy pathway the shipped mobile screen still uses -------------------------

def _legacy(client, env, **overrides):
    body = {
        "room_id": env.room, "template_id": env.template, "overall_result": "passed", "notes": None,
        "items": [{"template_item_id": i, "result": "pass"} for i in env.items.values()],
        **overrides,
    }
    return client.post("/v1/housekeeping/inspections", json=body, headers=_auth())


def test_legacy_pass_still_works(client, env):
    res = _legacy(client, env)
    assert res.status_code == 200 and env.db.rows["room_status"][0]["status"] == "INSPECTED"


def test_legacy_conditional_cannot_carry_a_failed_item_or_release_a_defect(client, env):
    items = [{"template_item_id": i, "result": "pass"} for i in env.items.values()]
    items[0]["result"] = "fail"
    for outcome in ("passed", "conditional"):
        res = _legacy(client, env, overall_result=outcome, items=items)
        assert res.status_code == 422
    assert env.db.rows["inspections"] == []


def test_legacy_conditional_touch_up_blocks_the_room_and_owns_one_correction(client, env):
    res = _legacy(client, env, overall_result="conditional", notes="Smudge on the desk")
    assert res.status_code == 200
    # It used to mark the room INSPECTED and rely on a prompt the supervisor could dismiss.
    assert env.db.rows["room_status"][0]["status"] == "DIRTY" and env.db.rows["room_status"][0]["reclean_requested_at"]
    inspection = env.db.rows["inspections"][0]
    assert inspection["overall_result"] == "conditional" and inspection["correction_kind"] == "touch_up"
    task = env.db.rows["tasks"][0]
    assert task["title"] == "Touch-up Room 204" and task["source_inspection_id"] == inspection["id"] and task["assigned_to"] == "hk-1"
    assert "Smudge on the desk" in task["description"]
    # the screen's own "send back" step finds the task instead of making another
    again = client.post(f"/v1/housekeeping/inspections/{inspection['id']}/reclean", json={}, headers=_auth())
    assert again.status_code == 200 and again.json()["data"]["created"] is False and len(env.db.rows["tasks"]) == 1
    read = client.get(f"/v1/housekeeping/inspections/{inspection['id']}", headers=_auth())
    assert read.status_code == 200, read.text
    detail = read.json()["data"]
    assert detail["correction"]["status"] == "assigned" and detail["correction"]["kind"] == "touch_up"


def test_legacy_failure_creates_its_correction_without_waiting_for_the_prompt(client, env):
    items = [{"template_item_id": i, "result": "pass"} for i in env.items.values()]
    items[0]["result"] = "fail"
    assert _legacy(client, env, overall_result="failed", items=items).status_code == 200
    assert len(env.db.rows["tasks"]) == 1 and env.db.rows["inspections"][0]["correction_kind"] == "reclean"


def test_a_room_back_in_the_queue_after_a_touch_up_is_a_reinspection_of_it(client, env):
    _legacy(client, env, overall_result="conditional")
    inspection_id = env.db.rows["inspections"][0]["id"]
    env.db.rows["room_status"][0]["status"] = "CLEAN"
    res = _post(client, env, _payload(env))
    assert res.status_code == 200 and res.json()["data"]["reinspection_of"] == inspection_id
    assert env.db.rows["tasks"][0]["status"] == "completed"
    assert env.db.rows["room_status"][0]["status"] == "INSPECTED"


def test_legacy_failed_then_reclean_creates_one_task_and_never_two(client, env):
    items = [{"template_item_id": i, "result": "pass"} for i in env.items.values()]
    items[0]["result"] = "fail"
    res = _legacy(client, env, overall_result="failed", items=items)
    inspection_id = res.json()["data"]["id"]
    for _ in range(2):
        again = client.post(f"/v1/housekeeping/inspections/{inspection_id}/reclean", json={}, headers=_auth())
        assert again.status_code == 200
    assert len(env.db.rows["tasks"]) == 1 and env.db.rows["tasks"][0]["title"] == "Re-clean Room 204"


def test_legacy_submit_race_is_a_409_not_a_500(client, env):
    env.db.before_inspection_insert = lambda db: db.rows["room_status"][0].update(status="INSPECTED")
    # status check passes (CLEAN), then the DB guard fires
    res = _legacy(client, env)
    assert res.status_code == 409


# --- the supervisor Inspections lists (Phase 2) ---------------------------------------


def _fail_another_room(env, number, *, minutes, assigned="hk-1", status="DIRTY"):
    """A second room with its own failed inspection, written the way the completion endpoint leaves it."""
    room = str(uuid4())
    inspection = str(uuid4())
    env.db.rows["rooms"].append({"id": room, "tenant_id": HOTEL, "room_number": number, "floor": 3, "building": "B", "room_type_id": env.room_type})
    env.db.rows["room_status"].append(
        {"room_id": room, "tenant_id": HOTEL, "status": status, "reclean_requested_at": "2026-10-20T09:00:00+00:00"}
    )
    env.db.rows["inspections"].append(
        {"id": inspection, "tenant_id": HOTEL, "room_id": room, "template_id": env.template, "inspected_by": USER,
         "overall_result": "failed", "correction_kind": "reclean", "notes": "", "completed_at": f"2026-10-20T11:{minutes:02d}:00+00:00"}
    )
    env.db.rows["inspection_results"].append(
        {"tenant_id": HOTEL, "inspection_id": inspection, "template_item_id": env.items["bed"], "result": "fail", "note": ""}
    )
    env.db.rows["tasks"].append(
        {"id": str(uuid4()), "tenant_id": HOTEL, "source_inspection_id": inspection, "status": "open", "assigned_to": assigned,
         "due_at": None, "started_at": None, "completed_at": None}
    )
    return room, inspection


def _corrections(client, **kw):
    return client.get("/v1/housekeeping/inspections/corrections", headers=kw.get("headers") or _auth())


def test_corrections_list_is_hotel_wide_with_the_real_status_owner_and_failed_items(client, env):
    failed_id = _seed_failed_room(client, env)  # room 204 is CLEAN again: the housekeeper resubmitted
    _fail_another_room(env, "305", minutes=30)
    rows = {r["room_number"]: r for r in _corrections(client).json()["data"]}
    assert set(rows) == {"204", "305"}
    assert rows["204"]["inspection_id"] == failed_id and rows["204"]["status"] == "resubmitted"
    assert rows["305"]["status"] == "assigned" and rows["305"]["task"]["assigned_name"] == "Hana Housekeeper"
    assert rows["305"]["failed_items"][0]["label"] == "Bed made" and rows["305"]["failed_count"] == 1
    assert rows["305"]["floor"] == 3 and rows["305"]["building"] == "B" and rows["305"]["inspector_name"] == "Sam Supervisor"
    assert _corrections(client).json()["meta"] == {"window_days": 60, "truncated": False}


def test_a_verified_or_superseded_correction_is_not_outstanding(client, env):
    _seed_failed_room(client, env)
    assert len(_corrections(client).json()["data"]) == 1
    assert _post(client, env, _payload(env)).status_code == 200  # a passing reinspection verifies it
    assert _corrections(client).json()["data"] == []


def test_a_failed_reinspection_replaces_the_old_correction_instead_of_doubling_it(client, env):
    _seed_failed_room(client, env)
    assert _post(client, env, _payload(env, result="failed", fails=("floor",), severity="major")).status_code == 200
    rows = _corrections(client).json()["data"]
    assert len(rows) == 1 and rows[0]["failed_items"][0]["label"] == "Floor vacuumed"  # one room, one outstanding correction


def test_historical_conditional_rows_without_a_correction_are_not_listed(client, env):
    env.db.rows["inspections"].append(
        {"id": str(uuid4()), "tenant_id": HOTEL, "room_id": env.room, "template_id": env.template, "inspected_by": USER,
         "overall_result": "conditional", "notes": "smudge", "completed_at": "2026-10-19T10:00:00+00:00"}
    )
    assert _corrections(client).json()["data"] == []


def test_corrections_are_tenant_scoped_and_role_gated(client, env):
    _seed_failed_room(client, env)
    assert _corrections(client, headers=_auth(hotel_id=OTHER_HOTEL)).json()["data"] == []
    assert _corrections(client, headers=_auth(role="housekeeper")).status_code == 403
    assert _corrections(client, headers=_auth(role="engineer")).status_code == 403


def test_corrections_never_issue_a_request_per_inspection(client, env):
    calls = []
    original = env.db.table
    env.db.table = lambda name: (calls.append(name), original(name))[1]
    _fail_another_room(env, "301", minutes=1)
    _corrections(client)
    few = len(calls)
    calls.clear()
    for n in range(2, 25):
        _fail_another_room(env, f"3{n:02d}", minutes=n)
    assert len(_corrections(client).json()["data"]) == 24
    assert len(calls) == few  # the number of reads does not grow with the number of failed inspections


def test_corrections_report_when_more_exist_than_are_returned(client, env, monkeypatch):
    monkeypatch.setattr(corrections, "OPEN_CORRECTIONS_LIMIT", 2)
    monkeypatch.setattr(hk_router, "list_open_corrections", lambda db, hotel: corrections.list_open_corrections(db, hotel, limit=2))
    for n in range(1, 4):
        _fail_another_room(env, f"40{n}", minutes=n)
    body = _corrections(client).json()
    assert len(body["data"]) == 2 and body["meta"]["truncated"] is True


def test_the_done_list_carries_room_identity_and_never_an_id_as_a_name(client, env):
    env.db.rows["rooms"][0]["building"] = "A"
    ghost = str(uuid4())
    env.db.rows["inspections"] += [
        {"id": str(uuid4()), "tenant_id": HOTEL, "room_id": env.room, "inspected_by": USER, "overall_result": "passed",
         "completed_at": "2026-10-20T15:00:00+00:00", "rooms": {"room_number": "204", "floor": 2, "building": "A"}},
        {"id": str(uuid4()), "tenant_id": HOTEL, "room_id": env.room, "inspected_by": ghost, "overall_result": "failed",
         "completed_at": "2026-10-20T14:00:00+00:00", "rooms": {"room_number": "204", "floor": 2, "building": "A"}},
    ]
    rows = client.get("/v1/housekeeping/inspections?date_from=2026-10-20&date_to=2026-10-20", headers=_auth()).json()["data"]
    named = next(r for r in rows if r["inspector_display_name"])
    anonymous = next(r for r in rows if not r["inspector_display_name"])
    assert named["inspector_display_name"] == "Sam Supervisor" and named["room_id"] == env.room and named["floor"] == 2
    assert anonymous["inspector_display_name"] is None  # the legacy field still carries an id prefix; this one never does


def test_the_queue_carries_recorded_priority_facts_and_no_id_as_a_housekeeper_name(client, env):
    env.db.rows["room_status"][0].update(
        {"rooms": {"room_number": "204", "floor": 2, "building": "A", "room_type_id": env.room_type},
         "vip_flag": True, "checkin_time": "2026-10-20T20:00:00+00:00", "priority": 2, "priority_needed_by": None}
    )
    env.db.rows["user_profiles"] = [p for p in env.db.rows["user_profiles"] if p["id"] != "hk-1"] + [{"id": "hk-1", "tenant_id": HOTEL}]
    row = client.get("/v1/housekeeping/ready-for-inspection?date=" + Env.today(), headers=_auth()).json()["data"][0]
    assert row["vip"] is True and row["arrival_at"] == "2026-10-20T20:00:00+00:00" and row["priority"] == 2
    assert row["priority_needed_by"] is None and row["building"] == "A"
    assert row["cleaned_by"] == "" and row["housekeeper_id"] == "hk-1"  # unnamed stays blank, never "hk-1"


def test_the_queue_names_the_room_type_only_when_one_is_recorded(client, env):
    rooms = {"room_number": "204", "floor": 2, "room_type_id": env.room_type}
    env.db.rows["room_status"][0]["rooms"] = {**rooms, "room_types": {"name": "Standard King"}}
    named = client.get("/v1/housekeeping/ready-for-inspection?date=" + Env.today(), headers=_auth()).json()["data"][0]
    assert named["room_type_name"] == "Standard King" and named["room_type_id"] == env.room_type
    # no embedded type (or a blank name): null, never a made-up label
    env.db.rows["room_status"][0]["rooms"] = {**rooms, "room_types": {"name": ""}}
    blank = client.get("/v1/housekeeping/ready-for-inspection?date=" + Env.today(), headers=_auth()).json()["data"][0]
    assert blank["room_type_name"] is None
    env.db.rows["room_status"][0]["rooms"] = rooms
    absent = client.get("/v1/housekeeping/ready-for-inspection?date=" + Env.today(), headers=_auth()).json()["data"][0]
    assert absent["room_type_name"] is None
