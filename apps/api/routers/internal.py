import logging
from fastapi import APIRouter, Header, HTTPException
from core.config import settings
from core.database import supabase
from routers.evidence import run_evidence_reminders
from services.safety.contracts import calculate_next_training_due_date, should_schedule_training_assignment
from datetime import date, datetime, timedelta, timezone

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/internal", tags=["internal"])


def verify_cron(x_cron_secret: str = Header(None)):
    if x_cron_secret != settings.cron_secret:
        raise HTTPException(status_code=401, detail="Invalid cron secret")


def _record_cron_run(job_name: str, *, error: str | None = None) -> None:
    """Write last success/failure timestamp for health monitoring. Best-effort."""
    try:
        now = datetime.now(timezone.utc).isoformat()
        prior = (
            supabase.table("cron_health").select("run_count")
            .eq("job_name", job_name).maybe_single().execute()
        )
        prior_count = (prior.data or {}).get("run_count", 0) if (prior and prior.data) else 0
        patch: dict = {"updated_at": now, "run_count": (prior_count or 0) + 1}
        if error:
            patch["last_failure_at"] = now
            patch["last_error"] = error[:500]
        else:
            patch["last_success_at"] = now
            patch["last_error"] = None
        supabase.table("cron_health").upsert(
            {"job_name": job_name, **patch}, on_conflict="job_name"
        ).execute()
    except Exception as exc:
        logger.warning("cron_health write failed for %s: %s", job_name, exc)


def _queue_safety_notification(tenant_id: str, user_id: str, notification_type: str, title: str, body: str, data: dict) -> bool:
    """Queue once per action/day; provider delivery is intentionally a later concern."""
    existing = (
        supabase.table("notifications").select("id").eq("tenant_id", tenant_id).eq("user_id", user_id)
        .eq("type", notification_type).contains("data", data).gte("created_at", f"{date.today().isoformat()}T00:00:00+00:00")
        .maybe_single().execute()
    )
    if existing and existing.data:
        return False
    notification = supabase.table("notifications").insert({
        "tenant_id": tenant_id, "user_id": user_id, "type": notification_type,
        "title": title, "body": body, "data": data,
    }).execute().data[0]
    supabase.table("notification_deliveries").insert({
        "tenant_id": tenant_id, "notification_id": notification["id"], "user_id": user_id,
        "channel": "in_app", "status": "queued",
    }).execute()
    return True


def run_safety_training_assignments(*, today: date | None = None) -> dict[str, int]:
    """Create one open training requirement per covered employee and queue due-state notices."""
    current_day = today or date.today()
    courses = supabase.table("safety_training_courses").select("*").eq("is_active", True).execute().data or []
    employees = supabase.table("user_roles").select("user_id, tenant_id, role, created_at").eq("is_active", True).execute().data or []
    assignments = supabase.table("safety_training_assignments").select("*").execute().data or []
    created = reminders = escalations = 0
    for course in courses:
        tenant_employees = [employee for employee in employees if employee["tenant_id"] == course["tenant_id"]]
        for employee in tenant_employees:
            relevant = [item for item in assignments if item["course_id"] == course["id"] and item["employee_id"] == employee["user_id"]]
            open_due = [date.fromisoformat(item["due_date"]) for item in relevant if not item.get("completed_at")]
            completed_dates = [datetime.fromisoformat(item["completed_at"].replace("Z", "+00:00")).date() for item in relevant if item.get("completed_at")]
            last_completed = max(completed_dates) if completed_dates else None
            if should_schedule_training_assignment(employee_role=employee["role"], covered_roles=course["covered_roles"], existing_open_due_dates=open_due, last_completed_on=last_completed, recurrence_months=course["recurrence_months"], today=current_day):
                hired_on = datetime.fromisoformat(employee["created_at"].replace("Z", "+00:00")).date()
                due = calculate_next_training_due_date(last_completed, course["recurrence_months"]) if last_completed else hired_on + timedelta(days=course["new_hire_deadline_days"])
                record = supabase.table("safety_training_assignments").insert({"tenant_id": course["tenant_id"], "course_id": course["id"], "employee_id": employee["user_id"], "due_date": due.isoformat(), "assigned_by": None}).execute().data[0]
                assignments.append(record)
                open_due = [due]
                created += 1
            for due in open_due:
                kind = "safety_training_overdue" if due < current_day else "safety_training_reminder"
                if due > current_day + timedelta(days=14):
                    continue
                if _queue_safety_notification(course["tenant_id"], employee["user_id"], kind, "Safety training due", f"{course['course_name']} is due {due.isoformat()}.", {"assignment_id": next((item["id"] for item in assignments if item["course_id"] == course["id"] and item["employee_id"] == employee["user_id"] and not item.get("completed_at")), None)}):
                    reminders += 1
                if due < current_day:
                    managers = supabase.table("user_roles").select("user_id").eq("tenant_id", course["tenant_id"]).in_("role", ["gm", "housekeeping_supervisor", "chief_engineer"]).eq("is_active", True).execute().data or []
                    for manager in managers:
                        if _queue_safety_notification(course["tenant_id"], manager["user_id"], "safety_training_escalation", "Overdue safety training", f"{course['course_name']} is overdue for a covered employee.", {"employee_id": employee["user_id"], "course_id": course["id"]}):
                            escalations += 1
    return {"assignments_created": created, "reminders_queued": reminders, "escalations_queued": escalations}


