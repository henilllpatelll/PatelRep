"""RED->GREEN regression tests for a milestone-audit blocker (v1.0-MILESTONE-AUDIT.md,
gap AI-COPILOT-GR-01): routers/ai_copilot.py::confirm_guest_requests did a bare insert
into guest_requests with none of the fields the escalation cron and audit trail depend
on — no sla_minutes, no due_at, no linked task, no guest_request_events row. Compare to
the canonical routers/guest_requests.py::create_guest_request, which does all of this.

These tests invoke routers.ai_copilot.confirm_guest_requests() directly, monkeypatching
only the Supabase client (the pattern established in tests/smoke/test_ai_assignment_confirm.py
and tests/test_ai_copilot_credits.py) — never TestClient.
"""

from fastapi import HTTPException
import pytest

from middleware.auth import CurrentUser
from models.requests import GuestRequestPreview
from routers import ai_copilot
from tests.smoke.fake_supabase import FakeDB


GM = CurrentUser(
    user_id="11111111-1111-4111-8111-111111111111",
    hotel_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    role="gm",
    email="gm@example.com",
)

ROOM_ID = "22222222-2222-4222-8222-222222222222"


def _db_with_room():
    return FakeDB({
        "rooms": [{"id": ROOM_ID, "tenant_id": GM.hotel_id, "room_number": "412"}],
        "guest_request_sla_policies": [],
    })


@pytest.mark.asyncio
async def test_confirm_guest_requests_creates_linked_task_with_sla(monkeypatch):
    db = _db_with_room()
    monkeypatch.setattr(ai_copilot, "supabase", db)

    response = await ai_copilot.confirm_guest_requests(
        [
            GuestRequestPreview(
                title="Extra towels",
                room_number="412",
                guest_name="Smith",
                description="Guest needs 2 more towels",
                category="housekeeping",
                priority="urgent",
                guest_impact="high",
            )
        ],
        current_user=GM,
    )

    assert response["data"]["created_count"] == 1
    gr_row = response["data"]["requests"][0]

    # The guest_requests row itself must carry the SLA fields the escalation
    # cron and any manual audit would need.
    assert gr_row["category"] == "housekeeping"
    assert gr_row["priority"] == "urgent"
    assert gr_row["guest_impact"] == "high"
    assert gr_row["sla_minutes"] is not None
    assert gr_row["due_at"] is not None

    # A linked task must exist — this is what routers/internal.py::check_escalations
    # actually scans (it never queries guest_requests directly).
    task_inserts = [row for table, row in db.inserts if table == "tasks"]
    assert len(task_inserts) == 1
    task = task_inserts[0]
    assert task["task_type"] == "guest_request"
    assert task["priority"] == "urgent"
    assert task["due_at"] == gr_row["due_at"]
    assert task["sla_minutes"] == gr_row["sla_minutes"]
    assert task["room_id"] == ROOM_ID

    # The guest_requests row must be back-filled with the linked task's id.
    assert gr_row["task_id"] == task["id"]

    # An audit event must be recorded (mirrors create_guest_request's contract).
    event_inserts = [row for table, row in db.inserts if table == "guest_request_events"]
    assert len(event_inserts) == 1
    event = event_inserts[0]
    assert event["event_type"] == "created"
    assert event["guest_request_id"] == gr_row["id"]
    # 'ai_copilot' is not a valid guest_request_events.source per the CHECK
    # constraint (migration 072: staff|sms|automation|guest) — must use 'automation'.
    assert event["source"] == "automation"


@pytest.mark.asyncio
async def test_confirm_guest_requests_respects_tenant_sla_policy(monkeypatch):
    db = _db_with_room()
    db.rows["guest_request_sla_policies"] = [{
        "tenant_id": GM.hotel_id,
        "category": "maintenance",
        "priority": "urgent",
        "guest_impact": "high",
        "sla_minutes": 15,
    }]
    monkeypatch.setattr(ai_copilot, "supabase", db)

    response = await ai_copilot.confirm_guest_requests(
        [
            GuestRequestPreview(
                title="AC not working",
                room_number="412",
                category="maintenance",
                priority="urgent",
                guest_impact="high",
            )
        ],
        current_user=GM,
    )

    gr_row = response["data"]["requests"][0]
    # Must resolve from the tenant's configured policy (15 min), not a hardcoded
    # default (240 min) — proving resolve_sla_minutes() is actually being used.
    assert gr_row["sla_minutes"] == 15


@pytest.mark.asyncio
async def test_confirm_guest_requests_rejects_accessibility_without_urgent(monkeypatch):
    db = _db_with_room()
    monkeypatch.setattr(ai_copilot, "supabase", db)

    with pytest.raises(HTTPException) as exc_info:
        await ai_copilot.confirm_guest_requests(
            [
                GuestRequestPreview(
                    title="Need accessible bathroom bars",
                    room_number="412",
                    category="accessibility",
                    priority="normal",
                )
            ],
            current_user=GM,
        )

    assert exc_info.value.status_code == 422

    # Batch must be rejected before any row is written (matches create_guest_request's
    # fail-fast validation — no partial writes on invalid input).
    assert db.inserts == []


@pytest.mark.asyncio
async def test_confirm_guest_requests_defaults_when_category_priority_omitted(monkeypatch):
    """The LLM parser may not always populate category/priority/guest_impact —
    pydantic defaults (service/normal/standard) must still produce a valid,
    escalation-eligible request, not a crash or a null-SLA row."""
    db = _db_with_room()
    monkeypatch.setattr(ai_copilot, "supabase", db)

    response = await ai_copilot.confirm_guest_requests(
        [GuestRequestPreview(title="Guest wants extra pillows", room_number="412")],
        current_user=GM,
    )

    gr_row = response["data"]["requests"][0]
    assert gr_row["category"] == "service"
    assert gr_row["priority"] == "normal"
    assert gr_row["guest_impact"] == "standard"
    assert gr_row["sla_minutes"] is not None
    assert gr_row["due_at"] is not None
    task_inserts = [row for table, row in db.inserts if table == "tasks"]
    assert len(task_inserts) == 1
