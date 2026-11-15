import logging
import stripe
from fastapi import APIRouter, Depends, HTTPException, Query
from middleware.auth import require_role, CurrentUser
from core.database import supabase
from core.config import settings
from datetime import date, datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr

stripe.api_key = settings.stripe_secret_key

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/billing", tags=["billing"])


@router.get("/subscription")
async def get_subscription(current_user: CurrentUser = Depends(require_role("gm"))):
    result = supabase.table("subscriptions")\
        .select("*")\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Subscription not found")
    return {"data": result.data}


@router.get("/credits")
async def get_credits(current_user: CurrentUser = Depends(require_role("gm"))):
    from middleware.credits import get_or_create_current_period_ledger

    ledger = get_or_create_current_period_ledger(current_user.hotel_id)
    if not ledger:
        return {"data": {"message": "No billing period found"}}

    used = ledger.get("credits_used", 0)
    included = ledger.get("credits_included", 5000)
    overage_cost_cents = ledger.get("overage_cost_cents", 0)

    sub_result = supabase.table("subscriptions")\
        .select("cap_cents, base_fee_cents")\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()
    sub = (sub_result.data if sub_result else None) or {}
    cap_cents = sub.get("cap_cents")
    base_fee_cents = sub.get("base_fee_cents") or 9900

    period_start = date.fromisoformat(ledger["period_start"])
    period_end = date.fromisoformat(ledger["period_end"])
    today = date.today()
    days_elapsed = max(1, (min(today, period_end) - period_start).days + 1)
    days_in_period = (period_end - period_start).days + 1
    projected_overage_cents = round((overage_cost_cents / days_elapsed) * days_in_period)
    projected_month_end_cost_cents = base_fee_cents + projected_overage_cents

    cap_remaining_cents = None
    approaching_cap = False
    if cap_cents:
        spent_so_far_cents = base_fee_cents + overage_cost_cents
        cap_remaining_cents = max(0, cap_cents - spent_so_far_cents)
        approaching_cap = spent_so_far_cents >= cap_cents * 0.8
        if approaching_cap:
            _queue_cap_warning(current_user.hotel_id, current_user.user_id, ledger["period_start"][:7], cap_cents)

    return {
        "data": {
            "period": f"{ledger['period_start'][:7]}",
            "period_start": ledger["period_start"],
            "period_end": ledger["period_end"],
            "credits_included": included,
            "credits_used": used,
            "credits_remaining": max(0, included - used),
            "overage_credits": ledger.get("overage_credits", 0),
            "overage_cost_cents": overage_cost_cents,
            "cap_cents": cap_cents,
            "cap_remaining_cents": cap_remaining_cents,
            "projected_month_end_cost_cents": projected_month_end_cost_cents,
            "approaching_cap": approaching_cap,
        }
    }


def _queue_cap_warning(hotel_id: str, user_id: str, period_label: str, cap_cents: int) -> None:
    """
    Queue a billing_cap_warning notification once per billing period.

    Dedup shape mirrors internal.py::_queue_safety_notification (same table,
    same select-then-insert pattern) but scoped to "this billing period" via
    data.period instead of "today" via created_at — a cap crossing only needs
    one alert per period, not one per day it stays above 80%. Delivered through
    the existing notifications table (surfaced in apps/web's Header bell —
    no new delivery channel needed; see 16-RESEARCH.md Open Question 4/5 —
    this is the lazy/on-read-triggered "proactive" interpretation, avoiding a
    new dedicated cron job).
    """
    existing = supabase.table("notifications").select("id")\
        .eq("tenant_id", hotel_id).eq("user_id", user_id).eq("type", "billing_cap_warning")\
        .contains("data", {"period": period_label}).maybe_single().execute()
    if existing and existing.data:
        return
    supabase.table("notifications").insert({
        "tenant_id": hotel_id,
        "user_id": user_id,
        "type": "billing_cap_warning",
        "title": "Approaching your AI spend cap",
        "body": f"You've used at least 80% of your ${cap_cents / 100:.2f}/month AI spend cap.",
        "data": {"period": period_label, "cap_cents": cap_cents},
    }).execute()


