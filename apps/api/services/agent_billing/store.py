"""Typed wrappers over the H4 customer, operator and job RPCs (migration 249). One method = one RPC = one transaction.

Amounts travel as decimal TEXT, never JSON floats. The paid-call (worker) path lives in
the orchestrator package (customer_billing_ledger.py).
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any, Optional

class CustomerBillingStore:
    """Operator, customer and job RPCs. Never constructed from request input other than the verified hotel/user."""

    def __init__(self, client: Any) -> None:
        self._client = client

    @property
    def client(self) -> Any:
        return self._client

    def _rpc(self, name: str, params: dict) -> Any:
        return self._client.rpc(name, params).execute().data

    # ---- customer (API: hotel and user come from the verified token only) ----------------------------------------
    def summary(self, *, tenant_id: str) -> dict:
        return self._rpc("agent_customer_billing_summary", {"p_tenant_id": tenant_id}) or {}

    def history(self, *, tenant_id: str, limit: int = 12) -> list:
        return self._rpc("agent_customer_billing_history", {"p_tenant_id": tenant_id, "p_limit": limit}) or []

    def authorize_overage(self, *, tenant_id: str, user_id: str, limit_credits: Decimal, expected_policy_id: str,
                          terms_version: str, expected_max_exposure_usd: Decimal) -> dict:
        return self._rpc("agent_customer_overage_authorize", {
            "p_tenant_id": tenant_id, "p_user_id": user_id, "p_limit_credits": str(limit_credits),
            "p_expected_policy_id": expected_policy_id, "p_terms_version": terms_version,
            "p_expected_max_exposure_usd": str(expected_max_exposure_usd)}) or {}

    def revoke_overage(self, *, tenant_id: str, user_id: str) -> dict:
        return self._rpc("agent_customer_overage_revoke", {"p_tenant_id": tenant_id, "p_user_id": user_id}) or {}

    # ---- operator -------------------------------------------------------------------------------------------------
    def set_controls(self, *, mode: str, stripe_trueup_enabled: bool, operator: str, reason: Optional[str] = None) -> dict:
        return self._rpc("agent_customer_billing_controls_set", {
            "p_mode": mode, "p_stripe_trueup_enabled": stripe_trueup_enabled, "p_operator": operator,
            "p_reason": reason}) or {}

    def propose_policy(self, *, tenant_id: str, included_credits: Decimal, usd_per_credit: Decimal,
                       markup_multiplier: Decimal, minimum_credits: Decimal, hard_cap_usd: Decimal, terms_version: str,
                       operator: str, reason: Optional[str] = None) -> dict:
        return self._rpc("agent_customer_pricing_policy_propose", {
            "p_tenant_id": tenant_id, "p_included_credits": str(included_credits),
            "p_usd_per_credit": str(usd_per_credit), "p_markup_multiplier": str(markup_multiplier),
            "p_minimum_credits": str(minimum_credits), "p_hard_cap_usd": str(hard_cap_usd),
            "p_terms_version": terms_version, "p_operator": operator, "p_reason": reason}) or {}

    def approve_policy(self, *, tenant_id: str, policy_id: str, approver: str, reason: Optional[str] = None) -> dict:
        return self._rpc("agent_customer_pricing_policy_approve", {
            "p_tenant_id": tenant_id, "p_policy_id": policy_id, "p_approver": approver, "p_reason": reason}) or {}

    def retire_policy(self, *, tenant_id: str, operator: str, reason: str) -> dict:
        return self._rpc("agent_customer_pricing_policy_retire", {
            "p_tenant_id": tenant_id, "p_operator": operator, "p_reason": reason}) or {}

    def adjust_charge(self, *, tenant_id: str, charge_id: str, reduce_credits: Decimal, operator: str, approver: str,
                      reason: str) -> dict:
        return self._rpc("agent_customer_charge_adjust", {
            "p_tenant_id": tenant_id, "p_charge_id": charge_id, "p_reduce_credits": str(reduce_credits),
            "p_operator": operator, "p_approver": approver, "p_reason": reason}) or {}

    # ---- jobs -----------------------------------------------------------------------------------------------------
    def reconcile(self, *, limit: int = 100, dry_run: bool = True, actor: str = "reconciler") -> dict:
        return self._rpc("agent_customer_billing_reconcile", {"p_limit": limit, "p_dry_run": dry_run,
                                                              "p_actor": actor}) or {}

    def periods_due(self, *, limit: int = 50, grace_days: int = 1) -> list:
        return self._rpc("agent_billing_periods_due", {"p_limit": limit, "p_grace_days": grace_days}) or []

    def prepare_operation(self, *, tenant_id: str, period_start: str, actor: str, grace_days: int = 1) -> dict:
        return self._rpc("agent_billing_operation_prepare", {"p_tenant_id": tenant_id, "p_period_start": period_start,
                                                             "p_actor": actor, "p_grace_days": grace_days}) or {}

    def claim_operation(self, *, operation_id: str, actor: str) -> dict:
        return self._rpc("agent_billing_operation_claim", {"p_operation_id": operation_id, "p_actor": actor}) or {}

    def record_operation(self, *, operation_id: str, outcome: str, actor_kind: str, actor_ref: str,
                         stripe_customer_id: Optional[str] = None, invoice_item_id: Optional[str] = None,
                         invoice_id: Optional[str] = None, invoice_status: Optional[str] = None,
                         hosted_invoice_url: Optional[str] = None, livemode: Optional[bool] = None,
                         error_code: Optional[str] = None, event_created: Optional[int] = None) -> dict:
        return self._rpc("agent_billing_operation_record", {
            "p_operation_id": operation_id, "p_outcome": outcome, "p_actor_kind": actor_kind, "p_actor_ref": actor_ref,
            "p_stripe_customer_id": stripe_customer_id, "p_invoice_item_id": invoice_item_id,
            "p_invoice_id": invoice_id, "p_invoice_status": invoice_status, "p_hosted_invoice_url": hosted_invoice_url,
            "p_livemode": livemode, "p_error_code": error_code, "p_event_created": event_created}) or {}

    def operations_due(self, *, limit: int = 50) -> list:
        return self._rpc("agent_billing_operations_due", {"p_limit": limit}) or []

    def find_operations(self, *, invoice_item_ids: list[str], invoice_id: Optional[str]) -> list:
        return self._rpc("agent_billing_operations_find", {"p_invoice_item_ids": invoice_item_ids or None,
                                                           "p_invoice_id": invoice_id}) or []
