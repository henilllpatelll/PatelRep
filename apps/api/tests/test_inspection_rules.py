"""Pure inspection rules: the shared conformance table, template fingerprint, and correction lifecycle."""

import json
from pathlib import Path

import pytest

from services.inspection_rules import (
    TOUCH_UP_MAX_ITEMS,
    RuleViolation,
    classify_failure,
    correction_task_fields,
    derive_correction_status,
    template_applies_to_room,
    template_fingerprint,
    validate_answers,
    validate_photo_links,
)

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "inspection_rules.json").read_text(encoding="utf-8"))


def _items(raw=None):
    return [{"allows_na": True, "requires_photo_on_fail": False, **i} for i in (FIXTURE["items"] if raw is None else raw)]


def _rows(answers):
    return [
        {"template_item_id": a[0], "result": a[1], "note": a[2] if len(a) > 2 else None, "severity": a[3] if len(a) > 3 else None}
        for a in answers
    ]


def test_touch_up_limit_matches_the_shared_table():
    assert TOUCH_UP_MAX_ITEMS == FIXTURE["touch_up_max_items"]


@pytest.mark.parametrize("case", FIXTURE["classify"], ids=lambda c: c["name"])
def test_classify_failure_conforms(case):
    assert classify_failure(case["severities"]) == case["expect"]


@pytest.mark.parametrize("case", FIXTURE["applicability"], ids=lambda c: c["name"])
def test_template_applicability_conforms(case):
    assert template_applies_to_room(case["template"], case["room_type_id"]) is case["expect"]


@pytest.mark.parametrize("case", FIXTURE["answers"], ids=lambda c: c["name"])
def test_answer_validation_conforms(case):
    kwargs = {"claimed_result": case["claimed"]}
    if "policy" in case:
        kwargs["required_item_na_policy"] = case["policy"]
    items = _items(case.get("items"))
    expect = case["expect"]
    if "error" in expect:
        with pytest.raises(RuleViolation) as caught:
            validate_answers(items, _rows(case["answers"]), **kwargs)
        assert caught.value.code == expect["error"]
        return
    outcome = validate_answers(items, _rows(case["answers"]), **kwargs)
    assert outcome.result == expect["result"]
    assert outcome.correction_kind == expect["kind"]
    assert sorted(outcome.failed_item_ids) == sorted(expect["failed"])
    if "answered" in expect:
        assert sorted(outcome.answers) == sorted(expect["answered"])


@pytest.mark.parametrize("case", FIXTURE["photos"], ids=lambda c: c["name"])
def test_photo_links_conform(case):
    args = (_items(), case["failed"], case["photo_items"], case["photo_count"])
    if "error" in case["expect"]:
        with pytest.raises(RuleViolation) as caught:
            validate_photo_links(*args)
        assert caught.value.code == case["expect"]["error"]
    else:
        validate_photo_links(*args)


def test_unanswered_required_items_are_listed_for_the_client():
    with pytest.raises(RuleViolation) as caught:
        validate_answers(_items(), _rows([["i1", "pass"]]), claimed_result="passed")
    assert set(caught.value.extra["missing_item_ids"]) == {"i2", "i4", "i5", "i6"}


# --- fingerprint -----------------------------------------------------------

def _tmpl():
    return {"id": "t1", "room_type_id": None, "is_default": True}


def test_fingerprint_is_stable_and_independent_of_input_order():
    # Order is defined by sort_order, so reversing rows that carry sort_order must not matter.
    ordered = [{**i, "sort_order": n} for n, i in enumerate(_items())]
    assert template_fingerprint(_tmpl(), ordered) == template_fingerprint(_tmpl(), list(reversed(ordered)))


@pytest.mark.parametrize(
    "change",
    [
        {"description": "Toilet sanitized"},
        {"section": "Bathroom"},
        {"is_required": False},
        {"requires_photo_on_fail": True},
        {"allows_na": False},
        {"sort_order": 99},
    ],
)
def test_editing_an_item_changes_the_fingerprint_even_with_the_same_template_id(change):
    items = [{"id": "a", "section": "Bed", "description": "Made", "is_required": True, "requires_photo_on_fail": False, "allows_na": True, "sort_order": 1}]
    edited = [{**items[0], **change}]
    assert template_fingerprint(_tmpl(), items) != template_fingerprint(_tmpl(), edited)


def test_replacing_items_changes_the_fingerprint():
    a = [{"id": "a", "section": "Bed", "description": "Made", "sort_order": 1}]
    b = [{"id": "b", "section": "Bed", "description": "Made", "sort_order": 1}]
    assert template_fingerprint(_tmpl(), a) != template_fingerprint(_tmpl(), b)


