// D3.6-E/G — exact-candidate CI and shared staging. SIMULATED world (the audited workflow semantics, doc 31); temp ledgers; test keys. No real GitHub or staging.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACTIONS_APP_ID, TRUSTED_CHECKS, WORKFLOWS, checkState, ciState, deriveRequiredChecks } from '../orchestrator/delivery/required-checks.mjs'
import { diagnose, redact } from '../orchestrator/delivery/diagnostics.mjs'
import { acquireStaging, markStagingUnresolved, releaseStaging, resolveStaging, stagingOwner } from '../orchestrator/delivery/state.mjs'
import { harness, intents, ops, state, untilState } from './d36-helpers.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const wf = (f) => readFileSync(path.join(ROOT, f), 'utf8')
const eligible = (h, id, n = 400) => h.drive({ until: untilState(h, id, 'merge_eligible'), maxRounds: n })
const H1 = 'a'.repeat(40); const H2 = 'b'.repeat(40)

test('expected checks are DERIVED from the trusted workflow files and must equal the pinned expectation; a changed gate fails closed', () => {
  const real = { ci: wf(WORKFLOWS.ci), mobile: wf(WORKFLOWS.mobile), staging: wf(WORKFLOWS.staging) }
  const d = deriveRequiredChecks(real); assert.ok(d.ok, d.problems.join()); assert.deepEqual(d.derived.ci_gate_needs, [...TRUSTED_CHECKS.ci_gate.needs]); assert.deepEqual(d.derived.mobile, [...TRUSTED_CHECKS.mobile])
  assert.ok(deriveRequiredChecks({ ...real, ci: real.ci.replace('      - room-board-hermetic\n', '') }).problems.includes('CHECKS.CI_GATE_NEEDS_CHANGED'), 'a dropped need')
  assert.ok(deriveRequiredChecks({ ...real, ci: real.ci.replace('    name: CI Gate\n', '    name: CI Gate (new)\n') }).problems.includes('CHECKS.CI_GATE_NOT_FOUND'))
  assert.ok(deriveRequiredChecks({ ...real, ci: `${real.ci}\n  supabase-preview:\n    name: Supabase Preview\n` }).problems.includes('CHECKS.SUPABASE_PREVIEW_UNPINNED'), 'a new conditional job is never assumed safe')
  assert.ok(deriveRequiredChecks({ ...real, ci: real.ci.replace('    if: ${{ always() }}\n', '') }).problems.includes('CHECKS.CI_GATE_NOT_ALWAYS'))
})

test('aggregation is EXACT-HEAD: wrong app (spoofed), wrong workflow/event/branch, an older head, a stale attempt, duplicates, skipped and missing are never success', () => {
  const run = (id, o = {}) => ({ id, workflow: WORKFLOWS.ci, event: 'pull_request', head_sha: H1, head_branch: 'dh3/t', attempt: 1, status: 'completed', conclusion: 'success', created_at: id, ...(o.attempt > 1 ? { started_at: id + 5 } : {}), ...o })
  const chk = (id, runId, o = {}) => ({ id, name: 'CI Gate', head_sha: H1, app_id: ACTIONS_APP_ID, run_id: runId, attempt: 1, status: 'completed', conclusion: 'success', ...o })
  const s = (runs, checks, head = H1) => checkState({ runs, checks }, { name: 'CI Gate', workflow: WORKFLOWS.ci, head_sha: head, head_branch: 'dh3/t' }).state
  assert.equal(s([run(1)], [chk(10, 1)]), 'success')
  assert.equal(s([run(1)], [chk(10, 1, { app_id: 999 })]), 'missing', 'a CI Gate from another app is ignored')
  assert.equal(checkState({ runs: [run(1)], checks: [chk(10, 1, { app_id: 999 })] }, { name: 'CI Gate', workflow: WORKFLOWS.ci, head_sha: H1, head_branch: 'dh3/t' }).spoofed, 1)
  assert.equal(s([run(1, { workflow: '.github/workflows/evil.yml' })], [chk(10, 1)]), 'missing'); assert.equal(s([run(1, { event: 'workflow_dispatch' })], [chk(10, 1)]), 'missing'); assert.equal(s([run(1, { head_branch: 'other' })], [chk(10, 1)]), 'missing')
  assert.equal(s([run(1)], [chk(10, 1)], H2), 'missing', 'success on an EARLIER head is never success for the replacement head')
  assert.equal(s([run(1, { attempt: 2, status: 'in_progress', conclusion: null })], [chk(10, 1, { attempt: 1 })]), 'pending', 'a result of a superseded attempt is stale while the newer attempt is running (D3.6 remediation F1: was "missing"; a COMPLETED successful attempt carries an earlier success only as a partial re-run, tested in d36-rem-latest-run)')
  assert.equal(s([run(1, { attempt: 2 })], [chk(10, 1, { attempt: 2, conclusion: 'failure' }), chk(11, 1, { attempt: 1 })]), 'failed', 'the LATEST attempt decides')
  assert.equal(s([run(1), run(2)], [chk(10, 1, { conclusion: 'failure' }), chk(11, 2)]), 'success', 'the latest RUN decides')
  assert.equal(s([run(1)], [chk(10, 1), chk(11, 1, { conclusion: 'failure' })]), 'ambiguous', 'two trusted results for ONE attempt: fail closed')
  for (const c of ['skipped', 'neutral']) assert.equal(s([run(1)], [chk(10, 1, { conclusion: c })]), 'skipped')
  assert.equal(s([run(1)], [chk(10, 1, { conclusion: 'cancelled' })]), 'cancelled'); assert.equal(s([run(1)], [chk(10, 1, { status: 'in_progress', conclusion: null })]), 'pending')
  const all = ciState({ runs: [run(1)], checks: [chk(10, 1)] }, { head_sha: H1, head_branch: 'dh3/t' }); assert.equal(all.overall, 'missing', 'CI Gate alone is not enough: the Mobile CI checks are required by V3 too')
})

