import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCommitMessage, buildPrBody, validateChangedPaths, validateInputs } from './publish-feature-builder-change.mjs'
import { featureSlug, resolveFeatureContext } from './feature-builder-context.mjs'

const SHA = 'a'.repeat(40)

test('feature context produces one deterministic builder branch from the exact base', () => {
  const result = resolveFeatureContext({
    repo: 'henilllpatelll/PatelRep',
    runId: '123456789',
    baseSha: SHA,
    featureName: 'Preventive Maintenance Calendar',
    requirements: 'Build monthly and weekly views with recurring schedules.',
  })
  assert.equal(result.branch, 'feature/ai-123456789-preventive-maintenance-calendar')
  assert.equal(result.base_sha, SHA)
  assert.ok(Object.isFrozen(result))
})

test('feature slug is safe and bounded', () => {
  assert.equal(featureSlug('  Hôtel PM / Calendar!!! '), 'hotel-pm-calendar')
  assert.ok(featureSlug('x'.repeat(100)).length <= 60)
})

test('feature context rejects malformed or underspecified requests', () => {
  assert.throws(() => resolveFeatureContext({ repo: 'bad', runId: '1', baseSha: SHA, featureName: 'abc', requirements: 'long enough req' }), /repository/)
  assert.throws(() => resolveFeatureContext({ repo: 'a/b', runId: 'x', baseSha: SHA, featureName: 'abc', requirements: 'long enough req' }), /run id/)
  assert.throws(() => resolveFeatureContext({ repo: 'a/b', runId: '1', baseSha: 'bad', featureName: 'abc', requirements: 'long enough req' }), /base SHA/)
  assert.throws(() => resolveFeatureContext({ repo: 'a/b', runId: '1', baseSha: SHA, featureName: 'x', requirements: 'long enough req' }), /feature name/)
  assert.throws(() => resolveFeatureContext({ repo: 'a/b', runId: '1', baseSha: SHA, featureName: 'abc', requirements: 'short' }), /requirements/)
})

test('publisher only accepts a branch owned by the exact builder run', () => {
  const common = { repo: 'henilllpatelll/PatelRep', baseSha: SHA, runId: '123', featureName: 'A feature', patchFile: import.meta.filename }
  assert.doesNotThrow(() => validateInputs({ ...common, branch: 'feature/ai-123-a-feature' }))
  assert.throws(() => validateInputs({ ...common, branch: 'feature/ai-999-a-feature' }), /does not belong/)
  assert.throws(() => validateInputs({ ...common, branch: 'main' }), /branch is invalid/)
})

test('publisher blocks release control plane edits', () => {
  for (const file of [
    '.github/workflows/production-release.yml',
    '.github/workflows/ci.yml',
    'scripts/production-rollback-evidence.mjs',
    'scripts/release-resilience-drill.mjs',
    'scripts/claude-release-engineer-workflow.test.mjs',
    'scripts/staging-target-guard.mjs',
    'docs/PRODUCTION_RUNBOOK.md',
  ]) {
    assert.throws(() => validateChangedPaths(`M\t${file}`), /protected control-plane path/)
  }
})

test('new migrations are allowed but existing migration history is immutable', () => {
  assert.doesNotThrow(() => validateChangedPaths('A\tsupabase/migrations/999_new_feature.sql'))
  assert.throws(() => validateChangedPaths('M\tsupabase/migrations/058_existing.sql'), /immutable/)
  assert.throws(() => validateChangedPaths('D\tsupabase/migrations/058_existing.sql'), /immutable/)
})

test('ordinary product files are publishable', () => {
  assert.doesNotThrow(() => validateChangedPaths([
    'M\tapps/web/components/engineering/Calendar.tsx',
    'A\tapps/api/routers/preventive_maintenance.py',
    'A\tapps/api/tests/test_preventive_maintenance.py',
  ].join('\n')))
})

test('commit and PR copy preserve provenance and human merge boundary', () => {
  const msg = buildCommitMessage({ featureName: 'PM calendar', runId: '123', baseSha: SHA })
  assert.match(msg, /PatelRep-Feature-Builder-Run: 123/)
  assert.match(msg, new RegExp(`PatelRep-Feature-Base-SHA: ${SHA}`))
  const body = buildPrBody({ runId: '123', baseSha: SHA, summary: '<!-- unsafe -->\nTests passed.' })
  assert.match(body, /human review and merge are still required/)
  assert.match(body, /Production authority: \*\*none\*\*/)
  assert.doesNotMatch(body, /<!-- unsafe -->/)
})
