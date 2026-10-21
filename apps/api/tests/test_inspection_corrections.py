"""Managing a failed inspection's correction: owners, reassignment, escalation, the detail's activity history,
the reinspection verification rule and the housekeeper's resubmission closing the task (never approving the room).

Builds on the completion test harness (same FakeDB + trigger model) so the whole lifecycle - fail, reassign,
escalate, housekeeper resubmits, reinspect - runs against the real routers.
"""

import json
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from main import app
from routers import clean_sessions as cs_router
from routers import housekeeping as hk_router
from routers import tasks as tasks_router
from services import reclean_corrections as corrections
from tests.test_inspection_completion import HOTEL, OTHER_HOTEL, USER, Env, _auth, _payload, _post, _rows

HK1 = "hk-1"  # Hana, assigned to the room by the Env
HK2 = "hk-2"
SUP2 = "sup-2"


class CorrectionEnv(Env):
    def __init__(self):
        super().__init__()
        rows = self.db.rows
        rows["user_roles"] = [
            {"user_id": HK1, "tenant_id": HOTEL, "role": "housekeeper", "is_active": True},
            {"user_id": HK2, "tenant_id": HOTEL, "role": "housekeeper", "is_active": True},
            {"user_id": SUP2, "tenant_id": HOTEL, "role": "housekeeping_supervisor", "is_active": True},
            {"user_id": "hk-gone", "tenant_id": HOTEL, "role": "housekeeper", "is_active": False},
            {"user_id": "engineer-1", "tenant_id": HOTEL, "role": "engineer", "is_active": True},
            {"user_id": "hk-other", "tenant_id": OTHER_HOTEL, "role": "housekeeper", "is_active": True},
        ]
        rows["user_profiles"] += [
            {"id": HK2, "tenant_id": HOTEL, "preferred_name": "Carlos Cleaner"},
            {"id": SUP2, "tenant_id": HOTEL, "preferred_name": "Ana Supervisor"},
            {"id": "hk-gone", "tenant_id": HOTEL, "preferred_name": "Gone Person"},
            {"id": "engineer-1", "tenant_id": HOTEL, "preferred_name": "Eli Engineer"},
            {"id": "hk-other", "tenant_id": OTHER_HOTEL, "preferred_name": "Other Hotel"},
        ]
        rows["operational_audit_events"] = []
        rows["task_comments"] = []
        rows["notifications"] = []


@pytest.fixture
def env(monkeypatch):
    e = CorrectionEnv()
    for module in (hk_router, cs_router, tasks_router):
        monkeypatch.setattr(module, "supabase", e.db)

    async def no_push(**_kwargs):  # the in-app row is what is asserted; never reach for the network
        return None

    monkeypatch.setattr(tasks_router, "send_push", no_push)
    return e


@pytest.fixture
def client():
    return TestClient(app)


def _fail(client, env, **extra):
    """Record a failed inspection (one major item) and return its id."""
    payload = _payload(env, result="failed", fails=("bed",), severity="major", **extra)
    res = _post(client, env, payload)
    assert res.status_code == 200, res.text
    return payload["client_submission_id"]


def _reassign(client, inspection_id, assignee, headers=None, **extra):
    return client.post(
        f"/v1/housekeeping/inspections/{inspection_id}/correction/reassign",
        json={"assigned_to": assignee, **extra},
        headers=headers or _auth(),
    )


def _escalate(client, inspection_id, headers=None, **body):
    return client.post(f"/v1/housekeeping/inspections/{inspection_id}/correction/escalate", json=body, headers=headers or _auth())


def _uuid_user(env, name):
    """The router validates UUID4 request ids, so give the fixture people real UUIDs."""
    new_id = str(uuid4())
    for table in ("user_roles", "user_profiles"):
        for row in env.db.rows[table]:
            if row.get("user_id") == name or row.get("id") == name:
                row["user_id" if "user_id" in row else "id"] = new_id
    return new_id


@pytest.fixture
def people(env):
    ids = {name: _uuid_user(env, name) for name in (HK1, HK2, SUP2, "hk-gone", "engineer-1", "hk-other")}
    for task in env.db.rows["tasks"]:
        if task.get("assigned_to") in ids:
            task["assigned_to"] = ids[task["assigned_to"]]
    for assignment in env.db.rows["room_assignments"]:
        assignment["assigned_to"] = ids.get(assignment["assigned_to"], assignment["assigned_to"])
    return ids


