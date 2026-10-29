"""Team Scheduling Phase 7: draft revisions, the publish review, atomic publication and its history (FakeDB, handlers called directly)."""

import pytest
from fastapi import BackgroundTasks
from pydantic import ValidationError

from models.schedule_revisions import DiscardRequest, PublishRequest, StageChangeRequest
from routers import scheduling as sched
from routers import scheduling_revisions as revs

from .request_support import (
    CHIEF, D2, ENG, GM, HK1, OTHER_GM, S_EVE, S_MORN, SUP, U_HK1, U_HK2, DAY, D_HK, assignment, audit, scheduled,
)
from .test_scheduling_foundation import refused

KEYS = iter(range(10_000))


@pytest.fixture
def db(revisions_db):
    return revisions_db


def key() -> str:
    return f"client-key-{next(KEYS):06d}"


async def stage(actor=SUP, **kw):
    return await revs.stage_change(StageChangeRequest(**kw), actor)


async def stage_create(user=U_HK1, shift_id=S_MORN, day=DAY, actor=SUP, **kw):
    return await stage(actor, kind="create", client_key=key(), user_id=user, shift_id=shift_id, work_date=day, **kw)


def version(db, assignment_id):
    return assignment(db, assignment_id)["version"]


async def stage_update(db, assignment_id, actor=SUP, **fields):
    return await stage(actor, kind="update", assignment_id=assignment_id, expected_version=version(db, assignment_id), **fields)


async def stage_cancel(db, assignment_id, actor=SUP):
    return await stage(actor, kind="cancel", assignment_id=assignment_id, expected_version=version(db, assignment_id))


def draft(db, dept=D_HK):
    return next((r for r in db.rows["schedule_revisions"] if r["department_id"] == dept and r["status"] == "draft"), None)


def changes(db, revision_id):
    return [c for c in db.rows["schedule_revision_changes"] if c["revision_id"] == revision_id]


async def publish(db, revision_id, actor=SUP, expected=None, idem=None):
    rev = next(r for r in db.rows["schedule_revisions"] if r["id"] == revision_id)
    body = PublishRequest(expected_version=expected or rev["version"], idempotency_key=idem or key(), confirm=True)
    return await revs.publish_revision(revision_id, body, BackgroundTasks(), actor)


def events(db, revision_id, name=None):
    return [e["event"] for e in db.rows["schedule_revision_events"] if e["revision_id"] == revision_id and (name is None or e["event"] == name)]


# --- the draft never touches the live schedule ----------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_staging_a_new_shift_leaves_the_published_schedule_and_the_employee_view_untouched(db):
    result = await stage_create()
    assert result["data"]["action"] == "insert" and result["data"]["revision"]["status"] == "draft"
    assert db.rows["shift_assignments"] == []
    mine = await sched.get_my_schedule(date_from=DAY, date_to=DAY, current_user=HK1)
    assert mine["data"] == []                                             # the employee sees no draft
    assert events(db, draft(db)["id"]) == ["draft_created"]


@pytest.mark.asyncio
async def test_a_cancellation_in_the_draft_does_not_remove_the_live_shift(db):
    a = await scheduled()
    await stage_cancel(db, a)
    assert assignment(db, a)["publication_state"] == "published"
    assert (await sched.get_my_schedule(date_from=DAY, date_to=DAY, current_user=HK1))["data"][0]["id"] == a


@pytest.mark.asyncio
async def test_editing_the_same_shift_twice_keeps_one_coherent_result(db):
    a = await scheduled()
    await stage_update(db, a, start_time="08:00", end_time="16:00")
    await stage_update(db, a, end_time="17:00")
    rows = changes(db, draft(db)["id"])
    assert len(rows) == 1
    assert (rows[0]["proposed"]["start_time"], rows[0]["proposed"]["end_time"]) == ("08:00:00", "17:00:00")   # merged, not stacked
    assert rows[0]["base_version"] == 1 and rows[0]["before"]["start_time"] == "07:00:00"


