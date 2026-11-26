// D3.5-G — bounded autonomous engineering recovery (SIMULATED sessions/tests; real ledger, real engine stages, real budgets): the failure taxonomy, fingerprint normalization,
// repeated-fix and test-weakening refusals, waits that spend no remediation budget (and are themselves bounded), per-task accounting and independence, terminal suspensions
// that are never reset automatically, immutable requirements, and mandatory findings that survive retries.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FAILURE_CLASSES, OWNER_ONLY_CLASSES, classifyFailure, detectTestWeakening, normalizeFingerprint, taskAccounting } from '../orchestrator/engineering-recovery.mjs'
import { TECH_DEFAULTS } from '../orchestrator/suspension.mjs'
import { H, MAND, drive, owner } from './d34-rem-helpers.mjs'

const ORCH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'orchestrator')

test('failure taxonomy: every class is distinguished; owner-only classes are exactly authentication/billing, isolation and requirement conflicts; unknown is a budgeted technical retry', () => {
  const t = { 'RESOURCE.GUEST_MEMORY_LOW': 'resource_pressure', 'worker died: ENOMEM': 'resource_pressure', 'PROVIDER.LIMIT': 'subscription_exhausted', 'SUBSCRIPTION.NOT_YET_ELIGIBLE': 'subscription_exhausted',
    'NETWORK.DNS': 'network', 'PROVIDER.HTTP_529': 'network', 'fetch failed ECONNRESET': 'network', 'TEST_FAILED': 'implementation_defect', 'test:units:x': 'implementation_defect', 'CANDIDATE.EMPTY': 'implementation_defect',
    'REVIEW_FINDINGS_OPEN': 'review_findings', 'IPC.UNAVAILABLE': 'environment', 'WORKER.NOT_AVAILABLE': 'environment', 'SOMETHING.NEW': 'environment', 'AUTH.EXTRA_USAGE_ENABLED': 'auth_billing',
    'SUBSCRIPTION.STATE:unauthorized_billing': 'auth_billing', 'ISOLATION.WORKER_TERMINATION_UNPROVABLE': 'isolation', 'UNRESOLVABLE_REQUIREMENT_CONFLICT:DEPENDENCY_CANCELLED:x': 'requirement_conflict' }
  for (const [code, cls] of Object.entries(t)) assert.equal(classifyFailure(code), cls, code)
  assert.deepEqual([...OWNER_ONLY_CLASSES].sort(), ['auth_billing', 'isolation', 'requirement_conflict'])
  assert.equal(FAILURE_CLASSES.length, 9)
})

test('fingerprint normalization: the same failure with different hashes, uuids, line numbers or temp paths has ONE fingerprint; different failures stay different', () => {
  const a = normalizeFingerprint('unit|SESSION.CRASH|at C:\\Users\\x\\AppData\\Local\\Temp\\run-1\\a.mjs:12:5 commit deadbeefcafe0123 id 4b5c2f3e-1111-4222-8333-944455556666')
  const b = normalizeFingerprint('unit|SESSION.CRASH|at C:\\Users\\x\\AppData\\Local\\Temp\\run-77\\a.mjs:99:1 commit 0123456789abcdef id 00000000-1111-4222-8333-944455556666')
  assert.equal(a, b)
  assert.notEqual(normalizeFingerprint('unit|SESSION.CRASH'), normalizeFingerprint('unit|SESSION.TIMEOUT'))
})

test('test weakening is detected on the controller-derived diff: deleted test files, fewer assertions or cases, added skips; ordinary code changes are not flagged', () => {
  const before = "test('a', () => { assert.equal(f(), 1); assert.ok(g()) })\ntest('b', () => { expect(h()).toBe(2) })\n"
  assert.deepEqual(detectTestWeakening([{ status: 'D', path: 'apps/mobile/__tests__/queue.test.tsx' }, { status: 'M', path: 'apps/mobile/src/queue.ts' }]).map((x) => x.code), ['TEST_WEAKENING.FILE_DELETED'])
  const codes = detectTestWeakening([], [{ path: 'apps/api/tests/test_x.py', before, after: "test('a', () => { assert.equal(f(), 1) })\ntest.skip('b', () => { expect(h()).toBe(2) })\n" }]).map((x) => x.code).sort()
  assert.deepEqual(codes, ['TEST_WEAKENING.ASSERTIONS_REDUCED', 'TEST_WEAKENING.CASES_REMOVED', 'TEST_WEAKENING.SKIP_ADDED'])
  assert.deepEqual(detectTestWeakening([{ status: 'D', path: 'apps/mobile/src/old.ts' }], [{ path: 'apps/mobile/src/a.ts', before: 'x', after: 'y' }]), [])
  assert.deepEqual(detectTestWeakening([], [{ path: 'apps/x/a.test.ts', before, after: `${before}test('c', () => { expect(1).toBe(1) })\n` }]), [], 'adding tests is fine')
})

