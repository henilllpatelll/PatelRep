// D3.6 end-to-end acceptance (SIMULATED, PROPOSAL_UNDER_TEST: P7 + P6v2 on disposable copies, delivery actions activated in a TEST policy). Under the AUTHORITATIVE lifecycle the
// dependent task FAILS CLOSED when its upstream is rebuilt (no rebuild edge; d36-lifecycle proves it); P6v2 rebuilds it. From task submission to merge_eligible for two
// concurrent tasks (one an ordering dependency of the other) through: an implementation failure, a transient CI failure, a genuine CI failure, a candidate head replacement, a lost
// publication response, a controller restart, staging contention (a foreign PR on shared staging) — with ZERO owner interventions, and no merge or production release.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPublicKey, verify } from 'node:crypto'
import { canonicalize } from '../lib/canonical.mjs'
import { PACKAGE_DOMAIN } from '../orchestrator/issuer/delivery-issuer.mjs'
import { WORKFLOWS } from '../orchestrator/delivery/required-checks.mjs'
import { harness, ops, ownerInterventions, state, tmp } from './d36-helpers.mjs'

test('E2E: two tasks, every failure class, a restart and staging contention -> both exact candidates MERGE-ELIGIBLE with signed delivery packages; no owner action, no merge, no release', async () => {
  const root = tmp('dh36-e2e-')
  const gh = { ci: { default: ['fail_transient', 'pass'] }, logs: { fail_transient: 'npm ERR! network socket hang up', fail_genuine: 'AssertionError: expected the indicator to be visible' } }
  const scenario = { tests: [{ passed: false, fingerprint: 'unit:indicator' }, { passed: true }] } // the FIRST local test run of each task fails: an implementation failure
  let h = await harness({ root, gh, scenario, lifecycle: 'P6v2' })
  const a = h.submit({ requirements: { text: 'A: offline queue indicator', sim_path: 'apps/mobile/a/indicator.ts' }, scope: { allowed_paths: ['apps/mobile/a/**'], denied_paths: [] } })
  const b = h.submit({ requirements: { text: 'B: indicator copy', sim_path: 'apps/mobile/b/copy.ts' }, scope: { allowed_paths: ['apps/mobile/b/**'], denied_paths: [] }, depends_on: [a] })
  h.github.inject('push_ref', 'lose_response') // A's first publication: the push happens, the response is lost
  let genuine = false; let foreign = false; let headA1 = null
  const onRound = () => {
    if (!genuine && state(h, a) === 'ci_running') { headA1 = h.ledger.getTask(a).head_sha; h.github.sc.ci = { ...h.github.sc.ci, [headA1]: ['fail_genuine'] }; h.github.save(); genuine = true }
    if (!foreign && state(h, a) === 'staging_verification') { h.github.foreignStaging(25 * 60_000); foreign = true } // another PR occupies shared staging
  }
  // phase 1: run until A is back on CI after its genuine failure, then CRASH the controller (close without cleanup) and restart it on the same files
  await h.drive({ until: () => genuine && state(h, a) === 'ci_running' && h.ledger.getTask(a).head_sha !== headA1, maxRounds: 900, onRound })
  assert.notEqual(h.ledger.getTask(a).head_sha, headA1, 'A was rebuilt after the genuine CI failure (a NEW candidate)')
  const clock = h.clock; h.close()
  h = await harness({ root, clock, gh, scenario, lifecycle: 'P6v2' })
  const r = await h.drive({ until: () => state(h, a) === 'merge_eligible' && state(h, b) === 'merge_eligible', maxRounds: 1500, onRound })
  assert.ok(r.done, `A=${state(h, a)} B=${state(h, b)} ${JSON.stringify(h.ledger.getSuspension(a) ?? h.ledger.getSuspension(b))}`)

  // every failure class really happened
  const hist = (id) => h.ledger.recoveryHistory(id).map((x) => x.kind)
  assert.ok(h.ledger.db.prepare('SELECT COUNT(*) c FROM test_runs WHERE task_id=? AND passed=0').get(a).c >= 1, 'implementation failure (local tests)')
  assert.ok(ops(h, 'rerun_failed_jobs').length >= 1, 'transient CI failure re-run')
  assert.ok(hist(a).includes('delivery_remediation'), 'genuine CI failure returned to the implementer')
  assert.ok(h.ledger.db.prepare("SELECT 1 FROM remote_observations WHERE task_id=? AND state='present'").get(a), 'the lost publication response was reconciled from an authenticated read')
  assert.ok(h.github.s.runs.some((x) => x.workflow === WORKFLOWS.staging && x.foreign), 'staging contention')
  assert.ok(hist(b).includes('dependency_rebuild_started') || hist(b).includes('dependency_basis_changed'), 'the stale upstream invalidated the dependent transitively and it was REBUILT')
  // exact candidates, verified packages
  for (const id of [a, b]) {
    const t = h.ledger.getTask(id); const pkg = JSON.parse(h.ledger.meta(`delivery_package:${id}:${t.head_sha}`))
    const key = h.policy.trusted_keys[pkg.signature.key_id]; assert.equal(key.identity, 'delivery_verifier')
    assert.ok(verify(null, Buffer.from(`${PACKAGE_DOMAIN}${canonicalize(pkg.package)}`), createPublicKey({ key: Buffer.from(key.public_key, 'base64'), format: 'der', type: 'spki' }), Buffer.from(pkg.signature.value, 'base64')))
    assert.equal(pkg.package.candidate_sha, t.head_sha); assert.equal(pkg.package.policy_revision, h.policy.revision)
    const pr = h.github.s.prs.find((p) => p.number === h.ledger.delivery(id).pr_number); assert.equal(pr.head_sha, t.head_sha); assert.equal(pr.draft, false, 'marked ready (review only; never merged)')
  }
  // no owner, no merge, no release, nothing duplicated
  assert.equal(ownerInterventions(h), 0); assert.equal(h.ledger.db.prepare("SELECT COUNT(*) c FROM outbox WHERE kind='genuine_blocker'").get().c, 0)
  assert.equal(ops(h).filter((o) => /merge|release|deploy/i.test(o.op)).length, 0); assert.ok(!['merged', 'completed'].includes(state(h, a)) && !['merged', 'completed'].includes(state(h, b)))
  assert.equal(h.github.s.prs.length, 2, 'one PR per task'); assert.equal(new Set(h.github.s.prs.map((p) => p.head_ref)).size, 2)
  assert.ok(h.ledger.db.prepare("SELECT COUNT(*) c FROM outbox WHERE kind='delivery_status'").get().c >= 6, 'delivery status went through the durable outbox (D3.8 connects it)')
  h.close()
})
