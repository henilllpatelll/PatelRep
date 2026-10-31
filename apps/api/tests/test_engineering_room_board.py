"""Read contract for GET /rooms/engineering-board, the mobile Engineering Rooms board.

Proves behaviour over an in-memory query builder: whole-hotel search and filters, paging without silent
truncation, the separation of occupancy / housekeeping / availability / repairs, and engineer visibility.
"""

from datetime import datetime, timedelta, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient

from middleware.auth import CurrentUser, get_current_user
from routers import rooms as rooms_router
from routers import room_unavailability as unavailability_router
from tests.test_work_order_list_queue import ME, OTHER, TENANT, _Db, _Query

NOW = datetime.now(timezone.utc)


def _t(minutes):
    return (NOW + timedelta(minutes=minutes)).isoformat()


def _room(number, floor=None, building="A", room_type="King"):
    return {
        "id": f"r-{number}",
        "tenant_id": TENANT,
        "room_number": str(number),
        "floor": floor if floor is not None else int(str(number)[0]),
        "building": building,
        "room_types": {"name": room_type, "code": room_type[:1]},
    }


def _status(number, status="DIRTY", fo=None, **over):
    row = {"room_id": f"r-{number}", "tenant_id": TENANT, "status": status, "fo_status": fo, "updated_at": _t(-5)}
    row.update(over)
    return row


def _wo(n, number, **over):
    row = {
        "id": f"wo-{n}", "tenant_id": TENANT, "room_id": f"r-{number}", "work_order_number": n,
        "title": f"Job {n}", "priority": "normal", "status": "open", "assigned_to": None,
        "updated_at": _t(-n), "archived_at": None,
    }
    row.update(over)
    return row


def _period(number, type_="OUT_OF_ORDER", **over):
    row = {
        "id": f"p-{number}", "tenant_id": TENANT, "room_id": f"r-{number}", "type": type_, "status": "ACTIVE",
        "reason_code": "PLUMBING", "reason_label": "Plumbing", "started_at": _t(-60),
        "expected_return_at": _t(120), "primary_work_order_id": None, "source": "WEB", "updated_at": _t(-30),
    }
    row.update(over)
    return row


def _client(monkeypatch, db, role="engineer", user_id=ME):
    monkeypatch.setattr(rooms_router, "supabase", db)
    app = FastAPI()
    app.include_router(rooms_router.router)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        user_id=user_id, hotel_id=TENANT, role=role, email="x@example.com"
    )
    return TestClient(app)


def _db(rooms, statuses=(), periods=(), wos=()):
    return _Db(rooms=list(rooms), room_status=list(statuses), room_unavailability_periods=list(periods), work_orders=list(wos))


def _numbers(response):
    assert response.status_code == 200, response.text
    return [row["room_number"] for row in response.json()["data"]]


