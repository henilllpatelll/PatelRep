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

# USD per 1,000,000 tokens. Current as of 2026-07 — re-confirm against provider
# pricing pages if billing accuracy is disputed.
MODEL_RATES = {
    "gpt-4o-mini": {"in": 0.15, "out": 0.60},
    "claude-sonnet": {"in": 3.00, "out": 15.00},
}

INTERACTION_MODEL = {
    "task_creation": "gpt-4o-mini",
    "work_order_creation": "gpt-4o-mini",
    "guest_request_creation": "gpt-4o-mini",
    "task_assignment": "gpt-4o-mini",
    "assignment_suggestion": "gpt-4o-mini",
    "onboarding_assistant": "gpt-4o-mini",
    "sop_query": "claude-sonnet",
    "gm_insight": "claude-sonnet",
    "room_prediction": "claude-sonnet",
    "failure_prediction": "claude-sonnet",
    "shift_summary": "claude-sonnet",
    "housekeeping_briefing": "claude-sonnet",
}

DOLLARS_PER_CREDIT = 0.02  # $0.02 per AI credit per CLAUDE.md pricing


def get_or_create_current_period_ledger(hotel_id: str) -> dict:
    """
    Returns the current-period credit_ledger row for hotel_id, creating it if the
    period just rolled over and no AI call has happened yet.

    Extracted from check_and_deduct_credits's inline lazy-create so GET
    /billing/credits (billing.py) gets the same "never stale/missing" guarantee
    as the AI-call path (BILLING-02) -- previously only the AI-call path created
    this row, so the billing page showed a placeholder message until the first
    AI call of the new month.
    """
    today = date.today()
    ledger_result = supabase.table("credit_ledger")\
        .select("*")\
        .eq("tenant_id", hotel_id)\
        .lte("period_start", today.isoformat())\
        .gte("period_end", today.isoformat())\
        .maybe_single()\
        .execute()

    if ledger_result and ledger_result.data:
        return ledger_result.data

    period_start = date(today.year, today.month, 1)
    period_end = period_start + relativedelta(months=1) - timedelta(days=1)

    sub_result = supabase.table("subscriptions")\
        .select("credits_included, cap_cents, plan_status")\
        .eq("tenant_id", hotel_id)\
        .maybe_single()\
        .execute()
    credits_included = (sub_result.data or {}).get("credits_included", 5000) if sub_result else 5000

    try:
        supabase.table("credit_ledger").insert({
            "tenant_id": hotel_id,
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(),
            "credits_included": credits_included,
        }).execute()
    except Exception:
        # UNIQUE (tenant_id, period_start) -- an AI call and a billing-page view
        # can race at rollover. Fall through to re-select rather than erroring.
        pass

    ledger_result = supabase.table("credit_ledger")\
        .select("*")\
        .eq("tenant_id", hotel_id)\
        .lte("period_start", today.isoformat())\
        .gte("period_end", today.isoformat())\
        .maybe_single()\
        .execute()
    return (ledger_result.data if ledger_result else None) or {}


def compute_credits(interaction_type: str, prompt_tokens: int, completion_tokens: int) -> float:
    """
    Derive the billable credit amount from real token usage.

    CREDIT_COSTS is retained as a per-interaction-type revenue floor: short
    calls still bill at least the old flat amount (no revenue regression),
    while long calls bill more (CLAUDE.md A3 — never a fixed cost).
    """
    model = INTERACTION_MODEL.get(interaction_type, "gpt-4o-mini")
    rates = MODEL_RATES[model]
    usd = (prompt_tokens / 1_000_000) * rates["in"] + (completion_tokens / 1_000_000) * rates["out"]
    token_credits = usd / DOLLARS_PER_CREDIT
    floor = CREDIT_COSTS.get(interaction_type, 1.0)
    return round(max(floor, token_credits), 4)


async def check_and_deduct_credits(
    hotel_id: str,
    interaction_type: str,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
) -> float:
    """
    Checks credit availability and deducts credits for an AI interaction.
    Returns the credits charged (token-derived — see compute_credits).
    Raises HTTPException if at cap or trial exhausted.
    """
    credits = compute_credits(interaction_type, prompt_tokens, completion_tokens)

    ledger = get_or_create_current_period_ledger(hotel_id)

    # Check cap
    sub_result = supabase.table("subscriptions")\
        .select("cap_cents, plan_status")\
        .eq("tenant_id", hotel_id)\
        .maybe_single()\
        .execute()

    if sub_result and sub_result.data:
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
