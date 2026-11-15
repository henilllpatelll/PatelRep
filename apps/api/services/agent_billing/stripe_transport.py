"""The only code in H4 that talks to Stripe. Test mode only (``H4_LIVE_STRIPE_SUPPORTED = False``).

Invoice strategy (one, documented in ADR-0003): ONE invoice item per billing operation, created with
``subscription=<the hotel's active subscription>`` so Stripe adds it to that subscription's next scheduled invoice
(docs.stripe.com/api/invoiceitems/create, ``subscription``). H4 never creates a standalone invoice, never passes
``invoice=``, and never finalizes anything itself.

Error classification decides whether a retry is even allowed:
  * ``StripeAmbiguous``: the request may have been processed (connection error, timeout, 5xx, 429). The caller must
    look the object up by metadata before any new request -- never assume a timed-out request failed.
  * ``StripeRejected``: Stripe definitively refused (4xx validation/auth/idempotency mismatch). Not retried
    automatically; the operation goes to manual intervention.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping, Optional, Protocol

from services.agent_billing import H4_LIVE_STRIPE_SUPPORTED
from services.agent_billing.config import is_test_mode_key

METADATA_KEY = "patelrep_billing_operation_id"
MAX_LIST_PAGES = 10


class StripeTransportError(Exception):
    code = "stripe_error"

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class StripeAmbiguous(StripeTransportError):
    """Outcome unknown: reconcile before retrying."""


class StripeRejected(StripeTransportError):
    """Definitively not processed."""


class LiveModeRefused(StripeTransportError):
    pass


@dataclass(frozen=True)
class ItemView:
    id: str
    customer: Optional[str]
    amount: int
    currency: str
    livemode: bool
    invoice: Optional[str] = None
    metadata: Mapping[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class InvoiceView:
    id: str
    customer: Optional[str]
    status: Optional[str]
    livemode: bool
    attempted: bool = False
    hosted_invoice_url: Optional[str] = None


class StripeTransport(Protocol):
    def create_invoice_item(self, *, customer: str, subscription: str, amount_cents: int, currency: str,
                            description: str, metadata: Mapping[str, str], period_start: int, period_end: int,
                            idempotency_key: str) -> ItemView: ...

    def find_invoice_items(self, *, customer: str, operation_id: str, created_gte: int) -> list[ItemView]: ...

    def retrieve_invoice_item(self, item_id: str) -> ItemView: ...

    def retrieve_invoice(self, invoice_id: str) -> InvoiceView: ...


def _id(value: Any) -> Optional[str]:
    if value is None:
        return None
    return value if isinstance(value, str) else getattr(value, "id", None)


def item_view(obj: Any) -> ItemView:
    metadata = getattr(obj, "metadata", None) or {}
    return ItemView(id=obj.id, customer=_id(getattr(obj, "customer", None)), amount=int(getattr(obj, "amount", 0) or 0),
                    currency=str(getattr(obj, "currency", "") or ""), livemode=bool(getattr(obj, "livemode", True)),
                    invoice=_id(getattr(obj, "invoice", None)),
                    metadata={str(k): str(v) for k, v in dict(metadata).items()})


def invoice_view(obj: Any) -> InvoiceView:
    return InvoiceView(id=obj.id, customer=_id(getattr(obj, "customer", None)), status=getattr(obj, "status", None),
                       livemode=bool(getattr(obj, "livemode", True)), attempted=bool(getattr(obj, "attempted", False)),
                       hosted_invoice_url=getattr(obj, "hosted_invoice_url", None))


def _classify(exc: Exception) -> StripeTransportError:
    import stripe

    if isinstance(exc, (stripe.APIConnectionError, stripe.RateLimitError)):
        return StripeAmbiguous("stripe_connection_or_rate_limit")
    if isinstance(exc, stripe.APIError):
        return StripeAmbiguous("stripe_server_error")
    if isinstance(exc, stripe.IdempotencyError):
        return StripeRejected("stripe_idempotency_mismatch")
    if isinstance(exc, (stripe.AuthenticationError, stripe.PermissionError)):
        return StripeRejected("stripe_auth_rejected")
    if isinstance(exc, stripe.InvalidRequestError):
        return StripeRejected("stripe_invalid_request")
    if isinstance(exc, stripe.StripeError):
        return StripeRejected("stripe_rejected")
    return StripeAmbiguous("transport_failure")


class StripeSdkTransport:
    """Real transport over ``stripe.StripeClient``; refuses any key that is not test mode while H4 is the ceiling."""

    def __init__(self, secret_key: str) -> None:
        if not H4_LIVE_STRIPE_SUPPORTED and not is_test_mode_key(secret_key):
            raise LiveModeRefused("live_mode_refused")
        import stripe

        # No SDK retries: a retry happens only after the outbox has reconciled Stripe's recorded outcome.
        self._client = stripe.StripeClient(secret_key, max_network_retries=0)

    def _guard(self, livemode: bool) -> None:
        if livemode and not H4_LIVE_STRIPE_SUPPORTED:
            raise LiveModeRefused("live_object_refused")

    def create_invoice_item(self, *, customer: str, subscription: str, amount_cents: int, currency: str,
                            description: str, metadata: Mapping[str, str], period_start: int, period_end: int,
                            idempotency_key: str) -> ItemView:
        try:
            obj = self._client.v1.invoice_items.create(
                {"customer": customer, "subscription": subscription, "amount": amount_cents, "currency": currency,
                 "description": description, "metadata": dict(metadata),
                 "period": {"start": period_start, "end": period_end}},
                {"idempotency_key": idempotency_key})
        except Exception as exc:  # noqa: BLE001 -- classified, never logged raw
            raise _classify(exc) from None
        view = item_view(obj)
        self._guard(view.livemode)
        return view

    def find_invoice_items(self, *, customer: str, operation_id: str, created_gte: int) -> list[ItemView]:
        found: list[ItemView] = []
        params: dict[str, Any] = {"customer": customer, "created": {"gte": created_gte}, "limit": 100}
        try:
            for _ in range(MAX_LIST_PAGES):
                page = self._client.v1.invoice_items.list(params)
                for obj in page.data:
                    view = item_view(obj)
                    if view.metadata.get(METADATA_KEY) == operation_id:
                        self._guard(view.livemode)
                        found.append(view)
                if not page.has_more or not page.data:
                    return found
                params["starting_after"] = page.data[-1].id
        except StripeTransportError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise _classify(exc) from None
        raise StripeAmbiguous("invoice_item_search_truncated")

    def retrieve_invoice_item(self, item_id: str) -> ItemView:
        try:
            view = item_view(self._client.v1.invoice_items.retrieve(item_id))
        except Exception as exc:  # noqa: BLE001
            raise _classify(exc) from None
        self._guard(view.livemode)
        return view

    def retrieve_invoice(self, invoice_id: str) -> InvoiceView:
        try:
            view = invoice_view(self._client.v1.invoices.retrieve(invoice_id))
        except Exception as exc:  # noqa: BLE001
            raise _classify(exc) from None
        self._guard(view.livemode)
        return view
