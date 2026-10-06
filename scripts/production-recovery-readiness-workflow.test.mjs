import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { classifyChangedFile } from './release-engineer-auto-merge-policy.mjs'

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const code = (source) => source.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n')
const workflow = read('.github/workflows/production-recovery-readiness.yml')
const workflowCode = code(workflow)
const script = read('scripts/production-recovery-readiness.mjs')

test('Phase 5B runs on main pushes, daily schedule, and manual dispatch', () => {
  assert.match(workflow, /on:\n {2}push:\n {4}branches: \[main\]\n {2}schedule:\n {4}- cron: '29 11 \* \* \*'\n {2}workflow_dispatch:/)
  assert.doesNotMatch(workflowCode, /pull_request|pull_request_target/)
})

test('Phase 5B is live read-only with no production or GitHub write authority', () => {
  assert.match(workflow, /^permissions:\n {2}contents: read\n {2}actions: read\n/m)
  assert.doesNotMatch(workflow, /^\s+(contents|actions|issues|pull-requests|checks|deployments|environments|statuses|id-token): write$/m)
  assert.doesNotMatch(workflowCode, /environment: production|secrets\.|create-github-app-token|PATELREP_APP|RAILWAY_API_TOKEN|PRODUCTION_SUPABASE|psql|supabase\/setup-cli|gh workflow run|dispatches|git push|gh release create|gh pr merge/i)
  assert.doesNotMatch(script, /execFileSync|spawn|create-github-app-token|railway\/cli|supabase\/setup-cli|supabase migration|psql|git push|gh workflow run/i)
  assert.match(script, /database_compatibility: 'not_exercised_read_only_no_secret'/)
})

test('Phase 5B uses the exact trusted main control plane and a separate non-cancelling concurrency group', () => {
  assert.match(workflow, /group: production-recovery-readiness/)
  assert.match(workflow, /cancel-in-progress: false/)
  assert.doesNotMatch(workflow, /group: production-deploy/)
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/)
  assert.match(workflow, /sparse-checkout: scripts/)
  assert.match(workflow, /persist-credentials: false/)
  assert.match(workflow, /test "\$GITHUB_REF" = refs\/heads\/main/)
  assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA"/)
})

test('readiness composes canonical Phase 3/4 proofs and explicitly represents bootstrap limitation', () => {
  for (const token of [
    'auditProductionReleaseState',
    'findLatestOpenAutomatedRollback',
    'requireRollbackExecutionContract',
    'resolveProductionBaseline',
    'isExactCandidateHealthy',
  ]) assert.match(script, new RegExp(token))
  assert.match(script, /limited_bootstrap_no_previous_release/)
  assert.match(script, /ready_quarantined_post_release_regression/)
  assert.match(script, /ready_quarantined_partial_release_failure/)
  assert.match(script, /deferred_active_production_operation/)
  assert.match(script, /deferred_main_moved_during_drill/)
  assert.match(script, /patelrep\.production-recovery-readiness\.v1/)
})

test('readiness evidence uploads before any intentional failure and summary quoting is shell-safe', () => {
  const uploadIndex = workflow.indexOf('Upload recovery readiness evidence')
  const failIndex = workflow.indexOf('Fail on unproven recovery readiness')
  assert.ok(uploadIndex > 0 && failIndex > uploadIndex)
  assert.match(workflow, /name: production-recovery-readiness/)
  assert.match(workflow, /retention-days: 90/)
  assert.match(workflow, /if-no-files-found: error/)
  assert.match(workflow, /if: steps\.readiness\.outputs\.pass != 'true'/)
  assert.match(workflow, /printf -- '- State: \`%s\`\\n'/)
  assert.doesNotMatch(workflow, /echo "- State: \`\$STATE\`"/)
})

test('Phase 5B control-plane files remain human-merge only', () => {
  for (const file of [
    '.github/workflows/production-recovery-readiness.yml',
    'scripts/production-recovery-readiness.mjs',
    'scripts/production-auto-rollback-policy.mjs',
  ]) assert.ok(classifyChangedFile(file), `${file} must require a human merge`)
})

test('Release Workflow Contract permanently runs both Phase 5B tests', () => {
  const ci = read('.github/workflows/ci.yml')
  const start = ci.indexOf('\n  release-workflow-contract:\n')
  assert.ok(start >= 0)
  const next = ci.slice(start + 1).search(/\n  [a-z-]+:\n/)
  const job = next < 0 ? ci.slice(start) : ci.slice(start, start + 1 + next)
  const command = job.match(/run: (node --test [^\n]+)/)[1]
  const files = command.split(/\s+/).slice(2)
  for (const file of [
    'scripts/production-recovery-readiness.test.mjs',
    'scripts/production-recovery-readiness-workflow.test.mjs',
  ]) {
    assert.ok(files.includes(file), `${file} must run in Release Workflow Contract`)
    assert.ok(existsSync(file), `${file} exists`)
  }
})
