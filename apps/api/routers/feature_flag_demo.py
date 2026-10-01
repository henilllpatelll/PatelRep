"""Synthetic, staging-only demonstration of the tenant feature-flag system.

This router has no product purpose — it exists solely to prove end-to-end
that a flag disabled for a tenant blocks a backend-enforced endpoint (403)
and an enabled flag allows it (200), with the equivalent gating on the web
side via FeatureGate. Delete this file, its route registration in main.py,
the matching web demo route, and the "staging_flag_demo" entries in both
feature registries once that is verified — see docs/FEATURE_FLAGS.md.
"""

from fastapi import APIRouter, Depends

from core.feature_flags import require_feature
from middleware.auth import CurrentUser

router = APIRouter(prefix="/internal", tags=["feature-flag-demo"])


@router.get("/feature-flag-demo")
async def feature_flag_demo(
    current_user: CurrentUser = Depends(require_feature("staging_flag_demo")),
):
    return {"gated": True, "hotel_id": current_user.hotel_id}
