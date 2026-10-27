"""
Stripe SDK contract tests (stripe-python 16, API version pinned by the SDK).

The billing router's real calls -- Checkout Session, Billing Portal Session and InvoiceItem creation --
run through the REAL stripe SDK against an in-memory HTTP transport. Nothing leaves the process, so
no test-mode or live-mode object is created and no charge can occur. This pins what the SDK actually
puts on the wire after a major upgrade: pinned Stripe-Version header, form-encoded nested params,
the idempotency key, and response parsing into the attributes the router reads.
"""

import json
from datetime import date
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


def test_invoice_item_creation_via_true_up(monkeypatch, http):
    period_start = date(date.today().year, date.today().month, 1)
    db = FakeDB(
        {
            "credit_ledger": [
                {
                    "tenant_id": "hotel-a",
                    "period_start": period_start.isoformat(),
                    "period_end": date.today().isoformat(),
                    "credits_used": 6000,
                    "credits_included": 5000,
                    "overage_credits": 1000,
                    "overage_cost_cents": 2000,
                    "is_finalized": False,
                }
            ],
            "subscriptions": [
                {
                    "tenant_id": "hotel-a",
                    "stripe_customer_id": "cus_test_1",
                    "plan_status": "active",
                    "cap_cents": None,
                    "base_fee_cents": 9900,
                }
            ],
        }
    )
    monkeypatch.setattr(billing_router, "supabase", db)

    result = billing_router.true_up_tenant("hotel-a", period_start, require_active=True)

    assert result["status"] == "invoiced"
    (req,) = http.requests
    assert req["path"] == "/v1/invoiceitems"
    assert req["headers"]["Idempotency-Key"] == f"trueup-hotel-a-{period_start.isoformat()}"
    assert req["headers"]["Stripe-Version"] == stripe.api_version
    assert req["params"] == {
        "customer": "cus_test_1",
        "amount": "2000",
        "currency": "usd",
        "description": "AI Credits Overage: 1000 credits @ $0.02",
    }
    assert db.rows["credit_ledger"][0]["stripe_invoice_id"] == "ii_test_1"
    assert db.rows["credit_ledger"][0]["is_finalized"] is True


def test_sdk_pins_an_endive_or_newer_api_version():
    # A major SDK bump silently changes the version of every outbound call; make that visible.
    assert stripe.api_version == "2026-09-30.endive"
