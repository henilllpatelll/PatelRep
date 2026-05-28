import pytest
from pydantic import ValidationError

from models.requests import (
    CompleteWorkOrderRequest,
    CreateAssignmentsRequest,
    CreateGuestRequestRequest,
    CreateShiftRequest,
    CreateTaskRequest,
    InviteStaffRequest,
    RoomAssignmentItem,
)


def test_string_inputs_are_trimmed_normalized_and_html_escaped():
    request = CreateTaskRequest(
        title="  <script>alert(1)</script>\x00  ",
        description="Guest\tneeds    towels",
        task_type="housekeeping",
    )

    assert request.title == "&lt;script&gt;alert(1)&lt;/script&gt;"
    assert request.description == "Guest needs towels"


def test_required_text_fields_reject_blank_after_sanitization():
    with pytest.raises(ValidationError):
        CreateGuestRequestRequest(title="   ", description="extra towels")


def test_email_phone_and_names_are_normalized_without_touching_passwords():
    invitation = InviteStaffRequest(
        email="  USER@EXAMPLE.COM  ",
        full_name="\x00 Jane\tDoe ",
        phone=" (555) 123-4567 ",
        role="housekeeper",
    )

    assert invitation.email == "user@example.com"
    assert invitation.full_name == "Jane Doe"
    assert invitation.phone == "(555) 123-4567"


def test_numeric_and_collection_bounds_are_enforced():
    with pytest.raises(ValidationError):
        CompleteWorkOrderRequest(labor_hours=-0.25)

    with pytest.raises(ValidationError):
        CreateAssignmentsRequest(date="2026-05-28", assignments=[])

    assignment = RoomAssignmentItem(
        room_id="11111111-1111-4111-8111-111111111111",
        housekeeper_id="22222222-2222-4222-8222-222222222222",
    )
    CreateAssignmentsRequest(date="2026-05-28", assignments=[assignment])


def test_shift_times_must_use_24_hour_clock_format():
    with pytest.raises(ValidationError):
        CreateShiftRequest(
            name="Morning",
            department_id="33333333-3333-4333-8333-333333333333",
            start_time="7am",
            end_time="15:00:00",
        )

    valid = CreateShiftRequest(
        name="Morning",
        department_id="33333333-3333-4333-8333-333333333333",
        start_time="07:00:00",
        end_time="15:00:00",
    )
    assert valid.start_time == "07:00:00"
