"""Database-backed lookups shared by routers/scheduling.py and routers/scheduling_team.py.

Everything is tenant-scoped (`tenant_id` / `hotel_id` always comes from the verified session, never the client).
Kept apart from services/scheduling.py so that module stays pure and unit-testable.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, timezone, tzinfo
from typing import Optional

from dateutil import tz

from core.database import supabase
from core.errors import CodedHTTPException
from core.timezones import safe_gettz
from middleware.auth import CurrentUser
from services.scheduling import DEFAULT_TIMEZONE
from services.scheduling_contracts import MANAGER_DEPARTMENT_CODES, ROLE_DEFAULT_DEPARTMENT_CODE

logger = logging.getLogger(__name__)


def err(status_code: int, code: str, message: str, **extra) -> CodedHTTPException:
    """The one error shape for scheduling: a plain-string `detail` (existing clients render it) plus `code`/extras."""
    return CodedHTTPException(status_code, message, code, **extra)


# ---------------------------------------------------------------------------
# Hotel time
# ---------------------------------------------------------------------------

def hotel_zone(hotel_id: str) -> tzinfo:
    """
    The hotel's timezone. Scheduling resolves wall-clock shift times to instants, so guessing is not acceptable:
    an unreadable hotel is a 503, not a silent UTC day. A blank/invalid stored name falls back to America/Chicago
    (the rest of housekeeping's default).
    """
    try:
        row = supabase.table("tenants").select("timezone").eq("id", hotel_id).maybe_single().execute()
        data = row.data if row else None
    except Exception:
        logger.warning("scheduling: could not read hotel timezone for hotel_id=%s", hotel_id)
        raise err(503, "timezone_unavailable", "The hotel's timezone could not be read. Try again shortly.")
    if not data:
        raise err(404, "hotel_not_found", "Hotel not found")
    return safe_gettz(data.get("timezone") or DEFAULT_TIMEZONE) or tz.gettz(DEFAULT_TIMEZONE)


def hotel_today(zone: tzinfo, now: Optional[datetime] = None) -> date:
    return (now or datetime.now(timezone.utc)).astimezone(zone).date()


# ---------------------------------------------------------------------------
# Departments, staff and who may manage whom
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Departments:
    code_by_id: dict[str, str]

    def id_for_code(self, code: str) -> Optional[str]:
        return next((i for i, c in self.code_by_id.items() if c == code), None)

    def ids_in_scope(self, scope: Optional[frozenset[str]]) -> set[str]:
        """Department ids a role may manage. `scope=None` (gm) = every department of the hotel."""
        return set(self.code_by_id) if scope is None else {i for i, c in self.code_by_id.items() if c in scope}


def load_departments(hotel_id: str) -> Departments:
    rows = supabase.table("departments").select("id, code").eq("tenant_id", hotel_id).execute().data or []
    return Departments({str(r["id"]): str(r.get("code") or "") for r in rows})


def manager_scope(current_user: CurrentUser) -> Optional[frozenset[str]]:
    """Department codes the caller may manage. None = unrestricted (gm). Unknown role = nothing."""
    if current_user.role not in MANAGER_DEPARTMENT_CODES:
        return frozenset()
    return MANAGER_DEPARTMENT_CODES[current_user.role]


@dataclass(frozen=True)
class StaffMember:
    user_id: str
    roles: tuple[str, ...]
    department_id: Optional[str]  # None = could not be determined (surfaced as a warning, never guessed)


def _department_of(rows: list[dict], departments: Departments) -> Optional[str]:
    for row in rows:
        if row.get("department_id"):
            return str(row["department_id"])
    for row in rows:
        code = ROLE_DEFAULT_DEPARTMENT_CODE.get(row.get("role") or "")
        if code and departments.id_for_code(code):
            return departments.id_for_code(code)
    return None


def load_staff(
    hotel_id: str, departments: Departments, user_ids: Optional[list[str]] = None
) -> dict[str, StaffMember]:
    """Active members of this hotel (all of them, or just `user_ids`). An inactive person is simply absent."""
    query = (
        supabase.table("user_roles")
        .select("user_id, role, department_id")
        .eq("tenant_id", hotel_id)
        .eq("is_active", True)
    )
    if user_ids is not None:
        query = query.in_("user_id", user_ids)
    grouped: dict[str, list[dict]] = {}
    for row in query.execute().data or []:
        grouped.setdefault(str(row["user_id"]), []).append(row)
    return {
        uid: StaffMember(uid, tuple(r.get("role") for r in rows), _department_of(rows, departments))
        for uid, rows in grouped.items()
    }


def load_names(user_ids: list[str]) -> dict[str, str]:
    if not user_ids:
        return {}
    rows = supabase.table("user_profiles").select("id, full_name, preferred_name").in_("id", user_ids).execute().data or []
    return {str(r["id"]): (r.get("preferred_name") or r.get("full_name") or "") for r in rows}


def ensure_can_manage(current_user: CurrentUser, department_id: Optional[str], departments: Departments) -> None:
    """403 unless the caller's role covers `department_id`. An unknown department is never manageable by a scoped role."""
    scope = manager_scope(current_user)
    if scope is None:
        return
    if department_id is None or departments.code_by_id.get(department_id) not in scope:
        raise err(403, "department_forbidden", "You can only manage schedules for your own department.")


# ---------------------------------------------------------------------------
# Audit (append-only, shared with the rest of the platform)
# ---------------------------------------------------------------------------

def record_audit(
    current_user: CurrentUser, *, resource_type: str, resource_id: str, action: str,
    old_state: Optional[dict] = None, new_state: Optional[dict] = None, reason_note: Optional[str] = None,
) -> None:
    """
    Best effort: the change is already committed when this runs, so a failed audit write is logged loudly rather than
    reported to the caller as a failed schedule change.
    """
    try:
        supabase.table("operational_audit_events").insert({
            "tenant_id": current_user.hotel_id,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "action": action,
            "actor_id": current_user.user_id,
            "actor_role": current_user.role,
            "old_state": old_state or {},
            "new_state": new_state or {},
            "reason_note": reason_note,
            "source": "api",
        }).execute()
    except Exception:
        logger.exception("scheduling: audit write failed resource=%s id=%s action=%s", resource_type, resource_id, action)
