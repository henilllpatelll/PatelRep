"""Helpers for the legacy true-up outbox real-database tests (migration 250). Stripe is ALWAYS a fake transport."""
from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from agent_billing_support import make_billing_hotel
from agent_orchestrator_support import run_sql, sql_value
from batch_support import new_client
from services.billing_trueup import Ambiguous, Invoice, Item, LegacyTrueUp, Rejected, TrueUpStore

DAY = 86400


def last_month() -> tuple[date, date]:
    end = date.today().replace(day=1) - timedelta(days=1)
    return end.replace(day=1), end


def ts(day: date) -> int:
    return int(datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc).timestamp())


@dataclass
class FakeStripe:
    """Stripe semantics that matter here: idempotency keys honoured for 24h then pruned; list by customer/created;
    optional faults (lost response after the item exists, failure before it exists, definitive rejection)."""

    now: float = 0.0
    items: dict[str, Item] = field(default_factory=dict)
    keys: dict[str, tuple[float, str]] = field(default_factory=dict)
    invoices: dict[str, Invoice] = field(default_factory=dict)
    lose_response: int = 0
    fail_before: int = 0
    reject: int = 0
    truncate_search: bool = False
    creates: int = 0
    livemode: bool = False

    def add_item(self, *, customer: str, amount: int, created: int, description: str,
                 metadata: Optional[dict] = None, invoice: Optional[str] = None) -> Item:
        item = Item(id="ii_fk" + uuid.uuid4().hex[:14], customer=customer, amount=amount, currency="usd",
                    livemode=self.livemode, invoice=invoice, description=description, created=created,
                    metadata=metadata or {})
        self.items[item.id] = item
        return item

    def create_invoice_item(self, *, customer, amount_cents, currency, description, metadata, period_start, period_end,
                            idempotency_key):
        if self.fail_before:
            self.fail_before -= 1
            raise Ambiguous("stripe_unavailable")
        if self.reject:
            self.reject -= 1
            raise Rejected("stripe_invalid_request")
        hit = self.keys.get(idempotency_key)
        if hit and self.now - hit[0] < DAY:
            item = self.items[hit[1]]
        else:
            self.creates += 1
            item = self.add_item(customer=customer, amount=amount_cents, created=int(self.now) or ts(date.today()),
                                 description=description, metadata=dict(metadata))
            self.keys[idempotency_key] = (self.now, item.id)
        if self.lose_response:
            self.lose_response -= 1
            raise Ambiguous("stripe_unavailable")
        return item

    def list_invoice_items(self, *, customer, created_gte):
        if self.truncate_search:
            raise Ambiguous("invoice_item_search_truncated")
        return [i for i in self.items.values() if i.customer == customer and (i.created or 0) >= created_gte]

    def retrieve_invoice_item(self, item_id):
        if item_id not in self.items:
            raise Rejected("stripe_invalid_request")  # another test's item: Stripe would say "no such item"
        return self.items[item_id]

    def retrieve_invoice(self, invoice_id):
        return self.invoices[invoice_id]

    def attach_invoice(self, item_id: str, *, status: str, invoice_id: Optional[str] = None,
                       customer: Optional[str] = None) -> str:
        item = self.items[item_id]
        invoice_id = invoice_id or "in_fk" + uuid.uuid4().hex[:14]
        self.items[item_id] = Item(**{**item.__dict__, "invoice": invoice_id})
        self.invoices[invoice_id] = Invoice(id=invoice_id, customer=customer or item.customer, status=status,
                                            livemode=self.livemode)
        return invoice_id


def tstore() -> TrueUpStore:
    return TrueUpStore(new_client())


def worker(fake: FakeStripe) -> LegacyTrueUp:
    return LegacyTrueUp(store=tstore(), transport=fake, actor="it-legacy-trueup", clock=lambda: fake.now or 1.0)


def legacy_hotel(*, credits_used: int = 6000, included: int = 5000, finalized: bool = False,
                 item_id: Optional[str] = None, period: Optional[tuple[date, date]] = None, **kw):
    """A hotel with an ENDED legacy period: credits_used above the allowance (each credit over = 2 cents)."""
    bh = make_billing_hotel(included=included, policy=False, **kw)
    start, end = period or last_month()
    run_sql(f"""INSERT INTO public.credit_ledger (tenant_id, period_start, period_end, credits_included, credits_used,
                  is_finalized, stripe_invoice_item_id)
                VALUES ('{bh.tenant_id}', '{start}', '{end}', {included}, {credits_used}, {str(finalized).lower()},
                        {f"'{item_id}'" if item_id else 'NULL'});""")
    return bh, start


def op_of(tenant_id: str, period_start: date) -> dict:
    out = sql_value(f"SELECT row_to_json(o)::text FROM public.billing_trueup_operations o "
                    f"WHERE tenant_id = '{tenant_id}' AND period_start = '{period_start}';")
    return json.loads(out) if out else {}


def ledger_of(tenant_id: str, period_start: date) -> dict:
    out = sql_value(f"SELECT row_to_json(l)::text FROM public.credit_ledger l "
                    f"WHERE tenant_id = '{tenant_id}' AND period_start = '{period_start}';")
    return json.loads(out) if out else {}


def park_leftover_operations() -> None:
    """Throwaway-DB hygiene: operations left actionable by earlier tests are parked for an operator, so a test's
    global run_due() only ever acts on its own hotel (the same reason reset_spend_state exists for H3)."""
    run_sql("""SELECT public.billing_trueup_record(id, 'manual', 'operator', 'it-reset', NULL, NULL, NULL, NULL, NULL,
                 'test_reset', NULL)
               FROM public.billing_trueup_operations
              WHERE state NOT IN ('paid', 'void', 'nothing_to_bill', 'manual_intervention');""")


def age_claim(operation_id: str) -> None:
    """Fault injection: the worker that claimed the operation died more than 10 minutes ago."""
    run_sql(f"BEGIN; ALTER TABLE public.billing_trueup_operations DISABLE TRIGGER billing_trueup_operations_guard;"
            f"UPDATE public.billing_trueup_operations SET updated_at = now() - interval '11 minutes' "
            f"WHERE id = '{operation_id}';"
            f"ALTER TABLE public.billing_trueup_operations ENABLE TRIGGER billing_trueup_operations_guard; COMMIT;")
