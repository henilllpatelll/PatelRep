"""H4 pure contracts and static safety: exact arithmetic parity, default-off gates, test-mode-only Stripe, webhook parsing,
legacy/H4 no-double-billing, migration safety, and nothing scheduled."""
from __future__ import annotations

import re
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

import pytest

from services.agent_billing import H4_LIVE_STRIPE_SUPPORTED
from services.agent_billing.config import BillingSettings, reconciliation_writes_allowed, stripe_trueup_allowed
from services.agent_billing.pricing import (
    CREDIT_QUANTUM,
    PolicyRates,
    legacy_overage_cents,
    max_exposure_usd,
    period_amount_cents,
    quote_credits,
    split_charge,
)
from services.agent_billing.stripe_transport import LiveModeRefused, StripeSdkTransport
from services.agent_billing.webhooks import handle_invoice_event, invoice_item_ids
from services.agent_harness import metering

API_ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = API_ROOT.parents[1] / "supabase" / "migrations"
H4_MIGRATIONS = ("248_agent_customer_billing_schema.sql", "249_agent_customer_billing_rpcs.sql")
RATES = PolicyRates(Decimal("0.02"), Decimal("1.5"), Decimal("0.05"))


def _sql(name: str) -> str:
    return (MIGRATIONS / name).read_text(encoding="utf-8")


# ---- arithmetic ---------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("cost", ["0", "0.00000001", "0.00123457", "0.003", "0.1", "1.23456789", "250"])
def test_quote_matches_the_h0_metering_contract(cost):
    policy = metering.CustomerPricingPolicy(
        pricing_policy_version="v1",
        period=metering.BillingPeriod(period_id="p", hotel_id="h", starts_on="2026-11-01", ends_on="2026-11-30"),
        usd_per_credit="0.02", markup_multiplier="1.5", minimum_credits_per_charge="0.05", included_credits="0",
        hard_spending_cap_usd="10")
    record = metering.ProviderCostRecord(
        usage=metering.ProviderUsage(provider="openai", requested_model="m", reported_model="m", state="reported",
                                     input_tokens=1, output_tokens=1),
        status="costed", cost_usd=cost, schedule_version="s")
    assert metering.quote_customer_credits(record, policy).credits == quote_credits(Decimal(cost), RATES)
    assert CREDIT_QUANTUM == metering.CREDIT_QUANTUM


def test_sql_quote_formula_mirrors_python():
    sql = _sql("249_agent_customer_billing_rpcs.sql")
    assert "greatest(ceil(p_cost_usd * p_policy.markup_multiplier / p_policy.usd_per_credit * 10000) / 10000," in sql
    assert "p_policy.minimum_credits_per_operation" in sql


def test_split_never_exceeds_the_hold_and_overage_comes_after_included():
    s = split_charge(cost_usd="0.004", rates=PolicyRates("0.02", "1", "0"), held_credits="0.15",
                     held_overage_credits="0.05")
    assert (s.charged, s.included, s.overage, s.uncharged_overrun) == (Decimal("0.15"), Decimal("0.10"),
                                                                       Decimal("0.05"), Decimal("0.05"))
    assert s.overage_usd == Decimal("0.0010")


def test_money_rounding_is_exact_and_floats_are_refused():
    assert period_amount_cents(["0.005"]) == 1 and period_amount_cents(["0.004999"]) == 0
    assert period_amount_cents(["0.0025", "0.0025"]) == 1
    assert max_exposure_usd(1000, "0.02") == Decimal("20.00")
    with pytest.raises(TypeError):
        quote_credits(0.1, RATES)
    with pytest.raises(TypeError):
        period_amount_cents([0.5])


