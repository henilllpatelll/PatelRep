"""Reports audit fixes: row-cap truncation never reads as a complete result, paged queries,
all-reports export, department scoping, and delivery hardening (recipient lookup, claim, recovery)."""
import asyncio
import io
import zipfile
from datetime import timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from main import app
from routers import management_roi as roi_router
from routers import report_exports as exports_router
from routers import report_views as views_router
from routers import reports as reports_router
from services.reporting import data as report_data
from services.reporting import delivery as delivery_service
from services.reporting import truncation
from tests.test_reports_export_schedule import Mail, due_db
from tests.test_reports_views import NOW, at, auth, gr, iso, make_db, reset_rate_limits, wo


@pytest.fixture(autouse=True)
def _fresh_rate_limits():
    reset_rate_limits()
    yield
    reset_rate_limits()


@pytest.fixture
def api(monkeypatch):
    def install(db):
        for module in (views_router, reports_router, roi_router, exports_router, delivery_service):
            if hasattr(module, "supabase"):
                monkeypatch.setattr(module, "supabase", db)
        return TestClient(app)
    return install


@pytest.fixture
def tiny_cap(monkeypatch):
    """Page of 2, cap of 4 rows: any cohort of 5+ rows is truncated."""
    monkeypatch.setattr(report_data, "PAGE_SIZE", 2)
    monkeypatch.setattr(report_data, "MAX_ROWS", 4)


# ── fetch_all + tracker ──────────────────────────────────────────────────────


def test_fetch_all_records_the_source_only_when_the_cap_is_hit(tiny_cap):
    def query(db):
        return lambda: db.table("work_orders").select("id").eq("tenant_id", "hotel-a").order("id")

    db = make_db(work_orders=[wo(f"w{i}") for i in range(5)])
    with truncation.track() as seen:
        rows, capped = report_data.fetch_all(query(db), source="work_orders")
    assert capped and len(rows) == 4 and seen == {"work_orders"}

    db = make_db(work_orders=[wo(f"w{i}") for i in range(3)])
    with truncation.track() as seen:
        rows, capped = report_data.fetch_all(query(db), source="work_orders")
    assert not capped and len(rows) == 3 and seen == set()


def test_nested_scopes_propagate_to_the_enclosing_view():
    with truncation.track() as outer:
        with truncation.track():
            truncation.record("tasks")
        assert truncation.is_truncated("tasks")
    assert outer == {"tasks"}
    assert not truncation.is_truncated("tasks")  # outside any scope nothing is flagged


# ── Capped cohorts are withheld, never shown as hotel-wide results ───────────


def test_guest_view_withholds_kpis_when_requests_were_capped(api, tiny_cap):
    db = make_db(guest_requests=[gr(f"g{i}", request_number=i) for i in range(6)])
    data = api(db).get("/v1/reports/views/guest-experience?compare=previous", headers=auth("gm")).json()["data"]
    assert data["truncated"] is True and data["truncated_sources"] == ["guest_requests"]
    assert "exceeded the reporting record limit" in data["truncation_notice"]
    for kpi in data["kpis"]:
        assert kpi["value"] is None and kpi["availability"] == "unavailable" and kpi["comparison"] is None
        assert kpi["eligible"] is None and "Narrow the date range" in kpi["note"]


def test_complete_cohort_is_not_flagged_and_keeps_its_values(api):
    db = make_db(guest_requests=[gr(f"g{i}", request_number=i) for i in range(6)])
    data = api(db).get("/v1/reports/views/guest-experience", headers=auth("gm")).json()["data"]
    assert data["truncated"] is False and data["truncated_sources"] == [] and data["truncation_notice"] is None
    assert next(k for k in data["kpis"] if k["key"] == "guest_requests_total")["value"] == 6


