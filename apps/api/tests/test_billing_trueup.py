"""
Unit tests for the legacy monthly true-up orchestration (routers/billing.py, routers/internal.py, routers/webhooks.py).

The money-safety rules themselves live in the database since migration 250 and are exercised against a real migrated
database in tests/integration/test_billing_trueup_outbox.py: one operation per hotel-month, ledger finalized in the same
transaction, period must have ENDED (period_end is inclusive), already-finalized periods untouched, search-before-create
after a lost response or a failed record write, retry after Stripe pruned the idempotency key, cancellation held for
review. These tests pin the Python wiring around it:

1. the cron only considers unfinalized ledgers whose period_end is strictly before today (an early firing on day 28,
   or on the last day itself, attempts nothing), keeps going when one hotel fails, and reconciles in-flight operations;
2. customer.subscription.deleted never submits anything to Stripe: it records the period for review, and a failure is
   redelivered instead of silently skipped;
3. a webhook whose handling fails releases its de-duplication marker so Stripe's retry is processed (it used to be
   recorded first and then ignored on redelivery);
4. invoice events use the invoice item ids of ALL invoice lines (payloads carry one page) for both outboxes.
"""

from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from routers import billing as billing_router
from routers import internal as internal_router
from routers import webhooks as webhooks_router
from services import billing_trueup
from services.agent_billing.pricing import legacy_overage_cents
from tests.smoke.fake_supabase import FakeDB
from tests.smoke.test_webhooks_and_transitions import FakeRequest, stripe_event


class StubProcessor:
    """Records what the router asks the outbox to do; answers with a scripted outcome."""

    def __init__(self, outcome="item_created", due=None, fail_for=()):
        self.outcome = outcome
        self.calls = []
        self.due_calls = 0
        self.due = due if due is not None else {}
        self.fail_for = set(fail_for)

    def run_period(self, tenant_id, period_start, *, source="period_end"):
        self.calls.append((tenant_id, period_start, source))
        if tenant_id in self.fail_for:
            raise RuntimeError("database unavailable")
        return {"status": self.outcome, "operation_id": "op-1"}

    def run_due(self, *, limit=50):
        self.due_calls += 1
        return self.due


def _ledger(tenant, period_start, period_end, finalized=False):
    return {"tenant_id": tenant, "period_start": period_start, "period_end": period_end, "is_finalized": finalized}


# ---------------------------------------------------------------------------
# true_up_tenant
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("outcome,status", [
    ("item_created", "invoiced"), ("nothing_to_bill", "no_overage_finalized"), ("deferred", "error"),
    ("ambiguous", "error"), ("manual_intervention", "manual_intervention"), ("already_finalized", "already_finalized"),
    ("period_not_yet_ended", "period_not_yet_ended"), ("skipped_inactive", "skipped_inactive"),
])
def test_true_up_tenant_delegates_to_the_outbox_and_maps_statuses(outcome, status):
    proc = StubProcessor(outcome)
    result = billing_router.true_up_tenant("hotel-a", date(2026, 10, 1), processor=proc)
    assert result["status"] == status
    assert proc.calls == [("hotel-a", "2026-10-01", "period_end")]


def test_true_up_tenant_never_calls_stripe_directly(monkeypatch):
    # The old code called stripe.InvoiceItem.create itself, protected only by a 24h idempotency key.
    def _forbidden(**_kwargs):
        raise AssertionError("legacy true-up must go through the outbox")

    monkeypatch.setattr(billing_router.stripe.InvoiceItem, "create", _forbidden)
    billing_router.true_up_tenant("hotel-a", date(2026, 10, 1), processor=StubProcessor())


def test_legacy_amount_excludes_h4_agent_overage_and_is_whole_cents():
    assert legacy_overage_cents(overage_cost_cents="2000", agent_overage_credits="300", cap_cents=None,
                                base_fee_cents=9900) == 1400
    assert legacy_overage_cents(overage_cost_cents="2000.5", agent_overage_credits="0", cap_cents=None,
                                base_fee_cents=9900) == 2001
    assert legacy_overage_cents(overage_cost_cents="30000", agent_overage_credits="0", cap_cents=25000,
                                base_fee_cents=9900) == 15100


# ---------------------------------------------------------------------------
# monthly cron
# ---------------------------------------------------------------------------

def _cron(monkeypatch, ledgers, proc, today):
    db = FakeDB({"credit_ledger": ledgers})
    monkeypatch.setattr(internal_router, "supabase", db)
    return internal_router.run_monthly_trueup(today=today, processor=proc)


def test_cron_only_considers_ended_unfinalized_periods(monkeypatch):
    proc = StubProcessor()
    result = _cron(monkeypatch, [
        _ledger("ended", "2026-04-01", "2026-04-30"),
        _ledger("last-day", "2026-05-01", "2026-05-31"),
        _ledger("done", "2026-03-01", "2026-03-31", finalized=True),
    ], proc, date(2026, 5, 31))
    assert proc.calls == [("ended", "2026-04-01", "period_end")]
    assert result["invoiced"] == 1 and result["skipped"] == 0 and proc.due_calls == 1


