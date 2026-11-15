"""H4 handling of signature-verified Stripe invoice events (called from routers/webhooks.py after verification and
event-id de-duplication).

Idempotent by construction: every update goes through ``agent_billing_operation_record``, which
  * enforces the hotel's Stripe customer id (a mismatch moves the operation to manual intervention, never applies),
  * refuses live-mode objects,
  * ignores events older than the last applied one (``event.created``) and never moves a paid/void operation.
Duplicate, retried and out-of-order deliveries are therefore harmless. Events that cannot be matched are ignored here;
the reconciler links pending items to invoices by retrieving the item.
"""
from __future__ import annotations

from typing import Any, Optional

from services.agent_billing.observability import log_event
from services.agent_billing.store import CustomerBillingStore

INVOICE_EVENTS = frozenset({
    "invoice.created", "invoice.finalized", "invoice.updated", "invoice.paid", "invoice.payment_succeeded",
    "invoice.payment_failed", "invoice.voided", "invoice.marked_uncollectible",
})


def _get(obj: Any, key: str) -> Any:
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


def invoice_item_ids(invoice: Any) -> list[str]:
    """Invoice item ids on an invoice's lines, for both line shapes (parent.invoice_item_details and legacy)."""
    ids: list[str] = []
    lines = _get(_get(invoice, "lines"), "data") or []
    for line in lines:
        details = _get(_get(line, "parent"), "invoice_item_details")
        item = _get(details, "invoice_item") or _get(line, "invoice_item")
        item = _id(item)
        if isinstance(item, str) and item.startswith("ii_"):
            ids.append(item)
    return ids


def handle_invoice_event(event: Any, store: CustomerBillingStore) -> int:
    """Apply one verified invoice event to matching H4 operations. Returns how many operations it touched."""
    event_type = _get(event, "type")
    if event_type not in INVOICE_EVENTS:
        return 0
    invoice = _get(_get(event, "data"), "object")
    invoice_id = _id(invoice)
    if not isinstance(invoice_id, str) or not invoice_id.startswith("in_"):
        return 0
    status = "payment_failed" if event_type == "invoice.payment_failed" else _get(invoice, "status")
    if status not in ("draft", "open", "paid", "void", "uncollectible", "payment_failed"):
        return 0
    item_ids = invoice_item_ids(invoice)
    operations = store.find_operations(invoice_item_ids=item_ids, invoice_id=invoice_id)
    event_id = _get(event, "id")
    created = _get(event, "created")
    livemode = _get(invoice, "livemode")
    for op in operations:
        result = store.record_operation(
            operation_id=op["id"], outcome="invoice_status", actor_kind="webhook",
            actor_ref=event_id if isinstance(event_id, str) and len(event_id) <= 100 else "stripe-webhook",
            stripe_customer_id=_id(_get(invoice, "customer")), invoice_id=invoice_id, invoice_status=status,
            hosted_invoice_url=_get(invoice, "hosted_invoice_url"),
            livemode=True if livemode is None else bool(livemode),
            event_created=int(created) if isinstance(created, int) else None)
        log_event("billing_webhook_applied", operation_id=op["id"], event_type=event_type, invoice_status=status,
                  outcome="ok" if result.get("ok") else result.get("reason"))
    return len(operations)
