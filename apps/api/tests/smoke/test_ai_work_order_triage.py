from datetime import datetime, timedelta, timezone

from routers import ai_copilot


def test_empty_work_orders_returns_no_work_message():
    result = ai_copilot._build_work_order_triage_summary([])
    assert result == "No open work orders to triage."


def test_overdue_and_unassigned_prioritized_first():
    now = datetime.now(timezone.utc)
    past = (now - timedelta(hours=2)).isoformat()
    future = (now + timedelta(hours=5)).isoformat()

    work_orders = [
        {
            "room_number": "205",
            "title": "AC not cooling",
            "priority": "normal",
            "due_at": future,
            "assigned_to": "engineer-1",
        },
        {
            "room_number": "310",
            "title": "Leak under sink",
            "priority": "urgent",
            "due_at": past,
            "assigned_to": None,
        },
        {
            "room_number": "118",
            "title": "Elevator noise",
            "priority": "low",
            "due_at": future,
            "assigned_to": "engineer-2",
        },
    ]

    message = ai_copilot._build_work_order_triage_summary(work_orders)

    assert "3 open work order(s)" in message
    assert "1 overdue" in message
    assert "1 unassigned" in message

    floor_order_segment = message.split("Suggested floor order: ")[1]
    # Overdue + unassigned item (310) must appear before a non-overdue item (205, 118)
    assert floor_order_segment.index("310") < floor_order_segment.index("205")
    assert floor_order_segment.index("310") < floor_order_segment.index("118")


def test_malformed_due_at_does_not_crash():
    work_orders = [
        {
            "room_number": "412",
            "title": "Broken window latch",
            "priority": "normal",
            "due_at": "not-a-date",
            "assigned_to": None,
        }
    ]

    result = ai_copilot._build_work_order_triage_summary(work_orders)

    assert isinstance(result, str)
    assert "1 open work order(s)" in result
