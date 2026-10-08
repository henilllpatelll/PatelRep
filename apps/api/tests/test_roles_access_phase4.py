"""Settings > Roles & Access and Service SLAs (phase 4).

FakeDB does not enforce foreign keys or CHECK constraints, so these lock in the router contract:
tenant scoping, GM-only mutation, no custom role on the GM base role, modules limited to what the base
role can open, duplicate names, and refusing to delete/re-base a role that active staff hold.
"""

import re
from pathlib import Path

from fastapi.testclient import TestClient
from jose import jwt

from core.config import settings
from core.roles import ALL_ROLES, MODULE_ROLE_ACCESS, modules_for_role, unsupported_modules
from main import app
from routers import guest_requests as gr_router
from routers import hotels as hotels_router
from routers import staff as staff_router
from tests.smoke.fake_supabase import FakeDB


def _auth(role: str = "gm", hotel_id: str = "hotel-a") -> dict[str, str]:
    payload = {"sub": "user-1", "role": role, "hotel_id": hotel_id, "aud": "authenticated"}
    return {"Authorization": f"Bearer {jwt.encode(payload, settings.supabase_jwt_secret, algorithm='HS256')}"}


def _role(rid: str, name: str, base: str = "front_desk", hotel: str = "hotel-a", active: bool = True, modules=None) -> dict:
    return {"id": rid, "hotel_id": hotel, "name": name, "description": None, "base_role": base,
            "allowed_modules": modules if modules is not None else ["tasks"], "is_active": active, "created_at": "2026-01-01"}


def _staff_db(**extra) -> FakeDB:
    rows = {
        "custom_roles": [_role("r1", "Night Auditor"), _role("r2", "Other Hotel", hotel="hotel-b"), _role("r3", "Retired", active=False)],
        "user_roles": [
            {"id": "u1", "user_id": "s1", "tenant_id": "hotel-a", "role": "front_desk", "is_active": True, "custom_role_id": "r1"},
            {"id": "u2", "user_id": "s2", "tenant_id": "hotel-a", "role": "front_desk", "is_active": False, "custom_role_id": "r1"},
        ],
    }
    rows.update(extra)
    return FakeDB(rows)


def _staff_client(monkeypatch, db: FakeDB) -> TestClient:
    monkeypatch.setattr(staff_router, "supabase", db)
    return TestClient(app)


# ─── Module access matrix ────────────────────────────────────────────────────

def test_module_matrix_matches_the_web_route_guard():
    """MODULE_ROLE_ACCESS must mirror ROLE_ROUTE_RULES in routeGuard.ts (the enforced route access)."""
    source = (Path(__file__).resolve().parents[2] / "web" / "lib" / "utils" / "routeGuard.ts").read_text(encoding="utf-8")
    block = source[source.index("ROLE_ROUTE_RULES"): source.index("export type RouteAccessDecision")]
    web: dict[str, set[str]] = {}
    for prefix, roles in re.findall(r"prefix: '/([a-z-]+)', roles: \[([^\]]*)\]", block):
        if prefix in MODULE_ROLE_ACCESS:
            web[prefix] = set(ALL_ROLES) if "...ALL_ROLES" in roles else set(re.findall(r"'([a-z_]+)'", roles))
    assert set(web) == set(MODULE_ROLE_ACCESS), "every module needs a route rule"
    for module, roles in MODULE_ROLE_ACCESS.items():
        assert set(roles) == web[module], module


def test_front_desk_cannot_be_given_modules_it_cannot_open():
    assert modules_for_role("front_desk") == {"housekeeping", "lost-found", "tasks", "logbook", "ai"}
    assert unsupported_modules(["tasks", "engineering", "reports", "nope"], "front_desk") == ["engineering", "nope", "reports"]
    assert unsupported_modules(["guest-requests"], "front_desk") == []  # legacy alias of tasks


# ─── Custom roles ────────────────────────────────────────────────────────────

def test_list_is_hotel_scoped_active_only_and_counts_active_staff(monkeypatch):
    res = _staff_client(monkeypatch, _staff_db()).get("/v1/staff/custom-roles", headers=_auth())
    assert res.status_code == 200
    data = res.json()["data"]
    assert [r["id"] for r in data] == ["r1"]
    assert data[0]["assigned_staff_count"] == 1  # the inactive assignment does not count


