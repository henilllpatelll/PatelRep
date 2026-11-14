"""Typed wrapper over the agent_tool_* RPCs (migration 243). Each method is ONE RPC, i.e. one PostgreSQL transaction.

Business reads for the read-only tools go through ``adapters.py`` (tenant-filtered table reads). Nothing here takes a
role from the caller: approval decisions pass a verified user id and the database re-reads that person's authority.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional


class GatewayStore:
    def __init__(self, client: Any) -> None:
        self._client = client

    @property
    def client(self) -> Any:
        return self._client

    def _rpc(self, name: str, params: dict) -> Any:
        return self._client.rpc(name, params).execute().data

    # ---- admission / snapshot ----------------------------------------------------------------------------------
    def authorization_snapshot(self, *, tenant_id: str, agent_id: str, agent_version: int) -> dict:
        return self._rpc("agent_tool_authorization_snapshot", {
            "p_tenant_id": tenant_id, "p_agent_id": agent_id, "p_agent_version": agent_version}) or {}

    def run_admit(self, *, tenant_id: str, agent_id: str, agent_version: int, user_id: str, idempotency_key: str,
                  request_digest: str, correlation_id: str, policy_version: str, tool_id: str, tool_version: int,
                  arguments: dict, resource_type: str, resource_id: str, action_digest: str, deadline_seconds: int,
                  max_attempts: int, step_max_attempts: int) -> dict:
        return self._rpc("agent_tool_run_admit", {
            "p_tenant_id": tenant_id, "p_agent_id": agent_id, "p_agent_version": agent_version, "p_user_id": user_id,
            "p_idempotency_key": idempotency_key, "p_request_digest": request_digest,
            "p_correlation_id": correlation_id, "p_policy_version": policy_version, "p_tool_id": tool_id,
            "p_tool_version": tool_version, "p_arguments": arguments, "p_resource_type": resource_type,
            "p_resource_id": resource_id, "p_action_digest": action_digest, "p_deadline_seconds": deadline_seconds,
            "p_max_attempts": max_attempts, "p_step_max_attempts": step_max_attempts}) or {}

    # ---- worker (fenced) ---------------------------------------------------------------------------------------
    def step_context(self, *, run_id: str, fencing_token: int, worker_id: str, step_number: int) -> dict:
        return self._rpc("agent_tool_step_context", {
            "p_run_id": run_id, "p_fencing_token": fencing_token, "p_worker": worker_id,
            "p_step_number": step_number}) or {}

    def request_approval(self, *, run_id: str, fencing_token: int, worker_id: str, invocation_id: str,
                         approval_policy_id: str, approver_may_be_initiator: bool, ttl_seconds: int) -> dict:
        return self._rpc("agent_tool_request_approval", {
            "p_run_id": run_id, "p_fencing_token": fencing_token, "p_worker": worker_id,
            "p_invocation_id": invocation_id, "p_approval_policy_id": approval_policy_id,
            "p_approver_may_be_initiator": approver_may_be_initiator, "p_ttl_seconds": ttl_seconds}) or {}

    def record_outcome(self, *, run_id: str, fencing_token: int, worker_id: str, invocation_id: str, state: str,
                       result: Optional[dict] = None, error_class: Optional[str] = None,
                       error_code: Optional[str] = None) -> dict:
        return self._rpc("agent_tool_record_outcome", {
            "p_run_id": run_id, "p_fencing_token": fencing_token, "p_worker": worker_id,
            "p_invocation_id": invocation_id, "p_state": state, "p_result": result or {},
            "p_error_class": error_class, "p_error_code": error_code}) or {}

    def execute_work_order_assign(self, *, run_id: str, fencing_token: int, worker_id: str, invocation_id: str,
                                  action_digest: str) -> dict:
        return self._rpc("agent_tool_execute_work_order_assign", {
            "p_run_id": run_id, "p_fencing_token": fencing_token, "p_worker": worker_id,
            "p_invocation_id": invocation_id, "p_action_digest": action_digest}) or {}

    # ---- humans (verified user id; authority re-read in the database) ------------------------------------------
    def approval_decide(self, *, tenant_id: str, approval_id: str, actor_user_id: str, decision: str,
                        reason_code: Optional[str] = None) -> dict:
        return self._rpc("agent_tool_approval_decide", {
            "p_tenant_id": tenant_id, "p_approval_id": approval_id, "p_actor_user_id": actor_user_id,
            "p_decision": decision, "p_reason_code": reason_code}) or {}

    def approval_revoke(self, *, tenant_id: str, approval_id: str, actor_user_id: str,
                        reason_code: Optional[str] = None) -> dict:
        return self._rpc("agent_tool_approval_revoke", {
            "p_tenant_id": tenant_id, "p_approval_id": approval_id, "p_actor_user_id": actor_user_id,
            "p_reason_code": reason_code}) or {}

    def approval_get(self, *, tenant_id: str, approval_id: str) -> Optional[dict]:
        return self._rpc("agent_tool_approval_get", {"p_tenant_id": tenant_id, "p_approval_id": approval_id})

    def approvals_list(self, *, tenant_id: str, state: Optional[str] = "requested", limit: int = 50) -> list[dict]:
        return self._rpc("agent_tool_approvals_list", {"p_tenant_id": tenant_id, "p_state": state,
                                                       "p_limit": limit}) or []

    def grant_set(self, *, tenant_id: str, actor_user_id: str, agent_id: str, agent_version: int, tool_id: str,
                  tool_version: int, max_level: int, expires_at: Optional[datetime] = None,
                  revoke: bool = False) -> dict:
        return self._rpc("agent_tool_grant_set", {
            "p_tenant_id": tenant_id, "p_actor_user_id": actor_user_id, "p_agent_id": agent_id,
            "p_agent_version": agent_version, "p_tool_id": tool_id, "p_tool_version": tool_version,
            "p_max_level": max_level, "p_expires_at": expires_at.isoformat() if expires_at else None,
            "p_revoke": revoke}) or {}

    def tool_events_page(self, *, tenant_id: str, run_id: str, after_id: int = 0, limit: int = 100) -> list[dict]:
        return self._rpc("agent_tool_events_page", {"p_tenant_id": tenant_id, "p_run_id": run_id,
                                                    "p_after_id": after_id, "p_limit": limit}) or []

    # ---- platform operations (runbook; service credentials) ----------------------------------------------------
    def approvals_expire(self, *, limit: int = 100) -> dict:
        return self._rpc("agent_tool_approvals_expire", {"p_limit": limit}) or {}

    def set_execution_enablement(self, *, enabled: bool, updated_by: str, reason_code: Optional[str] = None) -> dict:
        return self._rpc("agent_execution_enablement_set", {"p_enabled": enabled, "p_updated_by": updated_by,
                                                            "p_reason_code": reason_code}) or {}

    def set_tool_control(self, *, tool_id: str, paused: bool, updated_by: str,
                         reason_code: Optional[str] = None) -> dict:
        return self._rpc("agent_tool_control_set", {"p_tool_id": tool_id, "p_paused": paused,
                                                    "p_updated_by": updated_by, "p_reason_code": reason_code}) or {}
