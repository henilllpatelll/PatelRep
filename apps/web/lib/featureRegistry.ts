/**
 * Canonical registry of valid tenant feature-flag keys — frontend mirror of
 * apps/api/core/feature_registry.py. Hand-maintained, kept in sync by
 * scripts/check-feature-flag-registry.mjs (wired into CI).
 *
 * Flag keys are lowercase snake_case and describe a user-facing capability,
 * not an implementation detail.
 *
 * Two categories:
 *   release     - temporary rollout control, removed once fully rolled out.
 *   entitlement - permanent access control for a contracted capability.
 */

export type FlagType = 'release' | 'entitlement'

export interface FeatureFlagDef {
  key: string
  description: string
  type: FlagType
  backendEnforced: boolean
  owner?: string
  created?: string
}

export const FEATURE_REGISTRY: Record<string, FeatureFlagDef> = {
  staging_flag_demo: {
    key: 'staging_flag_demo',
    description:
      'Synthetic staging-only capability proving the feature-flag system end-to-end (backend enforcement + frontend gating). Removed once the real mechanism is verified.',
    type: 'release',
    backendEnforced: true,
    owner: 'release-engineering',
    created: '2026-10-01',
  },
}