def test_create_role_normalises_modules_and_trims_name(monkeypatch):
    db = _staff_db()
    res = _staff_client(monkeypatch, db).post(
        "/v1/staff/custom-roles",
        json={"name": "  Evening Desk ", "base_role": "front_desk", "allowed_modules": ["tasks", "guest-requests", "logbook"]},
        headers=_auth(),
    )
    assert res.status_code == 200
    created = res.json()["data"]
    assert created["name"] == "Evening Desk" and created["hotel_id"] == "hotel-a"
    assert created["allowed_modules"] == ["logbook", "tasks"]


def test_create_rejects_gm_base_unsupported_modules_and_duplicates(monkeypatch):
    client = _staff_client(monkeypatch, _staff_db())
    base = {"name": "X", "allowed_modules": ["tasks"]}
    assert client.post("/v1/staff/custom-roles", json={**base, "base_role": "gm"}, headers=_auth()).status_code == 422
    r = client.post("/v1/staff/custom-roles", json={**base, "base_role": "front_desk", "allowed_modules": ["tasks", "staff"]}, headers=_auth())
    assert r.status_code == 422 and "staff" in r.json()["detail"]
    r = client.post("/v1/staff/custom-roles", json={**base, "name": "night auditor", "base_role": "front_desk"}, headers=_auth())
    assert r.status_code == 409
    # the name of a soft-deleted role is still taken (UNIQUE hotel_id, name)
    assert client.post("/v1/staff/custom-roles", json={**base, "name": "Retired", "base_role": "front_desk"}, headers=_auth()).status_code == 409
    # same name in another hotel is fine
    assert client.post("/v1/staff/custom-roles", json={**base, "name": "Other Hotel", "base_role": "front_desk"}, headers=_auth()).status_code == 200


def test_chief_engineer_is_a_valid_base_role(monkeypatch):
    res = _staff_client(monkeypatch, _staff_db()).post(
        "/v1/staff/custom-roles", json={"name": "Chief variant", "base_role": "chief_engineer", "allowed_modules": ["engineering"]}, headers=_auth(),
    )
    assert res.status_code == 200 and res.json()["data"]["base_role"] == "chief_engineer"


def test_update_checks_scope_modules_name_and_base_role(monkeypatch):
    db = _staff_db(user_roles=[])
    client = _staff_client(monkeypatch, db)
    assert client.patch("/v1/staff/custom-roles/r2", json={"name": "hijack"}, headers=_auth()).status_code == 404
    assert client.patch("/v1/staff/custom-roles/r3", json={"name": "zombie"}, headers=_auth()).status_code == 404
    assert client.patch("/v1/staff/custom-roles/r1", json={"allowed_modules": ["reports"]}, headers=_auth()).status_code == 422
    assert client.patch("/v1/staff/custom-roles/r1", json={"base_role": "gm"}, headers=_auth()).status_code == 422
    # moving to another base role re-validates the modules it already has
    db.rows["custom_roles"][0]["allowed_modules"] = ["housekeeping", "lost-found"]
    assert client.patch("/v1/staff/custom-roles/r1", json={"base_role": "housekeeper"}, headers=_auth()).status_code == 422
    ok = client.patch("/v1/staff/custom-roles/r1", json={"allowed_modules": ["tasks", "logbook"]}, headers=_auth())
    assert ok.status_code == 200 and ok.json()["data"]["allowed_modules"] == ["logbook", "tasks"]


def test_base_role_is_locked_while_active_staff_hold_the_role(monkeypatch):
    client = _staff_client(monkeypatch, _staff_db())
    res = client.patch("/v1/staff/custom-roles/r1", json={"base_role": "housekeeping_supervisor", "allowed_modules": ["tasks"]}, headers=_auth())
    assert res.status_code == 409 and "1 active staff" in res.json()["detail"]
    # a legacy GM-based role can still have other fields edited
    db = _staff_db(custom_roles=[_role("g1", "Legacy GM", base="gm", modules=["tasks"])], user_roles=[])
    assert _staff_client(monkeypatch, db).patch("/v1/staff/custom-roles/g1", json={"base_role": "gm", "name": "Legacy GM 2"}, headers=_auth()).status_code == 200