@router.post("/portal")
async def create_portal_session(current_user: CurrentUser = Depends(require_role("gm"))):
    """Create a Stripe Customer Portal session for subscription management."""
    sub_result = supabase.table("subscriptions")\
        .select("stripe_customer_id")\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()

    stripe_cid = (sub_result.data or {}).get("stripe_customer_id") if sub_result.data else None
    if not stripe_cid:
        raise HTTPException(status_code=400, detail="No Stripe customer associated with this account.")

    session = stripe.billing_portal.Session.create(
        customer=stripe_cid,
        return_url=f"{settings.app_url}/settings/billing",
    )
    return {"data": {"url": session.url}}


@router.post("/checkout")
async def create_checkout_session(current_user: CurrentUser = Depends(require_role("gm"))):
    """Create a Stripe Checkout session to upgrade from trial to paid."""
    sub_result = supabase.table("subscriptions")\
        .select("stripe_customer_id, stripe_subscription_id")\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()

    stripe_cid = (sub_result.data or {}).get("stripe_customer_id") if sub_result.data else None

    session = stripe.checkout.Session.create(
        mode="subscription",
        customer=stripe_cid if stripe_cid else None,
        line_items=[
            {
                "price_data": {
                    "currency": "usd",
                    "product_data": {"name": "PatelRep Pro"},
                    "unit_amount": settings.base_plan_price_cents,
                    "recurring": {"interval": "month"},
                },
                "quantity": 1,
            }
        ],
        success_url=f"{settings.app_url}/settings/billing?checkout=success",
        cancel_url=f"{settings.app_url}/settings/billing?checkout=cancelled",
        metadata={"hotel_id": str(current_user.hotel_id)},
    )
    return {"data": {"url": session.url}}


@router.get("/invoices")
async def list_invoices(current_user: CurrentUser = Depends(require_role("gm"))):
    """Return last 10 Stripe invoices for this hotel."""
    sub_result = supabase.table("subscriptions")\
        .select("stripe_customer_id")\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()

    stripe_cid = (sub_result.data or {}).get("stripe_customer_id") if sub_result.data else None
    if not stripe_cid:
        return {"data": []}

    invoices = stripe.Invoice.list(customer=stripe_cid, limit=10)
    result = [
        {
            "id": inv.id,
            "amount_due": inv.amount_due,
            "status": inv.status,
            "created": inv.created,
            "hosted_invoice_url": inv.hosted_invoice_url,
            "period_start": inv.period_start,
            "period_end": inv.period_end,
            "currency": getattr(inv, "currency", None),
            "number": getattr(inv, "number", None),
            "invoice_pdf": getattr(inv, "invoice_pdf", None),
        }
        for inv in (invoices.data or [])
    ]
    return {"data": result}


# ---------------------------------------------------------------------------
# H4: AI usage breakdown and controlled overage (GM only; hotel and user come from the verified token, never the body)
# ---------------------------------------------------------------------------

class OverageAuthorizeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    limit_credits: StrictInt = Field(gt=0, le=10_000_000)
    policy_id: UUID
    terms_version: StrictStr = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9._-]{0,63}$")
    acknowledged_max_exposure_usd: StrictStr = Field(min_length=1, max_length=16, pattern=r"^\d{1,10}(\.\d{1,2})?$")
    confirm: Literal[True]


class OverageRevokeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    confirm: Literal[True]


_OVERAGE_ERRORS = {
    "not_authorized": (403, "Only this hotel's general manager can change AI overage."),
    "pricing_policy_missing": (409, "AI overage is not available for your hotel yet."),
    "terms_changed": (409, "The AI pricing terms changed. Review the new terms and confirm again."),
    "exposure_not_acknowledged": (409, "The confirmed maximum charge does not match this limit. Review and confirm again."),
    "exceeds_hard_cap": (422, "That limit is above your hotel's monthly AI overage cap."),
    "invalid_limit": (422, "Enter a whole number of credits greater than zero."),
}


