"""H4 Stripe true-up outbox against a real migrated database, driven through a FAKE Stripe transport.

No network and no Stripe objects of any mode are created. The fake models the Stripe semantics that matter: idempotency
keys that can be pruned, timeouts after (or before) an object was created, pending invoice items that later join a
subscription invoice, and live/test mode.
"""
from __future__ import annotations

import itertools
import uuid
from dataclasses import replace
from decimal import Decimal
from types import SimpleNamespace

import pytest

from agent_billing_support import (
    authorize,
    bdispatch,
    breserve,
    bsettle,
    bstore,
    make_billing_hotel,
    set_mode,
    settled,
)
from agent_execution_support import requires_db
from agent_orchestrator_support import planning_run, reset_spend_state, run_sql, sql_value
from services.agent_billing.stripe_transport import (
    METADATA_KEY,
    InvoiceView,
    ItemView,
    StripeAmbiguous,
    StripeRejected,
)
from services.agent_billing.trueup import TrueUpProcessor
from services.agent_billing.webhooks import handle_invoice_event

pytestmark = requires_db
_ids = itertools.count(1)


class FakeStripe:
    def __init__(self) -> None:
        self.items: dict[str, ItemView] = {}
        self.invoices: dict[str, InvoiceView] = {}
        self.idempotency: dict[str, str] = {}
        self.mode = "ok"            # ok | timeout_after_create | timeout_before_create | reject | livemode
        self.creates = 0

    def create_invoice_item(self, *, customer, subscription, amount_cents, currency, description, metadata,
                            period_start, period_end, idempotency_key):
        self.creates += 1
        assert subscription.startswith("sub_") and amount_cents > 0 and currency == "usd"
        if self.mode == "timeout_before_create":
            raise StripeAmbiguous("stripe_connection_or_rate_limit")
        if self.mode == "reject":
            raise StripeRejected("stripe_invalid_request")
        if idempotency_key in self.idempotency:
            return self.items[self.idempotency[idempotency_key]]
        item = ItemView(id=f"ii_fake{uuid.uuid4().hex}", customer=customer, amount=amount_cents, currency=currency,
                        livemode=self.mode == "livemode", metadata=dict(metadata))
        self.items[item.id] = item
        self.idempotency[idempotency_key] = item.id
        if self.mode == "timeout_after_create":
            raise StripeAmbiguous("stripe_connection_or_rate_limit")
        return item

    def find_invoice_items(self, *, customer, operation_id, created_gte):
        return [i for i in self.items.values() if i.customer == customer and i.metadata.get(METADATA_KEY) == operation_id]

    def retrieve_invoice_item(self, item_id):
        return self.items[item_id]

    def retrieve_invoice(self, invoice_id):
        return self.invoices[invoice_id]

    def invoice(self, item_id: str, status: str, *, attempted: bool = False, customer: str | None = None) -> str:
        item = self.items[item_id]
        inv_id = next((i for i, v in self.invoices.items() if item.invoice == i), None) or f"in_fake{uuid.uuid4().hex}"
        self.items[item_id] = replace(item, invoice=inv_id)
        self.invoices[inv_id] = InvoiceView(id=inv_id, customer=customer or item.customer, status=status,
                                            livemode=False, attempted=attempted,
                                            hosted_invoice_url=f"https://invoice.stripe.com/i/test_{inv_id}")
        return inv_id


@pytest.fixture(autouse=True)
def billing():
    reset_spend_state()
    set_mode("enforced", trueup=True)
    try:
        yield
    finally:
        set_mode("disabled")


def billed_hotel(*, attempts: int = 2, plan_status: str = "active"):
    """A hotel with consented agent overage of 0.25 credits ($0.005) per attempt, then its month ended."""
    bh = make_billing_hotel(included=0)
    assert authorize(bh, 5)["ok"]
    for i in range(attempts):
        c = planning_run(bh.hotel, worker=f"it-h4-o{i}")
        r = breserve(c, exposure=Decimal("0.005"))
        assert r.ok, r
        assert bdispatch(c, r.attempt.attempt_id).ok
        assert bsettle(c, r.attempt.attempt_id, settled("0.005")).ok
    if plan_status != "active":
        run_sql(f"UPDATE public.subscriptions SET plan_status = '{plan_status}' WHERE tenant_id = '{bh.tenant_id}';")
    end_month(bh.tenant_id)
    return bh


