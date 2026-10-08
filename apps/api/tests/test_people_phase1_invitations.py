"""People Phase 1 — invitation lifecycle/acceptance and temporary role coverage."""
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from middleware.auth import CurrentUser
from models.requests import CreateRoleScheduleRequest, InviteStaffRequest, ReissueInvitationRequest
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
HOUSEKEEPER = CurrentUser(user_id="hk-1", hotel_id=H1, role="housekeeper", email="h@x.com")


def _iso(delta_days=0, delta_seconds=0):
    return (datetime.now(timezone.utc) + timedelta(days=delta_days, seconds=delta_seconds)).isoformat()


def _role(user_id, tenant=H1, role="housekeeper", active=True):
    return {"id": f"role-{user_id}", "user_id": user_id, "tenant_id": tenant, "role": role, "is_active": active,
            "department_id": None, "created_at": "2026-01-01T00:00:00Z", "custom_role_id": None, "hourly_rate": None}


def _invite_body(email="new@x.com", role="housekeeper", dept=None):
    return InviteStaffRequest(email=email, role=role, full_name="New Person", department_id=dept)


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB({
        "user_roles": [_role("gm-1", role="gm"), _role("hk-1"), _role("eng-1", role="engineer"),
                       _role("fd-1", role="front_desk"), _role("old-hk", active=False),
                       _role("gm-9", tenant=H2, role="gm"), _role("foreign-1", tenant=H2)],
        "user_profiles": [], "staff_invitations": [], "staff_role_schedules": [],
        "departments": [{"id": DEPT_H1, "tenant_id": H1, "name": "Housekeeping", "code": "HK"},
                        {"id": DEPT_H2, "tenant_id": H2, "name": "Other", "code": "OT"}],
    })
    for mod in (staff_router, inv_router, sched_router):
        monkeypatch.setattr(mod, "supabase", fake)
    return fake


def _seed_invitation(db, *, email="seed@x.com", tenant=H1, expires=None, revoked=None, accepted=None, sent=None, count=1, role="housekeeper", created=None):
    row = {"id": f"inv-{len(db.rows['staff_invitations']) + 1}", "tenant_id": tenant, "email": email, "role": role,
           "department_id": None, "invited_by": "gm-1", "token": "tok", "full_name": "Seed Person", "phone": None,
           "expires_at": expires or _iso(3), "accepted_at": accepted, "revoked_at": revoked,
           "created_at": created or _iso(-1), "last_sent_at": sent or _iso(-1), "send_count": count,
           "delivery_status": "requested", "delivery_error": None}
    db.rows["staff_invitations"].append(row)
    return row


async def _denied(module, path, method, user):
    for route in module.router.routes:
        if route.path == path and method in route.methods:
            gate = next(d.call for d in route.dependant.dependencies if d.call.__name__ == "check_role")
            with pytest.raises(HTTPException) as exc:
                await gate(current_user=user)
            assert exc.value.status_code == 403
            return
    raise AssertionError(f"route not found {method} {path}")


# 6 — create / duplicates / delivery truthfulness -------------------------------------
@pytest.mark.asyncio
async def test_invite_creates_record_reports_request_outcome_and_hides_token(db):
    res = (await inv_router.invite_staff(_invite_body(dept=DEPT_H1), GM))["data"]
    assert res["status"] == "pending" and res["department_name"] == "Housekeeping"
    assert res["delivery"]["status"] == "requested" and "inbox" in res["delivery"]["note"]
    assert "token" not in res and db.auth.admin.invited[0][0] == "new@x.com"
    assert db.rows["staff_invitations"][0]["delivery_status"] == "requested"


@pytest.mark.asyncio
async def test_invite_reports_provider_failure_instead_of_claiming_success(db):
    db.auth.admin.invite_error = Exception("smtp exploded: secret-internal-host")
    res = (await inv_router.invite_staff(_invite_body(), GM))["data"]
    assert res["delivery"]["status"] == "failed"
    assert "secret-internal-host" not in str(res)  # provider internals are not echoed
    assert db.rows["staff_invitations"][0]["delivery_status"] == "failed"


