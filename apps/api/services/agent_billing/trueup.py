"""H4 Stripe true-up: drives ``agent_billing_operations`` through its state machine. Never activated by this PR.

Durable identity: the operation row id. It is the Stripe idempotency key (``patelrep-h4-op-<id>``) AND the invoice item
metadata value, so a retry long after Stripe prunes idempotency keys (>= 24h) still cannot double-bill: before EVERY
create the worker searches the customer's invoice items for that metadata, and an ambiguous submission is reconciled
(found -> item_created, confirmed absent -> back to prepared) before anything is sent again.

States: prepared -> submitting -> item_created -> invoiced -> paid | payment_failed | uncollectible | void
        submitting -> ambiguous -> (item_created | prepared);  anything unsafe -> manual_intervention.
Every Stripe-derived fact is passed through ``agent_billing_operation_record``, which enforces the hotel's customer id
and refuses live-mode objects.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Callable, Optional

from services.agent_billing.observability import log_event
from services.agent_billing.store import CustomerBillingStore
from services.agent_billing.stripe_transport import (
    METADATA_KEY,
    ItemView,
    LiveModeRefused,
    StripeAmbiguous,
    StripeRejected,
    StripeTransport,
    StripeTransportError,
)

IDEMPOTENCY_PREFIX = "patelrep-h4-op-"
SEARCH_LOOKBACK_SECONDS = 2 * 86400


def _ts(value: str) -> int:
    """Unix seconds for an ISO date (UTC midnight) or timestamp (offset honoured, naive treated as UTC)."""
    if "T" not in value and " " not in value:
        return int(datetime.combine(date.fromisoformat(value), datetime.min.time(), tzinfo=timezone.utc).timestamp())
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp())


def _search_from(op: dict) -> int:
    created = op.get("created_at")
    return max(0, _ts(created) - SEARCH_LOOKBACK_SECONDS) if created else 0


@dataclass
class TrueUpProcessor:
    store: CustomerBillingStore
    transport: StripeTransport
    actor: str = "h4-trueup"
    clock: Callable[[], float] = time.time

    # ---- preparation -------------------------------------------------------------------------------------------
    def prepare_due(self, *, grace_days: int = 1, limit: int = 50) -> list[dict]:
        results = []
        for period in self.store.periods_due(limit=limit, grace_days=grace_days):
            result = self.store.prepare_operation(tenant_id=period["tenant_id"], period_start=period["period_start"],
                                                  actor=self.actor, grace_days=grace_days)
            op = result.get("operation") or {}
            log_event("billing_operation_prepared", tenant_id=period["tenant_id"], period_start=period["period_start"],
                      outcome=result.get("status") or result.get("reason"), operation_id=op.get("id"),
                      state=op.get("state"), amount_cents=op.get("amount_cents"))
            results.append(result)
        return results

    # ---- processing --------------------------------------------------------------------------------------------
    def run_due(self, *, limit: int = 50) -> dict[str, int]:
        counts: dict[str, int] = {}
        for op in self.store.operations_due(limit=limit):
            outcome = self.process(op)
            counts[outcome] = counts.get(outcome, 0) + 1
        return counts

    def process(self, op: dict) -> str:
        state = op.get("state")
        try:
            if state == "prepared":
                return self._submit(op)
            if state in ("ambiguous", "submitting"):
                return self._reconcile_submission(op)
            if state in ("item_created", "invoiced", "payment_failed", "uncollectible"):
                return self._refresh(op)
        except LiveModeRefused:
            self._record(op, "manual", error_code="livemode_refused", actor_kind="reconciler")
            return "manual_intervention"
        except StripeTransportError as exc:
            log_event("billing_operation_deferred", operation_id=op.get("id"), state=state, error_code=exc.code)
            return "deferred"
        return "skipped"

    def _submit(self, op: dict) -> str:
        claimed = self.store.claim_operation(operation_id=op["id"], actor=self.actor)
        if not claimed.get("ok"):
            if claimed.get("reason") == "reconcile_first" and claimed.get("operation"):
                return self._reconcile_submission(claimed["operation"])
            return str(claimed.get("reason") or "not_claimed")
        op = claimed["operation"]
        # Always look before creating: an earlier attempt may have reached Stripe (timeout, crash, pruned key).
        try:
            existing = self._find(op)
        except StripeAmbiguous as exc:
            self._record(op, "ambiguous", error_code=exc.code)
            return "ambiguous"
        if existing is not None:
            return self._adopt(op, existing)
        try:
            item = self.transport.create_invoice_item(
                customer=op["stripe_customer_id"], subscription=op["stripe_subscription_id"],
                amount_cents=int(op["amount_cents"]), currency=op["currency"],
                description=f"AI agent overage {op['period_start']} to {op['period_end']} "
                            f"({op['overage_credits']} credits, authorized)",
                metadata={METADATA_KEY: op["id"], "patelrep_hotel_id": op["tenant_id"],
                          "patelrep_period_start": op["period_start"], "patelrep_sequence": str(op["sequence"]),
                          "patelrep_calculation": op["calculation_version"]},
                period_start=_ts(op["period_start"]), period_end=_ts(op["period_end"]) + 86399,
                idempotency_key=f"{IDEMPOTENCY_PREFIX}{op['id']}")
        except StripeAmbiguous as exc:
            self._record(op, "ambiguous", error_code=exc.code)
            return "ambiguous"
        except StripeRejected as exc:
            self._record(op, "rejected", error_code=exc.code)
            return "manual_intervention"
        return self._adopt(op, item)

    def _reconcile_submission(self, op: dict) -> str:
        if op.get("state") == "submitting":
            # Stale claim: the claim RPC converts it to ambiguous; re-read through it.
            claimed = self.store.claim_operation(operation_id=op["id"], actor=self.actor)
            op = claimed.get("operation") or op
        items = self.transport.find_invoice_items(customer=op["stripe_customer_id"], operation_id=op["id"],
                                                  created_gte=_search_from(op))
        if len(items) > 1:
            self._record(op, "manual", error_code="duplicate_invoice_items", actor_kind="reconciler")
            return "manual_intervention"
        if len(items) == 1:
            return self._adopt(op, items[0], actor_kind="reconciler")
        self._record(op, "absent", error_code="confirmed_absent", actor_kind="reconciler")
        return "confirmed_absent"

    def _refresh(self, op: dict) -> str:
        item = self.transport.retrieve_invoice_item(op["stripe_invoice_item_id"])
        if item.customer != op["stripe_customer_id"]:
            self._record(op, "manual", error_code="customer_mismatch", actor_kind="reconciler")
            return "manual_intervention"
        if not item.invoice:
            return "awaiting_invoice"  # pending item: it will be on the subscription's next scheduled invoice
        invoice = self.transport.retrieve_invoice(item.invoice)
        status = invoice.status
        if status == "open" and invoice.attempted:
            status = "payment_failed"
        if status not in ("draft", "open", "paid", "void", "uncollectible", "payment_failed"):
            return "unknown_invoice_status"
        result = self.store.record_operation(
            operation_id=op["id"], outcome="invoice_status", actor_kind="reconciler", actor_ref=self.actor,
            stripe_customer_id=invoice.customer, invoice_id=invoice.id, invoice_status=status,
            hosted_invoice_url=invoice.hosted_invoice_url, livemode=invoice.livemode,
            event_created=int(self.clock()))
        log_event("billing_operation_refreshed", operation_id=op["id"], invoice_status=status,
                  outcome="ok" if result.get("ok") else result.get("reason"))
        return "invoice_" + status if result.get("ok") else str(result.get("reason"))

    # ---- helpers -----------------------------------------------------------------------------------------------
    def _find(self, op: dict) -> Optional[ItemView]:
        items = self.transport.find_invoice_items(customer=op["stripe_customer_id"], operation_id=op["id"],
                                                  created_gte=_search_from(op))
        if len(items) > 1:
            raise StripeAmbiguous("duplicate_invoice_items")
        return items[0] if items else None

    def _adopt(self, op: dict, item: ItemView, *, actor_kind: str = "worker") -> str:
        if item.amount != int(op["amount_cents"]) or item.currency != op["currency"]:
            self._record(op, "manual", error_code="item_amount_mismatch", actor_kind="reconciler")
            return "manual_intervention"
        result = self.store.record_operation(operation_id=op["id"], outcome="item_created", actor_kind=actor_kind,
                                             actor_ref=self.actor, stripe_customer_id=item.customer,
                                             invoice_item_id=item.id, livemode=item.livemode)
        log_event("billing_operation_item", operation_id=op["id"], stripe_invoice_item_id=item.id,
                  outcome="ok" if result.get("ok") else result.get("reason"))
        return "item_created" if result.get("ok") else str(result.get("reason"))

    def _record(self, op: dict, outcome: str, *, error_code: str, actor_kind: str = "worker") -> dict:
        result = self.store.record_operation(operation_id=op["id"], outcome=outcome, actor_kind=actor_kind,
                                             actor_ref=self.actor, error_code=error_code)
        log_event("billing_operation_" + outcome, operation_id=op["id"], error_code=error_code,
                  outcome="ok" if result.get("ok") else result.get("reason"))
        return result
