"""Schedule notification outbox: enqueue, deliver, retry (Team Scheduling Phase 7).

THREE STEPS, ALWAYS SEPARATE
  1. INTENT  a row in `schedule_notifications`. Publication writes its rows inside the publish transaction (SQL);
             request workflows (time off, swaps, offers, claims) call `enqueue()` right after their own commit.
  2. INBOX   `process_batch()` claims due rows (multi-replica safe, `FOR UPDATE SKIP LOCKED`), creates the in-app
             `notifications` row (idempotent through `dedupe_key`) and marks the intent `sent`. THE INBOX ROW IS THE
             RELIABLE BASELINE: "sent" means "the person can read it in the app", never "a phone buzzed".
  3. PUSH    an extra through the existing Expo path (`services.notify.send_push`). It never fails the intent. What it
             records is only what the provider said: `accepted` (Expo took the message; not proof of delivery),
             `failed`, `no_device`, `opted_out`. Email is not used for schedule events: it is not a prerequisite and the
             existing sender targets reports, so nothing here claims or attempts it.

A delivery failure never touches the schedule (publication already committed). Failures retry with bounded backoff
(`schedule_revisions.backoff_seconds`) and stop after 5 attempts; a manager can reset them explicitly.

PRIVACY. Texts are built here from ids, dates and counts only. Leave reasons, call-out notes and manager-only draft
reasons are never read, so they cannot reach an employee's phone. The lock-screen text is generic; the inbox row
carries the fuller wording and an `i18n` key so the app renders it in the person's language.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Optional

from core.database import supabase
from services import notify
from services.revision_store import record_event
from services.schedule_revisions import MAX_ATTEMPTS, backoff_seconds

logger = logging.getLogger(__name__)

# event -> (screen the app opens, lock-screen title, lock-screen body)
EVENTS: dict[str, tuple[str, str, str]] = {
    "schedule_published": ("my_schedule", "Schedule updated", "Open PatelRep to see your schedule."),
    "schedule_offer_received": ("offers", "Shift offer", "Open PatelRep to respond."),
    "schedule_offer_withdrawn": ("offers", "Shift offer withdrawn", "An offer was withdrawn."),
    "schedule_offer_accepted": ("coverage", "Offer accepted", "Open PatelRep to review."),
    "schedule_offer_declined": ("coverage", "Offer declined", "Open PatelRep to review."),
    "schedule_open_shift": ("open_shifts", "Open shift", "A shift you can take is open."),
    "schedule_claim_submitted": ("team_requests", "Shift request", "Open PatelRep to review."),
    "schedule_claim_approved": ("open_shifts", "Shift request approved", "Open PatelRep to see your schedule."),
    "schedule_claim_declined": ("open_shifts", "Shift request declined", "Open PatelRep for details."),
    "schedule_time_off_requested": ("team_requests", "Time-off request", "Open PatelRep to review."),
    "schedule_time_off_approved": ("my_requests", "Time off approved", "Open PatelRep for details."),
    "schedule_time_off_denied": ("my_requests", "Time off decided", "Open PatelRep for details."),
    "schedule_swap_proposed": ("my_requests", "Shift swap request", "Open PatelRep to respond."),
    "schedule_swap_accepted": ("my_requests", "Shift swap accepted", "Open PatelRep for details."),
    "schedule_swap_declined": ("my_requests", "Shift swap declined", "Open PatelRep for details."),
    "schedule_swap_needs_approval": ("team_requests", "Shift swap to approve", "Open PatelRep to review."),
    "schedule_swap_approved": ("my_requests", "Shift swap approved", "Open PatelRep to see your schedule."),
    "schedule_swap_denied": ("my_requests", "Shift swap not approved", "Open PatelRep for details."),
}

_ID_KEYS = ("revision_id", "assignment_id", "offer_id", "gap_id", "claim_id", "request_id", "swap_id")
_PARAM_KEYS = ("added", "changed", "cancelled", "removed", "first_date", "work_date")
_FALLBACK_BODY = {
    "schedule_published": "Your schedule has changed. Open it to see what is different.",
    "schedule_offer_received": "You have a shift offer. Open it to accept or decline.",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def render(event_type: str, payload: dict) -> Optional[dict]:
    """The inbox row for an event, or None for an event this module does not know (never delivered by guesswork)."""
    spec = EVENTS.get(event_type)
    if spec is None:
        return None
    screen, title, _lock_body = spec
    data: dict[str, Any] = {"kind": "schedule", "screen": screen, "event": event_type}
    for key in _ID_KEYS:
        if payload.get(key):
            data[key] = str(payload[key])
    params = {key: payload[key] for key in _PARAM_KEYS if payload.get(key) is not None}
    if params:
        data["params"] = params
    data["i18n"] = {"key": f"scheduleNotice.{event_type.removeprefix('schedule_')}", "params": params}
    body = _FALLBACK_BODY.get(event_type) or "Open PatelRep for details."
    if event_type == "schedule_published":
        bits = [f"{params[k]} {label}" for k, label in (("added", "added"), ("changed", "changed"), ("cancelled", "cancelled"), ("removed", "removed")) if params.get(k)]
        if bits:
            body = f"Your schedule changed: {', '.join(bits)}."
        if params.get("first_date"):
            body += f" Starting {params['first_date']}."
    return {"type": event_type, "title": title, "body": body, "data": data}


def enqueue(tenant_id: str, user_ids: Iterable[str], event_type: str, key: str, payload: Optional[dict] = None,
            revision_id: Optional[str] = None) -> int:
    """
    Record an intent per recipient. Idempotent: the same (event, key, person) is stored once, so a retried request
    cannot message twice. Best effort by design for request workflows: a failure here is logged and returns 0, it
    never fails the caller's committed change.
    """
    if event_type not in EVENTS:
        logger.warning("SCHEDULE_NOTIFY_UNKNOWN_EVENT type=%s", event_type)
        return 0
    rows = [
        {"tenant_id": tenant_id, "user_id": uid, "event_type": event_type, "dedupe_key": f"{event_type}:{key}:{uid}",
         "revision_id": revision_id, "payload": payload or {}}
        for uid in dict.fromkeys(str(u) for u in user_ids if u)
    ]
    if not rows:
        return 0
    try:
        supabase.table("schedule_notifications").upsert(rows, on_conflict="tenant_id,dedupe_key", ignore_duplicates=True).execute()
    except Exception:
        logger.warning("SCHEDULE_NOTIFY_ENQUEUE_FAILED type=%s", event_type, exc_info=True)
        return 0
    return len(rows)


def department_of(tenant_id: str, user_id: str) -> Optional[str]:
    """The department a person works in (None when it cannot be determined; never guessed)."""
    from services.scheduling_access import load_departments, load_staff

    try:
        member = load_staff(tenant_id, load_departments(tenant_id), [user_id]).get(user_id)
    except Exception:
        logger.warning("SCHEDULE_NOTIFY_DEPARTMENT_FAILED", exc_info=True)
        return None
    return member.department_id if member else None


def managers_of(tenant_id: str, department_id: Optional[str], *, exclude: Iterable[str] = ()) -> list[str]:
    """Active schedule managers whose scope covers a department (GM covers all). Used for supervisor-facing events."""
    from core.roles import SCHEDULE_MANAGER_ROLES
    from services.scheduling_access import load_departments
    from services.scheduling_contracts import MANAGER_DEPARTMENT_CODES

    try:
        departments = load_departments(tenant_id)
        code = departments.code_by_id.get(str(department_id)) if department_id else None
        rows = (supabase.table("user_roles").select("user_id, role").eq("tenant_id", tenant_id).eq("is_active", True)
                .in_("role", list(SCHEDULE_MANAGER_ROLES)).execute().data or [])
    except Exception:
        logger.warning("SCHEDULE_NOTIFY_MANAGERS_FAILED", exc_info=True)
        return []
    skip = {str(x) for x in exclude}
    out: list[str] = []
    for row in rows:
        scope = MANAGER_DEPARTMENT_CODES.get(row["role"])
        if str(row["user_id"]) not in skip and (scope is None or (code is not None and code in scope)):
            out.append(str(row["user_id"]))
    return list(dict.fromkeys(out))


async def process_batch(limit: int = 50, revision_id: Optional[str] = None) -> dict:
    """
    Deliver due intents. Safe to run from several places at once (the claim is `SKIP LOCKED`) and safe to repeat
    (the inbox row is created at most once per intent). Returns counts for the caller and tests.
    """
    summary = {"claimed": 0, "sent": 0, "failed": 0, "exhausted": 0, "push_accepted": 0}
    try:
        claimed = supabase.rpc("claim_schedule_notifications", {"p_limit": limit, "p_revision_id": revision_id}).execute().data or []
    except Exception:
        logger.warning("SCHEDULE_NOTIFY_CLAIM_FAILED", exc_info=True)
        return summary
    per_revision: dict[str, dict] = {}
    for row in claimed:
        summary["claimed"] += 1
        outcome = await _deliver(row)
        summary[outcome] = summary.get(outcome, 0) + 1
        if outcome == "sent" and row.get("push_status_after") == "accepted":
            summary["push_accepted"] += 1
        rev = row.get("revision_id")
        if rev:
            slot = per_revision.setdefault(str(rev), {"sent": 0, "failed": 0})
            if outcome == "sent":
                slot["sent"] += 1
            elif outcome == "exhausted":
                slot["failed"] += 1
    for rev, counts in per_revision.items():
        tenant = next((r["tenant_id"] for r in claimed if str(r.get("revision_id")) == rev), None)
        if not tenant:
            continue
        if counts["sent"]:
            record_event(str(tenant), rev, "notification_sent", None, {"count": counts["sent"]})
        if counts["failed"]:
            record_event(str(tenant), rev, "notification_failed", None, {"count": counts["failed"]})
    return summary


async def _deliver(row: dict) -> str:
    tenant_id, user_id, row_id = str(row["tenant_id"]), str(row["user_id"]), str(row["id"])
    attempts = int(row.get("attempts") or 1)
    try:
        content = render(row["event_type"], row.get("payload") or {})
        if content is None:
            _finish(row_id, status="skipped", error="unknown_event")
            return "skipped"  # nothing to retry; the row is closed so a poisoned event cannot be claimed forever
        notification_id = _ensure_inbox_row(tenant_id, user_id, row["dedupe_key"], content)
        push_status = "not_applicable"
        spec = EVENTS[row["event_type"]]
        if row["event_type"] in notify.PUSH_EVENTS:
            summary = await notify.send_push(
                tenant_id=tenant_id, recipient_ids=[user_id], event_type=row["event_type"], title=spec[1], body=spec[2],
                data={"kind": "schedule", "screen": spec[0], **{k: v for k, v in content["data"].items() if k in _ID_KEYS}},
                notification_ids={user_id: notification_id},
            )
            push_status = ("accepted" if summary["sent"] else "failed" if summary["failed"] else "opted_out" if summary["opted_out"]
                           else "no_device" if summary["no_device"] else "not_applicable")
        row["push_status_after"] = push_status
        _finish(row_id, status="sent", notification_id=notification_id, push_status=push_status)
        _record_delivery(tenant_id, notification_id, user_id)
        _mark_offer(tenant_id, row, "sent")
        return "sent"
    except Exception as exc:  # noqa: BLE001 - one bad row must not stop the batch
        # Only the exception class is stored: a message could echo notification text.
        reason = type(exc).__name__
        delay = backoff_seconds(attempts)
        if delay is None:
            _finish(row_id, status="failed", error=reason, next_in=None)
            _mark_offer(tenant_id, row, "failed")
            logger.warning("SCHEDULE_NOTIFY_EXHAUSTED id=%s attempts=%s reason=%s", row_id, attempts, reason)
            return "exhausted"
        _finish(row_id, status="failed", error=reason, next_in=delay)
        return "failed"


def _mark_offer(tenant_id: str, row: dict, delivery: str) -> None:
    """Keep coverage_offers.delivery honest: 'sent' means the offer is readable in the employee's inbox, 'failed' after the last retry."""
    offer_id = (row.get("payload") or {}).get("offer_id")
    if row.get("event_type") != "schedule_offer_received" or not offer_id:
        return
    try:
        supabase.table("coverage_offers").update({"delivery": delivery}).eq("tenant_id", tenant_id).eq("id", str(offer_id)).execute()
    except Exception:
        logger.info("SCHEDULE_NOTIFY_OFFER_MARK_SKIPPED", exc_info=True)