# --- who can own a correction -----------------------------------------------------------------------------

def test_owner_list_is_this_hotels_active_housekeepers_and_supervisors_with_real_names(client, env, people):
    res = client.get("/v1/housekeeping/inspections/correction-owners", headers=_auth())
    assert res.status_code == 200
    names = [o["name"] for o in res.json()["data"]]
    assert names == ["Ana Supervisor", "Carlos Cleaner", "Hana Housekeeper"]  # no engineer, no deactivated person, no other hotel


def test_owner_list_is_closed_to_housekeepers_and_front_desk(client, env):
    for role in ("housekeeper", "front_desk", "engineer"):
        assert client.get("/v1/housekeeping/inspections/correction-owners", headers=_auth(role=role)).status_code == 403


# --- reassignment -----------------------------------------------------------------------------------------

def test_reassign_moves_the_one_task_audits_it_and_notifies_the_new_owner(client, env, people):
    inspection = _fail(client, env)
    task = _rows(env, "tasks")[0]
    assert task["assigned_to"] == people[HK1]
    res = _reassign(client, inspection, people[HK2], expected_assigned_to=people[HK1])
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["changed"] is True and data["task"]["assigned_to"] == people[HK2] and data["task"]["assigned_name"] == "Carlos Cleaner"
    assert len(_rows(env, "tasks")) == 1 and _rows(env, "tasks")[0]["assigned_to"] == people[HK2]  # no duplicate task
    audit = _rows(env, "operational_audit_events", action="task.correction_reassigned")
    assert len(audit) == 1 and audit[0]["actor_id"] == USER and audit[0]["new_state"]["assigned_to"] == people[HK2]
    assert audit[0]["old_state"]["assigned_to"] == people[HK1]
    assert {n["user_id"] for n in env.db.rows["notifications"]} == {people[HK2], people[HK1]}


def test_reassigning_to_the_current_owner_is_a_noop_and_notifies_nobody(client, env, people):
    inspection = _fail(client, env)
    res = _reassign(client, inspection, people[HK1])
    assert res.status_code == 200 and res.json()["data"]["changed"] is False
    assert _rows(env, "operational_audit_events") == [] and env.db.rows["notifications"] == []


def test_reassign_to_an_unassigned_correction_assigns_it(client, env, people):
    env.db.rows["room_assignments"].clear()
    inspection = _fail(client, env)
    assert _rows(env, "tasks")[0]["assigned_to"] is None
    res = _reassign(client, inspection, people[HK2], expected_assigned_to=None)
    assert res.status_code == 200 and res.json()["data"]["changed"] is True


@pytest.mark.parametrize("who", ["hk-gone", "engineer-1", "hk-other"])
def test_reassign_refuses_inactive_ineligible_and_other_hotel_people(client, env, people, who):
    inspection = _fail(client, env)
    res = _reassign(client, inspection, people[who])
    assert res.status_code == 422 and res.json()["code"] == "owner_ineligible"
    assert _rows(env, "tasks")[0]["assigned_to"] == people[HK1]


def test_reassign_refuses_a_stale_view_of_the_owner(client, env, people):
    inspection = _fail(client, env)
    _reassign(client, inspection, people[HK2])  # another supervisor got there first
    res = _reassign(client, inspection, people[SUP2], expected_assigned_to=people[HK1])
    assert res.status_code == 409 and res.json()["code"] == "correction_changed"
    assert _rows(env, "tasks")[0]["assigned_to"] == people[HK2]


def test_reassign_never_overwrites_a_correction_completed_a_moment_earlier(client, env, people):
    inspection = _fail(client, env)
    _rows(env, "tasks")[0]["status"] = "completed"
    res = _reassign(client, inspection, people[HK2])
    assert res.status_code == 409 and res.json()["code"] == "correction_closed"
    assert _rows(env, "tasks")[0]["assigned_to"] == people[HK1]