def test_delete_is_refused_while_staff_hold_it_and_never_touches_other_roles(monkeypatch):
    db = _staff_db()
    client = _staff_client(monkeypatch, db)
    res = client.delete("/v1/staff/custom-roles/r1", headers=_auth())
    assert res.status_code == 409 and "Move them" in res.json()["detail"]
    assert db.rows["custom_roles"][0]["is_active"] is True
    assert client.delete("/v1/staff/custom-roles/r2", headers=_auth()).status_code == 404  # other hotel
    db.rows["user_roles"].clear()
    assert client.delete("/v1/staff/custom-roles/r1", headers=_auth()).status_code == 200
    assert [r["is_active"] for r in db.rows["custom_roles"]] == [False, True, False]
    assert db.rows["custom_roles"][1]["hotel_id"] == "hotel-b"


def test_only_a_gm_can_manage_custom_roles(monkeypatch):
    client = _staff_client(monkeypatch, _staff_db())
    for role in ("housekeeping_supervisor", "front_desk", "chief_engineer", "housekeeper"):
        h = _auth(role)
        assert client.get("/v1/staff/custom-roles", headers=h).status_code == 403
        assert client.post("/v1/staff/custom-roles", json={"name": "x", "base_role": "front_desk"}, headers=h).status_code == 403
        assert client.patch("/v1/staff/custom-roles/r1", json={"name": "x"}, headers=h).status_code == 403
        assert client.delete("/v1/staff/custom-roles/r1", headers=h).status_code == 403


# ─── Front Desk modules ──────────────────────────────────────────────────────

def _hotel_client(monkeypatch):
    db = FakeDB({"tenants": [{"id": "hotel-a", "front_desk_modules": ["tasks"]}, {"id": "hotel-b", "front_desk_modules": ["tasks"]}]})
    monkeypatch.setattr(hotels_router, "supabase", db)
    return TestClient(app), db


def test_front_desk_modules_reject_unreachable_modules_and_normalise(monkeypatch):
    client, db = _hotel_client(monkeypatch)
    bad = client.patch("/v1/hotels/hotel-a", json={"front_desk_modules": ["tasks", "engineering"]}, headers=_auth())
    assert bad.status_code == 422 and "engineering" in bad.json()["detail"]
    assert db.rows["tenants"][0]["front_desk_modules"] == ["tasks"]
    ok = client.patch("/v1/hotels/hotel-a", json={"front_desk_modules": ["logbook", "guest-requests", "housekeeping", "ai"]}, headers=_auth())
    assert ok.status_code == 200
    assert db.rows["tenants"][0]["front_desk_modules"] == ["ai", "housekeeping", "logbook", "tasks"]
    assert db.rows["tenants"][1]["front_desk_modules"] == ["tasks"]


def test_front_desk_modules_are_gm_and_own_hotel_only(monkeypatch):
    client, db = _hotel_client(monkeypatch)
    assert client.patch("/v1/hotels/hotel-a", json={"front_desk_modules": ["tasks"]}, headers=_auth("front_desk")).status_code == 403
    assert client.patch("/v1/hotels/hotel-a", json={"front_desk_modules": ["tasks"]}, headers=_auth("housekeeping_supervisor")).status_code == 403
    assert client.patch("/v1/hotels/hotel-b", json={"front_desk_modules": ["logbook"]}, headers=_auth()).status_code == 403
    assert db.rows["tenants"][1]["front_desk_modules"] == ["tasks"]


# ─── Service SLAs ────────────────────────────────────────────────────────────

def _sla_db(**extra) -> FakeDB:
    rows = {"guest_request_sla_policies": [
        {"id": "p1", "tenant_id": "hotel-a", "category": "housekeeping", "priority": None, "guest_impact": None, "sla_minutes": 30},
        {"id": "p2", "tenant_id": "hotel-a", "category": None, "priority": "urgent", "guest_impact": None, "sla_minutes": 15},
        {"id": "p3", "tenant_id": "hotel-b", "category": "service", "priority": None, "guest_impact": None, "sla_minutes": 99},
    ]}
    rows.update(extra)
    return FakeDB(rows)


