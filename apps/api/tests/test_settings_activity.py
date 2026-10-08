"""Settings > Activity & Audit read API: authorization, tenant isolation, redaction, filters, paging, export."""
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException

from middleware.auth import CurrentUser
from routers import settings_activity as api
from services.audit_catalog import ACTIONS, CATEGORIES, FIELDS, RESOURCE_TYPES, build_changes, sanitize_state
from tests.smoke.fake_supabase import FakeDB

A = "11111111-1111-4111-8111-111111111111"
B = "22222222-2222-4222-8222-222222222222"
GM_A = CurrentUser(user_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", hotel_id=A, role="gm", email="a@example.com")
GM_B = CurrentUser(user_id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", hotel_id=B, role="gm", email="b@example.com")
ALL_ROLES = ["housekeeper", "engineer", "housekeeping_supervisor", "chief_engineer", "front_desk", "gm"]
NOW = datetime.now(timezone.utc).replace(microsecond=0)


def eid(n: int) -> str:
    return f"00000000-0000-4000-8000-{n:012d}"


def ev(n, *, tenant=A, action="settings.property.updated", rtype="property_profile", actor=GM_A.user_id, role="gm",
       old=None, new=None, age_hours=1.0, source="api", created_at=None):
    return {
        "id": eid(n), "tenant_id": tenant, "action": action, "resource_type": rtype, "resource_id": tenant,
        "actor_id": actor, "actor_role": role, "old_state": old if old is not None else {}, "new_state": new if new is not None else {},
        "source": source, "created_at": created_at or (NOW - timedelta(hours=age_hours)).isoformat(),
    }


def make_db(events, **extra):
    rows = {
        "tenants": [{"id": A, "timezone": "America/Chicago"}, {"id": B, "timezone": "America/New_York"}],
        "user_profiles": [
            {"id": GM_A.user_id, "full_name": "Alice Manager", "preferred_name": None},
            {"id": GM_B.user_id, "full_name": "Bob Other", "preferred_name": None},
        ],
        "operational_audit_events": events,
    }
    rows.update(extra)
    return FakeDB(rows)


@pytest.fixture
def use(monkeypatch):
    def _use(events, **extra):
        db = make_db(events, **extra)
        monkeypatch.setattr(api, "supabase", db)
        return db
    return _use


async def lst(user=GM_A, **kw):
    params = dict(q=None, category=None, resource_type=None, actor_id=None, date_from=None, date_to=None, limit=25, cursor=None)
    params.update(kw)
    return await api.list_activity(current_user=user, **params)


# ─── Authorization & tenant isolation ─────────────────────────────────────────

def _gate(path, method="GET"):
    route = next(r for r in api.router.routes if r.path == path and method in r.methods)
    return route.dependant.dependencies[0].call


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/settings/activity", "/settings/activity/{event_id}", "/settings/activity/export", "/settings/activity/actors", "/settings/activity/categories"])
async def test_every_endpoint_is_gm_only(path):
    check = _gate(path)
    for role in ALL_ROLES:
        user = CurrentUser(user_id="u", hotel_id=A, role=role, email="x@example.com")
        if role == "gm":
            assert (await check(current_user=user)).role == "gm"
        else:
            with pytest.raises(HTTPException) as exc:
                await check(current_user=user)
            assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_filter_options_list_only_mapped_categories_and_resource_types():
    res = await api.list_categories(current_user=GM_A)
    assert [c["id"] for c in res["data"]] == list(CATEGORIES)
    assert {r["id"] for r in res["meta"]["resource_types"]} == set(RESOURCE_TYPES)


def test_no_endpoint_accepts_a_hotel_id_and_nothing_can_write():
    for route in api.router.routes:
        assert route.methods == {"GET"}
        assert not [p for p in route.dependant.query_params if "hotel" in p.name or "tenant" in p.name]


@pytest.mark.asyncio
async def test_gm_sees_only_their_own_hotels_allowlisted_events(use):
    use([
        ev(1, tenant=A), ev(2, tenant=B, action="settings.room.created", rtype="room"),
        ev(3, tenant=A, action="work_order.transitioned", rtype="work_order"),  # operational, not allowlisted
        ev(4, tenant=A, action="room.status_changed", rtype="room"),
    ])
    a = (await lst(GM_A))["data"]
    b = (await lst(GM_B))["data"]
    assert [e["id"] for e in a] == [eid(1)]
    assert [e["id"] for e in b] == [eid(2)]


@pytest.mark.asyncio
async def test_event_detail_is_scoped_and_hides_existence(use):
    use([ev(1, tenant=A), ev(2, tenant=B), ev(3, tenant=A, action="work_order.transitioned", rtype="work_order")])
    assert (await api.get_activity_event(eid(1), current_user=GM_A))["data"]["id"] == eid(1)
    messages = set()
    for event_id in (eid(2), eid(3), eid(99), "not-a-uuid"):  # other hotel, not allowlisted, missing, malformed
        with pytest.raises(HTTPException) as exc:
            await api.get_activity_event(event_id, current_user=GM_A)
        assert exc.value.status_code == 404
        messages.add(exc.value.detail)
    assert len(messages) == 1


@pytest.mark.asyncio
async def test_client_cannot_widen_scope_with_actor_or_cursor(use):
    use([ev(1, tenant=A), ev(2, tenant=B, actor=GM_B.user_id)])
    assert (await lst(GM_A, actor_id=GM_B.user_id))["data"] == []  # B's actor matches nothing in A's events
    cursor = api._encode_cursor((NOW + timedelta(hours=1)).isoformat(), eid(99))
    page = (await lst(GM_A, cursor=cursor))["data"]
    assert [e["id"] for e in page] == [eid(1)]  # cursor never reaches hotel B's rows


# ─── Truthful representation & redaction ──────────────────────────────────────

@pytest.mark.asyncio
async def test_event_shape_uses_recorded_values_and_marks_missing_data(use):
    use([
        ev(1, action="settings.front_desk_access.updated", rtype="front_desk_access",
           old={"modules": ["housekeeping", "tasks"]}, new={"modules": ["housekeeping", "tasks", "logbook"]}, role="gm"),
        ev(2, action="settings.room.created", rtype="room", new={"room_number": "101"}, role="housekeeping_supervisor", age_hours=2),
        ev(3, action="settings.property.layout_updated", rtype="property_layout", actor=None, source="automation", age_hours=3),
    ])
    data = {e["id"]: e for e in (await lst())["data"]}
    fd = (await api.get_activity_event(eid(1), current_user=GM_A))["data"]
    assert fd["title"] == "Front Desk access updated" and fd["category"] == "permissions"
    assert fd["actor"] == {"id": GM_A.user_id, "name": "Alice Manager", "role": "gm", "role_label": "General Manager"}
    change = fd["changes"][0]
    assert change["added"] == ["logbook"] and change["removed"] == []
    assert change["before"] == ["housekeeping", "tasks"]
    # role is the recorded one, not Alice's current role
    assert data[eid(2)]["actor"]["role"] == "housekeeping_supervisor"
    created = (await api.get_activity_event(eid(2), current_user=GM_A))["data"]["changes"][0]
    assert "before" not in created and created["after"] == "101"  # nothing recorded before: not guessed
    assert data[eid(2)]["resource"]["name"] == "Room 101"
    assert data[eid(3)]["actor"]["name"] == "System"
    assert data[eid(3)]["has_details"] is False
    assert (await api.get_activity_event(eid(3), current_user=GM_A))["data"]["changes"] is None  # 'details unavailable'
    assert all("outcome" not in e for e in data.values())  # outcomes are not recorded, so none are invented


@pytest.mark.asyncio
async def test_unknown_or_missing_actor_is_labelled_truthfully(use):
    use([ev(1, actor="cccccccc-cccc-4ccc-8ccc-cccccccccccc"), ev(2, actor=None, age_hours=2)])
    names = {e["id"]: e["actor"]["name"] for e in (await lst())["data"]}
    assert names[eid(1)] == "Unknown user"
    assert names[eid(2)] == "Former user (account removed)"


@pytest.mark.asyncio
async def test_sensitive_and_unknown_state_never_leaves_the_api_even_from_historic_rows(use):
    dirty = {
        "property_code": "SAND01", "endpoint": "https://ohip.example.com", "auth_updated": True,
        "integration_password": "hunter2", "access_token": "tok-123", "client_secret": "sek", "authorization": "Bearer abc",
        "guest_email": "jane@example.com", "raw": {"a": 1},
    }
    use([ev(1, action="settings.integration.opera_connected", rtype="integration", new=dirty, old=dirty)])
    page = await lst()
    detail = await api.get_activity_event(eid(1), current_user=GM_A)
    export = await api.export_activity(q=None, category=None, resource_type=None, actor_id=None, date_from=None, date_to=None, current_user=GM_A)
    blob = json.dumps([page, detail]) + export.body.decode("utf-8-sig")
    for leaked in ("hunter2", "tok-123", "sek", "Bearer", "jane@example.com", "integration_password"):
        assert leaked not in blob
    assert "SAND01" in blob


@pytest.mark.asyncio
async def test_operational_events_are_listed_by_title_only_with_no_state(use):
    use([ev(1, action="vendor.updated", rtype="vendor", new={"name": "Acme", "secret_note": "x"}, old={"phone": "123"})])
    [event] = (await lst())["data"]
    assert event["title"] == "Vendor updated" and event["category"] == "operations"
    assert event["has_details"] is False and event["resource"]["name"] is None
    assert (await api.get_activity_event(eid(1), current_user=GM_A))["data"]["changes"] is None


# ─── Search & filters ─────────────────────────────────────────────────────────

@pytest.fixture
def seeded(use):
    return use([
        ev(1, action="settings.room.created", rtype="room", new={"room_number": "101"}, age_hours=1),
        ev(2, action="settings.sla_policy.updated", rtype="sla_policy", new={"sla_minutes": 30}, old={"sla_minutes": 20}, age_hours=2),
        ev(3, action="settings.custom_role.created", rtype="custom_role", new={"name": "Lead"}, actor=GM_B.user_id, age_hours=3),
        ev(4, action="settings.room.updated", rtype="room", new={"room_number": "102"}, age_hours=4),
        ev(5, action="settings.property.updated", rtype="property_profile", new={"name": "X"}, age_hours=24 * 40),  # outside the default 30 days
    ])


@pytest.mark.asyncio
async def test_default_range_is_bounded_to_thirty_days(seeded):
    ids = [e["id"] for e in (await lst())["data"]]
    assert eid(5) not in ids and ids == [eid(1), eid(2), eid(3), eid(4)]  # newest first
    wide = [e["id"] for e in (await lst(date_from=(NOW - timedelta(days=60)).date().isoformat()))["data"]]
    assert eid(5) in wide


@pytest.mark.asyncio
async def test_category_resource_actor_and_search_filters(seeded):
    assert [e["id"] for e in (await lst(category="rooms"))["data"]] == [eid(1), eid(4)]
    assert [e["id"] for e in (await lst(resource_type="sla_policy"))["data"]] == [eid(2)]
    assert [e["id"] for e in (await lst(actor_id=GM_B.user_id))["data"]] == [eid(3)]  # only events in THIS hotel by that actor
    assert [e["id"] for e in (await lst(q="sla"))["data"]] == [eid(2)]  # title match
    assert [e["id"] for e in (await lst(q="permissions"))["data"]] == [eid(3)]  # category match
    assert [e["id"] for e in (await lst(q="alice"))["data"]] == [eid(1), eid(2), eid(4)]  # actor-name match
    assert [e["id"] for e in (await lst(q=eid(2)))["data"]] == [eid(2)]  # exact event id
    assert (await lst(q="zzz-nothing"))["data"] == []


@pytest.mark.asyncio
async def test_search_does_not_match_state_values_or_secrets(use):
    use([ev(1, action="settings.integration.opera_connected", rtype="integration", new={"property_code": "SAND01", "integration_password": "hunter2"})])
    assert (await lst(q="hunter2"))["data"] == []
    assert (await lst(q="SAND01"))["data"] == []  # values are not searchable


@pytest.mark.asyncio
async def test_date_filters_use_the_hotels_timezone(use):
    # 2026-03-10 02:30 UTC is still March 9 in Chicago (CDT, UTC-5) and already March 10 in UTC.
    use([ev(1, created_at="2026-03-10T02:30:00+00:00")])
    on_9th = await lst(date_from="2026-03-09", date_to="2026-03-09")
    on_10th = await lst(date_from="2026-03-10", date_to="2026-03-10")
    assert [e["id"] for e in on_9th["data"]] == [eid(1)] and on_10th["data"] == []
    assert on_9th["meta"]["timezone"] == "America/Chicago"


@pytest.mark.asyncio
@pytest.mark.parametrize("kw, status", [
    ({"date_from": "yesterday"}, 422), ({"date_from": "2026-03-10", "date_to": "2026-03-01"}, 422),
    ({"date_from": "2020-01-01", "date_to": "2026-01-01"}, 422),  # beyond the maximum range
    ({"category": "billing"}, 422), ({"resource_type": "drop table"}, 422), ({"actor_id": "x' or 1=1"}, 422),
    ({"cursor": "%%%"}, 400), ({"cursor": api._encode_cursor("not-a-date", eid(1))}, 400),
])
async def test_malformed_filters_and_cursors_are_client_errors(use, kw, status):
    use([ev(1)])
    with pytest.raises(HTTPException) as exc:
        await lst(**kw)
    assert exc.value.status_code == status


@pytest.mark.asyncio
async def test_search_input_cannot_inject_into_the_filter_expression(use):
    use([ev(1)])
    for hostile in ("a),id.neq.0,(b", "x%,action.neq.z", "'; drop table operational_audit_events;--"):
        data = (await lst(q=hostile))["data"]
        assert data == []  # no spurious widening of the result set


# ─── Pagination ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_keyset_pagination_is_complete_unique_and_deterministic_with_equal_timestamps(use):
    same = (NOW - timedelta(hours=1)).isoformat()
    events = [ev(i, created_at=same) for i in range(1, 5)] + [ev(i, age_hours=i) for i in range(5, 10)]
    use(events)
    seen, cursor, pages = [], None, 0
    while True:
        res = await lst(limit=2, cursor=cursor)
        seen += [e["id"] for e in res["data"]]
        pages += 1
        cursor = res["meta"]["next_cursor"]
        assert res["meta"]["has_more"] == (cursor is not None)
        if not cursor:
            break
    assert len(seen) == 9 and len(set(seen)) == 9, seen
    ties = [i for i in seen if i in {eid(n) for n in range(1, 5)}]
    assert ties == sorted(ties, reverse=True)  # secondary key id DESC among equal timestamps
    assert seen[:4] == ties  # the shared (newest) timestamp comes first
    assert pages == 5
    assert [e["id"] for e in (await lst(limit=2))["data"]] == seen[:2]  # stable across calls


@pytest.mark.asyncio
async def test_page_size_is_capped():
    from fastapi.params import Query as Q
    route = next(r for r in api.router.routes if r.path == "/settings/activity")
    limit = next(p for p in route.dependant.query_params if p.name == "limit")
    assert limit.field_info.metadata  # ge/le constraints are declared
    assert api.MAX_LIMIT == 50


# ─── Export ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_export_is_scoped_escaped_and_bounded(use):
    import csv, io
    use([
        ev(1, action="settings.property.updated", rtype="property_profile", new={"name": "=cmd|' /C calc'!A0"}),
        ev(2, action="settings.room.created", rtype="room", new={"room_number": "9999"}, tenant=B, actor=GM_B.user_id),
    ])
    res = await api.export_activity(q=None, category=None, resource_type=None, actor_id=None, date_from=None, date_to=None, current_user=GM_A)
    text = res.body.decode("utf-8-sig")
    assert res.media_type.startswith("text/csv") and "attachment" in res.headers["content-disposition"]
    assert "Property profile updated" in text and "9999" not in text  # other hotel's row never appears
    rows = list(csv.reader(io.StringIO(text)))
    assert len(rows) == 2
    resource_cell = rows[1][rows[0].index("Resource")]
    assert resource_cell.startswith("'=cmd")  # a cell that would start a formula is neutralised
    assert not any(cell[:1] in ("=", "+", "-", "@") for row in rows[1:] for cell in row)
    assert res.headers["x-export-truncated"] == "false"
    with pytest.raises(HTTPException) as exc:  # export range is tighter than the screen's
        await api.export_activity(q=None, category=None, resource_type=None, actor_id=None,
                                  date_from=(NOW - timedelta(days=120)).date().isoformat(), date_to=None, current_user=GM_A)
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_export_row_cap_truncates_and_says_so(use, monkeypatch):
    use([ev(i, age_hours=i / 10) for i in range(1, 8)])
    monkeypatch.setattr(api, "MAX_EXPORT_ROWS", 5)
    monkeypatch.setattr(api, "EXPORT_PAGE", 2)
    res = await api.export_activity(q=None, category=None, resource_type=None, actor_id=None, date_from=None, date_to=None, current_user=GM_A)
    lines = [l for l in res.body.decode("utf-8-sig").splitlines() if l]
    assert len(lines) == 1 + 5 + 1 and res.headers["x-export-truncated"] == "true"
    assert "Export limited to the newest 5 events" in lines[-1]


# ─── Catalog & coverage ───────────────────────────────────────────────────────

def test_catalog_is_internally_consistent():
    for action, (title, category) in ACTIONS.items():
        assert title and category in CATEGORIES
    for category in CATEGORIES:  # no category without mapped events
        assert any(c == category for _, c in ACTIONS.values()), category
    for rtype in FIELDS:
        assert rtype in RESOURCE_TYPES
    assert "billing" not in CATEGORIES  # no billing event is recorded, so no billing category is invented


def test_every_settings_action_is_recorded_somewhere_and_every_recorded_action_is_catalogued():
    root = Path(__file__).resolve().parents[1]
    code = "\n".join(p.read_text(encoding="utf-8") for p in (root / "routers").glob("*.py"))
    recorded = set(re.findall(r'action="(settings\.[a-z_.]+)"', code))
    catalogued = {a for a in ACTIONS if a.startswith("settings.")}
    assert recorded == catalogued, (recorded ^ catalogued)


def test_sanitize_and_changes_ignore_credentials_and_unknown_keys():
    assert sanitize_state("integration", {"property_code": "X", "password": "p", "api_key": "k", "other": 1}) == {"property_code": "X"}
    assert build_changes("room", {"floor": 1}, {"floor": 2, "secret": "z"}) == [{"field": "floor", "label": "Floor", "before": 1, "after": 2}]
    assert build_changes("room", {}, {}) == []
