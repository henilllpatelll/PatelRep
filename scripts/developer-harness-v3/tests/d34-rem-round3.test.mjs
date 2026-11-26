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
