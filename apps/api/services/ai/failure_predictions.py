import json
import logging
from datetime import datetime, timedelta

import anthropic

from core.config import settings
from core.database import supabase

logger = logging.getLogger(__name__)

claude = anthropic.Anthropic(api_key=settings.anthropic_api_key)

# ---------------------------------------------------------------------------
# Claude prompt template for asset failure analysis
# ---------------------------------------------------------------------------

FAILURE_ANALYSIS_SYSTEM_PROMPT = """You are an expert hotel facilities engineer analyzing asset health data to predict equipment failures.

Your job is to assess each asset's failure risk based on its age, maintenance history, PM compliance, and warranty status.

Always respond with ONLY valid JSON — no markdown fences, no explanation outside the JSON object."""


def _build_asset_prompt(
    asset: dict,
    category_name: str,
    work_orders: list[dict],
    pm_schedules: list[dict],
) -> str:
    """Build the Claude user-message prompt for a single asset."""
    name = asset.get("name", "Unknown Asset")
    manufacturer = asset.get("manufacturer") or "Unknown"
    model = asset.get("model") or "Unknown"
    replacement_cost = asset.get("replacement_cost")
    expected_lifespan = asset.get("expected_lifespan_years")
    installation_date = asset.get("installation_date")
    warranty_expires = asset.get("warranty_expires")
    purchase_date = asset.get("purchase_date")

    # Compute asset age
    if installation_date:
        try:
            install_dt = datetime.fromisoformat(str(installation_date))
            age_years = round((datetime.utcnow() - install_dt).days / 365.25, 1)
        except Exception:
            age_years = None
    elif purchase_date:
        try:
            purchase_dt = datetime.fromisoformat(str(purchase_date))
            age_years = round((datetime.utcnow() - purchase_dt).days / 365.25, 1)
        except Exception:
            age_years = None
    else:
        age_years = None

    age_str = f"{age_years} years" if age_years is not None else "Unknown"
    install_str = installation_date or purchase_date or "Unknown"

    # Warranty status
    if warranty_expires:
        try:
            warranty_dt = datetime.fromisoformat(str(warranty_expires))
            if warranty_dt < datetime.utcnow():
                warranty_status = f"EXPIRED on {warranty_expires}"
            else:
                days_left = (warranty_dt - datetime.utcnow()).days
                warranty_status = f"Active (expires {warranty_expires}, {days_left} days remaining)"
        except Exception:
            warranty_status = f"Expires {warranty_expires}"
    else:
        warranty_status = "No warranty on file"

    # Work order analysis
    wo_count = len(work_orders)
    urgent_count = sum(
        1 for wo in work_orders
        if str(wo.get("category", "")).lower() in ("urgent", "emergency")
        or str(wo.get("priority", "")).lower() in ("urgent", "emergency")
    )

    if work_orders:
        wo_summary_parts = []
        for wo in work_orders[:5]:  # Show last 5 for brevity
            title = wo.get("title", "Work order")
            created = str(wo.get("created_at", ""))[:10]
            status = wo.get("status", "")
            wo_summary_parts.append(f"- {title} ({status}, {created})")
        wo_summary = "\n".join(wo_summary_parts)
    else:
        wo_summary = "No maintenance history in last 12 months"

    # PM schedule analysis
    pm_count = len(pm_schedules)
    overdue_pms = []
    last_pm_dates = []
    now = datetime.utcnow()

    for pm in pm_schedules:
        if not pm.get("is_active"):
            continue
        next_due = pm.get("next_due_at")
        last_completed = pm.get("last_completed_at")

        if next_due:
            try:
                due_dt = datetime.fromisoformat(str(next_due).replace("Z", "+00:00"))
                due_naive = due_dt.replace(tzinfo=None)
                if due_naive < now:
                    overdue_pms.append(pm.get("name", "PM schedule"))
            except Exception:
                pass

        if last_completed:
            last_pm_dates.append(str(last_completed)[:10])

    overdue_pm_count = len(overdue_pms)
    last_pm_date = max(last_pm_dates) if last_pm_dates else "Never"

    cost_str = f"${replacement_cost:,.0f}" if replacement_cost else "Unknown"
    lifespan_str = f"{expected_lifespan} years" if expected_lifespan else "Unknown"

    prompt = f"""You are an expert hotel facilities engineer analyzing asset health data to predict equipment failures.

ASSET PROFILE:
- Name: {name}
- Category: {category_name}
- Manufacturer: {manufacturer} | Model: {model}
- Age: {age_str} (installed {install_str})
- Expected Lifespan: {lifespan_str}
- Replacement Cost: {cost_str}
- Warranty: {warranty_status}

MAINTENANCE HISTORY (last 12 months):
- Work orders: {wo_count} total ({urgent_count} urgent/emergency)
- Recent issues:
{wo_summary}

PM SCHEDULE COMPLIANCE:
- Active PM schedules: {pm_count}
- Overdue PMs: {overdue_pm_count}
- Last PM completed: {last_pm_date}

Based on this data, analyze the failure risk for this asset.

Respond with ONLY valid JSON (no markdown):
{{
  "risk_score": <integer 0-100>,
  "predicted_failure_window": "<Within 30 days|Within 90 days|Within 6 months|Within 1 year|No imminent risk>",
  "failure_indicators": ["indicator1", "indicator2"],
  "estimated_repair_cost": <number or null>,
  "estimated_replace_cost": <number or null>,
  "recommendation": "<one sentence action>",
  "ai_reasoning": "<2-3 sentences explaining risk assessment>"
}}"""

    return prompt