def _billing_store():
    from services.agent_billing.store import CustomerBillingStore
    return CustomerBillingStore(supabase)


def _d(value) -> Decimal:
    return Decimal(str(value)) if value is not None else Decimal(0)


def _cents(usd: Decimal) -> int:
    return int((usd * 100).quantize(Decimal(1), ROUND_HALF_UP))


def build_ai_usage(summary: dict, sub: dict) -> dict:
    """Server-side AI usage breakdown. Every amount the UI shows comes from here (decimal strings / integer cents)."""
    from services.agent_billing.pricing import legacy_overage_cents

    ledger = summary.get("ledger") or {}
    policy = summary.get("policy")
    auth = summary.get("authorization")
    included = _d(ledger.get("credits_included"))
    used = _d(ledger.get("credits_used"))
    agent_used = _d(ledger.get("agent_credits_used"))
    agent_over = _d(ledger.get("agent_overage_credits"))
    agent_over_usd = _d(ledger.get("agent_overage_usd"))
    base_fee_cents = int(sub.get("base_fee_cents") or 9900)
    cap_cents = sub.get("cap_cents")

    enabled = bool(auth and auth.get("state") == "authorized" and auth.get("current_policy"))
    state = "off"
    if auth and auth.get("state") == "authorized":
        state = "on" if auth.get("current_policy") else "needs_reconfirmation"
    limit = _d(auth.get("authorized_limit_credits")) if enabled else Decimal(0)
    legacy_cents = legacy_overage_cents(overage_cost_cents=str(ledger.get("overage_cost_cents") or 0),
                                        agent_overage_credits=str(agent_over), cap_cents=cap_cents,
                                        base_fee_cents=base_fee_cents) if ledger else 0
    agent_cents = _cents(agent_over_usd)
    return {
        "customer_billing_mode": summary.get("customer_billing_mode", "disabled"),
        "period_start": ledger.get("period_start"),
        "period_end": ledger.get("period_end"),
        "included_credits": str(included),
        "credits_used": str(used),
        "legacy_credits_used": str(used - agent_used),
        "agent_credits_used": str(agent_used),
        "remaining_credits": str(max(Decimal(0), included - used)),
        "pending_reconciliation_credits": str(_d(summary.get("pending_reconciliation_credits"))),
        "in_flight_credits": str(_d(ledger.get("agent_held_credits"))),
        "overage": {
            "state": state,
            "enabled": enabled,
            "version": auth.get("version") if auth else None,
            "updated_at": auth.get("created_at") if auth else None,
            "authorized_limit_credits": str(limit) if enabled else None,
            "max_exposure_usd": auth.get("max_exposure_usd") if enabled else None,
            "accrued_credits": str(agent_over),
            "accrued_usd": str(agent_over_usd.quantize(Decimal("0.01"), ROUND_HALF_UP)),
            "remaining_credits": str(max(Decimal(0), limit - agent_over - _d(ledger.get("agent_held_overage_credits"))))
            if enabled else "0",
        },
        "policy": None if not policy else {
            "id": policy.get("id"),
            "version": policy.get("version"),
            "usd_per_credit": policy.get("usd_per_credit"),
            "terms_version": policy.get("terms_version"),
            "monthly_overage_cap_usd": policy.get("hard_cap_usd"),
        },
        "subscription_cap_cents": cap_cents,
        "estimate": {
            "is_estimate": True,
            "base_fee_cents": base_fee_cents,
            "legacy_overage_cents": legacy_cents,
            "agent_overage_cents": agent_cents,
            "total_cents": base_fee_cents + legacy_cents + agent_cents,
        },
    }


def _subscription_caps(hotel_id: str) -> dict:
    result = supabase.table("subscriptions").select("cap_cents, base_fee_cents")\
        .eq("tenant_id", hotel_id).maybe_single().execute()
    return (result.data if result else None) or {}