@pytest.mark.parametrize("today", [date(2026, 4, 28), date(2026, 4, 30)])
def test_early_or_last_day_firing_attempts_nothing(monkeypatch, today):
    # period_end is inclusive: usage on the last day is still billable, so nothing may finalize until May 1.
    proc = StubProcessor()
    _cron(monkeypatch, [_ledger("hotel-a", "2026-04-01", "2026-04-30")], proc, today)
    assert proc.calls == []


def test_one_hotels_failure_does_not_stop_the_others(monkeypatch):
    proc = StubProcessor(fail_for={"broken"})
    result = _cron(monkeypatch, [_ledger("broken", "2026-04-01", "2026-04-30"),
                                 _ledger("fine", "2026-04-01", "2026-04-30")], proc, date(2026, 5, 2))
    assert [c[0] for c in proc.calls] == ["broken", "fine"]
    assert result["errors"] == 1 and result["invoiced"] == 1


def test_cron_reports_the_reconciliation_pass(monkeypatch):
    proc = StubProcessor(due={"item_created": 1, "invoice_paid": 2})
    result = _cron(monkeypatch, [], proc, date(2026, 5, 2))
    assert result["reconciled"] == {"item_created": 1, "invoice_paid": 2}


# ---------------------------------------------------------------------------
# webhooks
# ---------------------------------------------------------------------------

def _webhook(monkeypatch, db, event):
    monkeypatch.setattr(webhooks_router, "supabase", db)
    monkeypatch.setattr(webhooks_router.stripe.Webhook, "construct_event", lambda *_a, **_k: event)
    return webhooks_router.stripe_webhook(FakeRequest(headers={"stripe-signature": "sig"}))


@pytest.mark.asyncio
async def test_subscription_deleted_records_for_review_and_never_submits(monkeypatch):
    db = FakeDB({"subscriptions": [{"tenant_id": "hotel-a", "plan_status": "active"}], "stripe_webhook_events": []})
    proc = StubProcessor("manual_intervention")
    monkeypatch.setattr(billing_trueup, "default_processor", lambda: proc)
    event = stripe_event("customer.subscription.deleted", SimpleNamespace(metadata={"hotel_id": "hotel-a"}),
                         event_id="evt_cancel_1")

    assert await _webhook(monkeypatch, db, event) == {"status": "ok"}

    today = date.today()
    assert proc.calls == [("hotel-a", date(today.year, today.month, 1).isoformat(), "cancellation")]
    assert db.rows["subscriptions"][0]["plan_status"] == "cancelled"


@pytest.mark.asyncio
async def test_failed_handling_releases_the_dedup_marker_and_the_redelivery_is_processed(monkeypatch):
    db = FakeDB({"subscriptions": [{"tenant_id": "hotel-a", "plan_status": "active"}], "stripe_webhook_events": []})
    failing = StubProcessor(fail_for={"hotel-a"})
    monkeypatch.setattr(billing_trueup, "default_processor", lambda: failing)
    event = stripe_event("customer.subscription.deleted", SimpleNamespace(metadata={"hotel_id": "hotel-a"}),
                         event_id="evt_cancel_retry")

    with pytest.raises(HTTPException) as exc:
        await _webhook(monkeypatch, db, event)
    assert exc.value.status_code == 500
    assert db.rows["stripe_webhook_events"] == []  # marker released: Stripe's retry will not be "duplicate_ignored"
    assert db.rows["subscriptions"][0]["plan_status"] == "active"

    healthy = StubProcessor("manual_intervention")
    monkeypatch.setattr(billing_trueup, "default_processor", lambda: healthy)
    assert await _webhook(monkeypatch, db, event) == {"status": "ok"}
    assert len(healthy.calls) == 1 and db.rows["subscriptions"][0]["plan_status"] == "cancelled"
    assert [e["event_id"] for e in db.rows["stripe_webhook_events"]] == ["evt_cancel_retry"]


@pytest.mark.asyncio
async def test_a_processed_event_is_deduplicated_by_event_id(monkeypatch):
    db = FakeDB({"subscriptions": [{"tenant_id": "hotel-a", "plan_status": "active"}], "stripe_webhook_events": []})
    proc = StubProcessor("manual_intervention")
    monkeypatch.setattr(billing_trueup, "default_processor", lambda: proc)
    event = stripe_event("customer.subscription.deleted", SimpleNamespace(metadata={"hotel_id": "hotel-a"}),
                         event_id="evt_cancel_dup")
    await _webhook(monkeypatch, db, event)
    assert await _webhook(monkeypatch, db, event) == {"status": "duplicate_ignored"}
    assert len(proc.calls) == 1


