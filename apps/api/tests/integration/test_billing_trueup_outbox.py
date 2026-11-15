"""Legacy monthly true-up outbox (migration 250) against a real migrated database. Stripe is a fake transport only.

The headline regression: Stripe accepts an invoice item, PostgreSQL fails to record it, and the job retries after
Stripe pruned the idempotency key. The old true-up created a second item; the outbox must find the first one.
"""
from __future__ import annotations

import threading
import time
from decimal import Decimal

import pytest

from agent_execution_support import requires_db
from agent_orchestrator_support import run_sql, sql_value
from billing_trueup_support import (
    DAY,
    FakeStripe,
    age_claim,
    last_month,
    ledger_of,
    legacy_hotel,
    op_of,
    park_leftover_operations,
    ts,
    tstore,
    worker,
)
from services.agent_billing.pricing import legacy_overage_cents
from services.billing_trueup import METADATA_KEY, apply_invoice_event

pytestmark = requires_db


@pytest.fixture(autouse=True)
def isolated_outbox():
    park_leftover_operations()
    yield


def fake() -> FakeStripe:
    return FakeStripe(now=time.time())


def items_for(f: FakeStripe, customer: str) -> list:
    return [i for i in f.items.values() if i.customer == customer]


# ---- exactly once ------------------------------------------------------------------------------------------------

def test_period_is_billed_once_with_identity_and_ledger_frozen_in_the_same_step():
    bh, start = legacy_hotel(credits_used=6000)  # 1000 credits over = 2000 cents
    f = fake()
    result = worker(f).run_period(bh.tenant_id, start.isoformat())
    assert result["status"] == "item_created" and result["amount_cents"] == 2000
    (item,) = items_for(f, bh.customer)
    op = op_of(bh.tenant_id, start)
    assert item.amount == 2000 and item.metadata[METADATA_KEY] == op["id"]
    assert item.description == "AI Credits Overage: 1000 credits @ $0.02"
    assert op["state"] == "item_created" and op["stripe_invoice_item_id"] == item.id and op["livemode"] is False
    led = ledger_of(bh.tenant_id, start)
    assert led["is_finalized"] is True and led["stripe_invoice_item_id"] == item.id
    # Every later run (any night, any year) is a no-op.
    f.now += 400 * DAY
    assert worker(f).run_period(bh.tenant_id, start.isoformat())["status"] in ("item_created", "awaiting_invoice")
    assert f.creates == 1


def test_lost_response_then_retry_after_idempotency_key_pruned_adopts_the_existing_item():
    bh, start = legacy_hotel()
    f = fake()
    f.lose_response = 1  # Stripe created the item; the response never arrived
    assert worker(f).run_period(bh.tenant_id, start.isoformat())["status"] == "ambiguous"
    assert op_of(bh.tenant_id, start)["state"] == "ambiguous"
    f.now += 2 * DAY  # key pruned: a blind re-create would now make a second item
    assert worker(f).run_due()  # reconciles from Stripe's records
    assert f.creates == 1 and len(items_for(f, bh.customer)) == 1
    assert op_of(bh.tenant_id, start)["state"] == "item_created"


def test_failed_database_write_after_stripe_success_never_double_bills():
    bh, start = legacy_hotel()
    f = fake()
    run_sql(f"""CREATE OR REPLACE FUNCTION public.it_fail_record() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN IF NEW.tenant_id = '{bh.tenant_id}' AND NEW.state = 'item_created' THEN
                  RAISE EXCEPTION 'injected record failure'; END IF; RETURN NEW; END $$;
                CREATE TRIGGER it_fail_record BEFORE UPDATE ON public.billing_trueup_operations
                FOR EACH ROW EXECUTE FUNCTION public.it_fail_record();""")
    try:
        with pytest.raises(Exception):
            worker(f).run_period(bh.tenant_id, start.isoformat())
    finally:
        run_sql("DROP TRIGGER it_fail_record ON public.billing_trueup_operations; DROP FUNCTION public.it_fail_record();")
    op = op_of(bh.tenant_id, start)
    assert op["state"] == "submitting" and f.creates == 1
    # The next nightly run: still in flight (claim not yet stale) -> nothing is sent.
    assert worker(f).run_period(bh.tenant_id, start.isoformat())["status"] == "in_flight"
    age_claim(op["id"])
    f.now += 3 * DAY  # Stripe pruned the key long ago
    worker(f).run_due()
    assert f.creates == 1 and len(items_for(f, bh.customer)) == 1
    assert op_of(bh.tenant_id, start)["state"] == "item_created"
    assert ledger_of(bh.tenant_id, start)["stripe_invoice_item_id"] == op_of(bh.tenant_id, start)["stripe_invoice_item_id"]


