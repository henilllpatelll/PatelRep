"""People Phase 1 — staff lifecycle, profile, departments, GM-only data and tenant isolation.

Handlers are called directly (repo convention, no TestClient); route-level role gates are asserted by
running each route's real `require_role` dependency.
"""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from middleware.auth import CurrentUser
from models.requests import UpdateStaffProfileRequest
from routers import staff as staff_router
from routers import staff_invitations as inv_router
from routers import staff_schedules as sched_router
from tests.people_fakes import FakeDB

H1, H2 = "hotel-1", "hotel-2"
DEPT_H1 = "11111111-1111-4111-8111-111111111111"
DEPT_H2 = "22222222-2222-4222-8222-222222222222"

GM = CurrentUser(user_id="gm-1", hotel_id=H1, role="gm", email="gm@x.com")
GM_H2 = CurrentUser(user_id="gm-9", hotel_id=H2, role="gm", email="gm9@x.com")
SUPERVISOR = CurrentUser(user_id="sup-1", hotel_id=H1, role="housekeeping_supervisor", email="s@x.com")
ENGINEER = CurrentUser(user_id="eng-1", hotel_id=H1, role="engineer", email="e@x.com")
HOUSEKEEPER = CurrentUser(user_id="hk-1", hotel_id=H1, role="housekeeper", email="h@x.com")


def _role(user_id, tenant=H1, role="housekeeper", active=True, rate=None, dept=None, created="2026-01-01T00:00:00Z", custom=None):
    return {"id": f"role-{user_id}-{role}", "user_id": user_id, "tenant_id": tenant, "role": role, "department_id": dept,
            "is_active": active, "created_at": created, "custom_role_id": custom, "hourly_rate": rate}


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB({
        "user_roles": [
            _role("gm-1", role="gm"),
            _role("hk-1", role="housekeeper", rate=15.5, dept=DEPT_H1),
            _role("eng-old", role="engineer", active=False),
            _role("gm-9", tenant=H2, role="gm"),
            _role("foreign-1", tenant=H2, role="housekeeper"),
        ],
        "user_profiles": [
            {"id": "gm-1", "tenant_id": H1, "full_name": "Gina GM", "phone": "5125550100"},
            {"id": "hk-1", "tenant_id": H1, "full_name": "Hector Hk", "preferred_name": "Hec", "phone": "5125550101"},
            {"id": "eng-old", "tenant_id": H1, "full_name": "Old Eng"},
            {"id": "foreign-1", "tenant_id": H2, "full_name": "Foreign Person"},
        ],
        "departments": [
            {"id": DEPT_H1, "tenant_id": H1, "name": "Housekeeping", "code": "HK", "color": "#111"},
            {"id": DEPT_H2, "tenant_id": H2, "name": "Other Hotel Dept", "code": "OD", "color": "#222"},
        ],
        "custom_roles": [
            {"id": "cr-h1", "hotel_id": H1, "name": "Lead", "is_active": True},
            {"id": "cr-h2", "hotel_id": H2, "name": "Foreign Lead", "is_active": True},
        ],
        "staff_role_schedules": [],
        "staff_invitations": [],
    })
    for mod in (staff_router, inv_router, sched_router):
        monkeypatch.setattr(mod, "supabase", fake)
    return fake


def _gate(module, path, method):
    """The real require_role dependency attached to a route."""
    for route in module.router.routes:
        if route.path == path and method in route.methods:
            for dep in route.dependant.dependencies:
                if dep.call.__name__ == "check_role":
                    return dep.call
    raise AssertionError(f"no role gate on {method} {path}")


async def _denied(module, path, method, user):
    with pytest.raises(HTTPException) as exc:
        await _gate(module, path, method)(current_user=user)
    assert exc.value.status_code == 403


# 1 / 2 — lifecycle listing ----------------------------------------------------
@pytest.mark.asyncio
async def test_default_list_is_active_only_and_unchanged_in_shape(db):
    data = (await staff_router.list_staff(GM))["data"]
    assert {s["user_id"] for s in data["staff"]} == {"gm-1", "hk-1"}
    assert data["total"] == 2
    hk = next(s for s in data["staff"] if s["user_id"] == "hk-1")
    # pre-existing contract fields are still present
    for key in ("id", "user_id", "hotel_id", "full_name", "email", "role", "department_id", "status",
                "avatar_url", "created_at", "custom_role_id", "custom_role_name", "hourly_rate"):
        assert key in hk
    assert hk["status"] == "active" and hk["department_name"] == "Housekeeping"


