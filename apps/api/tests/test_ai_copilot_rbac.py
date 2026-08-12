"""RBAC matrix + tenant-isolation + confirm_tasks validation tests for ai_copilot.py.

Encodes the Phase 6 audit-first RBAC contract (D-01/D-06): distinguishes genuinely
role-gated management endpoints from intentionally-open confirm/chat endpoints
(research Pitfall 6). Also proves confirm_tasks stays tenant-scoped and gets a
typed 422 validation gate (D-05, Pitfall 5 / T-06-12).

Deviation note: 06-PATTERNS.md's interface block first lists "/ai/insights (POST
insight variants)" under ROLE-GATED, but current code (routers/ai_copilot.py::
get_gm_insights, GET /ai/insights) has no require_role dependency -- only
get_current_user. The same context block resolves this explicitly: "/ai/insights
(GET) uses only get_current_user -- research flagged as 'verify intentional';
... keep open, assert it stays open." This suite follows that explicit
resolution and actual code (not the earlier, stale summary line), treating
/ai/insights as intentionally open -- matching Pitfall 6's contract and avoiding
a regression-inducing "fix."
"""
import inspect
import typing

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from middleware.auth import CurrentUser
from models.requests import AssignmentPreview
from routers import ai_copilot
from tests.smoke.fake_supabase import FakeDB


def _user(role: str, hotel_id: str = "hotel-1", user_id: str = "user-1") -> CurrentUser:
    return CurrentUser(user_id=user_id, hotel_id=hotel_id, role=role)


def _route(path: str, method: str):
    return next(
        r for r in ai_copilot.router.routes
        if r.path == path and method in r.methods
    )


def _role_check_dependency(route):
    """Return the require_role check-callable on a route, or None if the route
    has no role gate (only get_current_user)."""
    for dep in route.dependant.dependencies:
        if dep.call.__qualname__.startswith("require_role"):
            return dep.call
    return None


def _confirm_tasks_item_type():
    """The current element type of confirm_tasks' `tasks` param -- `dict` before
    Task 2 wires a typed TaskPreview, `TaskPreview` after. Used so this file does
    not need edits across the RED->GREEN transition."""
    sig = inspect.signature(ai_copilot.confirm_tasks)
    return typing.get_args(sig.parameters["tasks"].annotation)[0]


def _make_task_item(**data):
    item_type = _confirm_tasks_item_type()
    if item_type is dict:
        return data
    return item_type(**data)


ROLE_GATED_GET_PATHS = ["/ai/recommendations", "/ai/recommendations/metrics"]
DENIED_ROLES = ["housekeeper", "engineer", "front_desk"]
ALLOWED_ROLES = ["gm", "chief_engineer", "housekeeping_supervisor"]

# Intentionally-open endpoints (any authenticated role) per Pitfall 6 -- their
# sibling non-AI create endpoints are also open.
OPEN_ROUTES = [
    ("/ai/copilot/chat", "POST"),
    ("/ai/tasks/confirm", "POST"),
    ("/ai/work-orders/confirm", "POST"),
    ("/ai/guest-requests/confirm", "POST"),
    ("/ai/risk-alerts", "GET"),
    ("/ai/insights", "GET"),
]


# --- Role-gated matrix: /ai/recommendations, /ai/recommendations/metrics ---

@pytest.mark.asyncio
@pytest.mark.parametrize("path", ROLE_GATED_GET_PATHS)
@pytest.mark.parametrize("role", DENIED_ROLES)
async def test_rbac_matrix_role_gated_endpoints_deny_floor_roles(path, role):
    route = _route(path, "GET")
    role_check = _role_check_dependency(route)
    assert role_check is not None, f"GET {path} expected a require_role gate"
    with pytest.raises(HTTPException, match="not authorized"):
        await role_check(_user(role))


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ROLE_GATED_GET_PATHS)
@pytest.mark.parametrize("role", ALLOWED_ROLES)
async def test_rbac_matrix_role_gated_endpoints_allow_management_roles(path, role):
    route = _route(path, "GET")
    role_check = _role_check_dependency(route)
    result = await role_check(_user(role))
    assert result.role == role


# --- Intentionally-open endpoints stay open (Pitfall 6) ---

def test_open_endpoints_accept_any_role():
    for path, method in OPEN_ROUTES:
        route = _route(path, method)
        assert _role_check_dependency(route) is None, (
            f"{method} {path} unexpectedly gained a require_role gate -- "
            "this endpoint is intentionally open (Pitfall 6)"
        )


# --- /ai/risk-alerts maintenance_risks carries an asset id (AI-08) ---