@pytest.mark.asyncio
async def test_editing_a_shift_back_to_what_is_published_drops_the_change(db):
    a = await scheduled()
    await stage_update(db, a, start_time="08:00", end_time="16:00")
    result = await stage_update(db, a, start_time="07:00", end_time="15:00")
    assert result["data"]["action"] == "delete" and changes(db, draft(db)["id"]) == []


@pytest.mark.asyncio
async def test_a_noop_edit_creates_no_draft(db):
    a = await scheduled()
    result = await stage_update(db, a, start_time="07:00", end_time="15:00")
    assert result["data"]["action"] == "noop" and draft(db) is None


@pytest.mark.asyncio
async def test_cancelling_a_staged_new_shift_just_removes_it_and_a_retried_form_replaces_itself(db):
    first = await stage(SUP, kind="create", client_key="same-form-key", user_id=U_HK1, shift_id=S_MORN, work_date=DAY)
    again = await stage(SUP, kind="create", client_key="same-form-key", user_id=U_HK1, shift_id=S_MORN, work_date=DAY, notes="x")
    assert again["data"]["action"] == "replace" and len(again["data"]["revision"]["changes"]) == 1
    change_id = first["data"]["change"]["id"]
    removed = await stage(SUP, kind="cancel", change_id=change_id)
    assert removed["data"]["action"] == "delete" and changes(db, draft(db)["id"]) == []


@pytest.mark.asyncio
async def test_staging_against_a_stale_version_is_refused_with_the_current_value(db):
    a = await scheduled()
    with pytest.raises(Exception) as caught:
        await stage(SUP, kind="update", assignment_id=a, expected_version=99, start_time="08:00")
    assert refused(caught) == "version_conflict" and caught.value.extra["current"]["start_time"] == "07:00:00"


@pytest.mark.asyncio
async def test_a_past_or_attended_shift_cannot_be_staged(db):
    a = await scheduled()
    assignment(db, a)["clocked_in_at"] = "2030-01-08T13:05:00+00:00"
    with pytest.raises(Exception) as caught:
        await stage_cancel(db, a)
    assert refused(caught) == "has_attendance"
    with pytest.raises(Exception) as past:
        await stage_create(day=DAY.replace(year=2020))
    assert refused(past) == "historical_assignment_locked"


# --- authorization --------------------------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_a_department_scoped_manager_cannot_stage_another_departments_shift(db):
    with pytest.raises(Exception) as caught:
        await stage(ENG, kind="create", client_key=key(), user_id=U_HK1, shift_id=S_MORN, work_date=DAY)
    assert refused(caught) == "department_forbidden"
    ok = await stage(GM, kind="create", client_key=key(), user_id=U_HK1, shift_id=S_MORN, work_date=DAY)
    assert ok["data"]["revision"]["department_id"] == D_HK


@pytest.mark.asyncio
async def test_another_hotels_revision_is_a_plain_not_found_and_listings_are_scoped(db):
    await stage_create()
    revision_id = draft(db)["id"]
    for call in (revs.get_revision(revision_id, OTHER_GM), revs.review_revision(revision_id, OTHER_GM),
                 revs.revision_events(revision_id, OTHER_GM)):
        with pytest.raises(Exception) as caught:
            await call
        assert refused(caught) == "revision_not_found"
    assert (await revs.list_drafts(OTHER_GM))["data"] == []
    eng_view = (await revs.list_drafts(ENG))["data"]
    assert eng_view == []                                                  # the engineer manages ENG only; the draft is HK's
    with pytest.raises(Exception) as caught:
        await revs.get_revision(revision_id, ENG)
    assert refused(caught) == "department_forbidden"


@pytest.mark.asyncio
async def test_every_revision_endpoint_rejects_employees_and_chief_engineers_on_its_own(db):
    """Not just hidden buttons: each route carries its own role gate, so an employee token is refused server-side."""
    assert revs.router.routes
    for route in revs.router.routes:
        gates = [d.call for d in route.dependant.dependencies if d.call.__name__ == "check_role"]
        assert len(gates) == 1, route.path
        for outsider in (HK1, CHIEF):
            with pytest.raises(Exception) as caught:
                await gates[0](current_user=outsider)
            assert caught.value.status_code == 403, (route.path, outsider.role)
        assert (await gates[0](current_user=SUP)) is SUP