@router.get("/ai-usage")
async def get_ai_usage(current_user: CurrentUser = Depends(require_role("gm"))):
    from middleware.credits import get_or_create_current_period_ledger

    get_or_create_current_period_ledger(current_user.hotel_id)
    try:
        summary = _billing_store().summary(tenant_id=current_user.hotel_id)
    except Exception:
        logger.error("AI usage summary unavailable for hotel_id=%s", current_user.hotel_id)
        raise HTTPException(status_code=503, detail="AI usage details are temporarily unavailable.")
    return {"data": build_ai_usage(summary, _subscription_caps(current_user.hotel_id))}


@router.get("/overage/quote")
async def quote_overage(limit_credits: int = Query(gt=0, le=10_000_000),
                        current_user: CurrentUser = Depends(require_role("gm"))):
    """The exact maximum charge for a proposed limit under the hotel's current terms -- the figure the GM confirms.
    The authorize call re-computes it in the database and refuses any mismatch."""
    from services.agent_billing.pricing import max_exposure_usd

    try:
        summary = _billing_store().summary(tenant_id=current_user.hotel_id)
    except Exception:
        logger.error("overage quote unavailable for hotel_id=%s", current_user.hotel_id)
        raise HTTPException(status_code=503, detail="AI overage settings are temporarily unavailable.")
    policy = summary.get("policy")
    if not policy:
        raise HTTPException(status_code=409, detail=_OVERAGE_ERRORS["pricing_policy_missing"][1])
    exposure = max_exposure_usd(limit_credits, policy["usd_per_credit"])
    cap = _d(policy.get("hard_cap_usd"))
    return {"data": {
        "limit_credits": limit_credits, "max_exposure_usd": f"{exposure:.2f}",
        "monthly_overage_cap_usd": policy.get("hard_cap_usd"), "within_cap": exposure <= cap,
        "policy_id": policy.get("id"), "terms_version": policy.get("terms_version"),
        "usd_per_credit": policy.get("usd_per_credit"),
    }}


@router.post("/overage/authorize")
async def authorize_overage(body: OverageAuthorizeRequest,
                            current_user: CurrentUser = Depends(require_role("gm"))):
    try:
        result = _billing_store().authorize_overage(
            tenant_id=current_user.hotel_id, user_id=current_user.user_id, limit_credits=Decimal(body.limit_credits),
            expected_policy_id=str(body.policy_id), terms_version=body.terms_version,
            expected_max_exposure_usd=Decimal(body.acknowledged_max_exposure_usd))
    except Exception:
        logger.error("overage authorization failed for hotel_id=%s", current_user.hotel_id)
        raise HTTPException(status_code=503, detail="AI overage settings are temporarily unavailable.")
    if not result.get("ok"):
        status, message = _OVERAGE_ERRORS.get(result.get("reason"), (409, "AI overage could not be changed."))
        raise HTTPException(status_code=status, detail=message)
    return {"data": {
        "state": "on", "version": result.get("version"),
        "authorized_limit_credits": result.get("authorized_limit_credits"),
        "max_exposure_usd": result.get("max_exposure_usd"), "recorded_at": result.get("created_at"),
    }}


@router.post("/overage/revoke")
async def revoke_overage(body: OverageRevokeRequest, current_user: CurrentUser = Depends(require_role("gm"))):
    try:
        result = _billing_store().revoke_overage(tenant_id=current_user.hotel_id, user_id=current_user.user_id)
    except Exception:
        logger.error("overage revocation failed for hotel_id=%s", current_user.hotel_id)
        raise HTTPException(status_code=503, detail="AI overage settings are temporarily unavailable.")
    if not result.get("ok"):
        status, message = _OVERAGE_ERRORS.get(result.get("reason"), (409, "AI overage could not be changed."))
        raise HTTPException(status_code=status, detail=message)
    return {"data": {"state": "off", "version": result.get("version"), "recorded_at": result.get("created_at"),
                     "already_off": bool(result.get("already_off"))}}


@router.get("/history")
async def get_billing_history(current_user: CurrentUser = Depends(require_role("gm"))):
    try:
        periods = _billing_store().history(tenant_id=current_user.hotel_id, limit=12)
    except Exception:
        logger.error("billing history unavailable for hotel_id=%s", current_user.hotel_id)
        raise HTTPException(status_code=503, detail="Billing history is temporarily unavailable.")
    return {"data": [_history_period(p) for p in periods or []]}


