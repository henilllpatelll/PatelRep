// D3.4 issuers and key custody: narrow operations, facts re-derived by the issuer, refusals, replay, key custody and deactivation, authenticated IPC against REAL issuer
// subprocesses, hardened git (hostile repository configuration cannot run code), and a static proof that the controller code cannot reach key material.
// TEST KEYS ONLY (`test-` prefix, generated in a temp directory outside any repository). No production key or policy exists in this file.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomBytes } from 'node:crypto'
import { createHarness, FixtureClock } from '../orchestrator/sim/harness.mjs'
import { startIssuers } from './d34-helpers.mjs'
import { OPS } from '../orchestrator/issuer/issuer-core.mjs'
import { aclPlan, assertOutside, emergencyDeactivate, generateIssuerKey, loadSigningKey, proposeKeyRegistration, proposeKeyRevocation, proposeKeyRotation } from '../orchestrator/issuer/key-custody.mjs'
import { callIssuer, ipcPath, startIssuerServer } from '../orchestrator/issuer/ipc.mjs'
import { createIssuerClient } from '../orchestrator/issuer/issuer-client.mjs'
import { DEFAULT_GIT_CANDIDATES, minimalEnv, resolveGit, trustedGit } from '../authority/trusted-git.mjs'
import { createFacts as createGitFacts } from '../orchestrator/issuer/facts-git.mjs'
import { gatherCandidateFacts } from '../authority/git-facts.mjs'
import { loadContractFile, loadPolicy, policyRevision } from '../authority/contract.mjs'
import { promotionCheck } from '../authority/policy-version.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url)); const ORCH = path.join(HERE, '..', 'orchestrator')
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'dh34-iss-'))
class Stop extends Error {}
/** Drive the engine until `point` fires, then stop it there (the task stays exactly where the engine left it). */
async function runUntil(point, scenario = {}, extra = {}) {
  const h = createHarness({ root: tmp(), scenario, hook: (n) => { if (n === point) throw new Stop(n) }, ...extra }); const id = h.submit()
  await assert.rejects(h.engine.runUntilIdle({ maxTicks: 60 }), Stop); return { h, id }
}
const orch = (h) => h.cores.orchestrator

// ------------------------------------------------------------------ issuer core: narrow operations, facts re-derived
test('there is NO generic signing operation: each identity exposes only its own narrow, identifier-only operation', () => {
  assert.deepEqual(Object.keys(OPS).sort(), ['delivery_verifier', 'independent_reviewer', 'orchestrator', 'security_reviewer'])
  for (const ops of Object.values(OPS)) assert.ok(ops.every((o) => /^issue_[a-z_]+$/.test(o)) && !ops.some((o) => /sign|payload|any|arbitrary/.test(o)))
  const h = createHarness({ root: tmp() }); const c = orch(h)
  for (const op of ['sign', 'sign_payload', 'issue_evidence', 'issue_review', 'issue_isolation_attestation', '__proto__', 'constructor']) assert.equal(c.handle(op, { payload: { verdict: 'pass' } }).code, 'ISSUER.OPERATION_NOT_PERMITTED_FOR_IDENTITY', op)
  assert.equal(h.cores.independent_reviewer.handle('issue_test_results', {}).code, 'ISSUER.OPERATION_NOT_PERMITTED_FOR_IDENTITY'); assert.equal(h.cores.security_reviewer.handle('issue_isolation_attestation', {}).code, 'ISSUER.OPERATION_NOT_PERMITTED_FOR_IDENTITY')
  assert.equal(c.handle('status', {}).ok, true); h.close()
})

