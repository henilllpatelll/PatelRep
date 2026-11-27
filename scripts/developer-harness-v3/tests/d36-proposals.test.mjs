// D3.6 protected proposals (P6v2 superseded, P6v3 and P7 INTEGRATED by the owner integration) and the delivery boundaries. Disposable copies live in the OS temp directory only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadContractFile } from '../authority/contract.mjs'
import { validateEvidence as realValidate, signingMessage } from '../authority/evidence.mjs'
import { loadLifecycle } from '../lifecycle/lifecycle.mjs'
import { GATES, liveExecutionAllowed } from '../orchestrator/activation-gates.mjs'
import { EXPECTED_FILES, checkRegistry } from '../ci/run-v3-suites.mjs'
import { disposableCopy } from '../orchestrator/sim/delivery-harness.mjs'
import { Ledger } from '../orchestrator/ledger/ledger.mjs'
import { auth } from './d36-helpers.mjs'
import { NOW, REPO, makeKeys } from './helpers.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'); const DIR = path.join(ROOT, 'docs/developer-harness-v3/proposals')
const manifest = JSON.parse(readFileSync(path.join(DIR, 'manifest.json'), 'utf8'))
const V3 = path.join(ROOT, 'scripts/developer-harness-v3')
const src = (rel) => readFileSync(path.join(V3, rel), 'utf8')