@pytest.mark.asyncio
async def test_invite_existing_account_is_reported_not_silently_swallowed(db):
    db.auth.admin.invite_error = Exception("A user with this email address has already been registered")
    res = (await inv_router.invite_staff(_invite_body(), GM))["data"]
    assert res["delivery"]["status"] == "existing_account" and "no email was sent" in res["delivery"]["error"]


@pytest.mark.asyncio
async def test_duplicate_pending_invite_is_409_and_expired_one_is_superseded(db):
    await inv_router.invite_staff(_invite_body(), GM)
    with pytest.raises(HTTPException) as exc:
        await inv_router.invite_staff(_invite_body(email="NEW@x.com"), GM)  # email is case-normalised
    assert exc.value.status_code == 409
    db.rows["staff_invitations"][0]["expires_at"] = _iso(-1)
    await inv_router.invite_staff(_invite_body(), GM)
    live = [r for r in db.rows["staff_invitations"] if not r.get("revoked_at") and not r.get("accepted_at")]
    assert len(live) == 1 and db.rows["staff_invitations"][0]["revoked_at"]


@pytest.mark.asyncio
async def test_invite_validates_department_tenant_and_daily_cap(db):
    with pytest.raises(HTTPException) as exc:
        await inv_router.invite_staff(_invite_body(dept=DEPT_H2), GM)
    assert exc.value.status_code == 422 and db.rows["staff_invitations"] == []
    for i in range(inv_router.MAX_INVITATIONS_PER_DAY):
        _seed_invitation(db, email=f"u{i}@x.com", accepted=_iso(-0.1), created=_iso(-0.1))
    with pytest.raises(HTTPException) as exc:
        await inv_router.invite_staff(_invite_body(), GM)
    assert exc.value.status_code == 429


@pytest.mark.asyncio
async def test_invitation_endpoints_are_gm_only(db):
    for path, method in (("/staff/invite", "POST"), ("/staff/invitations", "GET"),
                         ("/staff/invitations/{invitation_id}/resend", "POST"),
                         ("/staff/invitations/{invitation_id}", "DELETE"),
                         ("/staff/invitations/{invitation_id}/reissue", "POST")):
        for user in (SUPERVISOR, HOUSEKEEPER):
            await _denied(inv_router, path, method, user)


# list / status ---------------------------------------------------------------------
@pytest.mark.asyncio
async def test_list_statuses_and_tenant_scope(db):
    pending = _seed_invitation(db, email="p@x.com")
    expired = _seed_invitation(db, email="e@x.com", expires=_iso(-1))
    revoked = _seed_invitation(db, email="r@x.com", revoked=_iso(-1))
    accepted = _seed_invitation(db, email="a@x.com", accepted=_iso(-1))
    _seed_invitation(db, email="other@x.com", tenant=H2)

    def ids(res): return {i["id"]: i["status"] for i in res["data"]["invitations"]}
    assert ids(await inv_router.list_invitations(current_user=GM)) == {pending["id"]: "pending", expired["id"]: "expired"}
    assert ids(await inv_router.list_invitations(status="revoked", current_user=GM)) == {revoked["id"]: "revoked"}
    assert ids(await inv_router.list_invitations(status="accepted", current_user=GM)) == {accepted["id"]: "accepted"}
    assert len(ids(await inv_router.list_invitations(status="all", current_user=GM))) == 4
    for item in (await inv_router.list_invitations(status="all", current_user=GM))["data"]["invitations"]:
        assert "token" not in item and item["hotel_id"] == H1 and item["expires_at"]
    with pytest.raises(HTTPException):
        await inv_router.list_invitations(status="nope", current_user=GM)