def test_only_kpis_fed_by_the_capped_cohort_are_withheld(api, tiny_cap):
    db = make_db(work_orders=[wo(f"w{i}") for i in range(6)], tasks=[])
    data = api(db).get("/v1/reports/views/team", headers=auth("gm")).json()["data"]
    by_key = {k["key"]: k for k in data["kpis"]}
    assert by_key["wo_completed"]["availability"] == "unavailable" and by_key["team_sla"]["availability"] == "unavailable"
    assert by_key["labor_hours"]["availability"] == "unavailable"
    assert by_key["tasks_completed"]["availability"] == "available"  # the tasks cohort was complete


def test_maintenance_live_backlog_is_not_reported_from_a_capped_inventory(api, tiny_cap):
    open_orders = [wo(f"o{i}", status="open", due_at=iso(at(1)), completed_at=None) for i in range(6)]
    data = api(make_db(work_orders=open_orders)).get("/v1/reports/views/maintenance", headers=auth("gm")).json()["data"]
    breaches = data["active_breaches"]
    assert breaches["overdue_count"] is None and breaches["open_work_orders"] is None and breaches["oldest"] is None
    assert "open_work_orders" in data["truncated_sources"]


def test_export_carries_the_notice_and_no_fabricated_numbers(api, tiny_cap):
    db = make_db(guest_requests=[gr(f"g{i}", request_number=i) for i in range(6)])
    csv_text = api(db).get("/v1/reports/export?view=guest-experience&format=csv", headers=auth("gm")).content.decode("utf-8")
    assert "exceeded the reporting record limit" in csv_text
    assert ",unavailable," in csv_text
    assert "100.0" not in csv_text and "Request categories" not in csv_text  # no breakdown of a capped cohort


def test_management_downtime_is_withheld_when_status_history_was_capped(api, tiny_cap):
    history = [
        {"tenant_id": "hotel-a", "room_id": "r1", "to_status": "OOO" if i % 2 == 0 else "CLEAN", "created_at": iso(at(5) + timedelta(hours=i))}
        for i in range(8)
    ]
    data = api(make_db(room_status_history=history)).get("/v1/reports/views/management", headers=auth("gm")).json()["data"]
    assert "room_status_history" in data["truncated_sources"]
    assert data["downtime_exposure"]["total_downtime_hours"] is None and data["downtime_exposure"]["estimate_cents"] is None
    assert data["maintenance_pm"]["high_downtime_rooms"] == []
    assert data["time_labor"]["kpis"][0]["availability"] == "unavailable"
    assert data["staffing_forecast"]["availability"] == "unavailable"


def test_inspection_results_are_paged_not_silently_cut_at_one_response(api, monkeypatch):
    monkeypatch.setattr(report_data, "PAGE_SIZE", 2)  # stands in for PostgREST's 1,000-row response limit
    inspections = [{"id": "i1", "tenant_id": "hotel-a", "room_id": "r1", "overall_result": "failed", "completed_at": iso(at(2))}]
    results = [{"tenant_id": "hotel-a", "inspection_id": "i1", "template_item_id": "t1", "result": "fail"} for _ in range(5)]
    items = [{"id": "t1", "tenant_id": "hotel-a", "section": "Bath", "description": "Towels"}]
    db = make_db(inspections=inspections, inspection_results=results, inspection_template_items=items)
    data = api(db).get("/v1/reports/views/housekeeping", headers=auth("gm")).json()["data"]
    assert data["inspection_quality"]["top_failed_items"][0]["fail_count"] == 5
    assert data["truncated"] is False  # 5 rows fit under MAX_ROWS even though they span three pages


# ── Department scoping ───────────────────────────────────────────────────────


def test_overview_live_brief_is_scoped_by_role_and_department(api):
    db = make_db(
        room_status=[{"tenant_id": "hotel-a", "room_id": "r1", "status": "OOO"}],
        work_orders=[wo("w1", status="open", completed_at=None)],
    )
    http = api(db)
    gm_all = http.get("/v1/reports/views/overview", headers=auth("gm")).json()["data"]["daily_brief"]
    assert gm_all["open_work_orders"] == 1 and gm_all["room_status"] == {"OOO": 1}
    eng = http.get("/v1/reports/views/overview?department=engineering", headers=auth("gm")).json()["data"]
    assert eng["daily_brief"]["room_status"] is None and eng["daily_brief"]["open_work_orders"] == 1
    assert all(k["key"] != "out_of_order" for k in eng["kpis"])
    hk = http.get("/v1/reports/views/overview?department=housekeeping", headers=auth("gm")).json()["data"]
    assert hk["daily_brief"]["open_work_orders"] is None and hk["daily_brief"]["room_status"] == {"OOO": 1}
    supervisor = http.get("/v1/reports/views/overview", headers=auth("housekeeping_supervisor")).json()["data"]["daily_brief"]
    assert supervisor["open_work_orders"] is None  # a supervisor never receives work-order counts


