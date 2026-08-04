"""
Regression tests for BILLING-07/08:

1. internal.py::monthly_trueup created a Stripe InvoiceItem for every tenant
   with overage on EVERY invocation with no idempotency guard. Its cron
   schedule (0 0 28-31 * *) fires 2-4x/month by design, so every hotel with
   overage got double- or triple-billed.
2. true_up_tenant() must never finalize a billing period before that period
   has actually ended -- increment_credits_used() (migration 020) no-ops
   once is_finalized is TRUE, so an early finalization would silently drop
   the tail of a month's usage forever.
3. customer.subscription.deleted flipped plan_status to cancelled with no
   final true-up step, so overage accrued before a mid-cycle cancellation
   was silently never invoiced.
"""

from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from routers import billing as billing_router
from routers import internal as internal_router
from routers import webhooks as webhooks_router
from tests.smoke.fake_supabase import FakeDB
from tests.smoke.test_webhooks_and_transitions import FakeRequest, stripe_event


def _stub_invoice_item_create(monkeypatch, calls):
    def _create(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(id="ii_1")

    monkeypatch.setattr(billing_router.stripe.InvoiceItem, "create", _create)


# ---------------------------------------------------------------------------
# Task 1: true_up_tenant()
# ---------------------------------------------------------------------------


def test_true_up_tenant_invoices_overage_and_finalizes_ledger(monkeypatch):
    period_start = date(date.today().year, date.today().month, 1)
    db = FakeDB({
        "credit_ledger": [{
            "tenant_id": "hotel-a",
            "period_start": period_start.isoformat(),
            "period_end": date.today().isoformat(),
            "credits_used": 6000,
            "credits_included": 5000,
            "overage_credits": 1000,
            "overage_cost_cents": 2000,
            "is_finalized": False,
        }],
        "subscriptions": [{
            "tenant_id": "hotel-a",
            "stripe_customer_id": "cus_1",
            "plan_status": "active",
            "cap_cents": None,
            "base_fee_cents": 9900,
        }],
    })
    monkeypatch.setattr(billing_router, "supabase", db)
    calls = []
    _stub_invoice_item_create(monkeypatch, calls)

    result = billing_router.true_up_tenant("hotel-a", period_start, require_active=True)

    assert len(calls) == 1
    assert calls[0]["idempotency_key"] == f"trueup-hotel-a-{period_start.isoformat()}"
    assert db.rows["credit_ledger"][0]["is_finalized"] is True
    assert db.rows["credit_ledger"][0]["stripe_invoice_id"] == "ii_1"
    assert result["status"] == "invoiced"


def test_true_up_tenant_skips_already_finalized_ledger(monkeypatch):
    period_start = date(date.today().year, date.today().month, 1)
    db = FakeDB({
        "credit_ledger": [{
            "tenant_id": "hotel-a",
            "period_start": period_start.isoformat(),
            "period_end": date.today().isoformat(),
            "credits_used": 6000,
            "credits_included": 5000,
            "overage_credits": 1000,
            "overage_cost_cents": 2000,
            "is_finalized": True,
        }],
        "subscriptions": [{
            "tenant_id": "hotel-a",
            "stripe_customer_id": "cus_1",
            "plan_status": "active",
            "cap_cents": None,
            "base_fee_cents": 9900,
        }],
    })
    monkeypatch.setattr(billing_router, "supabase", db)
    calls = []
    _stub_invoice_item_create(monkeypatch, calls)

    result = billing_router.true_up_tenant("hotel-a", period_start, require_active=True)

    assert calls == []
    assert result == {"status": "already_finalized"}


def test_true_up_tenant_finalizes_without_invoicing_when_no_overage(monkeypatch):
    period_start = date(date.today().year, date.today().month, 1)
    db = FakeDB({
        "credit_ledger": [{
            "tenant_id": "hotel-a",
            "period_start": period_start.isoformat(),
            "period_end": date.today().isoformat(),
            "credits_used": 100,
            "credits_included": 5000,
            "overage_credits": 0,
            "overage_cost_cents": 0,
            "is_finalized": False,
        }],
        "subscriptions": [{
            "tenant_id": "hotel-a",
            "stripe_customer_id": "cus_1",
            "plan_status": "active",
            "cap_cents": None,
            "base_fee_cents": 9900,
        }],
    })
    monkeypatch.setattr(billing_router, "supabase", db)
    calls = []
    _stub_invoice_item_create(monkeypatch, calls)

    result = billing_router.true_up_tenant("hotel-a", period_start, require_active=True)

    assert calls == []
    assert db.rows["credit_ledger"][0]["is_finalized"] is True
    assert result == {"status": "no_overage_finalized"}


def test_true_up_tenant_skips_inactive_when_require_active_true(monkeypatch):
    period_start = date(date.today().year, date.today().month, 1)
    db = FakeDB({
        "credit_ledger": [{
            "tenant_id": "hotel-a",
            "period_start": period_start.isoformat(),
            "period_end": date.today().isoformat(),
            "credits_used": 6000,
            "credits_included": 5000,
            "overage_credits": 1000,
            "overage_cost_cents": 2000,
            "is_finalized": False,
        }],
        "subscriptions": [{
            "tenant_id": "hotel-a",
            "stripe_customer_id": "cus_1",
            "plan_status": "trialing",
            "cap_cents": None,
            "base_fee_cents": 9900,
        }],
    })
    monkeypatch.setattr(billing_router, "supabase", db)
    calls = []
    _stub_invoice_item_create(monkeypatch, calls)

    result = billing_router.true_up_tenant("hotel-a", period_start, require_active=True)

    assert calls == []
    assert db.rows["credit_ledger"][0]["is_finalized"] is False
    assert result == {"status": "skipped_inactive"}


def test_true_up_tenant_bills_inactive_when_require_active_false(monkeypatch):
    period_start = date(date.today().year, date.today().month, 1)
    db = FakeDB({
        "credit_ledger": [{
            "tenant_id": "hotel-a",
            "period_start": period_start.isoformat(),
            "period_end": date.today().isoformat(),
            "credits_used": 6000,
            "credits_included": 5000,
            "overage_credits": 1000,
            "overage_cost_cents": 2000,
            "is_finalized": False,
        }],
        "subscriptions": [{
            "tenant_id": "hotel-a",
            "stripe_customer_id": "cus_1",
            "plan_status": "trialing",
            "cap_cents": None,
            "base_fee_cents": 9900,
        }],
    })
    monkeypatch.setattr(billing_router, "supabase", db)
    calls = []
    _stub_invoice_item_create(monkeypatch, calls)

    result = billing_router.true_up_tenant("hotel-a", period_start, require_active=False)

    assert len(calls) == 1
    assert result["status"] == "invoiced"


def test_true_up_tenant_does_not_finalize_before_period_ends(monkeypatch):
    period_start = date(date.today().year, date.today().month, 1)
    db = FakeDB({
        "credit_ledger": [{
            "tenant_id": "hotel-a",
            "period_start": period_start.isoformat(),
            "period_end": (date.today() + timedelta(days=2)).isoformat(),
            "credits_used": 6000,
            "credits_included": 5000,
            "overage_credits": 1000,
            "overage_cost_cents": 2000,
            "is_finalized": False,
        }],
        "subscriptions": [{
            "tenant_id": "hotel-a",
            "stripe_customer_id": "cus_1",
            "plan_status": "active",
            "cap_cents": None,
            "base_fee_cents": 9900,
        }],
    })
    monkeypatch.setattr(billing_router, "supabase", db)
    calls = []
    _stub_invoice_item_create(monkeypatch, calls)

    result = billing_router.true_up_tenant("hotel-a", period_start, require_active=True)

    assert result == {"status": "period_not_yet_ended"}
    assert calls == []
    assert db.rows["credit_ledger"][0]["is_finalized"] is False


def test_true_up_tenant_ignores_period_ended_gate_when_require_period_ended_false(monkeypatch):
    period_start = date(date.today().year, date.today().month, 1)
    db = FakeDB({
        "credit_ledger": [{
            "tenant_id": "hotel-a",
            "period_start": period_start.isoformat(),
            "period_end": (date.today() + timedelta(days=2)).isoformat(),
            "credits_used": 6000,
            "credits_included": 5000,
            "overage_credits": 1000,
            "overage_cost_cents": 2000,
            "is_finalized": False,
        }],
        "subscriptions": [{
            "tenant_id": "hotel-a",
            "stripe_customer_id": "cus_1",
            "plan_status": "active",
            "cap_cents": None,
            "base_fee_cents": 9900,
        }],
    })
    monkeypatch.setattr(billing_router, "supabase", db)
    calls = []
    _stub_invoice_item_create(monkeypatch, calls)

    result = billing_router.true_up_tenant(
        "hotel-a", period_start, require_active=True, require_period_ended=False
    )

    assert len(calls) == 1
    assert result["status"] == "invoiced"


@pytest.mark.asyncio
async def test_monthly_trueup_cron_running_twice_does_not_double_invoice(monkeypatch):
    period_start = date(date.today().year, date.today().month, 1)
    db = FakeDB({
        "credit_ledger": [{
            "tenant_id": "hotel-a",
            "period_start": period_start.isoformat(),
            "period_end": date.today().isoformat(),
            "credits_used": 6000,
            "credits_included": 5000,
            "overage_credits": 1000,
            "overage_cost_cents": 2000,
            "is_finalized": False,
        }],
        "subscriptions": [{
            "tenant_id": "hotel-a",
            "stripe_customer_id": "cus_1",
            "plan_status": "active",
            "cap_cents": None,
            "base_fee_cents": 9900,
        }],
    })
    monkeypatch.setattr(billing_router, "supabase", db)
    monkeypatch.setattr(internal_router, "supabase", db)
    monkeypatch.setattr(internal_router.settings, "cron_secret", "test-secret")
    calls = []
    _stub_invoice_item_create(monkeypatch, calls)

    await internal_router.monthly_trueup(x_cron_secret="test-secret")
    await internal_router.monthly_trueup(x_cron_secret="test-secret")

    assert len(calls) == 1


@pytest.mark.asyncio
async def test_monthly_trueup_skips_ledgers_whose_period_has_not_ended(monkeypatch):
    period_start = date(date.today().year, date.today().month, 1)
    db = FakeDB({
        "credit_ledger": [{
            "tenant_id": "hotel-a",
            "period_start": period_start.isoformat(),
            "period_end": (date.today() + timedelta(days=3)).isoformat(),
            "credits_used": 6000,
            "credits_included": 5000,
            "overage_credits": 1000,
            "overage_cost_cents": 2000,
            "is_finalized": False,
        }],
        "subscriptions": [{
            "tenant_id": "hotel-a",
            "stripe_customer_id": "cus_1",
            "plan_status": "active",
            "cap_cents": None,
            "base_fee_cents": 9900,
        }],
    })
    monkeypatch.setattr(billing_router, "supabase", db)
    monkeypatch.setattr(internal_router, "supabase", db)
    monkeypatch.setattr(internal_router.settings, "cron_secret", "test-secret")
    calls = []
    _stub_invoice_item_create(monkeypatch, calls)

    await internal_router.monthly_trueup(x_cron_secret="test-secret")

    assert calls == []
    assert db.rows["credit_ledger"][0]["is_finalized"] is False


@pytest.mark.asyncio
async def test_early_cron_firing_does_not_lose_usage_that_accrues_before_true_period_end(monkeypatch):
    db = FakeDB({
        "credit_ledger": [{
            "tenant_id": "hotel-a",
            "period_start": "2026-04-01",
            "period_end": "2026-04-30",
            "credits_used": 6000,
            "credits_included": 5000,
            "overage_credits": 1000,
            "overage_cost_cents": 2000,
            "is_finalized": False,
        }],
        "subscriptions": [{
            "tenant_id": "hotel-a",
            "stripe_customer_id": "cus_1",
            "plan_status": "active",
            "cap_cents": None,
            "base_fee_cents": 9900,
        }],
    })
    monkeypatch.setattr(billing_router, "supabase", db)
    monkeypatch.setattr(internal_router, "supabase", db)
    monkeypatch.setattr(internal_router.settings, "cron_secret", "test-secret")
    calls = []
    _stub_invoice_item_create(monkeypatch, calls)

    class _FixedDate28(date):
        @classmethod
        def today(cls):
            return date(2026, 4, 28)

    monkeypatch.setattr(internal_router, "date", _FixedDate28)
    monkeypatch.setattr(billing_router, "date", _FixedDate28)

    await internal_router.monthly_trueup(x_cron_secret="test-secret")

    assert calls == []
    assert db.rows["credit_ledger"][0]["is_finalized"] is False

    # Simulate additional AI usage landing between the day-28 firing and true
    # period end -- increment_credits_used() would have kept incrementing
    # these since is_finalized correctly never flipped to True above.
    ledger_row = db.rows["credit_ledger"][0]
    ledger_row["credits_used"] += 500
    ledger_row["overage_credits"] += 500
    ledger_row["overage_cost_cents"] += 1000

    class _FixedDate30(date):
        @classmethod
        def today(cls):
            return date(2026, 4, 30)

    monkeypatch.setattr(internal_router, "date", _FixedDate30)
    monkeypatch.setattr(billing_router, "date", _FixedDate30)

    await internal_router.monthly_trueup(x_cron_secret="test-secret")

    assert len(calls) == 1
    assert calls[0]["amount"] == 3000
    assert db.rows["credit_ledger"][0]["is_finalized"] is True


# ---------------------------------------------------------------------------
# Task 2: final true-up on customer.subscription.deleted
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_subscription_deleted_invoices_final_overage_before_cancelling(monkeypatch):
    period_start = date(date.today().year, date.today().month, 1)
    db = FakeDB({
        "credit_ledger": [{
            "tenant_id": "hotel-a",
            "period_start": period_start.isoformat(),
            "period_end": (date.today() + timedelta(days=10)).isoformat(),
            "credits_used": 6000,
            "credits_included": 5000,
            "overage_credits": 1000,
            "overage_cost_cents": 2000,
            "is_finalized": False,
        }],
        "subscriptions": [{
            "tenant_id": "hotel-a",
            "stripe_customer_id": "cus_1",
            "plan_status": "active",
            "cap_cents": None,
            "base_fee_cents": 9900,
        }],
        "stripe_webhook_events": [],
    })
    monkeypatch.setattr(webhooks_router, "supabase", db)
    monkeypatch.setattr(billing_router, "supabase", db)
    calls = []
    _stub_invoice_item_create(monkeypatch, calls)
    sub = SimpleNamespace(metadata={"hotel_id": "hotel-a"})
    monkeypatch.setattr(
        webhooks_router.stripe.Webhook,
        "construct_event",
        lambda *_args, **_kwargs: stripe_event(
            "customer.subscription.deleted", sub, event_id="evt_cancel_1"
        ),
    )

    await webhooks_router.stripe_webhook(FakeRequest(headers={"stripe-signature": "sig"}))

    assert len(calls) == 1
    assert db.rows["credit_ledger"][0]["is_finalized"] is True
    assert db.rows["subscriptions"][0]["plan_status"] == "cancelled"

    update_tables = [table for (table, _row) in db.updates]
    assert update_tables.index("credit_ledger") < update_tables.index("subscriptions")


@pytest.mark.asyncio
async def test_subscription_deleted_retry_is_deduped_by_event_id(monkeypatch):
    period_start = date(date.today().year, date.today().month, 1)
    db = FakeDB({
        "credit_ledger": [{
            "tenant_id": "hotel-a",
            "period_start": period_start.isoformat(),
            "period_end": (date.today() + timedelta(days=10)).isoformat(),
            "credits_used": 6000,
            "credits_included": 5000,
            "overage_credits": 1000,
            "overage_cost_cents": 2000,
            "is_finalized": False,
        }],
        "subscriptions": [{
            "tenant_id": "hotel-a",
            "stripe_customer_id": "cus_1",
            "plan_status": "active",
            "cap_cents": None,
            "base_fee_cents": 9900,
        }],
        "stripe_webhook_events": [],
    })
    monkeypatch.setattr(webhooks_router, "supabase", db)
    monkeypatch.setattr(billing_router, "supabase", db)
    calls = []
    _stub_invoice_item_create(monkeypatch, calls)
    sub = SimpleNamespace(metadata={"hotel_id": "hotel-a"})
    monkeypatch.setattr(
        webhooks_router.stripe.Webhook,
        "construct_event",
        lambda *_args, **_kwargs: stripe_event(
            "customer.subscription.deleted", sub, event_id="evt_cancel_2"
        ),
    )

    await webhooks_router.stripe_webhook(FakeRequest(headers={"stripe-signature": "sig"}))
    await webhooks_router.stripe_webhook(FakeRequest(headers={"stripe-signature": "sig"}))

    assert len(calls) == 1


@pytest.mark.asyncio
async def test_subscription_deleted_true_up_failure_does_not_block_cancellation(monkeypatch):
    period_start = date(date.today().year, date.today().month, 1)
    db = FakeDB({
        "credit_ledger": [{
            "tenant_id": "hotel-a",
            "period_start": period_start.isoformat(),
            "period_end": (date.today() + timedelta(days=10)).isoformat(),
            "credits_used": 6000,
            "credits_included": 5000,
            "overage_credits": 1000,
            "overage_cost_cents": 2000,
            "is_finalized": False,
        }],
        "subscriptions": [{
            "tenant_id": "hotel-a",
            "stripe_customer_id": "cus_1",
            "plan_status": "active",
            "cap_cents": None,
            "base_fee_cents": 9900,
        }],
        "stripe_webhook_events": [],
    })
    monkeypatch.setattr(webhooks_router, "supabase", db)
    monkeypatch.setattr(billing_router, "supabase", db)

    def _raise(**_kwargs):
        raise RuntimeError("stripe down")

    monkeypatch.setattr(billing_router.stripe.InvoiceItem, "create", _raise)
    sub = SimpleNamespace(metadata={"hotel_id": "hotel-a"})
    monkeypatch.setattr(
        webhooks_router.stripe.Webhook,
        "construct_event",
        lambda *_args, **_kwargs: stripe_event(
            "customer.subscription.deleted", sub, event_id="evt_cancel_3"
        ),
    )

    response = await webhooks_router.stripe_webhook(FakeRequest(headers={"stripe-signature": "sig"}))

    assert response == {"status": "ok"}
    assert db.rows["subscriptions"][0]["plan_status"] == "cancelled"
