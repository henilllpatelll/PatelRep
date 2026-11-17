"""Server-side identity for every Control Center request (reads included).

The JWT says who signed in; it does not prove they still hold that role here. Each request re-reads the person's
hotel, profile and roles through the H1 ``SupabaseIdentityAuthority`` (the same authority the worker uses for every
step) and refuses -- with a stable reason code -- a missing hotel, an inactive hotel/profile/role, more than one active
role, or a role that differs from the session's (a stale or demoted token). Hotel ids never come from a request.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable

from middleware.auth import CurrentUser
from services.agent_control_center.errors import ControlCenterRefused
from services.agent_execution.identity_authority import SupabaseIdentityAuthority
from services.agent_harness.errors import IdentityError

# Every role that can initiate or review an H5 specialist action (pinned to the gateway/intents by a smoke test).
VIEWER_ROLES = frozenset({"gm", "chief_engineer", "engineer", "housekeeping_supervisor"})
SECTIONS = ("overview", "agents", "approvals", "activity", "controls", "audit")
_SECTION_ROLES = {
    "overview": frozenset({"gm", "chief_engineer", "housekeeping_supervisor"}),
    "agents": VIEWER_ROLES,
    "approvals": VIEWER_ROLES,
    "activity": VIEWER_ROLES,
    "controls": frozenset({"gm"}),
    "audit": frozenset({"gm"}),
}


@dataclass(frozen=True)
class Viewer:
    user_id: str
    hotel_id: str
    role: str

    @property
    def is_gm(self) -> bool:
        return self.role == "gm"

    def may(self, section: str) -> bool:
        return self.role in _SECTION_ROLES.get(section, frozenset())

    @property
    def sections(self) -> list[str]:
        return [s for s in SECTIONS if self.may(s)]

    def as_current_user(self) -> CurrentUser:
        """For the reused H2 approvals service: a CurrentUser whose role is the AUTHORITATIVE one just re-read."""
        return CurrentUser(user_id=self.user_id, hotel_id=self.hotel_id, role=self.role)


def revalidate(client: Any, user: CurrentUser, *, clock: Callable[[], datetime]) -> Viewer:
    if not isinstance(user, CurrentUser) or not user.user_id or not user.hotel_id:
        raise ControlCenterRefused("unauthenticated")
    try:
        record = SupabaseIdentityAuthority(client, clock=clock).load(user_id=user.user_id, hotel_id=user.hotel_id)
    except IdentityError as exc:
        raise ControlCenterRefused(getattr(exc, "code", None) or "identity_unverified") from None
    if record is None:
        raise ControlCenterRefused("not_a_member")
    if not record.is_active:
        raise ControlCenterRefused("inactive_member")
    if record.role != user.role:
        raise ControlCenterRefused("stale_role")  # the session's role is no longer this person's role here
    if record.role not in VIEWER_ROLES:
        raise ControlCenterRefused("not_authorized")
    return Viewer(user_id=record.user_id, hotel_id=record.hotel_id, role=record.role)


def require(viewer: Viewer, section: str) -> None:
    if not viewer.may(section):
        raise ControlCenterRefused("not_authorized")
