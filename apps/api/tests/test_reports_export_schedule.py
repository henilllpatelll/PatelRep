"""Phase 4: exports, schedule recurrence (DST), schedule API authorization, durable delivery."""
import asyncio
from datetime import date, datetime, time, timedelta, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from main import app
from routers import management_roi as roi_router
from routers import report_exports as exports_router
from routers import report_views as views_router
from routers import reports as reports_router
from services import email_delivery
from services.reporting import delivery as delivery_service
from services.reporting import schedule as sched
from services.reporting.exports import csv_safe, render_csv, render_pdf, safe_filename
from tests.smoke.fake_supabase import FakeDB
from tests.test_reports_views import _fresh_rate_limits, at, auth, gr, iso, make_db, wo  # noqa: F401

CHI = ZoneInfo("America/Chicago")
NOW = datetime.now(timezone.utc)


# ── Exports ──────────────────────────────────────────────────────────────────


def test_csv_safe_neutralises_formulas_but_not_numbers():
    assert csv_safe("=1+1") == "'=1+1" and csv_safe("+cmd") == "'+cmd" and csv_safe("-2") == "'-2"
    assert csv_safe("@SUM(A1)") == "'@SUM(A1)" and csv_safe("\tx") == "'\tx"
    assert csv_safe("Plain") == "Plain" and csv_safe(5) == 5 and csv_safe(-3.5) == -3.5


def test_safe_filename_strips_path_and_odd_characters():
    assert "/" not in safe_filename("../../etc/passwd", "x y") and ".." not in safe_filename("../../etc/passwd")
    assert safe_filename("") == "report"


def _doc(**over):
    base = {
        "view": "maintenance", "title": "Maintenance Performance", "hotel_name": "=cmd()",
        "period": {"start": "2026-10-01", "end": "2026-10-07", "timezone": "America/Chicago"}, "comparison": None,
        "generated_at": "2026-10-08 12:00 UTC",
        "kpis": [{"label": "Maintenance SLA", "value": None, "unit": "percent", "availability": "not_applicable", "previous": None, "change": None, "eligible": 0, "note": "n/a"}],
        "tables": [{"title": "Rows", "columns": [{"key": "a", "label": "A"}], "rows": [{"a": "=HYPERLINK(1)"}, {"a": "ok"}]}],
        "charts": [{"title": "Trend", "points": [{"label": "2026-10-01", "value": 50}, {"label": "2026-10-02", "value": None}]}],
        "exceptions": [{"severity": "high", "title": "Overdue <script>", "detail": "x", "count": 2}],
        "definitions": [], "notes": ["note"],
    }
    base.update(over)
    return base


def test_csv_render_is_utf8_bom_escaped_and_does_not_fabricate_values():
    raw = render_csv(_doc())
    text = raw.decode("utf-8")
    assert raw.startswith("﻿".encode("utf-8"))
    assert "'=HYPERLINK(1)" in text and "\n=HYPERLINK" not in text and "'=cmd()" not in text.split("Property")[0]
    assert "Hotel =cmd()" not in text.replace("'Hotel", "")  # no raw formula cell
    kpi_row = next(line for line in text.splitlines() if line.startswith("Maintenance SLA"))
    assert kpi_row.startswith("Maintenance SLA,,percent")  # missing value stays empty, not 0


def test_pdf_render_produces_a_pdf_and_escapes_markup():
    pdf = render_pdf(_doc())
    assert pdf[:5] == b"%PDF-" and len(pdf) > 1000
    assert b"<script>" not in pdf
    assert render_pdf(_doc(tables=[], charts=[], exceptions=[]))[:5] == b"%PDF-"  # empty report still valid


def test_pdf_handles_large_tables_with_bounded_rows():
    rows = [{"a": f"row {i}"} for i in range(2000)]
    pdf = render_pdf(_doc(tables=[{"title": "Big", "columns": [{"key": "a", "label": "A"}], "rows": rows}]))
    assert pdf[:5] == b"%PDF-"