# resend / revoke / reissue -----------------------------------------------------------
@pytest.mark.asyncio
async def test_resend_rotates_token_renews_expiry_and_reports_delivery(db):
    inv = _seed_invitation(db, expires=_iso(-1), sent=_iso(-1), count=2)
    res = (await inv_router.resend_invitation(inv["id"], GM))["data"]
    row = db.rows["staff_invitations"][0]
    assert res["status"] == "pending" and row["send_count"] == 3 and row["token"] != "tok"
    assert res["delivery"]["status"] == "requested" and db.auth.admin.invited[0][0] == "seed@x.com"


@pytest.mark.asyncio
async def test_resend_is_rate_limited_per_invitation(db):
    just_sent = _seed_invitation(db, sent=_iso(delta_seconds=-5))
    with pytest.raises(HTTPException) as exc:
        await inv_router.resend_invitation(just_sent["id"], GM)
    assert exc.value.status_code == 429 and "Retry-After" in exc.value.headers
    maxed = _seed_invitation(db, email="m@x.com", count=inv_router.MAX_SENDS_PER_INVITATION)
    with pytest.raises(HTTPException) as exc:
        await inv_router.resend_invitation(maxed["id"], GM)
    assert exc.value.status_code == 429
    assert db.auth.admin.invited == []


@pytest.mark.asyncio
async def test_resend_and_revoke_reject_wrong_state_and_foreign_tenant(db):
    revoked = _seed_invitation(db, email="r@x.com", revoked=_iso(-1))
    accepted = _seed_invitation(db, email="a@x.com", accepted=_iso(-1))
    foreign = _seed_invitation(db, email="f@x.com", tenant=H2)
    for inv_id in (revoked["id"], accepted["id"]):
        with pytest.raises(HTTPException) as exc:
            await inv_router.resend_invitation(inv_id, GM)
        assert exc.value.status_code == 409
    with pytest.raises(HTTPException) as exc:
        await inv_router.revoke_invitation(accepted["id"], GM)
    assert exc.value.status_code == 409
    for fn in (inv_router.resend_invitation, inv_router.revoke_invitation):
        with pytest.raises(HTTPException) as exc:
            await fn(foreign["id"], GM)
        assert exc.value.status_code == 404
    assert foreign["revoked_at"] is None and not db.auth.admin.invited


@pytest.mark.asyncio
async def test_revoke_then_reinvite_same_email_is_allowed(db):
    created = (await inv_router.invite_staff(_invite_body(), GM))["data"]
    revoked = (await inv_router.revoke_invitation(created["id"], GM))["data"]
    assert revoked["status"] == "revoked"
    assert (await inv_router.revoke_invitation(created["id"], GM))["data"]["status"] == "revoked"  # idempotent
    again = (await inv_router.invite_staff(_invite_body(), GM))["data"]
    assert again["status"] == "pending" and again["id"] != created["id"]


@pytest.mark.asyncio
async def test_reissue_revokes_old_and_applies_changes(db):
    old = (await inv_router.invite_staff(_invite_body(), GM))["data"]
    new = (await inv_router.reissue_invitation(
        old["id"], ReissueInvitationRequest(role="front_desk", department_id=DEPT_H1), GM))["data"]
    assert new["id"] != old["id"] and new["role"] == "front_desk" and new["department_id"] == DEPT_H1
    assert next(r for r in db.rows["staff_invitations"] if r["id"] == old["id"])["revoked_at"]
    with pytest.raises(HTTPException) as exc:
        await inv_router.reissue_invitation(new["id"], ReissueInvitationRequest(department_id=DEPT_H2), GM)
    assert exc.value.status_code == 422


# 7 — revoked / expired invitations cannot be used ------------------------------------------
def _auth_user(db, uid="u-new", email="new@x.com", confirmed="2026-01-01"):
    db.auth.admin.users.append(SimpleNamespace(id=uid, email=email, email_confirmed_at=confirmed))
    return CurrentUser(user_id=uid, hotel_id="", role="none", email=email)


