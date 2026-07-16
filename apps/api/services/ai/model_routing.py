"""One source of truth for the models used by each AI workflow."""

import logging

from core.database import supabase

logger = logging.getLogger(__name__)

DEFAULT_MODEL_ROUTES = {
    "copilot_fast_path": "gpt-4o-mini",
    "failure_prediction": "claude-sonnet-4-6",
    "room_readiness": "claude-sonnet-4-6",
    "sop_rag": "claude-sonnet-4-6",
}


def resolve_model(purpose: str, hotel_id: str | None = None) -> str:
    if hotel_id:
        try:
            route = supabase.table("ai_model_routes") \
                .select("model_name") \
                .eq("tenant_id", hotel_id) \
                .eq("purpose", purpose) \
                .maybe_single() \
                .execute()
            if route.data and route.data.get("model_name"):
                return route.data["model_name"]
        except Exception as exc:
            logger.warning("Using default AI model route for purpose=%s: %s", purpose, exc)
    try:
        return DEFAULT_MODEL_ROUTES[purpose]
    except KeyError as exc:
        raise ValueError(f"Unknown AI model route: {purpose}") from exc
