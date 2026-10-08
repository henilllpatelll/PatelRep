"""Durable, idempotent scheduled-report delivery.

Safety properties
* Claiming: a due schedule is claimed with a compare-and-swap on ``next_run_at``; only one
  worker/replica wins. The ``report_deliveries.idempotency_key`` UNIQUE constraint is the
  second guard (a duplicate insert is skipped, never re-sent).
* Missed occurrences (outage longer than ``MISSED_GRACE``) are recorded as ``skipped`` and
  the schedule jumps to its next future occurrence — no flood of stale reports.
* Authorization is re-evaluated at send time: schedule still enabled, creator still active
  with access to the report, every recipient still active and eligible for that scope.
* Outcomes are honest: ``sent`` means the provider accepted the message (its id is stored);
  ``not_configured`` means nothing was sent; ``failed`` records a sanitized reason and retries
  transient errors with backoff up to ``MAX_ATTEMPTS``.
"""
from __future__ import annotations

import logging
from datetime import datetime, time, timedelta, timezone
from html import escape
from typing import Optional

from middleware.auth import CurrentUser
from services import email_delivery
from services.reporting import schedule as sched
from services.reporting.access import can_view, departments_for_role, effective_departments
from services.reporting.documents import build_document, render_document
from services.reporting.kpi import ReportContext
from services.reporting.periods import resolve_period, resolve_timezone

logger = logging.getLogger(__name__)

MISSED_GRACE = timedelta(hours=12)
MAX_ATTEMPTS = 3
STALE_AFTER = timedelta(minutes=30)  # a worker that died mid-attempt leaves a row stuck in queued/sending
RETRY_BACKOFF = (timedelta(minutes=10), timedelta(hours=1), timedelta(hours=4))
BATCH_LIMIT = 100

FREQUENCY_LABEL = {"daily": "Daily", "weekly": "Weekly", "monthly": "Monthly"}


def parse_time(value) -> time:
    if isinstance(value, time):
        return value
    parts = str(value).split(":")
    return time(int(parts[0]), int(parts[1]))


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.astimezone(timezone.utc).isoformat() if dt else None


def schedule_next_run(row: dict, after: Optional[datetime] = None) -> datetime:
    return sched.next_run(
        row["frequency"], parse_time(row["local_time"]), resolve_timezone(row.get("timezone")),
        day_of_week=row.get("day_of_week"), day_of_month=row.get("day_of_month"), after=after,
    )


# ── Eligibility ──────────────────────────────────────────────────────────────


def active_roles(supabase, hotel_id: str, user_ids: list[str]) -> dict[str, str]:
    if not user_ids:
        return {}
    rows = supabase.table("user_roles").select("user_id, role").eq("tenant_id", hotel_id).eq("is_active", True).in_("user_id", user_ids).execute().data or []
    return {r["user_id"]: r["role"] for r in rows}


def recipient_can_receive(recipient_role: str, view: str, scope_departments: tuple[str, ...]) -> bool:
    """A recipient may receive a report only if they could open that view AND see every department in it."""
    return can_view(recipient_role, view) and set(scope_departments) <= set(departments_for_role(recipient_role))


def resolve_emails(supabase, user_ids: list[str]) -> dict[str, str]:
    emails: dict[str, str] = {}
    if not user_ids:
        return emails
    # One lookup per recipient (at most 25): list_users() returns a single page, so a hotel with
    # more auth users than that page would silently lose recipients.
    for uid in dict.fromkeys(user_ids):
        try:
            found = supabase.auth.admin.get_user_by_id(uid)
            user = getattr(found, "user", found)
            email = getattr(user, "email", None)
            if email:
                emails[uid] = email
        except Exception:  # auth API hiccup -> this recipient is treated as "no email", surfaced in the delivery row
            logger.warning("auth admin lookup failed while resolving a report recipient")
    return emails


# ── One delivery attempt ─────────────────────────────────────────────────────


def _summary_html(doc: dict, schedule: dict) -> tuple[str, str]:
    lines = []
    for k in doc.get("summary", []):
        value = "—" if k["value"] is None else f"{k['value']}{'%' if k.get('unit') == 'percent' else ''}"
        lines.append((k["label"], value))
    period = doc["period"]
    exceptions = [e for e in doc.get("exceptions", [])[:5]]
    text = [f"{doc['title']} — {doc['hotel_name']}", f"Period: {period['start']} to {period['end']} ({period['timezone']})", ""]
    text += [f"{label}: {value}" for label, value in lines]
    if exceptions:
        text += ["", "Needs attention:"] + [f"- {e['title']} ({e['count']})" for e in exceptions]
    text += ["", f"Generated {doc['generated_at']}. The full report is attached ({schedule['output_format'].upper()})."]
    rows = "".join(f"<tr><td style='padding:4px 12px 4px 0;color:#6b7280'>{escape(a)}</td><td style='padding:4px 0'><b>{escape(b)}</b></td></tr>" for a, b in lines)
    exc = "".join(f"<li>{escape(e['title'])} ({e['count']})</li>" for e in exceptions)
    html = (
        f"<div style='font-family:Arial,sans-serif;color:#1f2937;max-width:560px'>"
        f"<h2 style='margin:0 0 4px'>{escape(doc['title'])}</h2>"
        f"<p style='margin:0 0 12px;color:#6b7280'>{escape(doc['hotel_name'])} · {period['start']} to {period['end']} ({escape(period['timezone'])})</p>"
        f"<table>{rows}</table>"
        + (f"<p style='margin:12px 0 4px'><b>Needs attention</b></p><ul>{exc}</ul>" if exc else "")
        + f"<p style='color:#6b7280;font-size:12px'>Generated {escape(doc['generated_at'])}. The full report is attached ({schedule['output_format'].upper()}).</p></div>"
    )
    return html, "\n".join(text)


