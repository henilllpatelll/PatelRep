import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { planStagingMigrations } from './staging-migration-plan.mjs'

const names = [
  '232_engineering_pm_assets_foundation.sql',
  '233_asset_identity_photo_and_version.sql',
  '234_pm_management_assignments.sql',
  '235_pm_corrective_item_link.sql',
]
const migrations = names.map((filename) => ({
  filename,
  version: filename.slice(0, 3),
  content: readFileSync(new URL(`../supabase/migrations/${filename}`, import.meta.url), 'utf8'),
}))

test('the Engineering PM + Assets V2 migrations are auto-appliable to persistent staging', () => {
  const evaluation = { status: 'PENDING', missingOnRemote: migrations.map((m) => m.version), unknownOnRemote: [], duplicateCoverage: { incompleteGroups: [] } }
  assert.deepEqual(planStagingMigrations({ evaluation, migrations }), { pending: names })
})

test('migration 234 keeps its RLS policy without dropping anything', () => {
  const sql = migrations.find((m) => m.version === '234').content
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /CREATE POLICY pm_schedule_assignment_events_select/)
  assert.match(sql, /tenant_id = \(\(SELECT auth\.jwt\(\)\) ->> 'hotel_id'\)::uuid/)
  assert.doesNotMatch(sql, /\bDROP\s+(POLICY|TRIGGER|TABLE|COLUMN)\b/i)
})