test('diagnosis is deterministic and REDACTED before anything reads it; the fingerprint survives attempts; credential-shaped text never reaches the implementer', () => {
  const log = 'npm ERR! network ETIMEDOUT\nAuthorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz0123456789\nSUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.c2lnbmF0dXJlLXNpZ25hdHVyZQ\nhttps://user:pass@example.com/x\n'
  const r = redact(log); for (const s of ['ghp_', 'eyJ', 'user:pass', 'Bearer gh']) assert.ok(!r.includes(s), s)
  assert.equal(diagnose({ source: 'ci', job: 'Test / API', log }).classification, 'transient')
  assert.equal(diagnose({ source: 'ci', job: 'Test / API', log: 'AssertionError: expected 1 to equal 2\n  at test 17' }).classification, 'genuine')
  assert.equal(diagnose({ source: 'ci', job: 'x', log: 'something nobody recognizes' }).classification, 'unknown', 'unrecognized is NOT transient')
  assert.equal(diagnose({ source: 'ci', job: 'Frozen-File Guard', log: 'Frozen-File Guard: protected file changed' }).classification, 'protected_control_plane')
  assert.equal(diagnose({ source: 'ci', job: 'CI Gate', log: "::error::lint-api completed with 'failure'; CI Gate requires success." }).classification, 'unknown', 'the aggregator line is not a control-plane signal')
  assert.equal(diagnose({ source: 'ci', job: 'J', log: 'AssertionError at line 12' }).fingerprint, diagnose({ source: 'ci', job: 'J', log: 'AssertionError at line 99' }).fingerprint, 'numbers do not change the fingerprint')
})

test('a TRANSIENT CI failure is re-run (bounded, authorized by a single-use verifier diagnosis) and delivery continues; no model, no remediation', async () => {
  const h = await harness({ gh: { ci: { default: ['fail_transient', 'pass'] }, logs: { fail_transient: 'Error: The runner has received a shutdown signal' } } }); const id = h.submit()
  assert.ok((await eligible(h, id)).done); assert.equal(ops(h, 'rerun_failed_jobs').length, 1)
  assert.equal(h.ledger.db.prepare("SELECT COUNT(*) c FROM recovery_history WHERE task_id=? AND kind='delivery_remediation'").get(id).c, 0)
  const diag = h.ledger.db.prepare("SELECT consumed_by FROM evidence WHERE task_id=? AND evidence_type='ci_failure_diagnosis'").all(id); assert.equal(diag.length, 1); assert.match(diag[0].consumed_by, /^intent:rerun:/, 'consumed by the re-run intent')
  assert.ok(h.ledger.db.prepare("SELECT 1 FROM delivery_diagnostics WHERE task_id=? AND classification='transient'").get(id)); h.close()
  const h2 = await harness({ gh: { ci: { default: ['fail_transient'] }, logs: { fail_transient: 'ECONNRESET while fetching' } } }); const id2 = h2.submit()
  await h2.drive({ until: () => !!h2.ledger.getSuspension(id2), maxRounds: 400 }); assert.equal(h2.ledger.getSuspension(id2).cause, 'CI_TRANSIENT_FAILURE_REPEATED', 'bounded: infrastructure that keeps failing is a technical suspension, never remediation')
  assert.equal(ops(h2, 'rerun_failed_jobs').length, 2); h2.close()
})

