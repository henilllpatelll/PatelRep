"""Inbox notifications for the engineering team (chief engineers and the engineers on a job).

Shared by work orders, room availability and the PM cron (CLAUDE.md A1: 2+ domains). Inbox rows only: these
events are listed in ``services.notify.INBOX_ONLY_EVENTS`` and never push. Every call is best effort and
never raises, because the operational change it reports has already been committed. One UNREAD row per
(person, event, subject) so a retried request or a repeated cron run cannot alert twice.
"""
from __future__ import annotations

import logging
from typing import Iterable, Optional

from core.database import supabase

logger = logging.getLogger(__name__)

MANAGER_ROLES = ("chief_engineer",)


def role_members(tenant_id: str, roles: Iterable[str]) -> list[str]:
    rows = (
        supabase.table("user_roles").select("user_id").eq("tenant_id", tenant_id)
        .in_("role", list(roles)).eq("is_active", True).execute()
    ).data or []
    return sorted({str(r["user_id"]) for r in rows})


def notify_users(
    *, tenant_id: str, user_ids: Iterable[str], event: str, title: str, body: str,
    data: dict, subject_key: str, subject_id: str, exclude: Optional[str] = None,
) -> int:
    """Write the inbox rows; returns how many were written. ``subject_key`` names the field in ``data`` that
    identifies what the alert is about (``wo_id``, ``room_id``...), used for duplicate suppression."""
    written = 0
    for user_id in sorted({str(u) for u in user_ids}):
        if exclude and user_id == str(exclude):
            continue
        try:
            existing = (
                supabase.table("notifications").select("id").eq("tenant_id", tenant_id).eq("user_id", user_id)
                .eq("type", event).eq("is_read", False).contains("data", {subject_key: subject_id}).limit(1).execute()
            )
            if existing.data:
                continue
            supabase.table("notifications").insert({
                "tenant_id": tenant_id, "user_id": user_id, "type": event, "title": title, "body": body,
                "data": {**data, subject_key: subject_id}, "is_read": False,
            }).execute()
            written += 1
        except Exception:  # noqa: BLE001
            logger.warning("engineering notification failed event=%s", event, exc_info=True)
    return written


def notify_managers(*, tenant_id: str, event: str, title: str, body: str, data: dict, subject_key: str, subject_id: str, exclude: Optional[str] = None) -> int:
    try:
        recipients = role_members(tenant_id, MANAGER_ROLES)
    except Exception:  # noqa: BLE001
        logger.warning("engineering notification recipients failed event=%s", event, exc_info=True)
        return 0
    return notify_users(
        tenant_id=tenant_id, user_ids=recipients, event=event, title=title, body=body, data=data,
        subject_key=subject_key, subject_id=subject_id, exclude=exclude,
    )