def _rule_based_fallback(asset: dict, work_orders: list[dict]) -> dict:
    """
    Compute a simple rule-based risk assessment when Claude is unavailable
    or returns unparseable JSON.
    """
    now = datetime.utcnow()
    installation_date = asset.get("installation_date") or asset.get("purchase_date")
    expected_lifespan = asset.get("expected_lifespan_years")
    warranty_expires = asset.get("warranty_expires")
    wo_count = len(work_orders)

    age_years = None
    if installation_date:
        try:
            install_dt = datetime.fromisoformat(str(installation_date))
            age_years = (now - install_dt).days / 365.25
        except Exception:
            pass

    warranty_expired = False
    if warranty_expires:
        try:
            warranty_dt = datetime.fromisoformat(str(warranty_expires).replace("Z", "+00:00"))
            warranty_expired = warranty_dt.replace(tzinfo=None) < now
        except Exception:
            pass

    # Rule 1: past expected lifespan
    if age_years is not None and expected_lifespan and age_years > expected_lifespan:
        risk_score = 75
        predicted_failure_window = "Within 90 days"
        failure_indicators = ["Asset has exceeded expected lifespan"]
        recommendation = "Schedule immediate inspection and plan for replacement."
    # Rule 2: warranty expired with high work order volume
    elif warranty_expired and wo_count > 3:
        risk_score = 60
        predicted_failure_window = "Within 6 months"
        failure_indicators = [
            "Warranty expired",
            f"{wo_count} work orders in last 12 months",
        ]
        recommendation = "Increase PM frequency and budget for possible replacement."
    else:
        risk_score = 20
        predicted_failure_window = "No imminent risk"
        failure_indicators = []
        recommendation = "Continue standard preventive maintenance schedule."

    return {
        "risk_score": risk_score,
        "predicted_failure_window": predicted_failure_window,
        "failure_indicators": failure_indicators,
        "estimated_repair_cost": None,
        "estimated_replace_cost": asset.get("replacement_cost"),
        "recommendation": recommendation,
        "ai_reasoning": "Rule-based assessment used because AI analysis was unavailable.",
    }


# ---------------------------------------------------------------------------
# Core: analyze a single asset
# ---------------------------------------------------------------------------

