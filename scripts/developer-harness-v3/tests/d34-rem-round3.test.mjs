// D3.4 remediation, review round 3 — regressions for what the independent OPUS security review found: a billing/auth/permission violation turned into a technical retry loop, read-only reviewer
// residue committed by the next writer, unbounded re-issue of expired approvals, a coverage-id collision, duplicate remote effects, migration drift, credential-shaped failure text in notifications,
// weak argv parsing. SIMULATED (no model, VM, network or credential).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MIGRATIONS } from '../orchestrator/ledger/schema.mjs'
import { normalizeSubmission } from '../orchestrator/review.mjs'
import { checkInvocationSafety } from '../orchestrator/routing.mjs'
import { MAX_REATTEST_AGE_MS } from '../orchestrator/issuer/issuer-core.mjs'
import { H, drive, settle, execs, owner, finalBytes, unitLines } from './d34-rem-helpers.mjs'
import { proposalReducer } from '../orchestrator/sim/delivery-harness.mjs'

const notes = (h, kind) => h.ledger.db.prepare('SELECT * FROM outbox WHERE kind=?').all(kind)

for (const [label, spec, code] of [['an API-key auth source in the init event', { apiKeySource: 'ANTHROPIC_API_KEY' }, /AUTH\.API_KEY_SOURCE_ACTIVE/], ['a non-dontAsk permission mode', { permissionMode: 'bypassPermissions' }, /PERMISSION_MODE_MISMATCH/]]) {
  test(`R3-1: ${label} is an OWNER blocker at the FIRST sighting — one session, no retry loop, no technical suspension, governor/billing state recorded`, async () => {
    const h = H({ scenario: { stages: { planning: [spec] } } }); const id = h.submit(); await drive(h); const t = h.ledger.getTask(id)
    assert.equal(t.state, 'blocked'); assert.equal(t.lifecycle.blocker_reason, 'OWNER_DECISION_REQUIRED'); assert.equal(execs(h, id).length, 1, 'exactly one paid session'); assert.equal(notes(h, 'technical_suspension').length, 0); assert.equal(owner(h).blockerRows, 1)
    assert.match(JSON.parse(notes(h, 'genuine_blocker')[0].payload_json).codes[0], code); if (spec.apiKeySource) assert.equal(h.adapters.subscription.load().state, 'unauthorized_billing', 'and further admission is refused'); h.close()
  })
}

test('R3-2: files left by a READ-ONLY reviewer are never committed by the next writer: the review fails (dirty tree), the residue is discarded, the final candidate lacks it', async () => {
  const h = H({ scenario: { stages: { independent_review: [{ plant: { path: 'apps/mobile/reviewer-planted.ts' } }, {}] } } }); const id = h.submit(); await drive(h)
  assert.equal(h.ledger.getTask(id).handoff_ready, 1); assert.deepEqual(h.ledger.db.prepare("SELECT status FROM reviews WHERE task_id=? AND kind='independent_review' ORDER BY round").all(id).map((r) => r.status), ['verified_fail', 'verified_pass'])
  assert.ok(h.ledger.recoveryHistory(id).some((x) => x.kind === 'reviewer_modified_candidate')); /* the read-only proof now covers uncommitted/untracked files, and a read-only stage re-prepares the worktree; buildPrompt additionally discards residue whose last writer was a reviewer */ assert.ok(h.ledger.recoveryHistory(id).some((x) => x.kind === 'stage_failure' && x.detail.code === 'REVIEW.CANDIDATE_MODIFIED_BY_REVIEWER'))
  const w = JSON.parse(readFileSync(`${h.dirs.world}/world.json`, 'utf8')); void w; assert.ok(!JSON.stringify(h.ledger.getTask(id)).includes('planted')); assert.equal(finalBytes(h, id), unitLines(1))
  assert.throws(() => finalBytes(h, id, 'apps/mobile/reviewer-planted.ts'), /ENOENT/, 'the planted file is not in the final candidate'); h.close()
})

