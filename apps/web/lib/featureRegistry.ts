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
  hk_ai_assistant: {
    key: 'hk_ai_assistant',
    description:
      'Mobile housekeeper floating AI assistant (compact sheet, full chat, Ask-about-this entry points). Off: housekeepers keep the corner copilot card. UI-only; the chat endpoints are unchanged and governed by role and the AI credit cap.',
    type: 'release',
    backendEnforced: false,
    owner: 'mobile-housekeeper-ai',
    created: '2026-10-16',
  },
  hk_ai_photo_analysis: {
    key: 'hk_ai_photo_analysis',
    description:
      'Optional AI analysis of one maintenance photo, billed per call. Off: the endpoint answers 403 and the mobile Analyze photo control is hidden; manual reporting is unchanged.',
    type: 'release',
    backendEnforced: true,
    owner: 'mobile-housekeeper-ai',
    created: '2026-10-16',
  },
  hk_ai_task_translation: {
    key: 'hk_ai_task_translation',
    description:
      'AI translation of one task's instructions, billed per call. Off: the endpoint answers 403 and the mobile Translate control is hidden; the original instructions are always shown.',
    type: 'release',
    backendEnforced: true,
    owner: 'mobile-housekeeper-ai',
    created: '2026-10-16',
  },
}
