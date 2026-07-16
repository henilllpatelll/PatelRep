from pathlib import Path

import pytest

from services.guest_recovery.contracts import (
    AccessibilityPriorityError,
    InvalidGuestRequestTransition,
    MissingCustodyVerificationError,
    calculate_guest_request_metrics,
    resolve_sla_minutes,
    validate_guest_request_transition,
    validate_lost_found_custody_event,
)


def test_sla_policy_prefers_exact_category_priority_and_guest_impact_match():
    policies = [
        {"category": None, "priority": "normal", "guest_impact": None, "sla_minutes": 240},
        {"category": "accessibility", "priority": "urgent", "guest_impact": "high", "sla_minutes": 30},
    ]

    assert resolve_sla_minutes(
        policies, category="accessibility", priority="urgent", guest_impact="high"
    ) == 30


def test_accessibility_request_requires_urgent_priority():
    with pytest.raises(AccessibilityPriorityError):
        validate_guest_request_transition(
            current_status="open",
            next_status="acknowledged",
            category="accessibility",
            priority="normal",
        )


def test_guest_request_lifecycle_rejects_skipping_required_milestones():
    validate_guest_request_transition(
        current_status="acknowledged",
        next_status="dispatched",
        category="service",
        priority="normal",
    )

    with pytest.raises(InvalidGuestRequestTransition):
        validate_guest_request_transition(
            current_status="acknowledged",
            next_status="verified",
            category="service",
            priority="normal",
        )


def test_lost_found_release_requires_identity_verification():
    with pytest.raises(MissingCustodyVerificationError):
        validate_lost_found_custody_event(
            event_type="released",
            verification_method=None,
            recipient_name="Guest",
        )


def test_guest_recovery_metrics_reconcile_known_fixture_data():
    metrics = calculate_guest_request_metrics([
        {
            "created_at": "2026-07-16T10:00:00+00:00",
            "acknowledged_at": "2026-07-16T10:05:00+00:00",
            "verified_at": "2026-07-16T10:25:00+00:00",
            "due_at": "2026-07-16T10:30:00+00:00",
            "status": "verified",
        },
        {
            "created_at": "2026-07-16T10:00:00+00:00",
            "acknowledged_at": "2026-07-16T10:20:00+00:00",
            "verified_at": None,
            "due_at": "2026-07-16T10:10:00+00:00",
            "status": "resolved",
        },
    ])

    assert metrics == {
        "total_requests": 2,
        "verified_resolution_rate_pct": 50.0,
        "sla_met_rate_pct": 50.0,
        "average_acknowledgement_minutes": 12.5,
        "average_verified_resolution_minutes": 25.0,
    }


def test_phase_five_migration_preserves_auditable_guest_and_custody_records():
    migration = Path(__file__).parents[3] / "supabase" / "migrations" / "072_guest_recovery_and_roi.sql"
    sql = migration.read_text(encoding="utf-8")

    assert "CREATE TABLE public.guest_request_events" in sql
    assert "CREATE TABLE public.guest_messages" in sql
    assert "CREATE TABLE public.accessible_room_features" in sql
    assert "CREATE TABLE public.lost_found_custody_events" in sql
    assert "guest_request_events_immutable" in sql
    assert "lost_found_custody_events_immutable" in sql
    assert "excluded_from_ai" in sql