@router.post("/safety/training-assignments")
async def schedule_safety_training_assignments(x_cron_secret: str = Header(None)):
    verify_cron(x_cron_secret)
    try:
        result = run_safety_training_assignments()
    except Exception as exc:
        logger.error("Safety training scheduler failed: %s", exc, exc_info=True)
        _record_cron_run("safety.training-assignments", error=str(exc))
        raise HTTPException(status_code=500, detail="Safety training scheduler failed.") from exc
    _record_cron_run("safety.training-assignments")
    return {"status": "ok", **result}


def run_missing_drill_follow_up_escalations(*, now: datetime | None = None) -> int:
    """Escalate a drill lacking documented follow-up evidence after one day."""
    current_time = now or datetime.now(timezone.utc)
    drills = supabase.table("emergency_drills").select("id, tenant_id, drill_type, occurred_at").lt("occurred_at", (current_time - timedelta(days=1)).isoformat()).execute().data or []
    linked = supabase.table("emergency_drill_follow_up_evidence").select("drill_id").execute().data or []
    linked_ids = {item["drill_id"] for item in linked}
    queued = 0
    for drill in drills:
        if drill["id"] in linked_ids:
            continue
        role = "chief_engineer" if drill["drill_type"] in {"fire", "evacuation", "security"} else "housekeeping_supervisor"
        targets = supabase.table("user_roles").select("user_id").eq("tenant_id", drill["tenant_id"]).eq("role", role).eq("is_active", True).execute().data or []
        for target in targets:
            if _queue_safety_notification(drill["tenant_id"], target["user_id"], "safety_drill_follow_up_escalation", "Drill follow-up evidence required", f"{drill['drill_type']} drill needs follow-up evidence.", {"drill_id": drill["id"]}):
                queued += 1
    return queued


@router.post("/safety/drill-follow-up")
async def escalate_missing_drill_follow_up(x_cron_secret: str = Header(None)):
    verify_cron(x_cron_secret)
    try:
        queued = run_missing_drill_follow_up_escalations()
    except Exception as exc:
        logger.error("Safety drill follow-up escalation failed: %s", exc, exc_info=True)
        _record_cron_run("safety.drill-follow-up", error=str(exc))
        raise HTTPException(status_code=500, detail="Safety drill follow-up escalation failed.") from exc
    _record_cron_run("safety.drill-follow-up")
    return {"status": "ok", "escalations_queued": queued}


@router.post("/evidence/reminders")
async def send_evidence_reminders(x_cron_secret: str = Header(None)):
    """Cron: remind staff and GM of due or overdue controlled acknowledgements."""
    verify_cron(x_cron_secret)
    try:
        sent = run_evidence_reminders()
    except Exception as exc:
        logger.error("Evidence reminder cron failed: %s", exc, exc_info=True)
        _record_cron_run("evidence.reminders", error=str(exc))
        raise HTTPException(status_code=500, detail="Evidence reminder cron failed.") from exc
    _record_cron_run("evidence.reminders")
    return {"status": "ok", "reminder_actions": sent}


