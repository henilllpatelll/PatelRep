"""In-process cron scheduler.

Replaces the GitHub Actions cron workflow, which dropped/delayed the ``*/30``
runs by up to ~2.4h (the escalation SLA ladder ran hours late). The API runs a
single replica, so one ``AsyncIOScheduler`` here fires every job on time with no
risk of double-execution. Each job invokes the same ``routers.internal`` endpoint
coroutine the HTTP crons used, so behaviour and ``cron_health`` recording are
unchanged — only the trigger source moves from GitHub Actions into the process.
"""
from __future__ import annotations

import logging
from typing import Awaitable, Callable

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from core.config import settings

logger = logging.getLogger(__name__)

# job_id -> CronTrigger kwargs. Schedules mirror the retired cron-jobs.yml exactly
# (all times UTC).
CRON_SCHEDULE: dict[str, dict] = {
    # Frequent group — every 30 minutes.
    "predictions.run": {"minute": "*/30"},
    "opera.sync-reservations": {"minute": "*/30"},
    "escalations.check": {"minute": "*/30"},
    "predictions.escalation-check": {"minute": "*/30"},
    # Daily 06:00.
    "pm.check-due": {"hour": 6, "minute": 0},
    "reports.daily-summary-email": {"hour": 6, "minute": 0},
    "evidence.reminders": {"hour": 6, "minute": 0},
    "safety.training-assignments": {"hour": 6, "minute": 0},
    "safety.drill-follow-up": {"hour": 6, "minute": 0},
    "lost-found.retention-check": {"hour": 6, "minute": 0},
    # Shift-end summaries at 07:00, 15:00, 23:00.
    "logbook.shift-summary": {"hour": "7,15,23", "minute": 0},
    # Nightly.
    "ai.failure-predictions": {"hour": 0, "minute": 0},
    "logbook.cleanup-expired": {"hour": 3, "minute": 0},
    # Month-end.
    "billing.monthly-trueup": {"day": "28-31", "hour": 0, "minute": 0},
}


def should_run_scheduler() -> bool:
    """Run only in production, and only when not force-disabled.

    The kill-switch (``cron_scheduler_enabled``) lets ops stop the scheduler in
    production without a code change; local dev and tests never start it because
    ``app_env`` is not ``production`` there.
    """
    return settings.app_env == "production" and settings.cron_scheduler_enabled


def _job_handlers() -> dict[str, Callable[..., Awaitable]]:
    """Map job ids to their internal endpoint coroutines.

    Imported lazily so this core module does not pull the routers layer in at
    import time.
    """
    from routers import internal

    return {
        "predictions.run": internal.run_predictions,
        "opera.sync-reservations": internal.sync_opera_reservations,
        "escalations.check": internal.check_escalations,
        "predictions.escalation-check": internal.check_prediction_escalations,
        "pm.check-due": internal.check_due_pm,
        "reports.daily-summary-email": internal.send_daily_summary_emails,
        "evidence.reminders": internal.send_evidence_reminders,
        "safety.training-assignments": internal.schedule_safety_training_assignments,
        "safety.drill-follow-up": internal.escalate_missing_drill_follow_up,
        "lost-found.retention-check": internal.check_lost_found_retention,
        "logbook.shift-summary": internal.generate_shift_summaries,
        "ai.failure-predictions": internal.run_failure_predictions,
        "logbook.cleanup-expired": internal.cleanup_expired_logbook_entries,
        "billing.monthly-trueup": internal.monthly_trueup,
    }


def _make_job(job_id: str, handler: Callable[..., Awaitable]) -> Callable[[], Awaitable]:
    """Wrap an endpoint coroutine so a single failure never stops the scheduler.

    Errors are logged here; each handler still records its own failure to
    ``cron_health`` for /health visibility.
    """

    async def _run() -> None:
        try:
            await handler(x_cron_secret=settings.cron_secret)
        except Exception:
            logger.exception("Scheduled cron job %s failed", job_id)

    _run.__name__ = "cron_" + job_id.replace(".", "_").replace("-", "_")
    return _run


def build_scheduler() -> AsyncIOScheduler:
    """Build (but do not start) the scheduler with every cron job registered."""
    handlers = _job_handlers()
    mismatch = set(CRON_SCHEDULE) ^ set(handlers)
    if mismatch:
        raise RuntimeError(f"cron schedule/handler mismatch: {sorted(mismatch)}")

    scheduler = AsyncIOScheduler(
        timezone="UTC",
        job_defaults={"coalesce": True, "max_instances": 1, "misfire_grace_time": 3600},
    )
    for job_id, cron_kwargs in CRON_SCHEDULE.items():
        scheduler.add_job(
            _make_job(job_id, handlers[job_id]),
            trigger=CronTrigger(timezone="UTC", **cron_kwargs),
            id=job_id,
            name=job_id,
            replace_existing=True,
        )
    return scheduler
