"""
Stripe SDK contract tests (stripe-python 16, API version pinned by the SDK).

The billing router's real calls -- Checkout Session, Billing Portal Session and InvoiceItem creation --
run through the REAL stripe SDK against an in-memory HTTP transport. Nothing leaves the process, so
no test-mode or live-mode object is created and no charge can occur. This pins what the SDK actually
puts on the wire after a major upgrade: pinned Stripe-Version header, form-encoded nested params,
the idempotency key, and response parsing into the attributes the router reads.
"""

import json
from urllib.parse import parse_qsl

import pytest
import stripe

from middleware.auth import CurrentUser
from routers import billing as billing_router
from tests.smoke.fake_supabase import FakeDB

GM = CurrentUser(
    user_id="11111111-1111-4111-8111-111111111111",
    hotel_id="hotel-a",
    role="gm",
    email="gm@example.com",
)

RESPONSES = {
    "/v1/checkout/sessions": {"id": "cs_test_1", "object": "checkout.session", "url": "https://checkout.stripe.test/c/cs_test_1"},
    "/v1/billing_portal/sessions": {"id": "bps_test_1", "object": "billing_portal.session", "url": "https://billing.stripe.test/p/bps_test_1"},
    "/v1/invoiceitems": {"id": "ii_test_1", "object": "invoiceitem"},
}


class RecordingHTTPClient(stripe.HTTPClient):
    """Replaces the SDK transport; records each request and answers with canned JSON."""

    name = "recording"

    def __init__(self):
        super().__init__()
        self.requests = []

    def request(self, method, url, headers, post_data=None, *, _usage=None):
        path = "/" + url.split("://", 1)[1].split("/", 1)[1]
        if method == "get" and path not in RESPONSES:
            path = path.replace("%5B", "[").replace("%5D", "]")
        self.requests.append(
            {
                "method": method,
                "url": url,
                "path": path,
                "headers": dict(headers or {}),
                "params": dict(parse_qsl(post_data or "", keep_blank_values=True)),
            }
        )
        return json.dumps(RESPONSES[path]), 200, {}

    def close(self):
        pass


@pytest.fixture
def http(monkeypatch):
    client = RecordingHTTPClient()
    monkeypatch.setattr(stripe, "default_http_client", client)
    monkeypatch.setattr(stripe, "api_key", "sk_test_contract_fixture")
    return client


def _use_subscription_row(monkeypatch, **extra):
    row = {"tenant_id": "hotel-a", "stripe_customer_id": "cus_test_1", "stripe_subscription_id": None, **extra}
    monkeypatch.setattr(billing_router, "supabase", FakeDB({"subscriptions": [row]}))


@pytest.mark.asyncio
async def test_checkout_session_request_shape_and_response(monkeypatch, http):
    _use_subscription_row(monkeypatch)

    result = await billing_router.create_checkout_session(current_user=GM)

    assert result == {"data": {"url": "https://checkout.stripe.test/c/cs_test_1"}}
    (req,) = http.requests
    assert req["method"] == "post" and req["path"] == "/v1/checkout/sessions"
    assert req["headers"]["Authorization"] == "Bearer sk_test_contract_fixture"
    assert req["headers"]["Stripe-Version"] == stripe.api_version
    params = req["params"]
    assert params["mode"] == "subscription"
    assert params["customer"] == "cus_test_1"
    assert params["metadata[hotel_id]"] == "hotel-a"
    assert params["line_items[0][quantity]"] == "1"
    assert params["line_items[0][price_data][currency]"] == "usd"
    assert params["line_items[0][price_data][unit_amount]"] == str(billing_router.settings.base_plan_price_cents)
    assert params["line_items[0][price_data][recurring][interval]"] == "month"
    assert params["success_url"].endswith("/settings/billing?checkout=success")
    assert params["cancel_url"].endswith("/settings/billing?checkout=cancelled")
    # 2026-09-30.endive removed Checkout Sessions' payment_method_types; the router must not send it.
    assert not any(k.startswith("payment_method_types") for k in params)