def test_pages_past_one_thousand_rooms_without_losing_any(monkeypatch):
    rooms = [_room(1000 + n, floor=1 + n // 100) for n in range(1, 1201)]
    client = _client(monkeypatch, _db(rooms))
    seen, page = [], 1
    while True:
        body = client.get("/rooms/engineering-board", params={"page": page, "per_page": 100}).json()
        seen.extend(row["id"] for row in body["data"])
        assert body["meta"]["total"] == 1200
        if not body["meta"]["has_more"]:
            break
        page += 1
    assert len(seen) == 1200 and len(set(seen)) == 1200


def test_search_covers_the_whole_hotel_by_number_floor_and_building(monkeypatch):
    rooms = [_room(101), _room(205, building="B"), _room(312, room_type="Suite"), _room(1312, floor=13)]
    client = _client(monkeypatch, _db(rooms))
    assert _numbers(client.get("/rooms/engineering-board", params={"q": "312"})) == ["312", "1312"]
    assert _numbers(client.get("/rooms/engineering-board", params={"q": "floor 13"})) == ["1312"]
    assert _numbers(client.get("/rooms/engineering-board", params={"q": "suite"})) == ["312"]
    assert _numbers(client.get("/rooms/engineering-board", params={"building": "B"})) == ["205"]
    assert _numbers(client.get("/rooms/engineering-board", params={"floor": 2})) == ["205"]


def test_missing_occupancy_is_unknown_never_vacant(monkeypatch):
    rooms = [_room(101), _room(102), _room(103), _room(104)]
    statuses = [
        _status(101, fo="OCC"), _status(102, fo="VAC"), _status(103, fo=None),
        _status(104, status="OCCUPIED", fo="VAC"),  # the two signals disagree
    ]
    client = _client(monkeypatch, _db(rooms, statuses))
    by_room = {r["room_number"]: r["occupancy"] for r in client.get("/rooms/engineering-board").json()["data"]}
    assert by_room == {"101": "occupied", "102": "vacant", "103": "unknown", "104": "unknown"}
    assert _numbers(client.get("/rooms/engineering-board", params={"occupancy": "unknown"})) == ["103", "104"]


def test_a_room_with_no_status_row_is_still_listed_with_unknown_occupancy(monkeypatch):
    client = _client(monkeypatch, _db([_room(101)]))
    row = client.get("/rooms/engineering-board").json()["data"][0]
    assert row["occupancy"] == "unknown" and row["housekeeping_status"] is None and row["availability"] is None


def test_active_repair_does_not_make_a_room_unavailable_and_nothing_is_called_sellable(monkeypatch):
    rooms = [_room(312)]
    wos = [_wo(1, 312, priority="urgent", status="in_progress", assigned_to=ME)]
    client = _client(monkeypatch, _db(rooms, [_status(312, fo="OCC")], wos=wos))
    body = client.get("/rooms/engineering-board").json()
    row = body["data"][0]
    assert row["active_repair_count"] == 1 and row["top_repair"]["id"] == "wo-1"
    assert row["availability"] is None and row["unavailability"] is None
    assert row["occupancy"] == "occupied"
    assert "sellable" not in str(body).lower() and "available_for_sale" not in str(body)


def test_ooo_and_oos_come_from_the_period_type_not_the_shared_room_status(monkeypatch):
    rooms = [_room(401), _room(402), _room(403)]
    statuses = [_status(n, status="OOO") for n in (401, 402, 403)]
    periods = [_period(401, "OUT_OF_ORDER"), _period(402, "OUT_OF_SERVICE")]  # 403 has a bare OOO status, no period
    client = _client(monkeypatch, _db(rooms, statuses, periods))
    availability = {r["room_number"]: r["availability"] for r in client.get("/rooms/engineering-board").json()["data"]}
    assert availability == {"401": "out_of_order", "402": "out_of_service", "403": "unrecorded_down"}
    assert _numbers(client.get("/rooms/engineering-board", params={"maintenance": "ooo"})) == ["401", "403"]
    assert _numbers(client.get("/rooms/engineering-board", params={"maintenance": "oos"})) == ["402"]
    assert _numbers(client.get("/rooms/engineering-board", params={"maintenance": "unavailable"})) == ["401", "402", "403"]


def test_released_periods_do_not_count_as_unavailable(monkeypatch):
    client = _client(monkeypatch, _db([_room(401)], [_status(401)], [_period(401, status="RELEASED")]))
    assert client.get("/rooms/engineering-board").json()["data"][0]["availability"] is None


def test_past_eta_is_flagged_on_the_active_period(monkeypatch):
    client = _client(monkeypatch, _db([_room(401)], [_status(401, "OOO")], [_period(401, expected_return_at=_t(-30))]))
    assert client.get("/rooms/engineering-board").json()["data"][0]["unavailability"]["is_past_eta"] is True


def test_engineer_sees_own_and_unclaimed_repairs_and_only_a_count_of_colleagues(monkeypatch):
    rooms = [_room(101), _room(102)]
    wos = [
        _wo(1, 101, assigned_to=ME, status="in_progress"),
        _wo(2, 101),
        _wo(3, 101, assigned_to=OTHER, priority="emergency"),
        _wo(4, 102, assigned_to=OTHER),
    ]
    client = _client(monkeypatch, _db(rooms, wos=wos))
    rows = {r["room_number"]: r for r in client.get("/rooms/engineering-board").json()["data"]}
    assert rows["101"]["active_repair_count"] == 2 and rows["101"]["others_active_count"] == 1
    assert rows["101"]["top_repair"]["id"] != "wo-3"  # the colleague's emergency job is not leaked
    assert rows["102"]["active_repair_count"] == 0 and rows["102"]["others_active_count"] == 1


def test_chief_engineer_sees_every_active_repair(monkeypatch):
    wos = [_wo(1, 101, assigned_to=ME), _wo(2, 101, assigned_to=OTHER, priority="emergency")]
    client = _client(monkeypatch, _db([_room(101)], wos=wos), role="chief_engineer")
    row = client.get("/rooms/engineering-board").json()["data"][0]
    assert row["active_repair_count"] == 2 and row["top_priority"] == "emergency" and row["others_active_count"] == 0


def test_completed_and_archived_work_is_not_an_active_repair(monkeypatch):
    wos = [_wo(1, 101, status="completed"), _wo(2, 101, archived_at=_t(-1)), _wo(3, 101, status="cancelled")]
    client = _client(monkeypatch, _db([_room(101)], wos=wos))
    assert client.get("/rooms/engineering-board").json()["data"][0]["active_repair_count"] == 0


def test_priority_filter_applies_to_the_most_urgent_visible_repair(monkeypatch):
    rooms = [_room(101), _room(102), _room(103)]
    wos = [_wo(1, 101, priority="low"), _wo(2, 102, priority="urgent"), _wo(3, 102, priority="low")]
    client = _client(monkeypatch, _db(rooms, wos=wos))
    assert _numbers(client.get("/rooms/engineering-board", params={"priority": "urgent"})) == ["102"]
    assert _numbers(client.get("/rooms/engineering-board", params={"maintenance": "active"})) == ["101", "102"]
    assert _numbers(client.get("/rooms/engineering-board", params={"maintenance": "none"})) == ["103"]


def test_filters_combine(monkeypatch):
    rooms = [_room(201), _room(202), _room(301), _room(302)]
    statuses = [_status(201, fo="OCC"), _status(202, fo="OCC"), _status(301, fo="OCC"), _status(302, fo="VAC")]
    wos = [_wo(1, 201), _wo(2, 301)]
    client = _client(monkeypatch, _db(rooms, statuses, wos=wos))
    params = {"occupancy": "occupied", "maintenance": "active", "floor": 3}
    assert _numbers(client.get("/rooms/engineering-board", params=params)) == ["301"]


def test_sorts_and_counts_describe_the_whole_hotel(monkeypatch):
    rooms = [_room(101), _room(102), _room(201)]
    statuses = [_status(101, fo="OCC"), _status(102, fo="VAC"), _status(201, "OOO")]
    wos = [_wo(1, 102, priority="emergency"), _wo(2, 101, priority="low", updated_at=_t(10))]
    client = _client(monkeypatch, _db(rooms, statuses, [_period(201)], wos))
    urgency = _numbers(client.get("/rooms/engineering-board", params={"sort_by": "urgency"}))
    assert urgency[0] == "102" and urgency[1] == "101"
    assert _numbers(client.get("/rooms/engineering-board", params={"sort_by": "updated"}))[0] == "101"
    meta = client.get("/rooms/engineering-board", params={"floor": 2}).json()["meta"]
    assert meta["total"] == 1
    assert meta["counts"] == {"total": 3, "active_repairs": 2, "unavailable": 1, "occupied": 1}
    assert meta["facets"] == {"floors": [1, 2], "buildings": ["A"]}


def test_room_id_returns_that_one_room_and_never_another_hotels(monkeypatch):
    foreign = {**_room(999), "tenant_id": "hotel-2", "id": "r-foreign"}
    client = _client(monkeypatch, _db([_room(101), foreign]))
    assert _numbers(client.get("/rooms/engineering-board", params={"room_id": "r-101"})) == ["101"]
    assert client.get("/rooms/engineering-board", params={"room_id": "r-foreign"}).json()["data"] == []


def test_unknown_sort_is_rejected_and_unrelated_roles_are_refused(monkeypatch):
    client = _client(monkeypatch, _db([_room(101)]))
    assert client.get("/rooms/engineering-board", params={"sort_by": "guest_name"}).status_code == 422
    for role in ("housekeeper", "front_desk"):
        assert _client(monkeypatch, _db([_room(101)]), role=role).get("/rooms/engineering-board").status_code == 403


# ── audit source on the dedicated availability endpoints ────────────────────────────────────────────────

class _Rpc:
    def __init__(self, sink, name):
        self.sink, self.name = sink, name

    def execute(self):
        return type("Result", (), {"data": {"period": {"id": "p-1"}, "room_status": {"status": "OOO"}}})()


class _AvailabilityDb(_Db):
    def __init__(self, **tables):
        super().__init__(**tables)
        self.rpcs = []

    def table(self, name):
        query = _Query(self, name)
        query.maybe_single = lambda: (setattr(query, "max_rows", 1), query)[1]
        return query

    def rpc(self, name, params):
        self.rpcs.append((name, params))
        return _Rpc(self.rpcs, name)


def _availability_client(monkeypatch, db, role="engineer"):
    monkeypatch.setattr(unavailability_router, "supabase", db)
    app = FastAPI()
    app.include_router(unavailability_router.router)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        user_id=ME, hotel_id=TENANT, role=role, email="x@example.com"
    )
    return TestClient(app)


def _create_body(**over):
    body = {
        "room_id": "11111111-1111-4111-8111-111111111111", "type": "OUT_OF_SERVICE", "reason_code": "PLUMBING",
        "reason_label": "Plumbing", "expected_return_at": _t(180),
    }
    body.update(over)
    return body


def test_mobile_availability_writes_are_recorded_with_the_mobile_source(monkeypatch):
    db = _AvailabilityDb(rooms=[{"id": "11111111-1111-4111-8111-111111111111", "tenant_id": TENANT}])
    client = _availability_client(monkeypatch, db)
    assert client.post("/room-unavailability", json=_create_body(source="MOBILE")).status_code == 200
    assert client.post("/room-unavailability/p-1/release", json={"release_notes": "Fixed", "source": "MOBILE"}).status_code == 200
    assert [(name, params["p_source"]) for name, params in db.rpcs] == [
        ("create_room_unavailability", "MOBILE"), ("release_room_unavailability", "MOBILE"),
    ]
    assert db.rpcs[0][1]["p_type"] == "OUT_OF_SERVICE"


def test_source_defaults_to_web_and_cannot_claim_pms_or_automation(monkeypatch):
    db = _AvailabilityDb(rooms=[{"id": "11111111-1111-4111-8111-111111111111", "tenant_id": TENANT}])
    client = _availability_client(monkeypatch, db)
    assert client.post("/room-unavailability", json=_create_body()).status_code == 200
    assert db.rpcs[0][1]["p_source"] == "WEB"
    assert client.post("/room-unavailability", json=_create_body(source="PMS")).status_code == 422


def test_chief_engineer_and_floor_staff_cannot_change_availability(monkeypatch):
    db = _AvailabilityDb(rooms=[{"id": "11111111-1111-4111-8111-111111111111", "tenant_id": TENANT}])
    for role in ("chief_engineer", "housekeeper", "front_desk"):
        client = _availability_client(monkeypatch, db, role=role)
        assert client.post("/room-unavailability", json=_create_body(source="MOBILE")).status_code == 403
        assert client.post("/room-unavailability/p-1/release", json={"source": "MOBILE"}).status_code == 403
    assert db.rpcs == []
