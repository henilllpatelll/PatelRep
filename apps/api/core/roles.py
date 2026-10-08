"""Canonical role-group constants. Single source of truth — routers must import
from here rather than defining local *_ROLES tuples, to prevent silent drift."""

ALL_ROLES = ("gm", "housekeeping_supervisor", "engineer", "front_desk", "housekeeper", "chief_engineer")
# chief_engineer was merged into engineer at the DB layer by migration
# 064_merge_chief_engineer.sql, then restored as a fully live, distinct role by
# migration 092_restore_chief_engineer_role.sql — it was never actually retired
# at the application layer (routeGuard.ts, staff creation, and MANAGER_ROLES/
# PROGRAM_MANAGER_ROLES below all already treated it as live). Keep it in
# ALL_ROLES / ALL_STAFF_ROLES.

ALL_STAFF_ROLES = ALL_ROLES  # hotels.py's prior definition had a duplicate "engineer"

# Use this for narrow, GM-only exceptions that sit inside otherwise
# engineer-accessible operational workflows.
GM_ONLY_ROLES = ("gm",)

# Two DIFFERENT authority tiers that previously shared the name MANAGER_ROLES
# (see Phase 19 RESEARCH Decision 1) — kept distinct on purpose, not merged:
MANAGER_ROLES = ("gm", "housekeeping_supervisor", "chief_engineer")  # leadership/compliance tier (safety.py)
PROGRAM_MANAGER_ROLES = ("gm", "housekeeping_supervisor", "engineer", "chief_engineer")  # operational-program tier incl. line engineers (programs.py)
TASK_ASSIGNMENT_ROLES = ("gm", "housekeeping_supervisor", "chief_engineer", "front_desk")

# Phase 8 (housekeeping exception workflows): housekeeper reports what they
# observe (attempts, occupancy, service declined); Rush/priority and
# discrepancy resolution are supervisor/front-desk/GM calls.
HOUSEKEEPING_EXCEPTION_REPORT_ROLES = ("housekeeper", "housekeeping_supervisor", "gm", "chief_engineer")
RUSH_MANAGER_ROLES = ("housekeeping_supervisor", "front_desk", "gm", "chief_engineer")
DISCREPANCY_RESOLVER_ROLES = ("front_desk", "housekeeping_supervisor", "gm")

# Availability is broadly visible, but repair detail is deliberately withheld
# from roles that only need guest-facing room availability.
LIMITED_ROOM_UNAVAILABILITY_VISIBILITY_ROLES = ("front_desk", "housekeeper")


# ---------------------------------------------------------------------------
# Web module access
# ---------------------------------------------------------------------------
# Which base roles may reach each sidebar module. Mirrors ROLE_ROUTE_RULES in
# apps/web/lib/utils/routeGuard.ts (enforced by apps/web/proxy.ts); tests/test_role_module_access.py
# fails if the two drift. Custom roles and Front Desk module settings only choose a subset of
# these: they narrow the sidebar, they can never grant a route the base role cannot open.
MODULE_ROLE_ACCESS: dict[str, tuple[str, ...]] = {
    "housekeeping": ("gm", "housekeeping_supervisor", "housekeeper", "front_desk"),
    "engineering": ("gm", "engineer", "chief_engineer", "housekeeping_supervisor"),
    "lost-found": ("gm", "housekeeping_supervisor", "front_desk"),
    "tasks": ALL_ROLES,
    "staff": ("gm",),
    "scheduling": ("gm", "housekeeping_supervisor", "engineer", "chief_engineer"),
    "logbook": ("housekeeping_supervisor", "engineer", "chief_engineer", "front_desk", "gm"),
    "sop": ("gm", "housekeeping_supervisor", "engineer", "chief_engineer"),
    "reports": ("gm", "housekeeping_supervisor", "engineer", "chief_engineer"),
    "ai": ("gm", "housekeeping_supervisor", "engineer", "chief_engineer", "front_desk"),
}

# Saved before Guest Requests merged into Tasks; still tolerated on read and normalised on save.
LEGACY_MODULE_ALIASES = {"guest-requests": "tasks"}


def modules_for_role(role: str) -> set[str]:
    return {module for module, roles in MODULE_ROLE_ACCESS.items() if role in roles}


def unsupported_modules(modules: list[str], role: str) -> list[str]:
    """Modules the given base role cannot open (unknown slugs included). Legacy aliases count as their target."""
    allowed = modules_for_role(role)
    return sorted({m for m in modules if LEGACY_MODULE_ALIASES.get(m, m) not in allowed})
