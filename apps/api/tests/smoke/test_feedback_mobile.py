from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from middleware.auth import CurrentUser
from models.requests import CreateFeedbackRequest
from routers import feedback as feedback_router
from routers import staff as staff_router

REQUEST_ID = "5f1c1b0e-5a52-4c3e-9f0b-2a7d6c1f9a11"
HK = CurrentUser(user_id="hk-1", hotel_id="hotel-1", role="housekeeper", email="hk@example.com")
OTHER_HOTEL = CurrentUser(user_id="hk-9", hotel_id="hotel-2", role="housekeeper", email="x@example.com")


class Fake:
    """Tiny in-memory Supabase: filters by eq/in/gte, supports insert/update/order/limit."""

    def __init__(self, tables=None):
        self.tables = {"feedback_submissions": [], "user_roles": [], "notifications": [], "user_profiles": [], "tenants": []}
        self.tables.update(tables or {})
        self.fail_insert_once = False

    def table(self, name):
        return Query(self, name)


class Query:
    def __init__(self, db, name):
        self.db, self.name = db, name
        self.action, self.payload, self.filters, self.in_filters, self.gte_filters, self._limit = "select", None, {}, {}, {}, None

    def select(self, *_a, **_k):
        return self

    def insert(self, payload):
        self.action, self.payload = "insert", payload
        return self

    def update(self, payload):
        self.action, self.payload = "update", payload
        return self

    def eq(self, c, v):
        self.filters[c] = v
        return self

    def in_(self, c, v):
        self.in_filters[c] = v
        return self

    def gte(self, c, v):
        self.gte_filters[c] = v
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, n):
        self._limit = n
        return self

    def _match(self, row):
        return (
            all(row.get(c) == v for c, v in self.filters.items())
            and all(row.get(c) in v for c, v in self.in_filters.items())
            and all(str(row.get(c)) >= v for c, v in self.gte_filters.items())
        )

    def execute(self):
        rows = self.db.tables[self.name]
        if self.action == "insert":
            if self.db.fail_insert_once:
                self.db.fail_insert_once = False
                raise RuntimeError("duplicate key value violates unique constraint")
            payloads = self.payload if isinstance(self.payload, list) else [self.payload]
            made = [{"id": f"{self.name}-{len(rows) + i + 1}", "created_at": "2026-10-15T12:00:00Z", "status": "open", **p} for i, p in enumerate(payloads)]
            rows.extend(made)
            return SimpleNamespace(data=made)
        if self.action == "update":
            hit = [r for r in rows if self._match(r)]
            for r in hit:
                r.update(self.payload)
            return SimpleNamespace(data=hit)
        hit = [r for r in rows if self._match(r)]
        return SimpleNamespace(data=hit[: self._limit] if self._limit else hit)


@pytest.fixture
def db(monkeypatch):
    fake = Fake({"user_roles": [{"user_id": "gm-1", "role": "gm", "tenant_id": "hotel-1", "is_active": True}]})

    async def no_webhook(_row):
        return "not_configured", None

    monkeypatch.setattr(feedback_router, "supabase", fake)
    monkeypatch.setattr(feedback_router, "_send_feedback_webhook", no_webhook)
    monkeypatch.setattr(staff_router, "supabase", fake)
    return fake


def report(**over):
    base = dict(
        source="mobile", category="bug", severity="annoying", area="tasks",
        message="The task list never loads", client_request_id=REQUEST_ID,
        client_context={"app_version": "1.2.3", "platform": "ios", "online": True, "pending_changes": 2},
    )
    base.update(over)
    return CreateFeedbackRequest(**base)


@pytest.mark.asyncio
async def test_mobile_report_is_scoped_to_the_verified_user_and_hotel(db):
    result = await feedback_router.submit_feedback(report(), current_user=HK)
    row = db.tables["feedback_submissions"][0]
    assert result["data"]["id"] == row["id"]
    assert (row["tenant_id"], row["user_id"], row["user_role"]) == ("hotel-1", "hk-1", "housekeeper")
    assert row["source"] == "mobile" and row["area"] == "tasks" and row["client_request_id"] == REQUEST_ID
    assert db.tables["notifications"][0]["user_id"] == "gm-1"