test('a REPEATED FAILED FIX (byte-identical patch to a failed candidate) is refused with a strategy escalation, then a different fix proceeds to the handoff', async () => {
  const h = H({ scenario: { tests: [{ passed: false, fingerprint: 'queue-hidden' }, { passed: true }] } })
  try {
    const id = h.submit(); const orig = h.adapters.git.deriveCandidate.bind(h.adapters.git); let n = 0; let first = null
    h.adapters.git.deriveCandidate = async (t) => { const f = await orig(t); n += 1; if (n === 1) first = f; if (n === 2) return { ...f, patch_digest: first.patch_digest } ; return f }
    await drive(h)
    assert.equal(h.ledger.getTask(id).handoff_ready, 1)
    const fails = h.ledger.recoveryHistory(id).filter((r) => r.kind === 'stage_failure').map((r) => r.detail.code)
    assert.ok(fails.includes('CANDIDATE.REPEATED_FAILED_FIX'), fails.join(','))
    assert.equal(h.ledger.meta(`strategy_hint:${id}`), '1', 'the strategy escalates to a materially different approach')
    assert.equal(h.ledger.db.prepare('SELECT COUNT(*) c FROM test_runs WHERE task_id=?').get(id).c, 2, 'the repeated patch was never re-tested')
  } finally { h.close() }
})

test('a pass bought by WEAKENING the tests is refused (bounded, budgeted); restoring the tests proceeds — the requirements themselves can never be changed to obtain a pass', async () => {
  const h = H()
  try {
    const id = h.submit(); let weak = 2
    h.adapters.git.diffContents = async () => (weak-- > 0 ? [{ path: 'apps/mobile/__tests__/feature.test.ts', before: "test('x', () => { expect(a).toBe(1) })", after: "test.skip('x', () => { expect(a).toBe(1) })" }] : [])
    await drive(h)
    assert.equal(h.ledger.getTask(id).handoff_ready, 1)
    assert.equal(h.ledger.recoveryHistory(id).filter((r) => r.kind === 'test_weakening_refused').length, 2)
    assert.throws(() => h.ledger.db.prepare("UPDATE tasks SET acceptance_json='{\"criteria\":[]}' WHERE task_id=?").run(id), /TASK_IDENTITY_IMMUTABLE/)
    assert.throws(() => h.ledger.db.prepare("UPDATE tasks SET requirements_json='{}' WHERE task_id=?").run(id), /TASK_IDENTITY_IMMUTABLE/)
  } finally { h.close() }
})

test('resource-pressure failure codes WAIT without a remediation budget — but are bounded per epoch, after which they are budgeted failures; network failures go to a bounded external wait', async () => {
  const h = H({ scenario: { stages: { implementing: [{ fail: 'RESOURCE.GUEST_OOM_KILLED', failTimes: 40 }] } }, cfg: { technical: { maxEpochs: 1, cooldownsMs: [60_000] } } })
  try {
    const id = h.submit(); await drive(h)
    const waits = h.ledger.recoveryHistory(id).filter((r) => r.kind === 'failure_classified_wait').length
    assert.ok(waits >= 6 && waits <= 12, `bounded classified waits: ${waits}`)
    const s = h.ledger.getSuspension(id); assert.ok(s, 'it ends in a technical suspension, not an endless free wait'); assert.equal(s.disposition, 'terminal')
    assert.ok(taskAccounting(h.engine, id).sessions_this_generation < TECH_DEFAULTS.maxSessionsPerTask)
    assert.deepEqual(owner(h), { blockedEvents: 0, ownerActions: 0, blockerRows: 0 })
  } finally { h.close() }
  const n = H({ scenario: { stages: { implementing: [{ fail: 'NETWORK.ECONNRESET', failTimes: 1 }] } } })
  try {
    const id = n.submit(); await drive(n)
    assert.equal(n.ledger.getTask(id).handoff_ready, 1)
    assert.ok(n.ledger.recoveryHistory(id).some((r) => r.kind === 'incident_reported' && r.detail.kind === 'network_unavailable'))
    assert.equal(n.ledger.db.prepare("SELECT COUNT(*) c FROM task_events WHERE task_id=? AND to_state='waiting_external'").get(id).c, 1)
  } finally { n.close() }
})