@pytest.mark.asyncio
async def test_risk_alerts_asset_select_includes_id(monkeypatch):
    """AI-08: /ai/risk-alerts must select+return `id` on assets so the
    frontend can build a maintenance deep link. Asserts the select-string
    itself (not just the echoed row) because FakeDB does not enforce
    column projection like real PostgREST does."""
    db = FakeDB({
        "assets": [
            {"id": "asset-1", "tenant_id": "hotel-1", "name": "Boiler", "failure_risk_score": 85},
        ],
    })
    monkeypatch.setattr(ai_copilot, "supabase", db)

    response = await ai_copilot.get_risk_alerts(current_user=_user("gm"))

    assert response["data"]["maintenance_risks"][0]["id"] == "asset-1"
    asset_select_args = next(args for table, args in db.select_calls if table == "assets")
    assert "id" in " ".join(str(a) for a in asset_select_args)


# --- /ai/assignments/confirm excludes housekeeper ---

@pytest.mark.asyncio
async def test_assignments_confirm_excludes_housekeeper():
    route = _route("/ai/assignments/confirm", "POST")
    role_check = _role_check_dependency(route)
    assert role_check is not None
    with pytest.raises(HTTPException, match="not authorized"):
        await role_check(_user("housekeeper"))


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["housekeeping_supervisor", "engineer", "gm"])
async def test_assignments_confirm_allows_supervisor_engineer_gm(role):
    route = _route("/ai/assignments/confirm", "POST")
    role_check = _role_check_dependency(route)
    result = await role_check(_user(role))
    assert result.role == role


@pytest.mark.asyncio
async def test_confirm_assignments_tenant_scoped(monkeypatch):
    """Cross-tenant isolation for a confirm handler: a hotel-b supervisor's
    confirm writes must be scoped to hotel-b only, never hotel-a, even when a
    matching room number exists in both tenants."""
    db = FakeDB({
        "rooms": [
            {"id": "room-a", "tenant_id": "hotel-a", "room_number": "210"},
            {"id": "room-b", "tenant_id": "hotel-b", "room_number": "210"},
        ],
        "user_roles": [
            {"id": "role-b", "user_id": "hk-b", "tenant_id": "hotel-b",
             "role": "housekeeper", "is_active": True},
        ],
        "room_status": [
            {"id": "status-b", "room_id": "room-b", "tenant_id": "hotel-b",
             "assigned_to": None, "status": "DIRTY"},
        ],
    })
    monkeypatch.setattr(ai_copilot, "supabase", db)

    supervisor_b = _user("housekeeping_supervisor", hotel_id="hotel-b", user_id="sup-b")
    response = await ai_copilot.confirm_assignments(
        [AssignmentPreview(staff_name_hint="hk", staff_id="hk-b", room_numbers=["210"], task_ids=[])],
        current_user=supervisor_b,
    )

    assert response["data"]["assigned_count"] == 1
    room_assignments = [row for row in db.rows.get("room_assignments", []) if row]
    assert room_assignments, "expected an upserted room_assignments row"
    assert all(row["tenant_id"] == "hotel-b" for row in room_assignments)
    assert all(row["room_id"] != "room-a" for row in room_assignments)
    hotel_a_assignments = [row for row in room_assignments if row["tenant_id"] == "hotel-a"]
    assert hotel_a_assignments == []


# --- confirm_tasks tenant isolation ---

@pytest.mark.asyncio
async def test_confirm_tasks_tenant_scoped(monkeypatch):
    db = FakeDB({
        "rooms": [
            {"id": "room-a", "tenant_id": "hotel-a", "room_number": "210"},
            {"id": "room-b", "tenant_id": "hotel-b", "room_number": "210"},
        ],
    })
    monkeypatch.setattr(ai_copilot, "supabase", db)

    hotel_b_user = _user("housekeeper", hotel_id="hotel-b", user_id="staff-b")
    item = _make_task_item(
        title="Room 210 needs towels",
        task_type="housekeeping",
        priority="normal",
        room_number_display="210",
    )

    response = await ai_copilot.confirm_tasks([item], current_user=hotel_b_user)

    assert response["data"]["created_count"] == 1
    created = response["data"]["tasks"][0]
    assert created["tenant_id"] == "hotel-b"
    assert created["room_id"] == "room-b"

    hotel_a_tasks = [row for row in db.rows.get("tasks", []) if row.get("tenant_id") == "hotel-a"]
    assert hotel_a_tasks == []


# --- confirm_tasks input validation (Pitfall 5 / T-06-12) ---

def test_confirm_tasks_malformed_returns_422():
    """A malformed tasks payload (missing required "title") must be rejected via
    pydantic validation (422), not raise a raw KeyError/500. RED until Task 2
    gives confirm_tasks a typed TaskPreview body."""
    item_type = _confirm_tasks_item_type()
    if item_type is dict:
        pytest.fail(
            "confirm_tasks still accepts a raw list[dict] -- Task 2 has not yet "
            "wired TaskPreview, so malformed input has no validation gate (RED)"
        )
    with pytest.raises(ValidationError):
        item_type(description="missing required title")


def test_confirm_tasks_stays_open_by_design():
    """Pitfall 6: confirm_tasks must NOT gain a role gate as a side effect of
    typing its body -- it stays open, matching its sibling create endpoints."""
    route = _route("/ai/tasks/confirm", "POST")
    assert _role_check_dependency(route) is None
