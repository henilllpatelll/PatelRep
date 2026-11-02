"""Engineering PM + Assets V2, Phase 1: completion idempotency, checklist binding, deferral approval, permissions,
equipment identity. Handlers are called directly with a FakeDB that models the migration-232 functions (pm_fakes.py);
the SQL itself is exercised in tests/sql/test_pm_foundation_sql.py."""

from __future__ import annotations

import threading
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from middleware.auth import CurrentUser
from models.requests import (
    AssignPMChecklistRequest,
    CompletePMProgramRequest,
    CreateAssetRequest,
    CreatePMDeferralRequest,
    CreatePMScheduleRequest,
    DecidePMDeferralRequest,
    UpdateAssetRequest,
)
from routers import assets as assets_router
from routers import programs as programs_router
from services.programs.execution import PmCompletionRefused, compute_submission_hash, persist_pm_completion

from .pm_fakes import PmFakeDB

TENANT, OTHER = "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"
ASSET, SCHEDULE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
TEMPLATE, TEMPLATE_V2, FOREIGN_TEMPLATE = (str(uuid.uuid4()) for _ in range(3))
ROOM, CATEGORY = str(uuid.uuid4()), str(uuid.uuid4())


def user(role: str, uid: str | None = None, tenant: str = TENANT) -> CurrentUser:
    return CurrentUser(user_id=uid or f"{role}-1", hotel_id=tenant, role=role, email=f"{role}@example.com")


ENGINEER, CHIEF, GM = user("engineer"), user("chief_engineer"), user("gm")
NOW = datetime.now(timezone.utc)


def due(days: int) -> str:
    return (NOW + timedelta(days=days)).isoformat()


def make_db(**overrides) -> PmFakeDB:
    rows = {
        "assets": [{"id": ASSET, "tenant_id": TENANT, "name": "Chiller", "asset_tag": "CH-1", "is_active": True, "criticality": "medium", "row_version": 1}],
        "pm_schedules": [{
            "id": SCHEDULE, "tenant_id": TENANT, "asset_id": ASSET, "name": "Monthly", "interval_type": "monthly", "interval_days": None,
            "next_due_at": due(-2), "is_active": True, "recurrence_basis": "scheduled_date",
            "checklist_template_id": None, "checklist_template_code": None,
        }],
        "pm_checklist_templates": [
            {"id": TEMPLATE, "tenant_id": TENANT, "code": "chiller", "program_area": "engineering", "name": "Chiller", "version": 1, "is_active": True},
            {"id": FOREIGN_TEMPLATE, "tenant_id": OTHER, "code": "other", "program_area": "engineering", "name": "Other", "version": 1, "is_active": True},
        ],
        "user_roles": [{"user_id": "chief_engineer-1", "tenant_id": TENANT, "is_active": True}],
        "rooms": [{"id": ROOM, "tenant_id": TENANT}],
        "asset_categories": [{"id": CATEGORY, "tenant_id": TENANT}],
    }
    rows.update(overrides)
    return PmFakeDB(rows)


@pytest.fixture
def db(monkeypatch):
    database = make_db()
    monkeypatch.setattr(assets_router, "supabase", database)
    monkeypatch.setattr(programs_router, "supabase", database)
    return database


def body(**extra) -> CompletePMProgramRequest:
    base = {"items": [{"key": "belt", "label": "Belt", "result": "passed"}]}
    return CompletePMProgramRequest(**{**base, **extra})


async def complete(db, who=ENGINEER, **extra):
    return await assets_router.complete_pm_schedule(SCHEDULE, body(**extra), who)


async def refused(awaitable) -> HTTPException:
    with pytest.raises(HTTPException) as caught:
        await awaitable
    return caught.value


# ── permissions ──────────────────────────────────────────────────────────────

def guard(path: str, method: str) -> set[str]:
    """The roles a route's require_role() admits, read from the real routers (paths as mounted under /v1)."""
    path = path.removeprefix("/v1")
    for route in [*assets_router.router.routes, *programs_router.router.routes]:
        if getattr(route, "path", None) == path and method in getattr(route, "methods", set()):
            for dep in route.dependant.dependencies:
                if "require_role" in getattr(dep.call, "__qualname__", ""):
                    return set(dep.call.__closure__[0].cell_contents)
    raise AssertionError(f"no role-guarded {method} {path}")