def end_month(tenant_id: str) -> str:
    """Fault injection standing in for the calendar: move this hotel's open period (and its charges/holds) to last
    month. Guards are disabled only around this one statement batch, in the throwaway test database."""
    run_sql(f"""
      ALTER TABLE public.agent_customer_credit_charges DISABLE TRIGGER agent_customer_credit_charges_guard;
      ALTER TABLE public.agent_customer_credit_holds DISABLE TRIGGER agent_customer_credit_holds_guard;
      UPDATE public.credit_ledger SET period_start = date_trunc('month', CURRENT_DATE - interval '1 month')::date,
             period_end = (date_trunc('month', CURRENT_DATE) - interval '1 day')::date
       WHERE tenant_id = '{tenant_id}' AND period_start = date_trunc('month', CURRENT_DATE)::date;
      UPDATE public.agent_customer_credit_charges SET period_start = date_trunc('month', CURRENT_DATE - interval '1 month')::date
       WHERE tenant_id = '{tenant_id}';
      UPDATE public.agent_customer_credit_holds SET period_start = date_trunc('month', CURRENT_DATE - interval '1 month')::date
       WHERE tenant_id = '{tenant_id}';
      ALTER TABLE public.agent_customer_credit_charges ENABLE TRIGGER agent_customer_credit_charges_guard;
      ALTER TABLE public.agent_customer_credit_holds ENABLE TRIGGER agent_customer_credit_holds_guard;
    """)
    return sql_value("SELECT date_trunc('month', CURRENT_DATE - interval '1 month')::date::text;")


def prepare(bh) -> dict:
    period = sql_value("SELECT date_trunc('month', CURRENT_DATE - interval '1 month')::date::text;")
    result = bstore().prepare_operation(tenant_id=bh.tenant_id, period_start=period, actor="it-trueup", grace_days=0)
    assert result.get("ok"), result
    return result


def op_row(op_id: str) -> dict:
    import json
    return json.loads(sql_value(f"SELECT row_to_json(o)::text FROM public.agent_billing_operations o WHERE id = '{op_id}';"))


def processor(fake: FakeStripe) -> TrueUpProcessor:
    return TrueUpProcessor(store=bstore(), transport=fake, actor="it-trueup")


def invoice_event(op: dict, fake: FakeStripe, event_type: str, status: str, created: int, *, customer: str | None = None,
                  event_id: str | None = None, livemode: bool = False):
    item_id = op["stripe_invoice_item_id"]
    inv_id = fake.items[item_id].invoice or fake.invoice(item_id, status)
    line = SimpleNamespace(parent=SimpleNamespace(invoice_item_details=SimpleNamespace(invoice_item=item_id)))
    invoice = SimpleNamespace(id=inv_id, customer=customer or op["stripe_customer_id"], status=status, livemode=livemode,
                              hosted_invoice_url=f"https://invoice.stripe.com/i/test_{inv_id}",
                              lines=SimpleNamespace(data=[line]))
    return SimpleNamespace(id=event_id or f"evt_it{next(_ids)}", type=event_type, created=created,
                           data=SimpleNamespace(object=invoice))


# ---------------------------------------------------------------------------------------------------------------------

def test_prepare_waits_for_period_end_assigns_each_charge_once_and_rounds_the_total():
    bh = make_billing_hotel(included=0)
    authorize(bh, 5)
    c = planning_run(bh.hotel)
    r = breserve(c)
    bdispatch(c, r.attempt.attempt_id)
    bsettle(c, r.attempt.attempt_id, settled("0.005"))
    current = sql_value("SELECT date_trunc('month', CURRENT_DATE)::date::text;")
    assert bstore().prepare_operation(tenant_id=bh.tenant_id, period_start=current, actor="it",
                                      grace_days=0)["reason"] == "period_not_ended"
    end_month(bh.tenant_id)
    first = prepare(bh)["operation"]
    assert first["state"] == "prepared" and first["amount_cents"] == 1 and first["charge_count"] == 1  # $0.005 -> 1c
    assert first["stripe_customer_id"] == bh.customer and first["stripe_subscription_id"] == bh.subscription
    assert prepare(bh)["status"] == "nothing_new"
    unbilled = sql_value(f"SELECT count(*) FROM public.agent_customer_credit_charges WHERE tenant_id = '{bh.tenant_id}' "
                         f"AND billing_operation_id IS NULL;")
    assert unbilled == "0"


