"""Helpers for the Agent Harness H5 real-database tests (isolated migrated Supabase + real pgmq; never staging).

Every test builds its OWN synthetic hotel. The model is a fake transport plugged into the real SDK clients, so every
planning call still goes through the real provider-spend ledger; no paid provider is ever reached. Raw SQL is used only
for fault injection (changing the world between steps) and inspection.
"""
from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from agent_execution_support import QUEUE, messages_for, run_sql, sql_value, store
from agent_gateway_support import ENABLED, GatewayHotel, gstore, make_gateway_hotel, reset_gateway_state
from agent_orchestrator_support import reset_spend_state, set_budgets
from batch_support import new_client
from middleware.auth import CurrentUser
from services.agent_execution.config import WorkerSettings
from services.agent_execution.identity_authority import SupabaseIdentityAuthority
from services.agent_execution.worker import Worker
from services.agent_gateway.catalog import ENGINEERING_SPECIALIST_V2, HOUSEKEEPING_SPECIALIST_V1
from services.agent_handoff import handoff as handoffs
from services.agent_orchestrator.admission import admit_planning_run
from services.agent_orchestrator.config import OrchestratorSettings
from services.agent_orchestrator.store import PlanningStore
from tests.smoke.agent_orchestrator_support import Transport, adapters, openai_ok

ON = OrchestratorSettings(execution_enabled=True)
ENG = ENGINEERING_SPECIALIST_V2.key
HK = HOUSEKEEPING_SPECIALIST_V1.key


def now() -> datetime:
    return datetime.now(timezone.utc)


def reset_all() -> None:
    reset_gateway_state()
    reset_spend_state()


@dataclass
class H5Hotel:
    base: GatewayHotel
    supervisor_b: str  # a second housekeeping supervisor (independent approver)
    housekeeper_b: str

    def __getattr__(self, name):
        return getattr(self.base, name)

    def user(self, user_id: str, role: str) -> CurrentUser:
        return CurrentUser(user_id=user_id, hotel_id=self.base.tenant_id, role=role)


def _person(db, tenant_id: str, label: str, role: str) -> str:
    from agent_execution_support import _create_user

    uid = _create_user(db, label)
    db.table("user_profiles").insert({"id": uid, "tenant_id": tenant_id, "full_name": f"H5 {label}"}).execute()
    db.table("user_roles").insert({"user_id": uid, "tenant_id": tenant_id, "role": role}).execute()
    return uid


def grant_specialists(hotel_id: str, gm: str, *, agents=(ENG, HK), skip: tuple = ()) -> None:
    for agent in (ENGINEERING_SPECIALIST_V2, HOUSEKEEPING_SPECIALIST_V1):
        if agent.key not in agents:
            continue
        for ref in agent.tools:
            if ref.key in skip:
                continue
            spec = agent_tool(ref.key)
            result = gstore().grant_set(tenant_id=hotel_id, actor_user_id=gm, agent_id=agent.agent_id,
                                        agent_version=agent.agent_version, tool_id=ref.tool_id,
                                        tool_version=ref.version, max_level=2 if spec.access.value == "write" else 1)
            assert result.get("ok"), result


def agent_tool(key):
    from services.agent_gateway.catalog import GATEWAY_TOOLS

    return GATEWAY_TOOLS.get(*key)


def make_h5_hotel(*, grant: bool = True, skip: tuple = ()) -> H5Hotel:
    base = make_gateway_hotel(grant=False)
    db = new_client()
    hotel = H5Hotel(base=base, supervisor_b=_person(db, base.tenant_id, "supervisor-b", "housekeeping_supervisor"),
                    housekeeper_b=_person(db, base.tenant_id, "housekeeper-b", "housekeeper"))
    set_budgets(base)
    if grant:
        grant_specialists(base.tenant_id, base.gm, skip=skip)
    return hotel


def worker(transport: Transport, worker_id: str = "it-h5-w1", *, notifier=None, lease_seconds: int = 30) -> Worker:
    settings = WorkerSettings(enabled=True, synthetic_enabled=False, worker_id=worker_id, lease_seconds=lease_seconds,
                              blocked_retry_seconds=1)
    return Worker(settings, app_env="test", version="it", store_factory=store,
                  authority_factory=lambda client: SupabaseIdentityAuthority(client, clock=now), clock=now,
                  gateway_settings=ENABLED, orchestrator_settings=ON, provider_factory=lambda: adapters(transport),
                  write_notifier=notifier if notifier is not None else (lambda client, committed: None))


def process(w: Worker) -> str:
    s = store()
    return w.process_one(s, SupabaseIdentityAuthority(s.client, clock=now))