@pytest.mark.asyncio
async def test_gm_can_list_inactive_and_all(db):
    inactive = (await staff_router.list_staff(GM, status="inactive"))["data"]["staff"]
    assert [s["user_id"] for s in inactive] == ["eng-old"] and inactive[0]["status"] == "inactive"
    everyone = (await staff_router.list_staff(GM, status="all"))["data"]["staff"]
    assert {s["user_id"] for s in everyone} == {"gm-1", "hk-1", "eng-old"}
    assert "foreign-1" not in {s["user_id"] for s in everyone}  # tenant isolation


@pytest.mark.asyncio
async def test_non_gm_cannot_list_inactive_but_default_still_works(db):
    for user in (SUPERVISOR, ENGINEER):
        for status in ("inactive", "all"):
            with pytest.raises(HTTPException) as exc:
                await staff_router.list_staff(user, status=status)
            assert exc.value.status_code == 403
        assert (await staff_router.list_staff(user))["data"]["total"] == 2
    await _denied(staff_router, "/staff", "GET", HOUSEKEEPER)  # housekeepers never had directory access


@pytest.mark.asyncio
async def test_invalid_status_and_department_filter(db):
    with pytest.raises(HTTPException) as exc:
        await staff_router.list_staff(GM, status="bogus")
    assert exc.value.status_code == 422
    filtered = (await staff_router.list_staff(GM, department_id=DEPT_H1))["data"]["staff"]
    assert [s["user_id"] for s in filtered] == ["hk-1"]


@pytest.mark.asyncio
async def test_person_with_mixed_rows_is_one_active_person(db):
    db.rows["user_roles"].append(_role("hk-1", role="front_desk", active=False, created="2026-02-01T00:00:00Z"))
    people = (await staff_router.list_staff(GM, status="all"))["data"]["staff"]
    assert [p["status"] for p in people if p["user_id"] == "hk-1"] == ["active"]


# 3 — deactivate / reactivate and tenant isolation ----------------------------------
@pytest.mark.asyncio
async def test_deactivate_then_reactivate_retains_history(db):
    await staff_router.deactivate_staff("hk-1", GM)
    assert next(r for r in db.rows["user_roles"] if r["user_id"] == "hk-1")["is_active"] is False
    assert any(p["id"] == "hk-1" for p in db.rows["user_profiles"])  # profile/history kept
    assert "hk-1" not in {s["user_id"] for s in (await staff_router.list_staff(GM))["data"]["staff"]}
    res = await staff_router.reactivate_staff("hk-1", GM)
    assert res["data"]["status"] == "active"
    assert "hk-1" in {s["user_id"] for s in (await staff_router.list_staff(GM))["data"]["staff"]}


@pytest.mark.asyncio
async def test_cross_tenant_mutations_are_404_and_do_not_change_data(db):
    before = [dict(r) for r in db.rows["user_roles"]]
    for call in (
        lambda: staff_router.reactivate_staff("foreign-1", GM),
        lambda: staff_router.deactivate_staff("foreign-1", GM),
        lambda: staff_router.update_staff("foreign-1", {"role": "front_desk"}, GM),
        lambda: staff_router.update_staff("foreign-1", {"is_active": False}, GM),
        lambda: staff_router.get_staff_member("foreign-1", GM),
        lambda: staff_router.update_staff_profile("foreign-1", UpdateStaffProfileRequest(full_name="Hacked"), GM),
        lambda: sched_router.get_role_schedules("foreign-1", GM),
    ):
        with pytest.raises(HTTPException) as exc:
            await call()
        assert exc.value.status_code == 404
    assert db.rows["user_roles"] == before
    assert next(p for p in db.rows["user_profiles"] if p["id"] == "foreign-1")["full_name"] == "Foreign Person"