def _finish(supabase, delivery_id: str, **patch) -> dict:
    patch.setdefault("completed_at", _now().isoformat())
    supabase.table("report_deliveries").update(patch).eq("id", delivery_id).execute()
    return patch


async def attempt_delivery(supabase, delivery: dict, now: Optional[datetime] = None) -> dict:
    """Run one attempt for an existing delivery row. Never raises; returns the stored outcome."""
    now = now or _now()
    did = delivery["id"]
    attempts = (delivery.get("attempts") or 0) + 1
    # Compare-and-swap on the status we read: of two workers (or a worker and a manual retry) holding the
    # same row, only one flips it to "sending" and sends.
    claimed = supabase.table("report_deliveries").update(
        {"status": "sending", "attempts": attempts, "started_at": now.isoformat(), "next_retry_at": None, "error_summary": None}
    ).eq("id", did).eq("status", delivery.get("status") or "queued").execute()
    if not claimed.data:
        return {"status": "claimed_elsewhere"}

    row = supabase.table("report_schedules").select("*").eq("id", delivery["schedule_id"]).eq("tenant_id", delivery["tenant_id"]).maybe_single().execute()
    schedule = row.data if row else None
    if not schedule or not schedule.get("enabled"):
        return _finish(supabase, did, status="skipped", error_summary="Schedule was paused or deleted before sending.")

    hotel_id = schedule["tenant_id"]
    try:
        owner = schedule.get("created_by")
        creator_role = active_roles(supabase, hotel_id, [owner] if owner else []).get(owner)
        if not creator_role or not can_view(creator_role, schedule["report_type"]):
            return _finish(supabase, did, status="failed", error_summary="The schedule owner no longer has access to this report.")
        filters = schedule.get("filters") or {}
        scope = effective_departments(creator_role, filters.get("department"))

        roles = active_roles(supabase, hotel_id, list(schedule.get("recipient_ids") or []))
        eligible = [uid for uid, role in roles.items() if recipient_can_receive(role, schedule["report_type"], scope)]
        if not eligible:
            return _finish(supabase, did, status="failed", recipient_count=0, error_summary="No eligible recipients remain for this report.")

        if not email_delivery.is_configured():
            return _finish(supabase, did, status="not_configured", recipient_count=len(eligible),
                           error_summary="Email delivery is not configured; nothing was sent.")

        emails = resolve_emails(supabase, eligible)
        to = sorted(set(emails.values()))
        if not to:
            return _finish(supabase, did, status="failed", recipient_count=len(eligible), error_summary="No recipient has an email address on file.")

        tz = resolve_timezone(schedule["timezone"])
        occurrence = datetime.fromisoformat(str(delivery["scheduled_occurrence"]).replace("Z", "+00:00"))
        start, end = sched.window_for(schedule["reporting_window"], occurrence, tz)
        period = resolve_period(start, end, tz, now=occurrence)
        ctx = ReportContext(
            supabase=supabase, hotel_id=hotel_id, user_id=schedule["created_by"], role=creator_role, tz=tz, period=period,
            departments=scope, user=CurrentUser(user_id=schedule["created_by"], hotel_id=hotel_id, role=creator_role),
        )
        doc = await build_document(
            schedule["report_type"], ctx, include_charts=schedule["output_format"] == "pdf",
            include_definitions=bool(filters.get("include_definitions", True)),
        )
        data, _media, filename = render_document(doc, schedule["output_format"])
        html, text = _summary_html(doc, schedule)
        subject = f"[{doc['hotel_name']}] — {FREQUENCY_LABEL[schedule['frequency']]} {doc['title']} Report"
        message_id = email_delivery.send_email(
            to=to, subject=subject, html=html, text=text,
            attachments=[email_delivery.Attachment(filename=filename, content=data)], idempotency_key=delivery["idempotency_key"],
        )
        return _finish(supabase, did, status="sent", recipient_count=len(to), provider_message_id=message_id)
    except email_delivery.EmailError as exc:
        return _failed(supabase, did, attempts, exc.summary, retryable=exc.retryable, now=now)
    except Exception:
        logger.exception("Scheduled report generation failed (delivery=%s)", did)
        return _failed(supabase, did, attempts, "Report generation failed", retryable=True, now=now)


