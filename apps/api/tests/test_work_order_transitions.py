"""Phase 1 contract tests for work-order transitions.

As an engineer, I need only valid state changes so urgent work cannot be
silently lost. As a GM, I need every exceptional change to include a reason.
"""

import pytest
from fastapi import HTTPException

from middleware.auth import CurrentUser, require_role
from models.requests import CreateWorkOrderRequest, TransitionWorkOrderRequest, UpdateWorkOrderRequest
from routers import work_orders as work_orders_router
from services.work_orders.transitions import (
    TransitionRequest,
    validate_work_order_transition,
)


def transition(
    from_status: str,
    to_status: str,
    *,
    role: str = "engineer",
    reason_code: str | None = None,
    reason_note: str | None = None,
    override: bool = False,
):
    return validate_work_order_transition(
        current_status=from_status,
        request=TransitionRequest(
            status=to_status,
            reason_code=reason_code,
            reason_note=reason_note,
            override=override,
        ),
        actor_role=role,
    )


def test_emergency_escalation_is_a_valid_operational_transition():
    result = transition("open", "escalated")

    assert result.status == "escalated"
    assert result.requires_escalation_notification is True


class _CreateWorkOrderQuery:
    def __init__(self, database: "_CreateWorkOrderDatabase"):
        self.database = database

    def insert(self, payload: dict):
        self.database.inserted_payload = payload
        return self

    def execute(self):
        if "source" in self.database.inserted_payload:
            raise AssertionError("work_orders schema has no source column")
        return type("Result", (), {"data": [{"id": "work-order-1", **self.database.inserted_payload}]})()


class _CreateWorkOrderDatabase:
    def __init__(self):
        self.inserted_payload: dict = {}

    def table(self, table_name: str):
        assert table_name == "work_orders"
        return _CreateWorkOrderQuery(self)


@pytest.mark.asyncio
async def test_create_work_order_uses_only_work_orders_schema_columns(monkeypatch):
    database = _CreateWorkOrderDatabase()
    monkeypatch.setattr(work_orders_router, "supabase", database)

    response = await work_orders_router.create_work_order(
        CreateWorkOrderRequest(title="Restore lobby HVAC", category="hvac", priority="emergency"),
        CurrentUser(user_id="engineer-1", hotel_id="hotel-1", role="engineer", email="engineer@example.com"),
    )

    assert response["data"]["priority"] == "emergency"
    assert database.inserted_payload["tenant_id"] == "hotel-1"


@pytest.mark.parametrize(
"from_status,to_status,reason_code",
    [
        ("in_progress", "on_hold", "awaiting_parts"),
        ("in_progress", "cancelled", "duplicate"),
        ("completed", "open", "reopened_after_failure"),
    ],
)
def test_exceptional_transitions_require_a_structured_reason(
    from_status: str, to_status: str, reason_code: str
):
    result = transition(from_status, to_status, reason_code=reason_code)

    assert result.reason_code == reason_code


@pytest.mark.parametrize(
"from_status,to_status",
    [
        ("in_progress", "on_hold"),
        ("in_progress", "cancelled"),
        ("completed", "open"),
    ],
)
def test_exceptional_transitions_reject_missing_reason(
    from_status: str, to_status: str
):
    with pytest.raises(HTTPException) as exc:
        transition(from_status, to_status)

    assert exc.value.status_code == 422


def test_invalid_transition_is_rejected_without_an_explicit_override():
    with pytest.raises(HTTPException) as exc:
        transition("completed", "in_progress", reason_code="manager_override")

    assert exc.value.status_code == 409


def test_only_management_can_use_an_override():
    with pytest.raises(HTTPException) as exc:
        transition(
            "completed",
            "in_progress",
            role="front_desk",
            reason_code="manager_override",
            override=True,
        )

    assert exc.value.status_code == 403

    result = transition(
        "completed",
        "in_progress",
        role="engineer",
        reason_code="manager_override",
        reason_note="Technician accidentally completed the order.",
        override=True,
    )

    assert result.status == "in_progress"


