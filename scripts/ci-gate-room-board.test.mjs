import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// Executes the REAL CI Gate shell step from ci.yml, so the Dependabot / hermetic rule is tested as shipped.
const ci = readFileSync('.github/workflows/ci.yml', 'utf8').replace(/\r\n/g, '\n')
const gateJob = ci.slice(ci.indexOf('\n  ci-gate:\n'), ci.indexOf('\n  pr-comment:\n'))
const script = gateJob.slice(gateJob.indexOf('        run: |\n') + '        run: |\n'.length).split('\n').map((l) => l.replace(/^ {10}/, '')).join('\n')

const ALL_GREEN = {
  LINT_API: 'success', LINT_WEB: 'success', BUILD_WEB: 'success', TEST_WEB_PUBLIC_SMOKE: 'success', TEST_API: 'success', DATABASE_MIGRATION_GATE: 'success', SECURITY_SCAN: 'success',
  TEST_UNIT_WEB: 'success', FEATURE_FLAG_REGISTRY_GATE: 'success', FROZEN_GUARD: 'success', CONTRAST: 'success', I18N_PARITY: 'success',
  ROOM_BOARD_REGRESSION: 'success', ROOM_BOARD_HERMETIC: 'success', RELEASE_WORKFLOW_CONTRACT: 'success', SUPABASE_CLI_APPLY_CONTRACT: 'success',
  ACTIONS_RUNTIME_PRODUCE: 'success', ACTIONS_RUNTIME_CONSUME: 'success',
  EVENT_NAME: 'pull_request', PR_AUTHOR: 'someone',
}
const gate = (env) => {
  const run = spawnSync('bash', ['-c', script], { env: { PATH: process.env.PATH, ...ALL_GREEN, ...env }, encoding: 'utf8' })
  return { ok: run.status === 0, output: `${run.stdout}${run.stderr}` }
}

test('the extracted gate script is the real step', () => {
  assert.match(script, /required_checks=\(/)
  assert.ok(gate({}).ok, 'all green passes')
})

test('ordinary PRs and pushes still require BOTH Room-Board gates', () => {
  for (const base of [{ PR_AUTHOR: 'someone' }, { EVENT_NAME: 'push', PR_AUTHOR: '' }]) {
    assert.equal(gate({ ...base, ROOM_BOARD_REGRESSION: 'skipped' }).ok, false, 'live gate cannot be skipped')
    assert.equal(gate({ ...base, ROOM_BOARD_REGRESSION: 'failure' }).ok, false)
    assert.equal(gate({ ...base, ROOM_BOARD_HERMETIC: 'failure' }).ok, false)
    assert.equal(gate({ ...base, ROOM_BOARD_HERMETIC: 'skipped' }).ok, false)
    assert.equal(gate({ ...base, ROOM_BOARD_HERMETIC: 'cancelled' }).ok, false)
  }
})

test('Dependabot PRs: live gate must be skipped and the hermetic gate must succeed', () => {
  const dependabot = { PR_AUTHOR: 'dependabot[bot]', ROOM_BOARD_REGRESSION: 'skipped' }
  assert.ok(gate(dependabot).ok)
  for (const hermetic of ['failure', 'skipped', 'cancelled', '']) assert.equal(gate({ ...dependabot, ROOM_BOARD_HERMETIC: hermetic }).ok, false, `hermetic=${hermetic}`)
  assert.equal(gate({ ...dependabot, ROOM_BOARD_REGRESSION: 'failure' }).ok, false, 'a failed live run is never forgiven')
  assert.equal(gate({ ...dependabot, ROOM_BOARD_REGRESSION: 'cancelled' }).ok, false)
  assert.equal(gate({ ...dependabot, ROOM_BOARD_REGRESSION: 'success' }).ok, false, 'Dependabot code must not have run with fixture credentials')
})

test('an author name alone grants nothing outside a pull_request event', () => {
  assert.equal(gate({ EVENT_NAME: 'push', PR_AUTHOR: 'dependabot[bot]', ROOM_BOARD_REGRESSION: 'skipped' }).ok, false)
  assert.equal(gate({ EVENT_NAME: 'workflow_dispatch', PR_AUTHOR: 'dependabot[bot]', ROOM_BOARD_REGRESSION: 'skipped' }).ok, false)
  assert.equal(gate({ PR_AUTHOR: 'dependabot-impersonator[bot]', ROOM_BOARD_REGRESSION: 'skipped' }).ok, false)
})

test('every other required check still blocks, including for Dependabot PRs', () => {
  const dependabot = { PR_AUTHOR: 'dependabot[bot]', ROOM_BOARD_REGRESSION: 'skipped' }
  for (const key of Object.keys(ALL_GREEN).filter((k) => !['EVENT_NAME', 'PR_AUTHOR', 'ROOM_BOARD_REGRESSION'].includes(k))) {
    assert.equal(gate({ ...dependabot, [key]: 'failure' }).ok, false, key)
  }
})

test('workflow structure: the hermetic job holds no secret and the live job skips only Dependabot-authored PRs', () => {
  const hermetic = ci.slice(ci.indexOf('\n  room-board-hermetic:\n'), ci.indexOf('\n  security:\n'))
  assert.doesNotMatch(hermetic.replace(/^\s*#.*$/gm, ''), /secrets\.|REGRESSION_|PLAYWRIGHT_BASE_URL/)
  assert.match(hermetic, /npm run test:e2e:hermetic/)
  const live = ci.slice(ci.indexOf('\n  room-board-regression:\n'), ci.indexOf('\n  room-board-hermetic:\n'))
  assert.match(live, /if: github\.event_name != 'pull_request' \|\| github\.event\.pull_request\.user\.login != 'dependabot\[bot\]'/)
  assert.match(ci, /\n {6}- room-board-hermetic\n/, 'the hermetic job is a CI Gate dependency')
  assert.match(ci, /\n {2}release-workflow-contract:[\s\S]*scripts\/dependency-orchestrator-workflow\.test\.mjs[\s\S]*scripts\/ci-gate-room-board\.test\.mjs/)
})

test('the Actions Runtime Contract jobs are CI Gate dependencies and required results', () => {
  assert.match(ci, /\n {6}- actions-runtime-contract-produce\n {6}- actions-runtime-contract-consume\n {4}steps:/)
  assert.match(gateJob, /"Actions Runtime Contract \/ produce:\$ACTIONS_RUNTIME_PRODUCE"/)
  assert.match(gateJob, /"Actions Runtime Contract \/ consume:\$ACTIONS_RUNTIME_CONSUME"/)
  for (const key of ['ACTIONS_RUNTIME_PRODUCE', 'ACTIONS_RUNTIME_CONSUME']) {
    for (const result of ['failure', 'cancelled', 'skipped']) assert.equal(gate({ [key]: result }).ok, false, `${key}=${result}`)
  }
})
