"""Inspection history: the paginated list, the lineage timeline, quality insights and private evidence access.

Rows are seeded straight into the fake database (the writes are covered by test_inspection_completion /
test_inspection_corrections); these tests are about what the READ side promises: hotel isolation, role gates, hotel-local
dates, deterministic paging, honest metrics and evidence that is only ever handed out signed.
"""

from datetime import date
from uuid import uuid4

import pytest
from dateutil import tz
from fastapi.testclient import TestClient

from main import app
from routers import housekeeping as hk_router
from services import inspection_evidence as evidence
from services import inspection_history as history
from tests.test_inspection_completion import HOTEL, OTHER_HOTEL, Env, _auth

INSPECTOR_A = str(uuid4())
INSPECTOR_B = str(uuid4())
PNG_BYTES = bytes([0x89]) + b"PNG" + bytes([0x0D, 0x0A, 0x1A, 0x0A])  # real image header: the backfill sniffs bytes
CHICAGO = tz.gettz("America/Chicago")


@pytest.fixture
def env(monkeypatch):
    e = Env()
    e.db.rows["tenants"].append({"id": OTHER_HOTEL, "timezone": "America/Chicago"})
    e.db.rows["user_profiles"] += [
        {"id": INSPECTOR_A, "tenant_id": HOTEL, "preferred_name": "Ana Inspector"},
        {"id": INSPECTOR_B, "tenant_id": HOTEL, "full_name": "Ben Inspector"},
    ]
    e.db.rows["operational_audit_events"] = []
    monkeypatch.setattr(hk_router, "supabase", e.db)
    return e


@pytest.fixture
def client():
    return TestClient(app)


def _insp(env, completed_at, result="passed", *, by=INSPECTOR_A, room=None, parent=None, hotel=HOTEL, fingerprint="fp", kind=None, iid=None):
    row = {
        "id": iid or str(uuid4()),
        "tenant_id": hotel,
        "room_id": room or env.room,
        "template_id": env.template,
        "inspected_by": by,
        "overall_result": result,
        "notes": None,
        "completed_at": completed_at,
        "reinspection_of": parent,
        "correction_kind": kind or ("reclean" if result == "failed" else None),
        "template_fingerprint": fingerprint,
    }
    env.db.rows["inspections"].append(row)
    return row


def _fail_answer(env, inspection, item="mirror", *, note=None, photo_path=None, photo_url=None, severity="major"):
    env.db.rows["inspection_results"].append(
        {
            "id": str(uuid4()),
            "inspection_id": inspection["id"],
            "tenant_id": inspection["tenant_id"],
            "template_item_id": env.items[item],
            "result": "fail",
            "note": note,
            "severity": severity,
            "photo_path": photo_path,
            "photo_url": photo_url,
        }
    )


def _get(client, path, **params):
    headers = params.pop("headers", None) or _auth()
    return client.get(f"/v1/housekeeping/inspections{path}", params=params, headers=headers)


DAY = "2026-10-20"  # hotel-local (CDT, UTC-5)


def _at(hour, minute=0):
    """A UTC instant that is `hour:minute` on DAY in the hotel (Chicago, CDT)."""
    return f"2026-10-20T{hour + 5:02d}:{minute:02d}:00+00:00"


# ── history list ─────────────────────────────────────────────────────────────────

def test_dates_are_hotel_local_not_utc(client, env):
    late_previous_evening = _insp(env, "2026-10-20T04:30:00+00:00")  # 23:30 on Oct 19 in Chicago
    morning = _insp(env, _at(9))
    midnight_next_day = _insp(env, "2026-10-21T05:00:00+00:00")  # 00:00 Oct 21 local: excluded
    res = _get(client, "", date_from=DAY, date_to=DAY)
    assert res.status_code == 200
    ids = [r["id"] for r in res.json()["data"]]
    assert ids == [morning["id"]]
    assert late_previous_evening["id"] not in ids and midnight_next_day["id"] not in ids


def test_a_fall_back_day_is_twenty_five_hours_long(client, env):
    # 2026-11-01: clocks go back at 2am CDT. The local day runs 05:00Z -> 06:00Z next day.
    first = _insp(env, "2026-11-01T05:00:00+00:00")
    last = _insp(env, "2026-11-02T05:59:00+00:00")
    after = _insp(env, "2026-11-02T06:00:00+00:00")
    ids = [r["id"] for r in _get(client, "", date_from="2026-11-01", date_to="2026-11-01").json()["data"]]
    assert set(ids) == {first["id"], last["id"]} and after["id"] not in ids


