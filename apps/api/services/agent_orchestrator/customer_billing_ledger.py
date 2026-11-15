"""H4 ledger port for the H3 boundary: the planning worker's ``SpendLedger`` routed through the H4 wrapper RPCs.

The wrappers (migration 249) behave exactly like the H3 RPCs while ``customer_billing_mode = 'disabled'``; when it is
``'enforced'`` they add the pre-dispatch customer-credit hold, the dispatch-time re-check of policy and consent, and the
customer charge at settlement -- each in the same transaction as the H3 step. Lives in the orchestrator package because
it is part of the paid-call boundary; application code never imports it (test_agent_orchestrator_isolation.py).
"""
from __future__ import annotations

from decimal import Decimal
from typing import Optional

from services.agent_orchestrator.budget_store import (
    DispatchResult,
    ReserveResult,
    Settlement,
    SettleResult,
    SupabaseSpendLedger,
    _attempt,
)


def _s(value: Optional[Decimal]) -> Optional[str]:
    return None if value is None else str(value)


class CustomerBilledSpendLedger(SupabaseSpendLedger):
    """H3 ledger port routed through the H4 wrapper RPCs (pass-through while customer billing is disabled)."""

    def reserve(self, *, run_id: str, fencing_token: int, worker_id: str, step_id: str, logical_call_key: str,
                attempt_number: int, provider: str, model: str, schedule_version: str, max_input_tokens: int,
                max_output_tokens: int, exposure_usd: Decimal) -> ReserveResult:
        data = self._rpc("agent_billing_attempt_reserve", {
            "p_run_id": run_id, "p_fencing_token": fencing_token, "p_worker": worker_id, "p_step_id": step_id,
            "p_logical_call_key": logical_call_key, "p_attempt_number": attempt_number, "p_provider": provider,
            "p_model": model, "p_schedule_version": schedule_version, "p_max_input_tokens": max_input_tokens,
            "p_max_output_tokens": max_output_tokens, "p_exposure_usd": str(exposure_usd)}) or {}
        if not data.get("ok"):
            return ReserveResult(ok=False, reason=str(data.get("reason") or "reservation_failed"))
        return ReserveResult(ok=True, attempt=_attempt(data.get("attempt"), bool(data.get("replayed"))))

    def dispatch(self, *, attempt_id: str, run_id: str, fencing_token: int, worker_id: str) -> DispatchResult:
        data = self._rpc("agent_billing_attempt_dispatch", {"p_attempt_id": attempt_id, "p_run_id": run_id,
                                                            "p_fencing_token": fencing_token, "p_worker": worker_id}) or {}
        return DispatchResult(ok=bool(data.get("ok")), reason=data.get("reason"), released=bool(data.get("released")))

    def release(self, *, attempt_id: str, fencing_token: int, reason: str) -> bool:
        data = self._rpc("agent_billing_attempt_release", {"p_attempt_id": attempt_id, "p_fencing_token": fencing_token,
                                                           "p_reason": reason}) or {}
        return bool(data.get("ok"))

    def settle(self, *, attempt_id: str, fencing_token: int, settlement: Settlement) -> SettleResult:
        s = settlement
        data = self._rpc("agent_billing_attempt_settle", {
            "p_attempt_id": attempt_id, "p_fencing_token": fencing_token, "p_outcome": s.outcome,
            "p_cost_usd": _s(s.cost_usd), "p_usage_status": s.usage_status,
            "p_usage": dict(s.usage) if s.usage is not None else None, "p_cost_status": s.cost_status,
            "p_cost_cause": s.cost_cause, "p_cost_tier": s.cost_tier, "p_reported_model": s.reported_model,
            "p_provider_request_id": s.provider_request_id, "p_provider_response_id": s.provider_response_id,
            "p_error_code": s.error_code}) or {}
        attempt = data.get("attempt") or {}
        return SettleResult(ok=bool(data.get("ok")), reason=data.get("reason"), state=attempt.get("state"),
                            overrun=attempt.get("overrun_usd") is not None)