_OPERATION_LABELS = {
    "prepared": "pending", "submitting": "pending", "ambiguous": "pending", "item_created": "pending_invoice",
    "invoiced": "invoiced", "paid": "paid", "payment_failed": "payment_failed", "void": "void",
    "uncollectible": "uncollectible", "nothing_to_bill": "nothing_to_bill", "manual_intervention": "under_review",
}


def _history_period(p: dict) -> dict:
    agent_over_usd = _d(p.get("agent_overage_usd"))
    return {
        "period_start": p.get("period_start"),
        "period_end": p.get("period_end"),
        "is_finalized": bool(p.get("is_finalized")),
        "included_credits": p.get("credits_included"),
        "credits_used": p.get("credits_used"),
        "agent_credits_used": p.get("agent_credits_used"),
        "legacy_credits_used": str(_d(p.get("credits_used")) - _d(p.get("agent_credits_used"))),
        "agent_overage_credits": p.get("agent_overage_credits"),
        "agent_overage_cents": _cents(agent_over_usd),
        "adjustment_credits": p.get("adjustment_credits"),
        "late_charge_credits": p.get("late_charge_credits"),
        "pending_reconciliation_credits": p.get("pending_reconciliation_credits"),
        "billing_actions": [{
            "id": op.get("id"),
            "status": _OPERATION_LABELS.get(op.get("state"), "under_review"),
            "amount_cents": op.get("amount_cents"),
            "overage_credits": op.get("overage_credits"),
            # Only an actual Stripe invoice gets a link; a pending invoice item has none.
            "invoice_url": op.get("hosted_invoice_url") if op.get("has_invoice") else None,
        } for op in (p.get("operations") or [])],
    }