@pytest.mark.asyncio
async def test_accept_pending_invitation_creates_profile_and_role_once(db):
    inv = _seed_invitation(db, email="new@x.com", role="engineer")
    inv["department_id"] = DEPT_H1
    user = _auth_user(db)
    res = (await inv_router.accept_invitation(user))["data"]
    assert res == {"accepted": True, "already_member": False, "hotel_id": H1, "role": "engineer"}
    role = next(r for r in db.rows["user_roles"] if r["user_id"] == "u-new")
    assert role["tenant_id"] == H1 and role["role"] == "engineer" and role["department_id"] == DEPT_H1
    assert next(p for p in db.rows["user_profiles"] if p["id"] == "u-new")["full_name"] == "Seed Person"
    assert inv["accepted_at"]
    again = (await inv_router.accept_invitation(user))["data"]
    assert again["already_member"] is True and len([r for r in db.rows["user_roles"] if r["user_id"] == "u-new"]) == 1
    assert all(i["status"] != "pending" for i in (await inv_router.list_invitations(current_user=GM))["data"]["invitations"])


@pytest.mark.asyncio
async def test_revoked_invitation_cannot_be_accepted(db):
    _seed_invitation(db, email="new@x.com", revoked=_iso(-1))
    with pytest.raises(HTTPException) as exc:
        await inv_router.accept_invitation(_auth_user(db))
    assert exc.value.status_code == 403
    assert not [r for r in db.rows["user_roles"] if r["user_id"] == "u-new"]


@pytest.mark.asyncio
async def test_expired_invitation_cannot_be_accepted(db):
    _seed_invitation(db, email="new@x.com", expires=_iso(-1))
    with pytest.raises(HTTPException) as exc:
        await inv_router.accept_invitation(_auth_user(db))
    assert exc.value.status_code == 410
    assert not [r for r in db.rows["user_roles"] if r["user_id"] == "u-new"]


@pytest.mark.asyncio
async def test_accept_requires_matching_confirmed_email_and_unclaimed_account(db):
    _seed_invitation(db, email="new@x.com")
    with pytest.raises(HTTPException) as exc:  # no invitation for this address
        await inv_router.accept_invitation(_auth_user(db, uid="u-x", email="someone-else@x.com"))
    assert exc.value.status_code == 404
    with pytest.raises(HTTPException) as exc:  # unconfirmed email
        await inv_router.accept_invitation(_auth_user(db, uid="u-y", confirmed=None))
    assert exc.value.status_code == 403
    db.rows["user_profiles"].append({"id": "u-z", "tenant_id": H2, "full_name": "Elsewhere"})
    with pytest.raises(HTTPException) as exc:  # already belongs to another hotel
        await inv_router.accept_invitation(_auth_user(db, uid="u-z"))
    assert exc.value.status_code == 409
    assert db.rows["staff_invitations"][0]["accepted_at"] is None


@pytest.mark.asyncio
async def test_pending_invite_wins_over_newer_revoked_one(db):
    _seed_invitation(db, email="new@x.com", tenant=H2)
    revoked = _seed_invitation(db, email="new@x.com", tenant=H1, revoked=_iso(-1))
    revoked["created_at"] = _iso(1)
    res = (await inv_router.accept_invitation(_auth_user(db)))["data"]
    assert res["hotel_id"] == H2


# 11 — temporary role coverage ------------------------------------------------------------
def _sched(role="housekeeping_supervisor", days=(1, 2), start=None, end=None):
    return CreateRoleScheduleRequest(override_role=role, days_of_week=list(days), start_date=start, end_date=end)


@pytest.mark.asyncio
async def test_housekeeper_can_be_scheduled_as_supervisor_with_dates(db):
    res = (await sched_router.create_role_schedule("hk-1", _sched(days=(2, 1), start=date.today(), end=date.today() + timedelta(days=30)), GM))["data"]
    assert res["days_of_week"] == [1, 2] and res["override_role"] == "housekeeping_supervisor"
    listed = (await sched_router.get_role_schedules("hk-1", GM))["data"]
    assert len(listed) == 1
    await sched_router.delete_role_schedule("hk-1", res["id"], GM)
    assert (await sched_router.get_role_schedules("hk-1", GM))["data"] == []


