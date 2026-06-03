from fastapi import APIRouter, Depends, Query
from typing import Optional
from datetime import date, timedelta
from middleware.auth import require_role, CurrentUser
from core.database import supabase

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/daily-summary")
async def get_daily_summary(
    report_date: Optional[date] = Query(None, alias="date"),
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor", "chief_engineer"))
):
    """Return a daily operational summary: room statuses, task completion, open WOs."""
    target_date = report_date or date.today()

    # Room status breakdown
    room_statuses = supabase.table("room_status")\
        .select("status")\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()

    status_counts: dict = {}
    for r in (room_statuses.data or []):
        s = r.get("status", "UNKNOWN")
        status_counts[s] = status_counts.get(s, 0) + 1

    # Tasks completed today
    completed_tasks = supabase.table("tasks")\
        .select("id", count="exact")\
        .eq("tenant_id", current_user.hotel_id)\
        .eq("status", "completed")\
        .gte("completed_at", target_date.isoformat())\
        .lt("completed_at", (target_date + timedelta(days=1)).isoformat())\
        .execute()

    # Open work orders
    open_work_orders = supabase.table("work_orders")\
        .select("id", count="exact")\
        .eq("tenant_id", current_user.hotel_id)\
        .in_("status", ["open", "in_progress"])\
        .execute()

    return {
        "data": {
            "date": target_date.isoformat(),
            "room_status_breakdown": status_counts,
            "tasks_completed_today": completed_tasks.count or 0,
            "open_work_orders": open_work_orders.count or 0,
        }
    }


@router.get("/staff-performance")
async def get_staff_performance(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    format: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(require_role("gm", "housekeeping_supervisor", "chief_engineer"))
):
    """Return staff performance metrics for a date range."""
    today = date.today()
    s = start_date or (today - timedelta(days=30))
    e = end_date or today

    s_str = s.isoformat()
    e_str = e.isoformat()

    # Tasks completed per staff member in period
    tasks_result = supabase.table("tasks")\
        .select("assigned_to, status, completed_at, due_at, sla_minutes")\
        .eq("tenant_id", current_user.hotel_id)\
        .gte("created_at", s_str)\
        .lte("created_at", e_str)\
        .execute()

    # Work orders completed per engineer in period
    wo_result = supabase.table("work_orders")\
        .select("assigned_to, status, completed_at, due_at, sla_minutes, labor_hours")\
        .eq("tenant_id", current_user.hotel_id)\
        .gte("created_at", s_str)\
        .lte("created_at", e_str)\
        .execute()

    # User profiles for name lookup (user_profiles uses tenant_id, no role column)
    profiles_result = supabase.table("user_profiles")\
        .select("id, full_name, preferred_name")\
        .eq("tenant_id", current_user.hotel_id)\
        .execute()

    # Roles lookup from user_roles
    roles_result = supabase.table("user_roles")\
        .select("user_id, role")\
        .eq("tenant_id", current_user.hotel_id)\
        .eq("is_active", True)\
        .execute()

    role_map = {r["user_id"]: r["role"] for r in (roles_result.data or [])}
    profile_map = {p["id"]: {**p, "role": role_map.get(p["id"], "")} for p in (profiles_result.data or [])}

    # Aggregate per staff
    staff_stats: dict = {}

    for task in (tasks_result.data or []):
        uid = task.get("assigned_to")
        if not uid:
            continue
        if uid not in staff_stats:
            staff_stats[uid] = {
                "user_id": uid,
                "name": profile_map.get(uid, {}).get("preferred_name") or profile_map.get(uid, {}).get("full_name", "Unknown"),
                "role": profile_map.get(uid, {}).get("role", ""),
                "tasks_total": 0,
                "tasks_completed": 0,
                "tasks_sla_met": 0,
                "wo_total": 0,
                "wo_completed": 0,
                "wo_sla_met": 0,
                "total_labor_hours": 0.0,
            }
        stats = staff_stats[uid]
        stats["tasks_total"] += 1
        if task.get("status") == "completed":
            stats["tasks_completed"] += 1
            # SLA check: completed_at <= due_at
            completed = task.get("completed_at")
            due = task.get("due_at")
            if completed and due and completed <= due:
                stats["tasks_sla_met"] += 1

    for wo in (wo_result.data or []):
        uid = wo.get("assigned_to")
        if not uid:
            continue
        if uid not in staff_stats:
            staff_stats[uid] = {
                "user_id": uid,
                "name": profile_map.get(uid, {}).get("preferred_name") or profile_map.get(uid, {}).get("full_name", "Unknown"),
                "role": profile_map.get(uid, {}).get("role", ""),
                "tasks_total": 0,
                "tasks_completed": 0,
                "tasks_sla_met": 0,
                "wo_total": 0,
                "wo_completed": 0,
                "wo_sla_met": 0,
                "total_labor_hours": 0.0,
            }
        stats = staff_stats[uid]
        stats["wo_total"] += 1
        if wo.get("status") == "completed":
            stats["wo_completed"] += 1
            stats["total_labor_hours"] += float(wo.get("labor_hours") or 0)
            completed = wo.get("completed_at")
            due = wo.get("due_at")
            if completed and due and completed <= due:
                stats["wo_sla_met"] += 1

    # Build response with computed percentages
    metrics = []
    for uid, s_data in staff_stats.items():
        completed_items = s_data["tasks_completed"] + s_data["wo_completed"]
        sla_items = s_data["tasks_sla_met"] + s_data["wo_sla_met"]
        sla_pct = round((sla_items / completed_items * 100) if completed_items > 0 else 0, 1)
        metrics.append({
            "user_id": uid,
            "name": s_data["name"],
            "role": s_data["role"],
            "tasks_completed": s_data["tasks_completed"],
            "tasks_total": s_data["tasks_total"],
            "wo_completed": s_data["wo_completed"],
            "wo_total": s_data["wo_total"],
            "sla_compliance_pct": sla_pct,
            "total_labor_hours": round(s_data["total_labor_hours"], 1),
        })

    # Sort by total completed desc
    metrics.sort(key=lambda x: x["tasks_completed"] + x["wo_completed"], reverse=True)

    if format == "csv":
        import csv
        import io
        from fastapi.responses import StreamingResponse
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=[
            "name", "role", "tasks_completed", "tasks_total",
            "wo_completed", "wo_total", "sla_compliance_pct", "total_labor_hours"
        ])
        writer.writeheader()
        for m in metrics:
            writer.writerow({k: m.get(k, "") for k in writer.fieldnames})
        output.seek(0)
        filename = f"staff-performance-{s_str}-to-{e_str}.csv"
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )

    return {
        "data": {
            "period": {"start": s_str, "end": e_str},
            "metrics": metrics,
            "total_staff": len(metrics),
        }
    }


