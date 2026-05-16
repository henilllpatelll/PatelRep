import hmac
import hashlib
import json
import logging
from datetime import datetime, timezone as tz, date
from fastapi import APIRouter, Request, HTTPException
import stripe
from core.database import supabase
from core.config import settings

logger = logging.getLogger(__name__)
from services.opera.webhooks import (
    handle_checkout,
    handle_checkin,
    handle_reservation_modified,
    handle_dnd,
    handle_make_up_room,
)

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


def _verify_opera_signature(payload: bytes, signature_header: str, hotel_id: str) -> bool:
    """
    Validate HMAC-SHA256 signature from Opera Business Events.
    The secret is derived from CRON_SECRET + hotel_id for MVP.
    """
    if not signature_header:
        return False  # If no signature header, accept in dev (fail in prod)

    secret = f"{settings.cron_secret}:{hotel_id}".encode()
    expected = hmac.new(secret, payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(f"sha256={expected}", signature_header)


@router.post("/opera")
async def opera_webhook(request: Request):
    """
    Opera Cloud Business Events webhook.
    Handles: RESERVATION.CHECKED_OUT, RESERVATION.CHECKED_IN,
             RESERVATION.MODIFIED, ROOM_STATUS.DO_NOT_DISTURB,
             ROOM_STATUS.MAKE_UP_ROOM
    """
    payload = await request.body()

    try:
        event_data = json.loads(payload)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    opera_hotel_id = event_data.get("hotelId", "")
    event_type = event_data.get("eventType", "")
    event_payload = event_data.get("payload", {})

    # Resolve PatelRep hotel_id from Opera hotel identifier
    creds = supabase.table("opera_credentials")\
        .select("tenant_id")\
        .eq("hotel_id_opera", opera_hotel_id)\
        .eq("is_connected", True)\
        .maybe_single()\
        .execute()

    if not creds or not creds.data:
        return {"status": "ignored", "reason": "hotel not found or not connected"}

    hotel_id = creds.data["tenant_id"]

    # Optional HMAC validation (non-fatal in development)
    signature = request.headers.get("x-oracle-signature", "")
    if settings.app_env == "production" and not _verify_opera_signature(payload, signature, hotel_id):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    # Dispatch to handlers
    handlers = {
        "RESERVATION.CHECKED_OUT": handle_checkout,
        "RESERVATION.CHECKED_IN": handle_checkin,
        "RESERVATION.MODIFIED": handle_reservation_modified,
        "ROOM_STATUS.DO_NOT_DISTURB": handle_dnd,
        "ROOM_STATUS.MAKE_UP_ROOM": handle_make_up_room,
    }

    handler = handlers.get(event_type)
    if handler:
        try:
            handler(hotel_id, event_payload)
        except Exception as e:
            # Log but never crash — return 200 so Opera doesn't retry
            logger.error("Opera webhook handler error for %s: %s", event_type, e)

    return {"status": "ok", "event_type": event_type}


@router.post("/stripe")
async def stripe_webhook(request: Request):
    """Stripe billing event webhook handler."""
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")

    try:
        event = stripe.Webhook.construct_event(payload, sig, settings.stripe_webhook_secret)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid Stripe signature")

    if event.type in ("customer.subscription.created", "customer.subscription.updated"):
        sub = event.data.object
        hotel_id = sub.metadata.get("hotel_id")
        if hotel_id:
            def _ts(unix):
                if not unix:
                    return None
                return datetime.fromtimestamp(unix, tz=tz.utc).isoformat()

            supabase.table("subscriptions").update({
                "plan_status": sub.status,
                "stripe_subscription_id": sub.id,
                "trial_end": _ts(getattr(sub, "trial_end", None)),
                "current_period_start": _ts(getattr(sub, "current_period_start", None)),
                "current_period_end": _ts(getattr(sub, "current_period_end", None)),
            }).eq("tenant_id", hotel_id).execute()

    elif event.type == "customer.subscription.deleted":
        sub = event.data.object
        hotel_id = sub.metadata.get("hotel_id")
        if hotel_id:
            supabase.table("subscriptions")\
                .update({"plan_status": "cancelled"})\
                .eq("tenant_id", hotel_id)\
                .execute()

    elif event.type == "checkout.session.completed":
        session = event.data.object
        hotel_id = (session.metadata or {}).get("hotel_id")
        stripe_sub_id = getattr(session, "subscription", None)
        if hotel_id and stripe_sub_id:
            supabase.table("subscriptions").update({
                "plan_status": "active",
                "stripe_subscription_id": stripe_sub_id,
            }).eq("tenant_id", hotel_id).execute()

    elif event.type == "invoice.payment_failed":
        sub_id = event.data.object.subscription
        if sub_id:
            supabase.table("subscriptions")\
                .update({"plan_status": "past_due"})\
                .eq("stripe_subscription_id", sub_id)\
                .execute()

    elif event.type == "invoice.paid":
        inv = event.data.object
        sub_id = getattr(inv, "subscription", None)
        stripe_invoice_id = inv.id
        if sub_id and stripe_invoice_id:
            # Resolve tenant from subscription
            sub_row = supabase.table("subscriptions")\
                .select("tenant_id")\
                .eq("stripe_subscription_id", sub_id)\
                .maybe_single()\
                .execute()
            if sub_row and sub_row.data:
                tenant_id = sub_row.data["tenant_id"]
                today = date.today().isoformat()
                supabase.table("credit_ledger")\
                    .update({"stripe_invoice_id": stripe_invoice_id})\
                    .eq("tenant_id", tenant_id)\
                    .lte("period_start", today)\
                    .gte("period_end", today)\
                    .execute()

    return {"status": "ok"}