@pytest.mark.parametrize("path,method,expected", [
    ("/v1/assets/pm-schedules/{schedule_id}/complete", "POST", {"engineer", "chief_engineer", "gm"}),
    ("/v1/assets/pm-schedules", "POST", {"chief_engineer", "gm"}),
    ("/v1/assets/pm-schedules/{schedule_id}", "PATCH", {"chief_engineer", "gm"}),
    ("/v1/assets/pm-schedules/{schedule_id}", "DELETE", {"chief_engineer", "gm"}),
    ("/v1/assets/pm-schedules/{schedule_id}/checklist", "PUT", {"chief_engineer", "gm"}),
    ("/v1/assets", "POST", {"engineer", "chief_engineer", "gm"}),
    ("/v1/assets/{asset_id}", "PATCH", {"engineer", "chief_engineer", "gm"}),
    ("/v1/assets/meters/{meter_id}/readings", "POST", {"engineer", "chief_engineer", "gm"}),
    ("/v1/assets/{asset_id}/downtime", "POST", {"engineer", "chief_engineer", "gm"}),
    ("/v1/programs/pm-schedules/{schedule_id}/deferrals", "POST", {"chief_engineer", "gm"}),
    ("/v1/programs/pm-deferrals/{deferral_id}/approve", "POST", {"chief_engineer", "gm"}),
    ("/v1/programs/pm-deferrals/{deferral_id}/reject", "POST", {"chief_engineer", "gm"}),
    ("/v1/programs/pm-deferrals", "GET", {"chief_engineer", "gm"}),
])
def test_role_guards(path, method, expected):
    assert guard(path, method) == expected


def test_engineer_cannot_move_a_due_date_or_decide_a_deferral():
    for path, method in (("/v1/assets/pm-schedules/{schedule_id}", "PATCH"), ("/v1/programs/pm-deferrals/{deferral_id}/approve", "POST")):
        assert "engineer" not in guard(path, method)


# ── completion: idempotency ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_replaying_an_accepted_submission_returns_the_original_and_records_nothing_new(db):
    submission = str(uuid.uuid4())
    first = await complete(db, submission_id=submission, items=[{"key": "belt", "label": "Belt", "result": "failed", "note": "frayed"}])
    advanced_to = db.rows["pm_schedules"][0]["next_due_at"]
    again = await complete(db, submission_id=submission, items=[{"key": "belt", "label": "Belt", "result": "failed", "note": "frayed"}])

    assert first["meta"]["replayed"] is False and again["meta"]["replayed"] is True
    assert again["data"]["id"] == first["data"]["id"]
    assert len(db.rows["pm_completion_records"]) == 1
    assert len(db.rows["work_orders"]) == 1 and len(again["data"]["corrective_work_orders"]) == 1
    assert db.rows["pm_schedules"][0]["next_due_at"] == advanced_to


@pytest.mark.asyncio
async def test_reusing_a_key_for_a_different_payload_is_a_conflict_that_changes_nothing(db):
    submission = str(uuid.uuid4())
    first = await complete(db, submission_id=submission)
    advanced_to = db.rows["pm_schedules"][0]["next_due_at"]

    error = await refused(complete(db, submission_id=submission, notes="a different inspection"))

    assert error.status_code == 409 and error.detail["code"] == "submission_conflict"
    assert len(db.rows["pm_completion_records"]) == 1
    assert db.rows["pm_completion_records"][0]["id"] == first["data"]["id"]
    assert db.rows["pm_schedules"][0]["next_due_at"] == advanced_to


@pytest.mark.asyncio
async def test_distinct_submissions_each_advance_the_schedule_once(db):
    await complete(db, submission_id=str(uuid.uuid4()))
    await complete(db, submission_id=str(uuid.uuid4()))
    assert len(db.rows["pm_completion_records"]) == 2
    assert [w for w in db.rows.get("work_orders", [])] == []