def test_the_request_body_rejects_unknown_fields():
    with pytest.raises(ValidationError):
        StageChangeRequest(kind="create", client_key="abcdefgh", tenant_id="x")
    with pytest.raises(ValidationError):
        PublishRequest(expected_version=1, idempotency_key="abcdefgh", confirm=False)


# --- the review -----------------------------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_review_reports_real_counts_impact_and_an_honest_forecast(db):
    a, b = await scheduled(user=U_HK1), await scheduled(user=U_HK2, shift_id=S_EVE)
    await stage_update(db, a, start_time="08:00", end_time="16:00", notes="private")
    await stage_cancel(db, b)
    await stage_create(user=U_HK2, shift_id=S_MORN, day=D2)
    rev = draft(db)
    review = (await revs.review_revision(rev["id"], SUP))["data"]
    assert review["summary"] == {"new": 1, "modified": 1, "cancelled": 1, "reassigned": 0, "employees_affected": 2, "total_changes": 3}
    assert review["can_publish"] and review["blocking"] == []
    assert review["date_range"] == {"from": DAY.isoformat(), "to": D2.isoformat()}
    ana = next(p for p in review["impact"] if p["user_id"] == U_HK1)["items"][0]
    assert (ana["kind"], ana["before"]["start_time"], ana["after"]["start_time"]) == ("changed", "07:00", "08:00")
    assert "notes" not in ana["after"]                                     # the employee-facing face carries no notes
    assert review["forecast"] == {"available": False, "reason": "future_demand_unknown"}
    assert review["department"] == "HK"


@pytest.mark.asyncio
async def test_review_blocks_an_overlap_and_still_lets_warnings_through(db):
    await scheduled(user=U_HK1, shift_id=S_MORN)
    await stage(SUP, kind="create", client_key=key(), user_id=U_HK1, shift_id=S_EVE, work_date=DAY, start_time="14:00")   # overlaps the morning shift
    review = (await revs.review_revision(draft(db)["id"], SUP))["data"]
    assert not review["can_publish"] and review["blocking"][0]["code"] == "overlapping_shift"


@pytest.mark.asyncio
async def test_review_flags_a_shift_that_changed_after_the_draft_was_made(db):
    a = await scheduled()
    await stage_update(db, a, start_time="08:00", end_time="16:00")
    await sched.update_shift_assignment(a, sched.UpdateShiftAssignmentRequest(expected_version=1, notes="someone else"), SUP)
    review = (await revs.review_revision(draft(db)["id"], SUP))["data"]
    stale = review["blocking"][0]
    assert stale["code"] == "stale_shift" and stale["current_version"] == 2      # the current published value is shown
    assert not review["can_publish"]


@pytest.mark.asyncio
async def test_review_blocks_approved_leave_and_open_call_outs(db):
    a = await scheduled(user=U_HK2)
    db.rows["absence_records"].append({"id": "abs-1", "tenant_id": assignment(db, a)["tenant_id"], "assignment_id": a, "status": "confirmed"})
    with pytest.raises(Exception) as caught:
        await stage_cancel(db, a)
    assert refused(caught) == "coverage_commitment"


# --- publishing -----------------------------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_publish_applies_the_whole_revision_and_queues_one_message_per_employee_atomically(db):
    a, b = await scheduled(user=U_HK1), await scheduled(user=U_HK2, shift_id=S_EVE)
    await stage_update(db, a, start_time="08:00", end_time="16:00")
    await stage_cancel(db, b)
    await stage_create(user=U_HK2, shift_id=S_MORN, day=D2)
    rev = draft(db)
    result = (await publish(db, rev["id"]))["data"]
    assert (result["created"], result["updated"], result["cancelled"], result["employees_affected"]) == (1, 1, 1, 2)
    assert assignment(db, a)["start_time"] == "08:00:00" and assignment(db, b)["publication_state"] == "cancelled"
    assert rev["status"] == "published" and rev["publication_key"]
    outbox = db.rows["schedule_notifications"]
    assert {n["user_id"] for n in outbox} == {U_HK1, U_HK2} and all(n["status"] == "queued" for n in outbox)   # queued, never "sent"
    assert audit(db, "shift_assignment", "cancelled") and audit(db, "shift_assignment", "updated") and audit(db, "shift_assignment", "created")
    assert events(db, rev["id"]) == ["draft_created", "draft_edited", "draft_edited", "publication_attempted", "publication_succeeded", "notification_queued"]