@pytest.fixture
def api(monkeypatch):
    def install(db):
        for module in (views_router, reports_router, roi_router, exports_router, delivery_service):
            if hasattr(module, "supabase"):
                monkeypatch.setattr(module, "supabase", db)
        return TestClient(app)
    return install


def test_export_endpoint_enforces_same_authorization_as_screens(api):
    http = api(make_db(work_orders=[wo("w1")]))
    ok = http.get("/v1/reports/export?view=maintenance&format=csv", headers=auth("chief_engineer"))
    assert ok.status_code == 200 and ok.headers["content-type"].startswith("text/csv")
    assert "attachment" in ok.headers["content-disposition"] and ok.headers["cache-control"] == "no-store"
    assert http.get("/v1/reports/export?view=management&format=csv", headers=auth("chief_engineer")).status_code == 403
    assert http.get("/v1/reports/export?view=housekeeping&format=pdf", headers=auth("chief_engineer")).status_code == 403
    assert http.get("/v1/reports/export?view=maintenance&format=csv", headers=auth("housekeeper")).status_code == 403
    assert http.get("/v1/reports/export?view=maintenance&format=xlsx", headers=auth("gm")).status_code == 422
    pdf = http.get("/v1/reports/export?view=overview&format=pdf", headers=auth("gm"))
    assert pdf.status_code == 200 and pdf.content[:5] == b"%PDF-"


def test_export_matches_screen_numbers_and_tenant(api):
    db = make_db(work_orders=[wo("w1"), {**wo("x"), "tenant_id": "hotel-b"}])
    http = api(db)
    screen = http.get("/v1/reports/views/maintenance", headers=auth("gm")).json()["data"]
    csv_text = http.get("/v1/reports/export?view=maintenance&format=csv", headers=auth("gm")).content.decode("utf-8")
    assert screen["totals"]["total_work_orders"] == 1
    assert "Maintenance SLA Compliance,100.0,percent" in csv_text
    assert "hotel-b" not in csv_text


def test_export_team_csv_only_includes_visible_staff(api):
    db = make_db(work_orders=[wo("w1", assigned_to="eng1")], tasks=[{"id": "t", "tenant_id": "hotel-a", "title": "x", "status": "completed",
                 "assigned_to": "hk1", "created_at": iso(at(3)), "due_at": None, "completed_at": iso(at(3, 15))}])
    http = api(db)
    chief = http.get("/v1/reports/export?view=team&format=csv", headers=auth("chief_engineer")).content.decode("utf-8")
    assert "Eli Engineer" in chief and "Hana Housekeeper" not in chief


# ── Recurrence / DST ─────────────────────────────────────────────────────────


def test_daily_next_run_is_hotel_local_wall_time():
    after = datetime(2026, 10, 7, 12, 0, tzinfo=timezone.utc)  # 07:00 CDT
    nxt = sched.next_run("daily", time(6, 0), CHI, after=after)
    assert nxt == datetime(2026, 10, 8, 11, 0, tzinfo=timezone.utc)  # 06:00 CDT next day


def test_daily_schedule_keeps_local_time_across_dst_fall_back():
    first = sched.next_run("daily", time(6, 0), CHI, after=datetime(2026, 10, 31, 0, 0, tzinfo=timezone.utc))  # Oct 31 06:00 CDT
    second = sched.next_run("daily", time(6, 0), CHI, after=first)  # Nov 1 (fall back) 06:00 CST
    third = sched.next_run("daily", time(6, 0), CHI, after=second)
    assert [d.astimezone(CHI).strftime("%m-%d %H:%M") for d in (first, second, third)] == ["10-31 06:00", "11-01 06:00", "11-02 06:00"]
    assert (second - first) == timedelta(hours=25)  # the transition day is 25h long; wall time unchanged
    assert (third - second) == timedelta(hours=24)