test('per-task accounting and independence: one task exhausting its budgets (terminal) does not touch another task\'s budgets; the terminal suspension is never reset automatically', async () => {
  const h = H({ scenario: { tests: [{ passed: false, fingerprint: 'always' }] }, cfg: { technical: { maxEpochs: 1, cooldownsMs: [60_000] } } })
  try {
    const bad = h.submit({ requirements: { text: 'always fails', sim_path: 'apps/mobile/bad/f.txt' }, scope: { allowed_paths: ['apps/mobile/bad/**'], denied_paths: [] } })
    await drive(h)
    assert.equal(h.ledger.getSuspension(bad).disposition, 'terminal')
    const acc = taskAccounting(h.engine, bad)
    assert.ok(acc.sessions_this_generation > 0 && acc.sessions_this_generation <= acc.session_ceiling); assert.equal(acc.session_ceiling, 150)
    assert.ok(acc.sessions_by_role.implementer >= 1)
    // a second task, submitted afterwards, gets its OWN fresh budgets and passes (tests pass for it: scenario index is per task)
    h.adapters.tests.run = async () => ({ passed: true, results: { passed: 4, failed: 0, skipped: 0 }, fingerprint: null })
    const good = h.submit({ requirements: { text: 'passes', sim_path: 'apps/mobile/good/f.txt' }, scope: { allowed_paths: ['apps/mobile/good/**'], denied_paths: [] } })
    await drive(h)
    assert.equal(h.ledger.getTask(good).handoff_ready, 1)
    assert.equal(taskAccounting(h.engine, good).remediation_cycles_this_epoch, 0)
    assert.equal(h.ledger.getSuspension(bad).disposition, 'terminal', 'still terminal: nothing reset it')
    assert.ok(!h.ledger.recoveryHistory(bad).some((r) => r.kind === 'technical_suspension_resumed'))
    assert.equal(h.ledger.db.prepare("SELECT COUNT(*) c FROM outbox WHERE task_id=? AND kind='technical_suspension' AND payload_json LIKE '%terminal%'").get(bad).c, 1, 'ONE actionable diagnostic package, not a permission question')
    assert.deepEqual(owner(h), { blockedEvents: 0, ownerActions: 0, blockerRows: 0 })
  } finally { h.close() }
  // static: the only automatic code path that could reset a budget does not exist — resumeSuspended is referenced solely by its definition and the explicit operator method
  const refs = readdirSync(ORCH, { recursive: true }).filter((f) => f.endsWith('.mjs')).flatMap((f) => readFileSync(path.join(ORCH, f), 'utf8').split('\n').filter((l) => /resumeSuspended\(/.test(l)).map((l) => `${f}: ${l.trim().slice(0, 80)}`))
  assert.equal(refs.length, 2, refs.join('\n')) // the suspension.mjs definition and the explicit engine.resumeSuspended operator method (one line): no scheduler or recovery path calls it
})

test('mandatory findings survive retries and suspension epochs: a carried finding stays blocking until an independent reviewer confirms it fixed', async () => {
  const h = H({ scenario: { stages: { independent_review: [{ findings: [MAND('F-1')] }, { findings: [], noConfirm: true }, { findings: [] }] } }, cfg: { technical: { maxReviewRoundsPerEpoch: 2, cooldownsMs: [60_000] } } })
  try {
    const id = h.submit(); await drive(h)
    const f = h.ledger.db.prepare("SELECT status FROM findings WHERE finding_id='F-1' ORDER BY rowid").all().map((r) => r.status)
    const kinds = h.ledger.recoveryHistory(id).map((r) => r.kind)
    const rounds = h.ledger.db.prepare("SELECT round, status FROM reviews WHERE task_id=? AND kind='independent_review' ORDER BY round").all(id).map((r) => r.status)
    assert.deepEqual(rounds, ['verified_fail', 'verified_fail', 'verified_pass'], 'round 2 did not confirm the carried finding, so it failed again')
    assert.ok(kinds.indexOf('technical_suspension') > kinds.lastIndexOf('remediation_entered') - 1 && kinds.includes('technical_suspension_ended'), 'the review budget ran out: a suspension epoch passed in between')
    assert.deepEqual(f, ['confirmed'], 'the finding survived the retries AND the suspension epoch, and cleared only by an independent confirmation')
    assert.equal(h.ledger.getTask(id).handoff_ready, 1)
  } finally { h.close() }
})