test('R3-3: an expired approval is re-issued only within a bounded age and count; the verdict is never made to look fresher than the bound', async () => {
  const h = H(); const id = h.submit(); await drive(h); assert.equal(h.ledger.getTask(id).handoff_ready, 1)
  const rv = h.ledger.db.prepare("SELECT review_id FROM reviews WHERE kind='independent_review' AND status='verified_pass'").get().review_id; const ask = () => h.cores.independent_reviewer.handle('issue_review', { task_id: id, review_id: rv })
  h.clock.advance(5 * 3600_000); const again = ask(); assert.ok(again.ok && !again.duplicate, 'within the bound: re-issued'); assert.ok(MAX_REATTEST_AGE_MS <= 24 * 3600_000)
  h.clock.advance(MAX_REATTEST_AGE_MS); const late = ask(); assert.equal(late.ok, false); assert.equal(late.code, 'ISSUER.REATTESTATION_BOUND_EXCEEDED'); h.close()
})

test('R3-4a: a reviewer cannot occupy the controller-minted coverage ids (cov-*): the submission is refused instead of the gap being skipped', () => {
  const sub = { findings: [{ id: 'cov-step-step-b', severity: 'info', path: 'apps/mobile/feature.txt' }], coverage: { steps: [{ id: 'step-b', status: 'unsatisfied' }], criteria: [] } }
  const r = normalizeSubmission(sub, { requireCoverage: true, stepIds: ['step-b'], stepTitles: { 'step-b': 't' }, criteria: [] }); assert.equal(r.ok, false); assert.ok(r.problems.includes('REVIEW.FINDING_ID_RESERVED'))
})
test('R3-4b: the ISSUER derives the independent verdict from the coverage table: unsatisfied coverage can never be signed as `pass`', async () => {
  const h = H(); const id = h.submit(); await drive(h); const rv = h.ledger.db.prepare("SELECT review_id FROM reviews WHERE kind='independent_review' AND status='verified_pass'").get().review_id
  h.ledger.db.prepare("UPDATE coverage SET status='unsatisfied' WHERE review_id=? AND subject_ref='step-b'").run(rv); h.clock.advance(5 * 3600_000)
  const r = h.cores.independent_reviewer.handle('issue_review', { task_id: id, review_id: rv }); assert.ok(r.ok); assert.equal(r.envelope.payload.verdict, 'findings_open'); h.close()
})
test('R3-4c: when the completeness gate refuses a candidate the approval that was just accepted is WITHDRAWN (it cannot stay live for the head)', async () => {
  let h; let flipped = false
  h = H({ hook: (n) => { if (n === 'after_review_submitted' && !flipped) { flipped = true; h.ledger.db.prepare("UPDATE plan_steps SET status='pending' WHERE step_id='step-b'").run() } } }); const id = h.submit(); await settle(h)
  assert.ok(h.ledger.recoveryHistory(id).some((x) => x.kind === 'completeness_gate_failed')); const ev = h.ledger.db.prepare("SELECT invalidated_at FROM evidence WHERE evidence_type='independent_review' ORDER BY accepted_at LIMIT 1").get(); assert.notEqual(ev.invalidated_at, null); h.close()
})

test('R3-6: V1 is byte-for-byte the first released schema (no carried/confirmed); a V1 ledger migrates to V2 with the widened findings CHECK and the in-flight-effect index', async () => {
  assert.ok(!MIGRATIONS[0].sql.includes("'carried'")); const { Ledger } = await import('../orchestrator/ledger/ledger.mjs'); const L = Ledger.open(':memory:')
  assert.ok(L.db.prepare("SELECT sql FROM sqlite_master WHERE name='findings'").get().sql.includes("'carried','confirmed'")); assert.ok(L.db.prepare("SELECT 1 FROM sqlite_master WHERE name='one_inflight_effect'").get()); L.close()
})