def test_nonexistent_spring_forward_time_fires_once_at_first_valid_instant():
    run = sched.next_run("daily", time(2, 30), CHI, after=datetime(2026, 3, 8, 0, 0, tzinfo=timezone.utc))
    assert run.astimezone(CHI).strftime("%Y-%m-%d %H:%M") == "2026-03-08 03:30"
    again = sched.next_run("daily", time(2, 30), CHI, after=run)
    assert again.astimezone(CHI).strftime("%Y-%m-%d") == "2026-03-09"  # not a second send on the 8th


def test_ambiguous_fall_back_time_fires_once():
    run = sched.next_run("daily", time(1, 30), CHI, after=datetime(2026, 11, 1, 0, 0, tzinfo=timezone.utc))
    again = sched.next_run("daily", time(1, 30), CHI, after=run)
    assert run.astimezone(CHI).date() == date(2026, 11, 1) and again.astimezone(CHI).date() == date(2026, 11, 2)


def test_weekly_and_monthly_recurrence():
    weekly = sched.next_run("weekly", time(8, 0), CHI, day_of_week=0, after=datetime(2026, 10, 7, 12, tzinfo=timezone.utc))  # Wed -> Mon
    assert weekly.astimezone(CHI).strftime("%a %Y-%m-%d") == "Mon 2026-10-12"
    monthly = sched.next_run("monthly", time(8, 0), CHI, day_of_month=1, after=datetime(2026, 10, 7, 12, tzinfo=timezone.utc))
    assert monthly.astimezone(CHI).strftime("%Y-%m-%d") == "2026-11-01"
    dec = sched.next_run("monthly", time(8, 0), CHI, day_of_month=15, after=datetime(2026, 12, 20, tzinfo=timezone.utc))
    assert dec.astimezone(CHI).strftime("%Y-%m-%d") == "2027-01-15"
    with pytest.raises(ValueError):
        sched.next_run("weekly", time(8, 0), CHI)


def test_reporting_windows_are_previous_completed_periods():
    occ = datetime(2026, 10, 12, 13, 0, tzinfo=timezone.utc)  # Mon Oct 12, 08:00 CDT
    assert sched.window_for("previous_day", occ, CHI) == (date(2026, 10, 11), date(2026, 10, 11))
    assert sched.window_for("previous_7_days", occ, CHI) == (date(2026, 10, 5), date(2026, 10, 11))
    assert sched.window_for("previous_month", occ, CHI) == (date(2026, 9, 1), date(2026, 9, 30))
    jan = datetime(2027, 1, 5, 14, tzinfo=timezone.utc)
    assert sched.window_for("previous_month", jan, CHI) == (date(2026, 12, 1), date(2026, 12, 31))


def test_idempotency_key_is_stable_per_occurrence():
    occ = datetime(2026, 10, 12, 13, 0, tzinfo=timezone.utc)
    assert sched.idempotency_key("s1", occ) == sched.idempotency_key("s1", occ.astimezone(CHI)) == "s1:2026-10-12T13:00:00Z"


# ── Schedule API ─────────────────────────────────────────────────────────────

BODY = {"name": "Weekly maintenance", "report_type": "maintenance", "frequency": "weekly", "day_of_week": 0, "local_time": "07:30",
        "output_format": "pdf", "recipient_ids": ["eng1"]}


def test_create_schedule_persists_and_returns_real_id(api):
    db = make_db()
    http = api(db)
    created = http.post("/v1/reports/schedules", json=BODY, headers=auth("chief_engineer", user_id="chief-1"))
    assert created.status_code == 201
    data = created.json()["data"]
    assert data["id"] and data["timezone"] == "UTC" and data["reporting_window"] == "previous_7_days"
    assert len(db.rows["report_schedules"]) == 1 and db.rows["report_schedules"][0]["next_run_at"]
    assert db.rows["report_schedules"][0]["created_by"] == "chief-1"


