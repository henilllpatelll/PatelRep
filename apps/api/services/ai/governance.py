"""Policy helpers for AI recommendations that require a human decision."""


class UnsafeAIAction(ValueError):
    """Raised when an AI suggestion tries to perform controlled work."""


class InvalidRecommendationTransition(ValueError):
    """Raised when recommendation lifecycle states are skipped."""


SAFE_ACTIONS = {
    "create_work_order",
    "notify_supervisor",
    "request_inspection",
    "adjust_room_assignment",
}

CONTROLLED_ACTIONS = {
    "clear_safety_record",
    "complete_controlled_work",
    "close_compliance_exception",
}

VALID_TRANSITIONS = {
    "pending": {"authorized", "rejected", "overridden"},
    "authorized": {"executed", "overridden", "rejected"},
    "executed": {"outcome_recorded", "overridden"},
}


def validate_ai_action(action: str) -> str:
    if action in CONTROLLED_ACTIONS or action not in SAFE_ACTIONS:
        raise UnsafeAIAction("AI may only suggest a supervised operational action.")
    return action


def validate_recommendation_transition(current_status: str, next_status: str) -> None:
    if next_status not in VALID_TRANSITIONS.get(current_status, set()):
        raise InvalidRecommendationTransition(
            f"Cannot move an AI recommendation from {current_status} to {next_status}."
        )


def calculate_recommendation_metrics(recommendations: list[dict]) -> dict:
    total = len(recommendations)
    accepted = sum(item.get("status") in {"authorized", "executed"} for item in recommendations)
    overrides = sum(item.get("status") == "overridden" for item in recommendations)
    false_positives = sum(item.get("outcome") == "false_positive" for item in recommendations)
    outcomes = sum(bool(item.get("outcome")) for item in recommendations)
    def rate(count: int) -> float:
        return round((count / total) * 100, 1) if total else 0.0

    return {
        "total_recommendations": total,
        "acceptance_rate_pct": rate(accepted),
        "override_rate_pct": rate(overrides),
        "false_positive_rate_pct": rate(false_positives),
        "outcome_recorded_rate_pct": rate(outcomes),
    }
