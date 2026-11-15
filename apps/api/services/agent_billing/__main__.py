"""``python -m services.agent_billing <command>`` -- H4 operator runbook commands. Nothing here runs on a schedule.

  status                                      controls + reconciliation dry run (metadata only)
  reconcile [--apply] [--limit N]             one bounded reconciliation pass; dry run unless --apply
                                              (--apply needs AGENT_BILLING_RECONCILIATION_ENABLED, non-production)
  controls --mode disabled|enforced [--trueup] --operator O [--reason R]
                                              set the database customer-billing switches (refused in production)
  policy-propose --tenant T --included N --usd-per-credit X --markup M --min-credits C --hard-cap-usd U
                 --terms-version V --operator O
  policy-approve --tenant T --policy P --approver A   (approver must differ from proposer)
  policy-retire  --tenant T --operator O --reason R   (hotel billing then fails closed)
  adjust --tenant T --charge C --reduce-credits N --operator O --approver A --reason R
                                              compensating adjustment (two-person); never edits a charge
  trueup-prepare [--grace-days N]             create outbox operations for ended periods (no Stripe call)
  trueup-run [--limit N]                      process due operations against Stripe TEST MODE only
                                              (needs AGENT_BILLING_STRIPE_TRUEUP_ENABLED, the database switch,
                                              a test-mode key, non-production)

Commands use the backend service credentials from the environment. There is deliberately no command that opts a hotel
into overage: only the hotel's GM can do that, through the authenticated API.
"""
from __future__ import annotations

import argparse
import json
import sys
from decimal import Decimal


def _store():
    from core.database import supabase
    from services.agent_billing.store import CustomerBillingStore

    return CustomerBillingStore(supabase)


def _print(data) -> None:
    print(json.dumps(data, indent=2, sort_keys=True, default=str))


def main(argv: list[str] | None = None) -> int:
    from core.config import settings as app_settings
    from services.agent_billing.config import BillingSettings, stripe_trueup_allowed
    from services.agent_billing.reconciliation import ReconciliationRefused, run_reconciliation

    parser = argparse.ArgumentParser(prog="python -m services.agent_billing")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("status")
    p = sub.add_parser("reconcile")
    p.add_argument("--apply", action="store_true")
    p.add_argument("--limit", type=int, default=100)
    p = sub.add_parser("controls")
    p.add_argument("--mode", choices=("disabled", "enforced"), required=True)
    p.add_argument("--trueup", action="store_true")
    p.add_argument("--operator", required=True)
    p.add_argument("--reason")
    p = sub.add_parser("policy-propose")
    for name in ("--tenant", "--included", "--usd-per-credit", "--markup", "--min-credits", "--hard-cap-usd",
                 "--terms-version", "--operator"):
        p.add_argument(name, required=True)
    p.add_argument("--reason")
    p = sub.add_parser("policy-approve")
    for name in ("--tenant", "--policy", "--approver"):
        p.add_argument(name, required=True)
    p = sub.add_parser("policy-retire")
    for name in ("--tenant", "--operator", "--reason"):
        p.add_argument(name, required=True)
    p = sub.add_parser("adjust")
    for name in ("--tenant", "--charge", "--reduce-credits", "--operator", "--approver", "--reason"):
        p.add_argument(name, required=True)
    p = sub.add_parser("trueup-prepare")
    p.add_argument("--grace-days", type=int, default=1)
    p = sub.add_parser("trueup-run")
    p.add_argument("--limit", type=int, default=50)
    args = parser.parse_args(argv)

    billing = BillingSettings()
    env = app_settings.app_env
    store = _store()

    if args.command == "status":
        _print({"reconciliation": run_reconciliation(store, app_env=env, settings=billing, dry_run=True)})
        return 0
    if args.command == "reconcile":
        try:
            _print(run_reconciliation(store, app_env=env, settings=billing, dry_run=not args.apply, limit=args.limit))
        except ReconciliationRefused as exc:
            print(str(exc), file=sys.stderr)
            return 2
        return 0
    if args.command == "controls":
        if env == "production" and (args.mode == "enforced" or args.trueup):
            print("refused: H4 customer billing cannot be activated in production by this release", file=sys.stderr)
            return 2
        _print(store.set_controls(mode=args.mode, stripe_trueup_enabled=args.trueup, operator=args.operator,
                                  reason=args.reason))
        return 0
    if args.command == "policy-propose":
        _print(store.propose_policy(tenant_id=args.tenant, included_credits=Decimal(args.included),
                                    usd_per_credit=Decimal(args.usd_per_credit), markup_multiplier=Decimal(args.markup),
                                    minimum_credits=Decimal(args.min_credits), hard_cap_usd=Decimal(args.hard_cap_usd),
                                    terms_version=args.terms_version, operator=args.operator, reason=args.reason))
        return 0
    if args.command == "policy-approve":
        _print(store.approve_policy(tenant_id=args.tenant, policy_id=args.policy, approver=args.approver))
        return 0
    if args.command == "policy-retire":
        _print(store.retire_policy(tenant_id=args.tenant, operator=args.operator, reason=args.reason))
        return 0
    if args.command == "adjust":
        _print(store.adjust_charge(tenant_id=args.tenant, charge_id=args.charge,
                                   reduce_credits=Decimal(args.reduce_credits), operator=args.operator,
                                   approver=args.approver, reason=args.reason))
        return 0
    if args.command in ("trueup-prepare", "trueup-run"):
        if not stripe_trueup_allowed(app_env=env, settings=billing, stripe_secret_key=app_settings.stripe_secret_key):
            print("refused: Stripe true-up is disabled (process gate, environment or non test-mode key)", file=sys.stderr)
            return 2
        from services.agent_billing.stripe_transport import StripeSdkTransport
        from services.agent_billing.trueup import TrueUpProcessor

        processor = TrueUpProcessor(store=store, transport=StripeSdkTransport(app_settings.stripe_secret_key))
        if args.command == "trueup-prepare":
            _print(processor.prepare_due(grace_days=args.grace_days))
        else:
            _print(processor.run_due(limit=args.limit))
        return 0
    return 1


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
