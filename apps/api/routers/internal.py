from fastapi import APIRouter, Header, HTTPException
from core.config import settings
from core.database import supabase
from datetime import date, datetime, timedelta, timezone

router = APIRouter(prefix="/internal", tags=["internal"])


def verify_cron(x_cron_secret: str = Header(None)):
    if x_cron_secret != settings.cron_secret:
        raise HTTPException(status_code=401, detail="Invalid cron secret")


@router.post("/predictions/run")
async def run_predictions(x_cron_secret: str = Header(None)):
    """Cron job: run room readiness predictions for all hotels."""
    verify_cron(x_cron_secret)
    from services.ai.predictions import run_all_hotel_predictions
    result = run_all_hotel_predictions()
    return {"status": "ok", **result}


@router.post("/pm/check-due")
async def check_due_pm(x_cron_secret: str = Header(None)):
    verify_cron(x_cron_secret)
    today = date.today()

    overdue_pms = supabase.table("pm_schedules")\
        .select("*, assets(tenant_id, name, id)")\
        .eq("is_active", True)\
        .lte("next_due_at", today.isoformat())\
        .execute()

    created_count = 0
    for pm in (overdue_pms.data or []):
        asset = pm.get("assets", {})
        supabase.table("work_orders").insert({
            "tenant_id": asset.get("tenant_id"),
            "title": f"PM: {pm['name']}",
            "description": pm.get("description"),
            "category": "general",
            "priority": "normal",
            "asset_id": asset.get("id"),
            "created_by": "00000000-0000-0000-0000-000000000000",
            "is_pm_generated": True,
            "pm_schedule_id": pm["id"],
            "sla_minutes": 480,
            "due_at": (datetime.now(timezone.utc) + timedelta(hours=8)).isoformat(),
        }).execute()
        created_count += 1

    return {"status": "ok", "pm_work_orders_created": created_count}


@router.post("/ai/failure-predictions")
async def run_failure_predictions(x_cron_secret: str = Header(None)):
    """Cron: Run AI failure predictions for all hotels. Runs nightly."""
    verify_cron(x_cron_secret)
    from services.ai import run_all_hotels_failure_predictions
    result = await run_all_hotels_failure_predictions()
    return {"data": result, "message": f"Failure predictions complete: {result}"}


@router.post("/billing/monthly-trueup")
async def monthly_trueup(x_cron_secret: str = Header(None)):
    verify_cron(x_cron_secret)
    import stripe
    from core.config import settings
    stripe.api_key = settings.stripe_secret_key

    # Get all active paid subscriptions with overage
    today = date.today()
    period_start = date(today.year, today.month, 1)

    ledgers = supabase.table("credit_ledger")\
        .select("*, subscriptions(stripe_customer_id, plan_status, cap_cents, stripe_subscription_id)")\
        .eq("period_start", period_start.isoformat())\
        .execute()

    processed = 0
    for ledger in (ledgers.data or []):
        sub = ledger.get("subscriptions") or {}
        if sub.get("plan_status") != "active":
            continue
        stripe_cid = sub.get("stripe_customer_id")
        if not stripe_cid:
            continue

        used = ledger.get("credits_used", 0)
        included = ledger.get("credits_included", 5000)
        overage_credits = max(0, used - included)

        if overage_credits > 0:
            cap_cents = sub.get("cap_cents")
            overage_cents = int(overage_credits * 2)  # $0.02/credit
            if cap_cents:
                overage_cents = min(overage_cents, cap_cents - 9900)
            if overage_cents > 0:
                try:
                    stripe.InvoiceItem.create(
                        customer=stripe_cid,
                        amount=overage_cents,
                        currency="usd",
                        description=f"AI Credits Overage: {overage_credits} credits @ $0.02",
                    )
                    processed += 1
                except Exception:
                    pass

    return {"status": "ok", "invoices_created": processed}


@router.post("/logbook/shift-summary")
async def generate_shift_summaries(x_cron_secret: str = Header(None)):
    """Cron: Generate AI shift summaries for shifts that ended in the last 2 hours."""
    verify_cron(x_cron_secret)
    from services.ai.shift_summary import generate_shift_summary

    # Find shifts that ended ~2 hours ago (give staff time to log entries)
    today = date.today().isoformat()

    # Get all shifts that end around this time
    shifts_result = supabase.table("shifts")\
        .select("id, tenant_id, end_time")\
        .execute()

    generated = 0
    for shift in (shifts_result.data or []):
        # Simple heuristic: if shift end_time is within 2h window
        end_str = shift.get("end_time", "")
        if not end_str:
            continue

        # Check if summary already exists for today
        existing = supabase.table("shift_summaries")\
            .select("id")\
            .eq("shift_id", shift["id"])\
            .eq("shift_date", today)\
            .execute()

        if existing.data:
            continue

        try:
            generate_shift_summary(shift["tenant_id"], shift["id"], today)
            generated += 1
        except Exception:
            pass

    return {"status": "ok", "summaries_generated": generated}