test('test_results issuer: derives facts itself, ignores request-supplied facts, refuses wrong state/run/candidate/token/policy, is idempotent', async () => {
  const { h, id } = await runUntil('after_test_run_recorded'); const c = orch(h); const run = h.ledger.latestTestRun(id)
  assert.equal(c.handle('issue_test_results', { task_id: id, run_id: 'run-ghost' }).code, 'ISSUER.UNKNOWN_RUN'); assert.equal(c.handle('issue_test_results', { task_id: 'task-ghost', run_id: run.run_id }).code, 'ISSUER.UNKNOWN_TASK')
  assert.equal(c.handle('issue_test_results', { task_id: id, run_id: 'bad id!' }).code, 'ISSUER.BAD_REQUEST')
  const a = c.handle('issue_test_results', { task_id: id, run_id: run.run_id, verdict: 'pass', candidate_sha: 'f'.repeat(40), results: { passed: 9999 }, nonce: 'n-attacker' }); assert.ok(a.ok)
  assert.notEqual(a.envelope.payload.nonce, 'n-attacker'); assert.equal(a.envelope.payload.candidate_sha, h.ledger.currentCandidate(id).candidate_sha); assert.deepEqual(a.envelope.payload.results, { passed: 4, failed: 0, skipped: 0 }); assert.equal(a.envelope.payload.issuer_identity, 'orchestrator')
  const b = c.handle('issue_test_results', { task_id: id, run_id: run.run_id }); assert.ok(b.duplicate); assert.deepEqual(b.envelope, a.envelope, 'asking again returns the SAME envelope: no second nonce for one subject')
  // candidate facts the issuer derives itself disagree with the controller's record => refuse
  h.ledger.db.prepare('UPDATE candidates SET tree_digest=? WHERE task_id=?').run('e'.repeat(40), id); h.ledger.db.prepare('UPDATE test_runs SET tree_digest=? WHERE task_id=?').run('e'.repeat(40), id)
  assert.equal(c.handle('issue_test_results', { task_id: id, run_id: run.run_id }).code === 'ISSUER.CANDIDATE_FACTS_DISAGREE' || c.handle('issue_test_results', { task_id: id, run_id: run.run_id }).duplicate === true, true)
  h.close()
  // fresh cases on clean state
  const x = await runUntil('after_test_run_recorded'); const run2 = x.h.ledger.latestTestRun(x.id)
  x.h.ledger.db.prepare('UPDATE candidates SET tree_digest=? WHERE task_id=?').run('e'.repeat(40), x.id); x.h.ledger.db.prepare('UPDATE test_runs SET tree_digest=? WHERE task_id=?').run('e'.repeat(40), x.id)
  assert.equal(orch(x.h).handle('issue_test_results', { task_id: x.id, run_id: run2.run_id }).code, 'ISSUER.CANDIDATE_FACTS_DISAGREE'); x.h.close()
  const y = await runUntil('after_test_run_recorded'); const run3 = y.h.ledger.latestTestRun(y.id)
  y.h.ledger.db.prepare('UPDATE test_runs SET fencing_token=7 WHERE task_id=?').run(y.id); assert.equal(orch(y.h).handle('issue_test_results', { task_id: y.id, run_id: run3.run_id }).code, 'ISSUER.STALE_FENCING_TOKEN')
  y.h.ledger.db.prepare('UPDATE test_runs SET fencing_token=1, candidate_sha=? WHERE task_id=?').run('9'.repeat(40), y.id); assert.equal(orch(y.h).handle('issue_test_results', { task_id: y.id, run_id: run3.run_id }).code, 'ISSUER.RUN_FOR_ANOTHER_CANDIDATE')
  y.h.ledger.db.prepare('UPDATE test_runs SET candidate_sha=(SELECT head_sha FROM tasks WHERE task_id=?) WHERE task_id=?').run(y.id, y.id); y.h.ledger.db.prepare("UPDATE test_runs SET passed=0, results_json='{\"passed\":3,\"failed\":1}' WHERE task_id=?").run(y.id)
  assert.equal(orch(y.h).handle('issue_test_results', { task_id: y.id, run_id: run3.run_id }).envelope.payload.verdict, 'fail', 'a failing run is signed as fail, never as pass'); y.h.close()
  const z = await runUntil('after_test_run_recorded'); const run4 = z.h.ledger.latestTestRun(z.id); z.h.ledger.cancel(z.id); assert.equal(orch(z.h).handle('issue_test_results', { task_id: z.id, run_id: run4.run_id }).code, 'ISSUER.TASK_CANCELLED'); z.h.close()
})

test('policy substitution: an issuer pinned to a different policy refuses every task bound to the active one', async () => {
  const { h, id } = await runUntil('after_test_run_recorded'); const run = h.ledger.latestTestRun(id)
  h.ledger.db.prepare('UPDATE tasks SET policy_revision=? WHERE task_id=?').run('1'.repeat(64), id); assert.equal(orch(h).handle('issue_test_results', { task_id: id, run_id: run.run_id }).code, 'ISSUER.POLICY_REVISION_MISMATCH')
  h.ledger.db.prepare('UPDATE tasks SET policy_revision=?, environment_id=NULL WHERE task_id=?').run(h.policy.revision, id); assert.equal(orch(h).handle('issue_test_results', { task_id: id, run_id: run.run_id }).code, 'ISSUER.NO_ENVIRONMENT'); h.close()
})

test('review issuer: independence, read-only proof, model identity and the verdict are computed by the issuer, never taken from the reviewer', async () => {
  const sc = { stages: { independent_review: [{ findings: [{ id: 'sec-1', severity: 'critical', mandatory: false, path: 'apps/mobile/feature.txt', evidence: 'e', reproduction: 'r', remediation: 'fix' }, { id: 'nit-1', severity: 'low', path: 'apps/mobile/feature.txt' }] }] } }
  const { h, id } = await runUntil('after_review_submitted', sc); const rv = h.ledger.db.prepare('SELECT * FROM reviews WHERE task_id=?').get(id); const c = h.cores.independent_reviewer
  const call = () => c.handle('issue_review', { task_id: id, review_id: rv.review_id })
  const r1 = call(); assert.ok(r1.ok); assert.equal(r1.envelope.payload.verdict, 'findings_open', 'critical is blocking even though the reviewer said mandatory:false')
  assert.deepEqual(r1.envelope.payload.findings.map((f) => [f.id, f.severity, f.resolved]).sort(), [['nit-1', 'low', false], ['sec-1', 'critical', false]])
  assert.equal(h.cores.security_reviewer.handle('issue_review', { task_id: id, review_id: rv.review_id }).code, 'ISSUER.REVIEW_KIND_MISMATCH')
  const mut = (sql, ...a) => h.ledger.db.prepare(sql).run(...a); const rid = rv.review_id
  mut("UPDATE reviews SET status='open' WHERE review_id=?", rid); assert.equal(call().code, 'ISSUER.REVIEW_NOT_SUBMITTED'); mut("UPDATE reviews SET status='submitted' WHERE review_id=?", rid)
  mut('UPDATE reviews SET readonly_verified=0 WHERE review_id=?', rid); assert.equal(call().code, 'ISSUER.READONLY_NOT_VERIFIED'); mut('UPDATE reviews SET readonly_verified=1 WHERE review_id=?', rid)
  mut("UPDATE executions SET status='running' WHERE execution_id=?", rv.execution_id); assert.equal(call().code, 'ISSUER.REVIEW_SESSION_NOT_VERIFIED_STOPPED'); mut("UPDATE executions SET status='terminated_verified' WHERE execution_id=?", rv.execution_id)
  mut("UPDATE executions SET model_actual='claude-sonnet-5-5', model_requested='opus' WHERE execution_id=?", rv.execution_id); assert.equal(call().code, 'ISSUER.MANDATORY_REVIEW_MODEL_NOT_SATISFIED', 'wrong model for the kind')
  mut("UPDATE executions SET model_actual=NULL, model_requested='sonnet' WHERE execution_id=?", rv.execution_id); assert.equal(call().code, 'ISSUER.MANDATORY_REVIEW_MODEL_NOT_SATISFIED', 'unreported model identity cannot satisfy a mandatory review')
  mut("UPDATE executions SET model_actual='claude-opus-5-5' WHERE execution_id=?", rv.execution_id); assert.equal(call().code, 'ISSUER.MANDATORY_REVIEW_MODEL_NOT_SATISFIED', 'substituted model')
  mut("UPDATE executions SET model_actual='claude-sonnet-5-5' WHERE execution_id=?", rv.execution_id); assert.ok(call().ok)
  // independence: the reviewer's context equals an implementer's context => refuse
  const impl = h.ledger.db.prepare("SELECT context_id FROM executions WHERE task_id=? AND role='implementer'").get(id); mut('UPDATE reviews SET context_id=? WHERE review_id=?', impl.context_id, rid); mut('UPDATE executions SET context_id=? WHERE execution_id=?', 'ctx-temp', rv.execution_id)
  assert.equal(call().code, 'ISSUER.REVIEW_SESSION_NOT_VERIFIED_STOPPED'); h.close()
})