def test_create_schedule_validation_and_authorization(api):
    http = api(make_db())
    chief = auth("chief_engineer", user_id="chief-1")
    assert http.post("/v1/reports/schedules", json={**BODY, "report_type": "management"}, headers=chief).status_code == 403
    assert http.post("/v1/reports/schedules", json={**BODY, "frequency": "hourly"}, headers=chief).status_code == 422
    assert http.post("/v1/reports/schedules", json={**BODY, "local_time": "25:00"}, headers=chief).status_code == 422
    assert http.post("/v1/reports/schedules", json={**BODY, "day_of_week": None}, headers=chief).status_code == 422
    assert http.post("/v1/reports/schedules", json={**BODY, "recipient_ids": []}, headers=chief).status_code == 422
    assert http.post("/v1/reports/schedules", json={**BODY, "recipient_ids": ["hk1"]}, headers=chief).status_code == 422  # housekeeper can't receive maintenance
    assert http.post("/v1/reports/schedules", json={**BODY, "recipient_ids": ["eng-b"]}, headers=chief).status_code == 422  # other hotel
    assert http.post("/v1/reports/schedules", json=BODY, headers=auth("housekeeper")).status_code == 403
    mgmt = {**BODY, "report_type": "management", "recipient_ids": ["eng1"]}
    assert http.post("/v1/reports/schedules", json=mgmt, headers=auth("gm")).status_code == 422  # engineer can't receive management


def test_schedule_preview_uses_real_rules(api):
    http = api(make_db())
    body = http.post("/v1/reports/schedules/preview", json=BODY, headers=auth("gm")).json()["data"]
    assert body["timezone"] == "UTC" and body["next_delivery"] < body["following_delivery"]
    start = datetime.fromisoformat(body["next_delivery"])
    assert start.weekday() == 0 and start.hour == 7 and start.minute == 30
    assert body["reporting_window"]["key"] == "previous_7_days"


def test_schedule_management_is_owner_or_gm_and_tenant_scoped(api):
    db = make_db()
    http = api(db)
    mine = http.post("/v1/reports/schedules", json=BODY, headers=auth("chief_engineer", user_id="chief-1")).json()["data"]["id"]
    assert [s["id"] for s in http.get("/v1/reports/schedules", headers=auth("chief_engineer", user_id="chief-1")).json()["data"]] == [mine]
    assert http.get("/v1/reports/schedules", headers=auth("chief_engineer", user_id="chief-2")).json()["data"] == []
    assert http.patch(f"/v1/reports/schedules/{mine}", json={"enabled": False}, headers=auth("chief_engineer", user_id="chief-2")).status_code == 404
    assert http.delete(f"/v1/reports/schedules/{mine}", headers=auth("chief_engineer", user_id="chief-2")).status_code == 404
    assert http.get(f"/v1/reports/schedules/{mine}/deliveries", headers=auth("gm", hotel_id="hotel-b")).status_code in (403, 404)
    assert [s["id"] for s in http.get("/v1/reports/schedules", headers=auth("gm")).json()["data"]] == [mine]  # GM sees all in hotel
    paused = http.patch(f"/v1/reports/schedules/{mine}", json={"enabled": False}, headers=auth("gm")).json()["data"]
    assert paused["enabled"] is False and db.rows["report_schedules"][0]["next_run_at"] is None
    resumed = http.patch(f"/v1/reports/schedules/{mine}", json={"enabled": True}, headers=auth("gm")).json()["data"]
    assert resumed["enabled"] is True and db.rows["report_schedules"][0]["next_run_at"]
    assert http.delete(f"/v1/reports/schedules/{mine}", headers=auth("gm")).status_code == 204
    assert db.rows["report_schedules"] == []


def test_delivery_status_hides_config_detail_from_non_admins(api):
    http = api(make_db())
    assert http.get("/v1/reports/delivery-status", headers=auth("gm")).json()["data"]["missing"] == ["RESEND_API_KEY", "REPORT_EMAIL_FROM"]
    assert http.get("/v1/reports/delivery-status", headers=auth("chief_engineer")).json()["data"]["missing"] == []
    assert http.get("/v1/reports/delivery-status", headers=auth("housekeeper")).status_code == 403


# ── Delivery engine ──────────────────────────────────────────────────────────