def test_failure_before_stripe_saw_the_request_is_confirmed_absent_then_retried_once():
    bh, start = legacy_hotel()
    f = fake()
    f.fail_before = 1
    assert worker(f).run_period(bh.tenant_id, start.isoformat())["status"] == "ambiguous"
    f.now += 2 * DAY
    worker(f).run_due()  # confirmed absent -> prepared
    assert op_of(bh.tenant_id, start)["state"] == "prepared"
    worker(f).run_due()  # submitted exactly once
    assert f.creates == 1 and op_of(bh.tenant_id, start)["state"] == "item_created"


def test_truncated_search_is_ambiguous_and_never_creates():
    bh, start = legacy_hotel()
    f = fake()
    f.truncate_search = True
    assert worker(f).run_period(bh.tenant_id, start.isoformat())["status"] == "ambiguous"
    worker(f).run_due()
    assert f.creates == 0 and op_of(bh.tenant_id, start)["state"] == "ambiguous"


def test_duplicate_requests_race_to_exactly_one_operation_and_one_item():
    bh, start = legacy_hotel()
    f = fake()
    results: list = []

    def go():
        try:
            results.append(worker(f).run_period(bh.tenant_id, start.isoformat())["status"])
        except Exception as exc:  # noqa: BLE001
            results.append(repr(exc))

    threads = [threading.Thread(target=go) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert f.creates == 1 and len(items_for(f, bh.customer)) == 1, results
    assert sql_value(f"SELECT count(*) FROM public.billing_trueup_operations WHERE tenant_id = '{bh.tenant_id}';") == "1"


# ---- pre-outbox history ------------------------------------------------------------------------------------------

def test_unrecorded_item_from_the_old_true_up_stops_for_reconciliation():
    # The reported failure, as left behind by the pre-outbox code: item exists in Stripe, nothing in PostgreSQL.
    bh, start = legacy_hotel()
    f = fake()
    f.add_item(customer=bh.customer, amount=2000, created=ts(last_month()[1]) + DAY,
               description="AI Credits Overage: 1000 credits @ $0.02")
    assert worker(f).run_period(bh.tenant_id, start.isoformat())["status"] == "manual_intervention"
    op = op_of(bh.tenant_id, start)
    assert op["state"] == "manual_intervention" and op["manual_reason"] == "unlinked_legacy_item_found"
    assert f.creates == 0
    f.now += 30 * DAY
    worker(f).run_due()
    assert f.creates == 0  # manual operations are never retried automatically


def test_recorded_items_of_earlier_months_are_not_mistaken_for_this_month():
    bh, start = legacy_hotel()
    f = fake()
    old = f.add_item(customer=bh.customer, amount=500, created=ts(start) + 2 * DAY,
                     description="AI Credits Overage: 250 credits @ $0.02")
    prev_end = start - __import__("datetime").timedelta(days=1)
    run_sql(f"""INSERT INTO public.credit_ledger (tenant_id, period_start, period_end, credits_included, credits_used,
                  is_finalized, stripe_invoice_id)
                VALUES ('{bh.tenant_id}', '{prev_end.replace(day=1)}', '{prev_end}', 5000, 5250, true, '{old.id}');""")
    # (pre-H4 rows stored the ITEM id in stripe_invoice_id -- still recognised as accounted for)
    assert worker(f).run_period(bh.tenant_id, start.isoformat())["status"] == "item_created"
    assert f.creates == 1


def test_already_finalized_periods_and_their_items_are_never_touched():
    bh, start = legacy_hotel(finalized=True, item_id="ii_historical0001")
    f = fake()
    assert worker(f).run_period(bh.tenant_id, start.isoformat())["status"] == "already_finalized"
    assert op_of(bh.tenant_id, start) == {} and f.creates == 0
    assert ledger_of(bh.tenant_id, start)["stripe_invoice_item_id"] == "ii_historical0001"


def test_open_period_inactive_subscription_and_no_overage_paths():
    today = __import__("datetime").date.today()
    bh, start = legacy_hotel(period=(today.replace(day=1), today))
    f = fake()
    assert worker(f).run_period(bh.tenant_id, start.isoformat())["status"] == "period_not_yet_ended"
    assert ledger_of(bh.tenant_id, start)["is_finalized"] is False and op_of(bh.tenant_id, start) == {}
    bh2, start2 = legacy_hotel(plan_status="past_due")
    assert worker(f).run_period(bh2.tenant_id, start2.isoformat())["status"] == "skipped_inactive"
    bh3, start3 = legacy_hotel(credits_used=100)
    assert worker(f).run_period(bh3.tenant_id, start3.isoformat())["status"] == "nothing_to_bill"
    assert ledger_of(bh3.tenant_id, start3)["is_finalized"] is True and f.creates == 0


# ---- cancellation stays in manual review ------------------------------------------------------------------------------

def test_cancellation_is_recorded_for_review_and_never_submitted():
    today = __import__("datetime").date.today()
    bh, start = legacy_hotel(period=(today.replace(day=1), today))
    f = fake()
    assert worker(f).run_period(bh.tenant_id, start.isoformat(), source="cancellation")["status"] == \
        "manual_intervention"
    op = op_of(bh.tenant_id, start)
    assert op["source"] == "cancellation" and op["manual_reason"] == "cancellation_policy_pending"
    assert ledger_of(bh.tenant_id, start)["is_finalized"] is False
    s = tstore()
    assert s.record(operation_id=op["id"], outcome="resolve_retry", actor_kind="operator", actor_ref="it-op",
                    error_code="operator_checked")["reason"] == "illegal_transition"
    assert s.record(operation_id=op["id"], outcome="item_created", actor_kind="operator", actor_ref="it-op",
                    stripe_customer_id=bh.customer, invoice_item_id="ii_manual0001",
                    livemode=False)["reason"] == "illegal_transition"
    worker(f).run_due()
    assert f.creates == 0


# ---- rejection and operator resolution --------------------------------------------------------------------------------

def test_definitive_rejection_needs_an_operator_and_is_then_submitted_once():
    bh, start = legacy_hotel()
    f = fake()
    f.reject = 1
    assert worker(f).run_period(bh.tenant_id, start.isoformat())["status"] == "manual_intervention"
    op = op_of(bh.tenant_id, start)
    worker(f).run_due()
    assert f.creates == 0
    assert tstore().record(operation_id=op["id"], outcome="resolve_retry", actor_kind="operator", actor_ref="it-op",
                           error_code="customer_fixed")["ok"]
    worker(f).run_due()
    assert f.creates == 1 and op_of(bh.tenant_id, start)["state"] == "item_created"


# ---- invoice association (webhook + reconciler) ------------------------------------------------------------------------

def _event(invoice_id, customer, status, created, *, event_type="invoice.paid", livemode=False):
    return {"id": f"evt_{invoice_id}_{created}", "type": event_type, "created": created,
            "data": {"object": {"id": invoice_id, "customer": customer, "status": status, "livemode": livemode}}}


def test_webhook_associates_the_item_with_its_historical_period_in_any_order():
    bh, start = legacy_hotel()
    f = fake()
    worker(f).run_period(bh.tenant_id, start.isoformat())
    op = op_of(bh.tenant_id, start)
    s = tstore()
    inv = "in_it" + op["id"].replace("-", "")[:16]
    # The renewal invoice is paid NEXT month; the item is found by id (e.g. from page 2 of the invoice lines).
    assert apply_invoice_event(_event(inv, bh.customer, "paid", 200), s,
                               ["ii_otherline1", op["stripe_invoice_item_id"]]) == 1
    assert apply_invoice_event(_event(inv, bh.customer, "open", 100, event_type="invoice.finalized"), s,
                               [op["stripe_invoice_item_id"]]) == 1  # older event arrives late: ignored
    after = op_of(bh.tenant_id, start)
    assert after["state"] == "paid" and after["stripe_invoice_id"] == inv
    assert ledger_of(bh.tenant_id, start)["stripe_invoice_id"] == inv
    # Replays are harmless.
    apply_invoice_event(_event(inv, bh.customer, "paid", 200), s, [op["stripe_invoice_item_id"]])
    assert op_of(bh.tenant_id, start)["state"] == "paid"


def test_webhook_for_another_customer_never_applies():
    a, start_a = legacy_hotel()
    b, _ = legacy_hotel()
    f = fake()
    worker(f).run_period(a.tenant_id, start_a.isoformat())
    op = op_of(a.tenant_id, start_a)
    apply_invoice_event(_event("in_it" + op["id"].replace("-", "")[:16], b.customer, "paid", 300), tstore(), [op["stripe_invoice_item_id"]])
    after = op_of(a.tenant_id, start_a)
    assert after["state"] == "manual_intervention" and after["manual_reason"] == "customer_mismatch"
    assert after["stripe_invoice_id"] is None


def test_reconciler_completes_association_when_the_webhook_was_missed():
    bh, start = legacy_hotel()
    f = fake()
    worker(f).run_period(bh.tenant_id, start.isoformat())
    op = op_of(bh.tenant_id, start)
    invoice_id = f.attach_invoice(op["stripe_invoice_item_id"], status="paid")
    worker(f).run_due()
    after = op_of(bh.tenant_id, start)
    assert after["state"] == "paid" and after["stripe_invoice_id"] == invoice_id


# ---- arithmetic parity, immutability, privileges, isolation ----------------------------------------------------------

@pytest.mark.parametrize("cost,agent,cap,base", [
    ("2000", "0", None, 9900), ("2000.5", "0", None, 9900), ("2000.4999", "0", None, 9900), ("30000", "0", 25000, 9900),
    ("2000", "300", None, 9900), ("20000", "100", 15000, 9900), ("100", "900", None, 9900), ("0", "0", 0, 9900),
])
def test_database_amount_matches_the_legacy_pricing_function(cost, agent, cap, base):
    db = sql_value(f"SELECT public.billing__legacy_overage_cents({cost}, {agent}, {cap if cap is not None else 'NULL'}, "
                   f"{base});")
    assert int(db) == legacy_overage_cents(overage_cost_cents=cost, agent_overage_credits=agent, cap_cents=cap,
                                           base_fee_cents=base)


def test_operations_are_immutable_and_unreachable_by_end_users():
    bh, start = legacy_hotel()
    worker(fake()).run_period(bh.tenant_id, start.isoformat())
    op = op_of(bh.tenant_id, start)
    for stmt in (
        f"UPDATE public.billing_trueup_operations SET amount_cents = 1 WHERE id = '{op['id']}'",
        f"UPDATE public.billing_trueup_operations SET stripe_invoice_item_id = 'ii_swapped1' WHERE id = '{op['id']}'",
        f"DELETE FROM public.billing_trueup_operations WHERE id = '{op['id']}'",
        f"UPDATE public.billing_trueup_operation_events SET reason_code = 'x' WHERE operation_id = '{op['id']}'",
        f"""INSERT INTO public.billing_trueup_operations (tenant_id, ledger_id, period_start, period_end, source,
              amount_cents, overage_credits, created_by) SELECT tenant_id, ledger_id, period_start, period_end,
              'period_end', 1, 0, 'x' FROM public.billing_trueup_operations WHERE id = '{op['id']}'""",
    ):
        with pytest.raises(AssertionError):
            run_sql(stmt + ";")
    leaky = sql_value("""SELECT string_agg(p.proname, ',') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND (p.proname LIKE 'billing\\_trueup%' OR p.proname LIKE 'billing\\_\\_%'
            OR p.proname = 'agent__customer_dispatch_refusal')
        AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
             OR p.prosecdef OR NOT COALESCE('search_path=""' = ANY (p.proconfig), false));""")
    assert not leaky, leaky
    tables = sql_value("""SELECT string_agg(relname, ',') FROM pg_class WHERE relname LIKE 'billing_trueup_%'
      AND relkind = 'r' AND (has_table_privilege('anon', oid, 'SELECT') OR has_table_privilege('authenticated', oid,
      'SELECT') OR NOT relrowsecurity);""")
    assert not tables, tables


def test_known_items_are_tenant_scoped():
    a, sa = legacy_hotel(finalized=True, item_id="ii_tenantA00001")
    b, _ = legacy_hotel()
    assert "ii_tenantA00001" in tstore().known_item_ids(tenant_id=a.tenant_id)
    assert "ii_tenantA00001" not in tstore().known_item_ids(tenant_id=b.tenant_id)
    assert Decimal(ledger_of(a.tenant_id, sa)["credits_used"]) == 6000


# ---- the exact reported sequence, through the router entry point the cron uses -----------------------------------------

def test_reported_sequence_stamp_failure_then_retry_after_key_expiry_bills_once():
    from routers.billing import true_up_tenant

    bh, start = legacy_hotel()
    f = fake()
    run_sql(f"""CREATE OR REPLACE FUNCTION public.it_fail_stamp() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN IF NEW.tenant_id = '{bh.tenant_id}' AND NEW.stripe_invoice_item_id IS NOT NULL THEN
                  RAISE EXCEPTION 'injected stamp failure'; END IF; RETURN NEW; END $$;
                CREATE TRIGGER it_fail_stamp BEFORE UPDATE ON public.credit_ledger
                FOR EACH ROW EXECUTE FUNCTION public.it_fail_stamp();""")
    try:
        with pytest.raises(Exception):
            true_up_tenant(bh.tenant_id, start, processor=worker(f))  # Stripe accepted; PostgreSQL write failed
    finally:
        run_sql("DROP TRIGGER it_fail_stamp ON public.credit_ledger; DROP FUNCTION public.it_fail_stamp();")
    assert f.creates == 1
    age_claim(op_of(bh.tenant_id, start)["id"])
    f.now += 25 * 3600  # next nightly cron (days 1-3): Stripe has pruned the idempotency key
    from routers.internal import run_monthly_trueup
    first_item = items_for(f, bh.customer)[0].id
    run_monthly_trueup(processor=worker(f))  # global: other suites' ended ledgers may be billed too (own customers)
    assert [i.id for i in items_for(f, bh.customer)] == [first_item]
    assert op_of(bh.tenant_id, start)["state"] == "item_created"
    assert ledger_of(bh.tenant_id, start)["stripe_invoice_item_id"] == items_for(f, bh.customer)[0].id