def test_a_conditional_update_loses_to_a_concurrent_completion(client, env, people, monkeypatch):
    inspection = _fail(client, env)
    real = corrections._open_correction

    def completes_after_the_check(*args, **kwargs):
        found = real(*args, **kwargs)
        _rows(env, "tasks")[0]["status"] = "completed"  # the housekeeper finishes between the read and the write
        return found

    monkeypatch.setattr(corrections, "_open_correction", completes_after_the_check)
    res = _reassign(client, inspection, people[HK2])
    assert res.status_code == 409 and res.json()["code"] == "correction_changed"
    assert _rows(env, "tasks")[0]["assigned_to"] == people[HK1]


def test_reassign_without_a_task_says_it_must_be_requested_again(client, env, people):
    inspection = _fail(client, env)
    env.db.rows["tasks"].clear()
    res = _reassign(client, inspection, people[HK2])
    assert res.status_code == 409 and res.json()["code"] == "correction_missing"


def test_reassign_is_closed_to_other_roles_and_to_other_hotels(client, env, people):
    inspection = _fail(client, env)
    for role in ("housekeeper", "front_desk", "engineer"):
        assert _reassign(client, inspection, people[HK2], headers=_auth(role=role)).status_code == 403
    foreign = _reassign(client, inspection, people[HK2], headers=_auth(hotel_id=OTHER_HOTEL, user="x"))
    assert foreign.status_code == 404 and foreign.json()["code"] == "inspection_not_found"
    assert _rows(env, "tasks")[0]["assigned_to"] == people[HK1]


def test_reassign_with_a_malformed_inspection_id_is_a_404(client, env, people):
    assert _reassign(client, "not-a-uuid", people[HK2]).status_code == 404


# --- escalation -------------------------------------------------------------------------------------------

def test_escalate_marks_the_task_records_who_and_when_and_keeps_the_priority(client, env, people):
    inspection = _fail(client, env)
    res = _escalate(client, inspection, note="Guest arrives at 3")
    assert res.status_code == 200, res.text
    assert res.json()["data"]["changed"] is True
    task = _rows(env, "tasks")[0]
    assert task["status"] == "escalated" and task["escalated_at"] and task["priority"] == "urgent"
    audit = _rows(env, "operational_audit_events", action="task.correction_escalated")
    assert len(audit) == 1 and audit[0]["actor_id"] == USER and audit[0]["reason_note"] == "Guest arrives at 3"
    assert [c["comment"] for c in env.db.rows["task_comments"]] == ["Guest arrives at 3"]


def test_escalating_twice_records_it_once(client, env, people):
    inspection = _fail(client, env)
    _escalate(client, inspection)
    again = _escalate(client, inspection)
    assert again.status_code == 200 and again.json()["data"]["changed"] is False
    assert len(_rows(env, "operational_audit_events", action="task.correction_escalated")) == 1


def test_escalate_refuses_a_settled_correction_and_other_roles(client, env, people):
    inspection = _fail(client, env)
    assert _escalate(client, inspection, headers=_auth(role="housekeeper")).status_code == 403
    _rows(env, "tasks")[0]["status"] = "cancelled"
    res = _escalate(client, inspection)
    assert res.status_code == 409 and res.json()["code"] == "correction_closed"


def test_an_escalated_correction_can_still_be_reassigned_and_stays_escalated(client, env, people):
    inspection = _fail(client, env)
    _escalate(client, inspection)
    res = _reassign(client, inspection, people[HK2])
    assert res.status_code == 200 and res.json()["data"]["task"]["status"] == "escalated"


# --- the detail drawer's data: only recorded facts --------------------------------------------------------

def test_detail_activity_lists_only_recorded_events_in_order_with_real_actors(client, env, people):
    inspection = _fail(client, env)
    _reassign(client, inspection, people[HK2])
    _escalate(client, inspection)
    res = client.get(f"/v1/housekeeping/inspections/{inspection}", headers=_auth())
    correction = res.json()["data"]["correction"]
    events = [e["type"] for e in correction["activity"]]
    assert events[0] == "inspection_failed" and "correction_created" not in events[:0]
    assert set(events) == {"inspection_failed", "reassigned", "escalated"} | ({"correction_created"} if "correction_created" in events else set())
    reassigned = next(e for e in correction["activity"] if e["type"] == "reassigned")
    assert reassigned["actor_name"] == "Sam Supervisor" and reassigned["assignee_name"] == "Carlos Cleaner"
    assert correction["activity"] == sorted(correction["activity"], key=lambda e: e["at"])
    assert "work_started" not in events and "work_submitted" not in events  # nothing happened that was not recorded
    assert correction["task"]["priority"] == "urgent" and correction["room_status"] == "DIRTY"