test('manifest: P7 and P6v3 are INTEGRATED (the repository contract and lifecycle contain them); P6v2 and P6 are superseded (kept byte-for-byte, never applied); P1v2 and P2 keep the accepted D3.5 digests', () => {
  const by = Object.fromEntries(manifest.proposals.map((p) => [p.id, p]))
  assert.equal(by.P1v2.sha256, 'd12edfdd6fc56bbaafa920870ae2be718a53dd2026e6090508fdd0ca2c20bac2'); assert.equal(by.P2.sha256, 'c42ca081049c5b3e8144634c866ad6a014e568795490183196add56eea6c52ec'); assert.equal(by.P6.sha256, '705290e04eba88367d680b1b5ea3716e4325d9f044ceaeec19c607a97581bb79')
  assert.equal(by.P6.superseded_by, 'P6v2'); assert.equal(by.P6.status, 'superseded'); assert.equal(by.P6v2.status, 'superseded'); assert.equal(by.P7.status, 'integrated'); assert.equal(by.P6v3.status, 'integrated')
  for (const id of ['P6v2', 'P7']) {
    const buf = readFileSync(path.join(DIR, by[id].file)); assert.equal(createHash('sha256').update(buf).digest('hex'), by[id].sha256, id); assert.ok(!buf.includes(13), `${id} LF only`)
    for (const g of by[id].activation_prerequisite.split(/ and /)) assert.ok(GATES.some((x) => x.id === g), `${id}: ${g} registered`)
  }
  // D3.6 integration (before: "P7 is not applied", "P6v2 is not applied")
  const c = loadContractFile(); for (const a of ['open_draft_pull_request', 'update_pull_request_metadata', 'rerun_ci_jobs', 'dispatch_staging_candidate']) { assert.ok(Object.hasOwn(c.actions, a), `P7 integrated: ${a}`); assert.ok(!c.activation.active_actions.includes(a), `${a} inactive`) }
  for (const e of ['ci_failure_diagnosis', 'staging_admission', 'owner_decision']) assert.ok(Object.hasOwn(c.evidence_types, e), `P7 integrated: evidence ${e}`)
  const lc = loadLifecycle(); for (const k of ['base_conflict_rebuild', 'dependency_rebuild', 'reverification', 'ci_regression', 'staging_regression', 'owner_hold', 'cancellation']) assert.ok(Object.hasOwn(lc, k), `P6v3 integrated: ${k}`)
})
test('P7 regression: P7 changes NO existing action (the D3.2 delivery actions are byte-identical to the pre-integration contract), and the D3.2 authority suites run against the INTEGRATED authority in the registry', () => {
  // D3.6 integration: before, the D3.2 suites were re-run against a P7-patched DISPOSABLE copy (and `sec #2`, which lists the real agent code with git, could only run on a real
  // branch). Now the repository authority IS P7 + C1: the suites run unmodified, in place, in the pinned registry (CI: Release Workflow Contract) — including `sec #2`.
  const base = disposableCopy([], ['docs/developer-harness-v3/authority-contract.json'], 'dh36-p7-base-', { preIntegration: true })
  const before = JSON.parse(readFileSync(path.join(base, 'docs/developer-harness-v3/authority-contract.json'), 'utf8')); const after = loadContractFile()
  for (const a of Object.keys(before.actions)) assert.deepEqual(after.actions[a], before.actions[a], `${a} unchanged by the integration`)
  for (const k of Object.keys(before.evidence_types)) assert.deepEqual(after.evidence_types[k], before.evidence_types[k], `evidence ${k} unchanged`)
  for (const k of ['prohibited', 'protected_paths', 'activation', 'financial_limits', 'preserved_v2']) if (Object.hasOwn(before, k)) assert.deepEqual(after[k], before[k], `${k} unchanged`)
  assert.deepEqual(Object.keys(after.actions).filter((a) => !Object.hasOwn(before.actions, a)).sort(), ['dispatch_staging_candidate', 'open_draft_pull_request', 'rerun_ci_jobs', 'update_pull_request_metadata'], 'exactly the four P7 actions were added')
  for (const f of ['evaluator', 'security', 'promotion', 'foundation']) { assert.ok(EXPECTED_FILES.includes(`${f}.test.mjs`)); assert.match(src(`tests/${f}.test.mjs`), /from '\.\.\/authority\//, `${f} imports the REPOSITORY authority`) }
  assert.match(src('tests/security.test.mjs'), /sec #2/, 'the git-listing security test exists and now runs in place')
})
test('G-OWNER-ACTION-EVIDENCE (P7 integrated): the authoritative verifier knows the SIGNED owner-decision shape, but an owner_action_id is still only PRESENCE-checked by the ledger — the authenticated channel is unprovisioned, so the gate stays open', async () => {
  const A = await auth(); const keys = makeKeys(['task_ingress'])
  const contract = structuredClone(A.contract); const b = A.buildPolicyBundle({ contract, trusted_keys: keys.trusted_keys, parent_revision: null }); const pol = A.loadPolicy(b, A.policyRevision(b)); assert.ok(pol.ok, pol.problems?.join())
  const payload = { evidence_id: 'ev-owner-1', evidence_type: 'owner_decision', issuer_identity: 'task_ingress', task_id: 'task-1', repository: REPO, policy_revision: pol.policy.revision, issued_at: new Date(NOW - 1000).toISOString(), expires_at: new Date(NOW + 600_000).toISOString(),
    nonce: 'n-owner-1', idempotency_id: 'i-owner-1', fencing_token: 1, verdict: 'pass', decision: { action: 'unblock', owner_action_id: 'owner-act-42' } }
  const env = { schema: 'patelrep.developer-harness-v3.evidence', version: 1, payload, signature: { alg: 'ed25519', key_id: 'k-task_ingress', value: sign(null, signingMessage(payload), keys.privateKeys['k-task_ingress']).toString('base64') } }
  const ctx = { policy: pol.policy, now: NOW, binding: { repository: REPO, policy_revision: pol.policy.revision }, task: { task_id: 'task-1', fencing_token: 1 } }
  assert.equal(A.evidence.validateEvidence, realValidate, 'the test-activation configuration uses the repository verifier itself')
  assert.ok(realValidate(env, ctx).ok, 'P7 integrated: a signed owner decision verifies under a policy that pins a task_ingress key (here a TEST key)')
  const forged = structuredClone(env); forged.payload.decision.action = 'cancel'; assert.ok(realValidate(forged, ctx).problems.includes('EVIDENCE.BAD_SIGNATURE'), 'its disposition cannot be changed')
  const bare = structuredClone(env); bare.payload.decision = 'owner-act-42'; assert.ok(!realValidate(bare, ctx).ok, 'a bare owner_action_id string is not an owner decision')
  // what is still missing: the ledger accepts ANY owner_action_id string unless an owner-action verifier is configured, and no production verifier / trusted task_ingress key exists
  const L = Ledger.open(':memory:'); assert.equal(L.ownerActionVerifier, null, 'no authenticated owner-action channel is wired by default'); L.close()
  assert.deepEqual(loadContractFile().evidence_types.owner_decision.issuers, ['task_ingress'])
  assert.equal(GATES.find((g) => g.id === 'G-OWNER-ACTION-EVIDENCE').status, 'open')
})
test('boundaries: no merge or release authority anywhere in delivery; no new termination primitive; the publisher credential never reaches a worker; nothing activated; the registry pins every D3.6 file', () => {
  const ctl = src('orchestrator/delivery/controller.mjs')
  assert.ok(!/merge_pull_request|production_release|production_recovery/.test(src('orchestrator/delivery/authorize.mjs').split('ACTION_IDENTITY')[1].split('})')[0]), 'no merge/release action is a delivery action')
  assert.ok(!/['"](merge|merge_pull|deploy|release)['"]/.test(ctl.split('const API =')[1].split('\n')[0]), 'the publisher API map has no merge/release operation')
  for (const f of ['orchestrator/delivery/controller.mjs', 'orchestrator/delivery/watchdog.mjs', 'orchestrator/delivery/state.mjs', 'orchestrator/scheduler.mjs', 'orchestrator/issuer/delivery-issuer.mjs']) assert.ok(!/\.kill\(|taskkill|process\.kill|Stop-Process/.test(src(f)), `${f}: no termination`)
  for (const f of ['orchestrator/sim/sim-adapters.mjs', 'orchestrator/session-runner.mjs', 'runtime/launcher.mjs', 'orchestrator/stages.mjs']) assert.ok(!/scope: ['"]publisher['"]|PATELREP_APP_PRIVATE_KEY|credential: this.credential|publisher.call/.test(src(f)), `${f} never sees the publisher credential`)
  assert.deepEqual(loadContractFile().activation.active_actions, []); assert.equal(liveExecutionAllowed().allowed, false); assert.equal(GATES.filter((g) => g.status === 'closed').length, 0)
  assert.deepEqual(checkRegistry(), []); for (const f of ['d36-authority', 'd36-ci-staging', 'd36-e2e', 'd36-lifecycle', 'd36-proposals', 'd36-reconcile', 'd36-rem-latest-run', 'd36-rem-outcomes', 'd36-rem-stale-eligibility', 'd36-watchdog']) assert.ok(EXPECTED_FILES.includes(`${f}.test.mjs`))
})

test('D3.6 remediation: P6v3 superseded P6v2 — pinned, LF-only; P6v2 and its digest are untouched; P6v3 = P6v2 plus EXACTLY the two regression edges; the AUTHORITATIVE lifecycle IS base + P6v3', () => {
  const by = Object.fromEntries(manifest.proposals.map((p) => [p.id, p]))
  assert.equal(by.P6v2.sha256, '8a25be45eee6a121d281fb80c872b7cbb57f7c7272185f5d50e96f9503df84f8', 'the predecessor keeps its reviewed digest'); assert.equal(by.P6v2.superseded_by, 'P6v3')
  const buf = readFileSync(path.join(DIR, by.P6v3.file)); assert.equal(createHash('sha256').update(buf).digest('hex'), by.P6v3.sha256); assert.ok(!buf.includes(13), 'LF only')
  assert.equal(createHash('sha256').update(readFileSync(path.join(DIR, by.P6v2.file))).digest('hex'), by.P6v2.sha256, 'P6v2 is byte-for-byte as reviewed')
  for (const g of by.P6v3.activation_prerequisite.split(/ and /)) assert.ok(GATES.some((x) => x.id === g), `${g} registered`)
  // both applied to the SAME pre-integration base (before the integration: to the then-current tree)
  const files = ['docs/developer-harness-v3/task-lifecycle.json', 'scripts/developer-harness-v3/lifecycle/lifecycle.mjs', 'scripts/developer-harness-v3/lib/canonical.mjs']
  const a = disposableCopy([by.P6v2.file], files, 'dh36-p6v2-cmp-', { preIntegration: true }); const b = disposableCopy([by.P6v3.file], files, 'dh36-p6v3-cmp-', { preIntegration: true })
  const A = JSON.parse(readFileSync(path.join(a, files[0]), 'utf8')); const B = JSON.parse(readFileSync(path.join(b, files[0]), 'utf8'))
  for (const k of Object.keys(A)) assert.deepEqual(B[k], A[k], `P6v3 preserves ${k} exactly`)
  assert.deepEqual(Object.keys(B).filter((k) => !Object.hasOwn(A, k)).sort(), ['ci_regression', 'staging_regression'])
  assert.deepEqual([B.ci_regression.from, B.ci_regression.to, B.ci_regression.reason], [['staging_verification', 'merge_eligible'], 'ci_running', 'CI_RESULT_SUPERSEDED']); assert.deepEqual([B.staging_regression.from, B.staging_regression.to, B.staging_regression.reason], [['merge_eligible'], 'staging_verification', 'STAGING_RESULT_SUPERSEDED'])
  assert.deepEqual(B.ci_regression.invalidates, ['ci_gate', 'staging_gate', 'delivery_verification']); assert.deepEqual(B.staging_regression.invalidates, ['staging_gate', 'delivery_verification'])
  assert.ok(!['merged', 'completed'].some((st) => B.ci_regression.to === st || B.staging_regression.to === st), 'no edge reaches merged')
  // D3.6 integration (before: "P6v3 is NOT applied to the authoritative lifecycle"): the repository contract and reducer are exactly base + P6v3
  assert.deepEqual(loadLifecycle(), loadLifecycle(path.join(b, files[0])), 'the authoritative lifecycle contract is exactly base + P6v3')
  assert.equal(readFileSync(path.join(ROOT, files[1]), 'utf8').replace(/\r\n/g, '\n'), readFileSync(path.join(b, files[1]), 'utf8').replace(/\r\n/g, '\n'), 'and so is the reducer')
})
