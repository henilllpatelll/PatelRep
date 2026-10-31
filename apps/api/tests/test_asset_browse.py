"""Read contracts the mobile Assets experience depends on: property-wide search/filter/paging and the QR/tag lookup."""

from datetime import datetime, timedelta, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient

from middleware.auth import CurrentUser, get_current_user
from routers import assets as assets_router
from tests.test_work_order_list_queue import TENANT, ME, _Db, _Query


class _Q(_Query):
    def maybe_single(self):
        self.single = True
        return self

class _TestDb(_Db):
    def table(self, name):
        return _Q(self, name)


NOW = datetime.now(timezone.utc)


def _t(days):
    return (NOW + timedelta(days=days)).isoformat()


def _asset(n, tenant=TENANT, **over):
    row = {
        "id": f"a-{n}",
        "tenant_id": tenant,
        "name": f"Asset {n:03d}",
        "asset_tag": f"TAG-{n:03d}",
        "serial_number": f"SN{n:03d}",
        "category_id": "c-hvac",
        "room_id": None,
        "location_text": "Roof",
        "manufacturer": "Trane",
        "model": "X1",
        "failure_risk_score": 0,
        "is_active": True,
        "updated_at": _t(-n),
        "asset_categories": {"name": "HVAC", "code": "HVAC"},
        "rooms": None,
    }
    row.update(over)
    return row


def _client(monkeypatch, db, role="engineer"):
    monkeypatch.setattr(assets_router, "supabase", db)
    app = FastAPI()
    app.include_router(assets_router.router)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        user_id=ME, hotel_id=TENANT, role=role, email="x@example.com"
    )
    return TestClient(app)


def _db(assets, **tables):
    return _TestDb(
        assets=assets,
        asset_downtime_periods=tables.get("downtime", []),
        work_orders=tables.get("work_orders", []),
        pm_schedules=tables.get("pm", []),
        failure_predictions=tables.get("predictions", []),
    )


def _ids(response):
    assert response.status_code == 200, response.text
    return [row["id"] for row in response.json()["data"]]


def test_pages_past_one_hundred_without_duplicates(monkeypatch):
    client = _client(monkeypatch, _db([_asset(n) for n in range(1, 251)]))
    seen: list[str] = []
    page = 1
    while True:
        body = client.get(f"/assets/browse?per_page=100&page={page}").json()
        seen.extend(row["id"] for row in body["data"])
        assert body["meta"]["total"] == 250
        if not body["meta"]["has_more"]:
            break
        page += 1
    assert page == 3
    assert len(seen) == 250 == len(set(seen))


def test_other_property_and_inactive_assets_never_appear(monkeypatch):
    db = _db([_asset(1), _asset(2, tenant="other-hotel"), _asset(3, is_active=False)])
    assert _ids(_client(monkeypatch, db).get("/assets/browse")) == ["a-1"]


def test_search_covers_tag_name_serial_room_and_category_across_the_whole_inventory(monkeypatch):
    assets = [_asset(n) for n in range(1, 151)]
    assets[140] = _asset(141, name="PTAC Unit", asset_tag="AC-312", rooms={"room_number": "312", "floor": 3, "building": "A"}, room_id="r-312")
    client = _client(monkeypatch, _db(assets))
    assert _ids(client.get("/assets/browse?q=ac-312")) == ["a-141"]
    assert _ids(client.get("/assets/browse?q=ptac")) == ["a-141"]
    assert _ids(client.get("/assets/browse?q=312")) == ["a-141"]
    assert _ids(client.get("/assets/browse?q=SN007")) == ["a-7"]
    assert _ids(client.get("/assets/browse?q=ptac%20312")) == ["a-141"]
    assert _ids(client.get("/assets/browse?q=nothing-matches")) == []


def test_floor_and_category_filters_combine_with_search(monkeypatch):
    assets = [
        _asset(1, rooms={"room_number": "201", "floor": 2, "building": "A"}),
        _asset(2, rooms={"room_number": "301", "floor": 3, "building": "A"}),
        _asset(3, category_id="c-plmb", rooms={"room_number": "302", "floor": 3, "building": "A"}),
    ]
    client = _client(monkeypatch, _db(assets))
    assert _ids(client.get("/assets/browse?floor=3&category_id=c-hvac")) == ["a-2"]
    assert _ids(client.get("/assets/browse?floor=3&q=302")) == ["a-3"]