def _analyze_asset(
    asset: dict,
    work_orders: list[dict],
    pm_schedules: list[dict],
    hotel_id: str,
) -> dict:
    """
    Call Claude Sonnet to analyze failure risk for a single asset.
    Falls back to rule-based assessment on any error.

    Returns a dict matching the failure_predictions table columns.
    """
    asset_id = asset["id"]
    category_name = (asset.get("asset_categories") or {}).get("name", "General")

    print(f"[failure_predictions] Analyzing asset {asset_id} ({asset.get('name')})")

    try:
        user_prompt = _build_asset_prompt(asset, category_name, work_orders, pm_schedules)

        response = claude.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=512,
            system=FAILURE_ANALYSIS_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )

        raw_text = response.content[0].text.strip()

        # Strip accidental markdown fences if present
        if raw_text.startswith("```"):
            raw_text = raw_text.split("```")[1]
            if raw_text.startswith("json"):
                raw_text = raw_text[4:]
            raw_text = raw_text.strip()

        parsed = json.loads(raw_text)

        # Validate risk_score range
        risk_score = int(parsed.get("risk_score", 20))
        risk_score = max(0, min(100, risk_score))

        return {
            "tenant_id": hotel_id,
            "asset_id": asset_id,
            "risk_score": risk_score,
            "predicted_failure_window": parsed.get("predicted_failure_window", "No imminent risk"),
            "failure_indicators": parsed.get("failure_indicators") or [],
            "estimated_repair_cost": parsed.get("estimated_repair_cost"),
            "estimated_replace_cost": parsed.get("estimated_replace_cost"),
            "recommendation": parsed.get("recommendation", "Continue standard maintenance."),
            "ai_reasoning": parsed.get("ai_reasoning"),
            "generated_at": datetime.utcnow().isoformat(),
            "is_acknowledged": False,
        }

    except json.JSONDecodeError as exc:
        logger.warning(
            "Claude returned invalid JSON for asset=%s hotel=%s: %s",
            asset_id, hotel_id, exc,
        )
        print(f"[failure_predictions] JSON parse error for asset {asset_id}, using fallback")
        fallback = _rule_based_fallback(asset, work_orders)
        return {
            "tenant_id": hotel_id,
            "asset_id": asset_id,
            "generated_at": datetime.utcnow().isoformat(),
            "is_acknowledged": False,
            **fallback,
        }

    except Exception as exc:
        logger.error(
            "Claude call failed for asset=%s hotel=%s: %s",
            asset_id, hotel_id, exc,
        )
        print(f"[failure_predictions] Claude error for asset {asset_id}, using fallback: {exc}")
        fallback = _rule_based_fallback(asset, work_orders)
        return {
            "tenant_id": hotel_id,
            "asset_id": asset_id,
            "generated_at": datetime.utcnow().isoformat(),
            "is_acknowledged": False,
            **fallback,
        }


# ---------------------------------------------------------------------------
# run_asset_failure_predictions  (per-hotel)
# ---------------------------------------------------------------------------

