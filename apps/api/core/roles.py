"""Canonical role-group constants. Single source of truth — routers must import
from here rather than defining local *_ROLES tuples, to prevent silent drift."""

ALL_ROLES = ("gm", "housekeeping_supervisor", "engineer", "front_desk", "housekeeper")
# chief_engineer was retired by migration 064_merge_chief_engineer.sql — it can no
# longer occur in a live JWT. Some routers still reference it in role-group
# constants as a harmless no-op; do not re-add it to ALL_ROLES / ALL_STAFF_ROLES.

ALL_STAFF_ROLES = ALL_ROLES  # hotels.py's prior definition had a duplicate "engineer"

# Two DIFFERENT authority tiers that previously shared the name MANAGER_ROLES
# (see Phase 19 RESEARCH Decision 1) — kept distinct on purpose, not merged:
MANAGER_ROLES = ("gm", "housekeeping_supervisor", "chief_engineer")  # leadership/compliance tier (safety.py)
PROGRAM_MANAGER_ROLES = ("gm", "housekeeping_supervisor", "engineer", "chief_engineer")  # operational-program tier incl. line engineers (programs.py)
