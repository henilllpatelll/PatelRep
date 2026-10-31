"""Small shared helpers for the availability, time-off and shift-swap routers (Team Scheduling Phase 5).

Privacy is decided here once: `person()` is the ONLY shape of another employee these routers expose (id, display name,
primary role) -- never an email, phone, note, reason or availability.
"""
from __future__ import annotations

from datetime import datetime
from typing import Iterable, Optional

from core.database import supabase
from middleware.auth import CurrentUser
from services.scheduling_access import Departments, StaffMember, err, load_names, manager_scope


def person(hotel_id: str, user_ids: Iterable[str], staff: Optional[dict[str, StaffMember]] = None) -> dict[str, dict]:
    ids = sorted({str(u) for u in user_ids if u})
    names = load_names(ids)
    out = {}
    for uid in ids:
        member = (staff or {}).get(uid)
        out[uid] = {"id": uid, "name": names.get(uid, "") or None, "role": member.roles[0] if member and member.roles else None}
    return out


def in_manager_scope(current_user: CurrentUser, department_id: Optional[str], departments: Departments) -> bool:
    """True when the caller's role covers `department_id` (gm: every department). An unknown department is not in scope."""
    scope = manager_scope(current_user)
    if scope is None:
        return True
    return department_id is not None and departments.code_by_id.get(str(department_id)) in scope


def not_found(kind: str, code: str) -> Exception:
    """Somebody else's record and a missing record look identical on purpose."""
    return err(404, code, f"{kind} not found")


def shift_brief(row: dict) -> dict:
    return {
        "id": row.get("id"), "work_date": str(row.get("work_date"))[:10], "shift_name": row.get("shift_name"),
        "start_time": row.get("start_time"), "end_time": row.get("end_time"), "starts_at": row.get("starts_at"),
        "ends_at": row.get("ends_at"), "version": row.get("version"), "department_id": row.get("department_id"),
        "user_id": row.get("user_id"),
    }


def timeline(hotel_id: str, resource_type: str, resource_ids: list[str], *, limit: int = 100) -> list[dict]:
    """Append-only history for a request, oldest first. Names only; the stored old/new state stays server-side."""
    events = (
        supabase.table("operational_audit_events").select("id, action, actor_id, actor_role, old_state, new_state, reason_note, created_at")
        .eq("tenant_id", hotel_id).eq("resource_type", resource_type).in_("resource_id", resource_ids)
        .order("created_at").limit(limit).execute().data or []
    )
    names = load_names(sorted({str(e["actor_id"]) for e in events if e.get("actor_id")}))
    return [{
        "id": e.get("id"), "action": e["action"], "at": e.get("created_at"),
        "actor_name": names.get(str(e.get("actor_id")), "") or None if e.get("actor_id") else None,
        "actor_role": e.get("actor_role"),
        "from_status": (e.get("old_state") or {}).get("status"), "to_status": (e.get("new_state") or {}).get("status"),
        "reason": e.get("reason_note"),
    } for e in events]


def parse_iso(value: object) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