def _paginated_invoice(item_on_page_one="ii_page1"):
    return {"id": "in_hist_1", "customer": "cus_1", "status": "paid", "livemode": False,
            "lines": {"has_more": True, "data": [
                {"parent": {"invoice_item_details": {"invoice_item": item_on_page_one}}}]}}


@pytest.mark.asyncio
async def test_invoice_events_use_item_ids_from_every_line_page(monkeypatch):
    db = FakeDB({"subscriptions": [], "stripe_webhook_events": [], "credit_ledger": []})
    seen = {}

    class PagingTransport:
        def __init__(self, *_a, **_k):
            pass

        def list_invoice_line_item_ids(self, invoice_id):
            seen["paged"] = invoice_id
            return ["ii_page1", "ii_page2"]

    monkeypatch.setattr(billing_trueup, "StripeTrueUpTransport", PagingTransport)
    monkeypatch.setattr(billing_trueup, "apply_invoice_event",
                        lambda _e, _s, ids: seen.setdefault("legacy", list(ids)) and 1)
    import services.agent_billing.webhooks as h4_webhooks
    monkeypatch.setattr(h4_webhooks, "handle_invoice_event",
                        lambda _e, _s, item_ids=None: seen.setdefault("h4", list(item_ids)) and 1)
    event = SimpleNamespace(id="evt_inv_1", type="invoice.paid", data=SimpleNamespace(object=_paginated_invoice()))

    assert await _webhook(monkeypatch, db, event) == {"status": "ok"}
    assert seen == {"paged": "in_hist_1", "legacy": ["ii_page1", "ii_page2"], "h4": ["ii_page1", "ii_page2"]}


@pytest.mark.asyncio
async def test_line_paging_failure_falls_back_to_the_first_page(monkeypatch):
    db = FakeDB({"subscriptions": [], "stripe_webhook_events": [], "credit_ledger": []})
    seen = {}

    class BrokenTransport:
        def __init__(self, *_a, **_k):
            pass

        def list_invoice_line_item_ids(self, _invoice_id):
            raise billing_trueup.Ambiguous("stripe_unavailable")

    monkeypatch.setattr(billing_trueup, "StripeTrueUpTransport", BrokenTransport)
    monkeypatch.setattr(billing_trueup, "apply_invoice_event",
                        lambda _e, _s, ids: seen.setdefault("legacy", list(ids)) and 1)
    import services.agent_billing.webhooks as h4_webhooks
    monkeypatch.setattr(h4_webhooks, "handle_invoice_event", lambda *_a, **_k: 0)
    event = SimpleNamespace(id="evt_inv_2", type="invoice.paid", data=SimpleNamespace(object=_paginated_invoice()))

    assert await _webhook(monkeypatch, db, event) == {"status": "ok"}
    assert seen["legacy"] == ["ii_page1"]  # the outbox reconciler completes the rest from the item side


@pytest.mark.asyncio
async def test_legacy_invoice_association_failure_is_redelivered(monkeypatch):
    db = FakeDB({"subscriptions": [], "stripe_webhook_events": [], "credit_ledger": []})

    def _boom(*_a, **_k):
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(billing_trueup, "apply_invoice_event", _boom)
    invoice = {"id": "in_hist_2", "customer": "cus_1", "status": "paid", "livemode": False, "lines": {"data": []}}
    event = SimpleNamespace(id="evt_inv_3", type="invoice.paid", data=SimpleNamespace(object=invoice))

    with pytest.raises(HTTPException):
        await _webhook(monkeypatch, db, event)
    assert db.rows["stripe_webhook_events"] == []


def test_apply_invoice_event_passes_customer_mode_and_event_time_to_the_record_rpc():
    class Store:
        def __init__(self):
            self.records = []

        def find(self, *, invoice_item_ids, invoice_id):
            self.query = (invoice_item_ids, invoice_id)
            return [{"id": "op-1"}]

        def record(self, **kw):
            self.records.append(kw)
            return {"ok": True}

    store = Store()
    event = {"id": "evt_9", "type": "invoice.payment_failed", "created": 123,
             "data": {"object": {"id": "in_1", "customer": "cus_1", "status": "open", "livemode": False}}}
    assert billing_trueup.apply_invoice_event(event, store, ["ii_9"]) == 1
    assert store.query == (["ii_9"], "in_1")
    (rec,) = store.records
    assert rec["invoice_status"] == "payment_failed" and rec["stripe_customer_id"] == "cus_1"
    assert rec["livemode"] is False and rec["event_created"] == 123 and rec["actor_kind"] == "webhook"
    assert billing_trueup.apply_invoice_event({"type": "invoice.paid", "data": {"object": {"id": "x"}}}, store, []) == 0


def test_period_window_helper_is_utc_midnight():
    assert billing_trueup._day_ts("2026-10-01") == 1790812800
    assert billing_trueup._day_ts("2026-10-31") + 86399 - billing_trueup._day_ts("2026-10-01") == 31 * 86400 - 1
    assert date.fromisoformat("2026-10-31") - date.fromisoformat("2026-10-01") == timedelta(days=30)
