import stripe
from fastapi import APIRouter, Depends
from middleware.auth import require_role, CurrentUser
from core.database import supabase
from core.config import settings
from datetime import date

stripe.api_key = settings.stripe_secret_key

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
    today = date.today()
    result = supabase.table("credit_ledger")\
        .select("*")\
        .eq("tenant_id", current_user.hotel_id)\
        .lte("period_start", today.isoformat())\
        .gte("period_end", today.isoformat())\
        .maybe_single()\
        .execute()

    if not result.data:
        return {"data": {"message": "No billing period found"}}

    ledger = result.data
    used = ledger.get("credits_used", 0)
    included = ledger.get("credits_included", 5000)

    # Fetch cap_cents from subscription
    sub_result = supabase.table("subscriptions")\
        .select("cap_cents")\
        .eq("tenant_id", current_user.hotel_id)\
        .maybe_single()\
        .execute()
    cap_cents = (sub_result.data or {}).get("cap_cents") if sub_result.data else None

    return {
        "data": {
            "period": f"{ledger['period_start'][:7]}",
            "credits_included": included,
            "credits_used": used,
            "credits_remaining": max(0, included - used),
            "overage_credits": ledger.get("overage_credits", 0),
            "overage_cost_cents": ledger.get("overage_cost_cents", 0),
            "cap_cents": cap_cents,
        }
    }


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
        from fastapi import HTTPException
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
                    "unit_amount": 9900,
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