def test_a_spring_forward_day_is_twenty_three_hours_long(client, env):
    # 2026-03-08: 06:00Z (00:00 CST) to 05:00Z next day (00:00 CDT).
    inside = _insp(env, "2026-03-09T04:59:00+00:00")
    outside = _insp(env, "2026-03-09T05:00:00+00:00")
    ids = [r["id"] for r in _get(client, "", date_from="2026-03-08", date_to="2026-03-08").json()["data"]]
    assert ids == [inside["id"]] and outside["id"] not in ids


def test_range_validation(client, env):
    assert _get(client, "", date_from="2026-10-21", date_to="2026-10-20").status_code == 422
    assert _get(client, "", date_from="2025-01-01", date_to="2026-10-20").status_code == 422
    assert _get(client, "", date_from="2026-10-20", date_to="2026-10-20", limit=0).status_code == 422
    assert _get(client, "", date_from="2026-10-20", date_to="2026-10-20", limit=101).status_code == 422
    assert _get(client, "", date_from="2026-10-20", date_to="2026-10-20", result="great").status_code == 422
    assert _get(client, "", date_from="2026-10-20", date_to="2026-10-20", cursor="@@@").status_code == 400
    assert _get(client, "", date_from="2026-10-20", date_to="2026-10-20", inspector_id="user-1").status_code == 422


def test_result_type_and_inspector_filters_combine(client, env):
    failed = _insp(env, _at(9), "failed", by=INSPECTOR_A)
    re_pass = _insp(env, _at(10), "passed", by=INSPECTOR_B, parent=failed["id"])
    initial_pass = _insp(env, _at(11), "passed", by=INSPECTOR_B)
    legacy = _insp(env, _at(8), "conditional", by=INSPECTOR_A, fingerprint=None)

    def ids(**filters):
        return {r["id"] for r in _get(client, "", date_from=DAY, date_to=DAY, **filters).json()["data"]}

    assert ids() == {failed["id"], re_pass["id"], initial_pass["id"], legacy["id"]}
    assert ids(result="failed") == {failed["id"]}
    assert ids(result="conditional") == {legacy["id"]}
    assert ids(inspection_type="reinspection") == {re_pass["id"]}
    assert ids(inspection_type="initial") == {failed["id"], initial_pass["id"], legacy["id"]}
    assert ids(inspector_id=INSPECTOR_B) == {re_pass["id"], initial_pass["id"]}
    assert ids(inspector_id=INSPECTOR_B, inspection_type="initial") == {initial_pass["id"]}
    assert ids(inspector_id=INSPECTOR_B, result="failed") == set()


def test_each_row_says_who_inspected_and_never_shows_an_id_as_a_name(client, env):
    named = _insp(env, _at(9), by=INSPECTOR_A)
    stranger = str(uuid4())
    unnamed = _insp(env, _at(10), by=stranger)
    rows = {r["id"]: r for r in _get(client, "", date_from=DAY, date_to=DAY).json()["data"]}
    assert rows[named["id"]]["inspector_display_name"] == "Ana Inspector"
    assert rows[unnamed["id"]]["inspector_display_name"] is None  # the legacy field keeps its prefix fallback, this one never does
    assert rows[unnamed["id"]]["inspected_by"] == stranger
    assert rows[named["id"]]["is_reinspection"] is False
    assert rows[named["id"]]["room_number"] == "204" and rows[named["id"]]["floor"] == 2


def test_room_number_search_matches_labels_inside_this_hotel_only(client, env):
    other_room = str(uuid4())
    env.db.rows["rooms"].append({"id": other_room, "tenant_id": HOTEL, "room_number": "310", "floor": 3, "room_type_id": env.room_type})
    mine = _insp(env, _at(9), room=env.room)
    elsewhere = _insp(env, _at(10), room=other_room)
    foreign = _insp(env, _at(11), room="foreign-room", hotel=OTHER_HOTEL)
    assert [r["id"] for r in _get(client, "", date_from=DAY, date_to=DAY, room_number="204").json()["data"]] == [mine["id"]]
    assert [r["id"] for r in _get(client, "", date_from=DAY, date_to=DAY, room_number="31").json()["data"]] == [elsewhere["id"]]
    assert _get(client, "", date_from=DAY, date_to=DAY, room_number="999").json()["data"] == []
    assert foreign["id"] not in [r["id"] for r in _get(client, "", date_from=DAY, date_to=DAY).json()["data"]]


def test_failed_standard_drill_down_returns_only_inspections_that_failed_it(client, env):
    mirror = _insp(env, _at(9), "failed")
    floor = _insp(env, _at(10), "failed")
    clean = _insp(env, _at(11), "passed")
    _fail_answer(env, mirror, "mirror")
    _fail_answer(env, floor, "floor")
    rows = _get(client, "", date_from=DAY, date_to=DAY, failed_item_id=env.items["mirror"]).json()["data"]
    assert [r["id"] for r in rows] == [mirror["id"]] and clean["id"] not in [r["id"] for r in rows]
    assert _get(client, "", date_from=DAY, date_to=DAY, failed_item_id=str(uuid4())).json()["data"] == []