test('R3-7: credential-shaped failure text from an adapter never reaches history or notifications (code-shaped strings only; anything else is a stable hash)', async () => {
  const secret = `ghp_${'a1B2c3D4e5'.repeat(4)}`; const h = H({ scenario: { stages: { planning: [{ fail: `boom ${secret}`, failTimes: 100 }] } } }); const id = h.submit(); await drive(h)
  const all = JSON.stringify([h.ledger.db.prepare('SELECT * FROM outbox').all(), h.ledger.recoveryHistory(id), h.ledger.db.prepare('SELECT * FROM retry_budgets').all()]); assert.ok(!all.includes(secret) && !all.includes('ghp_'), 'no token anywhere'); assert.ok(all.includes('REDACTED:'))
  assert.ok(notes(h, 'technical_suspension').length >= 1); h.close()
})

test('R3-8: argv safety parses EVERY occurrence in both `flag v` and `flag=v` forms', () => {
  const bad = [['--permission-mode', 'dontAsk', '--permission-mode', 'bypassPermissions'], ['--permission-mode=bypassPermissions'], ['--permission-mode', 'dontAsk', '--permission-mode=bypassPermissions'], ['--setting-sources', 'user,project,local'], ['--setting-sources=user']]
  for (const argv of bad) assert.ok(checkInvocationSafety({ argv }).length > 0, argv.join(' '))
  for (const argv of [['--permission-mode', 'dontAsk', '--setting-sources', ''], ['--permission-mode=dontAsk'], ['--model', 'sonnet']]) assert.deepEqual(checkInvocationSafety({ argv }), [], argv.join(' '))
})

// ---------------------------------------------------------------- round 4 (Opus re-verification of the round-3 fixes)
import { safeCode, classifyBlocker } from '../orchestrator/suspension.mjs'

test('R4-1: redaction keeps the code-shaped HEAD, so an owner condition stays an owner condition however hostile its tail is', () => {
  for (const raw of ['SESSION.PERMISSION_MODE_MISMATCH:bypass Permissions', 'AUTH.API_KEY_SOURCE_ACTIVE:/login managed key', `AUTH.API_KEY_SOURCE_ACTIVE:ghp_${'a1B2c3D4e5'.repeat(4)}`]) {
    const s = safeCode(raw); assert.equal(classifyBlocker(raw), 'owner'); assert.equal(classifyBlocker(s), 'owner', s); assert.ok(!s.includes(' ') && !s.includes('ghp_') && !s.includes('/login'), s) }
  assert.match(safeCode('free text with spaces'), /^REDACTED:[0-9a-f]{12}$/); assert.equal(safeCode('PLAN.SHAPE'), 'PLAN.SHAPE')
})

test('R4-2: a hostile init value (free text in the permission mode) is STILL one session and one owner blocker — and the engine does not crash on a later technical suspension of the same task', async () => {
  const scenario = { stages: { planning: [{ permissionMode: 'bypass Permissions' }] }, tests: [{ passed: false, fingerprint: 'never' }] }; const h = H({ scenario, cfg: { technical: { maxRemediationCyclesPerEpoch: 2, maxEpochs: 1, cooldownsMs: [3600_000] } } })
  const id = h.submit(); await drive(h); assert.equal(h.ledger.getTask(id).state, 'blocked'); assert.equal(execs(h, id).length, 1); assert.equal(owner(h).blockerRows, 1); assert.equal(notes(h, 'technical_suspension').length, 0)
  assert.equal(h.engine.ownerResolve(id, 'owner-fixed-the-launcher').ok, true); scenario.stages.planning = [{}] // the owner fixed the launcher
  await drive(h) // ordinary test failures now exhaust the budget: this used to throw `canonicalize: unsupported type undefined` out of tick()
  assert.equal(h.ledger.getSuspension(id).disposition, 'terminal'); assert.ok(h.ledger.getSuspension(id).diagnostics.recent_failures.every((f) => 'fingerprint' in f)); h.close()
})