test('a GENUINE CI failure returns to the implementer with a redacted, fenced excerpt; the new candidate gets FRESH CI and staging; the old head\'s results are never reused', async () => {
  const secretLog = 'AssertionError: expected true\nAuthorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz0123456789'
  const h = await harness({ gh: { logs: { fail_genuine: secretLog } } }); const id = h.submit()
  await h.drive({ until: () => h.ledger.getTask(id).head_sha !== null && inStateOnce(h, id), maxRounds: 2 })
  const first = await new Promise((res) => res(null)); void first
  h.github.sc.ci = { default: ['pass'] }; // the scenario is set per head below
  const t0 = await h.drive({ until: () => state(h, id) === 'ci_running', maxRounds: 200 }); assert.ok(t0.done)
  const head1 = h.ledger.getTask(id).head_sha; h.github.sc.ci = { [head1]: ['fail_genuine'], default: ['pass'] }
  assert.ok((await eligible(h, id)).done); const head2 = h.ledger.getTask(id).head_sha; assert.notEqual(head2, head1, 'a new candidate after remediation')
  const rem = h.ledger.db.prepare("SELECT value FROM meta WHERE key=?").get(`remediation:${id}`)?.value ?? JSON.stringify(h.ledger.recoveryHistory(id).filter((r) => r.kind === 'delivery_remediation'))
  assert.ok(!rem.includes('ghp_'), 'no credential-shaped text reached the remediation instruction')
  const cg = h.ledger.db.prepare("SELECT candidate_sha, invalidated_at FROM evidence WHERE task_id=? AND evidence_type='ci_gate'").all(id); assert.ok(cg.every((e) => e.candidate_sha === head2), 'the only CI evidence is for the NEW head')
  assert.ok(h.ledger.db.prepare("SELECT invalidated_at FROM delivery_milestones WHERE task_id=? AND candidate_sha=? AND milestone='published'").get(id, head1).invalidated_at !== null, 'the old head\'s milestones are invalidated'); h.close()
})
function inStateOnce() { return true }

test('a spoofed passing CI Gate (another app) never turns a failing CI into success; a protected control-plane failure is a terminal suspension, never a routine repair', async () => {
  const h = await harness({ gh: { ci: { default: ['fail_cp'] }, logs: { fail_cp: 'Frozen-File Guard: apps/web/frozen-files.json changed' } } }); const id = h.submit()
  await h.drive({ until: () => state(h, id) === 'ci_running', maxRounds: 200 })
  h.github.spoofCheck({ name: 'CI Gate', head_sha: h.ledger.getTask(id).head_sha, app_id: 4242, run_id: 1, attempt: 1, conclusion: 'success' })
  await h.drive({ until: () => !!h.ledger.getSuspension(id), maxRounds: 200 })
  const s = h.ledger.getSuspension(id); assert.equal(s.cause, 'PROTECTED_CONTROL_PLANE_FAILURE'); assert.equal(s.disposition, 'terminal'); assert.equal(state(h, id), 'ci_running', 'not remediation'); h.close()
})

test('CI that never reports is waited for (bounded), then a technical suspension; GitHub rate limits are waited out to their reset, with no extra effect', async () => {
  const h = await harness({ gh: { ciDisabled: true } }); const id = h.submit()
  await h.drive({ until: () => !!h.ledger.getSuspension(id), maxRounds: 400 }); assert.equal(h.ledger.getSuspension(id).cause, 'CI_RESULT_MISSING'); h.close()
  // (a window smaller than one step's reads would livelock: residual R-29)
  const r = await harness({ gh: { rate: { limit: 10, windowMs: 3600_000 } } }); const id2 = r.submit(); const w0 = r.github.s.rate.window_start
  assert.ok((await eligible(r, id2, 2000)).done, 'delivered after the rate-limit windows (fresh pre-dispatch reads cost requests too)')
  assert.equal(ops(r, 'push_ref').length, 1); assert.equal(ops(r, 'create_pull').length, 1)
  assert.ok(r.github.s.rate.window_start > w0, 'the limit was really hit: the controller waited for a window reset'); r.close()
})