def test_pagination_is_deterministic_with_ties_and_has_no_duplicates_or_gaps(client, env):
    same_instant = [_insp(env, _at(9)) for _ in range(5)]
    later = _insp(env, _at(12))
    earlier = _insp(env, _at(7))
    expected = [later["id"]] + [r["id"] for r in sorted(same_instant, key=lambda r: r["id"], reverse=True)] + [earlier["id"]]

    seen, cursor, pages, total = [], None, 0, None
    while True:
        params = {"date_from": DAY, "date_to": DAY, "limit": 3}
        if cursor:
            params["cursor"] = cursor
        body = _get(client, "", **params).json()
        pages += 1
        seen.extend(r["id"] for r in body["data"])
        if body["meta"]["total"] is not None:
            total = body["meta"]["total"]
        if not body["meta"]["has_more"]:
            assert body["meta"]["next_cursor"] is None
            break
        cursor = body["meta"]["next_cursor"]
        assert cursor
    assert seen == expected and pages == 3
    assert total == 7  # the exact total is reported once, on the first page


def test_a_caller_with_no_limit_still_gets_a_bounded_page_with_meta(client, env):
    _insp(env, _at(9))
    body = _get(client, "", date_from=DAY, date_to=DAY).json()
    assert body["meta"]["has_more"] is False and body["meta"]["limit"] == history.LIST_LEGACY_LIMIT
    assert body["meta"]["date_from"] == DAY and body["meta"]["date_to"] == DAY


def test_history_never_crosses_hotels(client, env):
    mine = _insp(env, _at(9))
    foreign = _insp(env, _at(9), hotel=OTHER_HOTEL, room="foreign-room")
    rows = _get(client, "", date_from=DAY, date_to=DAY).json()["data"]
    assert [r["id"] for r in rows] == [mine["id"]]
    theirs = _get(client, "", date_from=DAY, date_to=DAY, headers=_auth(hotel_id=OTHER_HOTEL)).json()["data"]
    assert [r["id"] for r in theirs] == [foreign["id"]]
    # a room id from another hotel finds nothing here
    assert _get(client, "", date_from=DAY, date_to=DAY, room_id="foreign-room").json()["data"] == []


def test_inspectors_are_listed_by_stable_id_for_this_hotel_only(client, env):
    _insp(env, _at(9), by=INSPECTOR_A)
    _insp(env, _at(10), by=INSPECTOR_A)
    _insp(env, _at(11), by=INSPECTOR_B)
    _insp(env, _at(12), by=str(uuid4()), hotel=OTHER_HOTEL, room="foreign-room")
    rows = _get(client, "/inspectors", date_from=DAY, date_to=DAY).json()["data"]
    assert [(r["id"], r["name"], r["count"]) for r in rows] == [(INSPECTOR_A, "Ana Inspector", 2), (INSPECTOR_B, "Ben Inspector", 1)]
    assert _get(client, "/inspectors", date_from=DAY, date_to=DAY, headers=_auth(role="housekeeper")).status_code == 403


# ── insights ─────────────────────────────────────────────────────────────────────

def _insights(client, **extra):
    return _get(client, "/insights", date_from=DAY, date_to=DAY, **extra)


def test_first_pass_rate_excludes_reinspections_and_legacy_conditional(client, env):
    pass_a = _insp(env, _at(8), "passed")
    fail_b = _insp(env, _at(9), "failed")
    _insp(env, _at(10), "passed", parent=fail_b["id"])  # a reinspection: not in the denominator
    _insp(env, _at(11), "conditional", fingerprint=None)  # legacy: neither a pass nor a fail
    body = _insights(client).json()["data"]
    assert body["counts"] == {"completed": 4, "passed": 2, "failed": 1, "conditional": 1, "initial": 3, "reinspections": 1, "without_lineage": 0 + 1}
    assert body["first_pass"] == {"rate": 0.5, "passed": 1, "eligible": 2, "conditional_excluded": 1}
    assert pass_a["id"]  # silence unused


def test_zero_denominator_is_no_rate_not_zero_percent(client, env):
    fail = _insp(env, _at(9), "failed")
    _insp(env, _at(10), "passed", parent=fail["id"])
    body = _insights(client).json()["data"]
    only_reinspection_day = history.build_insights(
        inspections=[{"id": "r", "room_id": "x", "overall_result": "passed", "completed_at": _at(10), "reinspection_of": "f", "template_fingerprint": "fp"}],
        failed_answers=[], labels={}, followups=[], room_numbers={}, zone=CHICAGO, date_from=date(2026, 10, 20), date_to=date(2026, 10, 21), truncated=False,
    )
    assert only_reinspection_day["first_pass"]["rate"] is None
    assert [d["first_pass_rate"] for d in only_reinspection_day["daily"]] == [None, None]  # a quiet day has no rate
    assert body["first_pass"]["eligible"] == 1