def _ensure_inbox_row(tenant_id: str, user_id: str, dedupe_key: str, content: dict) -> str:
    existing = (supabase.table("notifications").select("id").eq("tenant_id", tenant_id).eq("dedupe_key", dedupe_key).limit(1).execute().data or [])
    if existing:
        return str(existing[0]["id"])
    try:
        created = supabase.table("notifications").insert({
            "tenant_id": tenant_id, "user_id": user_id, "type": content["type"], "title": content["title"], "body": content["body"],
            "data": content["data"], "dedupe_key": dedupe_key,
        }).execute().data or []
        return str(created[0]["id"])
    except Exception:
        # Lost a race with a concurrent identical delivery: the winner's row is the one.
        again = (supabase.table("notifications").select("id").eq("tenant_id", tenant_id).eq("dedupe_key", dedupe_key).limit(1).execute().data or [])
        if again:
            return str(again[0]["id"])
        raise


def _finish(row_id: str, *, status: str, notification_id: Optional[str] = None, push_status: Optional[str] = None,
            error: Optional[str] = None, next_in: Optional[int] = None) -> None:
    update: dict[str, Any] = {"status": status, "locked_until": None, "last_error": error, "processed_at": _now().isoformat()}
    if notification_id:
        update["notification_id"] = notification_id
    if push_status:
        update["push_status"] = push_status
    if next_in is not None:
        update["next_attempt_at"] = (_now() + timedelta(seconds=next_in)).isoformat()
    supabase.table("schedule_notifications").update(update).eq("id", row_id).execute()


