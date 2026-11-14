"""
Deterministic action policy — no LLM involved.

Rules here are enforced before any AI-suggested action executes.
This is the last line of defence before a side-effect hits the DB.

Fail closed: an action that is not listed here is NOT permitted (it used to be silently allowed), and a role
that is not listed for an action is denied. Authority is an explicit set of canonical roles per action, not a
numeric rank, because hotel departments are not a hierarchy.

The role sets below reproduce exactly what the former rank table allowed (housekeeper 0, front_desk 1,
housekeeping_supervisor 2, engineer 2, gm 3; any other role, including chief_engineer, counted as 0), so no caller's
outcome changes. tests/smoke/test_legacy_action_policy.py pins every (action, role) pair.

Known inconsistency, deliberately NOT changed here (it would alter live permissions): for
``reassign_other_staff_task`` the former rank table allowed ``engineer`` and denied ``chief_engineer`` and
``front_desk``, whereas the domain rule for assigning tasks (core.roles.TASK_ASSIGNMENT_ROLES, enforced by
routers/tasks.py) is gm / housekeeping_supervisor / chief_engineer / front_desk. Aligning the two is a product
decision tracked in docs/agent-harness/security.md.

The Agent Harness does not use this module; it has its own default-deny evaluator (services/agent_harness/policy.py).
"""

from types import MappingProxyType

# action -> (roles that may execute it without additional approval, human-readable role label for the refusal)
_ACTION_ROLES = MappingProxyType({
    "bulk_room_assignment":      (frozenset({"housekeeping_supervisor", "engineer", "gm"}), "housekeeping supervisor"),
    "reassign_other_staff_task": (frozenset({"housekeeping_supervisor", "engineer", "gm"}), "supervisor"),
    "billing_credit":            (frozenset({"gm"}), "general manager"),
    "room_upgrade":              (frozenset({"gm"}), "general manager"),
    "folio_adjustment":          (frozenset({"gm"}), "general manager"),
})

UNKNOWN_ACTION_REASON = "This action is not recognised, so it cannot be performed automatically."


def check_action_permitted(action: str, role: str) -> tuple[bool, str]:
    """
    Return (permitted, reason).
    permitted=True if role may execute action without additional approval.
    permitted=False includes a user-facing reason string. Unknown actions and unknown roles are denied.
    """
    rule = _ACTION_ROLES.get(action) if isinstance(action, str) else None
    if rule is None:
        return False, UNKNOWN_ACTION_REASON

    allowed_roles, role_label = rule
    if role in allowed_roles:
        return True, ""

    return False, f"This action requires a {role_label} or higher. Ask your supervisor to confirm."