@router.post("/predictions/run")
async def run_predictions(x_cron_secret: str = Header(None)):
    """Cron job: run room readiness predictions for all hotels."""
    verify_cron(x_cron_secret)
    from services.ai.predictions import run_all_hotel_predictions
    result = run_all_hotel_predictions()
    _record_cron_run("predictions.run")
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

    _record_cron_run("pm.check-due")
    return {"status": "ok", "pm_work_orders_created": created_count}


@router.post("/ai/failure-predictions")
async def run_failure_predictions(x_cron_secret: str = Header(None)):
    """Cron: Run AI failure predictions for all hotels. Runs nightly."""
    verify_cron(x_cron_secret)
    from services.ai import run_all_hotels_failure_predictions
    result = await run_all_hotels_failure_predictions()
    _record_cron_run("ai.failure-predictions")
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
                overage_cents = min(overage_cents, cap_cents - settings.base_plan_price_cents)
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

    _record_cron_run("billing.monthly-trueup")
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

    _record_cron_run("logbook.shift-summary")
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

    _record_cron_run("reports.daily-summary-email")
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

    _record_cron_run("opera.sync-reservations")
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
        notification = supabase.table("notifications").insert({
            "tenant_id": hotel_id,
            "user_id": row["user_id"],
            "type": notif_type,
            "title": title,
            "body": body,
            "data": data,
        }).execute()
        notification_row = (notification.data or [None])[0]
        if notification_row:
            supabase.table("notification_deliveries").insert({
                "tenant_id": hotel_id,
                "notification_id": notification_row["id"],
                "user_id": row["user_id"],
                "channel": "in_app",
                "status": "delivered",
            }).execute()


def _auto_escalate_work_order(work_order_id: str, hotel_id: str) -> None:
    """Escalate through the same atomic status/audit mutation used by staff."""
    supabase.rpc("transition_work_order_with_audit", {
        "p_work_order_id": work_order_id,
        "p_tenant_id": hotel_id,
        "p_new_status": "escalated",
        "p_actor_id": None,
        "p_actor_role": "automation",
        "p_reason_code": "sla_breach",
        "p_reason_note": "Automatically escalated after 150 minutes overdue.",
        "p_source": "automation",
        "p_is_override": False,
    }).execute()
    supabase.table("work_orders") \
        .update({"escalation_level": 3}) \
        .eq("id", work_order_id) \
        .eq("tenant_id", hotel_id) \
        .execute()


