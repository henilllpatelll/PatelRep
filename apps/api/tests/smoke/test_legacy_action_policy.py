"""Regression evidence for the hardened legacy action policy (services/policy.py).

The former implementation used a numeric rank table and ALLOWED any action it did not list. H0 makes unknown actions
and unknown roles fail closed and replaces rank with explicit role sets. Every (known action, canonical role) outcome
must be identical to before; this file pins that against an inline copy of the old algorithm.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from core.roles import ALL_ROLES
from models.requests import TaskPreview
from routers import ai_copilot
from services.policy import UNKNOWN_ACTION_REASON, check_action_permitted
from tests.smoke.fake_supabase import FakeDB
from tests.smoke.agent_harness_support import HOTEL_A, USER_ID, user

# Verbatim copy of the pre-H0 tables, used only as the oracle.
_OLD_RANK = {"housekeeper": 0, "front_desk": 1, "housekeeping_supervisor": 2, "engineer": 2, "gm": 3}
_OLD_ACTIONS = {
    "bulk_room_assignment": (2, "housekeeping supervisor"),
    "reassign_other_staff_task": (2, "supervisor"),
    "billing_credit": (3, "general manager"),
    "room_upgrade": (3, "general manager"),
    "folio_adjustment": (3, "general manager"),
}


def _old_check(action: str, role: str) -> tuple[bool, str]:
    min_rank, label = _OLD_ACTIONS[action]
    if _OLD_RANK.get(role, 0) >= min_rank:
        return True, ""
    return False, f"This action requires a {label} or higher. Ask your supervisor to confirm."


@pytest.mark.parametrize("role", ALL_ROLES)
@pytest.mark.parametrize("action", sorted(_OLD_ACTIONS))
def test_every_known_action_and_canonical_role_is_unchanged(action, role):
    assert check_action_permitted(action, role) == _old_check(action, role)


@pytest.mark.parametrize("action", ["delete_hotel", "", "BILLING_CREDIT", "reassign_other_staff_task ", "refund_guest"])
@pytest.mark.parametrize("role", ALL_ROLES)
def test_unknown_actions_are_denied_for_every_role(action, role):
    assert check_action_permitted(action, role) == (False, UNKNOWN_ACTION_REASON)


@pytest.mark.parametrize("action", [None, 7, ["billing_credit"]])
def test_malformed_actions_are_denied(action):
    assert check_action_permitted(action, "gm") == (False, UNKNOWN_ACTION_REASON)  # type: ignore[arg-type]


@pytest.mark.parametrize("role", ["none", "owner", "", "GM", None])
def test_unknown_roles_are_denied_for_known_actions(role):
    for action in _OLD_ACTIONS:
        assert check_action_permitted(action, role)[0] is False  # type: ignore[arg-type]


def test_chief_engineer_outcome_is_preserved_not_silently_widened():
    # chief_engineer was missing from the rank table (=> rank 0). H0 keeps that outcome; changing it is a product call.
    assert check_action_permitted("reassign_other_staff_task", "chief_engineer")[0] is False


# --- route-level regression: POST /ai/tasks/confirm, the only caller -------------------------------------------

ASSIGNEE = "88888888-8888-4888-8888-888888888888"
REASSIGN_ALLOWED = {"housekeeping_supervisor", "engineer", "gm"}


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ALL_ROLES)
async def test_confirm_tasks_reassign_gate_is_unchanged(role, monkeypatch):
    monkeypatch.setattr(ai_copilot, "supabase", FakeDB({"user_roles": [], "rooms": [], "tasks": []}))
    preview = TaskPreview(title="Deliver towels", assigned_to=ASSIGNEE)
    with pytest.raises(HTTPException) as err:
        await ai_copilot.confirm_tasks([preview], user(role, HOTEL_A, USER_ID))
    if role in REASSIGN_ALLOWED:
        # past the policy gate: the next check (assignee must be active staff in this hotel) refuses instead
        assert err.value.status_code == 400 and "Assignee" in err.value.detail
    else:
        assert err.value.status_code == 403
        assert err.value.detail == _old_check("reassign_other_staff_task", role)[1]


@pytest.mark.asyncio
async def test_confirm_tasks_self_assignment_never_consults_the_reassign_policy(monkeypatch):
    calls = []
    monkeypatch.setattr(ai_copilot, "check_action_permitted", lambda *a: calls.append(a) or (False, "nope"))
    monkeypatch.setattr(ai_copilot, "supabase", FakeDB({"user_roles": [], "rooms": [], "tasks": []}))
    with pytest.raises(HTTPException):
        await ai_copilot.confirm_tasks([TaskPreview(title="x", assigned_to=USER_ID)], user("housekeeper"))
    assert calls == []