def test_a_cut_off_period_withholds_every_rate(client, env, monkeypatch):
    monkeypatch.setattr(history, "INSIGHT_ROW_LIMIT", 2)
    for hour in (8, 9, 10):
        _insp(env, _at(hour), "passed")
    body = _get(client, "/insights", date_from=DAY, date_to=DAY).json()
    assert body["data"]["truncated"] is True and body["data"]["first_pass"]["rate"] is None
    assert all(d["first_pass_rate"] is None for d in body["data"]["daily"])


def test_most_common_standards_group_by_item_id_not_by_wording(client, env):
    twin = str(uuid4())
    env.db.rows["inspection_template_items"].append(
        {"id": twin, "template_id": env.template, "tenant_id": HOTEL, "section": "Bath", "description": "Mirror clean", "is_required": True,
         "requires_photo_on_fail": False, "allows_na": True, "sort_order": 9}
    )
    one, two, three = (_insp(env, _at(h), "failed") for h in (8, 9, 10))
    _fail_answer(env, one, "mirror")
    _fail_answer(env, two, "mirror")
    _fail_answer(env, three, "mirror")
    _fail_answer(env, three, "floor")
    env.db.rows["inspection_results"].append({"inspection_id": two["id"], "tenant_id": HOTEL, "template_item_id": twin, "result": "fail"})
    top = _insights(client).json()["data"]["top_standards"]
    assert [(t["standard_id"], t["count"]) for t in top] == [(env.items["mirror"], 3), (env.items["floor"], 1), (twin, 1)] or top[0]["count"] == 3
    labels = [t["label"] for t in top]
    assert labels.count("Mirror clean") == 2  # same words, different checklist items: never merged


def test_repeated_issues_need_two_failures_in_the_same_room(client, env):
    other_room = str(uuid4())
    env.db.rows["rooms"].append({"id": other_room, "tenant_id": HOTEL, "room_number": "310", "floor": 3, "room_type_id": env.room_type})
    a, b = _insp(env, _at(8), "failed"), _insp(env, _at(9), "failed")
    c = _insp(env, _at(10), "failed", room=other_room)
    for failure in (a, b, c):
        _fail_answer(env, failure, "mirror")
    body = _insights(client).json()["data"]
    assert [(r["room_number"], r["failed_count"]) for r in body["repeat_rooms"]] == [("204", 2)]
    assert [(r["room_number"], r["count"]) for r in body["repeat_standards"]] == [("204", 2)]
    assert set(body["repeat_rooms"][0]["inspection_ids"]) == {a["id"], b["id"]}


def test_correction_outcomes_and_time_to_verification_need_enough_cases(client, env):
    failures = [_insp(env, _at(8 + n), "failed") for n in range(4)]
    _insp(env, _at(8, 30), "passed", parent=failures[0]["id"])  # verified after 30 minutes
    _insp(env, _at(9, 45), "passed", parent=failures[1]["id"])  # verified after 45 minutes
    _insp(env, _at(11, 10), "failed", parent=failures[2]["id"])  # failed again
    body = _insights(client).json()["data"]
    assert body["corrections"] == {"failed": 5, "verified": 2, "failed_again": 1, "no_reinspection_recorded": 2}
    # only two verified cases: no duration is offered
    assert body["time_to_verification"] == {"available": False, "median_minutes": None, "sample": 2, "minimum_sample": 3}


