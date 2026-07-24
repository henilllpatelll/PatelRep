import hmac
import hashlib
import json
import logging
from datetime import datetime, timezone as tz, date
from fastapi import APIRouter, Request, HTTPException
import stripe
from twilio.request_validator import RequestValidator
from core.database import supabase
from core.config import settings
from services.opera.webhooks import (
    handle_checkout,
    handle_checkin,
    handle_reservation_modified,
    handle_dnd,
    handle_make_up_room,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


def _verify_twilio_signature(request: Request, params: dict) -> bool:
    """Twilio signs the exact public URL. Railway terminates TLS, so request.url may say http://."""
    signature = request.headers.get("x-twilio-signature", "")
    if not signature or not settings.twilio_auth_token:
        return False
    proto = request.headers.get("x-forwarded-proto", "https")
    host = request.headers.get("host", "")
    url = f"{proto}://{host}{request.url.path}"
    return RequestValidator(settings.twilio_auth_token).validate(url, params, signature)


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


@router.post("/twilio-sms")
async def twilio_sms_webhook(request: Request):
    """Inbound guest SMS. Reply-only matching (D-02) — never creates a guest request."""
    form = await request.form()
    params = {k: str(v) for k, v in form.items()}
    if settings.app_env == "production" and not _verify_twilio_signature(request, params):
        raise HTTPException(status_code=401, detail="Invalid Twilio signature")

    from_number = params.get("From", "")
    body = params.get("Body", "")
    provider_sid = params.get("MessageSid")
    if not from_number or not body:
        return {"status": "ignored", "reason": "missing_from_or_body"}

    try:
        recent = supabase.table("guest_messages").select(
            "guest_request_id, tenant_id"
        ).eq("direction", "outbound").eq("recipient", from_number).order(
            "created_at", desc=True
        ).limit(1).execute().data or []
        if not recent:
            # D-02: never auto-create a guest request from a cold inbound text.
            logger.warning("Inbound SMS with no matching outbound thread (from=***%s)", from_number[-4:])
            return {"status": "ignored", "reason": "no_matching_outbound"}

        match = recent[0]
        tenant_id = match["tenant_id"]
        guest_request_id = match["guest_request_id"]
        message = supabase.table("guest_messages").insert({
            "tenant_id": tenant_id,
            "guest_request_id": guest_request_id,
            "direction": "inbound",
            "channel": "sms",
            "body": body,
            "recipient": from_number,
            "delivery_status": "received",
            "provider_message_id": provider_sid,
            "excluded_from_ai": True,
        }).execute().data[0]
        supabase.table("guest_request_events").insert({
            "tenant_id": tenant_id,
            "guest_request_id": guest_request_id,
            "event_type": "guest_contacted",
            "source": "sms",
            "detail": "Guest replied by SMS",
            "metadata": {"message_id": message["id"]},
        }).execute()
    except Exception as exc:  # noqa: BLE001
        # Log but never crash — Twilio retry-storms on non-2xx.
        logger.error("Twilio inbound handler error: %s", exc)
        return {"status": "error_logged"}

    return {"status": "ok"}


TWILIO_STATUS_MAP = {
    "queued": "queued", "accepted": "queued", "sending": "sent", "sent": "sent",
    "delivered": "delivered", "undelivered": "undelivered", "failed": "failed",
}


@router.post("/twilio-status")
async def twilio_status_webhook(request: Request):
    """Delivery status callback. guest_messages is append-only, so status lands in its event table."""
    form = await request.form()
    params = {k: str(v) for k, v in form.items()}
    if settings.app_env == "production" and not _verify_twilio_signature(request, params):
        raise HTTPException(status_code=401, detail="Invalid Twilio signature")

    provider_sid = params.get("MessageSid", "")
    raw_status = params.get("MessageStatus", "")
    error_code = params.get("ErrorCode") or None
    mapped = TWILIO_STATUS_MAP.get(raw_status)
    if not provider_sid or not mapped:
        return {"status": "ignored", "reason": "unknown_status"}

    try:
        prior = supabase.table("guest_message_delivery_events").select(
            "guest_message_id, tenant_id"
        ).eq("provider_message_id", provider_sid).order(
            "created_at", desc=True
        ).limit(1).execute().data or []
        if not prior:
            return {"status": "ignored", "reason": "unknown_message"}
        supabase.table("guest_message_delivery_events").insert({
            "tenant_id": prior[0]["tenant_id"],
            "guest_message_id": prior[0]["guest_message_id"],
            "status": mapped,
            "provider_message_id": provider_sid,
            "error_code": error_code,
            "failure_reason": "provider_callback" if mapped in ("failed", "undelivered") else None,
        }).execute()
    except Exception as exc:  # noqa: BLE001
        logger.error("Twilio status handler error: %s", exc)
        return {"status": "error_logged"}

    return {"status": "ok"}
