"""Canonical registry of valid tenant feature-flag keys. Single source of truth
on the backend — routers/services must only reference keys defined here (see
core/feature_flags.py, which raises on an unregistered key rather than
silently treating a typo as always-off).

Mirrored by apps/web/lib/featureRegistry.ts on the frontend. The two files are
hand-maintained (not generated) and kept in sync by
scripts/check-feature-flag-registry.mjs, wired into CI.

Flag keys are lowercase snake_case and describe a user-facing capability, not
an implementation detail (e.g. "lost_found_guest_claims", not "new_code_2").

Two categories:
  release     - temporary rollout control. Removed once fully rolled out.
  entitlement - permanent access control for a contracted capability (e.g. a
                pilot integration). NOT subject to eventual removal. The
                existing tenants.opera_pilot_enabled column is this pattern's
                precedent, but is deliberately NOT migrated into this table.
"""

from dataclasses import dataclass
from typing import Literal

FlagType = Literal["release", "entitlement"]


@dataclass(frozen=True)
class FeatureFlagDef:
    key: str
    description: str
    type: FlagType
    backend_enforced: bool
    owner: str = ""
    created: str = ""  # ISO date, informational only


_DEFS = [
    FeatureFlagDef(
        key="staging_flag_demo",
        description="Synthetic staging-only capability proving the feature-flag system end-to-end (backend enforcement + frontend gating). Removed once the real mechanism is verified.",
        type="release",
        backend_enforced=True,
        owner="release-engineering",
        created="2026-10-01",
    ),
]

FEATURE_REGISTRY: dict[str, FeatureFlagDef] = {f.key: f for f in _DEFS}
