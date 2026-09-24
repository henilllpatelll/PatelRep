"""Small, reusable policy helpers for room unavailability episodes."""

from datetime import datetime, timezone

from fastapi import HTTPException


def is_past_eta(period: dict, now: datetime | None = None) -> bool:
    """Return a derived attention condition; this never changes room state."""
    if period.get("status") != "ACTIVE" or not period.get("expected_return_at"):
        return False
    try:
        expected = datetime.fromisoformat(str(period["expected_return_at"]).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return False
    return expected < (now or datetime.now(timezone.utc))


def validate_eta_change(
    current_expected: datetime | None, new_expected: datetime | None, note: str | None
) -> None:
    """A later promise needs an explanation; an earlier one may be concise."""
    if not new_expected:
        raise HTTPException(status_code=422, detail="Expected return is required")
    if current_expected and new_expected > current_expected and not (note or "").strip():
        raise HTTPException(status_code=422, detail="A reason is required when moving the expected return later")
