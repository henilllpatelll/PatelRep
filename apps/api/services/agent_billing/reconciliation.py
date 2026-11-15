"""H4 customer-billing reconciliation job (bounded, idempotent, dry-run by default, metadata-only output).

All decisions are made by ``agent_customer_billing_reconcile`` (migration 249) inside one transaction:
  * a hold whose attempt is settled becomes exactly one charge (unique per attempt, even if two reconcilers race);
  * a hold whose attempt was released is released;
  * a hold whose attempt is uncertain/unreconciled waits -- no evidence, no charge -- and is reported for an operator;
  * ledger breakdown columns are compared with the journal and open holds; drift is reported, never auto-corrected.
Attempt locks are taken with SKIP LOCKED, so a busy attempt is simply picked up by the next run.

The job is NOT scheduled anywhere by this PR. Writes need ``AGENT_BILLING_RECONCILIATION_ENABLED`` and a
non-production environment.
"""
from __future__ import annotations

from services.agent_billing.config import BillingSettings, reconciliation_writes_allowed
from services.agent_billing.observability import log_event
from services.agent_billing.store import CustomerBillingStore


class ReconciliationRefused(RuntimeError):
    pass


def run_reconciliation(store: CustomerBillingStore, *, app_env: str, settings: BillingSettings, dry_run: bool = True,
                       limit: int = 100, actor: str = "h4-reconciler") -> dict:
    if not dry_run and not reconciliation_writes_allowed(app_env=app_env, settings=settings):
        raise ReconciliationRefused("reconciliation writes are disabled in this environment")
    result = store.reconcile(limit=limit, dry_run=dry_run, actor=actor)
    log_event("billing_reconciliation", dry_run=dry_run, examined=result.get("examined"),
              outcome="ok" if result.get("ok") else "failed")
    return result