class Mail:
    """Records sends; stands in for the provider (no real network)."""

    def __init__(self, monkeypatch, *, configured=True, fail=None):
        self.sent: list[dict] = []
        self.fail = fail
        monkeypatch.setattr(email_delivery, "is_configured", lambda: configured)
        monkeypatch.setattr(delivery_service.email_delivery, "is_configured", lambda: configured)

        def send(**kwargs):
            if self.fail:
                raise self.fail
            self.sent.append(kwargs)
            return f"msg-{len(self.sent)}"

        monkeypatch.setattr(email_delivery, "send_email", send)
        monkeypatch.setattr(delivery_service.email_delivery, "send_email", send)
        monkeypatch.setattr(delivery_service, "resolve_emails", lambda sb, ids: {i: f"{i}@example.com" for i in ids})


def due_db(**over):
    schedule = {"id": "s1", "tenant_id": "hotel-a", "name": "Wk", "report_type": "maintenance", "frequency": "daily", "day_of_week": None,
                "day_of_month": None, "local_time": "06:00:00", "timezone": "UTC", "reporting_window": "previous_day",
                "output_format": "csv", "recipient_ids": ["eng1"], "filters": {}, "enabled": True,
                "next_run_at": iso(NOW - timedelta(minutes=5)), "created_by": "chief-1", "created_at": iso(NOW)}
    schedule.update(over)
    return make_db(
        report_schedules=[schedule], report_deliveries=[],
        user_profiles=[{"id": "eng1", "tenant_id": "hotel-a", "full_name": "Eli Engineer"}, {"id": "chief-1", "tenant_id": "hotel-a", "full_name": "Chief"}],
        user_roles=[{"user_id": "eng1", "tenant_id": "hotel-a", "role": "engineer", "is_active": True},
                    {"user_id": "chief-1", "tenant_id": "hotel-a", "role": "chief_engineer", "is_active": True}],
        work_orders=[wo("w1", created_at=iso(NOW - timedelta(days=1)))],
    )


def run(db, now=None):
    return asyncio.run(delivery_service.run_due(db, now or NOW))


def test_due_schedule_is_sent_once_and_recorded(monkeypatch):
    mail = Mail(monkeypatch)
    db = due_db()
    summary = run(db)
    assert summary["claimed"] == 1 and summary["sent"] == 1 and len(mail.sent) == 1
    assert mail.sent[0]["to"] == ["eng1@example.com"] and mail.sent[0]["attachments"][0].filename.endswith(".csv")
    delivery = db.rows["report_deliveries"][0]
    assert delivery["status"] == "sent" and delivery["provider_message_id"] == "msg-1" and delivery["recipient_count"] == 1
    assert delivery["idempotency_key"].startswith("s1:")
    assert db.rows["report_schedules"][0]["next_run_at"] > iso(NOW)  # advanced to the next future occurrence


def test_running_the_worker_twice_never_sends_twice(monkeypatch):
    mail = Mail(monkeypatch)
    db = due_db()
    run(db)
    run(db)
    assert len(mail.sent) == 1 and len(db.rows["report_deliveries"]) == 1


def test_competing_worker_losing_the_claim_does_not_send(monkeypatch):
    mail = Mail(monkeypatch)
    db = due_db()
    stale_copy = dict(db.rows["report_schedules"][0])
    run(db)  # worker A wins
    assert delivery_service._claim(db, stale_copy, NOW + timedelta(days=1), NOW) is False  # worker B holds the old next_run_at
    assert len(mail.sent) == 1


def test_duplicate_idempotency_key_is_skipped(monkeypatch):
    mail = Mail(monkeypatch)
    db = due_db()
    occurrence = datetime.fromisoformat(db.rows["report_schedules"][0]["next_run_at"])
    original_table = db.table

    def table(name):
        query = original_table(name)
        if name == "report_deliveries":
            real_execute = query.execute

            def execute():
                if query.action == "insert":
                    raise RuntimeError("duplicate key value violates unique constraint")
                return real_execute()

            query.execute = execute
        return query

    db.table = table
    assert run(db)["claimed"] == 0 and mail.sent == []
    assert occurrence


