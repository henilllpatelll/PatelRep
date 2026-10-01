import assert from 'node:assert/strict'
import test from 'node:test'

import { extractPrNumbers, diffMigrations, diffFeatureKeys, buildSummary } from './release-content-summary.mjs'

test('extracts PR numbers from squash-merge commit messages', () => {
  assert.deepEqual(
    extractPrNumbers(['feat(lost-found): intake workflow (#145)', 'fix(web): suspense boundary (#146)', 'chore: housekeeping (no PR)']),
    [145, 146],
  )
})

test('deduplicates and sorts PR numbers', () => {
  assert.deepEqual(extractPrNumbers(['a (#9)', 'b (#2)', 'c (#9)']), [2, 9])
})

test('lists only newly added migration files', () => {
  const nameStatus = [
    'A\tsupabase/migrations/130_feature_flags.sql',
    'M\tsupabase/migrations/129_existing.sql',
    'D\tsupabase/migrations/099_removed.sql',
    'A\tapps/web/package.json',
  ].join('\n')
  assert.deepEqual(diffMigrations(nameStatus), ['130_feature_flags.sql'])
})

test('diffs feature keys added since the previous release', () => {
  const previous = 'FeatureFlagDef(key="existing_flag", description="", type="release", backend_enforced=True)'
  const target = [previous, 'FeatureFlagDef(key="new_flag", description="", type="release", backend_enforced=True)'].join('\n')
  assert.deepEqual(diffFeatureKeys(previous, target), ['new_flag'])
})

test('builds a readable summary even with no previous tag', () => {
  const summary = buildSummary({ previousTag: '', targetSha: 'abcdef1234567', prNumbers: [], migrations: [], featureKeys: [] })
  assert.match(summary, /no previous tag/)
  assert.match(summary, /none detected from commit messages/)
})