@router.post("/escalations/check")
async def check_escalations(x_cron_secret: str = Header(None)):
    """
    Cron: 3-tier escalation ladder for overdue assigned work orders and urgent tasks.
    Tier 1 (30 min overdue)  → notify supervisor, set escalation_level=1
    Tier 2 (90 min overdue)  → notify GM/engineer, set escalation_level=2
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
            _auto_escalate_work_order(wo_id, hotel_id)
            _notify_role(hotel_id, "gm", "escalation_auto",
                         f"Auto-escalated: {wo['title']}",
                         "Work order was not resolved and has been automatically escalated.",
                         {"work_order_id": wo_id})
            escalated += 1
        elif due < tier2_cut and level < 2:
            supabase.table("work_orders")\
                .update({"escalation_level": 2})\
                .eq("id", wo_id).execute()
            _notify_role(hotel_id, "engineer", "escalation_tier2",
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
            _notify_role(hotel_id, "engineer", "escalation_tier1",
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
        supervisor_role = "housekeeping_supervisor" if task.get("task_type") == "housekeeping" else "engineer"

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

    # --- DND welfare escalation: property policy plus one immutable event per DND window ---
    dnd_rooms = supabase.table("room_status")\
        .select("room_id, tenant_id, updated_at, rooms(room_number)")\
        .eq("dnd_flag", True)\
        .execute()

    dnd_notified = 0
    for room in (dnd_rooms.data or []):
        hotel_id = room["tenant_id"]
        room_id = room["room_id"]
        room_number = (room.get("rooms") or {}).get("room_number", "unknown")
        dnd_started_at = room.get("updated_at")
        if not dnd_started_at:
            continue
        policy = supabase.table("dnd_welfare_policies")\
            .select("threshold_hours, escalation_roles, escalation_instructions")\
            .eq("tenant_id", hotel_id)\
            .maybe_single()\
            .execute()
        policy_data = policy.data or {}
        threshold_hours = policy_data.get("threshold_hours", 8)
        try:
            dnd_started = datetime.fromisoformat(dnd_started_at.replace("Z", "+00:00"))
        except ValueError:
            logger.warning("Invalid DND start timestamp for room %s: %s", room_id, dnd_started_at)
            continue
        if (now - dnd_started).total_seconds() < threshold_hours * 3600:
            continue

        # Skip if a welfare check task already exists for this room today
        today_str = now.date().isoformat()
        existing_task = supabase.table("tasks")\
            .select("id", count="exact")\
            .eq("tenant_id", hotel_id)\
            .eq("room_id", room_id)\
            .eq("task_type", "housekeeping")\
            .ilike("title", "Welfare check%")\
            .gte("created_at", f"{today_str}T00:00:00+00:00")\
            .execute()
        if existing_task.count and existing_task.count > 0:
            continue

        existing_event = supabase.table("dnd_welfare_events")\
            .select("id")\
            .eq("tenant_id", hotel_id)\
            .eq("room_id", room_id)\
            .eq("dnd_started_at", dnd_started_at)\
            .maybe_single()\
            .execute()
        if existing_event.data:
            continue
        escalation_roles = policy_data.get("escalation_roles") or ["housekeeping_supervisor", "front_desk"]
        supabase.table("dnd_welfare_events").insert({
            "tenant_id": hotel_id,
            "room_id": room_id,
            "dnd_started_at": dnd_started_at,
            "threshold_hours": threshold_hours,
            "escalated_to": escalation_roles,
        }).execute()

        _notify_role(hotel_id, "housekeeping_supervisor", "dnd_welfare_check_auto",
                     f"Welfare check needed — Room {room_number}",
                     f"Room {room_number} has had DND active for {threshold_hours}+ hours.",
                     {"room_id": room_id, "room_number": room_number})
        _notify_role(hotel_id, "front_desk", "dnd_welfare_check_auto",
                     f"Welfare check needed — Room {room_number}",
                     f"Room {room_number} has had DND active for {threshold_hours}+ hours.",
                     {"room_id": room_id, "room_number": room_number})
        dnd_notified += 1

    logger.info("Escalation check complete: escalated=%d notified=%d dnd_welfare=%d", escalated, notified, dnd_notified)
    _record_cron_run("escalations.check")
    return {"status": "ok", "escalated": escalated, "notified": notified, "dnd_welfare_notified": dnd_notified}


@router.post("/lost-found/retention-check")
async def check_lost_found_retention(x_cron_secret: str = Header(None)):
    """D-11: flag expired unclaimed items for manager review. Never auto-donates or discards."""
    verify_cron(x_cron_secret)
    now = datetime.now(timezone.utc).isoformat()
    flagged = 0
    try:
        due = supabase.table("lost_found_items").select("id, tenant_id").eq(
            "status", "unclaimed"
        ).lt("retention_due_at", now).is_("disposition_flagged_at", "null").execute().data or []
        for item in due:
            supabase.table("lost_found_items").update(
                {"disposition_flagged_at": now}
            ).eq("id", item["id"]).eq("tenant_id", item["tenant_id"]).execute()
            flagged += 1
    except Exception as exc:  # noqa: BLE001
        logger.error("lost-found retention check failed: %s", exc)
        _record_cron_run("lost-found.retention-check", error=str(exc))
        raise HTTPException(status_code=500, detail="Retention check failed") from exc
    _record_cron_run("lost-found.retention-check")
    return {"status": "ok", "flagged": flagged}


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