test('isolation attestation: refuses on the D3.3 probe-VM facts (a probe PASS alone never attests); would issue only when every independent precondition holds', async () => {
  const probeOnly = { suite_passed_all_scenarios: true, current: true, full_size_worker_admitted: false, dedicated_worker_account: false, qemu_firewall_rule: false, environment_id: 'vm-isolated-sim', acceptance_digest: 'a'.repeat(64) }
  const { h, id } = await runUntil('after_candidate_recorded', {}, { isolation: probeOnly })
  const r = h.cores.delivery_verifier.handle('issue_isolation_attestation', { task_id: id, environment_id: 'vm-isolated-sim' })
  assert.equal(r.code, 'ISSUER.ISOLATION_PRECONDITIONS_UNMET'); assert.deepEqual(r.more.sort(), ['ISOLATION.full_size_worker_admitted', 'ISOLATION.qemu_outbound_firewall_rule', 'ISOLATION.worker_runs_as_dedicated_account'])
  assert.equal(h.cores.delivery_verifier.handle('issue_isolation_attestation', { task_id: id, environment_id: 'other' }).code, 'ISSUER.ENVIRONMENT_MISMATCH'); h.close()
  const none = await runUntil('after_candidate_recorded', {}, { isolation: null }); assert.equal(none.h.cores.delivery_verifier.handle('issue_isolation_attestation', { task_id: none.id, environment_id: 'vm-isolated-sim' }).code, 'ISSUER.ISOLATION_PRECONDITIONS_UNMET'); none.h.close()
  // test-only: with every precondition satisfied by a (fabricated) fact source the code path signs — proving the refusals above are the ONLY thing standing in the way
  const all = { ...probeOnly, full_size_worker_admitted: true, dedicated_worker_account: true, qemu_firewall_rule: true }
  const ok = await runUntil('after_candidate_recorded', {}, { isolation: all }); const att = ok.h.cores.delivery_verifier.handle('issue_isolation_attestation', { task_id: ok.id, environment_id: 'vm-isolated-sim' }); assert.ok(att.ok); assert.equal(att.envelope.payload.evidence_type, 'isolation_attestation'); ok.h.close()
})

// ------------------------------------------------------------------ key custody
test('key custody: generation refuses forbidden roots, the implementer, bad ids and overwrites; test/real key-id prefixes cannot be confused', () => {
  const base = tmp(); const repo = path.join(base, 'repo'); mkdirSync(repo)
  const g = (over = {}) => generateIssuerKey({ identity: 'orchestrator', keyId: 'test-k1', keyDir: path.join(base, 'keys'), forbiddenRoots: [repo], notBefore: '2026-01-01T00:00:00Z', notAfter: '2027-01-01T00:00:00Z', test: true, ...over })
  assert.ok(g().ok); assert.equal(g().code, 'KEY.ALREADY_EXISTS')
  assert.equal(g({ keyDir: path.join(repo, 'keys'), keyId: 'test-k2' }).code, 'KEY.DIRECTORY_INSIDE_FORBIDDEN_ROOT'); assert.equal(g({ keyDir: base, keyId: 'test-k3', forbiddenRoots: [path.join(base, 'keys')] }).code, 'KEY.DIRECTORY_INSIDE_FORBIDDEN_ROOT', 'a parent of a forbidden root is refused too')
  assert.equal(g({ identity: 'implementer', keyId: 'test-k4' }).code, 'KEY.IDENTITY_NOT_AN_ISSUER'); assert.equal(g({ identity: 'merger', keyId: 'test-k5' }).ok, true, 'other issuing identities are allowed')
  assert.equal(g({ keyId: 'real-key', keyDir: path.join(base, 'k2') }).code, 'KEY.BAD_KEY_ID_OR_TEST_PREFIX', 'a test key cannot masquerade as a real one'); assert.equal(g({ keyId: 'test-x', test: false, keyDir: path.join(base, 'k3') }).code, 'KEY.BAD_KEY_ID_OR_TEST_PREFIX')
  assert.equal(g({ keyId: 'Bad Id', keyDir: path.join(base, 'k4') }).code, 'KEY.BAD_KEY_ID_OR_TEST_PREFIX'); assert.equal(g({ keyId: 'test-w', notAfter: '2025-01-01T00:00:00Z', keyDir: path.join(base, 'k5') }).code, 'KEY.BAD_VALIDITY_WINDOW')
  assert.ok(assertOutside(path.join(base, 'elsewhere'), [repo]).ok)
  const entry = g({ keyId: 'test-e', keyDir: path.join(base, 'k6') }).entry; assert.deepEqual(Object.keys(entry).sort(), ['alg', 'identity', 'key_id', 'not_after', 'not_before', 'public_key'], 'only PUBLIC material is returned')
  assert.ok(!JSON.stringify(entry).includes('PRIVATE'))
})

