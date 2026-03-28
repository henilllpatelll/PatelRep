from fastapi import HTTPException
from core.database import supabase
from datetime import date, timedelta
from dateutil.relativedelta import relativedelta

CREDIT_COSTS = {
    "task_creation": 1.0,
    "room_prediction": 0.5,
    "sop_query": 2.0,
    "failure_prediction": 0.25,
    "shift_summary": 3.0,
    "gm_insight": 2.0,
    "assignment_suggestion": 0.5,
    "onboarding_assistant": 1.0,
}


async def check_and_deduct_credits(hotel_id: str, interaction_type: str) -> float:
    """
    Checks credit availability and deducts credits for an AI interaction.
    Returns the credits charged.
    Raises HTTPException if at cap or trial exhausted.
    """
    credits = CREDIT_COSTS.get(interaction_type, 1.0)

    # Get current period ledger
    today = date.today()
    ledger_result = supabase.table("credit_ledger")\
        .select("*")\
        .eq("tenant_id", hotel_id)\
        .lte("period_start", today.isoformat())\
        .gte("period_end", today.isoformat())\
        .maybe_single()\
        .execute()

    if not ledger_result.data:
        # Create ledger for current period
        period_start = date(today.year, today.month, 1)
        period_end = period_start + relativedelta(months=1) - timedelta(days=1)

        sub_result = supabase.table("subscriptions")\
            .select("credits_included, cap_cents, plan_status")\
            .eq("tenant_id", hotel_id)\
            .maybe_single()\
            .execute()

        credits_included = sub_result.data.get("credits_included", 5000) if sub_result.data else 5000

        supabase.table("credit_ledger").insert({
            "tenant_id": hotel_id,
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(),
            "credits_included": credits_included,
        }).execute()

        ledger_result = supabase.table("credit_ledger")\
            .select("*")\
            .eq("tenant_id", hotel_id)\
            .lte("period_start", today.isoformat())\
            .gte("period_end", today.isoformat())\
            .maybe_single()\
            .execute()

    ledger = ledger_result.data

    # Check cap
    sub_result = supabase.table("subscriptions")\
        .select("cap_cents, plan_status")\
        .eq("tenant_id", hotel_id)\
        .maybe_single()\
        .execute()

    if sub_result.data:
        sub = sub_result.data
        if sub.get("cap_cents"):
            current_overage = ledger.get("overage_cost_cents", 0)
            base_fee = 9900  # $99.00
            if current_overage >= sub["cap_cents"] - base_fee:
                raise HTTPException(
                    status_code=402,
                    detail="Monthly AI credit cap reached. Upgrade or wait for next billing period."
                )

    # Deduct credits
    supabase.rpc("increment_credits_used", {
        "p_hotel_id": hotel_id,
        "p_credits": credits
    }).execute()

    return credits


async def log_ai_interaction(
    hotel_id: str,
    user_id: str,
    interaction_type: str,
    model_used: str,
    credits_charged: float,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    latency_ms: int = 0,
    success: bool = True,
    error_message: str = None
):
    supabase.table("ai_interactions").insert({
        "tenant_id": hotel_id,
        "user_id": user_id,
        "interaction_type": interaction_type,
        "model_used": model_used,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "credits_charged": credits_charged,
        "latency_ms": latency_ms,
        "success": success,
        "error_message": error_message,
    }).execute()
