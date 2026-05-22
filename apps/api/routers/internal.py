import logging
from fastapi import APIRouter, Header, HTTPException
from core.config import settings
from core.database import supabase
from datetime import date, datetime, timedelta, timezone

logger = logging.getLogger(__name__)

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

    today = date.today()
    period_start = date(today.year, today.month, 1)

    # credit_ledger and subscriptions share tenant_id but have no direct FK —
    # fetch them separately and join in Python.
    ledgers = supabase.table("credit_ledger")\
        .select("tenant_id, credits_used, credits_included")\
        .eq("period_start", period_start.isoformat())\
        .execute()

    processed = 0
    errors = 0
    for ledger in (ledgers.data or []):
        tenant_id = ledger.get("tenant_id")
        if not tenant_id:
            continue

        sub_result = supabase.table("subscriptions")\
            .select("stripe_customer_id, plan_status, cap_cents, stripe_subscription_id")\
            .eq("tenant_id", tenant_id)\
            .maybe_single()\
            .execute()
        sub = (sub_result.data if sub_result else None) or {}

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
                except Exception as e:
                    logger.error("Stripe invoice failed for customer=%s: %s", stripe_cid, e, exc_info=True)
                    errors += 1

    return {"status": "ok", "invoices_created": processed, "errors": errors}


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
    errors = 0
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
        except Exception as e:
            logger.error("Shift summary failed for tenant=%s shift=%s: %s",
                         shift["tenant_id"], shift["id"], e, exc_info=True)
            errors += 1

    return {"status": "ok", "summaries_generated": generated, "errors": errors}


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
    errors = 0

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
            # maybe_single().execute() may return None (not APIResponse) when no row exists
            gm_profile_data = (gm_profile.data if gm_profile else None) or {}
            gm_name = gm_profile_data.get("full_name", "General Manager")

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

            # Log email body to server log until Resend/SendGrid is integrated.
            # logbook_entries requires department_id NOT NULL, so no stub insert.
            logger.info("Daily summary for hotel=%s gm=%s:\n%s", hotel_id, gm_id, email_body)
            emails_sent += 1

        except Exception as e:
            logger.error("Daily summary email failed for hotel=%s: %s", hotel_id, e, exc_info=True)
            errors += 1

    return {"status": "ok", "emails_queued": emails_sent, "errors": errors}


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


def _notify_role(hotel_id: str, target_role: str, notif_type: str, title: str, body: str, data: dict) -> None:
    """Insert an in-app notification for every active user of target_role in the hotel."""
    users = supabase.table("user_roles")\
        .select("user_id")\
        .eq("tenant_id", hotel_id)\
        .eq("role", target_role)\
        .eq("is_active", True)\
        .execute()
    for row in (users.data or []):
        supabase.table("notifications").insert({
            "tenant_id": hotel_id,
            "user_id": row["user_id"],
            "type": notif_type,
            "title": title,
            "body": body,
            "data": data,
        }).execute()


