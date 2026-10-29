"""Team Scheduling Phase 7: the notification outbox - inbox rows, push hand-off, retries, privacy (FakeDB)."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import BackgroundTasks

from routers import scheduling_revisions as revs
from services import notify, revision_store, schedule_outbox
from services.schedule_revisions import MAX_ATTEMPTS, backoff_seconds

from .request_support import MODULES, SUP, U_HK1, U_HK2, HOTEL
from .test_schedule_revisions_api import draft, publish, stage_create


@pytest.fixture
def db(revisions_db):
    return revisions_db


def push_recorder(monkeypatch, outcome=None):
    sent = []

    async def fake_send_push(**kw):
        sent.append(kw)
        return outcome or {"sent": 1, "opted_out": [], "no_device": [], "failed": 0}

    monkeypatch.setattr(schedule_outbox.notify, "send_push", fake_send_push)
    return sent


async def published_one(db, user=U_HK1):
    await stage_create(user=user)
    rev = draft(db)
    await publish(db, rev["id"])
    return rev


# --- delivery --------------------------------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_delivery_creates_one_inbox_row_and_records_only_what_the_provider_said(db, monkeypatch):
    sent = push_recorder(monkeypatch)
    rev = await published_one(db)
    summary = await schedule_outbox.process_batch(50, rev["id"])
    assert (summary["claimed"], summary["sent"], summary["push_accepted"]) == (1, 1, 1)
    inbox = db.rows["notifications"]
    assert len(inbox) == 1 and inbox[0]["user_id"] == U_HK1 and inbox[0]["type"] == "schedule_published" and not inbox[0].get("is_read")
    data = inbox[0]["data"]
    assert data["kind"] == "schedule" and data["screen"] == "my_schedule" and data["revision_id"] == rev["id"] and data["i18n"]["key"] == "scheduleNotice.published"
    row = db.rows["schedule_notifications"][0]
    assert (row["status"], row["push_status"], row["notification_id"]) == ("sent", "accepted", inbox[0]["id"])   # accepted, NOT "delivered"
    assert [d["channel"] for d in db.rows["notification_deliveries"]] == ["in_app"]
    assert sent[0]["title"] == "Schedule updated" and "shift" not in sent[0]["body"].lower()                  # generic lock-screen text
    assert "notification_sent" in [e["event"] for e in db.rows["schedule_revision_events"] if e["revision_id"] == rev["id"]]


@pytest.mark.asyncio
async def test_a_retry_after_a_crash_between_the_inbox_write_and_the_status_update_creates_no_duplicate(db, monkeypatch):
    push_recorder(monkeypatch)
    rev = await published_one(db)
    await schedule_outbox.process_batch(50, rev["id"])
    row = db.rows["schedule_notifications"][0]
    row.update(status="queued", notification_id=None)                          # the process died before it could record success
    await schedule_outbox.process_batch(50, rev["id"])
    assert len(db.rows["notifications"]) == 1 and row["status"] == "sent" and row["notification_id"] == db.rows["notifications"][0]["id"]


@pytest.mark.asyncio
async def test_a_push_failure_never_fails_the_message_the_inbox_row_is_the_baseline(db, monkeypatch):
    push_recorder(monkeypatch, {"sent": 0, "opted_out": [], "no_device": [], "failed": 1})
    rev = await published_one(db)
    summary = await schedule_outbox.process_batch(50, rev["id"])
    row = db.rows["schedule_notifications"][0]
    assert summary["sent"] == 1 and row["status"] == "sent" and row["push_status"] == "failed" and len(db.rows["notifications"]) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome,expected", [
    ({"sent": 0, "opted_out": [U_HK1], "no_device": [], "failed": 0}, "opted_out"),
    ({"sent": 0, "opted_out": [], "no_device": [U_HK1], "failed": 0}, "no_device"),
])
async def test_opt_outs_and_missing_devices_are_recorded_honestly(db, monkeypatch, outcome, expected):
    push_recorder(monkeypatch, outcome)
    rev = await published_one(db)
    await schedule_outbox.process_batch(50, rev["id"])
    assert db.rows["schedule_notifications"][0]["push_status"] == expected and len(db.rows["notifications"]) == 1


# --- failures and retries -------------------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_a_delivery_failure_keeps_the_schedule_and_backs_off_instead_of_retrying_immediately(db, monkeypatch):
    push_recorder(monkeypatch)
    rev = await published_one(db)

    def boom(*a, **k):
        raise RuntimeError("database says: Ana Lopez has approved leave")     # a message that must never be stored
    monkeypatch.setattr(schedule_outbox, "_ensure_inbox_row", boom)
    summary = await schedule_outbox.process_batch(50, rev["id"])
    row = db.rows["schedule_notifications"][0]
    assert summary["failed"] == 1 and row["status"] == "failed" and row["attempts"] == 1
    assert row["last_error"] == "RuntimeError"                                  # the class only, never the message text
    assert datetime.fromisoformat(row["next_attempt_at"]) > datetime.now(timezone.utc) + timedelta(seconds=30)
    assert db.rows["shift_assignments"] and rev["status"] == "published"        # the published schedule is untouched
    again = await schedule_outbox.process_batch(50, rev["id"])
    assert again["claimed"] == 0                                                # not due yet: no retry storm


@pytest.mark.asyncio
async def test_retries_are_bounded_then_a_manager_can_reset_and_succeed(db, monkeypatch):
    push_recorder(monkeypatch)
    rev = await published_one(db)
    monkeypatch.setattr(schedule_outbox, "_ensure_inbox_row", lambda *a, **k: (_ for _ in ()).throw(ConnectionError("x")))
    row = db.rows["schedule_notifications"][0]
    for _ in range(MAX_ATTEMPTS):
        row["next_attempt_at"] = datetime.now(timezone.utc).isoformat()
        await schedule_outbox.process_batch(50, rev["id"])
    assert row["attempts"] == MAX_ATTEMPTS and row["status"] == "failed"
    row["next_attempt_at"] = datetime.now(timezone.utc).isoformat()
    assert (await schedule_outbox.process_batch(50, rev["id"]))["claimed"] == 0     # exhausted: never claimed again by itself
    status = (await revs.notification_status(rev["id"], SUP))["data"]
    assert status["state"] == "failed" and status["failed"][0]["retryable"] is False and status["failed"][0]["name"] == "Ana Lopez"
    assert "notification_failed" in [e["event"] for e in db.rows["schedule_revision_events"]]
    monkeypatch.undo()
    monkeypatch.setattr(schedule_outbox.notify, "send_push", lambda **kw: _ok())
    for module in (*MODULES, revs, revision_store, schedule_outbox):
        monkeypatch.setattr(module, "supabase", db)
    reset = (await revs.retry_notifications(rev["id"], BackgroundTasks(), SUP))["data"]
    assert reset["reset"] == 1
    await schedule_outbox.process_batch(50, rev["id"])
    assert row["status"] == "sent" and len(db.rows["notifications"]) == 1


async def _ok():
    return {"sent": 1, "opted_out": [], "no_device": [], "failed": 0}


def test_backoff_grows_and_stops():
    assert [backoff_seconds(n) for n in (1, 2, 3, 4)] == [60, 300, 1800, 7200]
    assert backoff_seconds(MAX_ATTEMPTS) is None


# --- enqueue / dedupe / privacy -------------------------------------------------------------------------------------------

def test_enqueue_is_idempotent_and_ignores_unknown_events(db):
    first = schedule_outbox.enqueue(HOTEL, [U_HK1, U_HK1, U_HK2], "schedule_offer_received", "offer-1", {"offer_id": "o1"})
    schedule_outbox.enqueue(HOTEL, [U_HK1], "schedule_offer_received", "offer-1", {"offer_id": "o1"})         # a network retry
    assert first == 2 and len(db.rows["schedule_notifications"]) == 2
    assert schedule_outbox.enqueue(HOTEL, [U_HK1], "made_up_event", "k") == 0 and len(db.rows["schedule_notifications"]) == 2


def test_every_schedule_event_is_a_classified_push_event_with_a_screen():
    assert set(schedule_outbox.EVENTS) <= set(notify.PUSH_EVENTS)
    for event, (screen, title, body) in schedule_outbox.EVENTS.items():
        assert screen and title and body and notify.PUSH_EVENTS[event].category == "schedule", event


def test_messages_never_carry_leave_reasons_or_manager_notes():
    payload = {"revision_id": "r", "assignment_id": "a", "added": 1, "first_date": "2030-01-08",
               "reason": "surgery", "note": "called out sick", "leave_reason": "family", "response_note": "private"}
    for event in schedule_outbox.EVENTS:
        rendered = schedule_outbox.render(event, payload)
        blob = str(rendered).lower()
        assert not any(secret in blob for secret in ("surgery", "sick", "family", "private")), event
    assert schedule_outbox.render("not_an_event", payload) is None
