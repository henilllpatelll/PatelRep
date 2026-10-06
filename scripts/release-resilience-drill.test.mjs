import assert from 'node:assert/strict'
import test from 'node:test'
import { DRILL_CASES, DRILL_SCHEMA, runReleaseResilienceDrills } from './release-resilience-drill.mjs'

test('all Phase 5A synthetic resilience scenarios pass end to end', async () => {
  const result = await runReleaseResilienceDrills()
  assert.equal(result.schema, DRILL_SCHEMA)
  assert.equal(result.synthetic_only, true)
  assert.equal(result.authority_added, false)
  assert.equal(result.total, DRILL_CASES.length)
  assert.equal(result.failed, 0, JSON.stringify(result.cases.filter((item) => !item.passed), null, 2))
  assert.equal(result.passed, DRILL_CASES.length)
  assert.deepEqual(result.cases.map((item) => item.name), [...DRILL_CASES])
  assert.ok(result.cases.every((item) => item.passed))
})

test('drill catalog covers rollback eligibility, quarantine, re-entry, audit drift, stale auth, active-operation deferral, and stuck-operation detection', () => {
  assert.deepEqual([...DRILL_CASES], [
    'post_release_regression_full_cycle',
    'database_change_blocks_auto_rollback',
    'partial_release_quarantine',
    'runtime_drift_is_detected_and_notified',
    'stale_reentry_authorization_is_refused',
    'active_production_operation_defers_audit',
  ])
})
