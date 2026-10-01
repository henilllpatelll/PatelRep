"""Centralized tenant feature-flag evaluation. The only module allowed to
query tenant_feature_flags directly — routers and services must call
is_feature_enabled()/require_feature()/require_feature_sync() rather than
querying the table themselves, so enforcement behavior stays consistent.

Fail-closed: a missing row and a DB error both resolve to "disabled". Neither
is a special case in the code below — both simply fall through to False.

Flags are not baked into the JWT (unlike role/hotel_id — see
middleware/auth.py), so every check costs a real lookup. A short in-process
TTL cache keeps that cheap without Redis; see _CACHE_TTL_SECONDS.
"""

import logging
import time

from fastapi import Depends, HTTPException

from core.database import supabase
from core.feature_registry import FEATURE_REGISTRY
from middleware.auth import CurrentUser, get_current_user

logger = logging.getLogger(__name__)

# Kept short deliberately: a flag disabled via the feature-rollout workflow
# (the kill switch) must take effect across all API workers within roughly
# this many seconds, with no redeploy and no cache-invalidation call needed.
_CACHE_TTL_SECONDS = 15

_cache: dict[tuple[str, str], tuple[bool, float]] = {}


def _assert_registered(feature_key: str) -> None:
    if feature_key not in FEATURE_REGISTRY:
        raise KeyError(
            f"Unknown feature key: {feature_key!r} — register it in both "
            "core/feature_registry.py and apps/web/lib/featureRegistry.ts "
            "before gating anything on it."
        )


def is_feature_enabled(tenant_id: str, feature_key: str) -> bool:
    """Fail-closed boolean check. Never raises — a missing row, a disabled
    row, and a database error are all indistinguishable from the caller's
    point of view: the feature is off."""
    _assert_registered(feature_key)

    cache_key = (tenant_id, feature_key)
    now = time.monotonic()
    cached = _cache.get(cache_key)
    if cached is not None and now - cached[1] < _CACHE_TTL_SECONDS:
        return cached[0]

    enabled = False
    try:
        result = (
            supabase.table("tenant_feature_flags")
            .select("enabled")
            .eq("tenant_id", tenant_id)
            .eq("feature_key", feature_key)
            .maybe_single()
            .execute()
        )
        if result and result.data:
            enabled = bool(result.data.get("enabled"))
    except Exception:
        logger.warning(
            "Feature flag lookup failed for tenant=%s key=%s; failing closed (disabled)",
            tenant_id,
            feature_key,
            exc_info=True,
        )
        enabled = False

    _cache[cache_key] = (enabled, now)
    return enabled


def require_feature(feature_key: str):
    """FastAPI Depends() factory, mirrors require_role()'s shape. Use for any
    privileged/mutating/billing/AI/integration route gated by a flag — UI
    hiding alone is never sufficient."""
    _assert_registered(feature_key)

    async def check_feature(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if not is_feature_enabled(current_user.hotel_id, feature_key):
            raise HTTPException(status_code=403, detail=f"Feature '{feature_key}' is not enabled for this hotel")
        return current_user

    return check_feature


def require_feature_sync(tenant_id: str, feature_key: str) -> None:
    """Plain-function raising variant for call sites with no Depends() graph
    (internal/cron-triggered endpoints that still want a hard failure).
    Mirrors integrations.py's _require_opera_pilot. A cron job iterating many
    tenants should call is_feature_enabled() directly and soft-skip instead —
    it cannot usefully raise HTTPException per tenant mid-loop."""
    _assert_registered(feature_key)
    if not is_feature_enabled(tenant_id, feature_key):
        raise HTTPException(status_code=403, detail=f"Feature '{feature_key}' is not enabled for this hotel")
