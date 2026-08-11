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

# Two DIFFERENT authority tiers that previously shared the name MANAGER_ROLES
# (see Phase 19 RESEARCH Decision 1) — kept distinct on purpose, not merged:
MANAGER_ROLES = ("gm", "housekeeping_supervisor", "chief_engineer")  # leadership/compliance tier (safety.py)
PROGRAM_MANAGER_ROLES = ("gm", "housekeeping_supervisor", "engineer", "chief_engineer")  # operational-program tier incl. line engineers (programs.py)
