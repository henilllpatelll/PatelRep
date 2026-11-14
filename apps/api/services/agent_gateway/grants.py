"""Per-property enablement of one agent version for one tool version (persisted H0 ``AutonomyGrant``).

Only a CURRENT GM of the hotel can grant or revoke (re-read in the database). Levels: 1 = observe (read tools),
2 = human approved (write tools). Levels 3-4 are unrepresentable in the table. No wildcard: every grant names one
hotel, one agent version and one tool version. A model can never reach this module.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from middleware.auth import CurrentUser
from services.agent_gateway.catalog import DB_ALLOWLIST, DISPATCH_AGENT_ID, DISPATCH_AGENT_VERSION
from services.agent_gateway.errors import GatewayRefused
from services.agent_gateway.store import GatewayStore


def set_tool_grant(store: GatewayStore, user: CurrentUser, *, tool_id: str, tool_version: int, max_level: int,
                   expires_at: Optional[datetime] = None, revoke: bool = False) -> dict:
    if not isinstance(user, CurrentUser) or not user.hotel_id or not user.user_id:
        raise GatewayRefused("unauthenticated")
    if user.role != "gm":
        raise GatewayRefused("not_authorized")
    if (DISPATCH_AGENT_ID, DISPATCH_AGENT_VERSION, tool_id, tool_version) not in DB_ALLOWLIST:
        raise GatewayRefused("tool_not_allowed")
    result = store.grant_set(tenant_id=user.hotel_id, actor_user_id=user.user_id, agent_id=DISPATCH_AGENT_ID,
                             agent_version=DISPATCH_AGENT_VERSION, tool_id=tool_id, tool_version=tool_version,
                             max_level=max_level, expires_at=expires_at, revoke=revoke)
    if not result.get("ok"):
        raise GatewayRefused(str(result.get("reason") or "grant_refused"))
    return result
