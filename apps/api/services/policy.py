"""
Deterministic action policy — no LLM involved.

Rules here are enforced before any AI-suggested action executes.
This is the last line of defence before a side-effect hits the DB.
"""

# Role authority rank. Higher = more authority.
_ROLE_RANK: dict[str, int] = {
    "housekeeper": 0,
    "engineer": 0,
    "front_desk": 1,
    "housekeeping_supervisor": 2,
    "chief_engineer": 2,
    "gm": 3,
}

# action → (minimum rank required, human-readable role name at that rank)
_ACTION_MIN_RANK: dict[str, tuple[int, str]] = {
    "bulk_room_assignment":      (2, "housekeeping supervisor"),
    "reassign_other_staff_task": (2, "supervisor"),
    "billing_credit":            (3, "general manager"),
    "room_upgrade":              (3, "general manager"),
    "folio_adjustment":          (3, "general manager"),
}


def check_action_permitted(action: str, role: str) -> tuple[bool, str]:
    """
    Return (permitted, reason).
    permitted=True if role may execute action without additional approval.
    permitted=False includes a user-facing reason string.
    """
    rule = _ACTION_MIN_RANK.get(action)
    if rule is None:
        return True, ""

    min_rank, role_label = rule
    user_rank = _ROLE_RANK.get(role, 0)
    if user_rank >= min_rank:
        return True, ""

    return False, f"This action requires a {role_label} or higher. Ask your supervisor to confirm."
