"""Shared fixtures for the Phase 5 API tests (availability, time off, shift swaps)."""
from datetime import date, datetime, timedelta, timezone

import pytest

from middleware.auth import CurrentUser
from routers import scheduling as sched
from routers import scheduling_absences as absences
from routers import scheduling_availability as avail
from routers import scheduling_coverage as coverage
from routers import scheduling_inbox as inbox
from routers import scheduling_leave as leave
from routers import scheduling_requests as requests_router
from routers import scheduling_swaps as swaps
from routers import scheduling_team as team
from routers import shifts as shifts_router
from services import availability_store, coverage_fill, coverage_store, request_common, scheduling_access as access

from .request_fakes import RequestsDB
from .test_scheduling_foundation import (
    D_ENG, D_HK, DAY, HOTEL, S_ENG, S_EVE, S_MORN, S_NIGHT, U_ENG, U_HK1, U_HK2, U_SUP, role, seed, stored_id,  # noqa: F401  (re-exported for the tests)
)

U_HK3 = "a0000009-0000-4000-8000-000000000009"
U_ENG2 = "a0000010-0000-4000-8000-000000000010"
HK1 = CurrentUser(user_id=U_HK1, hotel_id=HOTEL, role="housekeeper", email="h1@x.test")
HK2 = CurrentUser(user_id=U_HK2, hotel_id=HOTEL, role="housekeeper", email="h2@x.test")
HK3 = CurrentUser(user_id=U_HK3, hotel_id=HOTEL, role="housekeeper", email="h3@x.test")
ENG = CurrentUser(user_id=U_ENG, hotel_id=HOTEL, role="engineer", email="e@x.test")
SUP = CurrentUser(user_id=U_SUP, hotel_id=HOTEL, role="housekeeping_supervisor", email="s@x.test")
GM = CurrentUser(user_id="a0000006-0000-4000-8000-000000000006", hotel_id=HOTEL, role="gm", email="gm@x.test")
CHIEF = CurrentUser(user_id="a0000099-0000-4000-8000-000000000099", hotel_id=HOTEL, role="chief_engineer", email="c@x.test")
OTHER_GM = CurrentUser(user_id="a00000aa-0000-4000-8000-0000000000aa", hotel_id="hotel-b", role="gm", email="o@x.test")

MODULES = (sched, team, access, shifts_router, absences, coverage, requests_router, coverage_store, coverage_fill,
           avail, leave, swaps, inbox, request_common, availability_store)
D2 = DAY + timedelta(days=1)       # Wednesday
D3 = DAY + timedelta(days=2)       # Thursday
WEEK_MON = DAY - timedelta(days=1)  # the Monday before DAY (Tuesday 2030-01-08)


def seed_requests():
    rows = seed()
    rows["user_roles"] += [role(U_HK3, "housekeeper", D_HK), role(U_ENG2, "engineer", D_ENG)]
    rows["user_profiles"] += [{"id": U_HK3, "full_name": "Cy Diaz"}, {"id": U_ENG2, "full_name": "Fay Ito"}]
    for table in ("absence_records", "coverage_gaps", "coverage_offers", "coverage_claims", "room_assignments", "room_status",
                  "employee_availability", "time_off_requests", "shift_swap_requests"):
        rows[table] = []
    return rows


def make_db(monkeypatch):
    database = RequestsDB(seed_requests(), unique_indexes=[
        ("coverage_offers", "uq_offer_pending", ("gap_id", "user_id"), {"status": "pending"}),
        ("coverage_claims", "uq_claim_pending", ("gap_id", "user_id"), {"status": "pending"}),
        ("employee_availability", "uq_availability_exception_active", ("tenant_id", "user_id", "exception_date"), {"status": "active", "kind": "exception"}),
        ("time_off_requests", "uq_time_off_idempotency", ("tenant_id", "user_id", "idempotency_key"), {}),
    ])
    for module in MODULES:
        monkeypatch.setattr(module, "supabase", database)
    monkeypatch.setattr(coverage_fill, "load_roster", lambda *a, **k: [])
    return database


@pytest.fixture
def db(monkeypatch):
    return make_db(monkeypatch)


async def scheduled(user=U_HK1, shift_id=S_MORN, day=DAY, actor=SUP, **extra):
    return await stored_id(actor=actor, user=user, shift_id=shift_id, day=day, **extra)


def assignment(db, assignment_id):
    return next(a for a in db.rows["shift_assignments"] if a["id"] == assignment_id)


def audit(db, resource_type=None, action=None):
    return [e for e in db.rows["operational_audit_events"]
            if (resource_type is None or e["resource_type"] == resource_type) and (action is None or e["action"] == action)]


def week_body(rev=0, eff=None, **days):
    """days: mon='07:00-15:00' | tue='off' | wed='07:00-11:00,12:00-15:00' ..."""
    from models.leave_requests import AvailabilityDayIn, ReplaceAvailabilityRequest
    names = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
    out = []
    for key, text in days.items():
        windows = [] if text == "off" else [{"start": w.split("-")[0], "end": w.split("-")[1]} for w in text.split(",")]
        out.append(AvailabilityDayIn(weekday=names.index(key), mode="unavailable" if text == "off" else "available", windows=windows))
    return ReplaceAvailabilityRequest(expected_revision=rev, effective_from=eff, days=out)


def today_plus(days: int) -> date:
    return (datetime.now(timezone.utc) + timedelta(days=days)).date()


def _next_tuesday(days_ahead: int) -> date:
    day = today_plus(days_ahead)
    return day + timedelta(days=(1 - day.weekday()) % 7)


NEAR_TUE = _next_tuesday(3)   # inside the 60-day look-ahead used when availability is checked against upcoming shifts