def test_team_export_honours_the_department_filter(api):
    db = make_db(
        work_orders=[wo("w1", assigned_to="eng1")],
        tasks=[{"id": "t", "tenant_id": "hotel-a", "title": "x", "status": "completed", "assigned_to": "hk1",
                "created_at": iso(at(3)), "due_at": None, "completed_at": iso(at(3, 15))}],
    )
    http = api(db)
    eng = http.get("/v1/reports/export?view=team&format=csv&department=engineering", headers=auth("gm")).content.decode("utf-8")
    assert "Eli Engineer" in eng and "Hana Housekeeper" not in eng
    both = http.get("/v1/reports/export?view=team&format=csv", headers=auth("gm")).content.decode("utf-8")
    assert "Eli Engineer" in both and "Hana Housekeeper" in both


# ── All authorized reports ───────────────────────────────────────────────────


def _names(response) -> list[str]:
    return sorted(zipfile.ZipFile(io.BytesIO(response.content)).namelist())


def test_all_reports_export_contains_exactly_the_callers_authorized_views(api):
    http = api(make_db(work_orders=[wo("w1")], guest_requests=[gr("g1")]))
    gm = http.get("/v1/reports/export?view=all&format=csv", headers=auth("gm"))
    assert gm.status_code == 200 and gm.headers["content-type"] == "application/zip"
    assert "attachment" in gm.headers["content-disposition"] and gm.headers["cache-control"] == "no-store"
    names = _names(gm)
    assert len(names) == 6 and all(n.endswith(".csv") for n in names)
    assert {"overview", "guest-experience", "housekeeping", "maintenance", "team", "management"} == {n.split("-20")[0] for n in names}

    chief = _names(http.get("/v1/reports/export?view=all&format=csv", headers=auth("chief_engineer")))
    assert len(chief) == 4 and not any(n.startswith(("management", "housekeeping")) for n in chief)
    engineer = _names(http.get("/v1/reports/export?view=all&format=csv", headers=auth("engineer")))
    assert len(engineer) == 2


def test_all_reports_export_pdf_and_rbac(api):
    http = api(make_db(work_orders=[wo("w1")]))
    pdf = http.get("/v1/reports/export?view=all&format=pdf", headers=auth("gm"))
    archive = zipfile.ZipFile(io.BytesIO(pdf.content))
    assert len(archive.namelist()) == 6 and all(archive.read(n)[:5] == b"%PDF-" for n in archive.namelist())
    assert http.get("/v1/reports/export?view=all&format=pdf", headers=auth("housekeeper")).status_code == 403
    assert http.get("/v1/reports/export?view=all&format=xlsx", headers=auth("gm")).status_code == 422


def test_all_reports_export_is_tenant_scoped_and_fails_closed(api, monkeypatch):
    db = make_db(work_orders=[wo("w1"), {**wo("x"), "tenant_id": "hotel-b", "title": "SECRET-B"}])
    http = api(db)
    archive = zipfile.ZipFile(io.BytesIO(http.get("/v1/reports/export?view=all&format=csv", headers=auth("gm")).content))
    assert all(b"SECRET-B" not in archive.read(n) for n in archive.namelist())

    async def boom(*_a, **_k):
        raise RuntimeError("renderer down")

    monkeypatch.setattr(exports_router, "build_document", boom)
    failed = http.get("/v1/reports/export?view=all&format=csv", headers=auth("gm"))
    assert failed.status_code == 500 and "nothing was exported" in failed.json()["detail"]


