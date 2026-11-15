"""Typed wrapper over the provider-spend ledger RPCs (migration 245) -- the only database path for paid-call money.

Each method is exactly one RPC, i.e. one PostgreSQL transaction. Money is sent and received as decimal TEXT (never a JSON
float). ``SpendLedger`` is the port the boundary depends on; ``SupabaseSpendLedger`` is the real implementation and the
smoke tests use an in-memory fake with the same semantics.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Mapping, Optional, Protocol


@dataclass(frozen=True)
class AttemptRef:
    attempt_id: str
    state: str
    reserved_usd: Decimal
    replayed: bool = False


@dataclass(frozen=True)
class ReserveResult:
    ok: bool
    reason: Optional[str] = None
    attempt: Optional[AttemptRef] = None


@dataclass(frozen=True)
class DispatchResult:
    ok: bool
    reason: Optional[str] = None
    released: bool = False


@dataclass(frozen=True)
class Settlement:
    """What the boundary learned about a dispatched attempt. ``outcome`` is settled|released|uncertain|unreconciled."""

    outcome: str
    cost_usd: Optional[Decimal] = None
    usage_status: Optional[str] = None
    usage: Optional[Mapping[str, int]] = None
    cost_status: Optional[str] = None
    cost_cause: Optional[str] = None
    cost_tier: Optional[str] = None
    reported_model: Optional[str] = None
    provider_request_id: Optional[str] = None
    provider_response_id: Optional[str] = None
    error_code: Optional[str] = None


@dataclass(frozen=True)
class SettleResult:
    ok: bool
    reason: Optional[str] = None
    state: Optional[str] = None
    overrun: bool = False


class SpendLedger(Protocol):
    def reserve(self, *, run_id: str, fencing_token: int, worker_id: str, step_id: str, logical_call_key: str,
                attempt_number: int, provider: str, model: str, schedule_version: str, max_input_tokens: int,
                max_output_tokens: int, exposure_usd: Decimal) -> ReserveResult: ...

    def dispatch(self, *, attempt_id: str, run_id: str, fencing_token: int, worker_id: str) -> DispatchResult: ...

    def release(self, *, attempt_id: str, fencing_token: int, reason: str) -> bool: ...

    def settle(self, *, attempt_id: str, fencing_token: int, settlement: Settlement) -> SettleResult: ...


def _dec(value: Any) -> Optional[Decimal]:
    return None if value is None else Decimal(str(value))


def _attempt(data: Optional[Mapping[str, Any]], replayed: bool = False) -> Optional[AttemptRef]:
    if not data:
        return None
    return AttemptRef(attempt_id=str(data["id"]), state=str(data["state"]), reserved_usd=Decimal(str(data["reserved_usd"])),
                      replayed=replayed)


class SupabaseSpendLedger:
    def __init__(self, client: Any) -> None:
        self._client = client

    @property
    def client(self) -> Any:
        return self._client

    def _rpc(self, name: str, params: dict) -> Any:
        return self._client.rpc(name, params).execute().data

    # ---- worker ------------------------------------------------------------------------------------------------
    def reserve(self, *, run_id: str, fencing_token: int, worker_id: str, step_id: str, logical_call_key: str,
                attempt_number: int, provider: str, model: str, schedule_version: str, max_input_tokens: int,
                max_output_tokens: int, exposure_usd: Decimal) -> ReserveResult:
        data = self._rpc("agent_model_attempt_reserve", {
            "p_run_id": run_id, "p_fencing_token": fencing_token, "p_worker": worker_id, "p_step_id": step_id,
            "p_logical_call_key": logical_call_key, "p_attempt_number": attempt_number, "p_provider": provider,
            "p_model": model, "p_schedule_version": schedule_version, "p_max_input_tokens": max_input_tokens,
            "p_max_output_tokens": max_output_tokens, "p_exposure_usd": str(exposure_usd)}) or {}
        if not data.get("ok"):
            return ReserveResult(ok=False, reason=str(data.get("reason") or "reservation_failed"))
        return ReserveResult(ok=True, attempt=_attempt(data.get("attempt"), bool(data.get("replayed"))))

    def dispatch(self, *, attempt_id: str, run_id: str, fencing_token: int, worker_id: str) -> DispatchResult:
        data = self._rpc("agent_model_attempt_dispatch", {"p_attempt_id": attempt_id, "p_run_id": run_id,
                                                          "p_fencing_token": fencing_token, "p_worker": worker_id}) or {}
        return DispatchResult(ok=bool(data.get("ok")), reason=data.get("reason"), released=bool(data.get("released")))

    def release(self, *, attempt_id: str, fencing_token: int, reason: str) -> bool:
        data = self._rpc("agent_model_attempt_release", {"p_attempt_id": attempt_id, "p_fencing_token": fencing_token,
                                                         "p_reason": reason}) or {}
        return bool(data.get("ok"))

    def settle(self, *, attempt_id: str, fencing_token: int, settlement: Settlement) -> SettleResult:
        s = settlement
        data = self._rpc("agent_model_attempt_settle", {
            "p_attempt_id": attempt_id, "p_fencing_token": fencing_token, "p_outcome": s.outcome,
            "p_cost_usd": None if s.cost_usd is None else str(s.cost_usd), "p_usage_status": s.usage_status,
            "p_usage": dict(s.usage) if s.usage is not None else None, "p_cost_status": s.cost_status,
            "p_cost_cause": s.cost_cause, "p_cost_tier": s.cost_tier, "p_reported_model": s.reported_model,
            "p_provider_request_id": s.provider_request_id, "p_provider_response_id": s.provider_response_id,
            "p_error_code": s.error_code}) or {}
        attempt = data.get("attempt") or {}
        return SettleResult(ok=bool(data.get("ok")), reason=data.get("reason"), state=attempt.get("state"),
                            overrun=attempt.get("overrun_usd") is not None)

    # ---- operator / platform -----------------------------------------------------------------------------------
    def reconcile(self, *, tenant_id: str, attempt_id: str, resolution: str, actual_usd: Optional[Decimal],
                  operator: str, evidence_code: str) -> dict:
        return self._rpc("agent_model_attempt_reconcile", {
            "p_tenant_id": tenant_id, "p_attempt_id": attempt_id, "p_resolution": resolution,
            "p_actual_usd": None if actual_usd is None else str(actual_usd), "p_operator": operator,
            "p_evidence_code": evidence_code}) or {}

    def recover(self, *, stale_seconds: int = 900, limit: int = 100) -> dict:
        return self._rpc("agent_model_attempts_recover", {"p_stale_seconds": stale_seconds, "p_limit": limit}) or {}

    def set_policy(self, *, scope: str, operator: str, period_limit_usd: Decimal, tenant_id: Optional[str] = None,
                   provider: Optional[str] = None, agent_id: Optional[str] = None, agent_version: Optional[int] = None,
                   run_limit_usd: Optional[Decimal] = None, step_limit_usd: Optional[Decimal] = None,
                   call_limit_usd: Optional[Decimal] = None, max_uncertain_per_run: Optional[int] = None,
                   reason: Optional[str] = None) -> dict:
        def s(v: Optional[Decimal]) -> Optional[str]:
            return None if v is None else str(v)
        return self._rpc("agent_model_budget_policy_set", {
            "p_scope": scope, "p_tenant_id": tenant_id, "p_provider": provider, "p_agent_id": agent_id,
            "p_agent_version": agent_version, "p_period_limit_usd": s(period_limit_usd),
            "p_run_limit_usd": s(run_limit_usd), "p_step_limit_usd": s(step_limit_usd),
            "p_call_limit_usd": s(call_limit_usd), "p_max_uncertain_per_run": max_uncertain_per_run,
            "p_operator": operator, "p_reason": reason}) or {}

    def set_enablement(self, *, enabled: bool, updated_by: str, reason: Optional[str] = None) -> dict:
        return self._rpc("agent_model_enablement_set", {"p_enabled": enabled, "p_updated_by": updated_by,
                                                        "p_reason": reason}) or {}

    def attempts_for_run(self, *, tenant_id: str, run_id: str) -> list[dict]:
        return self._rpc("agent_model_attempts_for_run", {"p_tenant_id": tenant_id, "p_run_id": run_id}) or []

    def diagnostics(self, *, limit: int = 20) -> dict:
        return self._rpc("agent_model_spend_diagnostics", {"p_limit": limit}) or {}


def money(value: Any) -> Optional[Decimal]:
    """Parse a ledger amount (decimal text) without ever passing through float."""
    return _dec(value)
