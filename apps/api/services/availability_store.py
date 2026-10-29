"""Database reads that feed the pure availability rules (services/scheduling_availability.py). Tenant-scoped; every
`hotel_id` comes from the verified session.

A failed read is NEVER treated as "available" or "no leave": callers that must not guess (the candidate engine) get
`None` back and report availability as unknown; the approved-leave rule is additionally enforced by a database trigger,
so a transient read failure cannot let a write through.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import timedelta, tzinfo
from typing import Optional, Sequence

from core.database import supabase
from services.scheduling import Occurrence
from services.scheduling_availability import Assessment, assess_window

logger = logging.getLogger(__name__)

LEAVE_COLUMNS = "id, tenant_id, user_id, department_id, start_date, end_date, partial, start_time, end_time, starts_at, ends_at, status"


@dataclass
class UserContext:
    weekly: list[dict] = field(default_factory=list)
    exceptions: list[dict] = field(default_factory=list)
    leave: list[dict] = field(default_factory=list)


def load_contexts(hotel_id: str, user_ids: Sequence[str], window_start, window_end) -> dict[str, UserContext]:
    """
    Availability rules and live (pending/approved) leave for `user_ids` touching [window_start, window_end] (datetimes).
    Raises on a database failure; use `assess_occurrences` when a failure should degrade to "unknown".
    """
    out = {str(uid): UserContext() for uid in user_ids}
    if not out:
        return out
    ids = sorted(out)
    low_day = (window_start - timedelta(days=1)).date().isoformat()
    high_day = (window_end + timedelta(days=1)).date().isoformat()
    rules = (
        supabase.table("employee_availability").select("*").eq("tenant_id", hotel_id).in_("user_id", ids)
        .eq("status", "active").lte("effective_from", high_day).execute().data or []
    )
    for row in rules:
        ctx = out.get(str(row["user_id"]))
        if ctx is None:
            continue
        if row.get("kind") == "weekly":
            if row.get("effective_to") is None or str(row["effective_to"])[:10] >= low_day:
                ctx.weekly.append(row)
        elif low_day <= str(row.get("exception_date"))[:10] <= high_day:
            ctx.exceptions.append(row)
    leave = (
        supabase.table("time_off_requests").select(LEAVE_COLUMNS).eq("tenant_id", hotel_id).in_("user_id", ids)
        .in_("status", ["pending", "approved"]).lt("starts_at", window_end.isoformat()).gt("ends_at", window_start.isoformat())
        .execute().data or []
    )
    for row in leave:
        ctx = out.get(str(row["user_id"]))
        if ctx is not None:
            ctx.leave.append(row)
    return out


def assess_occurrences(hotel_id: str, occurrences: Sequence[Occurrence], zone: tzinfo) -> Optional[list[Assessment]]:
    """One Assessment per occurrence, in order -- or None when availability could not be read (never a guess)."""
    if not occurrences:
        return []
    try:
        contexts = load_contexts(
            hotel_id, sorted({o.user_id for o in occurrences}),
            min(o.starts_at for o in occurrences), max(o.ends_at for o in occurrences),
        )
    except Exception:
        logger.warning("availability: read failed hotel_id=%s", hotel_id)
        return None
    return [
        assess_window(o.starts_at, o.ends_at, weekly=contexts[o.user_id].weekly, exceptions=contexts[o.user_id].exceptions,
                      leave=contexts[o.user_id].leave, zone=zone)
        for o in occurrences
    ]
