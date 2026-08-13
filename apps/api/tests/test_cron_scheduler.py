"""The in-process cron scheduler must register every job with the right schedule
and start only in production.

This replaces the retired GitHub Actions cron workflow, which dropped/delayed the
*/30 runs by up to ~2.4h. Guarding on production keeps it from firing against the
prod database from a local dev machine or the test suite.
"""
import core.scheduler as sched

# The 13 cron jobs the retired cron-jobs.yml drove, plus predictions.escalation-check
# (Phase 29, AI-12/AI-14 GM escalation cron).
EXPECTED_JOBS = {
    "predictions.run",
    "opera.sync-reservations",
    "escalations.check",
    "predictions.escalation-check",
    "pm.check-due",
    "reports.daily-summary-email",
    "evidence.reminders",
    "safety.training-assignments",
    "safety.drill-follow-up",
    "lost-found.retention-check",
    "logbook.shift-summary",
    "ai.failure-predictions",
    "logbook.cleanup-expired",
    "billing.monthly-trueup",
}


def test_schedule_and_handlers_cover_the_same_jobs():
    # build_scheduler() also enforces this, but assert it directly so a missing
    # handler fails loudly rather than silently dropping a cron.
    assert set(sched.CRON_SCHEDULE) == EXPECTED_JOBS
    assert set(sched._job_handlers()) == EXPECTED_JOBS


def test_build_scheduler_registers_every_job():
    scheduler = sched.build_scheduler()
    assert {j.id for j in scheduler.get_jobs()} == EXPECTED_JOBS


def test_frequent_jobs_fire_every_30_minutes():
    scheduler = sched.build_scheduler()
    for job_id in ("predictions.run", "opera.sync-reservations", "escalations.check"):
        assert "*/30" in str(scheduler.get_job(job_id).trigger)


def test_billing_job_is_month_end_only():
    scheduler = sched.build_scheduler()
    trigger = str(scheduler.get_job("billing.monthly-trueup").trigger)
    assert "28-31" in trigger


def test_scheduler_only_runs_in_production(monkeypatch):
    monkeypatch.setattr(sched.settings, "cron_scheduler_enabled", True)

    monkeypatch.setattr(sched.settings, "app_env", "development")
    assert sched.should_run_scheduler() is False

    monkeypatch.setattr(sched.settings, "app_env", "production")
    assert sched.should_run_scheduler() is True


def test_kill_switch_disables_scheduler_in_production(monkeypatch):
    monkeypatch.setattr(sched.settings, "app_env", "production")
    monkeypatch.setattr(sched.settings, "cron_scheduler_enabled", False)
    assert sched.should_run_scheduler() is False