test('emergency deactivation stops signing IMMEDIATELY, even in a running issuer, and cannot be undone by the issuer', async () => {
  const { h, id } = await runUntil('after_test_run_recorded'); const run = h.ledger.latestTestRun(id); const keyId = h.pol.keyIds.orchestrator
  assert.ok(loadSigningKey(h.dirs.keys, keyId).ok); assert.ok(emergencyDeactivate(h.dirs.keys, keyId, { reason: 'suspected compromise' }).ok)
  assert.equal(loadSigningKey(h.dirs.keys, keyId).code, 'KEY.DEACTIVATED'); assert.equal(orch(h).handle('issue_test_results', { task_id: id, run_id: run.run_id }).code, 'KEY.DEACTIVATED')
  assert.ok(emergencyDeactivate(h.dirs.keys, keyId).ok, 'idempotent'); assert.ok(readdirSync(h.dirs.keys).some((f) => f.startsWith(`${keyId}.pem.revoked`)), 'the loadable key file is renamed away')
  assert.equal(emergencyDeactivate(h.dirs.keys, '../etc').code, 'KEY.BAD_KEY_ID'); h.close()
})

test('registration, rotation and revocation are PROPOSALS that diff as root-of-trust: automated promotion is impossible', () => {
  const base = tmp(); const h = createHarness({ root: base }); const active = { contract: h.pol.bundle.contract, trusted_keys: h.pol.bundle.trusted_keys, parent_revision: null }
  const fresh = generateIssuerKey({ identity: 'orchestrator', keyId: 'test-orchestrator-2', keyDir: path.join(base, 'k2'), notBefore: '2026-06-01T00:00:00Z', notAfter: '2028-01-01T00:00:00Z', test: true }).entry
  const reg = proposeKeyRegistration(active, fresh); assert.ok(reg.ok); assert.equal(reg.automated_promotion_possible, false); assert.ok(reg.diff.rootOfTrust && reg.diff.changes.some((c) => c.code === 'TRUSTED_KEYS_CHANGED'))
  assert.equal(proposeKeyRegistration(active, { ...fresh, key_id: h.pol.keyIds.orchestrator }).problems[0], 'KEY.ID_ALREADY_REGISTERED')
  const bad = proposeKeyRegistration(active, { ...fresh, identity: 'implementer' }); assert.equal(bad.ok, false); assert.ok(bad.problems.some((p) => /implementer/.test(p)))
  const rot = proposeKeyRotation(active, { oldKeyId: h.pol.keyIds.orchestrator, newEntry: fresh, cutoverIso: '2026-12-01T00:00:00Z' }); assert.ok(rot.ok); assert.equal(rot.proposed_bundle.trusted_keys[h.pol.keyIds.orchestrator].not_after, '2026-12-01T00:00:00Z'); assert.ok(rot.proposed_bundle.trusted_keys['test-orchestrator-2'])
  assert.equal(proposeKeyRotation(active, { oldKeyId: h.pol.keyIds.orchestrator, newEntry: { ...fresh, identity: 'merger' }, cutoverIso: '2026-12-01T00:00:00Z' }).problems[0], 'KEY.IDENTITY_MISMATCH')
  const rev = proposeKeyRevocation(active, h.pol.keyIds.orchestrator); assert.ok(rev.ok); assert.equal(rev.proposed_bundle.trusted_keys[h.pol.keyIds.orchestrator], undefined); assert.equal(proposeKeyRevocation(active, 'ghost').problems[0], 'KEY.UNKNOWN')
  // the D3.2 promotion check itself refuses to promote a key change automatically
  const proposedLoaded = { contract: reg.proposed_bundle.contract, trusted_keys: reg.proposed_bundle.trusted_keys, parent_revision: h.pol.revision }
  const pc = promotionCheck({ contract: h.pol.policy.contract, trusted_keys: h.pol.policy.trusted_keys, revision: h.pol.revision }, proposedLoaded); assert.equal(pc.ok === true && pc.automated === true, false)
  h.close()
})