def test_service_status_is_derived_from_downtime_then_repairs(monkeypatch):
    def period(asset, impact, started, restored):
        return {
            "asset_id": asset, "tenant_id": TENANT, "started_at": started, "restored_at": restored,
            "impact_level": impact, "downtime_type": "unplanned", "work_order_id": None,
        }

    db = _db(
        [_asset(1), _asset(2), _asset(3), _asset(4)],
        downtime=[
            period("a-1", "out_of_service", _t(-1), None),
            period("a-2", "degraded", _t(-1), None),
            period("a-4", "out_of_service", _t(-30), _t(-29)),
        ],
        work_orders=[{"asset_id": "a-3", "tenant_id": TENANT, "status": "in_progress", "completed_at": None, "created_at": _t(-1)}],
    )
    client = _client(monkeypatch, db)
    by_id = {r["id"]: r for r in client.get("/assets/browse").json()["data"]}
    assert by_id["a-1"]["service_status"] == "out_of_service"
    assert by_id["a-2"]["service_status"] == "degraded"
    assert by_id["a-3"]["service_status"] == "under_repair"
    assert by_id["a-4"]["service_status"] == "operational"
    assert _ids(client.get("/assets/browse?status=out_of_service")) == ["a-1"]
    assert _ids(client.get("/assets/browse?reliability=confirmed_downtime")) == ["a-1", "a-2", "a-4"]


def test_maintenance_and_reliability_filters(monkeypatch):
    def wo(asset, status, completed, created):
        return {"asset_id": asset, "tenant_id": TENANT, "status": status, "completed_at": completed, "created_at": created}

    db = _db(
        [_asset(1), _asset(2), _asset(3), _asset(4)],
        work_orders=[
            wo("a-1", "open", None, _t(-1)),
            wo("a-4", "completed", _t(-10), _t(-11)),
            wo("a-4", "completed", _t(-20), _t(-21)),
            wo("a-4", "completed", _t(-200), _t(-201)),
        ],
        pm=[
            {"asset_id": "a-2", "tenant_id": TENANT, "is_active": True, "next_due_at": _t(-3), "last_completed_at": _t(-40)},
            {"asset_id": "a-3", "tenant_id": TENANT, "is_active": True, "next_due_at": _t(3), "last_completed_at": None},
        ],
        predictions=[
            {"asset_id": "a-3", "tenant_id": TENANT, "is_acknowledged": False},
            {"asset_id": "a-2", "tenant_id": TENANT, "is_acknowledged": True},
        ],
    )
    client = _client(monkeypatch, db)
    assert _ids(client.get("/assets/browse?maintenance=active_work_order")) == ["a-1"]
    assert _ids(client.get("/assets/browse?maintenance=pm_overdue")) == ["a-2"]
    assert _ids(client.get("/assets/browse?maintenance=pm_due_soon")) == ["a-3"]
    assert _ids(client.get("/assets/browse?maintenance=none")) == ["a-4"]
    assert _ids(client.get("/assets/browse?reliability=active_prediction")) == ["a-3"]
    assert _ids(client.get("/assets/browse?reliability=repeat_repairs")) == ["a-4"]
    row = {r["id"]: r for r in client.get("/assets/browse").json()["data"]}["a-4"]
    assert row["repeat_repairs_90d"] == 2
    assert row["last_serviced_at"] == _t(-10)


def test_attention_is_a_derived_group_not_a_status(monkeypatch):
    db = _db(
        [_asset(1), _asset(2), _asset(3), _asset(4)],
        downtime=[{
            "asset_id": "a-1", "tenant_id": TENANT, "started_at": _t(-1), "restored_at": None,
            "impact_level": "out_of_service", "downtime_type": "unplanned", "work_order_id": None,
        }],
        pm=[{"asset_id": "a-2", "tenant_id": TENANT, "is_active": True, "next_due_at": _t(-1), "last_completed_at": None}],
        predictions=[{"asset_id": "a-3", "tenant_id": TENANT, "is_acknowledged": False}],
    )
    assert _ids(_client(monkeypatch, db).get("/assets/browse?attention=true")) == ["a-1", "a-2", "a-3"]