def test_claim_is_refused_while_the_true_up_switch_is_off():
    bh = billed_hotel()
    op = prepare(bh)["operation"]
    set_mode("enforced", trueup=False)
    fake = FakeStripe()
    assert processor(fake).process(op) == "stripe_trueup_disabled"
    assert fake.creates == 0 and op_row(op["id"])["state"] == "prepared"


def test_full_lifecycle_item_invoice_payment_with_duplicate_and_out_of_order_webhooks():
    bh = billed_hotel()
    op = prepare(bh)["operation"]
    assert op["amount_cents"] == 1
    fake = FakeStripe()
    p = processor(fake)
    assert p.process(op) == "item_created"
    row = op_row(op["id"])
    assert row["state"] == "item_created" and row["stripe_invoice_item_id"].startswith("ii_")
    assert row["stripe_invoice_id"] is None  # an invoice item is not an invoice
    assert p.process(row) == "awaiting_invoice"
    fake.invoice(row["stripe_invoice_item_id"], "draft")
    assert p.process(row) == "invoice_draft"
    row = op_row(op["id"])
    assert row["state"] == "invoiced" and row["stripe_invoice_id"].startswith("in_")
    s = bstore()
    paid = invoice_event(row, fake, "invoice.paid", "paid", created=9_999_999_999, event_id="evt_it_paid")
    assert handle_invoice_event(paid, s) == 1
    assert op_row(op["id"])["state"] == "paid"
    assert handle_invoice_event(paid, s) == 1                                   # duplicate delivery: harmless
    stale = invoice_event(row, fake, "invoice.finalized", "open", created=1)    # older event arriving late
    handle_invoice_event(stale, s)
    final = op_row(op["id"])
    assert final["state"] == "paid" and final["invoice_status"] == "paid"
    assert fake.creates == 1


def test_payment_failure_then_recovery_and_out_of_order_ordering():
    bh = billed_hotel()
    op = prepare(bh)["operation"]
    fake = FakeStripe()
    processor(fake).process(op)
    row = op_row(op["id"])
    s = bstore()
    handle_invoice_event(invoice_event(row, fake, "invoice.payment_failed", "open", created=200), s)
    assert op_row(op["id"])["state"] == "payment_failed"
    handle_invoice_event(invoice_event(row, fake, "invoice.finalized", "open", created=100), s)  # older: ignored
    assert op_row(op["id"])["state"] == "payment_failed"
    handle_invoice_event(invoice_event(row, fake, "invoice.paid", "paid", created=300), s)
    assert op_row(op["id"])["state"] == "paid"


def test_timeout_after_stripe_created_the_item_is_reconciled_not_resent():
    bh = billed_hotel()
    op = prepare(bh)["operation"]
    fake = FakeStripe()
    fake.mode = "timeout_after_create"
    p = processor(fake)
    assert p.process(op) == "ambiguous"
    assert op_row(op["id"])["state"] == "ambiguous"
    fake.mode = "ok"
    assert p.process(op_row(op["id"])) == "item_created"
    assert len(fake.items) == 1 and fake.creates == 1


def test_timeout_before_creation_is_confirmed_absent_then_submitted_once():
    bh = billed_hotel()
    op = prepare(bh)["operation"]
    fake = FakeStripe()
    fake.mode = "timeout_before_create"
    p = processor(fake)
    assert p.process(op) == "ambiguous"
    fake.mode = "ok"
    assert p.process(op_row(op["id"])) == "confirmed_absent"
    assert op_row(op["id"])["state"] == "prepared"
    assert p.process(op_row(op["id"])) == "item_created"
    assert len(fake.items) == 1


def test_retry_long_after_idempotency_keys_are_pruned_finds_the_existing_item():
    bh = billed_hotel()
    op = prepare(bh)["operation"]
    fake = FakeStripe()
    p = processor(fake)
    claimed = bstore().claim_operation(operation_id=op["id"], actor="it-trueup")["operation"]
    # The worker reached Stripe, then crashed before recording the outcome.
    fake.create_invoice_item(customer=claimed["stripe_customer_id"], subscription=claimed["stripe_subscription_id"],
                             amount_cents=1, currency="usd", description="x", metadata={METADATA_KEY: op["id"]},
                             period_start=0, period_end=1, idempotency_key=f"patelrep-h4-op-{op['id']}")
    fake.idempotency.clear()  # > 24h later Stripe has pruned the key: a resend would create a SECOND item
    run_sql(f"""ALTER TABLE public.agent_billing_operations DISABLE TRIGGER agent_billing_operations_guard;
                UPDATE public.agent_billing_operations SET updated_at = now() - interval '2 days' WHERE id = '{op['id']}';
                ALTER TABLE public.agent_billing_operations ENABLE TRIGGER agent_billing_operations_guard;""")
    assert p.process(op_row(op["id"])) == "item_created"
    assert len(fake.items) == 1 and fake.creates == 1