test('ACL plan: separate issuer and controller accounts, the controller denied on key material; the plan is data (never executed here)', () => {
  const p = aclPlan({ keyDir: 'D:\\dh3\\keys\\orchestrator', ipcDir: 'D:\\dh3\\ipc', issuerAccount: 'dh3-iss-orch', controllerAccount: 'dh3-controller' }); assert.ok(p.ok)
  const text = p.commands.map((c) => c.join(' ')).join('\n'); assert.match(text, /\/inheritance:r/); assert.match(text, /\/deny dh3-controller:\(OI\)\(CI\)\(R,W,X\)/); assert.match(text, /dh3-iss-orch:\(OI\)\(CI\)F/)
  assert.equal(aclPlan({ keyDir: 'a', ipcDir: 'b', issuerAccount: 'same', controllerAccount: 'same' }).code, 'ACL.ISSUER_AND_CONTROLLER_MUST_DIFFER'); assert.equal(aclPlan({ keyDir: 'a', ipcDir: 'b', issuerAccount: 'x"; calc', controllerAccount: 'y' }).code, 'ACL.BAD_ACCOUNT')
  assert.match(p.note, /cannot prove Windows enforced/)
})

test('STATIC: the controller/orchestrator code cannot reach key material — it never imports the issuer core, key custody, or a signing primitive', () => {
  const files = []; const walk = (d) => { for (const n of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, n.name); if (n.isDirectory()) { if (!['issuer', 'sim'].includes(n.name)) walk(p) } else if (n.name.endsWith('.mjs')) files.push(p) } }
  walk(ORCH); assert.ok(files.length >= 12, `controller-side files found: ${files.length}`)
  const SIGNING = new Set(['createPrivateKey', 'generateKeyPairSync', 'generateKeyPair', 'sign', 'createSign', 'privateDecrypt', 'createSecretKey', 'privateEncrypt'])
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/import\s+(?:([^'";]*?)\s+from\s+)?['"]([^'"]+)['"]/g)) {
      const spec = m[2]; const names = (m[1] ?? '').replace(/[{}]/g, '').split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)
      assert.ok(!/issuer-core|key-custody|issuer-main|facts-git/.test(spec), `${path.basename(f)} imports ${spec}`)
      if (/^(node:)?crypto$/.test(spec)) assert.deepEqual(names.filter((n) => SIGNING.has(n)), [], `${path.basename(f)} imports a signing primitive`)
    }
    assert.ok(!/import\s*\(\s*['"][^'"]*(issuer-core|key-custody)/.test(src), `${path.basename(f)} dynamically imports an issuer module`)
    assert.ok(!/\.pem['"`]|BEGIN [A-Z ]*PRIVATE KEY/.test(src.replace(/\/\/.*$/gm, '')) || /snapshot\.mjs/.test(f), `${path.basename(f)} references key files`)
  }
  const client = readFileSync(path.join(ORCH, 'issuer', 'issuer-client.mjs'), 'utf8').replace(/\/\/.*$/gm, ''); assert.ok(!/createPrivateKey|key-custody|issuer-core/.test(client) && /readFileSync\(endpoints\[role\]\.secretFile\)/.test(client), 'the client holds only an IPC secret, never a signing key')
  const main = readFileSync(path.join(ORCH, 'issuer', 'issuer-main.mjs'), 'utf8'); assert.ok(/Ledger\.openReadOnly/.test(main), 'issuer processes open the controller ledger READ-ONLY')
})

// ------------------------------------------------------------------ IPC against real issuer subprocesses

test('authenticated IPC with REAL issuer processes: wrong secret, replayed MAC, malformed/oversized frames and unknown operations are refused; the right secret works end to end', async () => {
  // fixture only (no assertion changed): REAL issuer processes read the WALL clock, so the ledger's fixture clock starts at the wall clock — with the fixed 2026-11-25 default the run would be > 24 h old and the issuer's re-attestation bound would refuse it once a day had passed (a time bomb found 2026-11-26 on the unchanged D3.5 code)
  const { h, id } = await runUntil('after_test_run_recorded', {}, { clock: new FixtureClock(Date.now()) }); const run = h.ledger.latestTestRun(id); const iss = await startIssuers(h)
  try {
    const ep = iss.endpoints.orchestrator
    const ok = await callIssuer({ listenPath: ep.listenPath, secret: iss.secrets.orchestrator, op: 'issue_test_results', params: { task_id: id, run_id: run.run_id } }); assert.ok(ok.ok); assert.equal(ok.envelope.payload.evidence_type, 'test_results')
    await assert.rejects(callIssuer({ listenPath: ep.listenPath, secret: randomBytes(32), op: 'issue_test_results', params: { task_id: id, run_id: run.run_id } }), /IPC\.SERVER_NOT_AUTHENTICATED/)
    await assert.rejects(callIssuer({ listenPath: ep.listenPath, secret: iss.secrets.independent_reviewer, op: 'status' }), /IPC\.SERVER_NOT_AUTHENTICATED/, 'another role\'s secret does not authenticate')
    assert.equal((await callIssuer({ listenPath: ep.listenPath, secret: iss.secrets.orchestrator, op: 'sign_anything', params: { payload: {} } })).code, 'ISSUER.OPERATION_NOT_PERMITTED_FOR_IDENTITY')
    // replay: a MAC captured on one connection is useless on another (fresh challenge per connection)
    const captured = await new Promise((resolve) => { const s = net.connect(ep.listenPath); s.setEncoding('utf8'); let buf = ''; s.on('data', (d) => { buf += d; const m = JSON.parse(buf.split('\n')[0]); import('node:crypto').then(({ createHmac }) => { const req = { op: 'status', params: {} }; resolve({ ...req, mac: createHmac('sha256', iss.secrets.orchestrator).update(`${m.challenge}\n{"op":"status","params":{}}`).digest('hex') }); s.destroy() }) }) })
    const replay = await new Promise((resolve) => { const s = net.connect(ep.listenPath); s.setEncoding('utf8'); let buf = ''; s.on('data', (d) => { buf += d; const lines = buf.split('\n'); if (lines.length > 1 && lines[0].includes('challenge') && !buf.includes('"ok"')) s.write(`${JSON.stringify(captured)}\n`); if (buf.includes('"ok"')) { resolve(JSON.parse(lines.find((l) => l.includes('"ok"')))); s.destroy() } }) }); assert.equal(replay.code, 'IPC.AUTH_FAILED')
    const raw = (frame) => new Promise((resolve) => { const s = net.connect(ep.listenPath); s.setEncoding('utf8'); let buf = ''; let sent = false; s.on('data', (d) => { buf += d; if (!sent) { sent = true; s.write(frame); return } if (buf.includes('"ok"')) { resolve(JSON.parse(buf.split('\n').find((l) => l.includes('"ok"')))); s.destroy() } }); s.on('error', () => resolve({ code: 'SOCKET_ERROR' })); s.on('close', () => resolve({ code: 'CLOSED' })) })
    assert.equal((await raw('not json\n')).code, 'IPC.MALFORMED'); assert.equal((await raw(`${JSON.stringify({ op: 'status', mac: 'x', extra: 1 })}\n`)).code, 'IPC.MALFORMED'); assert.equal((await raw(`${JSON.stringify({ op: 'BAD OP!', mac: 'x' })}\n`)).code, 'IPC.MALFORMED')
    assert.equal((await raw(`${'x'.repeat(70_000)}\n`)).code, 'IPC.FRAME_TOO_LARGE')
    const client = createIssuerClient({ orchestrator: ep }); assert.ok((await client.testResults(id, run.run_id)).duplicate, 'idempotent through the real process boundary')
    assert.equal((await createIssuerClient({ orchestrator: { listenPath: ep.listenPath, secretFile: iss.endpoints.independent_reviewer.secretFile } }).testResults(id, run.run_id)).code, 'CLIENT.ISSUER_UNREACHABLE')
    assert.equal((await createIssuerClient({}).testResults(id, run.run_id)).code, 'CLIENT.UNKNOWN_ROLE_OR_OPERATION'); assert.equal((await createIssuerClient({ orchestrator: { listenPath: ipcPath('d34-nobody', h.dirs.root), secretFile: ep.secretFile } }).testResults(id, run.run_id)).code, 'CLIENT.ISSUER_UNREACHABLE')
  } finally { iss.stop(); h.close() }
})

test('the issuer process refuses to start with a policy that does not match its out-of-band pin, and cannot write the controller ledger', async () => {
  const { h } = await runUntil('after_test_run_recorded'); writeFileSync(path.join(h.dirs.root, 'bundle.json'), JSON.stringify(h.pol.bundle)); writeFileSync(path.join(h.dirs.root, 's.secret'), randomBytes(32))
  const cfg = { identity: 'orchestrator', key_id: h.pol.keyIds.orchestrator, key_dir: h.dirs.keys, ledger_file: h.dirs.ledger, store_file: path.join(h.dirs.issuer, 'x.sqlite'), policy_bundle_file: path.join(h.dirs.root, 'bundle.json'), policy_pin: 'f'.repeat(64), ipc_path: ipcPath('d34-pin', h.dirs.root), ipc_secret_file: path.join(h.dirs.root, 's.secret'), allow_test_keys: true, facts_module: path.join(ORCH, 'sim', 'facts-sim.mjs'), sim_world_dir: h.dirs.world }
  writeFileSync(path.join(h.dirs.root, 'c.json'), JSON.stringify(cfg)); const r = spawnSync(process.execPath, [path.join(ORCH, 'issuer', 'issuer-main.mjs'), path.join(h.dirs.root, 'c.json')], { encoding: 'utf8', timeout: 20000 })
  assert.equal(r.status, 2); assert.match(r.stderr, /ISSUER\.POLICY_REJECTED:POLICY\.REVISION_MISMATCH/)
  const rel = spawnSync(process.execPath, [path.join(ORCH, 'issuer', 'issuer-main.mjs'), path.join(h.dirs.root, 'c.json'), 'extra'], { encoding: 'utf8', timeout: 20000 }); assert.equal(rel.status, 2); assert.match(rel.stderr, /ISSUER\.USAGE/)
  h.close()
})

// ------------------------------------------------------------------ hardened git
const gitOf = () => { const g = resolveGit({ candidates: DEFAULT_GIT_CANDIDATES.concat(['/usr/bin/git']) }); assert.ok(g.ok, 'a trusted git is installed on the test host'); return g.exe }
function makeRepo() {
  const dir = tmp(); const git = gitOf(); const g = (...a) => { const r = spawnSync(git, ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' }); assert.equal(r.status, 0, `${a.join(' ')}: ${r.stderr}`); return r.stdout.trim() }
  g('init', '-q'); writeFileSync(path.join(dir, 'a.txt'), 'one\n'); g('add', '.'); g('commit', '-qm', 'base'); const base = g('rev-parse', 'HEAD')
  writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\n'); writeFileSync(path.join(dir, 'b.bin'), Buffer.from([0, 1, 2, 3])); g('add', '.'); g('commit', '-qm', 'cand'); return { dir, git, g, base, cand: g('rev-parse', 'HEAD') }
}

test('hardened git: absolute allow-listed executable (never PATH/cwd), digest pin, minimal environment; the issuer facts equal the legacy derivation', () => {
  const git = gitOf(); assert.ok(path.isAbsolute(git)); assert.equal(resolveGit({ candidates: ['git'] }).code, 'GIT.NO_TRUSTED_EXECUTABLE'); assert.equal(resolveGit({ candidates: [] }).code, 'GIT.NO_TRUSTED_EXECUTABLE')
  assert.equal(resolveGit({ candidates: [git], pinSha256: '0'.repeat(64) }).code, 'GIT.EXECUTABLE_DIGEST_MISMATCH'); const ok = resolveGit({ candidates: [git] }); assert.equal(resolveGit({ candidates: [git], pinSha256: ok.sha256 }).ok, true)
  assert.equal(resolveGit({ candidates: [git], forbiddenRoots: [path.dirname(git)] }).code, 'GIT.EXECUTABLE_INSIDE_FORBIDDEN_ROOT')
  const env = minimalEnv(git); for (const k of ['HOME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'PATH']) assert.ok(k in env); for (const k of Object.keys(env)) assert.ok(!/TOKEN|SECRET|KEY|PROXY|EDITOR|SSH|ASKPASS/i.test(k), k); assert.equal(env.PATH, path.dirname(git))
  const r = makeRepo(); const f = createGitFacts({ verifier_repo_dir: r.dir, git_candidates: [r.git] }).candidate({ base_sha: r.base, candidate_sha: r.cand })
  const legacy = gatherCandidateFacts({ repoDir: r.dir, expectedRepository: 'henilllpatelll/PatelRep', baseSha: r.base, candidateSha: r.cand, contract: loadContractFile() })
  assert.ok(f.ok && legacy.ok); assert.equal(f.tree_digest, legacy.facts.tree_digest); assert.equal(f.patch_digest, legacy.facts.patch_digest)
  assert.equal(createGitFacts({ verifier_repo_dir: r.dir, git_candidates: [r.git] }).candidate({ base_sha: r.cand, candidate_sha: r.base }).code, 'FACTS.BASE_NOT_ANCESTOR'); assert.equal(createGitFacts({ verifier_repo_dir: r.dir, git_candidates: [r.git] }).candidate({ base_sha: 'f'.repeat(40), candidate_sha: r.cand }).code, 'FACTS.COMMIT_UNRESOLVED')
  assert.equal(createGitFacts({ verifier_repo_dir: r.dir, git_candidates: [] }).candidate({ base_sha: r.base, candidate_sha: r.cand }).code, 'GIT.NO_TRUSTED_EXECUTABLE')
})

test('hostile REPOSITORY configuration cannot execute code through the hardened runner (canary files stay absent)', () => {
  const r = makeRepo(); const canary = (n) => path.join(r.dir, `..`, `canary-${n}-${randomBytes(3).toString('hex')}.txt`)
  const names = ['hook', 'fsmonitor', 'external', 'textconv', 'pager', 'ssh', 'askpass', 'filter'].map((n) => [n, canary(n)])
  const touch = (f) => (process.platform === 'win32' ? `cmd /c echo x > "${f}"` : `sh -c 'echo x > "${f}"'`); const cmds = Object.fromEntries(names.map(([n, f]) => [n, touch(f).replace(/\\/g, '/')]))
  const hookDir = path.join(r.dir, 'evil-hooks'); mkdirSync(hookDir); for (const h of ['pre-commit', 'post-checkout', 'reference-transaction']) writeFileSync(path.join(hookDir, h), `#!/bin/sh\n${cmds.hook}\n`)
  r.g('config', 'core.hooksPath', hookDir); r.g('config', 'core.fsmonitor', cmds.fsmonitor); r.g('config', 'diff.external', cmds.external); r.g('config', 'core.pager', cmds.pager); r.g('config', 'core.sshCommand', cmds.ssh); r.g('config', 'core.askPass', cmds.askpass)
  r.g('config', 'diff.evil.textconv', cmds.textconv); r.g('config', 'filter.evil.smudge', cmds.filter); r.g('config', 'filter.evil.clean', cmds.filter); writeFileSync(path.join(r.dir, '.gitattributes'), '*.txt diff=evil filter=evil\n*.bin diff=evil\n')
  const f = createGitFacts({ verifier_repo_dir: r.dir, git_candidates: [r.git] }).candidate({ base_sha: r.base, candidate_sha: r.cand }); assert.ok(f.ok, JSON.stringify(f))
  for (const [n, file] of names) assert.equal(existsSync(file), false, `hostile ${n} configuration executed code`)
  assert.throws(() => trustedGit(r.git, r.dir, ['definitely-not-a-git-command']), /GIT\.COMMAND_FAILED/)
})

test('a git.exe planted in the working directory is never run: the runner takes an absolute path and refuses an executable inside the cwd', () => {
  const planted = tmp(); const exe = path.join(planted, process.platform === 'win32' ? 'git.exe' : 'git'); copyFileSync(process.execPath, exe)
  const cwd = process.cwd(); process.chdir(planted)
  try { assert.equal(resolveGit({ candidates: [exe] }).code, 'GIT.EXECUTABLE_INSIDE_FORBIDDEN_ROOT'); assert.equal(resolveGit({ candidates: [path.relative(planted, exe)] }).code, 'GIT.NO_TRUSTED_EXECUTABLE', 'a relative candidate is never accepted') } finally { process.chdir(cwd) }
  assert.ok(resolveGit().ok)
})

test('policy loading for issuers: a bundle whose revision does not match the pin is rejected (the pin comes from outside the candidate environment)', () => {
  const h = createHarness({ root: tmp() }); assert.equal(loadPolicy(h.pol.bundle, 'f'.repeat(64)).problems[0], 'POLICY.REVISION_MISMATCH'); assert.ok(loadPolicy(h.pol.bundle, policyRevision(h.pol.bundle)).ok); h.close(); void pathToFileURL
})

// ---------------------------------------------------------------- security-review regressions
test('a server that cannot prove it knows the secret (a pipe squatter) is a TRANSPORT failure, not a verdict; a connection flood cannot crash an issuer', async () => {
  const { h, id } = await runUntil('after_test_run_recorded'); const run = h.ledger.latestTestRun(id); const iss = await startIssuers(h)
  try {
    const sq = path.join(h.dirs.root, 'squat'); const lp = ipcPath('d34-squat', h.dirs.root)
    const server = net.createServer((s) => { s.write('{"challenge":"abc"}\n'); s.on('data', () => { s.end(JSON.stringify({ ok: false, code: 'ISSUER.CONTEXT_NOT_INDEPENDENT', rmac: 'f'.repeat(64) }) + '\n') }) }); await new Promise((r) => server.listen(lp, r))
    await assert.rejects(callIssuer({ listenPath: lp, secret: iss.secrets.orchestrator, op: 'status' }), /IPC\.SERVER_NOT_AUTHENTICATED/); server.close(); void sq
    const ep = iss.endpoints.orchestrator; const held = []
    for (let i = 0; i < 12; i += 1) held.push(net.connect(ep.listenPath).on('error', () => {}))
    await new Promise((r) => setTimeout(r, 150)); for (let i = 0; i < 40; i += 1) net.connect(ep.listenPath).on('error', () => {}).destroy()
    await new Promise((r) => setTimeout(r, 200)); held.forEach((s) => s.destroy()); await new Promise((r) => setTimeout(r, 200))
    assert.ok((await callIssuer({ listenPath: ep.listenPath, secret: iss.secrets.orchestrator, op: 'status' })).ok, 'the issuer survived the flood')
  } finally { iss.stop(); h.close() }
})

test('routing denylist hardening: bypass spellings, case, permission modes and account/model env variables are refused', async () => {
  const { checkInvocationSafety } = await import('../orchestrator/routing.mjs')
  for (const argv of [['--permission-mode', 'bypassPermissions'], ['--allow-dangerously-skip-permissions'], ['--FALLBACK-MODEL=haiku'], ['--dangerously-skip-permissions']]) assert.ok(checkInvocationSafety({ argv }).length > 0, argv.join(' '))
  assert.deepEqual(checkInvocationSafety({ argv: ['--permission-mode', 'dontAsk'] }), [])
  for (const e of ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'CLAUDE_CONFIG_DIR']) assert.ok(checkInvocationSafety({ argv: [], envNames: [e] }).length > 0, e)
})

test('a test-keyed issuer refuses to start without the explicit test flag; the gate register entries cannot be mutated; a replaced git binary is detected', async () => {
  const h = createHarness({ root: tmp() }); writeFileSync(path.join(h.dirs.root, 'bundle.json'), JSON.stringify(h.pol.bundle)); writeFileSync(path.join(h.dirs.root, 's.secret'), randomBytes(32))
  const cfg = { identity: 'orchestrator', key_id: h.pol.keyIds.orchestrator, key_dir: h.dirs.keys, ledger_file: h.dirs.ledger, store_file: path.join(h.dirs.issuer, 'y.sqlite'), policy_bundle_file: path.join(h.dirs.root, 'bundle.json'), policy_pin: h.pol.revision, ipc_path: ipcPath('d34-tk', h.dirs.root), ipc_secret_file: path.join(h.dirs.root, 's.secret'), facts_module: path.join(ORCH, 'sim', 'facts-sim.mjs'), sim_world_dir: h.dirs.world }
  writeFileSync(path.join(h.dirs.root, 'tk.json'), JSON.stringify(cfg)); const r = spawnSync(process.execPath, [path.join(ORCH, 'issuer', 'issuer-main.mjs'), path.join(h.dirs.root, 'tk.json')], { encoding: 'utf8', timeout: 20000 }); assert.equal(r.status, 2); assert.match(r.stderr, /ISSUER\.TEST_KEY_REFUSED/); h.close()
  const { GATES, liveExecutionAllowed } = await import('../orchestrator/activation-gates.mjs'); assert.throws(() => { 'use strict'; GATES[0].status = 'closed' }, TypeError); assert.equal(liveExecutionAllowed().allowed, false)
  const g = gitOf(); const res = resolveGit({ candidates: [g] }); assert.ok(res.ok)
  assert.throws(() => trustedGit(g, process.cwd(), ['--version'], { expectSha256: '0'.repeat(64) }), /EXECUTABLE_CHANGED_AFTER_RESOLUTION/); assert.ok(trustedGit(g, process.cwd(), ['--version'], { expectSha256: res.sha256 }).length > 0)
})