@router.get("/maintenance")
async def get_maintenance_report(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    current_user: CurrentUser = Depends(require_role("gm", "chief_engineer"))
):
    """Return work order KPIs for a date range."""
    today = date.today()
    s = start_date or (today - timedelta(days=30))
    e = end_date or today
    s_str = s.isoformat()
    e_str = e.isoformat()

    wo_result = supabase.table("work_orders")\
        .select("category, priority, status, due_at, started_at, completed_at, labor_hours, sla_minutes, created_at, guest_reported")\
        .eq("tenant_id", current_user.hotel_id)\
        .gte("created_at", s_str)\
        .lte("created_at", e_str)\
        .execute()

    work_orders = wo_result.data or []

    # Category breakdown
    category_counts: dict = {}
    for wo in work_orders:
        cat = wo.get("category", "general")
        category_counts[cat] = category_counts.get(cat, 0) + 1

    # SLA compliance (for completed WOs)
    completed = [wo for wo in work_orders if wo.get("status") == "completed"]
    sla_met = sum(
        1 for wo in completed
        if wo.get("completed_at") and wo.get("due_at")
        and wo["completed_at"] <= wo["due_at"]
    )
    sla_pct = round((sla_met / len(completed) * 100) if completed else 0, 1)

    # Avg resolution time (in hours)
    resolution_times = []
    for wo in completed:
        if wo.get("completed_at") and wo.get("created_at"):
            try:
                from datetime import datetime as dt
                created = dt.fromisoformat(str(wo["created_at"]).replace("Z", "+00:00"))
                done = dt.fromisoformat(str(wo["completed_at"]).replace("Z", "+00:00"))
                hours = (done - created).total_seconds() / 3600
                resolution_times.append(hours)
            except Exception:
                pass

    avg_resolution_hours = round(sum(resolution_times) / len(resolution_times), 1) if resolution_times else 0
    total_labor_hours = sum(float(wo.get("labor_hours") or 0) for wo in completed)

    # Avg response time: created_at → started_at (time to claim)
    response_times = []
    for wo in work_orders:
        if wo.get("started_at") and wo.get("created_at"):
            try:
                from datetime import datetime as dt
                created = dt.fromisoformat(str(wo["created_at"]).replace("Z", "+00:00"))
                started = dt.fromisoformat(str(wo["started_at"]).replace("Z", "+00:00"))
                response_times.append((started - created).total_seconds() / 3600)
            except Exception:
                pass
    avg_response_hours = round(sum(response_times) / len(response_times), 1) if response_times else 0

    # Avg repair time: started_at → completed_at (time actively working)
    repair_times = []
    for wo in completed:
        if wo.get("started_at") and wo.get("completed_at"):
            try:
                from datetime import datetime as dt
                started = dt.fromisoformat(str(wo["started_at"]).replace("Z", "+00:00"))
                done = dt.fromisoformat(str(wo["completed_at"]).replace("Z", "+00:00"))
                repair_times.append((done - started).total_seconds() / 3600)
            except Exception:
                pass
    avg_repair_hours = round(sum(repair_times) / len(repair_times), 1) if repair_times else 0

    guest_reported_count = sum(1 for wo in work_orders if wo.get("guest_reported"))

    # Priority breakdown
    priority_counts: dict = {"urgent": 0, "normal": 0, "low": 0}
    for wo in work_orders:
        p = wo.get("priority", "normal")
        priority_counts[p] = priority_counts.get(p, 0) + 1

    # Open SLA breaches (open/in_progress WOs past their due_at)
    from datetime import datetime as dt
    now_str = dt.utcnow().isoformat()
    sla_breaches = sum(
        1 for wo in work_orders
        if wo.get("status") in ("open", "in_progress")
        and wo.get("due_at") and wo["due_at"] < now_str
    )

    return {
        "data": {
            "period": {"start": s_str, "end": e_str},
            "total_work_orders": len(work_orders),
            "completed": len(completed),
            "completion_rate_pct": round((len(completed) / len(work_orders) * 100) if work_orders else 0, 1),
            "sla_compliance_pct": sla_pct,
            "avg_resolution_hours": avg_resolution_hours,
            "total_labor_hours": round(total_labor_hours, 1),
            "active_sla_breaches": sla_breaches,
            "avg_response_hours": avg_response_hours,
            "avg_repair_hours": avg_repair_hours,
            "guest_reported_count": guest_reported_count,
            "by_category": category_counts,
            "by_priority": priority_counts,
        }
    }