def test_detail_shows_the_work_the_housekeeper_submitted_with_the_recorded_time(client, env, people):
    inspection = _fail(client, env)
    env.db.rows["room_clean_sessions"].append(
        {"tenant_id": HOTEL, "room_id": env.room, "status": "completed", "housekeeper_id": people[HK1], "ended_at": "2099-01-01T12:22:00+00:00"}
    )
    correction = client.get(f"/v1/housekeeping/inspections/{inspection}", headers=_auth()).json()["data"]["correction"]
    assert correction["resubmission"]["at"] == "2099-01-01T12:22:00+00:00" and correction["resubmission"]["housekeeper_name"] == "Hana Housekeeper"
    assert any(e["type"] == "work_submitted" for e in correction["activity"])


def test_corrections_list_carries_the_rooms_own_status(client, env, people):
    _fail(client, env)
    row = client.get("/v1/housekeeping/inspections/corrections", headers=_auth()).json()["data"][0]
    assert row["room_status"] == "DIRTY" and row["task"]["created_at"] is not None


def test_a_completed_task_with_the_room_not_clean_is_still_not_a_clean_room(client, env, people):
    inspection = _fail(client, env)
    _rows(env, "tasks")[0]["status"] = "completed"  # completed some other way; no clean session, room stays DIRTY
    row = client.get("/v1/housekeeping/inspections/corrections", headers=_auth()).json()["data"][0]
    assert row["status"] == "resubmitted" and row["room_status"] == "DIRTY"  # the app must not offer a reinspection
    assert env.db.rows["room_status"][0]["status"] == "DIRTY"


# --- the housekeeper's resubmission closes the task, never approves the room -------------------------------

def test_completing_the_correction_clean_closes_the_task_and_leaves_the_room_awaiting_inspection(client, env, people):
    inspection = _fail(client, env)
    room = env.db.rows["room_status"][0]
    assert corrections.complete_correction_on_resubmission(env.db, HOTEL, env.room) is True
    task = _rows(env, "tasks")[0]
    assert task["status"] == "completed" and task["completed_at"]
    assert room["status"] == "DIRTY"  # the helper never moves the room; only the clean session and the inspection do
    assert corrections.complete_correction_on_resubmission(env.db, HOTEL, env.room) is False  # idempotent


def test_a_room_without_an_open_failure_has_nothing_to_close(env):
    assert corrections.complete_correction_on_resubmission(env.db, HOTEL, env.room) is False


# --- reinspection ---------------------------------------------------------------------------------------

def _back_to_clean(env):
    env.db.rows["room_status"][0]["status"] = "CLEAN"
    env.db.rows["room_status"][0]["updated_at"] = "2026-10-20T11:00:00+00:00"


def test_a_passing_reinspection_links_closes_and_releases_the_room(client, env, people):
    inspection = _fail(client, env)
    _back_to_clean(env)
    res = _post(client, env, _payload(env, reinspection_of=inspection))
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["overall_result"] == "passed" and data["reinspection_of"] == inspection
    assert env.db.rows["room_status"][0]["status"] == "INSPECTED"
    assert _rows(env, "tasks")[0]["status"] == "completed"
    original = _rows(env, "inspections", id=inspection)[0]
    assert original["overall_result"] == "failed"  # the failure is preserved, not edited away
    correction = client.get(f"/v1/housekeeping/inspections/{inspection}", headers=_auth()).json()["data"]["correction"]
    assert correction["status"] == "verified"
    assert correction["activity"][-1]["type"] == "reinspection_passed"


