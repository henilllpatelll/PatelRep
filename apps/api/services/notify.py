"""Central notification policy and push delivery.

Why this lives in services/: four domains (housekeeping, rooms, tasks, work orders) push to phones, and
the preference rules must be identical for all of them (CLAUDE.md A1: extract only when shared by 2+).

Four separate layers (a preference only ever touches layer 3):
  1. the operational record (task, work order, room assignment...) - never affected here;
  2. the in-app ``notifications`` row (the inbox) - written by each producer, never suppressed here;
  3. the push to a phone - the ONLY layer a person's opt-out can switch off, and only for optional events;
  4. the unread badge - counts inbox rows, so it is unaffected by push opt-outs.

Event inventory (every ``notifications.type`` a producer writes today). ``push`` events reach a phone;
all other events are inbox-only and are listed so an unclassified type is caught by the contract test
(tests/test_notification_policy.py) instead of silently getting default handling.

  push      room_assignment, room_checked_out            -> room_assignments (housekeeper)
  push      wo_assignment                                -> work_orders (engineer, chief_engineer)
  push      task_assigned, task_reassigned,
            task_cancelled, task_blocker_resolved        -> tasks (everyone)
  push      schedule_*                                   -> schedule (everyone; written by services/schedule_outbox.py)
  push      task_assigned_urgent                         -> tasks, CRITICAL (an opt-out never applies)
  inbox     everything in INBOX_ONLY_EVENTS below

Critical events are an explicit reviewed list (never guessed from wording). Unknown types never push.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Iterable, Optional

import httpx

from core.database import supabase

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
EXPO_BATCH_SIZE = 100

# Android notification channels the mobile app creates. ALERTS is for time-sensitive floor work; UPDATES
# is everything else. Importance is fixed at channel creation on a phone, so these ids must stay stable.
CHANNEL_ALERTS = "alerts"
CHANNEL_UPDATES = "updates"

ALL_STAFF_ROLES = ("housekeeper", "engineer", "chief_engineer", "housekeeping_supervisor", "front_desk", "gm")


@dataclass(frozen=True)
class Category:
    """A preference category a person can switch off, and the roles it is relevant to."""

    key: str
    roles: tuple[str, ...]


CATEGORIES: dict[str, Category] = {
    c.key: c
    for c in (
        Category("room_assignments", ("housekeeper",)),
        Category("work_orders", ("engineer", "chief_engineer")),
        Category("tasks", ALL_STAFF_ROLES),
        Category("schedule", ALL_STAFF_ROLES),
    )
}


@dataclass(frozen=True)
class PushPolicy:
    category: str
    channel: str
    critical: bool = False


PUSH_EVENTS: dict[str, PushPolicy] = {
    "room_assignment": PushPolicy("room_assignments", CHANNEL_ALERTS),
    "room_checked_out": PushPolicy("room_assignments", CHANNEL_ALERTS),
    "wo_assignment": PushPolicy("work_orders", CHANNEL_ALERTS),
    "task_assigned": PushPolicy("tasks", CHANNEL_UPDATES),
    "task_assigned_urgent": PushPolicy("tasks", CHANNEL_ALERTS, critical=True),
    "task_reassigned": PushPolicy("tasks", CHANNEL_UPDATES),
    "task_cancelled": PushPolicy("tasks", CHANNEL_UPDATES),
    "task_blocker_resolved": PushPolicy("tasks", CHANNEL_UPDATES),
    # Schedule events (services/schedule_outbox.py). A shift offer is time-sensitive; everything else is an update.
    "schedule_published": PushPolicy("schedule", CHANNEL_UPDATES),
    "schedule_offer_received": PushPolicy("schedule", CHANNEL_ALERTS),
    "schedule_offer_withdrawn": PushPolicy("schedule", CHANNEL_UPDATES),
    "schedule_offer_accepted": PushPolicy("schedule", CHANNEL_UPDATES),
    "schedule_offer_declined": PushPolicy("schedule", CHANNEL_UPDATES),
    "schedule_open_shift": PushPolicy("schedule", CHANNEL_UPDATES),
    "schedule_claim_submitted": PushPolicy("schedule", CHANNEL_UPDATES),
    "schedule_claim_approved": PushPolicy("schedule", CHANNEL_UPDATES),
    "schedule_claim_declined": PushPolicy("schedule", CHANNEL_UPDATES),
    "schedule_time_off_requested": PushPolicy("schedule", CHANNEL_UPDATES),
    "schedule_time_off_approved": PushPolicy("schedule", CHANNEL_UPDATES),
    "schedule_time_off_denied": PushPolicy("schedule", CHANNEL_UPDATES),
    "schedule_swap_proposed": PushPolicy("schedule", CHANNEL_UPDATES),
    "schedule_swap_accepted": PushPolicy("schedule", CHANNEL_UPDATES),
    "schedule_swap_declined": PushPolicy("schedule", CHANNEL_UPDATES),
    "schedule_swap_needs_approval": PushPolicy("schedule", CHANNEL_UPDATES),
    "schedule_swap_approved": PushPolicy("schedule", CHANNEL_UPDATES),
    "schedule_swap_denied": PushPolicy("schedule", CHANNEL_UPDATES),
}

# Written to the inbox by a producer, never pushed. Candidates for push later (documented, not built).
INBOX_ONLY_EVENTS: frozenset[str] = frozenset(
    {
        "asset_risk_high", "billing_cap_warning", "broadcast", "direct_message", "dnd_welfare_check_auto",
        "escalation_auto", "escalation_auto_asset", "escalation_tier1", "escalation_tier2",
        "feedback_submitted", "guest_request_wo_completed", "housekeeping",
        "logbook_acknowledgment_reminder", "logbook_acknowledgment_requested", "logbook_mention",
        "occupancy_discrepancy_reported", "occupancy_discrepancy_resolved", "re_clean_dispatched", "room_risk_high", "room_stayover",
        "safety_drill_follow_up_escalation", "safety_training_escalation", "safety_training_overdue",
        "safety_training_reminder", "shift_summary", "task_blocked", "welfare_check_requested",
    }
)


def known_event(event_type: str) -> bool:
    return event_type in PUSH_EVENTS or event_type in INBOX_ONLY_EVENTS


def categories_for_roles(roles: Iterable[str]) -> list[Category]:
    """Categories relevant to any of the roles, in a stable display order."""
    role_set = set(roles)
    return [c for c in CATEGORIES.values() if role_set & set(c.roles)]


def critical_category_keys() -> frozenset[str]:
    """Categories that contain a critical event: switching them off still lets those events through."""
    return frozenset(p.category for p in PUSH_EVENTS.values() if p.critical)


# --------------------------------------------------------------------------- role resolution


def pick_override_role(schedules: Iterable[dict], today: date) -> tuple[Optional[str], Optional[str]]:
    """The first active day-of-week schedule override that applies today, as (role, schedule_id)."""
    db_day = (today.weekday() + 1) % 7  # DB convention: 0=Sunday ... 6=Saturday
    for s in schedules:
        if s.get("start_date") and date.fromisoformat(s["start_date"]) > today:
            continue
        if s.get("end_date") and date.fromisoformat(s["end_date"]) < today:
            continue
        if db_day in (s.get("days_of_week") or []):
            return s["override_role"], s["id"]
    return None, None


def roles_in_play(tenant_id: str, user_ids: list[str]) -> dict[str, set[str]]:
    """Every role a person may act in today: their active base roles plus any schedule override. An
    opt-out only counts while its category is relevant to one of these, so a person acting in another
    role neither loses alerts for it nor stays silenced by a category they can no longer see."""
    roles: dict[str, set[str]] = {uid: set() for uid in user_ids}
    if not user_ids:
        return roles
    rows = (
        supabase.table("user_roles").select("user_id, role").eq("tenant_id", tenant_id).eq("is_active", True)
        .in_("user_id", user_ids).execute().data or []
    )
    for row in rows:
        roles.setdefault(row["user_id"], set()).add(row["role"])
    schedules = (
        supabase.table("staff_role_schedules").select("id, user_id, override_role, days_of_week, start_date, end_date")
        .eq("hotel_id", tenant_id).eq("is_active", True).in_("user_id", user_ids).execute().data or []
    )
    today = date.today()
    for uid in user_ids:
        override, _ = pick_override_role([s for s in schedules if s["user_id"] == uid], today)
        if override:
            roles[uid].add(override)
    return roles


# --------------------------------------------------------------------------- preferences


def load_opt_outs(tenant_id: str, user_ids: list[str], category: str) -> set[str]:
    """People who explicitly switched this category off."""
    if not user_ids:
        return set()
    rows = (
        supabase.table("notification_preferences").select("user_id")
        .eq("tenant_id", tenant_id).eq("category", category).eq("enabled", False)
        .in_("user_id", user_ids).execute().data or []
    )
    return {r["user_id"] for r in rows}


def should_push(tenant_id: str, user_ids: list[str], event_type: str) -> tuple[list[str], list[str]]:
    """Split recipients into (will receive push, skipped by their own opt-out) for one event.
    Critical events and unknown events: critical ignores opt-outs; unknown never pushes."""
    policy = PUSH_EVENTS.get(event_type)
    if policy is None:
        return [], []
    unique = list(dict.fromkeys(user_ids))
    if policy.critical:
        return unique, []
    opted_out = load_opt_outs(tenant_id, unique, policy.category)
    if not opted_out:
        return unique, []
    roles = roles_in_play(tenant_id, list(opted_out))
    relevant = CATEGORIES[policy.category].roles
    skipped = [uid for uid in unique if uid in opted_out and roles.get(uid, set()) & set(relevant)]
    return [uid for uid in unique if uid not in skipped], skipped


# --------------------------------------------------------------------------- devices


def active_devices(tenant_id: str, user_ids: list[str]) -> list[dict]:
    if not user_ids:
        return []
    return (
        supabase.table("push_devices").select("id, user_id, expo_push_token")
        .eq("tenant_id", tenant_id).is_("revoked_at", "null").in_("user_id", user_ids).execute().data or []
    )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def register_device(
    tenant_id: str, user_id: str, token: str, *, installation_id: Optional[str] = None,
    platform: Optional[str] = None, app_version: Optional[str] = None,
) -> None:
    """Make ``token`` an active registration for exactly this person. A token seen under anyone else is
    detached first (shared phone), and a rotated token on the same install replaces the old one."""
    now = _now()
    (
        supabase.table("push_devices").update({"revoked_at": now, "revoke_reason": "reassigned"})
        .eq("expo_push_token", token).is_("revoked_at", "null").neq("user_id", user_id).execute()
    )
    # Same token under another property for the same user id is impossible (one auth user, one tenant), but
    # a stale row from a previous property must not survive either.
    (
        supabase.table("push_devices").update({"revoked_at": now, "revoke_reason": "reassigned"})
        .eq("expo_push_token", token).is_("revoked_at", "null").neq("tenant_id", tenant_id).execute()
    )
    if installation_id:
        (
            supabase.table("push_devices").update({"revoked_at": now, "revoke_reason": "rotated"})
            .eq("tenant_id", tenant_id).eq("user_id", user_id).eq("installation_id", installation_id)
            .is_("revoked_at", "null").neq("expo_push_token", token).execute()
        )
    seen = {"last_seen_at": now, "installation_id": installation_id, "platform": platform, "app_version": app_version}
    existing = (
        supabase.table("push_devices").select("id").eq("tenant_id", tenant_id).eq("user_id", user_id)
        .eq("expo_push_token", token).is_("revoked_at", "null").execute().data or []
    )
    if existing:
        supabase.table("push_devices").update(seen).eq("id", existing[0]["id"]).execute()
        return
    try:
        supabase.table("push_devices").insert(
            {"tenant_id": tenant_id, "user_id": user_id, "expo_push_token": token, **seen}
        ).execute()
    except Exception:  # noqa: BLE001 - lost a race to a concurrent identical registration; the winner row is fine
        logger.info("PUSH_DEVICE_REGISTER_RACE user=%s", user_id)
        supabase.table("push_devices").update(seen).eq("tenant_id", tenant_id).eq("user_id", user_id).eq(
            "expo_push_token", token
        ).is_("revoked_at", "null").execute()


def revoke_device(tenant_id: str, user_id: str, token: str, reason: str = "signed_out") -> None:
    """Detach a registration, only ever the caller's own and only the named token."""
    (
        supabase.table("push_devices").update({"revoked_at": _now(), "revoke_reason": reason})
        .eq("tenant_id", tenant_id).eq("user_id", user_id).eq("expo_push_token", token)
        .is_("revoked_at", "null").execute()
    )