@pytest.mark.asyncio
async def test_reactivate_refuses_person_now_active_at_another_hotel(db):
    db.rows["user_roles"].append(_role("eng-old", tenant=H2, role="engineer", active=True))
    with pytest.raises(HTTPException) as exc:
        await staff_router.reactivate_staff("eng-old", GM)
    assert exc.value.status_code == 409


# 1/3 — admin-access safeguards ----------------------------------------------------
@pytest.mark.asyncio
async def test_gm_cannot_deactivate_or_demote_self(db):
    for call in (
        lambda: staff_router.deactivate_staff("gm-1", GM),
        lambda: staff_router.update_staff("gm-1", {"is_active": False}, GM),
        lambda: staff_router.update_staff("gm-1", {"role": "front_desk"}, GM),
    ):
        with pytest.raises(HTTPException) as exc:
            await call()
        assert exc.value.status_code == 400
    assert next(r for r in db.rows["user_roles"] if r["user_id"] == "gm-1")["is_active"] is True


@pytest.mark.asyncio
async def test_last_active_gm_cannot_be_removed_but_can_once_another_exists(db):
    other_gm = CurrentUser(user_id="gm-2", hotel_id=H1, role="gm", email="g2@x.com")
    db.rows["user_roles"].append(_role("gm-2", role="gm"))
    db.rows["user_roles"][0]["is_active"] = False  # gm-1 is now deactivated; gm-2 is the only active GM
    with pytest.raises(HTTPException) as exc:
        await staff_router.deactivate_staff("gm-2", CurrentUser(user_id="gm-3", hotel_id=H1, role="gm", email="x"))
    assert exc.value.status_code == 409
    with pytest.raises(HTTPException) as exc:
        await staff_router.update_staff("gm-2", {"role": "housekeeper"}, CurrentUser(user_id="gm-3", hotel_id=H1, role="gm", email="x"))
    assert exc.value.status_code == 409
    db.rows["user_roles"][0]["is_active"] = True  # a second active GM exists again
    await staff_router.deactivate_staff("gm-2", GM)
    assert other_gm.user_id == "gm-2"


@pytest.mark.asyncio
async def test_lifecycle_endpoints_are_gm_only(db):
    for path, method in (("/staff/{user_id}", "GET"), ("/staff/{user_id}/profile", "PATCH"),
                         ("/staff/{user_id}/reactivate", "POST"), ("/staff/{staff_id}", "PATCH"),
                         ("/staff/{staff_id}", "DELETE")):
        for user in (SUPERVISOR, ENGINEER, HOUSEKEEPER):
            await _denied(staff_router, path, method, user)


# 5 — departments / custom roles -------------------------------------------------
@pytest.mark.asyncio
async def test_department_assignment_validates_tenant_ownership(db):
    for body in ({"department_id": DEPT_H2}, {"custom_role_id": "cr-h2"}, {"role": "not-a-role"}):
        with pytest.raises(HTTPException) as exc:
            await staff_router.update_staff("hk-1", body, GM)
        assert exc.value.status_code == 422
    await staff_router.update_staff("hk-1", {"department_id": None}, GM)
    await staff_router.update_staff("hk-1", {"department_id": DEPT_H1, "custom_role_id": "cr-h1"}, GM)
    row = next(r for r in db.rows["user_roles"] if r["user_id"] == "hk-1")
    assert row["department_id"] == DEPT_H1 and row["custom_role_id"] == "cr-h1"


@pytest.mark.asyncio
async def test_departments_endpoint_is_tenant_scoped(db):
    names = [d["name"] for d in (await staff_router.list_staff_departments(SUPERVISOR))["data"]]
    assert names == ["Housekeeping"]
    await _denied(staff_router, "/staff/departments", "GET", HOUSEKEEPER)


@pytest.mark.asyncio
async def test_add_direct_rejects_foreign_department(db):
    from models.requests import AddStaffDirectRequest
    body = AddStaffDirectRequest(full_name="New Person", email="new@x.com", role="housekeeper", department_id=DEPT_H2)
    with pytest.raises(HTTPException) as exc:
        await staff_router.add_staff_direct(body, GM)
    assert exc.value.status_code == 422
    assert db.auth.admin.created == []  # no auth user created for a rejected request