# ── Delivery hardening ───────────────────────────────────────────────────────


class FakeAdmin:
    def __init__(self, users):
        self.users = users
        self.list_calls = 0

    def list_users(self, *a, **k):  # a single page only, like the real API
        self.list_calls += 1
        return list(self.users.values())[:1]

    def get_user_by_id(self, uid):
        if uid not in self.users:
            raise RuntimeError("not found")
        return SimpleNamespace(user=self.users[uid])


def test_recipient_emails_are_resolved_per_user_not_from_one_list_page():
    users = {f"u{i}": SimpleNamespace(id=f"u{i}", email=f"u{i}@example.com") for i in range(120)}
    sb = SimpleNamespace(auth=SimpleNamespace(admin=FakeAdmin(users)))
    emails = delivery_service.resolve_emails(sb, ["u3", "u110", "missing"])
    assert emails == {"u3": "u3@example.com", "u110": "u110@example.com"}
    assert sb.auth.admin.list_calls == 0


def test_a_row_claimed_by_another_worker_is_not_sent_again(monkeypatch):
    mail = Mail(monkeypatch)
    db = due_db()
    db.rows["report_deliveries"].append({
        "id": "d1", "tenant_id": "hotel-a", "schedule_id": "s1", "scheduled_occurrence": iso(NOW), "idempotency_key": "k1",
        "status": "sending", "attempts": 1,
    })
    stale_read = {**db.rows["report_deliveries"][0], "status": "failed"}  # this worker read it before the other flipped it
    outcome = asyncio.run(delivery_service.attempt_delivery(db, stale_read, NOW))
    assert outcome == {"status": "claimed_elsewhere"} and mail.sent == []
    assert db.rows["report_deliveries"][0]["attempts"] == 1


def test_orphaned_deliveries_are_recovered(monkeypatch):
    mail = Mail(monkeypatch)
    db = due_db(next_run_at=iso(NOW + timedelta(hours=5)))
    old = iso(NOW - delivery_service.STALE_AFTER - timedelta(minutes=1))
    base = {"tenant_id": "hotel-a", "schedule_id": "s1", "created_at": old}
    db.rows["report_deliveries"] += [
        {**base, "id": "q", "scheduled_occurrence": iso(NOW - timedelta(hours=2)), "idempotency_key": "kq", "status": "queued", "attempts": 0},
        {**base, "id": "s", "scheduled_occurrence": iso(NOW - timedelta(hours=3)), "idempotency_key": "ks", "status": "sending", "attempts": 1, "started_at": old},
        {**base, "id": "x", "scheduled_occurrence": iso(NOW - timedelta(hours=4)), "idempotency_key": "kx", "status": "sending", "attempts": 3, "started_at": old},
    ]
    summary = asyncio.run(delivery_service.run_due(db, NOW))
    by_id = {r["id"]: r for r in db.rows["report_deliveries"]}
    assert by_id["q"]["status"] == "sent"  # never started -> run now
    # unknown outcome -> marked failed, then retried straight away (the provider idempotency key makes that safe)
    assert by_id["s"]["status"] == "sent" and by_id["s"]["attempts"] == 2
    assert by_id["x"]["status"] == "failed" and by_id["x"]["next_retry_at"] is None  # attempts exhausted -> terminal
    assert summary["recovered"] == 3 and len(mail.sent) == 2


def test_fresh_in_flight_rows_are_left_alone(monkeypatch):
    Mail(monkeypatch)
    db = due_db(next_run_at=iso(NOW + timedelta(hours=5)))
    db.rows["report_deliveries"].append({
        "id": "live", "tenant_id": "hotel-a", "schedule_id": "s1", "scheduled_occurrence": iso(NOW), "idempotency_key": "kl",
        "status": "sending", "attempts": 1, "started_at": iso(NOW - timedelta(minutes=2)), "created_at": iso(NOW - timedelta(minutes=2)),
    })
    asyncio.run(delivery_service.run_due(db, NOW))
    assert db.rows["report_deliveries"][0]["status"] == "sending"
