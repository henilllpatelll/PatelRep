// D3.6 remediation F1 — merge eligibility is withdrawn when a NEWER applicable CI / staging run supersedes the results it rests on; recovery needs a FRESH package; nothing is ever merged.
// SIMULATED world, temp ledgers, test keys. Two configurations, never mixed: AUTHORITATIVE lifecycle (no back-edge: the task keeps `merge_eligible` with NO valid evidence — fail closed) and
// PROPOSAL_UNDER_TEST P6v3 (the labelled back-edges: the lifecycle state itself steps back, the reducer invalidates the evidence).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WORKFLOWS } from '../orchestrator/delivery/required-checks.mjs'
import { deliveryEligibility } from '../orchestrator/delivery/eligibility.mjs'
import { usableEvidence } from '../orchestrator/ledger/evidence-store.mjs'
import { harness, ops, state, untilState } from './d36-helpers.mjs'

const toEligible = async (h, id) => { const r = await h.drive({ until: untilState(h, id, 'merge_eligible'), maxRounds: 500 }); assert.ok(r.done && state(h, id) === 'merge_eligible', `no eligibility: ${state(h, id)} ${JSON.stringify(h.ledger.getSuspension(id))}`) }
const el = (h, id) => deliveryEligibility(h.ledger, h.policy, id)
const pr = (h, id) => h.github.s.prs.find((p) => p.number === h.ledger.delivery(id).pr_number)
const pkgOf = (h, id) => JSON.parse(h.ledger.meta(`delivery_package:${id}:${h.ledger.getTask(id).head_sha}`))
const types = (h, id) => usableEvidence(h.ledger, id, h.policy).map((r) => r.evidence_type)
const dead = (h, id, type) => h.ledger.db.prepare('SELECT COUNT(*) c FROM evidence WHERE task_id=? AND evidence_type=? AND invalidated_at IS NOT NULL').get(id, type).c
const noMerge = (h) => assert.equal(ops(h).filter((o) => /merge_pull|merge$|release|deploy/i.test(o.op)).length, 0, 'no merge / release / deploy operation was ever issued')
/** A NEWER run of `workflow` for the SAME head SHA (as a re-run, a re-opened PR or another trigger would create). */
function newerRun(h, id, workflow, o = {}) {
  const t = h.ledger.getTask(id); const p = pr(h, id); const g = h.github
  const run = { id: ++g.s.n.run, workflow, event: workflow === WORKFLOWS.staging ? 'workflow_dispatch' : 'pull_request', head_sha: t.head_sha, ...(workflow === WORKFLOWS.staging ? {} : { head_branch: p.head_ref }), pr_number: p.number, attempt: 1, status: 'queued', conclusion: null, created_at: h.clock.now() + 1, ...o }
  g.s.runs.push(run); g.save(); return run
}