# --------------------------------------------------------------------------- delivery


def _build_messages(devices: list[dict], event_type: str, policy: PushPolicy, title: str, body: str, data: dict) -> list[dict]:
    messages, seen = [], set()
    for device in devices:
        token = device["expo_push_token"]
        if token in seen:  # a token is never messaged twice for one event
            continue
        seen.add(token)
        message = {
            "to": token,
            "title": title,
            "body": body,
            "data": {**data, "type": event_type},
            "channelId": policy.channel,
            "priority": "high" if policy.channel == CHANNEL_ALERTS else "default",
        }
        if policy.channel == CHANNEL_ALERTS:
            message["sound"] = "default"
        messages.append(message)
    return messages


def _tickets(payload: object, expected: int) -> list[dict]:
    tickets = (payload or {}).get("data") if isinstance(payload, dict) else None
    if isinstance(tickets, dict):
        tickets = [tickets]
    if not isinstance(tickets, list) or len(tickets) != expected:
        return [{"status": "error", "message": "malformed_response"}] * expected
    return [t if isinstance(t, dict) else {"status": "error", "message": "malformed_ticket"} for t in tickets]


async def send_push(
    *, tenant_id: str, recipient_ids: list[str], event_type: str, title: str, body: str,
    data: Optional[dict] = None, notification_ids: Optional[dict[str, str]] = None,
) -> dict:
    """Apply the policy and push one event to the recipients' devices. Best effort and never raises: the
    operational change and the inbox row already exist. Returns a summary (also used by tests):
    ``sent`` messages Expo accepted, ``opted_out`` recipients skipped by their own preference, ``no_device``
    recipients with nothing registered, ``failed`` messages Expo refused. Expo accepting a message is not
    proof the phone received it, so nothing here claims delivery."""
    summary = {"sent": 0, "opted_out": [], "no_device": [], "failed": 0}
    try:
        policy = PUSH_EVENTS.get(event_type)
        if policy is None:
            logger.warning("PUSH_UNKNOWN_EVENT type=%s", event_type)
            return summary
        recipients, summary["opted_out"] = should_push(tenant_id, recipient_ids, event_type)
        devices = active_devices(tenant_id, recipients)
        with_device = {d["user_id"] for d in devices}
        summary["no_device"] = [uid for uid in recipients if uid not in with_device]
        messages = _build_messages(devices, event_type, policy, title, body, data or {})
        if not messages:
            return summary
        owners = {d["expo_push_token"]: d for d in devices}
        for start in range(0, len(messages), EXPO_BATCH_SIZE):
            batch = messages[start : start + EXPO_BATCH_SIZE]
            try:
                async with httpx.AsyncClient(timeout=5.0) as client:
                    response = await client.post(EXPO_PUSH_URL, json=batch)
                payload = response.json() if response.status_code == 200 else None
            except Exception:  # noqa: BLE001 - provider outage: leave the inbox row as the only delivery
                logger.warning("PUSH_PROVIDER_UNREACHABLE type=%s", event_type, exc_info=True)
                payload = None
            for message, ticket in zip(batch, _tickets(payload, len(batch))):
                device = owners[message["to"]]
                _record_ticket(tenant_id, device, ticket, notification_ids, summary)
    except Exception:  # noqa: BLE001 - push is an extra; never fail the caller's committed change
        logger.warning("PUSH_DISPATCH_FAILED type=%s", event_type, exc_info=True)
    return summary