@pytest.mark.asyncio
async def test_an_older_app_build_without_a_key_still_completes(db):
    result = await complete(db)
    assert result["meta"]["replayed"] is False and db.rows["pm_completion_records"][0]["submission_id"] is None


def test_the_hash_ignores_the_key_but_not_the_content():
    a = compute_submission_hash(SCHEDULE, {"submission_id": "x", "notes": "n", "items": []})
    assert a == compute_submission_hash(SCHEDULE, {"submission_id": "y", "notes": "n", "items": []})
    assert a != compute_submission_hash(SCHEDULE, {"notes": "different", "items": []})
    assert a != compute_submission_hash("other-schedule", {"notes": "n", "items": []})


def test_concurrent_identical_submissions_record_once(db):
    submission = str(uuid.uuid4())
    payload = body(submission_id=submission, items=[{"key": "b", "label": "Belt", "result": "failed"}]).model_dump(mode="json")
    outcomes, errors = [], []

    def attempt():
        try:
            record = persist_pm_completion(db=db, tenant_id=TENANT, user_id="engineer-1", actor_role="engineer",
                                           schedule=dict(db.rows["pm_schedules"][0]), payload=dict(payload))
            outcomes.append(record["replayed"])
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=attempt) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert not errors
    assert sorted(outcomes) == [False] + [True] * 7
    assert len(db.rows["pm_completion_records"]) == 1 and len(db.rows["work_orders"]) == 1


@pytest.mark.asyncio
async def test_a_timeout_then_retry_with_the_same_key_finds_the_first_attempt(db):
    """The first response never reached the app; the retry must return the stored completion, not record a second."""
    submission = str(uuid.uuid4())
    await complete(db, submission_id=submission)
    retry = await complete(db, submission_id=submission)
    assert retry["meta"]["replayed"] is True and len(db.rows["pm_completion_records"]) == 1


@pytest.mark.asyncio
async def test_failed_items_open_one_corrective_work_order_each_and_no_more_on_retry(db):
    submission = str(uuid.uuid4())
    items = [{"key": "a", "label": "Belt", "result": "failed"}, {"key": "b", "label": "Filter", "result": "failed"}, {"key": "c", "label": "Oil", "result": "passed"}]
    await complete(db, submission_id=submission, items=items)
    await complete(db, submission_id=submission, items=items)
    assert sorted(w["title"] for w in db.rows["work_orders"]) == ["Corrective PM work: Belt", "Corrective PM work: Filter"]
    assert all(w["pm_completion_id"] == db.rows["pm_completion_records"][0]["id"] for w in db.rows["work_orders"])


@pytest.mark.asyncio
async def test_a_missing_database_function_fails_closed(db):
    class NoRpc(PmFakeDB):
        def rpc(self, name, params):
            raise Exception({"code": "PGRST202", "message": "Could not find the function public.record_pm_completion"})

    legacy = NoRpc(db.rows)
    with pytest.raises(PmCompletionRefused) as caught:
        persist_pm_completion(db=legacy, tenant_id=TENANT, user_id="engineer-1", actor_role="engineer",
                              schedule=dict(db.rows["pm_schedules"][0]), payload=body().model_dump(mode="json"))
    assert caught.value.status_code == 503 and db.rows.get("pm_completion_records", []) == []


@pytest.mark.asyncio
async def test_inactive_equipment_cannot_be_completed_but_an_earlier_completion_still_replays(db):
    submission = str(uuid.uuid4())
    await complete(db, submission_id=submission)
    db.rows["assets"][0]["is_active"] = False
    assert (await complete(db, submission_id=submission))["meta"]["replayed"] is True
    error = await refused(complete(db, submission_id=str(uuid.uuid4())))
    assert error.status_code == 409 and error.detail["code"] == "asset_inactive"


@pytest.mark.asyncio
async def test_another_properties_schedule_is_not_found(db):
    error = await refused(assets_router.complete_pm_schedule(SCHEDULE, body(), user("engineer", tenant=OTHER)))
    assert error.status_code == 404 and db.rows.get("pm_completion_records", []) == []