@pytest.mark.asyncio
async def test_meaningless_and_unsupported_coverage_is_rejected(db):
    for uid, role in (("eng-1", "engineer"), ("hk-1", "engineer"), ("fd-1", "housekeeping_supervisor"),
                      ("eng-1", "housekeeping_supervisor"), ("gm-1", "housekeeping_supervisor")):
        with pytest.raises(HTTPException) as exc:
            await sched_router.create_role_schedule(uid, _sched(role=role), GM)
        assert exc.value.status_code == 422, (uid, role)
    assert db.rows["staff_role_schedules"] == []


@pytest.mark.asyncio
async def test_coverage_date_day_and_overlap_validation(db):
    for bad_days in ((7,), (-1,), (1, 1)):  # rejected by the request model before reaching the router
        with pytest.raises(ValidationError):
            _sched(days=bad_days)
    cases = [
        _sched(start=date.today() + timedelta(days=5), end=date.today()),
        _sched(end=date.today() - timedelta(days=1)),
    ]
    for body in cases:
        with pytest.raises(HTTPException) as exc:
            await sched_router.create_role_schedule("hk-1", body, GM)
        assert exc.value.status_code == 422
    await sched_router.create_role_schedule("hk-1", _sched(days=(1, 2)), GM)
    with pytest.raises(HTTPException) as exc:
        await sched_router.create_role_schedule("hk-1", _sched(days=(2, 3)), GM)
    assert exc.value.status_code == 409
    await sched_router.create_role_schedule("hk-1", _sched(days=(4, 5)), GM)  # disjoint days are fine


@pytest.mark.asyncio
async def test_coverage_with_disjoint_date_windows_does_not_conflict(db):
    today = date.today()
    await sched_router.create_role_schedule("hk-1", _sched(days=(1,), start=today, end=today + timedelta(days=10)), GM)
    await sched_router.create_role_schedule("hk-1", _sched(days=(1,), start=today + timedelta(days=20), end=today + timedelta(days=30)), GM)
    with pytest.raises(HTTPException) as exc:
        await sched_router.create_role_schedule("hk-1", _sched(days=(1,), start=today + timedelta(days=5), end=today + timedelta(days=25)), GM)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_coverage_respects_tenant_deactivation_and_role_gate(db):
    for uid, status in (("foreign-1", 404), ("nobody", 404), ("old-hk", 409)):
        with pytest.raises(HTTPException) as exc:
            await sched_router.create_role_schedule(uid, _sched(), GM)
        assert exc.value.status_code == status
    mine = (await sched_router.create_role_schedule("hk-1", _sched(), GM))["data"]
    with pytest.raises(HTTPException) as exc:  # another hotel's GM cannot disable it
        await sched_router.delete_role_schedule("hk-1", mine["id"], GM_H2)
    assert exc.value.status_code == 404
    assert (await sched_router.get_role_schedules("hk-1", GM))["data"]
    for path, method in (("/staff/{user_id}/role-schedules", "POST"), ("/staff/{user_id}/role-schedules", "GET"),
                         ("/staff/{user_id}/role-schedules/{schedule_id}", "DELETE")):
        for user in (SUPERVISOR, HOUSEKEEPER):
            await _denied(sched_router, path, method, user)


@pytest.mark.asyncio
async def test_schedule_never_changes_server_side_role_or_picker_visibility(db):
    """Coverage is UI context only: the JWT role (not the schedule) drives require_role, and a
    scheduled housekeeper still has no staff-directory access."""
    await sched_router.create_role_schedule("hk-1", _sched(days=tuple(range(7))), GM)
    covered = (await staff_router.get_effective_role(HOUSEKEEPER))["data"]
    assert covered["base_role"] == "housekeeper"
    await _denied(staff_router, "/staff", "GET", HOUSEKEEPER)
    await _denied(staff_router, "/staff/{staff_id}", "PATCH", HOUSEKEEPER)
