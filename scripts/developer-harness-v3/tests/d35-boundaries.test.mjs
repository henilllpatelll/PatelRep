// D3.5 — inactive mode and authority boundaries: every D3.5 capability is simulated and inactive; live execution stays refused with every activation gate open; D3.5 changed no
// protected file (authority code, contracts, the lifecycle reducer — byte-identical to verified main 90204d83 and to the V2 dh3 scope pins); the D3.3 resource thresholds and the
// one-reasoning-session operational default are unchanged; and the new durable intents/restores never stand in for the authority evaluator.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { GATES, liveExecutionAllowed } from '../orchestrator/activation-gates.mjs'
import { Engine } from '../orchestrator/engine.mjs'
import { Scheduler } from '../orchestrator/scheduler.mjs'
import { D33_THRESHOLDS } from '../runtime/resource-governor.mjs'
import { loadLifecycle } from '../lifecycle/lifecycle.mjs'
import { H } from './d34-rem-helpers.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const PROTECTED = {
  'docs/developer-harness-v3/authority-contract.json': '526e9ababae227e806967d8679898de517b8d87119d3738457922249abae7937',
  'docs/developer-harness-v3/task-lifecycle.json': '55102d01292ebfd9153cb9b022c5ec64646ab4bcc46dd463b1ac938603aa9da5',
  'scripts/developer-harness-v3/authority/contract.mjs': '1127616b3b0ec4fe29f87b32f3b7c0b91d70ef51c88d43e6f711bed612486b62',
  'scripts/developer-harness-v3/authority/evaluator.mjs': '05b017942feebc9dd00ec9f86fe92dd1a8235f989946ed5750743b91b2dce08a',
  'scripts/developer-harness-v3/authority/evidence.mjs': '05a67dbc34d2cc83e2e6b6c89c713059afd229012749c8d914d157c7c7eb4c32',
  'scripts/developer-harness-v3/authority/git-facts.mjs': '0ca54b7b42a448e6b77b552088c693e69480142c1e41a3e233ba86360347b602',
  'scripts/developer-harness-v3/authority/migration-facts.mjs': 'f7e5cadf4e3ab738884d872e96fe912e3ad47a80865e110b2f3eb6a5040e1139',
  'scripts/developer-harness-v3/authority/policy-version.mjs': '61b7a9f2bd4c9eca3d130892e79b8862f3afda97cbd8cf5c045cf7bb602a4805',
  'scripts/developer-harness-v3/authority/spend.mjs': 'b5f08d1cda91458409839ba31d193c5bf99b410d85b9bdb6b62ed204c059a647',
  'scripts/developer-harness-v3/lifecycle/lifecycle.mjs': '7181c1df2d0a7e394a5f6496bd67aa0c529ffbdf00cec120a835afce6db41825',
  'scripts/developer-harness-v3/lifecycle/resource-admission.mjs': 'a9e73e5114f12fbf8d6ad421f6585f5c5abb0d10c8e2cfa58b5a967259377416',
}

test('D3.5 changed NO protected file: authority code, contracts and the lifecycle reducer are byte-identical to verified main (they change only through the owner-only proposals P1v2/P6)', () => {
  for (const [f, d] of Object.entries(PROTECTED)) assert.equal(createHash('sha256').update(readFileSync(path.join(ROOT, f))).digest('hex'), d, f)
})

test('inactive: live execution is refused; 28 activation gates, none closed; the D3.5 gates exist; simulation alone closes nothing', () => {
  const g = liveExecutionAllowed(); assert.equal(g.allowed, false); assert.equal(g.open.length, GATES.length); assert.equal(GATES.length, 28)
  assert.equal(GATES.filter((x) => x.status === 'closed').length, 0)
  for (const id of ['G-LIFECYCLE-P6', 'G-OWNER-ACTION-EVIDENCE', 'G-LEDGER-FRESHNESS-WITNESS', 'G-PARALLEL-REASONING', 'G-LIVE-RECOVERY-ADAPTERS', 'G-INTENT-EVALUATOR', 'G-ISSUER-INDEPENDENT-FACTS', 'G-LIVE-ADAPTER', 'G-TECH-SUSPENSION-STATE', 'G-UNATTENDED-LONG-WAIT', 'G-FULL-WORKER', 'G-WORKER-ACCOUNT', 'G-CRED-ISOLATION', 'G-EGRESS-FIREWALL', 'G-PROVIDER-AUTH', 'G-OWNER-AUTH', 'G-ISSUER-ACCOUNTS', 'G-ISSUER-KEYS', 'G-V3-CI', 'G-NEIGHBOR-TEST']) assert.ok(GATES.some((x) => x.id === id), id)
  const h = H(); try {
    assert.throws(() => new Engine({ ledger: h.ledger, policy: h.policy, adapters: h.adapters, mode: 'live', snapshotRoot: h.dirs.snapshots }), /LIVE_EXECUTION_DISABLED:28 activation gates open/)
    assert.throws(() => new Engine({ ledger: h.ledger, policy: h.policy, adapters: { ...h.adapters, simulated: false }, snapshotRoot: h.dirs.snapshots }), /SIMULATED_MODE_REQUIRES_SIMULATED_ADAPTERS/)
  } finally { h.close() }
})

test('operational defaults: ONE reasoning session (contract + D3.3 governor, unchanged); the D3.3 thresholds are not weakened; a larger ledger slot capacity does not raise real concurrency', () => {
  assert.equal(loadLifecycle().concurrency.max_reasoning_sessions, 1)
  assert.deepEqual({ r: D33_THRESHOLDS.max_reasoning_sessions, h: D33_THRESHOLDS.max_heavy_test_workloads, a: D33_THRESHOLDS.min_available_mb_to_admit, c: D33_THRESHOLDS.critical_available_mb, full: D33_THRESHOLDS.vm_ram_floor_full_mb, head: D33_THRESHOLDS.host_headroom_mb }, { r: 1, h: 1, a: 2048, c: 1024, full: 3072, head: 2048 })
  const h = H(); try {
    assert.equal(h.ledger.slotCapacity('reasoning'), 1, 'the durable default is one slot')
    h.ledger.setSlotCapacity('reasoning', 4, 'controlled simulation'); assert.equal(new Scheduler(h.engine).capacity().ai, 1, 'the governor still admits one reasoning session')
  } finally { h.close() }
})

test('durable intents and restores are NOT authority: no D3.5 module dispatches an external effect, and none treats intent bookkeeping as permission', () => {
  const ORCH = path.join(ROOT, 'scripts/developer-harness-v3/orchestrator')
  for (const f of ['scheduler.mjs', 'recovery-supervisor.mjs', 'cleanup.mjs', 'test-units.mjs', 'engineering-recovery.mjs', 'ledger/slots.mjs', 'ledger/disaster-recovery.mjs']) {
    const src = readFileSync(path.join(ORCH, f), 'utf8')
    assert.doesNotMatch(src, /\b(markDispatched|beginIntent|retryIntent)\s*\(/, `${f} never drives an external-effect intent`)
    assert.doesNotMatch(src, /\b(fetch|https?\.request|execFile|spawn)\s*\(/, `${f} performs no network or process side effect of its own`)
  }
})