@pytest.mark.asyncio
async def test_evidence_from_another_property_is_refused_before_anything_is_written(db):
    db.rows["evidence_records"] = [{"id": "ev-1", "tenant_id": OTHER}]
    error = await refused(complete(db, photos=["ev-1"]))
    assert error.status_code == 422 and db.rows.get("pm_completion_records", []) == []


# ── checklist binding ────────────────────────────────────────────────────────

def bind(db, template_id=TEMPLATE, code="chiller"):
    db.rows["pm_schedules"][0].update({"checklist_template_id": template_id, "checklist_template_code": code})


@pytest.mark.asyncio
async def test_a_bound_schedule_completes_against_its_own_procedure_without_the_app_choosing(db):
    bind(db)
    result = await complete(db)
    record = db.rows["pm_completion_records"][0]
    assert record["checklist_template_id"] == TEMPLATE and record["checklist_version"] == 1 and result["data"]["id"] == record["id"]


@pytest.mark.asyncio
async def test_a_bound_schedule_refuses_an_unrelated_checklist(db):
    bind(db)
    db.rows["pm_checklist_templates"].append({"id": TEMPLATE_V2, "tenant_id": TENANT, "code": "boiler", "program_area": "engineering", "name": "Boiler", "version": 1, "is_active": True})
    error = await refused(complete(db, checklist_template_id=TEMPLATE_V2))
    assert error.status_code == 422 and db.rows.get("pm_completion_records", []) == []


@pytest.mark.asyncio
async def test_a_revision_of_the_same_procedure_is_accepted_and_recorded_with_its_version(db):
    bind(db)
    db.rows["pm_checklist_templates"][0]["is_active"] = False
    db.rows["pm_checklist_templates"].append({"id": TEMPLATE_V2, "tenant_id": TENANT, "code": "chiller", "program_area": "engineering", "name": "Chiller", "version": 2, "is_active": True})
    await complete(db, checklist_template_id=TEMPLATE_V2)
    assert db.rows["pm_completion_records"][0]["checklist_template_id"] == TEMPLATE_V2
    assert db.rows["pm_completion_records"][0]["checklist_version"] == 2


@pytest.mark.parametrize("setup,state", [
    (lambda db: db.rows["pm_checklist_templates"][0].update(is_active=False), "inactive"),
    (lambda db: db.rows["pm_checklist_templates"].pop(0), "missing"),
    (lambda db: db.rows["pm_checklist_templates"][0].update(program_area="housekeeping"), "incompatible"),
])
@pytest.mark.asyncio
async def test_an_unusable_bound_checklist_is_an_actionable_refusal_never_a_made_up_checklist(db, setup, state):
    bind(db)
    setup(db)
    error = await refused(complete(db))
    assert error.status_code == 409 and error.detail["code"] == "checklist_unavailable"
    assert error.detail["checklist"]["state"] == state
    assert db.rows.get("pm_completion_records", []) == []


@pytest.mark.asyncio
async def test_a_legacy_unbound_schedule_still_completes_with_the_technicians_choice(db):
    await complete(db, checklist_template_id=TEMPLATE)
    assert db.rows["pm_completion_records"][0]["checklist_template_id"] == TEMPLATE


@pytest.mark.asyncio
async def test_a_checklist_from_another_property_is_never_accepted(db):
    error = await refused(complete(db, checklist_template_id=FOREIGN_TEMPLATE))
    assert error.status_code == 422


@pytest.mark.asyncio
async def test_listing_reports_each_schedules_checklist_state_without_guessing(db):
    listed = (await assets_router.list_pm_schedules(ENGINEER))["data"]
    assert listed[0]["checklist"]["state"] == "unassigned"
    bind(db)
    assert (await assets_router.list_pm_schedules(ENGINEER))["data"][0]["checklist"] == {
        "state": "ready", "template_id": TEMPLATE, "template_code": "chiller", "template_name": "Chiller",
        "template_version": 1, "replacement_template_id": None,
    }
    db.rows["pm_checklist_templates"][0]["is_active"] = False
    db.rows["pm_checklist_templates"].append({"id": TEMPLATE_V2, "tenant_id": TENANT, "code": "chiller", "program_area": "engineering", "name": "Chiller", "version": 2, "is_active": True})
    state = (await assets_router.list_pm_schedules(ENGINEER))["data"][0]["checklist"]
    assert state["state"] == "inactive" and state["replacement_template_id"] == TEMPLATE_V2