def test_customer_mismatch_never_applies_and_holds_for_an_operator():
    bh = billed_hotel()
    op = prepare(bh)["operation"]
    fake = FakeStripe()
    processor(fake).process(op)
    row = op_row(op["id"])
    s = bstore()
    handle_invoice_event(invoice_event(row, fake, "invoice.paid", "paid", created=10, customer="cus_someoneelse"), s)
    after = op_row(op["id"])
    assert after["state"] == "manual_intervention" and after["manual_reason"] == "customer_mismatch"
    assert after["stripe_invoice_id"] is None
    handle_invoice_event(invoice_event(row, fake, "invoice.paid", "paid", created=20), s)
    assert op_row(op["id"])["state"] == "manual_intervention"


def test_live_mode_objects_are_refused_at_every_layer():
    bh = billed_hotel()
    op = prepare(bh)["operation"]
    fake = FakeStripe()
    fake.mode = "livemode"
    processor(fake).process(op)
    row = op_row(op["id"])
    assert row["state"] == "manual_intervention" and row["manual_reason"] == "livemode_refused"
    assert row["stripe_invoice_item_id"] is None
    with pytest.raises(AssertionError):
        run_sql(f"UPDATE public.agent_billing_operations SET livemode = true WHERE id = '{op['id']}';")


def test_definitive_rejection_goes_to_manual_intervention_without_retry():
    bh = billed_hotel()
    op = prepare(bh)["operation"]
    fake = FakeStripe()
    fake.mode = "reject"
    p = processor(fake)
    assert p.process(op) == "manual_intervention"
    row = op_row(op["id"])
    assert row["manual_reason"] == "stripe_invalid_request"
    assert p.process(row) == "skipped" and fake.creates == 1


def test_cancelled_subscription_is_never_auto_billed():
    bh = billed_hotel(plan_status="cancelled")
    op = prepare(bh)["operation"]
    assert op["state"] == "manual_intervention" and op["manual_reason"] == "subscription_not_active"
    fake = FakeStripe()
    assert processor(fake).process(op) == "skipped" and fake.creates == 0


def test_invoice_and_item_identifiers_cannot_be_confused():
    bh = billed_hotel()
    op = prepare(bh)["operation"]
    fake = FakeStripe()
    processor(fake).process(op)
    bad = bstore().record_operation(operation_id=op["id"], outcome="invoice_status", actor_kind="reconciler",
                                    actor_ref="it", stripe_customer_id=bh.customer, invoice_id="ii_notaninvoice",
                                    invoice_status="paid", livemode=False)
    assert bad["reason"] == "invalid_request"
    with pytest.raises(AssertionError):
        run_sql(f"UPDATE public.agent_billing_operations SET stripe_invoice_id = 'ii_x' WHERE id = '{op['id']}';")


def test_a_billed_period_is_never_billed_again_and_an_attempt_can_never_be_charged_twice():
    bh = billed_hotel(attempts=1)
    first = prepare(bh)["operation"]
    assert first["sequence"] == 1
    assert prepare(bh)["status"] == "nothing_new"
    # The unique (attempt) identity makes a second charge for the same provider attempt impossible.
    with pytest.raises(AssertionError):
        run_sql(f"""INSERT INTO public.agent_customer_credit_charges (tenant_id, kind, attempt_id, hold_id, ledger_id,
          period_start, pricing_policy_id, policy_version, usd_per_credit, markup_multiplier,
          minimum_credits_per_operation, provider_cost_usd, credits, included_credits, overage_credits, overage_usd,
          ledger_applied, actor_kind, actor_ref)
          SELECT tenant_id, 'charge', attempt_id, hold_id, ledger_id, period_start, pricing_policy_id, policy_version,
                 usd_per_credit, markup_multiplier, minimum_credits_per_operation, provider_cost_usd, credits,
                 included_credits, overage_credits, overage_usd, false, 'reconciler', 'it'
            FROM public.agent_customer_credit_charges WHERE tenant_id = '{bh.tenant_id}';""")