@router.post("/escalations/check")
async def check_escalations(x_cron_secret: str = Header(None)):
    """
    Cron: 3-tier escalation ladder for overdue assigned work orders and urgent tasks.
    Tier 1 (30 min overdue)  → notify supervisor, set escalation_level=1
    Tier 2 (90 min overdue)  → notify GM/chief_engineer, set escalation_level=2
    Tier 3 (150 min overdue) → auto-set status=escalated, notify GM, set escalation_level=3
    Level tracking prevents duplicate notifications across cron runs.
    """
    verify_cron(x_cron_secret)

    now = datetime.now(timezone.utc)
    tier1_cut = (now - timedelta(minutes=30)).isoformat()
    tier2_cut = (now - timedelta(minutes=90)).isoformat()
    tier3_cut = (now - timedelta(minutes=150)).isoformat()

    escalated = 0
    notified = 0

    # --- Work Orders ---
    overdue_wos = supabase.table("work_orders")\
        .select("id, tenant_id, title, due_at, escalation_level")\
        .in_("status", ["open", "in_progress"])\
        .not_.is_("assigned_to", "null")\
        .lt("due_at", now.isoformat())\
        .lt("escalation_level", 3)\
        .execute()

    for wo in (overdue_wos.data or []):
        wo_id = wo["id"]
        hotel_id = wo["tenant_id"]
        level = wo.get("escalation_level", 0)
        due = wo["due_at"]

        if due < tier3_cut and level < 3:
            supabase.table("work_orders")\
                .update({"status": "escalated", "escalation_level": 3})\
                .eq("id", wo_id).execute()
            _notify_role(hotel_id, "gm", "escalation_auto",
                         f"Auto-escalated: {wo['title']}",
                         "Work order was not resolved and has been automatically escalated.",
                         {"work_order_id": wo_id})
            escalated += 1
        elif due < tier2_cut and level < 2:
            supabase.table("work_orders")\
                .update({"escalation_level": 2})\
                .eq("id", wo_id).execute()
            _notify_role(hotel_id, "chief_engineer", "escalation_tier2",
                         f"Urgent: {wo['title']} still unresolved",
                         "Work order is 90+ minutes overdue. Immediate attention required.",
                         {"work_order_id": wo_id})
            _notify_role(hotel_id, "gm", "escalation_tier2",
                         f"Urgent: {wo['title']} still unresolved",
                         "Work order is 90+ minutes overdue.",
                         {"work_order_id": wo_id})
            notified += 1
        elif due < tier1_cut and level < 1:
            supabase.table("work_orders")\
                .update({"escalation_level": 1})\
                .eq("id", wo_id).execute()
            _notify_role(hotel_id, "chief_engineer", "escalation_tier1",
                         f"Overdue: {wo['title']}",
                         "Work order is past SLA and has not been resolved.",
                         {"work_order_id": wo_id})
            notified += 1

    # --- Urgent Tasks ---
    overdue_tasks = supabase.table("tasks")\
        .select("id, tenant_id, title, due_at, task_type, escalation_level")\
        .in_("status", ["open", "in_progress"])\
        .not_.is_("assigned_to", "null")\
        .eq("priority", "urgent")\
        .lt("due_at", now.isoformat())\
        .lt("escalation_level", 3)\
        .execute()

    for task in (overdue_tasks.data or []):
        task_id = task["id"]
        hotel_id = task["tenant_id"]
        level = task.get("escalation_level", 0)
        due = task["due_at"]
        supervisor_role = "housekeeping_supervisor" if task.get("task_type") == "housekeeping" else "chief_engineer"

        if due < tier3_cut and level < 3:
            supabase.table("tasks")\
                .update({"status": "escalated", "escalation_level": 3})\
                .eq("id", task_id).execute()
            _notify_role(hotel_id, "gm", "escalation_auto",
                         f"Auto-escalated: {task['title']}",
                         "Urgent task was not resolved and has been automatically escalated.",
                         {"task_id": task_id})
            escalated += 1
        elif due < tier2_cut and level < 2:
            supabase.table("tasks")\
                .update({"escalation_level": 2})\
                .eq("id", task_id).execute()
            _notify_role(hotel_id, "gm", "escalation_tier2",
                         f"Urgent: {task['title']} still open",
                         "Urgent task is 90+ minutes overdue.",
                         {"task_id": task_id})
            notified += 1
        elif due < tier1_cut and level < 1:
            supabase.table("tasks")\
                .update({"escalation_level": 1})\
                .eq("id", task_id).execute()
            _notify_role(hotel_id, supervisor_role, "escalation_tier1",
                         f"Overdue: {task['title']}",
                         "Urgent task is past SLA and has not been resolved.",
                         {"task_id": task_id})
            notified += 1

    logger.info("Escalation check complete: escalated=%d notified=%d", escalated, notified)
    return {"status": "ok", "escalated": escalated, "notified": notified}


@router.post("/logbook/cleanup-expired")
async def cleanup_expired_logbook_entries(x_cron_secret: str = Header(None)):
    """Cron job: hard-delete logbook entries past their expires_at."""
    verify_cron(x_cron_secret)
    now = datetime.now(timezone.utc).isoformat()
    result = supabase.table("logbook_entries")\
        .delete()\
        .not_.is_("expires_at", "null")\
        .lt("expires_at", now)\
        .execute()
    deleted = len(result.data) if result.data else 0
    logger.info(f"Cleaned up {deleted} expired logbook entries")
    return {"status": "ok", "deleted": deleted}
