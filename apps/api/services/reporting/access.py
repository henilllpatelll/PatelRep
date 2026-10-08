"""Single source of truth for who may see which report view and whose data.

Frontend tabs, endpoint guards, exports and scheduled delivery ALL derive from
these tables (the web app reads them via ``GET /v1/reports/capabilities``).
Hidden tabs are never the security boundary — every endpoint calls
``require_view``.
"""
from __future__ import annotations

from typing import Callable, Optional

from fastapi import Depends, HTTPException

from middleware.auth import CurrentUser, get_current_user

VIEWS = ("overview", "guest-experience", "housekeeping", "maintenance", "team", "management")
DEPARTMENTS = ("housekeeping", "engineering")

# role -> report views. Roles absent here (housekeeper, front_desk) have no Reports access.
ROLE_VIEWS: dict[str, tuple[str, ...]] = {
    "gm": VIEWS,
    "housekeeping_supervisor": ("overview", "guest-experience", "housekeeping", "team"),
    "chief_engineer": ("overview", "guest-experience", "maintenance", "team"),
    # Line engineers keep exactly the two report areas they already had.
    "engineer": ("guest-experience", "maintenance"),
}

# role -> departments whose data (staff, work) the role may see inside reports.
ROLE_DEPARTMENTS: dict[str, tuple[str, ...]] = {
    "gm": DEPARTMENTS,
    "housekeeping_supervisor": ("housekeeping",),
    "chief_engineer": ("engineering",),
    "engineer": ("engineering",),
}

# staff role -> department they belong to (used to scope the Team view).
STAFF_ROLE_DEPARTMENT: dict[str, str] = {
    "housekeeper": "housekeeping",
    "housekeeping_supervisor": "housekeeping",
    "engineer": "engineering",
    "chief_engineer": "engineering",
}

# Overview KPI / section -> the view that already authorises that data.
OVERVIEW_REQUIRES = {
    "guest_sla": "guest-experience",
    "maintenance_sla": "maintenance",
    "inspection_pass": "housekeeping",
    "out_of_order": "housekeeping",
}

# Views a manager may export/schedule: everything they can view.
FINANCIAL_VIEWS = ("management",)


def views_for_role(role: Optional[str]) -> tuple[str, ...]:
    return ROLE_VIEWS.get(role or "", ())


def departments_for_role(role: Optional[str]) -> tuple[str, ...]:
    return ROLE_DEPARTMENTS.get(role or "", ())


def can_view(role: Optional[str], view: str) -> bool:
    return view in views_for_role(role)


def staff_visible_to(viewer_role: Optional[str], staff_role: Optional[str]) -> bool:
    """Whether ``viewer_role`` may see analytics for a staff member holding ``staff_role``."""
    dept = STAFF_ROLE_DEPARTMENT.get(staff_role or "")
    if dept is None:
        return viewer_role == "gm"  # GM-only for front desk / unknown
    return dept in departments_for_role(viewer_role)


def effective_departments(role: Optional[str], requested: Optional[str]) -> tuple[str, ...]:
    """Intersect a requested department filter with what the role may see (422/403 on abuse)."""
    allowed = departments_for_role(role)
    if not requested or requested == "all":
        return allowed
    if requested not in DEPARTMENTS:
        raise HTTPException(status_code=422, detail=f"department must be one of: {', '.join(DEPARTMENTS)}")
    if requested not in allowed:
        raise HTTPException(status_code=403, detail="Not authorised for that department")
    return (requested,)


def capabilities(role: Optional[str]) -> dict:
    views = list(views_for_role(role))
    return {
        "role": role,
        "views": views,
        "departments": list(departments_for_role(role)),
        "can_export": bool(views),
        "schedulable_views": views,
        "financial_access": role == "gm",
    }


def require_view(*views: str) -> Callable:
    """FastAPI dependency: caller must hold at least one of ``views``."""

    async def check(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if not any(can_view(current_user.role, view) for view in views):
            raise HTTPException(status_code=403, detail="Insufficient permissions for this report")
        return current_user

    return check


def require_report_view(view: str, current_user: CurrentUser) -> None:
    if view not in VIEWS:
        raise HTTPException(status_code=422, detail=f"Unknown report view '{view}'")
    if not can_view(current_user.role, view):
        raise HTTPException(status_code=403, detail="Insufficient permissions for this report")
