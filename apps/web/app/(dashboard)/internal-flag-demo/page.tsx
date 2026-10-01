'use client'

import { FeatureGate } from '@/components/shared/FeatureGate'

/**
 * Synthetic, staging-only demonstration of the tenant feature-flag system —
 * no product purpose. Delete this page, apps/api/routers/feature_flag_demo.py,
 * its main.py registration, and the "staging_flag_demo" registry entries once
 * the mechanism is verified end-to-end. See docs/FEATURE_FLAGS.md.
 */
export default function FeatureFlagDemoPage() {
  return (
    <div style={{ padding: 24 }}>
      <FeatureGate
        feature="staging_flag_demo"
        fallback={<p>staging_flag_demo is OFF for this hotel.</p>}
      >
        <p>staging_flag_demo is ON for this hotel.</p>
      </FeatureGate>
    </div>
  )
}
