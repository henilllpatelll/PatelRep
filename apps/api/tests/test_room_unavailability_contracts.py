from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from services.room_unavailability import is_past_eta, validate_eta_change


NOW = datetime(2026, 9, 21, 15, 0, tzinfo=timezone.utc)


def test_active_period_with_elapsed_eta_is_past_eta():
    assert is_past_eta(
        {"status": "ACTIVE", "expected_return_at": (NOW - timedelta(minutes=38)).isoformat()}, NOW
    )


def test_released_or_unknown_eta_is_not_past_eta():
    assert not is_past_eta({"status": "RELEASED", "expected_return_at": (NOW - timedelta(minutes=1)).isoformat()}, NOW)
    assert not is_past_eta({"status": "ACTIVE", "expected_return_at": None}, NOW)


def test_later_eta_requires_a_reason():
    with pytest.raises(HTTPException, match="reason"):
        validate_eta_change(NOW, NOW + timedelta(minutes=30), None)


def test_earlier_eta_does_not_require_a_reason():
    validate_eta_change(NOW, NOW - timedelta(minutes=30), None)
