// D3.4 protected-change proposals and their D3.6 owner integration: every patch is exact (digest-pinned); the integrated chain (P1v2, P6v3, P7, P2 + the separately reviewed
// corrections C1, C2) is applied EXACTLY — reversing it on a disposable copy gives the pre-integration base and replaying it reproduces the repository byte-for-byte; superseded
// proposals are historical (kept byte-for-byte, coherent with that base, never applied). Nothing here changes the repository.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { GATES } from '../orchestrator/activation-gates.mjs'
import { disposableCopy, inReconstructionScope, integratedChain } from '../orchestrator/sim/delivery-harness.mjs'
import { applyEvent, createTask, loadLifecycle } from '../lifecycle/lifecycle.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'); const DIR = path.join(ROOT, 'docs/developer-harness-v3/proposals')
const manifest = JSON.parse(readFileSync(path.join(DIR, 'manifest.json'), 'utf8'))
const sha = (b) => createHash('sha256').update(b).digest('hex')
// Review M1: exactness is asserted for the V3 ROOT-OF-TRUST files (authority, lifecycle reducer, V3 contracts), which change only through owner proposals appended to the chain;
// the control-plane files of P2/C2 are pinned by the V2 workflow guard and the staging workflow tests, so later ordinary edits there never break this test.
const SUPERSEDED = { P1: 'P1v2', P5: 'P6', P6: 'P6v2', P6v2: 'P6v3' }