def test_legacy_true_up_never_bills_agent_overage_and_rounds_to_whole_cents():
    # No agent usage: identical to the previous legacy amount (with the fractional-cent crash fixed).
    assert legacy_overage_cents(overage_cost_cents="2000", agent_overage_credits="0", cap_cents=None,
                                base_fee_cents=9900) == 2000
    assert legacy_overage_cents(overage_cost_cents="1234.5", agent_overage_credits="0", cap_cents=None,
                                base_fee_cents=9900) == 1235
    # 300 overage credits in total, 100 of them consented agent overage billed by H4 -> legacy bills 200 credits.
    assert legacy_overage_cents(overage_cost_cents="600", agent_overage_credits="100", cap_cents=None,
                                base_fee_cents=9900) == 400
    # The cap bounds the whole bill: base 9900 + agent 200 + legacy <= 10500 -> legacy <= 400.
    assert legacy_overage_cents(overage_cost_cents="1200", agent_overage_credits="100", cap_cents=10500,
                                base_fee_cents=9900) == 400
    assert legacy_overage_cents(overage_cost_cents="100", agent_overage_credits="500", cap_cents=None,
                                base_fee_cents=9900) == 0


# ---- gates --------------------------------------------------------------------------------------------------------

def test_everything_is_off_by_default_and_refused_in_production():
    off = BillingSettings()
    assert not off.reconciliation_enabled and not off.stripe_trueup_enabled and H4_LIVE_STRIPE_SUPPORTED is False
    on = BillingSettings(reconciliation_enabled=True, stripe_trueup_enabled=True)
    assert reconciliation_writes_allowed(app_env="staging", settings=on)
    assert not reconciliation_writes_allowed(app_env="production", settings=on)
    assert not reconciliation_writes_allowed(app_env="staging", settings=off)
    assert stripe_trueup_allowed(app_env="staging", settings=on, stripe_secret_key="sk_test_abc")
    assert not stripe_trueup_allowed(app_env="production", settings=on, stripe_secret_key="sk_test_abc")
    assert not stripe_trueup_allowed(app_env="staging", settings=on, stripe_secret_key="sk_live_abc")
    assert not stripe_trueup_allowed(app_env="staging", settings=on, stripe_secret_key=None)


@pytest.mark.parametrize("key", ["sk_live_123", "rk_live_123", "", "whatever"])
def test_stripe_transport_refuses_anything_but_test_mode(key):
    with pytest.raises(LiveModeRefused):
        StripeSdkTransport(key)


def test_stripe_transport_disables_sdk_retries():
    transport = StripeSdkTransport("sk_test_placeholder")
    assert transport._client._requestor._options.max_network_retries == 0


def test_migrations_keep_customer_billing_and_live_mode_off():
    schema = _sql("248_agent_customer_billing_schema.sql")
    assert "VALUES (1, 'disabled', false, 'h4_default_off', 'migration_248')" in schema
    assert "livemode                 boolean       NOT NULL DEFAULT false CHECK (livemode = false)" in schema
    assert "agent_customer_pricing_policies" in schema and "INSERT INTO public.agent_customer_pricing_policies" not in schema
    assert "INSERT INTO public.agent_customer_overage_authorizations" not in schema


# ---- webhooks -----------------------------------------------------------------------------------------------------

def test_invoice_item_ids_reads_both_line_shapes():
    invoice = {"lines": {"data": [
        {"parent": {"invoice_item_details": {"invoice_item": "ii_new"}}},
        {"invoice_item": "ii_old"},
        {"parent": {"subscription_item_details": {"subscription_item": "si_1"}}},
        {"invoice_item": {"id": "ii_obj"}},
    ]}}
    assert invoice_item_ids(invoice) == ["ii_new", "ii_old", "ii_obj"]


class _Store:
    def __init__(self, ops):
        self.ops, self.records = ops, []

    def find_operations(self, **kw):
        self.query = kw
        return self.ops

    def record_operation(self, **kw):
        self.records.append(kw)
        return {"ok": True}