@pytest.mark.asyncio
async def test_a_repeated_publish_with_the_same_key_returns_the_committed_result_and_applies_nothing_twice(db):
    await stage_create()
    rev = draft(db)
    first = (await publish(db, rev["id"], idem="the-same-key"))["data"]
    shifts_after_first = len(db.rows["shift_assignments"])
    again = (await publish(db, rev["id"], expected=1, idem="the-same-key"))["data"]     # the client lost the first response
    assert again["replayed"] is True and again["publication_id"] == first["publication_id"]
    assert len(db.rows["shift_assignments"]) == shifts_after_first == 1
    assert len(db.rows["schedule_notifications"]) == 1


@pytest.mark.asyncio
async def test_a_second_supervisor_publishing_the_same_draft_is_refused_not_applied_again(db):
    await stage_create()
    rev = draft(db)
    await publish(db, rev["id"], idem="first-supervisor")
    with pytest.raises(Exception) as caught:
        await publish(db, rev["id"], actor=GM, expected=1, idem="second-supervisor")
    assert refused(caught) == "already_published" and len(db.rows["shift_assignments"]) == 1
    assert "publication_rejected" in events(db, rev["id"])


@pytest.mark.asyncio
async def test_publishing_a_blocked_draft_is_refused_before_anything_is_written(db):
    await scheduled(user=U_HK1, shift_id=S_MORN)
    await stage(SUP, kind="create", client_key=key(), user_id=U_HK1, shift_id=S_EVE, work_date=DAY, start_time="14:00")
    calls = db.publish_calls
    with pytest.raises(Exception) as caught:
        await publish(db, draft(db)["id"])
    assert refused(caught) == "publish_blocked" and db.publish_calls == calls
    assert caught.value.extra["blocking"][0]["code"] == "overlapping_shift" and db.rows["schedule_notifications"] == []


@pytest.mark.asyncio
async def test_a_draft_edited_after_review_cannot_be_published_on_the_old_review(db):
    await stage_create()
    rev = draft(db)
    reviewed = rev["version"]
    await stage_create(user=U_HK2)                                         # a second supervisor adds a change
    with pytest.raises(Exception) as caught:
        await publish(db, rev["id"], expected=reviewed)
    assert refused(caught) == "revision_changed" and db.rows["shift_assignments"] == []


@pytest.mark.asyncio
async def test_two_supervisors_racing_a_shift_the_second_publication_sees_the_stale_shift(db):
    a = await scheduled()
    await stage_update(db, a, start_time="08:00", end_time="16:00")
    rev = draft(db)

    def other_supervisor_edits_in_between():
        assignment(db, a)["version"] += 1                                 # lands after the API's review, before the database lock

    db.publish_gate = other_supervisor_edits_in_between
    with pytest.raises(Exception) as caught:
        await publish(db, rev["id"])
    assert refused(caught) == "stale_shift" and caught.value.extra["change_id"] == changes(db, rev["id"])[0]["id"]
    assert assignment(db, a)["start_time"] == "07:00:00" and rev["status"] == "draft"
    assert db.rows["schedule_notifications"] == [] and "publication_succeeded" not in events(db, rev["id"])


