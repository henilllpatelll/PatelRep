"""Typed wrapper over the agent_* RPCs (migrations 239-240) -- the only database path for durable execution.

Each method is exactly one RPC, i.e. one PostgreSQL transaction; state, events and queue operations commit together.
No method issues an unfiltered table read or write. Results are returned as the RPC's JSON object.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional


class AgentRunStore:
    def __init__(self, client: Any) -> None:
        self._client = client

    @property
    def client(self) -> Any:
        return self._client

    def _rpc(self, name: str, params: dict) -> Any:
        return self._client.rpc(name, params).execute().data

    # ---- admission -------------------------------------------------------------------------------------------
    def admit(self, *, tenant_id: str, agent_id: str, agent_version: int, principal_type: str,
              user_id: Optional[str], system_principal_id: Optional[str], trigger_type: str, idempotency_key: str,
              request_digest: str, correlation_id: str, policy_version: str, synthetic_spec: dict,
              first_step_type: str, deadline_seconds: int, max_attempts: int, step_max_attempts: int) -> dict:
        return self._rpc("agent_run_admit", {
            "p_tenant_id": tenant_id, "p_agent_id": agent_id, "p_agent_version": agent_version,
            "p_principal_type": principal_type, "p_user_id": user_id, "p_system_principal_id": system_principal_id,
            "p_trigger_type": trigger_type, "p_idempotency_key": idempotency_key, "p_request_digest": request_digest,
            "p_correlation_id": correlation_id, "p_policy_version": policy_version, "p_synthetic_spec": synthetic_spec,
            "p_first_step_type": first_step_type, "p_deadline_seconds": deadline_seconds,
            "p_max_attempts": max_attempts, "p_step_max_attempts": step_max_attempts,
        })

    # ---- worker (fenced) -------------------------------------------------------------------------------------
    def claim(self, *, worker_id: str, lease_seconds: int, vt_margin: int = 15, poison_read_ct: int = 10,
              blocked_retry: int = 30) -> dict:
        return self._rpc("agent_run_claim", {"p_worker": worker_id, "p_lease_seconds": lease_seconds,
                                             "p_vt_margin": vt_margin, "p_poison_read_ct": poison_read_ct,
                                             "p_blocked_retry": blocked_retry})

    def heartbeat(self, *, run_id: str, fencing_token: int, worker_id: str, lease_seconds: int,
                  vt_margin: int = 15) -> dict:
        return self._rpc("agent_run_heartbeat", {"p_run_id": run_id, "p_fencing_token": fencing_token,
                                                 "p_worker": worker_id, "p_lease_seconds": lease_seconds,
                                                 "p_vt_margin": vt_margin})

    def complete_step(self, *, run_id: str, step_id: str, fencing_token: int, worker_id: str, result_meta: dict,
                      next_step_type: Optional[str] = None, next_step_max_attempts: int = 3) -> dict:
        return self._rpc("agent_step_complete", {
            "p_run_id": run_id, "p_step_id": step_id, "p_fencing_token": fencing_token, "p_worker": worker_id,
            "p_result_meta": result_meta, "p_next_step_type": next_step_type,
            "p_next_step_max_attempts": next_step_max_attempts})

    def fail_step(self, *, run_id: str, step_id: str, fencing_token: int, worker_id: str, error_class: str,
                  error_code: str, retryable: bool, retry_delay_seconds: int) -> dict:
        return self._rpc("agent_step_fail", {
            "p_run_id": run_id, "p_step_id": step_id, "p_fencing_token": fencing_token, "p_worker": worker_id,
            "p_error_class": error_class, "p_error_code": error_code, "p_retryable": retryable,
            "p_retry_delay_seconds": retry_delay_seconds})

    def acknowledge(self, *, run_id: str, fencing_token: int, worker_id: str, action: str,
                    reason: Optional[str] = None, yield_delay_seconds: int = 0) -> dict:
        return self._rpc("agent_run_acknowledge", {
            "p_run_id": run_id, "p_fencing_token": fencing_token, "p_worker": worker_id, "p_action": action,
            "p_reason": reason, "p_yield_delay_seconds": yield_delay_seconds})

    # ---- tenant-scoped operations ----------------------------------------------------------------------------
    def request_cancel(self, *, tenant_id: str, run_id: str, requested_by: str) -> dict:
        return self._rpc("agent_run_request_cancel", {"p_tenant_id": tenant_id, "p_run_id": run_id,
                                                      "p_requested_by": requested_by})

    def request_pause(self, *, tenant_id: str, run_id: str, requested_by: str) -> dict:
        return self._rpc("agent_run_request_pause", {"p_tenant_id": tenant_id, "p_run_id": run_id,
                                                     "p_requested_by": requested_by})

    def resume(self, *, tenant_id: str, run_id: str, requested_by: str) -> dict:
        return self._rpc("agent_run_resume", {"p_tenant_id": tenant_id, "p_run_id": run_id,
                                              "p_requested_by": requested_by})

    def get_run(self, *, tenant_id: str, run_id: str) -> Optional[dict]:
        return self._rpc("agent_run_get", {"p_tenant_id": tenant_id, "p_run_id": run_id})

    def events_page(self, *, tenant_id: str, run_id: str, after_id: int = 0, limit: int = 100) -> list[dict]:
        return self._rpc("agent_run_events_page", {"p_tenant_id": tenant_id, "p_run_id": run_id,
                                                   "p_after_id": after_id, "p_limit": limit}) or []

    # ---- platform operations ---------------------------------------------------------------------------------
    def recover(self, *, limit: int = 100) -> dict:
        return self._rpc("agent_runs_recover", {"p_limit": limit})

    def diagnostics(self, *, limit: int = 20) -> dict:
        return self._rpc("agent_execution_diagnostics", {"p_limit": limit})

    def worker_heartbeat(self, *, worker_id: str, status: str, app_env: str, version: str, concurrency: int,
                         in_flight: int, started_at: datetime) -> None:
        self._rpc("agent_worker_heartbeat", {
            "p_worker_id": worker_id, "p_status": status, "p_app_env": app_env, "p_version": version,
            "p_concurrency": concurrency, "p_in_flight": in_flight, "p_started_at": started_at.isoformat()})