test('F1 (AUTHORITATIVE lifecycle): a NEWER same-SHA CI run that has reported NO check withdraws merge eligibility at once — evidence, milestones and package; the unexpired signature authorizes nothing; recovery needs a FRESH package; nothing is merged', async () => {
  const h = await harness(); const id = h.submit(); await toEligible(h, id)
  assert.equal(h.ledger.lc.ci_regression, undefined, 'the authoritative lifecycle has NO regression edge'); assert.equal(h.label, 'PROPOSAL_UNDER_TEST', 'P7 delivery authority, authoritative lifecycle')
  const head = h.ledger.getTask(id).head_sha; const before = pkgOf(h, id); assert.deepEqual(el(h, id), { eligible: true, problems: [] }); assert.ok(types(h, id).includes('delivery_verification'))
  newerRun(h, id, WORKFLOWS.ci) // queued: nothing reported, no check at all
  const e = await h.delivery.currentEligibility(id)
  assert.equal(e.eligible, false); assert.ok(e.problems.includes('ELIGIBILITY_WITHDRAWN') && e.problems.includes('PACKAGE_MISSING') && e.problems.includes('MILESTONE_NOT_CURRENT'), e.problems.join())
  assert.equal(state(h, id), 'merge_eligible', 'authoritative: the task cannot step back; it keeps the state with NO valid evidence')
  for (const t of ['ci_gate', 'staging_gate', 'delivery_verification']) { assert.ok(!types(h, id).includes(t), `${t} no longer usable`); assert.ok(dead(h, id, t) >= 1, `${t} invalidated, never deleted`) }
  assert.ok(types(h, id).includes('publication_receipt') && types(h, id).includes('test_results'), 'only what rested on the superseded result was withdrawn')
  assert.equal(h.ledger.meta(`delivery_package:${id}:${head}`), null); const hist = h.ledger.db.prepare("SELECT key FROM meta WHERE key LIKE ?").all(`delivery_package_withdrawn:${id}:${head}:%`); assert.equal(hist.length, 1, 'the package is kept as history')
  assert.ok(before.package.verified_at + 3600_000 > h.clock.now(), 'the withdrawn package had NOT expired — expiry was never the protection')
  assert.ok(h.ledger.db.prepare("SELECT 1 FROM delivery_milestones WHERE task_id=? AND milestone='merge_eligible' AND invalidated_at IS NOT NULL").get(id))
  assert.ok(h.ledger.db.prepare("SELECT 1 FROM outbox WHERE kind='delivery_status' AND payload_json LIKE '%merge_eligibility_withdrawn%'").get(), 'announced once through the outbox')
  // a forged restoration of the old package changes nothing: the ledger-derived eligibility needs CURRENT evidence
  h.ledger.setMeta(`delivery_package:${id}:${head}`, JSON.stringify({ package: before.package, package_digest: before.package_digest, signature: before.signature }))
  assert.equal(el(h, id).eligible, false); assert.ok(el(h, id).problems.some((p) => p.startsWith('EVIDENCE_NOT_CURRENT')))
  h.ledger.db.prepare('DELETE FROM meta WHERE key=?').run(`delivery_package:${id}:${head}`)
  // while the newer run is still outstanding the controller waits and re-verifies NOTHING from older results
  h.clock.advance(6 * 60_000); await h.delivery.tick(); await h.delivery.tick(); assert.equal(el(h, id).eligible, false); assert.ok(!types(h, id).includes('delivery_verification'))
  // recovery: the newer run completes green (and its staging run too) -> a FRESH package, a re-reached milestone
  const run = h.github.s.runs.find((r) => r.status === 'queued' && r.workflow === WORKFLOWS.ci); run.status = 'in_progress'; run.completes_at = h.clock.now() + 60_000; h.github.save()
  const r = await h.drive({ until: () => el(h, id).eligible, maxRounds: 600 }); assert.ok(r.done, JSON.stringify([el(h, id), state(h, id), h.ledger.getSuspension(id)]))
  const after = pkgOf(h, id); assert.notEqual(after.package_digest, before.package_digest, 'a NEW package, not the old one'); assert.ok(after.package.verified_at > before.package.verified_at)
  assert.ok(after.package.ci.some((c) => c.run_id === run.id), 'the new package rests on the NEWER CI run'); assert.ok(h.ledger.db.prepare("SELECT 1 FROM authority_log WHERE kind LIKE 'milestone_reached_again_merge_eligible'").get(), 'the milestone was reached AGAIN, visibly')
  assert.notEqual(state(h, id), 'merged'); noMerge(h); h.close()
})

test('F1 (AUTHORITATIVE): a staging RE-RUN after merge eligibility withdraws only what rests on staging (CI evidence stays), and a fresh staging result restores eligibility', async () => {
  const h = await harness(); const id = h.submit(); await toEligible(h, id); const before = pkgOf(h, id)
  await h.github.call('dispatch_staging', { pr_number: pr(h, id).number }, { credential: h.credential }) // somebody re-runs Staging Candidate for this PR
  const e = await h.delivery.currentEligibility(id); assert.equal(e.eligible, false); assert.ok(e.problems.includes('ELIGIBILITY_WITHDRAWN'))
  assert.ok(types(h, id).includes('ci_gate'), 'CI evidence is untouched'); assert.ok(!types(h, id).includes('staging_gate') && !types(h, id).includes('delivery_verification'))
  assert.ok(h.ledger.db.prepare("SELECT 1 FROM delivery_milestones WHERE task_id=? AND milestone='ci_verified' AND invalidated_at IS NULL").get(id)); assert.ok(h.ledger.db.prepare("SELECT 1 FROM delivery_milestones WHERE task_id=? AND milestone='staging_verified' AND invalidated_at IS NOT NULL").get(id))
  const r = await h.drive({ until: () => el(h, id).eligible, maxRounds: 600 }); assert.ok(r.done, JSON.stringify([el(h, id), h.ledger.getSuspension(id)]))
  const after = pkgOf(h, id); assert.notEqual(after.package_digest, before.package_digest); assert.notEqual(after.package.staging.run_id, before.package.staging.run_id); assert.deepEqual(after.package.ci, before.package.ci, 'CI results are the same ones')
  noMerge(h); h.close()
})