@pytest.mark.asyncio
async def test_add_direct_persists_department_and_phone(db):
    from models.requests import AddStaffDirectRequest
    body = AddStaffDirectRequest(full_name="New Person", email="new@x.com", role="housekeeper", department_id=DEPT_H1, phone="5125550199")
    res = await staff_router.add_staff_direct(body, GM)
    uid = res["data"]["user_id"]
    assert next(r for r in db.rows["user_roles"] if r["user_id"] == uid)["department_id"] == DEPT_H1
    assert next(p for p in db.rows["user_profiles"] if p["id"] == uid)["phone"] == "5125550199"


@pytest.mark.asyncio
async def test_add_direct_cannot_take_over_an_account_that_belongs_to_a_hotel(db, monkeypatch):
    """Security: an existing auth user with a profile/role must never get their password reset."""
    from models.requests import AddStaffDirectRequest
    db.auth.admin.users.append(SimpleNamespace(id="foreign-1", email="victim@x.com", email_confirmed_at="2026-01-01"))

    def exists(_attrs):
        raise Exception("A user with this email address has already been registered")
    db.auth.admin.create_user = exists
    monkeypatch.setattr(staff_router.httpx, "get", lambda *a, **k: SimpleNamespace(
        raise_for_status=lambda: None, json=lambda: {"users": [{"id": "foreign-1", "email": "victim@x.com"}]}))
    body = AddStaffDirectRequest(full_name="Evil", email="victim@x.com", role="housekeeper")
    with pytest.raises(HTTPException) as exc:
        await staff_router.add_staff_direct(body, GM)
    assert exc.value.status_code == 409
    assert db.auth.admin.password_updates == []
    assert next(p for p in db.rows["user_profiles"] if p["id"] == "foreign-1")["tenant_id"] == H2


# 4 — profile --------------------------------------------------------------------
@pytest.mark.asyncio
async def test_profile_update_persists_and_detail_reflects_it(db):
    res = await staff_router.update_staff_profile(
        "hk-1", UpdateStaffProfileRequest(preferred_name="Hector H", phone="5125550123", avatar_url="https://cdn.x/a.png"), GM)
    assert res["data"]["preferred_name"] == "Hector H"
    detail = (await staff_router.get_staff_member("hk-1", GM))["data"]
    assert detail["preferred_name"] == "Hector H" and detail["phone"] == "5125550123"
    assert detail["department_name"] == "Housekeeping" and detail["hourly_rate"] == 15.5


@pytest.mark.asyncio
async def test_profile_update_cannot_change_email_or_unknown_fields(db):
    for payload in ({"email": "attacker@x.com"}, {"hourly_rate": 1}, {"tenant_id": H2}, {"id": "gm-1"}):
        with pytest.raises(ValidationError):
            UpdateStaffProfileRequest(**payload)


@pytest.mark.asyncio
async def test_profile_update_validation(db):
    for body in (UpdateStaffProfileRequest(), UpdateStaffProfileRequest(avatar_url="javascript:alert(1)")):
        with pytest.raises(HTTPException) as exc:
            await staff_router.update_staff_profile("hk-1", body, GM)
        assert exc.value.status_code == 422
    with pytest.raises(ValidationError):
        UpdateStaffProfileRequest(phone="not a phone!!")


@pytest.mark.asyncio
async def test_detail_includes_deactivated_person(db):
    detail = (await staff_router.get_staff_member("eng-old", GM))["data"]
    assert detail["status"] == "inactive" and detail["full_name"] == "Old Eng"


# 7 — hourly rate never leaks ---------------------------------------------------------
@pytest.mark.asyncio
async def test_hourly_rate_and_phone_only_in_gm_responses(db):
    for user in (SUPERVISOR, ENGINEER):
        for member in (await staff_router.list_staff(user))["data"]["staff"]:
            assert "hourly_rate" not in member and "phone" not in member
    gm_view = (await staff_router.list_staff(GM))["data"]["staff"]
    assert next(s for s in gm_view if s["user_id"] == "hk-1")["hourly_rate"] == 15.5
    assert "hourly_rate" not in (await staff_router.update_staff_profile(
        "hk-1", UpdateStaffProfileRequest(preferred_name="x"), GM))["data"]
    await _denied(staff_router, "/staff/{staff_id}", "PATCH", ENGINEER)  # setting the rate stays GM-only