def _sla_client(monkeypatch, db):
    monkeypatch.setattr(gr_router, "supabase", db)
    return TestClient(app)


def test_sla_update_changes_only_that_rule_in_place(monkeypatch):
    db = _sla_db()
    res = _sla_client(monkeypatch, db).patch(
        "/v1/guest-requests/sla-policies/p1", json={"category": "housekeeping", "sla_minutes": 45}, headers=_auth(),
    )
    assert res.status_code == 200
    rows = {r["id"]: r for r in db.rows["guest_request_sla_policies"]}
    assert rows["p1"]["sla_minutes"] == 45 and rows["p1"]["id"] == "p1"
    assert rows["p2"]["sla_minutes"] == 15 and rows["p3"]["sla_minutes"] == 99
    assert len(rows) == 3


def test_sla_update_validation_conflicts_and_scope(monkeypatch):
    client = _sla_client(monkeypatch, _sla_db())
    url = "/v1/guest-requests/sla-policies/"
    assert client.patch(url + "p1", json={"sla_minutes": 10}, headers=_auth()).status_code == 422          # all wildcards
    assert client.patch(url + "p1", json={"category": "service", "sla_minutes": 0}, headers=_auth()).status_code == 422
    assert client.patch(url + "p1", json={"category": "service", "sla_minutes": 10081}, headers=_auth()).status_code == 422
    assert client.patch(url + "p1", json={"priority": "urgent", "sla_minutes": 10}, headers=_auth()).status_code == 409  # same as p2
    assert client.patch(url + "p3", json={"category": "service", "sla_minutes": 5}, headers=_auth()).status_code == 404  # other hotel
    assert client.patch(url + "missing", json={"category": "service", "sla_minutes": 5}, headers=_auth()).status_code == 404
    # keeping its own combination is not a conflict with itself
    assert client.patch(url + "p1", json={"category": "housekeeping", "sla_minutes": 31}, headers=_auth()).status_code == 200


def test_sla_rule_that_could_never_match_is_rejected(monkeypatch):
    client = _sla_client(monkeypatch, _sla_db())
    body = {"category": "accessibility", "priority": "normal", "sla_minutes": 20}
    assert client.post("/v1/guest-requests/sla-policies", json=body, headers=_auth()).status_code == 422
    assert client.patch("/v1/guest-requests/sla-policies/p1", json=body, headers=_auth()).status_code == 422
    assert client.post("/v1/guest-requests/sla-policies", json={**body, "priority": "urgent"}, headers=_auth()).status_code == 200


def test_sla_mutations_need_a_manager_role(monkeypatch):
    db = _sla_db()
    client = _sla_client(monkeypatch, db)
    for role in ("front_desk", "housekeeper", "engineer"):
        h = _auth(role)
        assert client.patch("/v1/guest-requests/sla-policies/p1", json={"category": "service", "sla_minutes": 5}, headers=h).status_code == 403
        assert client.post("/v1/guest-requests/sla-policies", json={"category": "service", "sla_minutes": 5}, headers=h).status_code == 403
        assert client.delete("/v1/guest-requests/sla-policies/p1", headers=h).status_code == 403
    assert len(db.rows["guest_request_sla_policies"]) == 3


def test_sla_resolution_is_unchanged():
    from services.guest_recovery.contracts import resolve_sla_minutes

    policies = [
        {"category": "housekeeping", "priority": None, "guest_impact": None, "sla_minutes": 30},
        {"category": None, "priority": "urgent", "guest_impact": None, "sla_minutes": 15},
        {"category": "housekeeping", "priority": "urgent", "guest_impact": None, "sla_minutes": 10},
    ]
    assert resolve_sla_minutes(policies, category="housekeeping", priority="urgent", guest_impact="standard") == 10
    assert resolve_sla_minutes(policies, category="housekeeping", priority="normal", guest_impact="standard") == 30
    assert resolve_sla_minutes(policies, category="service", priority="urgent", guest_impact="low") == 15
    assert resolve_sla_minutes(policies, category="service", priority="normal", guest_impact="low") == 240