class _TransitionQuery:
    def __init__(self, database: "_TransitionDatabase", table: str):
        self.database = database
        self.table_name = table
        self.filters: dict[str, str] = {}

    def select(self, *_args):
        return self

    def eq(self, column: str, value: str):
        self.filters[column] = value
        return self

    def maybe_single(self):
        return self

    def execute(self):
        rows = [
            row
            for row in self.database.tables.get(self.table_name, [])
            if all(row.get(column) == value for column, value in self.filters.items())
        ]
        return type("Result", (), {"data": rows[0] if rows else None})()


class _TransitionDatabase:
    def __init__(self):
        self.tables = {
            "work_orders": [
                {
                    "id": "work-order-1",
                    "tenant_id": "hotel-1",
                    "assigned_to": "engineer-1",
                    "status": "open",
                    "priority": "emergency",
                }
            ]
        }
        self.rpc_calls: list[tuple[str, dict]] = []

    def table(self, table: str):
        return _TransitionQuery(self, table)

    def rpc(self, function_name: str, payload: dict):
        self.rpc_calls.append((function_name, payload))
        work_order = self.tables["work_orders"][0]
        old_status = work_order["status"]
        work_order["status"] = payload["p_new_status"]
        self.tables.setdefault("operational_audit_events", []).append(
            {
                "resource_type": "work_order",
                "resource_id": work_order["id"],
                "hotel_id": work_order["tenant_id"],
                "actor_id": payload["p_actor_id"],
                "actor_role": payload["p_actor_role"],
                "old_state": {"status": old_status},
                "new_state": {"status": payload["p_new_status"]},
                "reason_code": payload["p_reason_code"],
                "source": payload["p_source"],
            }
        )
        result = type("Result", (), {"data": [work_order]})()
        return type("RpcQuery", (), {"execute": lambda _self: result})()


@pytest.mark.asyncio
async def test_transition_endpoint_persists_an_append_only_audit_event(monkeypatch):
    database = _TransitionDatabase()
    monkeypatch.setattr(work_orders_router, "supabase", database)

    response = await work_orders_router.transition_work_order(
        "work-order-1",
        TransitionWorkOrderRequest(status="escalated", source="web"),
        CurrentUser(
            user_id="engineer-1",
            hotel_id="hotel-1",
            role="engineer",
            email="engineer@example.com",
        ),
    )

    assert response["data"]["status"] == "escalated"
    assert database.rpc_calls[0][0] == "transition_work_order_with_audit"
    assert database.tables["operational_audit_events"] == [
        {
            "resource_type": "work_order",
            "resource_id": "work-order-1",
            "hotel_id": "hotel-1",
            "actor_id": "engineer-1",
            "actor_role": "engineer",
            "old_state": {"status": "open"},
            "new_state": {"status": "escalated"},
            "reason_code": None,
            "source": "web",
        }
    ]


@pytest.mark.asyncio
async def test_claim_uses_the_atomic_transition_audit_rpc(monkeypatch):
    database = _TransitionDatabase()
    monkeypatch.setattr(work_orders_router, "supabase", database)

    response = await work_orders_router.claim_work_order(
        "work-order-1",
        CurrentUser(
            user_id="engineer-1",
            hotel_id="hotel-1",
            role="engineer",
            email="engineer@example.com",
        ),
    )

    assert response["data"]["status"] == "in_progress"
    assert database.rpc_calls[0][0] == "transition_work_order_with_audit"
    assert database.rpc_calls[0][1]["p_new_status"] == "in_progress"


@pytest.mark.asyncio
async def test_status_patch_is_rejected_so_it_cannot_bypass_audit_history(monkeypatch):
    database = _TransitionDatabase()
    monkeypatch.setattr(work_orders_router, "supabase", database)

    with pytest.raises(HTTPException) as exc:
        await work_orders_router.update_work_order(
            "work-order-1",
            UpdateWorkOrderRequest(status="escalated"),
            CurrentUser(
                user_id="engineer-1",
                hotel_id="hotel-1",
                role="engineer",
                email="engineer@example.com",
            ),
        )

    assert exc.value.status_code == 422
    assert database.tables["work_orders"][0]["status"] == "open"