@pytest.mark.asyncio
async def test_diagnostics_are_cut_to_the_allowlist(db):
    ctx = {
        "app_version": "1.2.3",
        "access_token": "secret-token",
        "guest_name": "Jane Guest",
        "pending_changes": 3,
        "sync_status": "x" * 500,
        "room_notes": {"a": 1},
    }
    await feedback_router.submit_feedback(report(client_context=ctx), current_user=HK)
    stored = db.tables["feedback_submissions"][0]["client_context"]
    assert set(stored) == {"app_version", "pending_changes", "sync_status"}
    assert len(stored["sync_status"]) == 80


@pytest.mark.asyncio
async def test_a_retry_with_the_same_request_id_returns_the_first_report(db):
    first = await feedback_router.submit_feedback(report(), current_user=HK)
    again = await feedback_router.submit_feedback(report(), current_user=HK)
    assert len(db.tables["feedback_submissions"]) == 1
    assert again["data"]["id"] == first["data"]["id"]
    assert again["meta"] == {"replayed": True}
    assert len(db.tables["notifications"]) == 1  # the GM is not notified twice


@pytest.mark.asyncio
async def test_a_lost_race_on_the_unique_index_returns_the_winner(db):
    first = await feedback_router.submit_feedback(report(), current_user=HK)
    db.tables["feedback_submissions"][0]["client_request_id"] = REQUEST_ID
    db.fail_insert_once = True
    # Simulate the lookup missing first, then the insert colliding.
    original = feedback_router._existing_by_request_id
    calls = {"n": 0}

    def flaky(user, rid):
        calls["n"] += 1
        return None if calls["n"] == 1 else original(user, rid)

    feedback_router._existing_by_request_id = flaky
    try:
        again = await feedback_router.submit_feedback(report(), current_user=HK)
    finally:
        feedback_router._existing_by_request_id = original
    assert again["data"]["id"] == first["data"]["id"]


@pytest.mark.asyncio
async def test_the_same_request_id_from_another_hotel_is_a_separate_report(db):
    await feedback_router.submit_feedback(report(), current_user=HK)
    await feedback_router.submit_feedback(report(), current_user=OTHER_HOTEL)
    assert len(db.tables["feedback_submissions"]) == 2


@pytest.mark.asyncio
async def test_too_many_mobile_reports_in_an_hour_are_refused(db):
    for _ in range(feedback_router.MOBILE_REPORTS_PER_HOUR):
        db.tables["feedback_submissions"].append(
            {"id": "x", "tenant_id": "hotel-1", "user_id": "hk-1", "source": "mobile", "created_at": "9999-01-01T00:00:00Z"}
        )
    with pytest.raises(HTTPException) as err:
        await feedback_router.submit_feedback(report(client_request_id=None), current_user=HK)
    assert err.value.status_code == 429


@pytest.mark.asyncio
async def test_labelling_a_mobile_report_as_web_does_not_skip_the_diagnostics_allowlist(db):
    ctx = {"app_version": "1.2.3", "access_token": "secret-token", "guest_name": "Jane Guest"}
    await feedback_router.submit_feedback(report(source="web", client_request_id=None, area=None, client_context=ctx), current_user=HK)
    row = db.tables["feedback_submissions"][0]
    assert row["client_context"] == {"app_version": "1.2.3"}
    assert row["source"] == "mobile"


@pytest.mark.asyncio
async def test_the_mobile_area_or_retry_id_marks_a_report_mobile_even_when_labelled_web(db):
    await feedback_router.submit_feedback(
        report(source="web", client_context={"access_token": "t"}), current_user=HK
    )
    row = db.tables["feedback_submissions"][0]
    assert row["client_context"] == {} and row["source"] == "mobile" and row["area"] == "tasks"


@pytest.mark.asyncio
async def test_the_hourly_cap_cannot_be_dodged_by_labelling_reports_web(db):
    for _ in range(feedback_router.MOBILE_REPORTS_PER_HOUR):
        db.tables["feedback_submissions"].append(
            {"id": "x", "tenant_id": "hotel-1", "user_id": "hk-1", "source": "mobile", "created_at": "9999-01-01T00:00:00Z"}
        )
    with pytest.raises(HTTPException) as err:
        await feedback_router.submit_feedback(
            CreateFeedbackRequest(message="plain web form", client_context={"timezone": "America/Chicago"}), current_user=HK
        )
    assert err.value.status_code == 429