def test_webhook_handler_ignores_unrelated_events_and_passes_customer_and_ordering_through():
    store = _Store([{"id": "op-1"}])
    assert handle_invoice_event(SimpleNamespace(type="customer.created"), store) == 0
    event = {"id": "evt_1", "type": "invoice.payment_failed", "created": 123, "data": {"object": {
        "id": "in_1", "customer": "cus_1", "status": "open", "livemode": False,
        "hosted_invoice_url": "https://invoice.stripe.com/i/x", "lines": {"data": [{"invoice_item": "ii_9"}]}}}}
    assert handle_invoice_event(event, store) == 1
    assert store.query == {"invoice_item_ids": ["ii_9"], "invoice_id": "in_1"}
    rec = store.records[0]
    assert rec["invoice_status"] == "payment_failed" and rec["stripe_customer_id"] == "cus_1"
    assert rec["event_created"] == 123 and rec["livemode"] is False and rec["actor_kind"] == "webhook"
    missing_mode = {**event, "data": {"object": {**event["data"]["object"], "livemode": None}}}
    handle_invoice_event(missing_mode, store)
    assert store.records[-1]["livemode"] is True  # unknown mode is treated as live, which the database refuses


# ---- static safety ------------------------------------------------------------------------------------------------

def test_h4_migrations_are_additive_and_every_function_is_pinned_and_revoked():
    pattern = re.compile(r"\b(?:DROP\s+(?:TABLE|COLUMN|TYPE|SCHEMA|FUNCTION|POLICY|INDEX)|TRUNCATE\b|DELETE\s+FROM\b|"
                         r"ALTER\s+(?:TABLE|TYPE)\b[^;]*\b(?:DROP|RENAME|TYPE)\b)", re.I)
    for name in H4_MIGRATIONS:
        sql = _sql(name)
        assert not pattern.search(sql), name
        assert "SECURITY DEFINER" not in sql.upper().replace("SECURITY DEFINER", "SECURITY DEFINER") or \
            "SECURITY DEFINER" not in sql, name
        for fn in re.findall(r"CREATE OR REPLACE FUNCTION (public\.[a-z_]+)\(", sql):
            body = sql[sql.index(f"CREATE OR REPLACE FUNCTION {fn}("):]
            body = body[:body.index("$function$;") if "$function$;" in body else len(body)]
            assert "SET search_path = ''" in body, fn
            assert f"REVOKE ALL ON FUNCTION {fn}(" in sql or f"'{fn}(" in sql, fn


def test_h3_migrations_and_functions_are_not_replaced():
    for name in H4_MIGRATIONS:
        sql = _sql(name)
        for h3 in ("agent_model_attempt_reserve", "agent_model_attempt_dispatch", "agent_model_attempt_settle",
                   "agent_model_attempt_release", "agent__model_block_reason", "deduct_ai_credits",
                   "increment_credits_used"):
            assert f"FUNCTION public.{h3}(" not in sql, (name, h3)


def test_nothing_in_h4_is_scheduled_or_mounted_at_startup():
    scheduler = (API_ROOT / "core" / "scheduler.py").read_text(encoding="utf-8")
    main = (API_ROOT / "main.py").read_text(encoding="utf-8")
    for source in (scheduler, main):
        assert "agent_billing" not in source and "trueup.py" not in source
    internal = (API_ROOT / "routers" / "internal.py").read_text(encoding="utf-8")
    assert "agent_billing" not in internal


def test_application_code_never_imports_the_paid_call_ledger_or_stripe_transport_outside_h4():
    offenders = []
    for path in API_ROOT.rglob("*.py"):
        rel = path.relative_to(API_ROOT).as_posix()
        if rel.startswith(("services/agent_billing/", "tests/", ".venv/")) or "/site-packages/" in rel:
            continue
        source = path.read_text(encoding="utf-8", errors="ignore")
        if re.search(r"agent_billing\.(stripe_transport|trueup|reconciliation)", source):
            offenders.append(rel)
    assert offenders == [], offenders