async def run_asset_failure_predictions(hotel_id: str) -> dict:
    """
    Analyze all active assets for a hotel and generate/update failure predictions.

    Returns dict: { "analyzed": int, "high_risk": int, "updated": int }
    """
    print(f"[failure_predictions] Starting failure prediction run for hotel {hotel_id}")

    analyzed = 0
    high_risk = 0
    updated = 0

    # --- 1. Fetch all active assets for this hotel ---
    try:
        assets_result = (
            supabase.table("assets")
            .select("*, asset_categories(name, code)")
            .eq("tenant_id", hotel_id)
            .eq("is_active", True)
            .execute()
        )
        assets = assets_result.data or []
    except Exception as exc:
        logger.error("Failed to fetch assets for hotel=%s: %s", hotel_id, exc)
        print(f"[failure_predictions] ERROR fetching assets for hotel {hotel_id}: {exc}")
        return {"analyzed": 0, "high_risk": 0, "updated": 0}

    if not assets:
        print(f"[failure_predictions] No active assets found for hotel {hotel_id}")
        return {"analyzed": 0, "high_risk": 0, "updated": 0}

    print(f"[failure_predictions] Found {len(assets)} active assets for hotel {hotel_id}")

    twelve_months_ago = (datetime.utcnow() - timedelta(days=365)).isoformat()

    for asset in assets:
        asset_id = asset.get("id")
        if not asset_id:
            continue

        # --- 2a. Fetch recent work orders (last 12 months) ---
        try:
            wo_result = (
                supabase.table("work_orders")
                .select("title, category, status, completed_at, labor_hours, parts_used, created_at")
                .eq("tenant_id", hotel_id)
                .eq("asset_id", asset_id)
                .gte("created_at", twelve_months_ago)
                .order("created_at", desc=True)
                .limit(20)
                .execute()
            )
            work_orders = wo_result.data or []
        except Exception as exc:
            logger.warning("Failed to fetch work orders for asset=%s: %s", asset_id, exc)
            work_orders = []

        # --- 2b. Fetch PM schedules ---
        try:
            pm_result = (
                supabase.table("pm_schedules")
                .select("name, last_completed_at, next_due_at, interval_days, is_active")
                .eq("tenant_id", hotel_id)
                .eq("asset_id", asset_id)
                .execute()
            )
            pm_schedules = pm_result.data or []
        except Exception as exc:
            logger.warning("Failed to fetch PM schedules for asset=%s: %s", asset_id, exc)
            pm_schedules = []

        # --- 3. Call Claude (or fallback) ---
        prediction = _analyze_asset(asset, work_orders, pm_schedules, hotel_id)
        analyzed += 1

        risk_score = prediction.get("risk_score", 0)
        if risk_score >= 70:
            high_risk += 1

        # --- 4. Delete existing unacknowledged prediction, insert new one ---
        try:
            supabase.table("failure_predictions").delete()\
                .eq("tenant_id", hotel_id)\
                .eq("asset_id", asset_id)\
                .eq("is_acknowledged", False)\
                .execute()

            supabase.table("failure_predictions").insert(prediction).execute()
        except Exception as exc:
            logger.error(
                "Failed to upsert failure_prediction for asset=%s hotel=%s: %s",
                asset_id, hotel_id, exc,
            )
            print(f"[failure_predictions] DB upsert error for asset {asset_id}: {exc}")
            continue

        # --- 5. Update assets.failure_risk_score ---
        try:
            supabase.table("assets").update({
                "failure_risk_score": risk_score,
                "failure_risk_updated_at": datetime.utcnow().isoformat(),
            }).eq("id", asset_id).execute()
        except Exception as exc:
            logger.warning(
                "Failed to update failure_risk_score on asset=%s: %s", asset_id, exc
            )

        updated += 1
        print(
            f"[failure_predictions] Asset {asset_id} ({asset.get('name')}) — "
            f"risk_score={risk_score}, window={prediction.get('predicted_failure_window')}"
        )

    print(
        f"[failure_predictions] Hotel {hotel_id} complete: "
        f"analyzed={analyzed}, high_risk={high_risk}, updated={updated}"
    )
    return {"analyzed": analyzed, "high_risk": high_risk, "updated": updated}


# ---------------------------------------------------------------------------
# run_all_hotels_failure_predictions  (cron entry point)
# ---------------------------------------------------------------------------