@pytest.mark.asyncio
async def test_the_cap_counts_only_the_signed_in_person_in_their_hotel(db):
    for _ in range(feedback_router.MOBILE_REPORTS_PER_HOUR):
        db.tables["feedback_submissions"].append(
            {"id": "x", "tenant_id": "hotel-1", "user_id": "someone-else", "source": "web", "created_at": "9999-01-01T00:00:00Z"}
        )
    await feedback_router.submit_feedback(CreateFeedbackRequest(message="fine"), current_user=HK)
    assert len(db.tables["feedback_submissions"]) == feedback_router.MOBILE_REPORTS_PER_HOUR + 1


@pytest.mark.asyncio
async def test_a_normal_web_report_keeps_its_free_form_context_and_web_source(db):
    await feedback_router.submit_feedback(
        CreateFeedbackRequest(message="slow", client_context={"room_id": "room-214", "screen": "room-board"}), current_user=HK
    )
    row = db.tables["feedback_submissions"][0]
    assert row["client_context"] == {"room_id": "room-214", "screen": "room-board"}
    assert "source" not in row  # column default 'web'


def test_the_request_model_ignores_any_user_or_tenant_the_client_sends():
    parsed = CreateFeedbackRequest(message="hi", user_id="someone-else", tenant_id="hotel-2")
    assert not hasattr(parsed, "user_id") and not hasattr(parsed, "tenant_id")


@pytest.mark.asyncio
async def test_my_reports_lists_only_my_own_in_my_hotel(db):
    rows = db.tables["feedback_submissions"]
    rows += [
        {"id": "a", "tenant_id": "hotel-1", "user_id": "hk-1", "message": "mine", "created_at": "2026-10-15"},
        {"id": "b", "tenant_id": "hotel-1", "user_id": "hk-2", "message": "coworker", "created_at": "2026-10-15"},
        {"id": "c", "tenant_id": "hotel-2", "user_id": "hk-1", "message": "other hotel", "created_at": "2026-10-15"},
    ]
    result = await feedback_router.list_my_feedback(limit=30, current_user=HK)
    assert [r["id"] for r in result["data"]] == ["a"]


@pytest.mark.asyncio
async def test_my_report_detail_hides_someone_elses_report(db):
    db.tables["feedback_submissions"].append({"id": "b", "tenant_id": "hotel-1", "user_id": "hk-2", "message": "coworker"})
    with pytest.raises(HTTPException) as err:
        await feedback_router.get_my_feedback("11111111-1111-4111-8111-111111111111", current_user=HK)
    assert err.value.status_code == 404


@pytest.mark.asyncio
async def test_support_contacts_give_names_and_the_business_line_only(db):
    db.tables["tenants"].append({"id": "hotel-1", "name": "Lone Star Inn", "phone": "512-555-0100"})
    db.tables["user_roles"] += [
        {"user_id": "sup-1", "role": "housekeeping_supervisor", "tenant_id": "hotel-1", "is_active": True},
        {"user_id": "sup-off", "role": "housekeeping_supervisor", "tenant_id": "hotel-1", "is_active": False},
        {"user_id": "sup-x", "role": "housekeeping_supervisor", "tenant_id": "hotel-2", "is_active": True},
    ]
    db.tables["user_profiles"] += [
        {"id": "sup-1", "tenant_id": "hotel-1", "full_name": "Ana Ruiz", "preferred_name": None, "phone": "PRIVATE"},
        {"id": "gm-1", "tenant_id": "hotel-1", "full_name": "Pat Lee", "preferred_name": "Pat"},
    ]
    data = (await staff_router.get_support_contacts(current_user=HK))["data"]
    assert data["hotel"] == {"name": "Lone Star Inn", "phone": "512-555-0100"}
    assert data["contacts"] == [{"name": "Ana Ruiz", "role": "housekeeping_supervisor"}, {"name": "Pat", "role": "gm"}]
    assert "PRIVATE" not in str(data)


@pytest.mark.asyncio
async def test_support_contacts_are_empty_when_the_hotel_set_none_up(db):
    gm = CurrentUser(user_id="gm-1", hotel_id="hotel-1", role="gm", email="gm@example.com")
    data = (await staff_router.get_support_contacts(current_user=gm))["data"]
    assert data == {"hotel": {"name": None, "phone": None}, "contacts": []}