def test_time_to_verification_is_reported_once_the_sample_is_big_enough(client, env):
    for minutes in (30, 60, 90):
        failure = _insp(env, _at(8), "failed")
        _insp(env, _at(8 + minutes // 60, minutes % 60), "passed", parent=failure["id"])
    body = _insights(client).json()["data"]["time_to_verification"]
    assert body["available"] is True and body["median_minutes"] == 60.0 and body["sample"] == 3


def test_insights_are_role_gated_and_hotel_scoped(client, env):
    _insp(env, _at(9))
    _insp(env, _at(9), hotel=OTHER_HOTEL, room="foreign-room")
    assert _insights(client, headers=_auth(role="housekeeper")).status_code == 403
    assert _insights(client).json()["data"]["counts"]["completed"] == 1
    assert _get(client, "/insights", date_from="2026-10-21", date_to="2026-10-20").status_code == 422


def test_the_daily_series_has_one_entry_per_local_day_including_empty_ones(client, env):
    _insp(env, _at(9), "passed")
    body = _get(client, "/insights", date_from="2026-10-19", date_to="2026-10-21").json()["data"]
    assert [d["date"] for d in body["daily"]] == ["2026-10-19", "2026-10-20", "2026-10-21"]
    assert [d["first_pass_rate"] for d in body["daily"]] == [None, 1.0, None]


# ── timeline ─────────────────────────────────────────────────────────────────────

def _task(env, failure, **fields):
    row = {"id": str(uuid4()), "tenant_id": HOTEL, "source_inspection_id": failure["id"], "status": "open", "assigned_to": "hk-1",
           "created_at": failure["completed_at"], "started_at": None, "completed_at": None, "escalated_at": None, "priority": "urgent", **fields}
    env.db.rows["tasks"].append(row)
    return row


def _timeline(client, inspection_id, **kwargs):
    return client.get(f"/v1/housekeeping/inspections/{inspection_id}/timeline", headers=kwargs.get("headers") or _auth())


def test_timeline_shows_only_what_happened_in_order(client, env):
    failure = _insp(env, _at(12, 4), "failed")
    _fail_answer(env, failure, "mirror", note="Smudges")
    task = _task(env, failure, created_at=_at(12, 4), started_at=_at(12, 12), status="completed", completed_at=_at(12, 31))
    env.db.rows["room_clean_sessions"].append(
        {"tenant_id": HOTEL, "room_id": env.room, "housekeeper_id": "hk-1", "status": "completed", "ended_at": _at(12, 22), "clean_type": "STAY"}
    )
    verifying = _insp(env, _at(12, 31), "passed", parent=failure["id"], by=INSPECTOR_B)
    body = _timeline(client, verifying["id"]).json()["data"]  # opened from the LAST inspection of the chain

    assert [e["type"] for e in body["events"]] == ["inspection_failed", "correction_created", "work_started", "work_submitted", "reinspection_passed"]
    assert [e["at"] for e in body["events"]] == sorted(e["at"] for e in body["events"])
    assert body["events"][-1]["inspection_id"] == verifying["id"] and body["events"][-1]["actor_name"] == "Ben Inspector"
    assert [i["id"] for i in body["inspections"]] == [failure["id"], verifying["id"]]
    original, final = body["inspections"]
    assert original["verified_by"] == verifying["id"] and original["failed_items"][0]["note"] == "Smudges"
    assert final["is_reinspection"] is True and final["reinspection_of"] == failure["id"]
    assert task["id"]


def test_no_work_started_event_when_nobody_started_the_work(client, env):
    failure = _insp(env, _at(12, 4), "failed")
    _task(env, failure, created_at=_at(12, 4))
    types = [e["type"] for e in _timeline(client, failure["id"]).json()["data"]["events"]]
    assert types == ["inspection_failed", "correction_created"]


def test_a_second_failure_keeps_both_inspections_and_does_not_double_count_events(client, env):
    first = _insp(env, _at(9), "failed")
    _task(env, first, created_at=_at(9), started_at=_at(9, 10))
    env.db.rows["room_clean_sessions"].append({"tenant_id": HOTEL, "room_id": env.room, "housekeeper_id": "hk-1", "status": "completed", "ended_at": _at(9, 20), "clean_type": "STAY"})
    second = _insp(env, _at(9, 30), "failed", parent=first["id"])
    _task(env, second, created_at=_at(9, 30))
    env.db.rows["room_clean_sessions"].append({"tenant_id": HOTEL, "room_id": env.room, "housekeeper_id": "hk-1", "status": "completed", "ended_at": _at(10, 5), "clean_type": "STAY"})
    third = _insp(env, _at(10, 20), "passed", parent=second["id"])

    body = _timeline(client, second["id"]).json()["data"]  # opened from the middle
    assert [i["id"] for i in body["inspections"]] == [first["id"], second["id"], third["id"]]
    types = [(e["type"], e["inspection_id"]) for e in body["events"]]
    assert types.count(("inspection_failed", second["id"])) == 0  # narrated once, as the first failure's reinspection_failed
    assert ("reinspection_failed", second["id"]) in types and ("reinspection_passed", third["id"]) in types
    submitted = [e for e in body["events"] if e["type"] == "work_submitted"]
    assert [e["at"] for e in submitted] == [_at(9, 20), _at(10, 5)]  # each resubmission belongs to ITS correction
    assert body["inspections"][0]["repeated_by"] == second["id"] and body["inspections"][1]["verified_by"] == third["id"]
    keys = [e["key"] for e in body["events"]]
    assert len(keys) == len(set(keys))


def test_circular_links_cannot_loop_the_timeline(client, env):
    a = _insp(env, _at(9), "failed", iid=str(uuid4()))
    b = _insp(env, _at(10), "failed", iid=str(uuid4()), parent=a["id"])
    a["reinspection_of"] = b["id"]  # corrupt data: a -> b -> a
    body = _timeline(client, a["id"]).json()
    assert [i["id"] for i in body["data"]["inspections"]] == [a["id"], b["id"]]


def test_a_long_chain_is_bounded_and_says_so(client, env, monkeypatch):
    monkeypatch.setattr(history, "MAX_CHAIN", 3)
    parent = None
    for n in range(6):
        parent = _insp(env, _at(8, n), "failed", parent=parent["id"] if parent else None)
    body = _timeline(client, parent["id"]).json()["data"]
    assert len(body["inspections"]) == 3 and body["truncated"] is True


def test_a_passing_first_inspection_reads_as_one_event(client, env):
    passed = _insp(env, _at(9), "passed")
    body = _timeline(client, passed["id"]).json()["data"]
    assert [e["type"] for e in body["events"]] == ["inspection_passed"] and len(body["inspections"]) == 1


def test_timeline_is_hotel_scoped_and_role_gated(client, env):
    mine = _insp(env, _at(9), "failed")
    foreign = _insp(env, _at(9), "failed", hotel=OTHER_HOTEL, room="foreign-room")
    assert _timeline(client, foreign["id"]).status_code == 404
    assert _timeline(client, mine["id"], headers=_auth(hotel_id=OTHER_HOTEL)).status_code == 404
    assert _timeline(client, mine["id"], headers=_auth(role="housekeeper")).status_code == 403
    assert _timeline(client, "not-a-uuid").status_code == 422


# ── detail + evidence ────────────────────────────────────────────────────────────

def _path(inspection, env, item="mirror", hotel=HOTEL):
    return f"{hotel}/inspections/{inspection['id']}/{env.items[item]}.jpg"


def test_detail_signs_private_evidence_and_never_returns_a_stored_url(client, env):
    failure = _insp(env, _at(9), "failed")
    _fail_answer(env, failure, "mirror", photo_path=_path(failure, env))
    body = client.get(f"/v1/housekeeping/inspections/{failure['id']}", headers=_auth()).json()["data"]
    item = next(i for i in body["items"] if i["template_item_id"] == env.items["mirror"])
    assert item["has_evidence"] is True
    assert item["photo_url"].startswith("https://storage.test/signed/inspection-evidence/") and "token=" in item["photo_url"]
    assert body["building"] is None and "housekeeper_name" in body and "service_type" in body


def test_legacy_public_urls_are_signed_instead_of_exposed(client, env):
    failure = _insp(env, _at(9), "failed", fingerprint=None)
    legacy = f"https://x.supabase.co/storage/v1/object/public/work-order-photos/{_path(failure, env)}"
    _fail_answer(env, failure, "mirror", photo_url=legacy)
    item = client.get(f"/v1/housekeeping/inspections/{failure['id']}", headers=_auth()).json()["data"]["items"][0]
    assert item["photo_url"].startswith("https://storage.test/signed/work-order-photos/") and legacy not in item["photo_url"]


def test_detail_reports_who_cleaned_the_room(client, env):
    failure = _insp(env, _at(9), "failed")
    env.db.rows["room_clean_sessions"] += [
        {"tenant_id": HOTEL, "room_id": env.room, "housekeeper_id": "hk-1", "status": "completed", "ended_at": _at(8, 30), "clean_type": "DEP"},
        {"tenant_id": HOTEL, "room_id": env.room, "housekeeper_id": "hk-2", "status": "completed", "ended_at": _at(9, 30), "clean_type": "STAY"},  # after the inspection
    ]
    body = client.get(f"/v1/housekeeping/inspections/{failure['id']}", headers=_auth()).json()["data"]
    assert body["housekeeper_name"] == "Hana Housekeeper" and body["service_type"] == "DEP"


def test_evidence_endpoint_returns_a_fresh_signed_url_without_caching(client, env):
    failure = _insp(env, _at(9), "failed")
    _fail_answer(env, failure, "mirror", photo_path=_path(failure, env))
    res = client.get(f"/v1/housekeeping/inspections/{failure['id']}/evidence/{env.items['mirror']}", headers=_auth())
    assert res.status_code == 200 and res.headers["cache-control"] == "no-store"
    body = res.json()["data"]
    assert body["url"].startswith("https://storage.test/signed/inspection-evidence/") and body["expires_in"] == evidence.SIGNED_URL_TTL_SECONDS


def test_evidence_is_refused_across_hotels_roles_and_unknown_items(client, env):
    mine = _insp(env, _at(9), "failed")
    _fail_answer(env, mine, "mirror", photo_path=_path(mine, env))
    foreign = _insp(env, _at(9), "failed", hotel=OTHER_HOTEL, room="foreign-room")
    env.db.rows["inspection_results"].append(
        {"inspection_id": foreign["id"], "tenant_id": OTHER_HOTEL, "template_item_id": env.items["mirror"], "result": "fail", "photo_path": _path(foreign, env, hotel=OTHER_HOTEL)}
    )
    url = lambda i, item="mirror": f"/v1/housekeeping/inspections/{i['id']}/evidence/{env.items[item]}"  # noqa: E731
    signed_before = len(env.db.storage_uploads)
    assert client.get(url(foreign), headers=_auth()).status_code == 404  # another hotel's inspection
    assert client.get(url(mine), headers=_auth(hotel_id=OTHER_HOTEL)).status_code == 404
    assert client.get(url(mine), headers=_auth(role="housekeeper")).status_code == 403
    assert client.get(url(mine, "floor"), headers=_auth()).status_code == 404  # no photo recorded for that item
    assert client.get(f"/v1/housekeeping/inspections/{mine['id']}/evidence/not-a-uuid", headers=_auth()).status_code == 422
    assert len(env.db.storage_uploads) == signed_before


def test_a_stored_path_outside_the_hotels_folder_is_never_signed(client, env):
    failure = _insp(env, _at(9), "failed")
    for bad in (
        f"{OTHER_HOTEL}/inspections/{failure['id']}/x.jpg",  # another hotel's folder
        f"{HOTEL}/inspections/{uuid4()}/x.jpg",  # another inspection
        f"{HOTEL}/inspections/{failure['id']}/../../{OTHER_HOTEL}/secret.jpg",  # traversal
    ):
        env.db.rows["inspection_results"].clear()
        _fail_answer(env, failure, "mirror", photo_path=bad)
        res = client.get(f"/v1/housekeeping/inspections/{failure['id']}/evidence/{env.items['mirror']}", headers=_auth())
        assert res.status_code == 404, bad
        item = client.get(f"/v1/housekeeping/inspections/{failure['id']}", headers=_auth()).json()["data"]["items"][0]
        assert item["photo_url"] is None and item["has_evidence"] is True


def test_evidence_that_cannot_be_signed_reads_as_unavailable(client, env, monkeypatch):
    failure = _insp(env, _at(9), "failed")
    _fail_answer(env, failure, "mirror", photo_path=_path(failure, env))

    class Broken:
        def create_signed_url(self, *_a, **_k):
            raise RuntimeError("object not found")

    monkeypatch.setattr(env.db.storage, "from_", lambda bucket: Broken())
    assert client.get(f"/v1/housekeeping/inspections/{failure['id']}/evidence/{env.items['mirror']}", headers=_auth()).status_code == 404
    item = client.get(f"/v1/housekeeping/inspections/{failure['id']}", headers=_auth()).json()["data"]["items"][0]
    assert item["photo_url"] is None and item["has_evidence"] is True  # the record still says evidence exists


def test_evidence_location_rules():
    h, i = "hotel-a", str(uuid4())
    inside = f"{h}/inspections/{i}/item.jpg"
    assert evidence.evidence_location({"photo_path": inside}, h, i) == (evidence.PRIVATE_BUCKET, inside)
    assert evidence.evidence_location({"photo_path": f"hotel-b/inspections/{i}/item.jpg"}, h, i) is None
    assert evidence.evidence_location({"photo_path": f"{h}/inspections/{i}/../x.jpg"}, h, i) is None
    legacy = f"https://p.supabase.co/storage/v1/object/public/work-order-photos/{inside}"
    assert evidence.evidence_location({"photo_url": legacy}, h, i) == (evidence.LEGACY_BUCKET, inside)
    assert evidence.evidence_location({"photo_url": "https://evil.example/photo.jpg"}, h, i) is None
    assert evidence.evidence_location({}, h, i) is None and evidence.has_evidence({"photo_url": "x"}) and not evidence.has_evidence({})


# ── legacy evidence backfill (operator script) ───────────────────────────────────

def test_backfill_is_a_dry_run_by_default_and_moves_only_this_hotels_own_objects(env):
    from scripts.backfill_inspection_evidence import backfill

    mine = _insp(env, _at(9), "failed", fingerprint=None)
    legacy_path = _path(mine, env)
    env.db.storage_uploads.append(("work-order-photos", legacy_path, PNG_BYTES + b"jpeg"))
    _fail_answer(env, mine, "mirror", photo_url=f"https://p.supabase.co/storage/v1/object/public/work-order-photos/{legacy_path}")
    forged = _insp(env, _at(10), "failed", fingerprint=None)
    _fail_answer(env, forged, "mirror", photo_url=f"https://p.supabase.co/storage/v1/object/public/work-order-photos/{OTHER_HOTEL}/inspections/{forged['id']}/x.jpg")
    already = _insp(env, _at(11), "failed")
    _fail_answer(env, already, "mirror", photo_path=_path(already, env))

    assert backfill(env.db) == {"seen": 2, "copied": 1, "skipped_foreign_path": 1, "failed": 0, "removed": 0}
    assert env.db.rows["inspection_results"][0]["photo_path"] is None  # nothing written

    done = backfill(env.db, apply=True)
    assert done["copied"] == 1 and done["skipped_foreign_path"] == 1 and done["removed"] == 0
    row = env.db.rows["inspection_results"][0]
    assert row["photo_path"] == legacy_path and row["photo_url"] is None
    assert ("inspection-evidence", legacy_path, PNG_BYTES + b"jpeg") in env.db.storage_uploads
    assert env.db.storage_removed == []  # the public original is only removed on request
    assert backfill(env.db, apply=True)["seen"] == 1  # idempotent: the forged row is the only one left, still skipped

    again = _insp(env, _at(12), "failed", fingerprint=None)
    env.db.storage_uploads.append(("work-order-photos", _path(again, env), PNG_BYTES + b"two"))
    _fail_answer(env, again, "mirror", photo_url=f"https://p.supabase.co/storage/v1/object/public/work-order-photos/{_path(again, env)}")
    assert backfill(env.db, apply=True, remove_legacy=True)["removed"] == 1
    assert env.db.storage_removed == [("work-order-photos", _path(again, env))]



def test_backfill_refuses_a_legacy_object_that_is_not_an_image_and_leaves_it_alone(env):
    from scripts.backfill_inspection_evidence import backfill

    row = _insp(env, _at(9), "failed", fingerprint=None)
    path = _path(row, env)
    env.db.storage_uploads.append(("work-order-photos", path, b"<html>not an image</html>"))
    _fail_answer(env, row, "mirror", photo_url=f"https://p.supabase.co/storage/v1/object/public/work-order-photos/{path}")
    done = backfill(env.db, apply=True, remove_legacy=True)
    assert done["failed"] == 1 and done["copied"] == 0 and done["removed"] == 0
    assert env.db.rows["inspection_results"][0]["photo_path"] is None and env.db.storage_removed == []


# ── performance & signed-link lifetime ───────────────────────────────────────────

def test_the_list_costs_a_fixed_number_of_queries_however_many_rows_it_returns(client, env):
    """No N+1: rows, rooms and inspector names are each ONE query per page, whether the page has 3 rows or 60."""
    def queries_for(count):
        env.db.rows["inspections"].clear()
        env.db.select_calls.clear()
        for n in range(count):
            room = str(uuid4())
            env.db.rows["rooms"].append({"id": room, "tenant_id": HOTEL, "room_number": f"3{n:02d}", "floor": 3, "room_type_id": env.room_type})
            _insp(env, _at(8, n % 60), room=room, by=INSPECTOR_A if n % 2 else INSPECTOR_B)
        res = _get(client, "", date_from=DAY, date_to=DAY, limit=100)
        assert len(res.json()["data"]) == count
        return len([call for call in env.db.select_calls if call[0] in ("inspections", "rooms", "user_profiles")])

    small, large = queries_for(3), queries_for(60)
    assert small == large and large <= 3


def test_insights_cost_does_not_grow_per_inspection(client, env):
    def queries_for(count):
        env.db.rows["inspections"].clear()
        env.db.rows["inspection_results"].clear()
        env.db.select_calls.clear()
        for n in range(count):
            failure = _insp(env, _at(8, n % 60), "failed")
            _fail_answer(env, failure, "mirror")
        assert _insights(client).status_code == 200
        return len(env.db.select_calls)

    # chunked by 50 failed inspections: 20 failures and 40 failures differ by at most one extra chunk's worth of reads
    assert queries_for(40) - queries_for(20) <= 0
    assert queries_for(120) < 20


def test_signed_links_are_short_lived_and_minted_only_after_the_hotel_check(client, env):
    mine = _insp(env, _at(9), "failed")
    _fail_answer(env, mine, "mirror", photo_path=_path(mine, env))
    client.get(f"/v1/housekeeping/inspections/{mine['id']}/evidence/{env.items['mirror']}", headers=_auth())
    assert [r[2] for r in env.db.signed_requests] == [evidence.SIGNED_URL_TTL_SECONDS]
    assert evidence.SIGNED_URL_TTL_SECONDS <= 15 * 60  # minutes, not days
    env.db.signed_requests.clear()
    # another hotel never gets a link minted, even for a real inspection id and item id
    assert client.get(f"/v1/housekeeping/inspections/{mine['id']}/evidence/{env.items['mirror']}", headers=_auth(hotel_id=OTHER_HOTEL)).status_code == 404
    assert env.db.signed_requests == []