@pytest.mark.asyncio
async def test_a_manager_binds_a_checklist_and_it_is_audited(db):
    result = await assets_router.assign_pm_schedule_checklist(SCHEDULE, AssignPMChecklistRequest(checklist_template_id=TEMPLATE), CHIEF)
    assert result["data"]["checklist"]["state"] == "ready"
    assert db.rows["pm_schedules"][0]["checklist_template_code"] == "chiller"
    assert db.rows["operational_audit_events"][-1]["action"] == "pm_schedule.checklist_assigned"
    cleared = await assets_router.assign_pm_schedule_checklist(SCHEDULE, AssignPMChecklistRequest(checklist_template_id=None), CHIEF)
    assert cleared["data"]["checklist"]["state"] == "unassigned"


@pytest.mark.asyncio
async def test_binding_rejects_another_properties_or_an_inactive_template(db):
    assert (await refused(assets_router.assign_pm_schedule_checklist(SCHEDULE, AssignPMChecklistRequest(checklist_template_id=FOREIGN_TEMPLATE), CHIEF))).status_code == 404
    db.rows["pm_checklist_templates"][0]["is_active"] = False
    assert (await refused(assets_router.assign_pm_schedule_checklist(SCHEDULE, AssignPMChecklistRequest(checklist_template_id=TEMPLATE), CHIEF))).status_code == 422


@pytest.mark.asyncio
async def test_creating_a_schedule_validates_the_asset_and_binds_the_template(db):
    request = CreatePMScheduleRequest(asset_id=ASSET, name="Quarterly", interval_type="quarterly", next_due_at=NOW + timedelta(days=10), checklist_template_id=TEMPLATE)
    created = (await assets_router.create_pm_schedule(request, CHIEF))["data"]
    assert created["checklist_template_id"] == TEMPLATE and created["checklist_template_code"] == "chiller"
    foreign = CreatePMScheduleRequest(asset_id=str(uuid.uuid4()), name="x", interval_type="daily", next_due_at=NOW)
    assert (await refused(assets_router.create_pm_schedule(foreign, CHIEF))).status_code == 404
    db.rows["assets"][0]["is_active"] = False
    assert (await refused(assets_router.create_pm_schedule(request, CHIEF))).status_code == 409


@pytest.mark.asyncio
async def test_one_schedule_resolves_with_its_exact_asset_and_other_properties_get_404(db):
    assert (await assets_router.get_pm_schedule(SCHEDULE, ENGINEER))["data"]["asset_id"] == ASSET
    assert (await refused(assets_router.get_pm_schedule(SCHEDULE, user("engineer", tenant=OTHER)))).status_code == 404
    assert (await refused(assets_router.get_pm_schedule("not-a-uuid", ENGINEER))).status_code == 404


# ── deferrals ────────────────────────────────────────────────────────────────

LATER = (NOW + timedelta(days=30)).isoformat()


async def request_deferral(who=CHIEF, until=None, **extra):
    return await programs_router.defer_pm_schedule(
        SCHEDULE, CreatePMDeferralRequest(reason="waiting for parts", deferred_until=until or LATER, **extra), who)


@pytest.mark.asyncio
async def test_a_request_is_pending_and_does_not_move_the_due_date(db):
    before = db.rows["pm_schedules"][0]["next_due_at"]
    created = (await request_deferral())["data"]
    assert created["status"] == "pending" and created.get("approved_by") is None and created["requested_by"] == CHIEF.user_id
    assert db.rows["pm_schedules"][0]["next_due_at"] == before
    assert db.rows["operational_audit_events"][-1]["action"] == "pm_deferral.requested"