def test_a_failing_reinspection_keeps_the_room_blocked_and_makes_a_new_linked_correction(client, env, people):
    inspection = _fail(client, env)
    _back_to_clean(env)
    second = _payload(env, result="failed", fails=("bed",), severity="minor", reinspection_of=inspection)
    res = _post(client, env, second)
    assert res.status_code == 200, res.text
    assert env.db.rows["room_status"][0]["status"] == "DIRTY"
    tasks = _rows(env, "tasks")
    assert len(tasks) == 2 and {t["source_inspection_id"] for t in tasks} == {inspection, second["client_submission_id"]}
    first = client.get(f"/v1/housekeeping/inspections/{inspection}", headers=_auth()).json()["data"]["correction"]
    assert first["status"] == "superseded" and first["reinspection_id"] == second["client_submission_id"]
    open_rows = client.get("/v1/housekeeping/inspections/corrections", headers=_auth()).json()["data"]
    assert [r["inspection_id"] for r in open_rows] == [second["client_submission_id"]]  # one active correction, not two


def test_a_reinspection_must_explicitly_answer_every_item_that_failed_even_if_optional(client, env, people):
    inspection = _fail(client, env)
    _back_to_clean(env)
    bed = env.items["bed"]
    for item in env.db.rows["inspection_template_items"]:
        if item["id"] == bed:
            item["is_required"] = False  # the failed standard became optional since
    payload = _payload(env, reinspection_of=inspection)
    payload["items"] = [i for i in payload["items"] if i["template_item_id"] != bed]  # skipped: nobody looked
    res = _post(client, env, payload)
    assert res.status_code == 422 and res.json()["code"] == "reinspection_items_unverified"
    assert res.json()["missing_item_ids"] == [bed]
    assert env.db.rows["room_status"][0]["status"] == "CLEAN" and len(_rows(env, "inspections")) == 1


def test_an_edited_checklist_cannot_demand_items_it_no_longer_has(client, env, people):
    inspection = _fail(client, env)
    _back_to_clean(env)
    env.db.rows["inspection_template_items"][:] = [i for i in env.db.rows["inspection_template_items"] if i["id"] != env.items["bed"]]
    payload = _payload(env, reinspection_of=inspection)
    payload["items"] = [i for i in payload["items"] if i["template_item_id"] != env.items["bed"]]
    res = _post(client, env, payload)
    assert res.status_code == 200, res.text  # the whole current checklist is the verification


def test_retrying_a_failed_submission_never_creates_a_second_correction(client, env, people):
    payload = _payload(env, result="failed", fails=("bed",), severity="major")
    first = _post(client, env, payload)
    again = _post(client, env, payload)
    assert first.status_code == again.status_code == 200
    assert again.json()["data"]["replayed"] is True and len(_rows(env, "tasks")) == 1


def test_the_completion_reply_names_the_owner_from_the_servers_record(client, env, people):
    payload = _payload(env, result="failed", fails=("bed",), severity="major")
    task = _post(client, env, payload).json()["data"]["correction"]["task"]
    assert task["assigned_to"] == people[HK1] and task["assigned_name"] == "Hana Housekeeper" and task["status"] == "open"
    env.db.rows["room_assignments"].clear()
    env.db.rows["tasks"].clear()
    env.db.rows["inspections"].clear()
    env.db.rows["inspection_results"].clear()
    env.db.rows["room_status"][0]["status"] = "CLEAN"
    unassigned = _post(client, env, _payload(env, result="failed", fails=("bed",), severity="major")).json()["data"]["correction"]["task"]
    assert unassigned["assigned_to"] is None and unassigned["assigned_name"] is None  # "Unassigned", not an invented person


def test_the_partial_commit_repair_path_still_creates_the_task_once_and_names_the_owner(client, env, people):
    env.db.fail_inserts["tasks"] = 1
    payload = _payload(env, result="failed", fails=("bed",), severity="major")
    first = _post(client, env, payload)
    assert first.status_code == 200 and first.json()["data"]["followup_complete"] is False
    assert first.json()["data"]["correction"]["status"] == "failed"
    repaired = _post(client, env, payload)
    assert repaired.json()["data"]["followup_complete"] is True and len(_rows(env, "tasks")) == 1
    assert repaired.json()["data"]["correction"]["task"]["assigned_name"] == "Hana Housekeeper"
