// D3.6 protected proposals (P6v2, P7) and the delivery boundaries. Nothing here applies a proposal to the repository: patched copies live in the OS temp directory only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash, sign } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadContractFile } from '../authority/contract.mjs'
import { validateEvidence as realValidate, signingMessage } from '../authority/evidence.mjs'
import { loadLifecycle } from '../lifecycle/lifecycle.mjs'
import { GATES, liveExecutionAllowed } from '../orchestrator/activation-gates.mjs'
import { EXPECTED_FILES, checkRegistry } from '../ci/run-v3-suites.mjs'
import { disposableCopy } from '../orchestrator/sim/delivery-harness.mjs'
import { auth } from './d36-helpers.mjs'
import { NOW, REPO, makeKeys } from './helpers.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'); const DIR = path.join(ROOT, 'docs/developer-harness-v3/proposals')
const manifest = JSON.parse(readFileSync(path.join(DIR, 'manifest.json'), 'utf8'))
const V3 = path.join(ROOT, 'scripts/developer-harness-v3')
const src = (rel) => readFileSync(path.join(V3, rel), 'utf8')

test('manifest: P6v2 and P7 are digest-pinned, LF-only, apply cleanly and are NOT applied; P6 is superseded (kept byte-for-byte); P1v2 and P2 keep the accepted D3.5 digests', () => {
  const by = Object.fromEntries(manifest.proposals.map((p) => [p.id, p]))
  assert.equal(by.P1v2.sha256, 'd12edfdd6fc56bbaafa920870ae2be718a53dd2026e6090508fdd0ca2c20bac2'); assert.equal(by.P2.sha256, 'c42ca081049c5b3e8144634c866ad6a014e568795490183196add56eea6c52ec'); assert.equal(by.P6.sha256, '705290e04eba88367d680b1b5ea3716e4325d9f044ceaeec19c607a97581bb79')
  assert.equal(by.P6.superseded_by, 'P6v2')
  for (const id of ['P6v2', 'P7']) {
    const buf = readFileSync(path.join(DIR, by[id].file)); assert.equal(createHash('sha256').update(buf).digest('hex'), by[id].sha256, id); assert.ok(!buf.includes(13), `${id} LF only`)
    assert.equal(spawnSync('git', ['-C', ROOT, 'apply', '--check', '-p1', path.join(DIR, by[id].file)]).status, 0, `${id} applies to the current tree`)
    for (const g of by[id].activation_prerequisite.split(/ and /)) assert.ok(GATES.some((x) => x.id === g), `${id}: ${g} registered`)
  }
  assert.equal(Object.hasOwn(loadContractFile().actions, 'open_draft_pull_request'), false, 'P7 is not applied'); assert.equal(Object.hasOwn(loadLifecycle(), 'base_conflict_rebuild'), false, 'P6v2 is not applied')
})

test('P7 regression: the D3.2 authority suites (evaluator, security, promotion, foundation) pass against the PATCHED authority on a disposable copy', () => {
  const files = ['scripts/developer-harness-v3/authority/contract.mjs', 'scripts/developer-harness-v3/authority/evaluator.mjs', 'scripts/developer-harness-v3/authority/evidence.mjs', 'scripts/developer-harness-v3/authority/migration-facts.mjs', 'scripts/developer-harness-v3/authority/policy-version.mjs', 'scripts/developer-harness-v3/authority/spend.mjs', 'scripts/developer-harness-v3/authority/git-facts.mjs',
    'scripts/developer-harness-v3/lib/canonical.mjs', 'scripts/developer-harness-v3/lib/paths.mjs', 'docs/developer-harness-v3/authority-contract.json', 'docs/developer-harness-v3/task-lifecycle.json', 'docs/developer-harness-v2/contract.json', 'scripts/developer-harness-v3/orchestrator/delivery/observation.mjs', 'scripts/developer-harness-v3/orchestrator/delivery/effect-subjects.mjs',
    ...['helpers.mjs', 'evaluator.test.mjs', 'security.test.mjs', 'promotion.test.mjs', 'foundation.test.mjs'].map((f) => `scripts/developer-harness-v3/tests/${f}`)]
  const t = disposableCopy(['P7-delivery-authority.patch'], files, 'dh36-p7-regress-')
  for (const d of readdirSync(path.join(ROOT, 'scripts/developer-harness-v3/lifecycle'))) { mkdirSync(path.join(t, 'scripts/developer-harness-v3/lifecycle'), { recursive: true }); copyFileSync(path.join(ROOT, 'scripts/developer-harness-v3/lifecycle', d), path.join(t, 'scripts/developer-harness-v3/lifecycle', d)) }
  // `sec #2` lists the repository's REAL agent code with `git ls-files`: it cannot run in a copy and is verified when the owner applies P7 on a real branch (doc 39 step 3)
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', '--test-concurrency=1', '--test-skip-pattern=sec #2', ...['evaluator', 'security', 'promotion', 'foundation'].map((f) => `scripts/developer-harness-v3/tests/${f}.test.mjs`)], { cwd: t, encoding: 'utf8', env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, TEMP: process.env.TEMP, TMP: process.env.TMP, NODE_NO_WARNINGS: '1' }, maxBuffer: 32 * 1024 * 1024 })
  const fail = /ℹ fail (\d+)/.exec(r.stdout)?.[1]; const pass = /ℹ pass (\d+)/.exec(r.stdout)?.[1]
  assert.equal(fail, '0', r.stdout.split('\n').filter((l) => /not ok|Error/.test(l)).slice(0, 8).join('\n')); assert.ok(Number(pass) > 50, `pass=${pass}`)
})