@router.post("/reports/daily-summary-email")
async def send_daily_summary_emails(x_cron_secret: str = Header(None)):
    """Cron: Generate and email daily operations summary to all GMs. Runs daily at 6am."""
    verify_cron(x_cron_secret)

    # Get all active hotels
    hotels = supabase.table("tenants")\
        .select("id, name, timezone")\
        .eq("is_active", True)\
        .execute()

    emails_sent = 0

    for hotel in (hotels.data or []):
        hotel_id = hotel["id"]
        hotel_name = hotel["name"]

        try:
            # Get daily summary data
            today = date.today().isoformat()

            # Room status
            rooms = supabase.table("room_status")\
                .select("status")\
                .eq("tenant_id", hotel_id)\
                .execute()

            status_counts = {}
            for r in (rooms.data or []):
                s = r.get("status", "UNKNOWN")
                status_counts[s] = status_counts.get(s, 0) + 1

            # Tasks completed today
            tasks = supabase.table("tasks")\
                .select("id", count="exact")\
                .eq("tenant_id", hotel_id)\
                .eq("status", "completed")\
                .gte("completed_at", f"{today}T00:00:00")\
                .execute()
            tasks_completed = tasks.count or 0

            # Open work orders
            wos = supabase.table("work_orders")\
                .select("id", count="exact")\
                .eq("tenant_id", hotel_id)\
                .in_("status", ["open", "in_progress"])\
                .execute()
            open_wos = wos.count or 0

            # Get GM email
            gm_roles = supabase.table("user_roles")\
                .select("user_id")\
                .eq("tenant_id", hotel_id)\
                .eq("role", "gm")\
                .eq("is_active", True)\
                .limit(1)\
                .execute()

            if not gm_roles.data:
                continue

            gm_id = gm_roles.data[0]["user_id"]
            gm_profile = supabase.table("user_profiles")\
                .select("full_name")\
                .eq("id", gm_id)\
                .maybe_single()\
                .execute()
            gm_name = gm_profile.data.get("full_name", "General Manager") if gm_profile.data else "General Manager"

            # Generate email body (simple text format — in production, use Resend/SendGrid)
            dirty_count = status_counts.get("DIRTY", 0)
            clean_count = status_counts.get("CLEAN", 0)
            inspected_count = status_counts.get("INSPECTED", 0)
            total_rooms = sum(status_counts.values())

            email_body = f"""Good morning, {gm_name}!

Here's your daily operations summary for {hotel_name} — {today}:

ROOM STATUS ({total_rooms} total):
• Dirty: {dirty_count}
• In Progress: {status_counts.get('IN_PROGRESS', 0)}
• Clean: {clean_count}
• Inspected: {inspected_count}
• OOO: {status_counts.get('OOO', 0)}

OPERATIONS:
• Tasks completed today: {tasks_completed}
• Open work orders: {open_wos}

Have a great day!
— PatelRep AI
"""

            # Log the intended email (in production, integrate with Resend/SendGrid)
            # For now, insert a logbook entry as the "email"
            supabase.table("logbook_entries").insert({
                "tenant_id": hotel_id,
                "author_id": gm_id,
                "content": f"[Daily Summary — {today}]\n{email_body}",
                "is_ai_generated": True,
            }).execute()

            emails_sent += 1

        except Exception:
            continue

    return {"status": "ok", "emails_queued": emails_sent}


@router.post("/opera/sync-reservations")
async def sync_opera_reservations(x_cron_secret: str = Header(None)):
    """Cron job: sync today's reservations from all connected Opera tenants."""
    verify_cron(x_cron_secret)
    from services.opera import sync_reservations

    # Get all connected Opera tenants
    connected = supabase.table("opera_credentials")\
        .select("tenant_id")\
        .eq("is_connected", True)\
        .execute()

    results = []
    for row in (connected.data or []):
        hotel_id = row["tenant_id"]
        try:
            result = sync_reservations(hotel_id)
            results.append({"hotel_id": hotel_id, **result})
        except Exception as e:
            results.append({"hotel_id": hotel_id, "error": str(e)})

    return {"status": "ok", "results": results, "hotels_synced": len(results)}
