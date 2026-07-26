"""Cron health staleness must respect each job's own cadence, not a flat threshold.

Regression for the bug where a single 65-minute threshold reported every daily and
monthly cron as "stale" ~23h/day even when it had run exactly on schedule — which is
why production /health showed all 11 jobs stale despite the GitHub Actions crons
firing successfully.
"""
from datetime import datetime, timedelta, timezone

import main

NOW = datetime.now(timezone.utc)


def _ago(minutes: float) -> str:
    return (NOW - timedelta(minutes=minutes)).isoformat()


def test_never_run_job_is_pending_not_stale():
    # billing.monthly-trueup is seeded but has never fired on this account.
    assert main._cron_status("billing.monthly-trueup", None, NOW) == "pending"


def test_frequent_job_within_cadence_is_ok():
    assert main._cron_status("predictions.run", _ago(20), NOW) == "ok"


def test_frequent_job_past_cadence_is_stale():
    # The genuine failure mode: a */30 job that has not run in 3.5h.
    assert main._cron_status("escalations.check", _ago(210), NOW) == "stale"


def test_daily_job_run_today_is_ok_not_stale():
    # The core false-positive: a `0 6` UTC job checked ~19h later, still healthy.
    assert main._cron_status("evidence.reminders", _ago(19 * 60), NOW) == "ok"


def test_daily_job_missed_more_than_a_day_is_stale():
    assert main._cron_status("evidence.reminders", _ago(30 * 60), NOW) == "stale"


def test_shift_summary_between_eight_hour_runs_is_ok():
    assert main._cron_status("logbook.shift-summary", _ago(7 * 60), NOW) == "ok"


def test_monthly_billing_mid_month_is_ok():
    assert main._cron_status("billing.monthly-trueup", _ago(10 * 24 * 60), NOW) == "ok"


def test_unknown_job_falls_back_to_daily_default():
    assert main._cron_status("some.new-job", _ago(19 * 60), NOW) == "ok"
    assert main._cron_status("some.new-job", _ago(30 * 60), NOW) == "stale"
