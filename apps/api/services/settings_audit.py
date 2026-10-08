"""
Recording of administrative (Settings) changes into the existing append-only ``operational_audit_events``.

Consistency guarantees (be precise about these):

* The Supabase REST client has no multi-statement transactions, so an audit row is NOT atomic with the
  mutation it describes. The row is written immediately AFTER the mutation succeeded, so a failed or
  rejected mutation never produces an event, and no event exists for a change that did not happen.
* If the audit insert fails it is retried once. If it still fails, the sanitized event is logged at
  CRITICAL level with an ``AUDIT_WRITE_FAILED`` marker so it can be reconciled by an operator; the
  request itself still succeeds (the change is real and rolling it back is not possible here). Ordinary
  logs are NOT an immutable audit store - this is a loss-minimising fallback, not a guarantee.
* Rows are append-only and tenant-scoped at the database (trigger + RLS). Only allowlisted, non-sensitive
  state keys (see services/audit_catalog.py) are ever persisted - never credentials or raw payloads.
"""
from __future__ import annotations

import json
import logging

from middleware.auth import CurrentUser
from services.audit_catalog import ACTIONS, changed_subset, sanitize_state

logger = logging.getLogger(__name__)


def record_settings_event(
    *,
    db,
    current_user: CurrentUser,
    action: str,
    resource_type: str,
    resource_id: str,
    old_state: dict | None = None,
    new_state: dict | None = None,
    only_changes: bool = True,
    source: str = "api",
) -> bool:
    """Append one audit event for a successful Settings mutation. Never raises. Returns whether it was stored.

    ``db`` is the calling router's own Supabase client, so tests that patch a router's client never reach the real DB.
    """
    if action not in ACTIONS:  # a programming error, surfaced loudly in tests; never blocks the request
        logger.error("Unknown settings audit action %r - event not recorded", action)
        return False
    if only_changes:
        old, new = changed_subset(resource_type, old_state, new_state)
    else:
        old, new = sanitize_state(resource_type, old_state), sanitize_state(resource_type, new_state)
    row = {
        "tenant_id": current_user.hotel_id,
        "resource_type": resource_type,
        "resource_id": str(resource_id),
        "action": action,
        "actor_id": current_user.user_id,
        "actor_role": current_user.role,
        "old_state": old,
        "new_state": new,
        "reason_code": None,
        "reason_note": None,
        "source": source,
    }
    for attempt in (1, 2):
        try:
            db.table("operational_audit_events").insert(row).execute()
            return True
        except Exception as exc:  # noqa: BLE001 - audit must never break the mutation response
            logger.warning("Settings audit write attempt %d failed for %s: %s", attempt, action, type(exc).__name__)
    logger.critical("AUDIT_WRITE_FAILED %s", json.dumps(row, default=str))
    return False