def test_paused_schedule_is_not_delivered(monkeypatch):
    mail = Mail(monkeypatch)
    db = due_db(enabled=False, next_run_at=None)
    assert run(db)["claimed"] == 0 and mail.sent == [] and db.rows["report_deliveries"] == []


def test_not_configured_records_honest_status_and_sends_nothing(monkeypatch):
    mail = Mail(monkeypatch, configured=False)
    db = due_db()
    summary = run(db)
    assert summary["not_configured"] == 1 and mail.sent == []
    delivery = db.rows["report_deliveries"][0]
    assert delivery["status"] == "not_configured" and "nothing was sent" in delivery["error_summary"]


def test_recipient_authorization_is_rechecked_at_send_time(monkeypatch):
    mail = Mail(monkeypatch)
    # eng1 has since been deactivated, so nobody eligible remains.
    db = due_db()
    db.rows["user_roles"][0]["is_active"] = False
    run(db)
    delivery = db.rows["report_deliveries"][0]
    assert delivery["status"] == "failed" and "No eligible recipients" in delivery["error_summary"] and mail.sent == []


def test_recipient_whose_role_lost_access_is_dropped_not_sent(monkeypatch):
    mail = Mail(monkeypatch)
    db = due_db(report_type="housekeeping", recipient_ids=["eng1"], created_by="chief-1")
    db.rows["user_roles"][1]["role"] = "gm"  # creator is GM so the schedule is valid, but eng1 can't view housekeeping
    run(db)
    assert mail.sent == [] and db.rows["report_deliveries"][0]["status"] == "failed"


def test_owner_who_lost_access_blocks_delivery(monkeypatch):
    mail = Mail(monkeypatch)
    db = due_db()
    db.rows["user_roles"][1]["role"] = "front_desk"
    run(db)
    assert mail.sent == [] and "no longer has access" in db.rows["report_deliveries"][0]["error_summary"]


def test_transient_provider_failure_is_retried_with_backoff_then_succeeds(monkeypatch):
    mail = Mail(monkeypatch, fail=email_delivery.EmailError("Email provider unavailable (HTTP 503)", retryable=True))
    db = due_db()
    run(db)
    delivery = db.rows["report_deliveries"][0]
    assert delivery["status"] == "failed" and delivery["attempts"] == 1 and delivery["next_retry_at"]
    assert "503" in delivery["error_summary"] and "Bearer" not in delivery["error_summary"]
    mail.fail = None
    later = NOW + timedelta(minutes=11)
    summary = run(db, later)
    assert summary["retried"] == 1 and db.rows["report_deliveries"][0]["status"] == "sent"
    assert len(mail.sent) == 1 and len(db.rows["report_deliveries"]) == 1  # same row, no duplicate occurrence


def test_non_retryable_failure_is_not_retried(monkeypatch):
    Mail(monkeypatch, fail=email_delivery.EmailError("Email provider rejected the message (HTTP 422)", retryable=False))
    db = due_db()
    run(db)
    delivery = db.rows["report_deliveries"][0]
    assert delivery["status"] == "failed" and delivery["next_retry_at"] is None


def test_retries_stop_after_max_attempts(monkeypatch):
    Mail(monkeypatch, fail=email_delivery.EmailError("down", retryable=True))
    db = due_db()
    now = NOW
    run(db, now)
    for _ in range(5):
        now += timedelta(hours=5)
        run(db, now)
    assert db.rows["report_deliveries"][0]["attempts"] == delivery_service.MAX_ATTEMPTS
    assert db.rows["report_deliveries"][0]["next_retry_at"] is None


def test_stale_occurrence_after_outage_is_skipped_not_sent_late(monkeypatch):
    mail = Mail(monkeypatch)
    db = due_db(next_run_at=iso(NOW - timedelta(days=3)))
    summary = run(db)
    assert summary["skipped"] == 1 and mail.sent == []
    assert db.rows["report_deliveries"][0]["status"] == "skipped"
    assert db.rows["report_schedules"][0]["next_run_at"] > iso(NOW)  # no catch-up flood


