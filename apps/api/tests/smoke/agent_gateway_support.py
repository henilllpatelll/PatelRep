"""Shared builders for the Agent Harness H2 Tool Gateway unit tests. Pure: no database, network or model provider.

Real-database behaviour (atomicity, approvals, concurrency, fencing) is proven in tests/integration/test_agent_gateway_*.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from middleware.auth import CurrentUser
from services.agent_gateway.authorization import PolicyInputs, policy_inputs
from services.agent_gateway.catalog import DISPATCH_AGENT_ID, DISPATCH_AGENT_VERSION, GATEWAY_TOOL_SPECS
from services.agent_harness.identity import context_from_verified_user

NOW = datetime(2026, 11, 14, 15, 0, tzinfo=timezone.utc)
HOTEL_A = "11111111-1111-4111-8111-111111111111"
HOTEL_B = "22222222-2222-4222-8222-222222222222"
INITIATOR = "33333333-3333-4333-8333-333333333333"
APPROVER = "55555555-5555-4555-8555-555555555555"
ENGINEER = "66666666-6666-4666-8666-666666666666"
WORK_ORDER = "44444444-4444-4444-8444-444444444444"
ROOM = "77777777-7777-4777-8777-777777777777"


class FakeQuery:
    def __init__(self, client: "FakeClient", table: str) -> None:
        self.client, self.table, self.filters = client, table, {}

    def select(self, *_a: Any) -> "FakeQuery":
        return self

    def eq(self, column: str, value: Any) -> "FakeQuery":
        self.filters[column] = value
        return self

    def limit(self, _n: int) -> "FakeQuery":
        return self

    def execute(self) -> Any:
        self.client.queries.append((self.table, dict(self.filters)))
        rows = [r for r in self.client.rows.get(self.table, [])
                if all(str(r.get(k)) == str(v) for k, v in self.filters.items() if k in ("id", "tenant_id"))]
        return type("R", (), {"data": rows})()


class FakeClient:
    """Enough of the supabase client for the read adapters: tenant + id filtered table reads, recorded."""

    def __init__(self, rows: Optional[dict] = None) -> None:
        self.rows = rows or {}
        self.queries: list[tuple[str, dict]] = []

    def table(self, name: str) -> FakeQuery:
        return FakeQuery(self, name)

    def rpc(self, *_a: Any, **_k: Any) -> Any:  # pragma: no cover - adapters never call RPCs
        raise AssertionError("adapters must not call RPCs")


def default_rows() -> dict:
    return {
        "work_orders": [
            {"id": WORK_ORDER, "tenant_id": HOTEL_A, "work_order_number": 1042, "title": "Sink leaking",
             "status": "open", "priority": "urgent", "assigned_to": None, "due_at": None,
             "rooms": {"room_number": "204"}, "description": "guest Jane Doe in 204 says ..."},
        ],
        "rooms": [
            {"id": ROOM, "tenant_id": HOTEL_A, "room_number": "204", "floor": 2, "building": "A", "is_active": True,
             "room_status": [{"status": "DIRTY", "fo_status": "OCC", "clean_type": "stayover", "dnd_flag": False,
                              "updated_at": "2026-11-14T14:00:00+00:00", "guest_name": "Jane Doe"}]},
        ],
    }


def snapshot(*, flags=("ai_agents",), grants: Optional[list] = None, platform: bool = True, paused_tools=(),
             controls: Optional[list] = None) -> dict:
    if grants is None:
        grants = [{"tool_id": s.tool_id, "tool_version": s.version, "max_level": 2 if s.access.value == "write" else 1,
                   "max_risk": s.risk.value, "granted_by_user_id": INITIATOR,
                   "granted_at": (NOW - timedelta(days=1)).isoformat(), "expires_at": None}
                  for s in GATEWAY_TOOL_SPECS]
    return {"enabled_flags": list(flags), "grants": grants, "platform_execution_enabled": platform,
            "paused_tools": list(paused_tools), "controls": controls or [], "db_now": NOW.isoformat()}


def inputs(**kw: Any) -> PolicyInputs:
    process = kw.pop("process_enabled", True)
    hotel = kw.pop("hotel_id", HOTEL_A)
    return policy_inputs(snapshot(**kw), hotel_id=hotel, agent_id=DISPATCH_AGENT_ID, process_enabled=process, now=NOW)


def user(role: str = "chief_engineer", hotel_id: str = HOTEL_A, user_id: str = INITIATOR) -> CurrentUser:
    return CurrentUser(user_id=user_id, hotel_id=hotel_id, role=role)


def ctx(role: str = "chief_engineer", hotel_id: str = HOTEL_A, user_id: str = INITIATOR, now: datetime = NOW):
    return context_from_verified_user(user(role, hotel_id, user_id), agent_id=DISPATCH_AGENT_ID,
                                      agent_version=DISPATCH_AGENT_VERSION, now=now)


def assign_args(**over: Any) -> dict:
    return {"work_order_id": WORK_ORDER, "assignee_user_id": ENGINEER, "expected_assigned_to": None, "note": None, **over}


def approval_row(digest: str, **over: Any) -> dict:
    return {"id": "99999999-9999-4999-8999-999999999999", "tenant_id": HOTEL_A, "run_id": "r",
            "invocation_id": "i", "agent_id": DISPATCH_AGENT_ID, "agent_version": DISPATCH_AGENT_VERSION,
            "tool_id": "engineering.work_orders.assign", "tool_version": 2, "action_digest": digest,
            "initiated_by_user_id": INITIATOR, "approval_policy_id": "human_approval.independent_manager.v1",
            "approver_may_be_initiator": False, "required_approver_roles": ["chief_engineer", "gm"],
            "state": "approved", "decided_by_user_id": APPROVER, "decided_role": "gm",
            "decided_at": (NOW - timedelta(minutes=1)).isoformat(),
            "expires_at": (NOW + timedelta(minutes=50)).isoformat(), "consumed_at": None, **over}