test('shared staging: ONE V3 owner at a time (held or unresolved), re-bound to the owner\'s current candidate, released only with proof, never stolen', async () => {
  const h = await harness(); const a = h.submit({ requirements: { text: 'a', sim_path: 'apps/mobile/a.txt' } }); const b = h.submit({ requirements: { text: 'b', sim_path: 'apps/mobile/b.txt' } })
  for (const id of [a, b]) h.ledger.db.prepare("UPDATE tasks SET head_sha=? WHERE task_id=?").run(H1, id)
  assert.ok(acquireStaging(h.ledger, a).ok); assert.equal(acquireStaging(h.ledger, b).code, 'STAGING.BUSY')
  assert.equal(releaseStaging(h.ledger, a, { observedIdle: false, basis: 'x' }).code, 'STAGING.NOT_PROVEN_IDLE')
  assert.ok(markStagingUnresolved(h.ledger, a)); assert.equal(releaseStaging(h.ledger, a, { observedIdle: true, basis: 'x' }).code, 'STAGING.UNRESOLVED_NOT_RELEASABLE')
  assert.equal(acquireStaging(h.ledger, b).code, 'STAGING.BUSY', 'an unresolved owner keeps it'); assert.equal(acquireStaging(h.ledger, a).code, 'STAGING.OWN_RESERVATION_UNRESOLVED')
  assert.ok(resolveStaging(h.ledger, a, { observedIdle: true }).ok); assert.ok(releaseStaging(h.ledger, a, { observedIdle: true, basis: 'proven' }).ok); assert.ok(acquireStaging(h.ledger, b).ok); assert.equal(stagingOwner(h.ledger).task_id, b)
  assert.throws(() => h.ledger.db.prepare("INSERT INTO staging_reservations(reservation_id,kind,task_id,candidate_sha,state,acquired_at) VALUES ('x','shared_staging',?,?,'held',1)").run(a, H1), /UNIQUE|constraint/i, 'the database refuses a second owner'); h.close()
})

test('two tasks: the second never publishes while the first owns staging; both become merge-eligible; their staging runs never overlap', async () => {
  const h = await harness(); const a = h.submit({ requirements: { text: 'a', sim_path: 'apps/mobile/a.txt' } }); const b = h.submit({ requirements: { text: 'b', sim_path: 'apps/mobile/b.txt' } })
  assert.ok((await h.drive({ until: () => ['merge_eligible'].includes(state(h, a)) && state(h, b) === 'merge_eligible', maxRounds: 600 })).done)
  const runs = h.github.s.runs.filter((r) => r.workflow === WORKFLOWS.staging && r.status === 'completed' && r.started_at != null)
  for (const x of runs) for (const y of runs) if (x !== y) assert.ok(x.completes_at <= y.started_at || y.completes_at <= x.started_at, 'staging runs never overlap')
  const pushes = ops(h, 'push_ref'); assert.equal(pushes.length, 2); const aDone = h.ledger.db.prepare("SELECT reached_at FROM delivery_milestones WHERE milestone='staging_verified' ORDER BY reached_at LIMIT 1").get().reached_at
  assert.ok(pushes[1].at >= aDone, 'the second task published only after the first one\'s staging finished'); h.close()
})

test('our staging run displaced by another PR (one pending run per group): re-dispatched ONLY when staging is idle, authorized by a single-use admission; an uncertain dispatch is reconciled, never repeated', async () => {
  const h = await harness(); const id = h.submit(); let foreign = 0
  const onRound = async () => {
    if (state(h, id) === 'ci_running' && foreign === 0) { h.github.foreignStaging(30 * 60_000); foreign = 1 }
    if (foreign === 1 && h.github.s.runs.some((r) => r.workflow === WORKFLOWS.staging && !r.foreign && r.status === 'pending')) { h.github.foreignStaging(10 * 60_000); h.github.inject('dispatch_staging', 'lose_response'); foreign = 2 }
  }
  assert.ok((await h.drive({ until: untilState(h, id, 'merge_eligible'), maxRounds: 600, onRound })).done)
  assert.ok(h.github.s.runs.some((r) => r.displaced && !r.foreign), 'our pending run WAS displaced'); assert.equal(ops(h, 'dispatch_staging').length, 1, 'one dispatch, its lost response reconciled')
  const disp = intents(h, id).find((i) => i.action === 'dispatch_staging_candidate'); assert.equal(disp.status, 'reconciled_succeeded')
  const at = ops(h, 'dispatch_staging')[0].at; assert.ok(!h.github.s.runs.some((r) => r.workflow === WORKFLOWS.staging && r.foreign && r.started_at < at && r.completes_at > at), 'never dispatched while staging was busy'); h.close()
})

