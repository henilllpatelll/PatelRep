"""Legacy monthly AI-credit true-up through a durable outbox (migration 250, ``billing_trueup_operations``).

Why: the old true-up created the Stripe invoice item first and recorded it second, protected only by Stripe's
idempotency key. If the record write failed and the job retried after Stripe pruned the key (>= 24h; the cron fires on
days 1-3), the same month was billed twice. This module applies the H4 outbox concepts to the legacy charge:

* ``billing_trueup_prepare`` creates ONE operation per hotel-month (unique) and finalizes the ledger in the same
  transaction, before any Stripe call. The operation id is the permanent identity: Stripe idempotency key
  (``patelrep-legacy-trueup-<id>``) and invoice item metadata (``patelrep_legacy_trueup_operation_id``).
* Before EVERY create the worker lists the customer's invoice items. An item carrying the identity is adopted, never
  re-created. An unlabelled item in the legacy format that the hotel's history does not account for (for example one
  created by the pre-outbox code whose record write failed) stops the operation in ``manual_intervention``.
* A request whose outcome is unknown (timeout, 5xx, crash before the record write) is reconciled from Stripe's own
  records before anything is sent again. Anything unproven stops for an operator; nothing is retried blind.
* Already-finalized periods are never touched; a cancellation is recorded for review and never submitted.

Pricing is unchanged (the database computes the same amount as ``legacy_overage_cents``). This is the existing,
already-scheduled legacy billing path: it is not gated by the H4 customer-billing switches.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Callable, Mapping, Optional

logger = logging.getLogger(__name__)

METADATA_KEY = "patelrep_legacy_trueup_operation_id"
H4_METADATA_KEY = "patelrep_billing_operation_id"
IDEMPOTENCY_PREFIX = "patelrep-legacy-trueup-"
LEGACY_DESCRIPTION_PREFIX = "AI Credits Overage"
MAX_LIST_PAGES = 10
SEARCH_MARGIN_SECONDS = 86400


# ---- Stripe transport ------------------------------------------------------------------------------------------------

class TransportError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class Ambiguous(TransportError):
    """The request may have been processed: reconcile from Stripe before any new request."""


class Rejected(TransportError):
    """Stripe definitively refused the request."""


@dataclass(frozen=True)
class Item:
    id: str
    customer: Optional[str]
    amount: int
    currency: str
    livemode: bool
    invoice: Optional[str] = None
    description: Optional[str] = None
    created: Optional[int] = None
    metadata: Mapping[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class Invoice:
    id: str
    customer: Optional[str]
    status: Optional[str]
    livemode: bool
    attempted: bool = False


def _get(obj: Any, key: str) -> Any:
    """Tolerant accessor for dicts and StripeObjects (which raise on missing attributes)."""
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(key)
    try:
        return obj[key]
    except (KeyError, TypeError, AttributeError):
        return getattr(obj, key, None)


def _id(value: Any) -> Optional[str]:
    if value is None or isinstance(value, str):
        return value
    return _get(value, "id")


def _item(obj: Any) -> Item:
    metadata = getattr(obj, "metadata", None) or {}
    created = getattr(obj, "created", None)
    return Item(id=obj.id, customer=_id(getattr(obj, "customer", None)), amount=int(getattr(obj, "amount", 0) or 0),
                currency=str(getattr(obj, "currency", "") or ""), livemode=bool(getattr(obj, "livemode", True)),
                invoice=_id(getattr(obj, "invoice", None)), description=getattr(obj, "description", None),
                created=int(created) if isinstance(created, int) else None,
                metadata={str(k): str(v) for k, v in dict(metadata).items()})


def _classify(exc: Exception) -> TransportError:
    import stripe

    if isinstance(exc, (stripe.APIConnectionError, stripe.RateLimitError, stripe.APIError)):
        return Ambiguous("stripe_unavailable")
    if isinstance(exc, stripe.IdempotencyError):
        return Rejected("stripe_idempotency_mismatch")
    if isinstance(exc, (stripe.AuthenticationError, stripe.PermissionError)):
        return Rejected("stripe_auth_rejected")
    if isinstance(exc, stripe.StripeError):
        return Rejected("stripe_invalid_request")
    return Ambiguous("transport_failure")


class StripeTrueUpTransport:
    """Thin classified wrapper over ``stripe.StripeClient`` with SDK retries off (retries only after reconciliation)."""

    def __init__(self, secret_key: str, *, http_client: Any = None) -> None:
        import stripe

        options: dict[str, Any] = {"max_network_retries": 0}
        if http_client is not None:  # tests: an in-memory transport, nothing leaves the process
            options["http_client"] = http_client
        self._client = stripe.StripeClient(secret_key, **options)

    def create_invoice_item(self, *, customer: str, amount_cents: int, currency: str, description: str,
                            metadata: Mapping[str, str], period_start: int, period_end: int,
                            idempotency_key: str) -> Item:
        try:
            return _item(self._client.v1.invoice_items.create(
                {"customer": customer, "amount": amount_cents, "currency": currency, "description": description,
                 "metadata": dict(metadata), "period": {"start": period_start, "end": period_end}},
                {"idempotency_key": idempotency_key}))
        except Exception as exc:  # noqa: BLE001 -- classified, never logged raw
            raise _classify(exc) from None

    def list_invoice_items(self, *, customer: str, created_gte: int) -> list[Item]:
        found: list[Item] = []
        params: dict[str, Any] = {"customer": customer, "created": {"gte": created_gte}, "limit": 100}
        try:
            for _ in range(MAX_LIST_PAGES):
                page = self._client.v1.invoice_items.list(params)
                found.extend(_item(obj) for obj in page.data)
                if not page.has_more or not page.data:
                    return found
                params["starting_after"] = page.data[-1].id
        except Exception as exc:  # noqa: BLE001
            raise _classify(exc) from None
        raise Ambiguous("invoice_item_search_truncated")

    def retrieve_invoice_item(self, item_id: str) -> Item:
        try:
            return _item(self._client.v1.invoice_items.retrieve(item_id))
        except Exception as exc:  # noqa: BLE001
            raise _classify(exc) from None

    def retrieve_invoice(self, invoice_id: str) -> Invoice:
        try:
            obj = self._client.v1.invoices.retrieve(invoice_id)
        except Exception as exc:  # noqa: BLE001
            raise _classify(exc) from None
        return Invoice(id=obj.id, customer=_id(getattr(obj, "customer", None)), status=getattr(obj, "status", None),
                       livemode=bool(getattr(obj, "livemode", True)), attempted=bool(getattr(obj, "attempted", False)))

    def list_invoice_line_item_ids(self, invoice_id: str) -> list[str]:
        """Every invoice item id on an invoice, across all pages of its lines (webhook payloads carry one page)."""
        ids: list[str] = []
        params: dict[str, Any] = {"limit": 100}
        try:
            for _ in range(MAX_LIST_PAGES):
                page = self._client.v1.invoices.line_items.list(invoice_id, params)
                for line in page.data:
                    details = getattr(getattr(line, "parent", None), "invoice_item_details", None)
                    item = _id(getattr(details, "invoice_item", None) or getattr(line, "invoice_item", None))
                    if isinstance(item, str) and item.startswith("ii_"):
                        ids.append(item)
                if not page.has_more or not page.data:
                    return ids
                params["starting_after"] = page.data[-1].id
        except Exception as exc:  # noqa: BLE001
            raise _classify(exc) from None
        raise Ambiguous("invoice_lines_truncated")


# ---- database ----------------------------------------------------------------------------------------------------------

class TrueUpStore:
    """One method = one migration-250 RPC = one transaction."""

    def __init__(self, client: Any) -> None:
        self._client = client

    def _rpc(self, name: str, params: dict) -> Any:
        return self._client.rpc(name, params).execute().data

    def prepare(self, *, tenant_id: str, period_start: str, source: str, actor: str) -> dict:
        return self._rpc("billing_trueup_prepare", {"p_tenant_id": tenant_id, "p_period_start": period_start,
                                                    "p_source": source, "p_actor": actor}) or {}

    def claim(self, *, operation_id: str, actor: str) -> dict:
        return self._rpc("billing_trueup_claim", {"p_operation_id": operation_id, "p_actor": actor}) or {}

    def record(self, *, operation_id: str, outcome: str, actor_kind: str, actor_ref: str,
               stripe_customer_id: Optional[str] = None, invoice_item_id: Optional[str] = None,
               invoice_id: Optional[str] = None, invoice_status: Optional[str] = None,
               livemode: Optional[bool] = None, error_code: Optional[str] = None,
               event_created: Optional[int] = None) -> dict:
        return self._rpc("billing_trueup_record", {
            "p_operation_id": operation_id, "p_outcome": outcome, "p_actor_kind": actor_kind, "p_actor_ref": actor_ref,
            "p_stripe_customer_id": stripe_customer_id, "p_invoice_item_id": invoice_item_id,
            "p_invoice_id": invoice_id, "p_invoice_status": invoice_status, "p_livemode": livemode,
            "p_error_code": error_code, "p_event_created": event_created}) or {}

    def due(self, *, limit: int = 50) -> list:
        return self._rpc("billing_trueup_due", {"p_limit": limit}) or []

    def find(self, *, invoice_item_ids: list[str], invoice_id: Optional[str]) -> list:
        return self._rpc("billing_trueup_find", {"p_invoice_item_ids": invoice_item_ids or None,
                                                 "p_invoice_id": invoice_id}) or []

    def known_item_ids(self, *, tenant_id: str) -> set[str]:
        return set(self._rpc("billing_trueup_known_item_ids", {"p_tenant_id": tenant_id}) or [])


# ---- processor ---------------------------------------------------------------------------------------------------------

def _day_ts(value: str) -> int:
    return int(datetime.combine(date.fromisoformat(value[:10]), datetime.min.time(), tzinfo=timezone.utc).timestamp())


@dataclass
class LegacyTrueUp:
    store: TrueUpStore
    transport: Any
    actor: str = "legacy-trueup"
    clock: Callable[[], float] = time.time

    def run_period(self, tenant_id: str, period_start: str, *, source: str = "period_end") -> dict:
        prepared = self.store.prepare(tenant_id=tenant_id, period_start=period_start, source=source, actor=self.actor)
        status = prepared.get("status") or prepared.get("reason") or "error"
        op = prepared.get("operation")
        if not op:
            return {"status": status}
        outcome = self.process(op)
        return {"status": outcome, "operation_id": op["id"], "amount_cents": op.get("amount_cents")}

    def run_due(self, *, limit: int = 50) -> dict[str, int]:
        counts: dict[str, int] = {}
        for op in self.store.due(limit=limit):
            outcome = self.process(op)
            counts[outcome] = counts.get(outcome, 0) + 1
        return counts

    def process(self, op: dict) -> str:
        state = op.get("state")
        try:
            if state == "prepared":
                return self._submit(op)
            if state in ("ambiguous", "submitting"):
                return self._reconcile(op)
            if state in ("item_created", "invoiced", "payment_failed", "uncollectible"):
                return self._refresh(op)
        except TransportError as exc:
            logger.warning("legacy true-up deferred operation=%s state=%s code=%s", op.get("id"), state, exc.code)
            return "deferred"
        return str(state)

    # ---- steps ---------------------------------------------------------------------------------------------------
    def _submit(self, op: dict) -> str:
        claimed = self.store.claim(operation_id=op["id"], actor=self.actor)
        if not claimed.get("ok"):
            if claimed.get("reason") == "reconcile_first" and claimed.get("operation"):
                return self._reconcile(claimed["operation"])
            return str(claimed.get("reason") or "not_claimed")
        op = claimed["operation"]
        try:
            verdict = self._evidence(op)
        except Ambiguous as exc:
            self._record(op, "ambiguous", error_code=exc.code)
            return "ambiguous"
        if verdict is not None:
            return verdict
        try:
            item = self.transport.create_invoice_item(
                customer=op["stripe_customer_id"], amount_cents=int(op["amount_cents"]), currency=op["currency"],
                description=f"{LEGACY_DESCRIPTION_PREFIX}: {Decimal(op['overage_credits']).normalize():f} credits @ $0.02",
                metadata={METADATA_KEY: op["id"], "patelrep_hotel_id": op["tenant_id"],
                          "patelrep_period_start": op["period_start"], "patelrep_calculation": op["calculation_version"]},
                period_start=_day_ts(op["period_start"]), period_end=_day_ts(op["period_end"]) + 86399,
                idempotency_key=f"{IDEMPOTENCY_PREFIX}{op['id']}")
        except Ambiguous as exc:
            self._record(op, "ambiguous", error_code=exc.code)
            return "ambiguous"
        except Rejected as exc:
            self._record(op, "rejected", error_code=exc.code)
            return "manual_intervention"
        return self._adopt(op, item, actor_kind="worker")

    def _reconcile(self, op: dict) -> str:
        if op.get("state") == "submitting":
            claimed = self.store.claim(operation_id=op["id"], actor=self.actor)  # converts a stale claim to ambiguous
            op = claimed.get("operation") or op
            if op.get("state") == "submitting":
                return "in_flight"
        verdict = self._evidence(op)
        if verdict is not None:
            return verdict
        self._record(op, "absent", error_code="confirmed_absent", actor_kind="reconciler")
        return "confirmed_absent"

    def _evidence(self, op: dict) -> Optional[str]:
        """Look at Stripe before any create. Returns an outcome when evidence decides it, None when proven absent."""
        items = self.transport.list_invoice_items(customer=op["stripe_customer_id"],
                                                  created_gte=max(0, _day_ts(op["period_start"]) - SEARCH_MARGIN_SECONDS))
        own = [i for i in items if i.metadata.get(METADATA_KEY) == op["id"]]
        known = self.store.known_item_ids(tenant_id=op["tenant_id"])
        unlinked = [i for i in items if i.id not in known and METADATA_KEY not in i.metadata
                    and H4_METADATA_KEY not in i.metadata
                    and (i.description or "").startswith(LEGACY_DESCRIPTION_PREFIX)]
        if len(own) > 1:
            self._record(op, "manual", error_code="duplicate_invoice_items", actor_kind="reconciler")
            return "manual_intervention"
        if unlinked:
            # A legacy-format item nobody recorded: possibly this month, already charged by the pre-outbox code.
            self._record(op, "manual", error_code="unlinked_legacy_item_found", actor_kind="reconciler")
            return "manual_intervention"
        if own:
            return self._adopt(op, own[0], actor_kind="reconciler")
        return None

    def _refresh(self, op: dict) -> str:
        item = self.transport.retrieve_invoice_item(op["stripe_invoice_item_id"])
        if item.customer != op["stripe_customer_id"]:
            self._record(op, "manual", error_code="customer_mismatch", actor_kind="reconciler")
            return "manual_intervention"
        if not item.invoice:
            return "awaiting_invoice"
        invoice = self.transport.retrieve_invoice(item.invoice)
        status = "payment_failed" if invoice.status == "open" and invoice.attempted else invoice.status
        if status not in ("draft", "open", "paid", "void", "uncollectible", "payment_failed"):
            return "unknown_invoice_status"
        result = self.store.record(operation_id=op["id"], outcome="invoice_status", actor_kind="reconciler",
                                   actor_ref=self.actor, stripe_customer_id=invoice.customer, invoice_id=invoice.id,
                                   invoice_status=status, livemode=invoice.livemode, event_created=int(self.clock()))
        return "invoice_" + status if result.get("ok") else str(result.get("reason"))

    def _adopt(self, op: dict, item: Item, *, actor_kind: str) -> str:
        if item.amount != int(op["amount_cents"]) or item.currency != op["currency"]:
            self._record(op, "manual", error_code="item_amount_mismatch", actor_kind="reconciler")
            return "manual_intervention"
        result = self.store.record(operation_id=op["id"], outcome="item_created", actor_kind=actor_kind,
                                   actor_ref=self.actor, stripe_customer_id=item.customer, invoice_item_id=item.id,
                                   livemode=item.livemode)
        return "item_created" if result.get("ok") else str(result.get("reason"))

    def _record(self, op: dict, outcome: str, *, error_code: str, actor_kind: str = "worker") -> dict:
        result = self.store.record(operation_id=op["id"], outcome=outcome, actor_kind=actor_kind, actor_ref=self.actor,
                                   error_code=error_code)
        logger.info("legacy true-up operation=%s outcome=%s code=%s ok=%s", op.get("id"), outcome, error_code,
                    bool(result.get("ok")))
        return result


# ---- invoice events (signature-verified, de-duplicated by the webhook router) ----------------------------------------

def apply_invoice_event(event: Any, store: TrueUpStore, item_ids: list[str]) -> int:
    """Associate a verified invoice event with legacy operations by invoice item id or invoice id. Idempotent:
    the record RPC is customer-checked, ignores stale events and never moves a paid/void operation."""
    event_type = _get(event, "type")
    invoice = _get(_get(event, "data"), "object")
    invoice_id = _id(invoice)
    if not isinstance(invoice_id, str) or not invoice_id.startswith("in_"):
        return 0
    status = "payment_failed" if event_type == "invoice.payment_failed" else _get(invoice, "status")
    if status not in ("draft", "open", "paid", "void", "uncollectible", "payment_failed"):
        return 0
    event_id = _get(event, "id")
    created = _get(event, "created")
    livemode = _get(invoice, "livemode")
    ops = store.find(invoice_item_ids=item_ids, invoice_id=invoice_id)
    for op in ops:
        store.record(operation_id=op["id"], outcome="invoice_status", actor_kind="webhook",
                     actor_ref=event_id if isinstance(event_id, str) and len(event_id) <= 100 else "stripe-webhook",
                     stripe_customer_id=_id(_get(invoice, "customer")), invoice_id=invoice_id, invoice_status=status,
                     livemode=None if livemode is None else bool(livemode),
                     event_created=int(created) if isinstance(created, int) else None)
    return len(ops)


def default_processor() -> LegacyTrueUp:
    from core.config import settings
    from core.database import supabase

    return LegacyTrueUp(store=TrueUpStore(supabase), transport=StripeTrueUpTransport(settings.stripe_secret_key or ""))