async def run_all_hotels_failure_predictions() -> dict:
    """
    Run failure predictions for all hotels that have active assets.
    Called from the nightly cron endpoint.

    Returns dict: { "analyzed": int, "high_risk": int, "updated": int }
    """
    print("[failure_predictions] Starting all-hotels failure prediction run")

    try:
        result = supabase.table("assets").select("tenant_id").eq("is_active", True).execute()
        hotel_ids = list({a["tenant_id"] for a in (result.data or []) if a.get("tenant_id")})
    except Exception as exc:
        logger.error("Failed to fetch tenant_ids from assets: %s", exc)
        print(f"[failure_predictions] ERROR fetching hotel list: {exc}")
        return {"analyzed": 0, "high_risk": 0, "updated": 0}

    print(f"[failure_predictions] Found {len(hotel_ids)} hotels with active assets")

    total: dict = {"analyzed": 0, "high_risk": 0, "updated": 0}

    for hotel_id in hotel_ids:
        try:
            stats = await run_asset_failure_predictions(hotel_id)
            total["analyzed"] += stats.get("analyzed", 0)
            total["high_risk"] += stats.get("high_risk", 0)
            total["updated"] += stats.get("updated", 0)
        except Exception as exc:
            logger.error("Failure prediction run failed for hotel=%s: %s", hotel_id, exc)
            print(f"[failure_predictions] ERROR for hotel {hotel_id}: {exc}")

    print(
        f"[failure_predictions] All-hotels run complete: "
        f"analyzed={total['analyzed']}, high_risk={total['high_risk']}, updated={total['updated']}"
    )
    return total


# ---------------------------------------------------------------------------
# run_single_asset_prediction  (on-demand, per-asset)
# ---------------------------------------------------------------------------

async def run_single_asset_prediction(hotel_id: str, asset_id: str) -> dict | None:
    """
    Run failure prediction analysis for a single asset.
    Returns the prediction record dict, or None if asset not found.
    """
    print(f"[failure_predictions] Running single-asset prediction for asset {asset_id}")

    # 1. Fetch the asset
    try:
        asset_result = (
            supabase.table("assets")
            .select("*, asset_categories(name, code)")
            .eq("id", asset_id)
            .eq("tenant_id", hotel_id)
            .eq("is_active", True)
            .single()
            .execute()
        )
        asset = asset_result.data
        if not asset:
            return None
    except Exception as exc:
        logger.error("Failed to fetch asset %s: %s", asset_id, exc)
        return None

    twelve_months_ago = (datetime.utcnow() - timedelta(days=365)).isoformat()

    # 2. Fetch work orders
    try:
        wo_result = (
            supabase.table("work_orders")
            .select("title, category, priority, status, completed_at, labor_hours, parts_used, created_at")
            .eq("tenant_id", hotel_id)
            .eq("asset_id", asset_id)
            .gte("created_at", twelve_months_ago)
            .order("created_at", desc=True)
            .limit(20)
            .execute()
        )
        work_orders = wo_result.data or []
    except Exception:
        work_orders = []

    # 3. Fetch PM schedules
    try:
        pm_result = (
            supabase.table("pm_schedules")
            .select("name, last_completed_at, next_due_at, interval_days, is_active")
            .eq("tenant_id", hotel_id)
            .eq("asset_id", asset_id)
            .execute()
        )
        pm_schedules = pm_result.data or []
    except Exception:
        pm_schedules = []

    # 4. Analyze
    prediction_data = _analyze_asset(asset, work_orders, pm_schedules, hotel_id)

    # 5. Upsert: delete old unacknowledged, insert new
    try:
        supabase.table("failure_predictions").delete().eq("tenant_id", hotel_id).eq("asset_id", asset_id).eq("is_acknowledged", False).execute()
        insert_result = supabase.table("failure_predictions").insert(prediction_data).execute()
        inserted = insert_result.data[0] if insert_result.data else prediction_data
    except Exception as exc:
        logger.error("Failed to upsert prediction for asset %s: %s", asset_id, exc)
        inserted = prediction_data

    # 6. Update asset.failure_risk_score
    try:
        supabase.table("assets").update({
            "failure_risk_score": prediction_data["risk_score"],
            "failure_risk_updated_at": datetime.utcnow().isoformat(),
        }).eq("id", asset_id).execute()
    except Exception as exc:
        logger.warning("Failed to update failure_risk_score for asset %s: %s", asset_id, exc)

    print(f"[failure_predictions] Single-asset prediction complete: risk_score={prediction_data['risk_score']}")
    return inserted