def _record_ticket(tenant_id: str, device: dict, ticket: dict, notification_ids: Optional[dict[str, str]], summary: dict) -> None:
    user_id = device["user_id"]
    notification_id = (notification_ids or {}).get(user_id)
    ok = ticket.get("status") == "ok"
    error = (ticket.get("details") or {}).get("error") or ticket.get("message") or "unknown"
    if ok:
        summary["sent"] += 1
    else:
        summary["failed"] += 1
        if error == "DeviceNotRegistered":  # permanent: the install is gone, stop messaging it
            (
                supabase.table("push_devices").update({"revoked_at": _now(), "revoke_reason": "device_not_registered"})
                .eq("id", device["id"]).execute()
            )
    if not notification_id:
        return
    if ok:
        supabase.table("notifications").update(
            {"push_sent": True, "push_sent_at": _now(), "expo_push_ticket": ticket.get("id")}
        ).eq("id", notification_id).eq("tenant_id", tenant_id).execute()
    # "queued" = accepted by Expo, which is not proof of delivery to the phone.
    supabase.table("notification_deliveries").insert(
        {
            "tenant_id": tenant_id, "notification_id": notification_id, "user_id": user_id, "channel": "push",
            "status": "queued" if ok else "failed",
            "provider_message_id": ticket.get("id") if ok else None,
            "failure_reason": None if ok else str(error)[:200],
        }
    ).execute()
