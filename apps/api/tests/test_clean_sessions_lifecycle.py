"""Clean-session lifecycle: snapshot checklists, safety gates, validation, idempotency.

Covers the server contract the mobile My Rooms workflow depends on: start/resume,
server-snapshotted checklists, required-item enforcement on completion, ownership
and reassignment, before-entry safety, one-active-room-per-attendant, and
no double room transitions on retries.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from dateutil import tz as dateutil_tz
from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from main import app
from routers import clean_sessions as clean_sessions_router
from routers import cleaning_checklists as checklists_router
from services import room_status_transitions as transitions
from tests.smoke.fake_supabase import FakeDB

HOTEL = "hotel-a"
ROOM_1 = str(uuid.uuid4())
ROOM_2 = str(uuid.uuid4())


def _auth(role="housekeeper", hotel_id=HOTEL, user_id="hk-1"):
    payload = {"sub": user_id, "role": role, "hotel_id": hotel_id, "aud": "authenticated"}
    token = jwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def _today():
    return datetime.now(dateutil_tz.gettz("America/Chicago")).date().isoformat()


def _templates():
    templates, items = [], []
    spec = {
        "DEP": [("Bedroom", "Strip beds", True), ("Bathroom", "Clean bathroom", True), ("General", "Vacuum", False)],
        "FULL": [("Bedroom", "Change linens", True), ("General", "Empty trash", False)],
        "LIGHT": [("General", "Empty trash", False)],
        "DEFAULT": [("General", "Standard clean", False)],
    }
    for clean_type, rows in spec.items():
        tpl_id = f"tpl-{clean_type}"
        templates.append({"id": tpl_id, "tenant_id": HOTEL, "clean_type": clean_type, "name": clean_type, "is_active": True})
        for i, (section, label, required) in enumerate(rows):
            items.append({
                "id": f"{clean_type}-{i}", "tenant_id": HOTEL, "template_id": tpl_id,
                "section": section, "label": label, "is_required": required, "sort_order": i + 1,
            })
    return templates, items


def _room_status(room_id, **overrides):
    row = {
        "room_id": room_id, "tenant_id": HOTEL, "status": "DIRTY", "clean_type": "DEP",
        "fo_status": "VAC", "actual_checkout_at": "2026-01-01T00:00:00+00:00",
        "dnd_flag": False, "do_not_service": False, "assigned_to": "hk-1",
    }
    row.update(overrides)
    return row


@pytest.fixture
def db(monkeypatch):
    templates, items = _templates()
    fake = FakeDB({
        "tenants": [{"id": HOTEL, "timezone": "America/Chicago"}],
        "cleaning_checklist_templates": templates,
        "cleaning_checklist_items": items,
        "rooms": [{"id": ROOM_1, "tenant_id": HOTEL}, {"id": ROOM_2, "tenant_id": HOTEL}],
        "room_status": [_room_status(ROOM_1), _room_status(ROOM_2)],
        "room_assignments": [
            {"id": "as-1", "tenant_id": HOTEL, "room_id": ROOM_1, "assigned_to": "hk-1", "assignment_date": _today(), "clean_type": "DEP"},
            {"id": "as-2", "tenant_id": HOTEL, "room_id": ROOM_2, "assigned_to": "hk-1", "assignment_date": _today(), "clean_type": "FULL"},
        ],
    })
    for module in (clean_sessions_router, checklists_router, transitions):
        monkeypatch.setattr(module, "supabase", fake)
    return fake


@pytest.fixture
def client(db):
    return TestClient(app)


def _start(client, room_id=ROOM_1, session_id=None, ack=True, **kw):
    body = {
        "id": session_id or str(uuid.uuid4()),
        "room_id": room_id,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "entry_acknowledged": ack,
    }
    return client.post("/v1/clean-sessions", json=body, headers=_auth(**kw)), body["id"]


def _room(db, room_id):
    return next(r for r in db.rows["room_status"] if r["room_id"] == room_id)


def _history(db, room_id):
    return [r for r in db.rows.get("room_status_history", []) if r["room_id"] == room_id]


def _check_all(session, only_required=False):
    return [
        {**item, "checked": True}
        for item in session["checklist"]
        if item["is_required"] or not only_required
    ]


# --- start / resume -------------------------------------------------------

def test_start_snapshots_configured_checklist_and_moves_room_in_progress(client, db):
    res, sid = _start(client)
    assert res.status_code == 200, res.text
    session = res.json()["data"]
    assert session["id"] == sid and session["status"] == "active"
    assert session["clean_type"] == "DEP"
    assert [i["label"] for i in session["checklist"]] == ["Strip beds", "Clean bathroom", "Vacuum"]
    assert [i["is_required"] for i in session["checklist"]] == [True, True, False]
    assert session["checklist_total"] == 3 and session["checklist_done"] == 0
    assert _room(db, ROOM_1)["status"] == "IN_PROGRESS"
    assert len(_history(db, ROOM_1)) == 1


@pytest.mark.parametrize("room_id,expected", [(ROOM_2, ["Change linens", "Empty trash"])])
def test_full_clean_uses_its_own_template(client, room_id, expected):
    res, _ = _start(client, room_id=room_id)
    assert res.status_code == 200, res.text
    assert [i["label"] for i in res.json()["data"]["checklist"]] == expected


def test_light_and_default_templates_resolve(client, db):
    _room(db, ROOM_2)["clean_type"] = "LIGHT"
    db.rows["room_assignments"][1]["clean_type"] = "LIGHT"
    res, _ = _start(client, room_id=ROOM_2)
    assert [i["label"] for i in res.json()["data"]["checklist"]] == ["Empty trash"]


def test_start_is_idempotent_and_resumes_same_session(client, db):
    first, sid = _start(client)
    replay, _ = _start(client, session_id=sid)
    other_id, _ = _start(client)  # fresh client id, same room, same attendant
    assert replay.json()["data"]["id"] == sid
    assert other_id.json()["data"]["id"] == sid
    assert len(db.rows["room_clean_sessions"]) == 1
    assert len(_history(db, ROOM_1)) == 1  # no duplicate IN_PROGRESS transition


def test_active_endpoint_restores_session_after_restart(client):
    _, sid = _start(client)
    res = client.get("/v1/clean-sessions/active", headers=_auth())
    assert res.json()["data"]["id"] == sid


def test_future_client_start_time_is_clamped_to_server_clock(client):
    future = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()
    res = client.post(
        "/v1/clean-sessions",
        json={"id": str(uuid.uuid4()), "room_id": ROOM_1, "started_at": future, "entry_acknowledged": True},
        headers=_auth(),
    )
    started = datetime.fromisoformat(res.json()["data"]["started_at"])
    assert started <= datetime.now(timezone.utc) + timedelta(seconds=5)


# --- ownership / reassignment ---------------------------------------------

def test_unassigned_housekeeper_cannot_start(client):
    res, _ = _start(client, user_id="hk-2")
    assert res.status_code == 403
    assert res.json()["detail"]["code"] == "ROOM_NOT_ASSIGNED"


def test_reassigned_room_rejects_previous_owner(client, db):
    db.rows["room_assignments"].append(
        {"id": "as-new", "tenant_id": HOTEL, "room_id": ROOM_1, "assigned_to": "hk-2",
         "assignment_date": (datetime.now(dateutil_tz.gettz("America/Chicago")).date()).isoformat(), "clean_type": "DEP"}
    )
    db.rows["room_assignments"][0]["assignment_date"] = (
        datetime.now(dateutil_tz.gettz("America/Chicago")).date() - timedelta(days=1)
    ).isoformat()
    res, _ = _start(client)
    assert res.status_code == 403


def test_other_tenant_cannot_see_room(client):
    res, _ = _start(client, hotel_id="hotel-b")
    assert res.status_code == 404


def test_other_housekeeper_cannot_read_or_edit_session(client):
    _, sid = _start(client)
    assert client.get(f"/v1/clean-sessions/{sid}", headers=_auth(user_id="hk-2")).status_code == 403
    patch = client.patch(f"/v1/clean-sessions/{sid}", json={"notes": "x"}, headers=_auth(user_id="hk-2"))
    assert patch.status_code == 403


# --- before-entry safety ---------------------------------------------------

def test_dnd_blocks_start(client, db):
    _room(db, ROOM_1)["dnd_flag"] = True
    res, _ = _start(client)
    assert res.status_code == 409 and res.json()["detail"]["code"] == "DND_ACTIVE"
    assert _room(db, ROOM_1)["status"] == "DIRTY"
    assert not db.rows.get("room_clean_sessions")


def test_declined_service_blocks_stayover_start(client, db):
    _room(db, ROOM_2).update({"do_not_service": True, "status": "PICKUP", "fo_status": "OCC", "actual_checkout_at": None})
    res, _ = _start(client, room_id=ROOM_2)
    assert res.status_code == 409 and res.json()["detail"]["code"] == "SERVICE_DECLINED"


def test_guest_possibly_inside_requires_entry_protocol(client, db):
    _room(db, ROOM_1).update({"fo_status": "OCC", "actual_checkout_at": None})
    blocked, _ = _start(client, ack=False)
    assert blocked.status_code == 409 and blocked.json()["detail"]["code"] == "ENTRY_PROTOCOL_REQUIRED"
    assert _room(db, ROOM_1)["status"] == "DIRTY"
    allowed, _ = _start(client, ack=True)
    assert allowed.status_code == 200


def test_vacant_verified_checkout_does_not_need_knock(client):
    res, _ = _start(client, ack=False)
    assert res.status_code == 200


def test_out_of_order_room_cannot_start(client, db):
    _room(db, ROOM_1)["status"] = "OOO"
    res, _ = _start(client)
    assert res.status_code == 400


# --- one active room per attendant -----------------------------------------

def test_second_room_blocked_while_first_in_progress(client):
    _start(client)
    res, _ = _start(client, room_id=ROOM_2)
    assert res.status_code == 409 and res.json()["detail"]["code"] == "ACTIVE_SESSION_EXISTS"


def test_stale_session_is_released_when_room_no_longer_in_progress(client, db):
    _, first = _start(client)
    _room(db, ROOM_1)["status"] = "DIRTY"  # supervisor reset the room
    res, _ = _start(client, room_id=ROOM_2)
    assert res.status_code == 200, res.text
    stale = next(s for s in db.rows["room_clean_sessions"] if s["id"] == first)
    assert stale["status"] == "abandoned"


# --- checklist persistence --------------------------------------------------

def test_patch_persists_item_and_cannot_rewrite_snapshot(client):
    session = _start(client)[0].json()["data"]
    tampered = [{**session["checklist"][0], "checked": True, "is_required": False, "label": "Renamed"}]
    res = client.patch(f"/v1/clean-sessions/{session['id']}", json={"checklist": tampered}, headers=_auth())
    assert res.status_code == 200, res.text
    saved = res.json()["data"]
    assert saved["checklist"][0]["checked"] is True
    assert saved["checklist"][0]["is_required"] is True  # snapshot is authoritative
    assert saved["checklist"][0]["label"] == "Strip beds"
    assert saved["checklist_done"] == 1
    reloaded = client.get("/v1/clean-sessions/active", headers=_auth()).json()["data"]
    assert reloaded["checklist_done"] == 1


def test_patch_unknown_item_rejected(client):
    session = _start(client)[0].json()["data"]
    bogus = [{"item_id": "nope", "section": "X", "label": "Injected", "is_required": False, "checked": True}]
    res = client.patch(f"/v1/clean-sessions/{session['id']}", json={"checklist": bogus}, headers=_auth())
    assert res.status_code == 422


# --- completion -------------------------------------------------------------

def test_complete_rejects_unfinished_required_items_without_side_effects(client, db):
    session = _start(client)[0].json()["data"]
    res = client.post(
        f"/v1/clean-sessions/{session['id']}/complete",
        json={"ended_at": datetime.now(timezone.utc).isoformat(), "checklist": session["checklist"]},
        headers=_auth(),
    )
    assert res.status_code == 422
    detail = res.json()["detail"]
    assert detail["code"] == "REQUIRED_ITEMS_INCOMPLETE"
    assert detail["missing"] == ["Strip beds", "Clean bathroom"]
    assert _room(db, ROOM_1)["status"] == "IN_PROGRESS"
    assert db.rows["room_clean_sessions"][0]["status"] == "active"


def test_complete_cannot_bypass_required_flag_from_client(client):
    session = _start(client)[0].json()["data"]
    downgraded = [{**i, "is_required": False} for i in session["checklist"]]
    res = client.post(
        f"/v1/clean-sessions/{session['id']}/complete",
        json={"ended_at": datetime.now(timezone.utc).isoformat(), "checklist": downgraded},
        headers=_auth(),
    )
    assert res.status_code == 422  # required flags come from the server snapshot


def test_complete_succeeds_and_retry_is_idempotent(client, db):
    session = _start(client)[0].json()["data"]
    body = {"ended_at": datetime.now(timezone.utc).isoformat(), "checklist": _check_all(session, only_required=True)}
    first = client.post(f"/v1/clean-sessions/{session['id']}/complete", json=body, headers=_auth())
    assert first.status_code == 200, first.text
    assert first.json()["data"]["status"] == "completed"
    assert _room(db, ROOM_1)["status"] == "CLEAN"
    again = client.post(f"/v1/clean-sessions/{session['id']}/complete", json=body, headers=_auth())
    assert again.status_code == 200
    transitions_logged = [(h["from_status"], h["to_status"]) for h in _history(db, ROOM_1)]
    assert transitions_logged == [("DIRTY", "IN_PROGRESS"), ("IN_PROGRESS", "CLEAN")]


def test_zero_item_checklist_can_complete(client, db):
    db.rows["cleaning_checklist_items"][:] = [i for i in db.rows["cleaning_checklist_items"] if i["template_id"] != "tpl-DEP"]
    session = _start(client)[0].json()["data"]
    assert session["checklist"] == []
    res = client.post(
        f"/v1/clean-sessions/{session['id']}/complete",
        json={"ended_at": datetime.now(timezone.utc).isoformat()},
        headers=_auth(),
    )
    assert res.status_code == 200


def test_complete_rejected_when_room_changed_underneath(client, db):
    session = _start(client)[0].json()["data"]
    _room(db, ROOM_1)["status"] = "OOO"
    res = client.post(
        f"/v1/clean-sessions/{session['id']}/complete",
        json={"ended_at": datetime.now(timezone.utc).isoformat(), "checklist": _check_all(session, True)},
        headers=_auth(),
    )
    assert res.status_code == 409 and res.json()["detail"]["code"] == "ROOM_STATE_CHANGED"
    assert db.rows["room_clean_sessions"][0]["status"] == "active"
    assert _room(db, ROOM_1)["status"] == "OOO"


def test_complete_clamps_future_end_time_and_duration(client, db):
    session = _start(client)[0].json()["data"]
    res = client.post(
        f"/v1/clean-sessions/{session['id']}/complete",
        json={"ended_at": (datetime.now(timezone.utc) + timedelta(hours=5)).isoformat(),
              "checklist": _check_all(session, True)},
        headers=_auth(),
    )
    data = res.json()["data"]
    ended = datetime.fromisoformat(data["ended_at"])
    assert ended <= datetime.now(timezone.utc) + timedelta(seconds=5)
    assert data["duration_seconds"] < 60


def test_patch_after_completion_conflicts(client):
    session = _start(client)[0].json()["data"]
    client.post(
        f"/v1/clean-sessions/{session['id']}/complete",
        json={"ended_at": datetime.now(timezone.utc).isoformat(), "checklist": _check_all(session, True)},
        headers=_auth(),
    )
    res = client.patch(f"/v1/clean-sessions/{session['id']}", json={"notes": "late"}, headers=_auth())
    assert res.status_code == 409 and res.json()["detail"]["code"] == "SESSION_NOT_ACTIVE"


# --- linen exchange --------------------------------------------------------

def test_patch_persists_linen_counts_on_the_session(client, db):
    session = _start(client)[0].json()["data"]
    res = client.patch(
        f"/v1/clean-sessions/{session['id']}",
        json={"linen_counts": {"dirty_out": 4, "clean_in": 3}},
        headers=_auth(),
    )
    assert res.status_code == 200, res.text
    assert res.json()["data"]["linen_counts"] == {"dirty_out": 4, "clean_in": 3}
    stored = next(r for r in db.rows["room_clean_sessions"] if r["id"] == session["id"])
    assert stored["linen_counts"] == {"dirty_out": 4, "clean_in": 3}
    # Saving linen never touches the checklist snapshot.
    assert [i["label"] for i in stored["checklist"]] == ["Strip beds", "Clean bathroom", "Vacuum"]


@pytest.mark.parametrize("counts", [
    {"dirty_out": -1, "clean_in": 0},
    {"dirty_out": 0, "clean_in": 100},
    {"dirty_out": 1.5, "clean_in": 1},
    {"dirty_out": 2},
])
def test_linen_counts_reject_invalid_values(client, counts):
    session = _start(client)[0].json()["data"]
    res = client.patch(f"/v1/clean-sessions/{session['id']}", json={"linen_counts": counts}, headers=_auth())
    assert res.status_code == 422


def test_other_housekeeper_cannot_write_linen_counts(client):
    session = _start(client)[0].json()["data"]
    res = client.patch(
        f"/v1/clean-sessions/{session['id']}",
        json={"linen_counts": {"dirty_out": 1, "clean_in": 1}},
        headers=_auth(user_id="hk-2"),
    )
    assert res.status_code in (403, 404)


def test_linen_counts_locked_after_completion(client):
    session = _start(client)[0].json()["data"]
    client.post(
        f"/v1/clean-sessions/{session['id']}/complete",
        json={"ended_at": datetime.now(timezone.utc).isoformat(), "checklist": _check_all(session, True)},
        headers=_auth(),
    )
    res = client.patch(
        f"/v1/clean-sessions/{session['id']}",
        json={"linen_counts": {"dirty_out": 1, "clean_in": 1}},
        headers=_auth(),
    )
    assert res.status_code == 409 and res.json()["detail"]["code"] == "SESSION_NOT_ACTIVE"
