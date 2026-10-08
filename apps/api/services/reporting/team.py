"""Team (staff) metrics shared by the legacy staff-performance endpoint, the Team view,
the employee drawer and exports. Only staff in departments the viewer may see are returned."""
from __future__ import annotations

from typing import Optional

from services.reporting import data as report_data
from services.reporting.access import STAFF_ROLE_DEPARTMENT, effective_departments, staff_visible_to
from services.reporting.metrics import pct, work_order_sla_outcome
from services.reporting.periods import parse_timestamp


def _staff_row(profile: dict) -> dict:
    return {
        "user_id": profile["user_id"],
        "name": profile["name"],
        "role": profile["role"],
        "tasks_total": 0,
        "tasks_completed": 0,
        "tasks_sla_eligible": 0,
        "tasks_sla_met": 0,
        "wo_total": 0,
        "wo_completed": 0,
        "wo_sla_eligible": 0,
        "wo_sla_met": 0,
        "labor_hours": 0.0,
        "labor_tracked": 0,
    }


def _task_sla(task: dict) -> Optional[bool]:
    if task.get("status") != "completed":
        return None
    due, done = parse_timestamp(task.get("due_at")), parse_timestamp(task.get("completed_at"))
    if due is None or done is None:
        return None
    return done <= due


def build_staff_metrics(supabase, hotel_id: str, role: Optional[str], period, department: Optional[str] = None):
    """Per-employee metrics for staff visible to ``role``. Returns (metrics, truncated)."""
    departments = effective_departments(role, department)
    directory = {
        uid: p
        for uid, p in report_data.staff_directory(supabase, hotel_id).items()
        if staff_visible_to(role, p["role"])
        and STAFF_ROLE_DEPARTMENT.get(p["role"]) in departments
    }
    tasks, t1 = report_data.tasks_created(supabase, hotel_id, period)
    work_orders, t2 = report_data.work_orders_created(supabase, hotel_id, period)

    stats: dict[str, dict] = {}
    for task in tasks:
        uid = task.get("assigned_to")
        if uid not in directory:
            continue
        row = stats.setdefault(uid, _staff_row(directory[uid]))
        row["tasks_total"] += 1
        if task.get("status") == "completed":
            row["tasks_completed"] += 1
        outcome = _task_sla(task)
        if outcome is not None:
            row["tasks_sla_eligible"] += 1
            row["tasks_sla_met"] += 1 if outcome else 0
    for wo in work_orders:
        uid = wo.get("assigned_to")
        if uid not in directory:
            continue
        row = stats.setdefault(uid, _staff_row(directory[uid]))
        row["wo_total"] += 1
        if wo.get("status") == "completed":
            row["wo_completed"] += 1
            if wo.get("labor_hours") is not None:
                row["labor_hours"] += float(wo["labor_hours"])
                row["labor_tracked"] += 1
        outcome = work_order_sla_outcome(wo)
        if outcome is not None:
            row["wo_sla_eligible"] += 1
            row["wo_sla_met"] += 1 if outcome else 0

    metrics = []
    for uid, s in stats.items():
        eligible = s["tasks_sla_eligible"] + s["wo_sla_eligible"]
        met = s["tasks_sla_met"] + s["wo_sla_met"]
        volume = s["tasks_total"] + s["wo_total"]
        metrics.append({
            "user_id": uid,
            "name": s["name"],
            "role": s["role"],
            "department": STAFF_ROLE_DEPARTMENT.get(s["role"]),
            "tasks_completed": s["tasks_completed"],
            "tasks_total": s["tasks_total"],
            "wo_completed": s["wo_completed"],
            "wo_total": s["wo_total"],
            "sla_eligible": eligible,
            "sla_met": met,
            "sla_compliance_pct": pct(met, eligible),
            # None (not 0) when no labor was recorded; housekeeping task labor is untracked.
            "total_labor_hours": round(s["labor_hours"], 1) if s["labor_tracked"] else None,
            "labor_tracked_count": s["labor_tracked"],
            "open_assignments": (s["tasks_total"] - s["tasks_completed"]) + (s["wo_total"] - s["wo_completed"]),
            "low_sample": volume < 5,
        })
    metrics.sort(key=lambda m: (m["name"] or "").lower())  # alphabetical: never an output-count leaderboard
    return metrics, (t1 or t2)