def drain(w: Worker, run_id: str, limit: int = 8) -> list[str]:
    outcomes = []
    for _ in range(limit):
        outcome = process(w)
        outcomes.append(outcome)
        if outcome == "empty" or messages_for(run_id) == 0:
            break
    return outcomes


def request(hotel: H5Hotel, intent: str, resource_id: str, *, user: Optional[CurrentUser] = None, key=None):
    return admit_planning_run(PlanningStore(new_client()), user or default_user(hotel, intent), intent=intent,
                              intent_version=1, resource_id=resource_id,
                              idempotency_key=key or f"h5-{uuid.uuid4().hex}", app_env="test", settings=ON, clock=now)


def default_user(hotel: H5Hotel, intent: str) -> CurrentUser:
    if intent.startswith("housekeeping."):
        return hotel.user(hotel.supervisor, "housekeeping_supervisor")
    return hotel.user(hotel.chief, "chief_engineer")


def planning(hotel: H5Hotel, run_id: str) -> dict:
    return PlanningStore(new_client()).get(tenant_id=hotel.tenant_id, run_id=run_id)


def planning_events(hotel: H5Hotel, run_id: str) -> list[str]:
    rows = new_client().rpc("agent_planning_events_page", {"p_tenant_id": hotel.tenant_id, "p_run_id": run_id,
                                                           "p_after_id": 0, "p_limit": 200}).execute().data or []
    return [r["event_type"] + (":" + r["reason_code"] if r.get("reason_code") else "") for r in rows]


def draft(agent, *, outcome="recommend", findings=(), priority="normal", steps=(), reasons=()) -> str:
    return json.dumps({"plan_schema": "patelrep.plan/v2", "outcome": outcome, "agent_id": agent[0],
                       "agent_version": agent[1], "findings": list(findings), "priority": priority,
                       "steps": list(steps), "reason_codes": list(reasons)})


def change(tool: tuple[str, int], arguments: dict) -> dict:
    return {"step_number": 1, "purpose": "propose_change", "depends_on": [],
            "tool_call": {"tool_id": tool[0], "tool_version": tool[1], "arguments_json": json.dumps(arguments),
                          "expected_result": "assignment_change"}}


def hotel_today(hotel: H5Hotel) -> str:
    return sql_value(f"SELECT (now() AT TIME ZONE COALESCE(timezone, 'UTC'))::date::text FROM public.tenants "
                     f"WHERE id = '{hotel.tenant_id}';")


def plan_with(hotel: H5Hotel, intent: str, resource_id: str, text: str, *, user=None) -> tuple[str, dict, Transport]:
    """Request a recommendation, let the real worker plan it with ONE fake model response, return the record."""
    transport = Transport([openai_ok(text=text)])
    admitted = request(hotel, intent, resource_id, user=user)
    drain(worker(transport), admitted.run_id)
    return admitted.run_id, planning(hotel, admitted.run_id), transport


def submit(hotel: H5Hotel, run_id: str, *, user: Optional[CurrentUser] = None, digest: Optional[str] = None,
           step: int = 1):
    record = planning(hotel, run_id)
    return handoffs.submit_proposal(new_client(), user or default_user(hotel, record["intent"]),
                                    planning_run_id=run_id, plan_digest=digest or record["plan_digest"],
                                    step_number=step, app_env="test", settings=ENABLED, clock=now)


def status(hotel: H5Hotel, handoff_id: str, user: CurrentUser) -> dict:
    return handoffs.handoff_status(new_client(), user, handoff_id)


def room_owner(hotel: H5Hotel) -> str:
    return sql_value(f"""SELECT COALESCE((SELECT assigned_to::text FROM public.room_assignments
                           WHERE room_id = '{hotel.room}' AND assignment_date =
                             (now() AT TIME ZONE COALESCE((SELECT timezone FROM public.tenants
                                                            WHERE id = '{hotel.tenant_id}'), 'UTC'))::date), '');""")


def room_stage(hotel: H5Hotel) -> str:
    return sql_value(f"SELECT status FROM public.room_status WHERE room_id = '{hotel.room}';")


def room_audits(hotel: H5Hotel) -> list[str]:
    out = run_sql(f"\\pset tuples_only on\n\\pset format unaligned\n"
                  f"SELECT action || '|' || actor_id || '|' || COALESCE(new_state->>'is_ai_suggested', '') "
                  f"FROM public.operational_audit_events WHERE resource_id = '{hotel.room}' ORDER BY created_at;")
    return [line.strip() for line in out.splitlines() if "|" in line]


__all__ = ["QUEUE", "messages_for", "run_sql", "sql_value", "store", "gstore", "ENABLED"]
