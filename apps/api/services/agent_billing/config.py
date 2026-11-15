"""H4 process gates (environment variables prefixed ``AGENT_BILLING_``). Every default is the safe one.

These gate only the H4 *jobs* (reconciliation writes and the Stripe true-up worker). Customer holds/charges on the paid
call path are governed by the database mode (``agent_customer_billing_controls``), which the worker cannot change.

* production is refused in code for both jobs in H4, whatever else is set;
* the Stripe true-up additionally needs a Stripe **test-mode** secret key (``sk_test_``/``rk_test_``) because
  ``H4_LIVE_STRIPE_SUPPORTED`` is False.
"""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict

from services.agent_billing import H4_LIVE_STRIPE_SUPPORTED

BILLING_JOB_ALLOWED_ENVIRONMENTS = frozenset({"development", "test", "staging"})
TEST_MODE_KEY_PREFIXES = ("sk_test_", "rk_test_")


class BillingSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="AGENT_BILLING_", extra="ignore")

    reconciliation_enabled: bool = False
    stripe_trueup_enabled: bool = False
    grace_days: int = 1


def is_test_mode_key(secret_key: str | None) -> bool:
    return bool(secret_key) and str(secret_key).startswith(TEST_MODE_KEY_PREFIXES)


def reconciliation_writes_allowed(*, app_env: str, settings: BillingSettings) -> bool:
    """The reconciler may write (dry runs are always allowed). Never true in production in H4."""
    return bool(settings.reconciliation_enabled) and app_env in BILLING_JOB_ALLOWED_ENVIRONMENTS


def stripe_trueup_allowed(*, app_env: str, settings: BillingSettings, stripe_secret_key: str | None) -> bool:
    """The true-up worker may call Stripe. Never in production, never with a live key, in H4."""
    if not settings.stripe_trueup_enabled or app_env not in BILLING_JOB_ALLOWED_ENVIRONMENTS:
        return False
    return H4_LIVE_STRIPE_SUPPORTED or is_test_mode_key(stripe_secret_key)