test('F1 (AUTHORITATIVE): a newer run that FAILED or was CANCELLED, a newer ATTEMPT with no result, and a wrong-PR / wrong-provenance staging run each withdraw eligibility; the task stays ineligible and is NEVER left looking eligible', async () => {
  for (const kind of ['failure', 'cancelled', 'attempt', 'staging_other_pr', 'staging_provenance']) {
    const h = await harness(); const id = h.submit(); await toEligible(h, id)
    if (kind === 'failure' || kind === 'cancelled') newerRun(h, id, WORKFLOWS.ci, { status: 'completed', conclusion: kind })
    if (kind === 'attempt') { const run = h.github.s.runs.find((r) => r.workflow === WORKFLOWS.mobile && r.head_sha === h.ledger.getTask(id).head_sha); run.attempt += 1; run.status = 'queued'; run.conclusion = null; h.github.save() } // re-run: attempt 2 has reported nothing yet
    if (kind === 'staging_other_pr') { h.github.s.runs.find((r) => r.workflow === WORKFLOWS.staging && !r.foreign && r.conclusion === 'success').pr_number = 4242; h.github.save() }
    if (kind === 'staging_provenance') { h.github.s.checks.find((c) => c.name === 'Staging Gate').details_url = 'sim://runs/999999'; h.github.save() }
    const e = await h.delivery.currentEligibility(id); assert.equal(e.eligible, false, kind); assert.ok(e.problems.includes('ELIGIBILITY_WITHDRAWN'), `${kind}: ${e.problems.join()}`)
    assert.equal(h.ledger.meta(`delivery_package:${id}:${h.ledger.getTask(id).head_sha}`), null, kind)
    if (kind === 'failure') { // never recovers by itself: a bounded wait, then a visible TECHNICAL suspension — not an owner prompt, not eligibility
      const r = await h.drive({ until: () => !!h.ledger.getSuspension(id), maxRounds: 800 }); assert.ok(r.done); assert.equal(h.ledger.getSuspension(id).cause, 'MERGE_ELIGIBILITY_NOT_RECOVERED'); assert.equal(el(h, id).eligible, false)
    }
    noMerge(h); h.close()
  }
})

test('F1: staging provenance is validated IDENTICALLY by staging-gate issuance and final delivery verification (before the fix, only the gate re-checked the PR and the run)', async () => {
  const h = await harness(); const id = h.submit(); await toEligible(h, id)
  const run = () => h.github.s.runs.find((r) => r.workflow === WORKFLOWS.staging && !r.foreign && r.conclusion === 'success')
  const both = async () => [(await h.issuers.delivery_verifier.handle('issue_staging_gate', { task_id: id })).code, (await h.issuers.delivery_verifier.handle('issue_delivery_verification', { task_id: id })).code]
  assert.deepEqual(await both(), [undefined, undefined], 'control: valid provenance is accepted by both')
  run().pr_number = 4242; h.github.save(); const a = await both(); assert.equal(a[0], a[1], 'the SAME refusal'); assert.match(a[0], /^ISSUER\.STAGING_/); run().pr_number = pr(h, id).number
  h.github.s.checks.find((c) => c.name === 'Staging Gate').details_url = 'sim://runs/1'; h.github.save(); const b = await both(); assert.deepEqual(b, ['ISSUER.STAGING_PROVENANCE_MISMATCH', 'ISSUER.STAGING_PROVENANCE_MISMATCH'])
  h.close()
})