def test_a_different_template_has_a_different_fingerprint():
    items = [{"id": "a", "section": "Bed", "description": "Made", "sort_order": 1}]
    assert template_fingerprint({"id": "t1"}, items) != template_fingerprint({"id": "t2"}, items)


# --- correction lifecycle ---------------------------------------------------

FAILED = {"id": "insp-1", "overall_result": "failed", "completed_at": "2026-10-20T10:00:00+00:00"}


def _status(task=None, room=None, followups=()):
    return derive_correction_status(FAILED, task, room, followups)


def test_passed_and_conditional_inspections_have_no_correction():
    assert derive_correction_status({"id": "x", "overall_result": "passed"}, None, None, []) is None
    assert derive_correction_status({"id": "x", "overall_result": "conditional"}, None, None, []) is None


def test_failed_inspection_without_a_task_needs_repair():
    assert _status()["status"] == "correction_missing"


def test_task_without_owner_is_unassigned_and_with_owner_is_assigned_not_acknowledged():
    assert _status(task={"status": "open", "assigned_to": None})["status"] == "unassigned"
    assert _status(task={"status": "open", "assigned_to": "hk-1"})["status"] == "assigned"


def test_started_task_is_in_progress_and_escalation_is_reported():
    assert _status(task={"status": "in_progress", "assigned_to": "hk-1"})["status"] == "in_progress"
    assert _status(task={"status": "open", "assigned_to": "hk-1", "started_at": "2026-10-20T10:05:00+00:00"})["status"] == "in_progress"
    assert _status(task={"status": "escalated", "assigned_to": "hk-1"})["status"] == "escalated"


def test_completed_task_or_clean_room_means_resubmitted_awaiting_reinspection():
    assert _status(task={"status": "completed", "assigned_to": "hk-1"})["status"] == "resubmitted"
    assert _status(task={"status": "open", "assigned_to": "hk-1"}, room={"status": "CLEAN"})["status"] == "resubmitted"


def test_cancelled_task_is_not_a_resolution():
    assert _status(task={"status": "cancelled"})["status"] == "cancelled"


def test_a_linked_passing_reinspection_verifies_the_room():
    follow = [{"id": "insp-2", "overall_result": "passed", "completed_at": "2026-10-20T12:00:00+00:00", "reinspection_of": "insp-1"}]
    assert _status(task={"status": "completed"}, followups=follow) == {"status": "verified", "reinspection_id": "insp-2"}


def test_a_linked_failed_reinspection_supersedes_this_one():
    follow = [{"id": "insp-2", "overall_result": "failed", "completed_at": "2026-10-20T12:00:00+00:00", "reinspection_of": "insp-1"}]
    assert _status(task={"status": "completed"}, followups=follow) == {"status": "superseded", "reinspection_id": "insp-2"}


def test_historical_unlinked_later_inspection_still_resolves_by_time():
    follow = [{"id": "old-2", "overall_result": "passed", "completed_at": "2026-10-20T12:00:00+00:00", "reinspection_of": None}]
    assert _status(followups=follow)["status"] == "verified"


def test_an_inspection_linked_to_a_different_failure_does_not_verify_this_one():
    follow = [{"id": "insp-9", "overall_result": "passed", "completed_at": "2026-10-20T12:00:00+00:00", "reinspection_of": "other"}]
    assert _status(task={"status": "open", "assigned_to": "hk-1"}, followups=follow)["status"] == "assigned"


def test_only_the_latest_linked_reinspection_decides():
    follow = [
        {"id": "r1", "overall_result": "failed", "completed_at": "2026-10-20T12:00:00+00:00", "reinspection_of": "insp-1"},
        {"id": "r2", "overall_result": "passed", "completed_at": "2026-10-20T14:00:00+00:00", "reinspection_of": "insp-1"},
    ]
    assert _status(followups=follow)["reinspection_id"] == "r2"


# --- correction task wording ------------------------------------------------

def test_touch_up_and_reclean_tasks_differ_in_title_and_sla_and_list_every_failed_item():
    touch = correction_task_fields("touch_up", "204", ["Mirror streaked"], "Quick wipe")
    reclean = correction_task_fields("reclean", "204", ["Mirror streaked", "Bed not made"], None)
    assert touch["title"] == "Touch-up Room 204" and touch["sla_minutes"] == 30
    assert reclean["title"] == "Re-clean Room 204" and reclean["sla_minutes"] == 60
    assert "Quick wipe" in touch["description"] and "- Mirror streaked" in touch["description"]
    assert "- Bed not made" in reclean["description"]