@pytest.mark.asyncio
async def test_a_failure_halfway_leaves_no_partial_schedule_and_no_notifications(db):
    a = await scheduled(user=U_HK1)
    await stage_update(db, a, start_time="08:00", end_time="16:00")
    await stage_create(user=U_HK2, shift_id=S_MORN, day=D2)
    rev = draft(db)
    db.rows["time_off_requests"].append({"id": "to1", "tenant_id": assignment(db, a)["tenant_id"], "user_id": U_HK2, "status": "approved",
                                         "starts_at": "2030-01-09T00:00:00+00:00", "ends_at": "2030-01-10T00:00:00+00:00"})
    # The review already notices the leave; remove that knowledge to prove the database function itself rolls back.
    real_review = revs.compute_review
    revs.compute_review = lambda *args, **kw: type("R", (), {"blocking": []})()
    try:
        with pytest.raises(Exception) as caught:
            await publish(db, rev["id"])
    finally:
        revs.compute_review = real_review
    assert refused(caught) == "approved_time_off"
    assert assignment(db, a)["start_time"] == "07:00:00" and len(db.rows["shift_assignments"]) == 1
    assert rev["status"] == "draft" and db.rows["schedule_notifications"] == []


@pytest.mark.asyncio
async def test_a_discarded_draft_can_never_be_published_and_notifies_nobody(db):
    await stage_create()
    rev = draft(db)
    await revs.discard_revision(rev["id"], DiscardRequest(expected_version=rev["version"]), SUP)
    assert rev["status"] == "discarded" and "draft_discarded" in events(db, rev["id"])
    with pytest.raises(Exception) as caught:
        await publish(db, rev["id"], expected=rev["version"])
    assert refused(caught) == "revision_closed" and db.rows["schedule_notifications"] == [] and db.rows["shift_assignments"] == []
    await stage_create()                                                   # a fresh draft can be opened afterwards
    assert draft(db)["id"] != rev["id"]


@pytest.mark.asyncio
async def test_historical_revisions_are_immutable_through_the_api(db):
    await stage_create()
    rev = draft(db)
    await publish(db, rev["id"])
    with pytest.raises(Exception) as caught:
        await revs.discard_revision(rev["id"], DiscardRequest(expected_version=rev["version"]), SUP)
    assert refused(caught) == "revision_closed"
    with pytest.raises(Exception) as late:
        await revs.remove_change(rev["id"], changes(db, rev["id"])[0]["id"], SUP)
    assert refused(late) == "revision_closed"


# --- history, corrections, audit ------------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_history_lists_publications_with_the_publisher_and_counts_within_scope(db):
    await stage_create()
    rev = draft(db)
    await publish(db, rev["id"])
    rows = (await revs.list_history(status=None, limit=20, before=None, current_user=SUP))["data"]
    assert [r["id"] for r in rows] == [rev["id"]] and rows[0]["published_by_name"] == "Sam Wu" and rows[0]["result"]["created"] == 1
    assert (await revs.list_history(status=None, limit=20, before=None, current_user=ENG))["data"] == []
    detail = (await revs.get_revision(rev["id"], SUP))["data"]
    assert detail["changes"][0]["kind"] == "create"
    trail = [e["event"] for e in (await revs.revision_events(rev["id"], SUP))["data"]]
    assert "publication_succeeded" in trail


@pytest.mark.asyncio
async def test_a_published_mistake_is_fixed_by_a_corrective_revision_that_supersedes_it(db):
    await stage_create()
    first = draft(db)
    await publish(db, first["id"])
    corrective = (await revs.start_correction(first["id"], SUP))["data"]
    assert corrective["status"] == "draft" and corrective["corrects_revision_id"] == first["id"]
    with pytest.raises(Exception) as caught:
        await revs.start_correction(first["id"], SUP)                     # one open draft per department
    assert refused(caught) == "draft_exists"
    placed = next(a for a in db.rows["shift_assignments"])
    await stage_cancel(db, placed["id"])                                    # built from TODAY's schedule, not an old snapshot
    await publish(db, corrective["id"])
    assert first["status"] == "superseded" and assignment(db, placed["id"])["publication_state"] == "cancelled"
    assert "corrective_published" in events(db, corrective["id"])


# --- notification status --------------------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_notification_status_never_equates_queued_with_delivered(db):
    await stage_create()
    rev = draft(db)
    await publish(db, rev["id"])
    queued = (await revs.notification_status(rev["id"], SUP))["data"]
    assert queued["state"] == "processing" and queued["by_status"]["queued"] == 1 and queued["in_app_available"] == 0
    assert queued["delivery_confirmation"] == "not_supported" and queued["email"] == "not_used"