@pytest.mark.asyncio
async def test_a_supplied_approver_is_ignored_so_approval_cannot_be_forged(db):
    created = (await request_deferral(approved_by="gm-1"))["data"]
    assert created.get("approved_by") is None and created["status"] == "pending"
    assert db.rows["pm_deferrals"][0].get("approved_by") is None


@pytest.mark.asyncio
async def test_the_requester_cannot_approve_or_reject_their_own_request(db):
    created = (await request_deferral())["data"]
    for action in (programs_router.approve_pm_deferral, programs_router.reject_pm_deferral):
        error = await refused(action(created["id"], DecidePMDeferralRequest(), CHIEF))
        assert error.status_code == 403 and error.detail["code"] == "self_review"
    assert db.rows.get("pm_deferral_decisions", []) == []


@pytest.mark.asyncio
async def test_an_independent_reviewer_approves_and_the_schedule_moves_once_with_a_full_audit_trail(db):
    created = (await request_deferral())["data"]
    result = await programs_router.approve_pm_deferral(created["id"], DecidePMDeferralRequest(note="ok"), GM)
    assert result["data"]["decided_by"] == GM.user_id and result["meta"]["replayed"] is False
    assert db.rows["pm_schedules"][0]["next_due_at"] == LATER
    event = db.rows["operational_audit_events"][-1]
    assert event["action"] == "pm_deferral.approved" and event["actor_id"] == GM.user_id
    assert event["old_state"]["requested_by"] == CHIEF.user_id
    assert db.rows.get("pm_completion_records", []) == []  # history is untouched

    again = await programs_router.approve_pm_deferral(created["id"], DecidePMDeferralRequest(), GM)
    assert again["meta"]["replayed"] is True and len(db.rows["pm_deferral_decisions"]) == 1
    other = await refused(programs_router.approve_pm_deferral(created["id"], DecidePMDeferralRequest(), user("chief_engineer", "chief-2")))
    assert other.status_code == 409 and other.detail["code"] == "already_decided"
    flipped = await refused(programs_router.reject_pm_deferral(created["id"], DecidePMDeferralRequest(), GM))
    assert flipped.status_code == 409


@pytest.mark.asyncio
async def test_rejection_leaves_the_schedule_alone(db):
    before = db.rows["pm_schedules"][0]["next_due_at"]
    created = (await request_deferral())["data"]
    result = await programs_router.reject_pm_deferral(created["id"], DecidePMDeferralRequest(note="no"), GM)
    assert result["data"]["decision"] == "rejected" and db.rows["pm_schedules"][0]["next_due_at"] == before