def _failed(supabase, delivery_id: str, attempts: int, summary: str, *, retryable: bool, now: datetime) -> dict:
    retry_at = None
    if retryable and attempts < MAX_ATTEMPTS:
        retry_at = (now + RETRY_BACKOFF[min(attempts - 1, len(RETRY_BACKOFF) - 1)]).isoformat()
    return _finish(supabase, delivery_id, status="failed", error_summary=summary[:300], next_retry_at=retry_at)


# ── Scheduler tick ───────────────────────────────────────────────────────────


def _claim(supabase, schedule: dict, new_next_run: datetime, now: datetime) -> bool:
    """Compare-and-swap ``next_run_at``; True only for the single winning worker."""
    result = (
        supabase.table("report_schedules")
        .update({"next_run_at": new_next_run.isoformat(), "last_run_at": now.isoformat()})
        .eq("id", schedule["id"]).eq("next_run_at", schedule["next_run_at"]).eq("enabled", True)
        .execute()
    )
    return bool(result.data)


async def run_due(supabase, now: Optional[datetime] = None) -> dict:
    """Process due schedules and retry transient failures. Safe to run on every replica."""
    now = now or _now()
    summary = {"claimed": 0, "sent": 0, "failed": 0, "skipped": 0, "not_configured": 0, "retried": 0}

    due = supabase.table("report_schedules").select("*").eq("enabled", True).lte("next_run_at", now.isoformat()).limit(BATCH_LIMIT).execute().data or []
    for schedule in due:
        occurrence = datetime.fromisoformat(str(schedule["next_run_at"]).replace("Z", "+00:00"))
        stale = now - occurrence > MISSED_GRACE
        next_run = schedule_next_run(schedule, after=now if stale else occurrence)
        if not _claim(supabase, schedule, next_run, now):
            continue  # another worker claimed this occurrence
        key = sched.idempotency_key(schedule["id"], occurrence)
        try:
            created = supabase.table("report_deliveries").insert({
                "tenant_id": schedule["tenant_id"], "schedule_id": schedule["id"], "scheduled_occurrence": occurrence.isoformat(),
                "idempotency_key": key, "status": "skipped" if stale else "queued",
                "error_summary": "Occurrence missed while the service was unavailable; not sent late." if stale else None,
                "completed_at": now.isoformat() if stale else None,
            }).execute().data
        except Exception:  # unique violation: this occurrence already has a delivery row
            continue
        summary["claimed"] += 1
        if stale:
            summary["skipped"] += 1
            continue
        outcome = await attempt_delivery(supabase, created[0], now)
        summary[outcome.get("status", "failed")] = summary.get(outcome.get("status", "failed"), 0) + 1

    await _recover_stuck(supabase, now, summary)

    retry = supabase.table("report_deliveries").select("*").eq("status", "failed").lte("next_retry_at", now.isoformat()).limit(BATCH_LIMIT).execute().data or []
    for delivery in retry:
        if (delivery.get("attempts") or 0) >= MAX_ATTEMPTS:
            continue
        outcome = await attempt_delivery(supabase, delivery, now)
        if outcome.get("status") != "claimed_elsewhere":
            summary["retried"] += 1
    return summary


async def _recover_stuck(supabase, now: datetime, summary: dict) -> None:
    """Rows orphaned by a crash. ``queued`` never started -> run it; ``sending`` is of unknown outcome ->
    mark failed so the normal bounded retry applies (the provider idempotency key prevents a double send)."""
    cutoff = (now - STALE_AFTER).isoformat()
    queued = supabase.table("report_deliveries").select("*").eq("status", "queued").lte("created_at", cutoff).limit(BATCH_LIMIT).execute().data or []
    for delivery in queued:
        outcome = await attempt_delivery(supabase, delivery, now)
        if outcome.get("status") != "claimed_elsewhere":
            summary["recovered"] = summary.get("recovered", 0) + 1
    sending = supabase.table("report_deliveries").select("*").eq("status", "sending").lte("started_at", cutoff).limit(BATCH_LIMIT).execute().data or []
    for delivery in sending:
        attempts = delivery.get("attempts") or 0
        retry_at = now.isoformat() if attempts < MAX_ATTEMPTS else None
        reset = supabase.table("report_deliveries").update({
            "status": "failed", "completed_at": now.isoformat(), "next_retry_at": retry_at,
            "error_summary": "The delivery was interrupted before it finished" + ("; it will be retried." if retry_at else "."),
        }).eq("id", delivery["id"]).eq("status", "sending").execute()
        if reset.data:
            summary["recovered"] = summary.get("recovered", 0) + 1