def true_up_tenant(
    tenant_id: str,
    period_start: date,
    *,
    require_active: bool = True,
    require_period_ended: bool = True,
    today: date | None = None,
) -> dict:
    """
    Idempotent per-tenant monthly true-up: invoices AI-credit overage for the
    given calendar-month period exactly once, using credit_ledger.is_finalized
    as the durable "already invoiced" stamp -- NOT Stripe's Idempotency-Key
    alone, which expires after 24h and cannot protect against this cron
    re-firing on a LATER night (its schedule is `0 0 28-31 * *`, 2-4x/month
    by design).

    require_period_ended (default True) is a SEPARATE, EQUALLY CRITICAL guard:
    increment_credits_used() (migration 020) has `WHERE ... AND is_finalized =
    FALSE`, so once is_finalized flips to TRUE, all later usage in that period
    silently stops being tracked/billed. Finalizing on an early cron firing
    (e.g. day 28 of a 30-day month) before the period has truly ended would
    permanently drop the last 1-3 days of usage every month. This function
    refuses to finalize while `today <= ledger.period_end` UNLESS the caller
    explicitly passes require_period_ended=False. period_end is the LAST DAY of
    the period (inclusive), so the period has ended only once today is after it;
    the previous `today < period_end` check finalized at 00:00 on the last day
    and silently dropped that whole day's usage (H4 audit, ADR-0003 F3).

    H4 coexistence: consented agent overage (credit_ledger.agent_overage_credits)
    is billed by the H4 outbox, never here; the amount is rounded once to whole
    cents (Stripe requires integers; overage_cost_cents is NUMERIC(10,4)); and the
    Stripe invoice ITEM id is stored in stripe_invoice_item_id, never in
    stripe_invoice_id (which must hold an invoice id).

    Called by:
      - internal.py::run_monthly_trueup (cron) with require_active=True,
        require_period_ended=True (both defaults) -- only bills active
        subscriptions, and only once their period has actually closed. The
        cron's own outer query additionally pre-filters to period_end<=today,
        so this in-function gate is defense-in-depth, not the only guard.
      - webhooks.py's customer.subscription.deleted handler (BILLING-08) with
        require_active=False AND require_period_ended=False -- a mid-cycle
        cancellation IS the terminating event for that tenant's billable
        period; overage accrued before cancellation must be invoiced
        immediately, regardless of subscription status label or how many
        calendar days remain in the period.
    """
    current_day = today or date.today()

    ledger_result = supabase.table("credit_ledger")\
        .select("*")\
        .eq("tenant_id", tenant_id)\
        .eq("period_start", period_start.isoformat())\
        .maybe_single()\
        .execute()
    ledger = (ledger_result.data if ledger_result else None) or {}
    if not ledger:
        return {"status": "no_ledger"}
    if ledger.get("is_finalized"):
        return {"status": "already_finalized"}

    period_end = date.fromisoformat(ledger["period_end"])
    if require_period_ended and current_day <= period_end:
        return {"status": "period_not_yet_ended"}

    sub_result = supabase.table("subscriptions")\
        .select("stripe_customer_id, plan_status, cap_cents, base_fee_cents")\
        .eq("tenant_id", tenant_id)\
        .maybe_single()\
        .execute()
    sub = (sub_result.data if sub_result else None) or {}

    if require_active and sub.get("plan_status") != "active":
        return {"status": "skipped_inactive"}

    stripe_cid = sub.get("stripe_customer_id")
    if not stripe_cid:
        return {"status": "skipped_no_stripe_customer"}

    # Read the ledger's own GENERATED columns (already correctly subtract
    # credits_purchased) instead of recomputing overage in Python -- keeps
    # this in sync with get_credits()'s math and avoids a future overbill
    # once a credit-purchase feature writes credits_purchased.
    from services.agent_billing.pricing import legacy_overage_cents

    agent_overage_credits = ledger.get("agent_overage_credits") or 0
    overage_credits = Decimal(str(ledger.get("overage_credits") or 0)) - Decimal(str(agent_overage_credits))
    base_fee_cents = sub.get("base_fee_cents") or 9900
    cap_cents = sub.get("cap_cents")

    overage_cents = legacy_overage_cents(
        overage_cost_cents=str(ledger.get("overage_cost_cents") or 0),
        agent_overage_credits=str(agent_overage_credits),
        cap_cents=cap_cents,
        base_fee_cents=base_fee_cents,
    )

    finalize_patch = {
        "is_finalized": True,
        "finalized_at": datetime.now(timezone.utc).isoformat(),
    }

    if overage_cents <= 0:
        supabase.table("credit_ledger").update(finalize_patch)\
            .eq("tenant_id", tenant_id).eq("period_start", period_start.isoformat()).execute()
        return {"status": "no_overage_finalized"}

    try:
        invoice_item = stripe.InvoiceItem.create(
            customer=stripe_cid,
            amount=overage_cents,
            currency="usd",
            description=f"AI Credits Overage: {max(overage_credits, Decimal(0)).normalize():f} credits @ $0.02",
            idempotency_key=f"trueup-{tenant_id}-{period_start.isoformat()}",
        )
    except Exception as e:
        logger.error("Stripe true-up invoice failed for tenant=%s customer=%s: %s", tenant_id, stripe_cid, e, exc_info=True)
        return {"status": "error", "error": str(e)}

    finalize_patch["stripe_invoice_item_id"] = invoice_item.id
    try:
        supabase.table("credit_ledger").update(finalize_patch)\
            .eq("tenant_id", tenant_id).eq("period_start", period_start.isoformat()).execute()
    except Exception as e:
        # Stripe was already charged -- a failed stamp write here would cause
        # the NEXT run to re-bill. Log loudly for manual reconciliation; do
        # not retry the Stripe call.
        logger.error(
            "CRITICAL: Stripe invoice %s created for tenant=%s but is_finalized "
            "stamp failed to write -- manual reconciliation required: %s",
            invoice_item.id, tenant_id, e, exc_info=True,
        )
        return {"status": "invoiced_stamp_failed", "stripe_invoice_item_id": invoice_item.id}

    return {"status": "invoiced", "stripe_invoice_item_id": invoice_item.id, "overage_cents": overage_cents}