test('staging failures: a migration or smoke failure returns to the implementer; a transient deployment failure is re-dispatched (bounded); an obsolete head\'s success is never accepted', async () => {
  const h = await harness({ gh: { logs: { fail_migration: 'migration plan refused: DESTRUCTIVE_PATTERN', fail_deploy: 'Railway deployment timed out' } } }); const id = h.submit()
  await h.drive({ until: () => state(h, id) === 'ci_running', maxRounds: 200 }); const head1 = h.ledger.getTask(id).head_sha
  h.github.sc.staging = { [head1]: ['fail_migration'], default: ['fail_deploy', 'pass'] }
  assert.ok((await eligible(h, id, 800)).done); const head2 = h.ledger.getTask(id).head_sha
  assert.notEqual(head2, head1); assert.ok(h.ledger.recoveryHistory(id).some((r) => r.kind === 'delivery_remediation' && r.detail.reason === 'STAGING_FAILED'))
  assert.equal(ops(h, 'dispatch_staging').length, 1, 'the transient deployment failure was re-dispatched once')
  assert.ok(h.ledger.db.prepare("SELECT candidate_sha FROM evidence WHERE task_id=? AND evidence_type='staging_gate'").all(id).every((e) => e.candidate_sha === head2))
  assert.equal(checkState({ runs: h.github.s.runs, checks: h.github.s.checks }, { name: 'Staging Gate', workflow: WORKFLOWS.staging, head_sha: head1, events: ['workflow_run', 'workflow_dispatch'] }).state, 'failed', 'the old head keeps its own (failed) result'); h.close()
})

test('controller offline while staging completes: the restarted controller picks the completed result up from authenticated reads', async () => {
  const root = (await import('./d36-helpers.mjs')).tmp(); const h = await harness({ root }); const id = h.submit()
  await h.drive({ until: () => state(h, id) === 'staging_verification', maxRounds: 300 }); const clock = h.clock; h.close()
  clock.advance(45 * 60_000) // staging finished while nothing was watching
  const h2 = await harness({ root, clock }); assert.ok((await eligible(h2, id, 50)).done); assert.equal(ops(h2, 'dispatch_staging').length, 0); h2.close()
})

test('review M1: a technically suspended (or blocked/cancelled) owner releases shared staging once observation proves it idle — under the AUTHORITATIVE policy every task reaches its own terminal DELIVERY_NOT_ACTIVATED', async () => {
  const h = await harness({ proposal: false }); const a = h.submit({ requirements: { text: 'a', sim_path: 'apps/mobile/a.txt' } }); const b = h.submit({ requirements: { text: 'b', sim_path: 'apps/mobile/b.txt' } })
  await h.drive({ until: () => !!h.ledger.getSuspension(a) && !!h.ledger.getSuspension(b), maxRounds: 400 })
  for (const id of [a, b]) assert.equal(h.ledger.getSuspension(id)?.cause, 'DELIVERY_NOT_ACTIVATED', id)
  assert.equal(stagingOwner(h.ledger), null, 'no suspended task keeps shared staging'); assert.equal(ops(h).length, 0); h.close()
})

test('review M3: remote-state preconditions of a staging dispatch are re-read FRESH: staging that became busy after the last observation refuses the dispatch', async () => {
  const h = await harness(); const id = h.submit(); assert.ok((await eligible(h, id)).done)
  await h.delivery.observeDelivery(id); assert.equal(h.delivery.obsCache.get(id).details.staging_busy, false, 'the cached view says idle')
  h.github.foreignStaging(10 * 60_000) // another PR starts using shared staging
  const t = h.ledger.getTask(id); const dl = h.ledger.delivery(id)
  const v = await h.delivery.validator('dispatch_staging_candidate')({ repository: t.repository, branch: dl.branch, pr_number: dl.pr_number, head_sha: t.head_sha }, t)
  assert.equal(v.code, 'DELIVERY.STAGING_DISPATCH_UNSAFE'); h.close()
})
