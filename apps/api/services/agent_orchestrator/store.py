"""Typed wrapper over the planning-run RPCs (migration 247). Each method is one RPC = one transaction."""
from __future__ import annotations

from typing import Any, Optional


class PlanningStore:
    def __init__(self, client: Any) -> None:
        self._client = client

    @property
    def client(self) -> Any:
        return self._client

    def _rpc(self, name: str, params: dict) -> Any:
        return self._client.rpc(name, params).execute().data

    def admit(self, *, tenant_id: str, user_id: str, intent: str, intent_version: int, resource_type: str,
              resource_id: str, idempotency_key: str, request_digest: str, correlation_id: str, policy_version: str,
              deadline_seconds: int, max_attempts: int, step_max_attempts: int) -> dict:
        return self._rpc("agent_planning_run_admit", {
            "p_tenant_id": tenant_id, "p_user_id": user_id, "p_intent": intent, "p_intent_version": intent_version,
            "p_resource_type": resource_type, "p_resource_id": resource_id, "p_idempotency_key": idempotency_key,
            "p_request_digest": request_digest, "p_correlation_id": correlation_id, "p_policy_version": policy_version,
            "p_deadline_seconds": deadline_seconds, "p_max_attempts": max_attempts,
            "p_step_max_attempts": step_max_attempts}) or {}

    def step_context(self, *, run_id: str, fencing_token: int, worker_id: str) -> dict:
        return self._rpc("agent_planning_step_context", {"p_run_id": run_id, "p_fencing_token": fencing_token,
                                                         "p_worker": worker_id}) or {}

    def record_plan(self, *, run_id: str, fencing_token: int, worker_id: str, outcome: str, plan: Optional[dict],
                    plan_digest: Optional[str], reason_codes: list[str], model_attempts: int) -> dict:
        return self._rpc("agent_planning_record_plan", {
            "p_run_id": run_id, "p_fencing_token": fencing_token, "p_worker": worker_id, "p_outcome": outcome,
            "p_plan": plan, "p_plan_digest": plan_digest, "p_reason_codes": reason_codes,
            "p_model_attempts": model_attempts}) or {}

    def record_context(self, *, run_id: str, fencing_token: int, worker_id: str, agent_id: str, agent_version: int,
                       context_digest: str, fact_keys: list[str]) -> dict:
        """H5: audit which specialist was selected and which verified facts (by tool key + digest) it planned over."""
        return self._rpc("agent_planning_record_context", {
            "p_run_id": run_id, "p_fencing_token": fencing_token, "p_worker": worker_id, "p_agent_id": agent_id,
            "p_agent_version": agent_version, "p_context_digest": context_digest, "p_fact_keys": fact_keys}) or {}

    def get(self, *, tenant_id: str, run_id: str) -> Optional[dict]:
        return self._rpc("agent_planning_run_get", {"p_tenant_id": tenant_id, "p_run_id": run_id})
