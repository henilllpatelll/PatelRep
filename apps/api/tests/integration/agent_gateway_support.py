"""Helpers for the Agent Harness H2 Tool Gateway real-database tests (isolated migrated Supabase + real pgmq).

Every test builds its OWN hotel (unique tenant, staff, work order, room). Raw SQL (``run_sql``) is used only for fault
injection and inspection that PostgREST cannot express (expiring a lease, forging rows, reading audit tables). Every
decision under test is made by the real RPCs, the real gateway and the real worker.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from agent_execution_support import QUEUE, _create_user, expire_lease, messages_for, now, run_sql, sql_value, store
from batch_support import new_client
from middleware.auth import CurrentUser
from services.agent_execution.config import WorkerSettings
from services.agent_execution.identity_authority import SupabaseIdentityAuthority
from services.agent_execution.worker import Worker
from services.agent_gateway.admission import admit_tool_run
from services.agent_gateway.authorization import GatewaySettings
from services.agent_gateway.catalog import DISPATCH_AGENT_ID, GATEWAY_TOOL_SPECS
from services.agent_gateway.store import GatewayStore

ENABLED = GatewaySettings(execution_enabled=True)
ASSIGN = ("engineering.work_orders.assign", 2)
LOOKUP = ("engineering.work_orders.lookup", 2)
ROOM_LOOKUP = ("housekeeping.rooms.status_lookup", 1)


@dataclass
class GatewayHotel:
    tenant_id: str
    chief: str           # initiator (chief_engineer)
    gm: str              # independent approver
    engineer_a: str
    engineer_b: str
    housekeeper: str
    supervisor: str
    work_order: str
    room: str
    extra: dict = field(default_factory=dict)

    def user(self, user_id: str, role: str) -> CurrentUser:
        return CurrentUser(user_id=user_id, hotel_id=self.tenant_id, role=role)


def gstore() -> GatewayStore:
    return GatewayStore(new_client())


def set_platform(enabled: bool) -> None:
    gstore().set_execution_enablement(enabled=enabled, updated_by="it-operator", reason_code="integration_test")


def reset_gateway_state() -> None:
    """Throwaway-DB hygiene: end leftover runs (incl. approval waits), clear tool pauses, enable the platform switch."""
    run_sql(f"""
      SELECT public.agent_run_request_cancel(tenant_id, id, 'test-reset') FROM public.agent_runs
       WHERE state NOT IN ('succeeded', 'failed', 'cancelled', 'dead_letter');
      UPDATE public.agent_runs SET lease_expires_at = now() - interval '1 second' WHERE state = 'cancel_requested';
      SELECT public.agent_runs_recover(1000);
      SELECT public.agent_tool_approvals_expire(1000);
      UPDATE public.agent_runtime_controls SET paused = false, cost_emergency_stop = false;
      UPDATE public.agent_tool_controls SET paused = false;
      SELECT pgmq.purge_queue('{QUEUE}');
    """)
    set_platform(True)


def make_gateway_hotel(*, flag: bool = True, grant: bool = True) -> GatewayHotel:
    db = new_client()
    suffix = uuid.uuid4().hex[:10]
    tenant_id = db.table("tenants").insert({"name": f"H2 Test {suffix}", "slug": f"h2-test-{suffix}"}).execute().data[0]["id"]
    people = {}
    for label, role in (("chief", "chief_engineer"), ("gm", "gm"), ("engineer_a", "engineer"), ("engineer_b", "engineer"),
                        ("housekeeper", "housekeeper"), ("supervisor", "housekeeping_supervisor")):
        uid = _create_user(db, label.replace("_", "-"))
        db.table("user_profiles").insert({"id": uid, "tenant_id": tenant_id, "full_name": f"H2 {label}"}).execute()
        db.table("user_roles").insert({"user_id": uid, "tenant_id": tenant_id, "role": role}).execute()
        people[label] = uid
    room_type = db.table("room_types").insert({"tenant_id": tenant_id, "name": "King", "code": "K"}).execute().data[0]["id"]
    room = db.table("rooms").insert({"tenant_id": tenant_id, "room_number": f"2{suffix[:3]}", "floor": 2,
                                     "room_type_id": room_type}).execute().data[0]["id"]
    db.table("room_status").upsert({"room_id": room, "tenant_id": tenant_id, "status": "DIRTY",
                                    "guest_name": "Private Guest", "notes": "guest secret note"}).execute()
    work_order = db.table("work_orders").insert({
        "tenant_id": tenant_id, "title": "Sink leaking in 204", "description": "guest Private Guest reported it",
        "category": "plumbing", "priority": "urgent", "status": "open", "created_by": people["chief"],
        "room_id": room}).execute().data[0]["id"]
    hotel = GatewayHotel(tenant_id=tenant_id, work_order=work_order, room=room, **people)
    if flag:
        db.table("tenant_feature_flags").insert({"tenant_id": tenant_id, "feature_key": "ai_agents", "enabled": True,
                                                 "updated_by": "it"}).execute()
    if grant:
        for spec in GATEWAY_TOOL_SPECS:
            result = gstore().grant_set(tenant_id=tenant_id, actor_user_id=hotel.gm, agent_id=DISPATCH_AGENT_ID,
                                        agent_version=1, tool_id=spec.tool_id, tool_version=spec.version,
                                        max_level=2 if spec.access.value == "write" else 1)
            assert result.get("ok"), result
    return hotel


def gateway_worker(worker_id: str = "it-gw-a", *, lease_seconds: int = 10) -> Worker:
    settings = WorkerSettings(enabled=True, synthetic_enabled=False, worker_id=worker_id, lease_seconds=lease_seconds,
                              blocked_retry_seconds=1)
    return Worker(settings, app_env="test", version="it", store_factory=store,
                  authority_factory=lambda client: SupabaseIdentityAuthority(client, clock=now), clock=now,
                  gateway_settings=ENABLED)


def process(w: Worker) -> str:
    s = store()
    return w.process_one(s, SupabaseIdentityAuthority(s.client, clock=now))


def drain_run(w: Worker, run_id: str, limit: int = 10) -> list[str]:
    """Process until nothing is left for this run (other hotels' leftovers are purged by reset_gateway_state)."""
    outcomes = []
    for _ in range(limit):
        outcome = process(w)
        outcomes.append(outcome)
        if outcome == "empty" or messages_for(run_id) == 0:
            break
    return outcomes


def admit(hotel: GatewayHotel, tool: tuple[str, int], arguments: dict, *, as_user: Optional[CurrentUser] = None,
          key: Optional[str] = None):
    return admit_tool_run(gstore(), as_user or hotel.user(hotel.chief, "chief_engineer"), tool_id=tool[0],
                          tool_version=tool[1], arguments=arguments, idempotency_key=key or f"it-{uuid.uuid4().hex}",
                          app_env="test", settings=ENABLED, clock=lambda: datetime.now(timezone.utc))


def assign_args(hotel: GatewayHotel, *, to: Optional[str] = None, expected: Optional[str] = None, note=None) -> dict:
    return {"work_order_id": hotel.work_order, "assignee_user_id": to or hotel.engineer_a,
            "expected_assigned_to": expected, "note": note}


def run_row(tenant_id: str, run_id: str) -> dict:
    return store().get_run(tenant_id=tenant_id, run_id=run_id)["run"]


def assigned_to(work_order: str) -> str:
    return sql_value(f"SELECT COALESCE(assigned_to::text, '') FROM public.work_orders WHERE id = '{work_order}';")


def audit_rows(work_order: str) -> int:
    return int(sql_value(f"SELECT count(*) FROM public.operational_audit_events WHERE resource_id = '{work_order}';"))


def approval_for(hotel: GatewayHotel, run_id: str) -> dict:
    rows = gstore().approvals_list(tenant_id=hotel.tenant_id, state=None, limit=200)
    [row] = [r for r in rows if r["run_id"] == run_id]
    return row


def tool_events(hotel: GatewayHotel, run_id: str) -> list[dict]:
    return gstore().tool_events_page(tenant_id=hotel.tenant_id, run_id=run_id, limit=500)


__all__ = ["expire_lease", "messages_for", "run_sql", "sql_value", "store", "now"]
