import logging
import stripe
from fastapi import APIRouter, Depends, HTTPException
from middleware.auth import require_role, CurrentUser
from core.database import supabase
from core.config import settings
from datetime import date, datetime, timezone

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
        }
        for inv in (invoices.data or [])
    ]
    return {"data": result}


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
    refuses to finalize while `today < ledger.period_end` UNLESS the caller
    explicitly passes require_period_ended=False.

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
    if require_period_ended and current_day < period_end:
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
    overage_credits = ledger.get("overage_credits", 0)
    overage_cost_cents = ledger.get("overage_cost_cents", 0)
    base_fee_cents = sub.get("base_fee_cents") or 9900
    cap_cents = sub.get("cap_cents")

    overage_cents = overage_cost_cents
    if cap_cents:
        overage_cents = max(0, min(overage_cents, cap_cents - base_fee_cents))

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
            description=f"AI Credits Overage: {overage_credits} credits @ $0.02",
            idempotency_key=f"trueup-{tenant_id}-{period_start.isoformat()}",
        )
    except Exception as e:
        logger.error("Stripe true-up invoice failed for tenant=%s customer=%s: %s", tenant_id, stripe_cid, e, exc_info=True)
        return {"status": "error", "error": str(e)}

    finalize_patch["stripe_invoice_id"] = invoice_item.id
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
        return {"status": "invoiced_stamp_failed", "stripe_invoice_id": invoice_item.id}

    return {"status": "invoiced", "stripe_invoice_id": invoice_item.id, "overage_cents": overage_cents}