test('every proposal and correction patch matches its pinned digest, has LF endings and no BOM, and names only its declared files', () => {
  assert.equal(manifest.base_main_sha, '5ced4d309cf3532a490a48dbd06c575994822eac'); assert.ok(manifest.proposals.length >= 2)
  for (const p of [...manifest.proposals, ...manifest.integration.corrections]) {
    const buf = readFileSync(path.join(DIR, p.file)); assert.equal(sha(buf), p.sha256, p.id); assert.ok(!buf.toString('utf8').includes('\r'), `${p.id} LF only`); assert.notEqual(buf[0], 0xef, `${p.id} no BOM`)
    const touched = [...buf.toString('utf8').matchAll(/^diff --git a\/(\S+) b\//gm)].map((m) => m[1]).sort()
    assert.deepEqual(touched, p.touches.map((t) => t.replace(/ \(new\)$/, '')).sort(), `${p.id} touches exactly what the manifest says`)
  }
})

test('D3.6 integration status is exact: four proposals integrated in order, the rest superseded (never both a proposal and its replacement), corrections apply after P2', () => {
  const by = Object.fromEntries(manifest.proposals.map((p) => [p.id, p]))
  assert.deepEqual(manifest.integration.integrated_chain, ['P1v2', 'P6v3', 'P7', 'P2']); assert.equal(manifest.integration.base_main_sha, 'c557c5b05d480f0e2f29a2a2a1701842300b58aa')
  for (const [i, id] of manifest.integration.integrated_chain.entries()) { assert.equal(by[id].status, 'integrated', id); assert.equal(by[id].integration_order, i + 1, id); assert.equal(by[id].superseded_by, undefined, `${id} is not superseded`) }
  for (const [old, next] of Object.entries(SUPERSEDED)) { assert.equal(by[old].status, 'superseded', old); assert.equal(by[old].superseded_by, next, old); assert.equal(by[old].integration_order, undefined, `${old} was never integrated`) }
  assert.deepEqual(manifest.proposals.map((p) => p.id).sort(), [...Object.keys(SUPERSEDED), ...manifest.integration.integrated_chain].sort(), 'every proposal is either integrated or superseded')
  assert.deepEqual(manifest.integration.corrections.map((c) => c.id), ['C1', 'C2']); for (const c of manifest.integration.corrections) { assert.equal(c.status, 'integrated_correction'); assert.equal(c.applies_after, 'P2') }
})

test('the integrated chain is applied EXACTLY to the V3 root of trust: reversed on a disposable copy it yields the pre-integration base; replayed on that base it reproduces every such file byte-for-byte', () => {
  const chain = integratedChain(); const files = [...new Set(chain.flatMap((c) => c.touches))].filter(inReconstructionScope)
  assert.ok(files.includes('scripts/developer-harness-v3/authority/evaluator.mjs') && files.includes('docs/developer-harness-v3/task-lifecycle.json') && files.includes('scripts/developer-harness-v3/authority/trusted-git.mjs'), 'the scope covers the root of trust')
  assert.ok(!files.some((f) => /^\.github\/|developer-harness-v2|\/tests\/|\/orchestrator\/issuer\//.test(f)), 'review M1: no control-plane, V2, test or development-scope file is ever reverse-applied (later ordinary edits there cannot break the reconstruction)')
  // review O1: base + chain == repository is circular on its own (the base is derived FROM the repository); the post-chain bytes are therefore ALSO pinned independently
  const post = manifest.integration.post_chain_sha256; assert.ok(Object.keys(post).length >= 11)
  for (const [f, d] of Object.entries(post)) assert.equal(sha(Buffer.from(readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n'))), d, `${f} equals its pinned post-integration digest`)
  for (const n of readdirSync(path.join(ROOT, 'scripts/developer-harness-v3/authority'))) assert.ok(Object.hasOwn(post, `scripts/developer-harness-v3/authority/${n}`), `authority/${n} is pinned`)
  const base = disposableCopy([], [], 'dh34-integration-base-', { preIntegration: true }) // throws unless EVERY reverse step applies
  const replay = disposableCopy([], [], 'dh34-integration-replay-', { preIntegration: true })
  for (const c of chain) { const inc = c.touches.filter(inReconstructionScope); if (!inc.length) continue; const r = spawnSync('git', ['-c', 'core.autocrlf=false', 'apply', '-p1', ...inc.map((f) => `--include=${f}`), path.join(DIR, c.file)], { cwd: replay, encoding: 'utf8' }); assert.equal(r.status, 0, `${c.id} replays on the base: ${r.stderr}`) }
  for (const f of files) {
    const here = existsSync(path.join(ROOT, f)) ? sha(readFileSync(path.join(ROOT, f))) : null; const again = existsSync(path.join(replay, f)) ? sha(readFileSync(path.join(replay, f))) : null
    assert.equal(again, here, `${f}: base + chain == repository`)
  }
  // P1v2's move: the old location exists only in the base, the new one only in the repository
  assert.ok(existsSync(path.join(base, 'scripts/developer-harness-v3/orchestrator/trusted-git.mjs')) && !existsSync(path.join(ROOT, 'scripts/developer-harness-v3/orchestrator/trusted-git.mjs')))
  assert.ok(!existsSync(path.join(base, 'scripts/developer-harness-v3/authority/trusted-git.mjs')) && existsSync(path.join(ROOT, 'scripts/developer-harness-v3/authority/trusted-git.mjs')))
})

test('superseded proposals are HISTORICAL: byte-for-byte as reviewed, coherent with the pre-integration base they were cut against, and NOT what the repository contains', () => {
  const by = Object.fromEntries(manifest.proposals.map((p) => [p.id, p]))
  for (const id of Object.keys(SUPERSEDED)) {
    const p = by[id]; const t = disposableCopy([p.file], p.touches.map((x) => x.replace(/ \(new\)$/, '')), `dh34-hist-${id}-`, { preIntegration: true }) // throws unless it applies to the base
    const differs = p.touches.map((x) => x.replace(/ \(new\)$/, '')).filter(inReconstructionScope).some((f) => !existsSync(path.join(ROOT, f)) || sha(readFileSync(path.join(t, f))) !== sha(readFileSync(path.join(ROOT, f))))
    assert.ok(differs, `${id} is not the applied state (its replacement ${SUPERSEDED[id]} is)`)
  }
})

test('proposal content: P1 removes every bare `git` call from authority/git-facts.mjs (and so does the integrated repository); P2 moves the network fetch out of the test and wires V3 without deleting any guard rule', () => {
  const p1 = readFileSync(path.join(DIR, manifest.proposals.find((p) => p.id === 'P1').file), 'utf8'); assert.ok(p1.includes("+import { resolveGit, trustedGit } from '../orchestrator/trusted-git.mjs'") && p1.includes("-import { execFileSync } from 'node:child_process'") && !/^\+.*execFileSync\('git'/m.test(p1))
  const gf = readFileSync(path.join(ROOT, 'scripts/developer-harness-v3/authority/git-facts.mjs'), 'utf8')
  assert.ok(gf.includes("import { resolveGit, trustedGit } from './trusted-git.mjs'") && !/execFileSync|spawnSync|child_process/.test(gf), 'integrated: authority git runs only through the hardened, in-authority runner')
  const p2 = readFileSync(path.join(DIR, manifest.proposals.find((p) => p.id === 'P2').file), 'utf8')
  assert.ok(p2.includes('-    const r = verifyPinProvenance(REPO, e, { fetchIfShallow: true })') && p2.includes('fetch-pinned-provenance.mjs') && p2.includes('run-v3-suites.mjs') && p2.includes("+  if (st.length !== 6) p.push('RELEASE_STEP_COUNT')"))
  // the guard keeps every existing rule: only count/index/pin lines are changed, none of its mutation tests or structural rules is deleted
  const removed = p2.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')); assert.ok(removed.length <= 10, `P2 removes ${removed.length} lines`); assert.ok(removed.every((l) => /BASELINE_(WORKFLOW|RELEASE_BLOCK)_SHA256|RELEASE_STEP_COUNT|const h = st\[3\]|fetchIfShallow|db6027a28a34/.test(l)), removed.join('\n'))
  // the corrections only ADD checks: C1 removes no evaluator line other than the two comments it rewords
  const c1 = readFileSync(path.join(DIR, 'C1-authority-integration-corrections.patch'), 'utf8')
  const c1Removed = c1.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')); assert.ok(c1Removed.every((l) => /^-\s*\/\//.test(l)), `C1 removes only comments: ${c1Removed.join('\n')}`)
})

test('classification: nothing here is mandatory for D3.4 completion; every proposal maps to a registered activation gate; the not-a-patch items are declared', () => {
  const ids = new Set(GATES.map((g) => g.id))
  for (const p of manifest.proposals) { assert.equal(p.mandatory_for_d34_completion, false); for (const g of p.activation_prerequisite.split(/ and /)) assert.ok(ids.has(`G-${g.replace(/^G-/, '')}`), g) }
  assert.deepEqual(manifest.not_patches.map((n) => n.id), ['P3', 'P4']); assert.ok(existsSync(path.join(ROOT, 'docs/developer-harness-v3/21-d34-protected-changes.md')))
})

test('P5 (historical) still applies to the pre-integration contract; its technical_suspension safety properties now hold in the AUTHORITATIVE (P6v3) lifecycle', () => {
  const base = disposableCopy([], ['docs/developer-harness-v3/task-lifecycle.json'], 'dh34-p5-base-', { preIntegration: true })
  assert.equal(Object.hasOwn(loadLifecycle(path.join(base, 'docs/developer-harness-v3/task-lifecycle.json')).recoverable_states, 'technical_suspension'), false, 'the pre-integration contract had no technical_suspension')
  const p5 = disposableCopy(['P5-lifecycle-technical-suspension.patch'], ['docs/developer-harness-v3/task-lifecycle.json'], 'dh34-p5-', { preIntegration: true })
  assert.ok(Object.hasOwn(loadLifecycle(path.join(p5, 'docs/developer-harness-v3/task-lifecycle.json')).recoverable_states, 'technical_suspension'), 'P5 applies to its base')
  const lc = loadLifecycle(); assert.ok(Object.hasOwn(lc.recoverable_states, 'technical_suspension'), 'D3.6 integration: the authoritative contract declares it')
  for (const r of ['RETRY_BUDGET_EXHAUSTED', 'SESSION_BUDGET_EXHAUSTED', 'REVIEW_BUDGET_EXHAUSTED', 'REMEDIATION_BUDGET_EXHAUSTED', 'HANDOFF_EVIDENCE_UNOBTAINABLE']) assert.ok(lc.recoverable_states.technical_suspension.reasons.includes(r), `P5 reason ${r} kept`)
  let n = 0; const ev = (t, kind, f = {}) => ({ event_id: `e${++n}`, idempotency_id: `i${n}`, task_id: 't1', kind, expected_revision: t.state_revision, fencing_token: t.fencing_token, ...f })
  const step = (t, to, f = {}) => applyEvent(lc, t, ev(t, 'transition', { to, ...f }))
  for (const from of ['implementing', 'testing', 'independent_review', 'security_review', 'publishing']) {
    let t = createTask({ task_id: 't1' }); for (const s of ['queued', 'planning', 'implementing', 'testing', 'independent_review', 'security_review', 'publishing']) { t = step(t, s).task; if (s === from) break }
    const into = step(t, 'technical_suspension', { reason_code: 'RETRY_BUDGET_EXHAUSTED' }); assert.ok(into.ok, `${from}: ${into.problems}`); assert.equal(into.task.resume_to, from)
    assert.equal(step(into.task, 'blocked', { reason_code: 'OWNER_DECISION_REQUIRED' }).ok, true, 'the owner may still raise a genuine blocker from it'); assert.equal(step(into.task, from === 'testing' ? 'implementing' : 'testing', {}).ok, false, 'the only exit is the recorded resume target')
    assert.ok(step(into.task, from).ok, `${from}: resumes to the recorded state with NO owner action`); assert.equal(step(into.task, 'technical_suspension', { reason_code: 'NOT_A_REASON' }).ok, false)
  }
  let t = createTask({ task_id: 't1' }); for (const s of ['queued', 'planning', 'implementing', 'testing']) t = step(t, s).task
  const rem = step(t, 'remediation', { reason_code: 'TEST_FAILED' }); const sus = step(rem.task, 'technical_suspension', { reason_code: 'REMEDIATION_BUDGET_EXHAUSTED' }); assert.ok(sus.ok); assert.ok(step(sus.task, 'implementing').ok, 'a wait that began as remediation resumes to implementing')
  assert.equal(step(sus.task, 'blocked', { reason_code: 'TEST_FAILED' }).ok, false, 'never_blocked_reasons still apply')
})
