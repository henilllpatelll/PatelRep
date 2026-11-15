"""Agent Harness H4: customer billing for agent AI usage (default disabled).

Four financial concepts are kept apart (docs/agent-harness/customer-billing.md):
  provider expense (H3 ledger, USD) -> customer credits (credit_ledger + charge journal) -> customer overage (only under
  an explicit GM authorization) -> Stripe outcomes (durable outbox).

Activation layers, each independent and each OFF by default:
  * ``agent_customer_billing_controls.customer_billing_mode`` ('disabled' | 'enforced') in the database;
  * ``agent_customer_billing_controls.stripe_trueup_enabled`` in the database;
  * process gates ``AGENT_BILLING_*`` (config.py), refused in production in H4;
  * ``H4_LIVE_STRIPE_SUPPORTED = False``: the Stripe transport refuses any non test-mode key, and the outbox table
    constrains ``livemode = false``. Live billing needs a reviewed code change AND a reviewed migration.
"""
from __future__ import annotations

H4_LIVE_STRIPE_SUPPORTED = False

__all__ = ["H4_LIVE_STRIPE_SUPPORTED"]