test('G-OWNER-ACTION-EVIDENCE design (P7): an owner decision is SIGNED evidence naming its disposition and owner_action_id; the authoritative verifier rejects it, so the gate stays open', async () => {
  const A = await auth(); const keys = makeKeys(['task_ingress'])
  const contract = structuredClone(A.contract); const b = A.buildPolicyBundle({ contract, trusted_keys: keys.trusted_keys, parent_revision: null }); const pol = A.loadPolicy(b, A.policyRevision(b)); assert.ok(pol.ok, pol.problems?.join())
  const payload = { evidence_id: 'ev-owner-1', evidence_type: 'owner_decision', issuer_identity: 'task_ingress', task_id: 'task-1', repository: REPO, policy_revision: pol.policy.revision, issued_at: new Date(NOW - 1000).toISOString(), expires_at: new Date(NOW + 600_000).toISOString(),
    nonce: 'n-owner-1', idempotency_id: 'i-owner-1', fencing_token: 1, verdict: 'pass', decision: { action: 'unblock', owner_action_id: 'owner-act-42' } }
  const env = { schema: 'patelrep.developer-harness-v3.evidence', version: 1, payload, signature: { alg: 'ed25519', key_id: 'k-task_ingress', value: sign(null, signingMessage(payload), keys.privateKeys['k-task_ingress']).toString('base64') } }
  const ctx = { policy: pol.policy, now: NOW, binding: { repository: REPO, policy_revision: pol.policy.revision }, task: { task_id: 'task-1', fencing_token: 1 } }
  assert.ok(A.evidence.validateEvidence(env, ctx).ok, 'P7: a signed owner decision verifies')
  const forged = structuredClone(env); forged.payload.decision.action = 'cancel'; assert.ok(A.evidence.validateEvidence(forged, ctx).problems.includes('EVIDENCE.BAD_SIGNATURE'), 'its disposition cannot be changed')
  assert.ok(realValidate(env, ctx).problems.includes('EVIDENCE.MALFORMED'), 'the AUTHORITATIVE verifier has no owner-decision payload: the gate is open')
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

test('D3.6 remediation: P6v3 supersedes P6v2 — pinned, LF-only, applies, NOT applied; P6v2 and its digest are untouched; P6v3 = P6v2 plus EXACTLY the two regression edges', () => {
  const by = Object.fromEntries(manifest.proposals.map((p) => [p.id, p]))
  assert.equal(by.P6v2.sha256, '8a25be45eee6a121d281fb80c872b7cbb57f7c7272185f5d50e96f9503df84f8', 'the predecessor keeps its reviewed digest'); assert.equal(by.P6v2.superseded_by, 'P6v3')
  const buf = readFileSync(path.join(DIR, by.P6v3.file)); assert.equal(createHash('sha256').update(buf).digest('hex'), by.P6v3.sha256); assert.ok(!buf.includes(13), 'LF only')
  assert.equal(createHash('sha256').update(readFileSync(path.join(DIR, by.P6v2.file))).digest('hex'), by.P6v2.sha256, 'P6v2 is byte-for-byte as reviewed')
  assert.equal(spawnSync('git', ['-C', ROOT, '-c', 'core.autocrlf=false', 'apply', '--check', '-p1', path.join(DIR, by.P6v3.file)]).status, 0, 'P6v3 applies to the current tree')
  for (const g of by.P6v3.activation_prerequisite.split(/ and /)) assert.ok(GATES.some((x) => x.id === g), `${g} registered`)
  assert.equal(Object.hasOwn(loadLifecycle(), 'ci_regression'), false, 'P6v3 is NOT applied to the authoritative lifecycle'); assert.equal(Object.hasOwn(loadLifecycle(), 'base_conflict_rebuild'), false)
  const files = ['docs/developer-harness-v3/task-lifecycle.json', 'scripts/developer-harness-v3/lifecycle/lifecycle.mjs', 'scripts/developer-harness-v3/lib/canonical.mjs']
  const a = disposableCopy([by.P6v2.file], files, 'dh36-p6v2-cmp-'); const b = disposableCopy([by.P6v3.file], files, 'dh36-p6v3-cmp-')
  const A = JSON.parse(readFileSync(path.join(a, files[0]), 'utf8')); const B = JSON.parse(readFileSync(path.join(b, files[0]), 'utf8'))
  for (const k of Object.keys(A)) assert.deepEqual(B[k], A[k], `P6v3 preserves ${k} exactly`)
  assert.deepEqual(Object.keys(B).filter((k) => !Object.hasOwn(A, k)).sort(), ['ci_regression', 'staging_regression'])
  assert.deepEqual([B.ci_regression.from, B.ci_regression.to, B.ci_regression.reason], [['staging_verification', 'merge_eligible'], 'ci_running', 'CI_RESULT_SUPERSEDED']); assert.deepEqual([B.staging_regression.from, B.staging_regression.to, B.staging_regression.reason], [['merge_eligible'], 'staging_verification', 'STAGING_RESULT_SUPERSEDED'])
  assert.deepEqual(B.ci_regression.invalidates, ['ci_gate', 'staging_gate', 'delivery_verification']); assert.deepEqual(B.staging_regression.invalidates, ['staging_gate', 'delivery_verification'])
  assert.ok(!['merged', 'completed'].some((s) => B.ci_regression.to === s || B.staging_regression.to === s), 'no edge reaches merged')
})
