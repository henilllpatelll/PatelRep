"""Typed wrapper over the H5 handoff and planning-review RPCs (migration 252). Each method is one RPC = one transaction.

No method accepts a role: humans are identified by a verified user id and the database re-reads their authority.
"""
from __future__ import annotations

from typing import Any, Optional


class HandoffStore:
    def __init__(self, client: Any) -> None:
        self._client = client

    @property
    def client(self) -> Any:
        return self._client

    def _rpc(self, name: str, params: dict) -> Any:
        return self._client.rpc(name, params).execute().data

    def admit(self, *, planning_run_id: str, plan_digest: str, step_number: int, proposal_ttl_seconds: int,
              tenant_id: str, agent_id: str, agent_version: int, user_id: str, idempotency_key: str,
              request_digest: str, correlation_id: str, policy_version: str, tool_id: str, tool_version: int,
              arguments: dict, resource_type: str, resource_id: str, action_digest: str, deadline_seconds: int,
              max_attempts: int, step_max_attempts: int) -> dict:
        return self._rpc("agent_proposal_handoff_admit", {
            "p_tenant_id": tenant_id, "p_user_id": user_id, "p_planning_run_id": planning_run_id,
            "p_plan_digest": plan_digest, "p_step_number": step_number, "p_proposal_ttl_seconds": proposal_ttl_seconds,
            "p_agent_id": agent_id, "p_agent_version": agent_version, "p_idempotency_key": idempotency_key,
            "p_request_digest": request_digest, "p_correlation_id": correlation_id, "p_policy_version": policy_version,
            "p_tool_id": tool_id, "p_tool_version": tool_version, "p_arguments": arguments,
            "p_resource_type": resource_type, "p_resource_id": resource_id, "p_action_digest": action_digest,
            "p_deadline_seconds": deadline_seconds, "p_max_attempts": max_attempts,
            "p_step_max_attempts": step_max_attempts}) or {}

    def get(self, *, tenant_id: str, handoff_id: str) -> Optional[dict]:
        return self._rpc("agent_proposal_handoff_get", {"p_tenant_id": tenant_id, "p_handoff_id": handoff_id})

    def for_run(self, *, tenant_id: str, planning_run_id: str) -> list[dict]:
        return self._rpc("agent_proposal_handoffs_for_run", {"p_tenant_id": tenant_id,
                                                             "p_planning_run_id": planning_run_id}) or []

    def cancel(self, *, tenant_id: str, handoff_id: str, actor_user_id: str) -> dict:
        return self._rpc("agent_proposal_handoff_cancel", {"p_tenant_id": tenant_id, "p_handoff_id": handoff_id,
                                                           "p_actor_user_id": actor_user_id}) or {}

    def dismiss(self, *, tenant_id: str, run_id: str, actor_user_id: str, reason_code: Optional[str]) -> dict:
        return self._rpc("agent_planning_dismiss", {"p_tenant_id": tenant_id, "p_run_id": run_id,
                                                    "p_actor_user_id": actor_user_id, "p_reason_code": reason_code}) or {}

    def events(self, *, tenant_id: str, run_id: str, after_id: int = 0, limit: int = 100) -> list[dict]:
        return self._rpc("agent_planning_events_page", {"p_tenant_id": tenant_id, "p_run_id": run_id,
                                                        "p_after_id": after_id, "p_limit": limit}) or []