@router.get("/ai-usage")
async def get_ai_usage_report(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    format: Optional[str] = Query(None),
    current_user: CurrentUser = Depends(require_role("gm"))
):
    """Return AI credit consumption and interaction breakdown."""
    today = date.today()
    s = start_date or date(today.year, today.month, 1)
    e = end_date or today

    result = supabase.table("ai_interactions")\
        .select("interaction_type, credits_charged, model_used, success")\
        .eq("tenant_id", current_user.hotel_id)\
        .gte("created_at", s.isoformat())\
        .lte("created_at", e.isoformat())\
        .execute()

    interactions = result.data or []
    total_credits = sum(i.get("credits_charged", 0) for i in interactions)

    breakdown: dict = {}
    for i in interactions:
        t = i.get("interaction_type", "unknown")
        breakdown[t] = breakdown.get(t, 0) + i.get("credits_charged", 0)

    if format == "csv":
        import csv
        import io
        from fastapi.responses import StreamingResponse
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=["interaction_type", "credits"])
        writer.writeheader()
        for interaction_type, credits in breakdown.items():
            writer.writerow({"interaction_type": interaction_type, "credits": credits})
        output.seek(0)
        filename = f"ai-usage-{s.isoformat()}-to-{e.isoformat()}.csv"
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )

    return {
        "data": {
            "period": {"start": s.isoformat(), "end": e.isoformat()},
            "total_credits_used": total_credits,
            "total_interactions": len(interactions),
            "breakdown_by_type": breakdown,
        }
    }