@pytest.mark.asyncio
async def test_concurrent_reviewers_apply_a_deferral_at_most_once(db):
    created = (await request_deferral())["data"]
    results = []

    def decide(reviewer):
        try:
            outcome = db.rpc("decide_pm_deferral", {
                "p_tenant_id": TENANT, "p_deferral_id": created["id"], "p_reviewer_id": reviewer, "p_reviewer_role": "gm",
                "p_decision": "approved", "p_note": None}).execute().data
            results.append(outcome["status"])
        except Exception as exc:  # noqa: BLE001
            results.append(repr(exc))

    threads = [threading.Thread(target=decide, args=(f"reviewer-{i}",)) for i in range(6)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert sorted(results) == ["already_decided"] * 5 + ["ok"] and len(db.rows["pm_deferral_decisions"]) == 1


@pytest.mark.asyncio
async def test_requests_must_be_future_later_than_the_current_due_date_and_not_duplicated(db):
    assert (await refused(request_deferral(until=(NOW - timedelta(days=1)).isoformat()))).status_code == 422
    db.rows["pm_schedules"][0]["next_due_at"] = due(10)
    assert (await refused(request_deferral(until=due(5)))).status_code == 422
    await request_deferral()
    assert (await refused(request_deferral(until=due(60)))).status_code == 409


@pytest.mark.asyncio
async def test_another_properties_request_and_schedule_are_invisible(db):
    created = (await request_deferral())["data"]
    outsider = user("gm", "gm-x", OTHER)
    assert (await refused(programs_router.approve_pm_deferral(created["id"], DecidePMDeferralRequest(), outsider))).status_code == 404
    assert (await refused(programs_router.defer_pm_schedule(SCHEDULE, CreatePMDeferralRequest(reason="x", deferred_until=LATER), outsider))).status_code == 404
    assert (await programs_router.list_pm_deferrals(status="all", schedule_id=None, limit=50, current_user=outsider))["data"] == []


@pytest.mark.asyncio
async def test_listing_shows_pending_decided_and_legacy_approved_rows(db):
    pending = (await request_deferral())["data"]
    db.rows["pm_deferrals"].append({"id": "legacy-1", "tenant_id": TENANT, "pm_schedule_id": SCHEDULE, "reason": "old", "requested_by": "chief_engineer-1",
                                    "approved_by": "gm-1", "deferred_until": due(40), "created_at": "2020-01-01T00:00:00+00:00"})
    listed = {row["id"]: row["status"] for row in (await programs_router.list_pm_deferrals(status="all", schedule_id=None, limit=50, current_user=GM))["data"]}
    assert listed == {pending["id"]: "pending", "legacy-1": "approved"}
    only_pending = (await programs_router.list_pm_deferrals(status="pending", schedule_id=None, limit=50, current_user=GM))["data"]
    assert [row["id"] for row in only_pending] == [pending["id"]]


@pytest.mark.asyncio
async def test_a_checklist_edit_bumps_the_version_so_completions_name_the_revision(db):
    from models.requests import ProgramTemplateItemInput, UpdateProgramTemplateRequest
    db.rows["pm_checklist_templates"][0].update(items={"checklist": [{"key": "a", "label": "Old", "requires_evidence": False}]})
    same = UpdateProgramTemplateRequest(items=[ProgramTemplateItemInput(key="a", label="Old")])
    await programs_router.update_program_template(TEMPLATE, same, GM)
    assert db.rows["pm_checklist_templates"][0]["version"] == 1
    changed = UpdateProgramTemplateRequest(items=[ProgramTemplateItemInput(key="a", label="Reworded")])
    await programs_router.update_program_template(TEMPLATE, changed, GM)
    assert db.rows["pm_checklist_templates"][0]["version"] == 2


# ── schedules: audit and the reschedule path ─────────────────────────────────

@pytest.mark.asyncio
async def test_deactivating_a_schedule_is_audited_and_other_properties_get_404(db):
    await assets_router.deactivate_pm_schedule(SCHEDULE, CHIEF)
    assert db.rows["pm_schedules"][0]["is_active"] is False
    assert db.rows["operational_audit_events"][-1]["action"] == "pm_schedule.deactivated"
    assert (await refused(assets_router.deactivate_pm_schedule(SCHEDULE, user("gm", tenant=OTHER)))).status_code == 404


# ── equipment identity and lifecycle ─────────────────────────────────────────

def asset_request(**extra) -> CreateAssetRequest:
    return CreateAssetRequest(name="Boiler", category_id=CATEGORY, **extra)


@pytest.mark.asyncio
async def test_tags_are_trimmed_and_unique_among_active_assets_ignoring_case(db):
    created = (await assets_router.create_asset(asset_request(asset_tag="  BL-9 "), CHIEF))["data"]
    assert created["asset_tag"] == "BL-9"
    for clash in ("bl-9", "CH-1", "ch-1"):
        error = await refused(assets_router.create_asset(asset_request(asset_tag=clash), CHIEF))
        assert error.status_code == 409 and error.detail["code"] == "asset_tag_in_use"


@pytest.mark.asyncio
async def test_a_retired_assets_tag_can_be_reused_and_an_edit_cannot_steal_one(db):
    db.rows["assets"][0]["is_active"] = False
    assert (await assets_router.create_asset(asset_request(asset_tag="CH-1"), CHIEF))["data"]["asset_tag"] == "CH-1"
    other = (await assets_router.create_asset(asset_request(asset_tag="X-1"), CHIEF))["data"]
    error = await refused(assets_router.update_asset(other["id"], UpdateAssetRequest(asset_tag="ch-1"), CHIEF))
    assert error.status_code == 409
    own = await assets_router.update_asset(other["id"], UpdateAssetRequest(asset_tag="X-1", notes="same tag, new note"), CHIEF)
    assert own["data"]["notes"] == "same tag, new note"


@pytest.mark.asyncio
async def test_rooms_and_categories_must_belong_to_the_callers_property(db):
    assert (await refused(assets_router.create_asset(asset_request(room_id=str(uuid.uuid4())), CHIEF))).status_code == 422
    assert (await refused(assets_router.create_asset(CreateAssetRequest(name="x", category_id=str(uuid.uuid4())), CHIEF))).status_code == 422
    ok = (await assets_router.create_asset(asset_request(room_id=ROOM), CHIEF))["data"]
    assert ok["room_id"] == ROOM
    assert (await refused(assets_router.update_asset(ok["id"], UpdateAssetRequest(room_id=str(uuid.uuid4())), CHIEF))).status_code == 422


@pytest.mark.asyncio
async def test_editing_another_properties_asset_or_nothing_is_a_clear_error(db):
    assert (await refused(assets_router.update_asset(ASSET, UpdateAssetRequest(notes="x"), user("gm", tenant=OTHER)))).status_code == 404
    assert (await refused(assets_router.update_asset(ASSET, UpdateAssetRequest(), CHIEF))).status_code == 400
    assert (await refused(assets_router.update_asset("nope", UpdateAssetRequest(notes="x"), CHIEF))).status_code == 404


@pytest.mark.asyncio
async def test_dates_are_checked_against_the_dates_already_on_record(db):
    db.rows["assets"][0]["installation_date"] = "2024-06-01"
    error = await refused(assets_router.update_asset(ASSET, UpdateAssetRequest(warranty_expires="2024-01-01"), CHIEF))
    assert error.status_code == 422
    with pytest.raises(ValueError):
        UpdateAssetRequest(installation_date="2024-06-01", warranty_expires="2024-01-01")
    with pytest.raises(ValueError):
        CreateAssetRequest(name="x", category_id=CATEGORY, asset_tag="has space")


@pytest.mark.asyncio
async def test_predicted_risk_is_not_editable_through_the_equipment_record(db):
    await assets_router.update_asset(ASSET, UpdateAssetRequest(notes="n", failure_risk_score=99), CHIEF)
    assert "failure_risk_score" not in db.rows["assets"][0]


@pytest.mark.asyncio
async def test_retiring_equipment_ends_its_schedules_keeps_its_history_and_is_audited(db):
    await complete(db, submission_id=str(uuid.uuid4()))
    await assets_router.update_asset(ASSET, UpdateAssetRequest(is_active=False), CHIEF)
    assert db.rows["pm_schedules"][0]["is_active"] is False
    assert len(db.rows["pm_completion_records"]) == 1
    event = db.rows["operational_audit_events"][-1]
    assert event["action"] == "asset.retired" and event["new_state"]["pm_schedules_deactivated"] == [SCHEDULE]
    assert (await assets_router.list_pm_schedules(ENGINEER))["data"] == []


@pytest.mark.asyncio
async def test_lookup_resolves_only_the_callers_own_active_equipment(db):
    found = (await assets_router.lookup_asset(asset_id=None, tag="CH-1", current_user=ENGINEER))["data"]
    assert found["id"] == ASSET
    assert (await refused(assets_router.lookup_asset(asset_id=None, tag="CH-1", current_user=user("gm", tenant=OTHER)))).status_code == 404
    assert (await refused(assets_router.lookup_asset(asset_id="not-a-uuid", tag=None, current_user=ENGINEER))).status_code == 404
    db.rows["assets"][0]["is_active"] = False
    retired = (await assets_router.lookup_asset(asset_id=ASSET, tag=None, current_user=ENGINEER))["data"]
    assert retired["id"] == ASSET and retired["is_active"] is False  # a retired label still resolves, flagged as retired
