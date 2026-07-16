from pathlib import Path

import pytest

from services.ai.governance import (
    InvalidRecommendationTransition,
    UnsafeAIAction,
    calculate_recommendation_metrics,
    validate_ai_action,
    validate_recommendation_transition,
)
from services.opera.sync import has_reservation_conflict


def test_ai_recommendation_allows_a_supervised_operational_action():
    assert validate_ai_action("create_work_order") == "create_work_order"


def test_ai_recommendation_rejects_controlled_work_actions():
    with pytest.raises(UnsafeAIAction):
        validate_ai_action("complete_controlled_work")


def test_recommendation_must_be_authorized_before_execution():
    validate_recommendation_transition("pending", "authorized")

    with pytest.raises(InvalidRecommendationTransition):
        validate_recommendation_transition("pending", "executed")


def test_recommendation_metrics_capture_acceptance_overrides_and_false_positives():
    metrics = calculate_recommendation_metrics([
        {"status": "authorized", "outcome": None},
        {"status": "overridden", "outcome": None},
        {"status": "outcome_recorded", "outcome": "false_positive"},
        {"status": "rejected", "outcome": "no_action_needed"},
    ])

    assert metrics == {
        "total_recommendations": 4,
        "acceptance_rate_pct": 25.0,
        "override_rate_pct": 25.0,
        "false_positive_rate_pct": 25.0,
        "outcome_recorded_rate_pct": 50.0,
    }


def test_opera_conflict_detection_only_pauses_a_meaningful_guest_disagreement():
    assert has_reservation_conflict(
        {"guest_name": "Local Guest"}, {"guest_name": "Opera Guest"}
    ) is True
    assert has_reservation_conflict(
        {"guest_name": "Same Guest"}, {"guest_name": "Same Guest"}
    ) is False
    assert has_reservation_conflict(None, {"guest_name": "Opera Guest"}) is False


def test_phase_six_migration_preserves_conflicts_and_ai_governance_history():
    migration = Path(__file__).parents[3] / "supabase" / "migrations" / "073_pms_ai_governance.sql"
    sql = migration.read_text(encoding="utf-8")

    assert "CREATE TABLE public.integration_sync_conflicts" in sql
    assert "CREATE TABLE public.ai_recommendations" in sql
    assert "CREATE TABLE public.ai_recommendation_events" in sql
    assert "ai_recommendation_events_immutable" in sql