test('F1 (AUTHORITATIVE): staging_verification — a newer CI run while staging is being verified holds the task (CI must be current) and the CI evidence is re-issued before staging can complete', async () => {
  const h = await harness(); const id = h.submit(); let injected = null
  const r = await h.drive({ until: untilState(h, id, 'merge_eligible'), maxRounds: 900, onRound: () => { if (!injected && state(h, id) === 'staging_verification' && h.ledger.meta(`basis:ci:${id}:${h.ledger.getTask(id).head_sha}`)) { injected = newerRun(h, id, WORKFLOWS.ci, { status: 'in_progress', completes_at: h.clock.now() + 4 * 60_000 }) } } })
  assert.ok(injected, 'a newer CI run appeared while staging was being verified'); assert.ok(r.done, `${state(h, id)} ${JSON.stringify(h.ledger.getSuspension(id))}`)
  const p = pkgOf(h, id); assert.ok(p.package.ci.some((c) => c.run_id === injected.id), 'the final package rests on the NEWER CI run'); assert.ok(el(h, id).eligible); noMerge(h); h.close()
})

test('F1 (PROPOSAL_UNDER_TEST P6v3): the labelled back-edges step the task back to ci_running / staging_verification, the REDUCER invalidates the evidence, and the task returns to merge_eligible with a fresh package', async () => {
  const h = await harness({ lifecycle: 'P6v3' }); const id = h.submit(); await toEligible(h, id); const first = pkgOf(h, id)
  assert.ok(h.ledger.lc.ci_regression && h.ledger.lc.staging_regression, 'the PROPOSAL lifecycle declares the edges'); assert.equal(h.label, 'PROPOSAL_UNDER_TEST')
  // staging rerun -> staging_verification
  await h.github.call('dispatch_staging', { pr_number: pr(h, id).number }, { credential: h.credential })
  let e = await h.delivery.currentEligibility(id); assert.equal(e.eligible, false); assert.equal(state(h, id), 'staging_verification', 'the lifecycle state tells the truth')
  assert.ok(h.ledger.db.prepare("SELECT 1 FROM task_events WHERE task_id=? AND json_extract(event_json,'$.reason_code')='STAGING_RESULT_SUPERSEDED'").get(id))
  let r = await h.drive({ until: untilState(h, id, 'merge_eligible'), maxRounds: 600 }); assert.ok(r.done); assert.ok(el(h, id).eligible); const second = pkgOf(h, id); assert.notEqual(second.package_digest, first.package_digest)
  // CI rerun on the same SHA -> ci_running
  const run = newerRun(h, id, WORKFLOWS.ci, { status: 'in_progress', completes_at: h.clock.now() + 120_000 })
  e = await h.delivery.currentEligibility(id); assert.equal(e.eligible, false); assert.equal(state(h, id), 'ci_running')
  assert.ok(h.ledger.db.prepare("SELECT 1 FROM task_events WHERE task_id=? AND json_extract(event_json,'$.reason_code')='CI_RESULT_SUPERSEDED'").get(id))
  r = await h.drive({ until: untilState(h, id, 'merge_eligible'), maxRounds: 800 }); assert.ok(r.done, `${state(h, id)} ${JSON.stringify(h.ledger.getSuspension(id))}`); assert.ok(el(h, id).eligible)
  const third = pkgOf(h, id); assert.notEqual(third.package_digest, second.package_digest); assert.ok(third.package.ci.some((c) => c.run_id === run.id))
  assert.equal(h.ledger.db.prepare("SELECT COUNT(*) c FROM outbox WHERE kind='delivery_status' AND payload_json LIKE '%merge_eligibility_withdrawn%'").get().c, 2)
  noMerge(h); h.close()
})

test('F1: the regression edges do not weaken the lifecycle — they exist ONLY in the labelled P6v3 copy, only from the declared states, only with the declared reasons', async () => {
  const h = await harness({ lifecycle: 'P6v3' }); const id = h.submit(); await toEligible(h, id)
  const t = h.ledger.getTask(id)
  for (const bad of [{ to: 'ci_running', reason_code: 'STAGING_RESULT_SUPERSEDED' }, { to: 'staging_verification', reason_code: 'CI_RESULT_SUPERSEDED' }, { to: 'ci_running', reason_code: 'SOMETHING_ELSE' }, { to: 'ci_running' }]) {
    const r = h.ledger.applyLifecycleEvent(id, h.ledger.eventFor(id, 'transition', bad)); assert.equal(r.ok, false, JSON.stringify(bad)); assert.equal(h.ledger.getTask(id).state, 'merge_eligible')
  }
  void t; h.close()
})