@pytest.mark.asyncio
async def test_checkout_session_without_stripe_customer_omits_customer(monkeypatch, http):
    monkeypatch.setattr(billing_router, "supabase", FakeDB({"subscriptions": [{"tenant_id": "hotel-a"}]}))

    await billing_router.create_checkout_session(current_user=GM)

    assert "customer" not in http.requests[0]["params"]


@pytest.mark.asyncio
async def test_billing_portal_session_request_shape_and_response(monkeypatch, http):
    _use_subscription_row(monkeypatch)

    result = await billing_router.create_portal_session(current_user=GM)

    assert result == {"data": {"url": "https://billing.stripe.test/p/bps_test_1"}}
    (req,) = http.requests
    assert req["path"] == "/v1/billing_portal/sessions"
    assert req["headers"]["Stripe-Version"] == stripe.api_version
    assert req["params"]["customer"] == "cus_test_1"
    assert req["params"]["return_url"].endswith("/settings/billing")


def test_legacy_trueup_invoice_item_request_shape_and_response(http):
    """The legacy true-up outbox's create call on the wire: durable operation identity as BOTH the idempotency key and
    the invoice item metadata (so a retry after Stripe prunes the key still finds the item), unchanged amount and
    customer-facing description, and the billed period."""
    from services.billing_trueup import METADATA_KEY, StripeTrueUpTransport

    transport = StripeTrueUpTransport("sk_test_contract_fixture", http_client=http)
    item = transport.create_invoice_item(
        customer="cus_test_1", amount_cents=2000, currency="usd", description="AI Credits Overage: 1000 credits @ $0.02",
        metadata={METADATA_KEY: "op-1", "patelrep_hotel_id": "hotel-a"}, period_start=1761955200,
        period_end=1764547199, idempotency_key="patelrep-legacy-trueup-op-1")

    assert item.id == "ii_test_1"
    (req,) = http.requests
    assert req["path"] == "/v1/invoiceitems"
    assert req["headers"]["Idempotency-Key"] == "patelrep-legacy-trueup-op-1"
    assert req["headers"]["Stripe-Version"] == stripe.api_version
    assert req["params"] == {
        "customer": "cus_test_1",
        "amount": "2000",
        "currency": "usd",
        "description": "AI Credits Overage: 1000 credits @ $0.02",
        f"metadata[{METADATA_KEY}]": "op-1",
        "metadata[patelrep_hotel_id]": "hotel-a",
        "period[start]": "1761955200",
        "period[end]": "1764547199",
    }


def test_legacy_trueup_pages_every_invoice_line(http):
    from services.billing_trueup import StripeTrueUpTransport

    RESPONSES["/v1/invoices/in_test_1/lines?limit=100"] = {
        "object": "list", "has_more": True, "url": "/v1/invoices/in_test_1/lines",
        "data": [{"id": "il_1", "object": "line_item",
                  "parent": {"invoice_item_details": {"invoice_item": "ii_page1"}}}]}
    RESPONSES["/v1/invoices/in_test_1/lines?limit=100&starting_after=il_1"] = {
        "object": "list", "has_more": False, "url": "/v1/invoices/in_test_1/lines",
        "data": [{"id": "il_2", "object": "line_item", "parent": {"invoice_item_details": {"invoice_item": "ii_page2"}}},
                 {"id": "il_3", "object": "line_item", "parent": {"subscription_item_details": {}}}]}
    transport = StripeTrueUpTransport("sk_test_contract_fixture", http_client=http)
    assert transport.list_invoice_line_item_ids("in_test_1") == ["ii_page1", "ii_page2"]
    assert [r["method"] for r in http.requests] == ["get", "get"]


def test_sdk_pins_an_endive_or_newer_api_version():
    # A major SDK bump silently changes the version of every outbound call; make that visible.
    # Minor SDK bumps advance the date within a codename (16.0.0 -> 2026-09-30.endive, 16.1.0 -> 2026-10-28.endive)
    # and are backwards compatible. A different codename marks Stripe's breaking-change boundary, so it must fail
    # here and force a deliberate review of the billing calls; so must an older date or a malformed version.
    date_part, dot, codename = stripe.api_version.partition(".")
    assert dot == "." and codename == "endive", stripe.api_version
    assert len(date_part) == 10 and date_part >= "2026-09-30", stripe.api_version