def _record_delivery(tenant_id: str, notification_id: str, user_id: str) -> None:
    try:
        supabase.table("notification_deliveries").insert({
            "tenant_id": tenant_id, "notification_id": notification_id, "user_id": user_id, "channel": "in_app", "status": "delivered",
        }).execute()
    except Exception:
        logger.info("SCHEDULE_NOTIFY_DELIVERY_RECORD_SKIPPED", exc_info=True)


def revision_status(tenant_id: str, revision_id: str) -> dict:
    """What happened to a publication's messages, in words that never equate queued with delivered."""
    rows = (supabase.table("schedule_notifications").select("id, user_id, status, push_status, attempts, last_error, notification_id")
            .eq("tenant_id", tenant_id).eq("revision_id", revision_id).limit(1000).execute().data or [])
    by_status = {"queued": 0, "processing": 0, "sent": 0, "failed": 0, "skipped": 0}
    push = {"accepted": 0, "failed": 0, "no_device": 0, "opted_out": 0, "not_attempted": 0, "not_applicable": 0}
    failed = []
    for row in rows:
        by_status[row["status"]] = by_status.get(row["status"], 0) + 1
        push[row["push_status"]] = push.get(row["push_status"], 0) + 1
        if row["status"] == "failed":
            failed.append({"id": row["id"], "user_id": row["user_id"], "attempts": row["attempts"], "retryable": int(row["attempts"]) < MAX_ATTEMPTS,
                           "reason": row.get("last_error")})
    pending = by_status["queued"] + by_status["processing"] + sum(1 for f in failed if f["retryable"])
    if not rows:
        state = "none"
    elif pending:
        state = "processing"
    elif failed:
        state = "failed"
    else:
        state = "in_app_available"
    return {
        "state": state, "total": len(rows), "by_status": by_status, "push": push, "failed": failed[:50],
        # Spelled out for the app: delivery to the phone is never confirmed, and email is not used.
        "in_app_available": by_status["sent"], "delivery_confirmation": "not_supported", "email": "not_used",
    }