# ---------------------------------------------------------------------------
# RBAC — the require_role guard blocks non-management roles
# ---------------------------------------------------------------------------

_NON_MANAGEMENT_ROLES = ["housekeeper", "housekeeping_supervisor", "front_desk"]


@pytest.mark.parametrize("role", _NON_MANAGEMENT_ROLES)
@pytest.mark.asyncio
async def test_non_management_roles_are_blocked_by_rbac_guard(role: str):
    check = require_role("engineer", "gm")
    with pytest.raises(HTTPException) as exc:
        await check(
            current_user=CurrentUser(
                user_id="u1",
                hotel_id="hotel-1",
                role=role,
                email=f"{role}@example.com",
            )
        )
    assert exc.value.status_code == 403


@pytest.mark.parametrize("role", ["engineer", "gm"])
@pytest.mark.asyncio
async def test_management_roles_pass_the_rbac_guard(role: str):
    check = require_role("engineer", "gm")
    user = CurrentUser(
        user_id="u1",
        hotel_id="hotel-1",
        role=role,
        email=f"{role}@example.com",
    )
    result = await check(current_user=user)
    assert result.role == role


# ---------------------------------------------------------------------------
# Tenant isolation — cross-hotel work orders return 404, never transition
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_transition_rejects_work_order_from_different_tenant(monkeypatch):
    database = _TransitionDatabase()
    monkeypatch.setattr(work_orders_router, "supabase", database)

    with pytest.raises(HTTPException) as exc:
        await work_orders_router.transition_work_order(
            "work-order-1",
            TransitionWorkOrderRequest(status="in_progress", source="web"),
            CurrentUser(
                user_id="engineer-2",
                hotel_id="hotel-2",  # different tenant
                role="engineer",
                email="engineer@hotelb.com",
            ),
        )

    assert exc.value.status_code == 404
    assert database.tables.get("operational_audit_events", []) == []


# ---------------------------------------------------------------------------
# Audit reconstruction — full lifecycle event sequence is preserved
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_full_lifecycle_is_reconstructable_from_audit_events(monkeypatch):
    database = _TransitionDatabase()
    monkeypatch.setattr(work_orders_router, "supabase", database)

    engineer = CurrentUser(
        user_id="engineer-1",
        hotel_id="hotel-1",
        role="engineer",
        email="engineer@example.com",
    )

    await work_orders_router.transition_work_order(
        "work-order-1",
        TransitionWorkOrderRequest(status="in_progress", source="mobile"),
        engineer,
    )
    await work_orders_router.transition_work_order(
        "work-order-1",
        TransitionWorkOrderRequest(
            status="on_hold", reason_code="awaiting_parts", source="web"
        ),
        engineer,
    )
    await work_orders_router.transition_work_order(
        "work-order-1",
        TransitionWorkOrderRequest(status="in_progress", source="web"),
        engineer,
    )
    await work_orders_router.transition_work_order(
        "work-order-1",
        TransitionWorkOrderRequest(status="completed", source="mobile"),
        engineer,
    )

    events = database.tables["operational_audit_events"]
    assert len(events) == 4

    transitions = [
        (e["old_state"]["status"], e["new_state"]["status"]) for e in events
    ]
    assert transitions == [
        ("open", "in_progress"),
        ("in_progress", "on_hold"),
        ("on_hold", "in_progress"),
        ("in_progress", "completed"),
    ]
    assert all(e["resource_id"] == "work-order-1" for e in events)
    assert all(e["hotel_id"] == "hotel-1" for e in events)
    assert all(e["actor_id"] == "engineer-1" for e in events)
    assert events[1]["reason_code"] == "awaiting_parts"