test('R4-3: a failing dirty-worktree probe is a bounded, scheduled technical failure — never a silent stall with an open review', async () => {
  const h = H(); const id = h.submit(); const cs = h.adapters.git.captureSnapshot.bind(h.adapters.git)
  h.adapters.git.captureSnapshot = async (...a) => { if (h.ledger.db.prepare('SELECT 1 FROM review_deliverables').get()) throw new Error('probe down'); return cs(...a) }
  const r = await settle(h); assert.ok(r.next_wakeup !== null, 'a retry is scheduled'); assert.ok(h.ledger.recoveryHistory(id).some((x) => x.kind === 'stage_failure' && x.detail.code === 'REVIEW.WORKTREE_PROBE_FAILED'))
  await drive(h); assert.ok(h.ledger.getSuspension(id)?.disposition === 'terminal' || h.ledger.getTask(id).handoff_ready === 1); h.close()
})

test('R4-4: the re-attestation bound is the LEDGER review/run time across EVERY recovery epoch (a new epoch cannot restart the clock); end_reason never stores free text', async () => {
  const h = H({ scenario: { stages: { independent_review: [{}] } } }); const id = h.submit(); await drive(h); const rv = h.ledger.db.prepare("SELECT review_id FROM reviews WHERE kind='independent_review' AND status='verified_pass'").get().review_id
  for (let month = 1; month <= 2; month += 1) {
    h.clock.advance(30 * 24 * 3600_000); const got = h.ledger.acquireLease({ taskId: id, role: 'implementer', stage: 'implementing', model: 'sonnet', effort: 'medium', ttlMs: 60_000 }); assert.ok(got.ok); assert.ok(h.ledger.supersedeLease({ guestCleanupVerified: true }).ok)
    const r = h.cores.independent_reviewer.handle('issue_review', { task_id: id, review_id: rv }); assert.equal(r.ok, false, `epoch ${month + 1}`); assert.equal(r.code, 'ISSUER.REATTESTATION_BOUND_EXCEEDED')
    const t = h.cores.orchestrator.handle('issue_test_results', { task_id: id, run_id: h.ledger.latestTestRun(id).run_id }); assert.equal(t.code, 'ISSUER.REATTESTATION_BOUND_EXCEEDED') }
  h.close()
  const secret = `ghp_${'a1B2c3D4e5'.repeat(4)}`; const g = H({ scenario: { stages: { planning: [{ fail: `boom ${secret}`, failTimes: 100 }] } } }); const gid = g.submit(); await drive(g)
  assert.ok(!JSON.stringify(g.ledger.db.prepare('SELECT end_reason FROM executions').all()).includes('ghp_'), 'end_reason is code-shaped'); void gid; g.close()
})

test('R5-1 [pre-integration lifecycle, no re-verification edge]: approvals older than the re-attestation bound end the handoff AT ONCE in a terminal suspension that names the real cause and what is needed (no wasted cool-downs, no misleading resume advice)', async () => {
  // D3.6 integration: the AUTHORITATIVE lifecycle now has the P6v3 re-verification back-edge, so there these approvals are REPLACED by new verification (d35-lifecycle-proposal).
  // This fail-closed path is kept for a lifecycle WITHOUT the edge, on the labelled pre-integration reducer (temp-only).
  let h; let fired = false
  h = H({ ledgerOptions: { proposalReducer: await proposalReducer([], { preIntegration: true }) }, hook: (n) => { if (n === 'after_evidence_accepted' && !fired && h.ledger.db.prepare("SELECT COUNT(*) c FROM evidence WHERE evidence_type='security_review'").get().c === 1) { fired = true; h.clock.advance(25 * 3600_000) } } })
  const id = h.submit(); await drive(h); const s = h.ledger.getSuspension(id); assert.equal(h.ledger.getTask(id).handoff_ready, 0); assert.equal(s.disposition, 'terminal'); assert.equal(s.cause, 'HANDOFF_APPROVALS_TOO_OLD'); assert.equal(s.epoch, 1, 'no cool-down epochs were burned')
  const n = notes(h, 'technical_suspension'); assert.equal(n.length, 1); const p = JSON.parse(n[0].payload_json); assert.ok(p.diagnostics.codes.includes('ISSUER.REATTESTATION_BOUND_EXCEEDED')); assert.match(p.how_to_resume, /NEW test run and NEW reviews/); assert.equal(owner(h).blockerRows, 0); h.close()
})