def test_delivery_history_endpoint_is_tenant_scoped(monkeypatch, api):
    Mail(monkeypatch)
    db = due_db()
    http = api(db)
    run(db)
    history = http.get("/v1/reports/schedules/s1/deliveries", headers=auth("gm")).json()["data"]
    assert [h["status"] for h in history] == ["sent"]
    assert http.get("/v1/reports/schedules/s1/deliveries", headers=auth("gm", hotel_id="hotel-b")).status_code == 404


def test_failed_delivery_can_be_retried_manually(monkeypatch, api):
    mail = Mail(monkeypatch, fail=email_delivery.EmailError("down", retryable=True))
    db = due_db()
    http = api(db)
    run(db)
    mail.fail = None
    delivery_id = db.rows["report_deliveries"][0]["id"]
    result = http.post(f"/v1/reports/schedules/s1/deliveries/{delivery_id}/retry", headers=auth("gm")).json()["data"]
    assert result["status"] == "sent"
    assert http.post(f"/v1/reports/schedules/s1/deliveries/{delivery_id}/retry", headers=auth("gm")).status_code == 409


def test_email_adapter_never_simulates_success(monkeypatch):
    monkeypatch.setattr("services.email_delivery.settings", SimpleNamespace(resend_api_key="", report_email_from="", app_env="development", staging_external_integrations_enabled=False))
    assert email_delivery.is_configured() is False
    with pytest.raises(email_delivery.EmailError):
        email_delivery.send_email(to=["a@b.com"], subject="s", html="h", text="t")


def test_email_adapter_maps_provider_errors(monkeypatch):
    monkeypatch.setattr("services.email_delivery.settings", SimpleNamespace(resend_api_key="k", report_email_from="R <r@x.com>", app_env="development", staging_external_integrations_enabled=False))

    def fake_post(status, body=None):
        monkeypatch.setattr("services.email_delivery.httpx.post", lambda *a, **k: SimpleNamespace(status_code=status, json=lambda: body or {}))

    fake_post(200, {"id": "abc"})
    assert email_delivery.send_email(to=["a@b.com"], subject="s", html="h", text="t") == "abc"
    fake_post(503)
    with pytest.raises(email_delivery.EmailError) as transient:
        email_delivery.send_email(to=["a@b.com"], subject="s", html="h", text="t")
    assert transient.value.retryable is True
    fake_post(422)
    with pytest.raises(email_delivery.EmailError) as permanent:
        email_delivery.send_email(to=["a@b.com"], subject="s", html="h", text="t")
    assert permanent.value.retryable is False


def test_staging_blocks_real_email_unless_enabled(monkeypatch):
    monkeypatch.setattr("services.email_delivery.settings", SimpleNamespace(resend_api_key="k", report_email_from="r@x.com", app_env="staging", staging_external_integrations_enabled=False))
    assert email_delivery.configuration_status()["configured"] is False
    assert "staging" in email_delivery.configuration_status()["blocked_reason"].lower()


def test_daily_summary_job_does_not_claim_delivery_without_provider(monkeypatch):
    from routers import internal

    db = FakeDB({
        "tenants": [{"id": "hotel-a", "name": "Hotel A", "timezone": "UTC", "is_active": True}],
        "user_roles": [{"tenant_id": "hotel-a", "user_id": "gm-1", "role": "gm", "is_active": True}],
        "user_profiles": [{"id": "gm-1", "full_name": "Gina GM"}],
    })
    monkeypatch.setattr(internal, "supabase", db)
    monkeypatch.setattr(email_delivery, "is_configured", lambda: False)
    result = asyncio.run(internal.send_daily_summary_emails(x_cron_secret=internal.settings.cron_secret))
    assert result["emails_sent"] == 0 and result["emails_not_configured"] == 1 and result["emails_queued"] == 0
