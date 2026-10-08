import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  DISPATCH_ATTEMPTS,
  HEARTBEAT_BUDGET_MINUTES,
  MAX_PACE_SECONDS,
  RELAY_PACE_SECONDS,
  WORKFLOW_FILE,
  dispatchNext,
  parsePace,
  shouldRelay,
  worstCaseCycleMinutes,
} from './deploy-check-relay.mjs'
import { POLICY } from './production-automation-watchdog.mjs'

const workflow = readFileSync(new URL('../.github/workflows/deploy-check.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const relayScript = readFileSync(new URL('./deploy-check-relay.mjs', import.meta.url), 'utf8')

const jobBlock = (name) => {
  const match = workflow.match(new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z][a-z-]*:\\n|$)`))
  assert.ok(match, `job ${name} exists`)
  return match[1]
}
const jobs = ['pace', 'check-api', 'check-web', 'public-smoke', 'deployment-drift-check', 'relay']
const timeoutOf = (name) => Number(jobBlock(name).match(/timeout-minutes: (\d+)/)?.[1])

// ---- scheduling mechanism ----------------------------------------------------------------------------------

test('watchdog heartbeat threshold is preserved and the relay constants agree with it', () => {
  assert.equal(POLICY.heartbeat_minutes.deploy_health, 45)
  assert.equal(HEARTBEAT_BUDGET_MINUTES, POLICY.heartbeat_minutes.deploy_health)
})

test('worst-case relay cycle (pace + slowest health path + relay) stays well inside the 45 minute budget', () => {
  // pace -> check-api/check-web -> max(public-smoke, drift check) -> relay; the cycle is measured completion to completion.
  const healthPath = Math.max(timeoutOf('check-api'), timeoutOf('check-web')) + Math.max(timeoutOf('public-smoke'), timeoutOf('deployment-drift-check'))
  const cycle = worstCaseCycleMinutes({ paceSeconds: RELAY_PACE_SECONDS, healthPathMinutes: healthPath, relayMinutes: timeoutOf('relay') })
  assert.ok(cycle <= HEARTBEAT_BUDGET_MINUTES - 5, `worst-case cycle ${cycle}m leaves at least 5 minutes of margin`)
  // A typical cycle is far below the worst case, and the chain always beats the 45m budget even if one cron revival is dropped.
  assert.ok(RELAY_PACE_SECONDS < MAX_PACE_SECONDS)
})

test('every job is bounded (a hung job can no longer stall the heartbeat for the 6h default)', () => {
  for (const job of jobs) assert.ok(timeoutOf(job) > 0 && timeoutOf(job) <= 20, `${job} timeout-minutes`)
  assert.ok(timeoutOf('pace') * 60 >= MAX_PACE_SECONDS, 'pace job can finish the longest allowed wait')
})

test('cron is only a revival trigger: several entries, off the congested :00/:15/:30/:45 marks', () => {
  const cron = workflow.match(/- cron: '([^']+)'/)?.[1]
  assert.ok(cron, 'schedule retained')
  const minutes = cron.split(' ')[0].split(',').map(Number)
  assert.ok(minutes.length >= 2 && minutes.every((m) => Number.isInteger(m) && m >= 0 && m < 60))
  assert.ok(minutes.every((m) => m % 15 !== 0), 'no top-of-quarter-hour minute')
  for (const trigger of ['push:', 'schedule:', 'workflow_dispatch:']) assert.ok(workflow.includes(trigger))
  assert.match(workflow, /branches: \[main\]/)
})

test('manual dispatch is immediate by default; only the relay passes a bounded pace', () => {
  assert.match(workflow, /pace_seconds:[\s\S]*?default: '0'[\s\S]*?type: string/)
  assert.match(workflow, /PACE_SECONDS: \$\{\{ inputs\.pace_seconds \}\}/)
  assert.ok(RELAY_PACE_SECONDS > 0 && RELAY_PACE_SECONDS <= MAX_PACE_SECONDS)
  assert.match(jobBlock('pace'), /node scripts\/deploy-check-relay\.mjs pace/)
  for (const job of ['check-api', 'check-web']) assert.match(jobBlock(job), /needs: \[pace\]/, `${job} waits for pacing`)
})

// ---- overlap / duplicate prevention -------------------------------------------------------------------------

test('one run at a time: workflow concurrency queues, never cancels a running health check', () => {
  assert.match(workflow, /\nconcurrency:\n  group: deploy-health-check\n  cancel-in-progress: false\n/)
})

test('the relay dispatches only the trusted workflow on main, with a bounded pace, and only after every health job', () => {
  const relay = jobBlock('relay')
  assert.match(relay, /if: \$\{\{ !cancelled\(\) \}\}/)
  assert.match(relay, /needs: \[pace, check-api, check-web, public-smoke, deployment-drift-check\]/)
  assert.equal(WORKFLOW_FILE, 'deploy-check.yml')
  assert.match(relayScript, /'--ref', 'main'/)
  assert.match(relayScript, /pace_seconds=\$\{RELAY_PACE_SECONDS\}/)
})

// ---- permissions and preserved assertions -------------------------------------------------------------------

test('permissions: read-only by default; only the relay job holds actions: write; no secrets', () => {
  assert.match(workflow, /\npermissions:\n  contents: read\n\njobs:/)
  const writers = jobs.filter((job) => /actions: write/.test(jobBlock(job)))
  assert.deepEqual(writers, ['relay'])
  assert.equal((workflow.match(/actions: write/g) ?? []).length, 1)
  assert.doesNotMatch(workflow, /secrets\./)
  assert.doesNotMatch(workflow, /contents: write|id-token|pull-requests: write/)
  assert.match(jobBlock('relay'), /GH_TOKEN: \$\{\{ github\.token \}\}/)
  assert.match(jobBlock('relay'), /ref: main/)
})

test('every existing Deploy Health Check assertion is preserved', () => {
  assert.match(jobBlock('public-smoke'), /node scripts\/production-monitor-smoke\.mjs/)
  assert.match(jobBlock('public-smoke'), /PUBLIC_WEB_URL: https:\/\/patelrep-production-6f35\.up\.railway\.app/)
  assert.match(jobBlock('public-smoke'), /PUBLIC_API_URL: https:\/\/noble-cooperation-production\.up\.railway\.app/)
  assert.match(jobBlock('check-api'), /seq 1 10/)
  assert.match(jobBlock('check-api'), /\/health/)
  assert.match(jobBlock('check-web'), /seq 1 6/)
  assert.match(jobBlock('deployment-drift-check'), /npm run check:deployment-drift/)
  assert.match(jobBlock('deployment-drift-check'), /needs: \[check-api, check-web\]/)
  assert.match(jobBlock('public-smoke'), /needs: \[check-api, check-web\]/)
  assert.equal((workflow.match(/^\s+exit 1$/gm) ?? []).length >= 3, true)
})

// ---- relay behavior: missed heartbeats and failure scenarios -------------------------------------------------

test('pace input is clamped, never thrown: a bad manual input cannot become a failed health check', () => {
  assert.equal(parsePace(undefined), 0)
  assert.equal(parsePace(''), 0)
  assert.equal(parsePace('0'), 0)
  assert.equal(parsePace('480'), 480)
  assert.equal(parsePace('900'), 900)
  assert.equal(parsePace('99999'), MAX_PACE_SECONDS)
  for (const bad of ['-5', '1e3', '12.5', 'abc', '5; rm -rf /', ' ', null, {}]) assert.equal(parsePace(bad), 0, String(bad))
})

test('only the trusted default branch of this repository continues the chain', () => {
  const ok = { ref: 'refs/heads/main', repository: 'o/r', expectedRepository: 'o/r' }
  assert.equal(shouldRelay(ok).relay, true)
  assert.equal(shouldRelay({ ...ok, ref: 'refs/heads/feature/x' }).relay, false)
  assert.equal(shouldRelay({ ...ok, ref: 'refs/pull/1/merge' }).relay, false)
  assert.equal(shouldRelay({ ...ok, ref: undefined }).relay, false)
  assert.equal(shouldRelay({ ...ok, repository: 'evil/fork' }).relay, false)
  assert.equal(shouldRelay({ ...ok, expectedRepository: undefined }).relay, false)
  assert.equal(shouldRelay({ ...ok, conclusionCancelled: true }).relay, false)
})

test('a transient dispatch failure is retried and the chain continues', async () => {
  const calls = []
  let n = 0
  const exec = (cmd, args) => { calls.push([cmd, ...args]); n += 1; return n < 3 ? { status: 1, stderr: 'HTTP 502\nmore' } : { status: 0, stderr: '' } }
  const sleeps = []
  const result = await dispatchNext({ repo: 'o/r', exec, sleep: async (ms) => { sleeps.push(ms) } })
  assert.deepEqual(result, { dispatched: true, attempt: 3 })
  assert.equal(calls.length, 3)
  assert.deepEqual(calls[0], ['gh', 'workflow', 'run', 'deploy-check.yml', '--repo', 'o/r', '--ref', 'main', '-f', `pace_seconds=${RELAY_PACE_SECONDS}`])
  assert.equal(sleeps.length, 2)
})

test('a lost relay (every dispatch fails) is reported as a warning result, never thrown; cron/push/watchdog cover the gap', async () => {
  const result = await dispatchNext({ repo: 'o/r', exec: () => ({ status: 1, stderr: 'HTTP 403 Resource not accessible\nx' }), sleep: async () => {} })
  assert.equal(result.dispatched, false)
  assert.match(result.error, /403/)
  assert.doesNotMatch(result.error, /\n/)
  // The script must be incapable of failing the health run (the Release Engineer repairs code on health failures).
  assert.doesNotMatch(relayScript, /process\.exit\(1\)|exit 1/)
  assert.match(relayScript, /::warning::Could not dispatch/)
  assert.equal(DISPATCH_ATTEMPTS, 3)
})

test('a failing production still schedules the next check (relay runs after failures, not after cancellation)', () => {
  assert.match(jobBlock('relay'), /if: \$\{\{ !cancelled\(\) \}\}/)
  assert.doesNotMatch(jobBlock('relay'), /if: .*success\(\)/)
})