def test_sorting(monkeypatch):
    db = _db(
        [_asset(1, failure_risk_score=10), _asset(2, failure_risk_score=90), _asset(3, failure_risk_score=50)],
        pm=[
            {"asset_id": "a-1", "tenant_id": TENANT, "is_active": True, "next_due_at": _t(20), "last_completed_at": None},
            {"asset_id": "a-3", "tenant_id": TENANT, "is_active": True, "next_due_at": _t(2), "last_completed_at": None},
        ],
    )
    client = _client(monkeypatch, db)
    assert _ids(client.get("/assets/browse?sort_by=risk")) == ["a-2", "a-3", "a-1"]
    assert _ids(client.get("/assets/browse?sort_by=next_pm")) == ["a-3", "a-1", "a-2"]
    assert _ids(client.get("/assets/browse?sort_by=updated")) == ["a-1", "a-2", "a-3"]
    assert _ids(client.get("/assets/browse?sort_by=name")) == ["a-1", "a-2", "a-3"]
    assert client.get("/assets/browse?sort_by=bogus").status_code == 422


def test_serial_number_is_searchable_but_not_returned(monkeypatch):
    rows = _client(monkeypatch, _db([_asset(1)])).get("/assets/browse?q=SN001").json()["data"]
    assert [r["id"] for r in rows] == ["a-1"]
    assert "serial_number" not in rows[0]


A1 = "0b6f3a52-6a7c-4b1d-8d8e-1f2a3b4c5d6e"


def test_lookup_by_tag_and_by_id(monkeypatch):
    client = _client(monkeypatch, _db([_asset(1, id=A1, asset_tag="AC-312")]))
    assert client.get("/assets/lookup?tag=AC-312").json()["data"]["id"] == A1
    assert client.get("/assets/lookup?tag=%20AC-312%20").json()["data"]["id"] == A1
    assert client.get(f"/assets/lookup?asset_id={A1}").json()["data"]["name"] == "Asset 001"


def test_lookup_never_reveals_another_property_or_inactive_equipment(monkeypatch):
    other = "5c1d2e3f-0000-4000-8000-000000000001"
    db = _db([_asset(2, id=other, tenant="other-hotel", asset_tag="OTHER-1"), _asset(3, asset_tag="OLD", is_active=False)])
    client = _client(monkeypatch, db)
    assert client.get(f"/assets/lookup?asset_id={other}").status_code == 404
    assert client.get("/assets/lookup?tag=OTHER-1").status_code == 404
    assert client.get("/assets/lookup?tag=OLD").status_code == 404
    assert client.get("/assets/lookup?asset_id=not-a-uuid").status_code == 404


def test_lookup_requires_exactly_one_key_and_flags_ambiguous_tags(monkeypatch):
    client = _client(monkeypatch, _db([_asset(1, asset_tag="DUP"), _asset(2, asset_tag="DUP")]))
    assert client.get("/assets/lookup").status_code == 422
    assert client.get(f"/assets/lookup?tag=x&asset_id={A1}").status_code == 422
    assert client.get("/assets/lookup?tag=DUP").status_code == 409


def test_detail_carries_the_same_derived_status_as_the_list(monkeypatch):
    db = _db(
        [_asset(1, id=A1)],
        work_orders=[
            {"asset_id": A1, "tenant_id": TENANT, "status": "in_progress", "completed_at": None, "created_at": _t(-1)},
            {"asset_id": A1, "tenant_id": TENANT, "status": "completed", "completed_at": _t(-5), "created_at": _t(-6)},
            {"asset_id": A1, "tenant_id": "other-hotel", "status": "open", "completed_at": None, "created_at": _t(-1)},
        ],
    )
    client = _client(monkeypatch, db)
    detail = client.get(f"/assets/{A1}").json()["data"]
    assert detail["service_status"] == "under_repair"
    assert detail["active_work_order_count"] == 1
    assert detail["repeat_repairs_90d"] == 1
    assert detail["service_status"] == {r["id"]: r for r in client.get("/assets/browse").json()["data"]}[A1]["service_status"]
