// D3.2 — regression tests for the independent code review's findings (each test names the finding it pins).
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { loadContractFile, validateContract } from '../authority/contract.mjs'
import { EvidenceLedger } from '../authority/evidence.mjs'
import { evaluate } from '../authority/evaluator.mjs'
import { gatherCandidateFacts } from '../authority/git-facts.mjs'
import { applyEvent, createTask, loadLifecycle } from '../lifecycle/lifecycle.mjs'
import { admitTask } from '../lifecycle/resource-admission.mjs'
import { normalizeRepoPath } from '../lib/paths.mjs'
import { digestOf } from '../lib/canonical.mjs'
import { HEAD, NOW, buildPolicy, candidate, evidence, makeKeys, request, trustedFor } from './helpers.mjs'

const KEYS = makeKeys()
const ACTIVE = buildPolicy({ keys: KEYS, activate: ['publish_candidate_branch', 'merge_pull_request', 'start_bypass_permissions_session'] })
const ev = (type, o = {}, p = ACTIVE) => evidence(type, { policy: p.policy, keys: KEYS, ...o })
const run = (p, req, trusted, evd = [], extra = {}) => evaluate({ policy: p.policy, request: req, trusted, evidence: evd, now: NOW, ledger: new EvidenceLedger(), ...extra })
const codes = (d) => d.reason_codes
const ta = (t, p = ACTIVE) => ev('task_authority', { over: { authority_digest: digestOf(t.task.authority) } }, p)

const controlPlane = () => {
  const t = trustedFor('trusted_publisher', { candidate: candidate({ changes: [{ status: 'M', path: '.github/workflows/ci.yml' }] }) })
  Object.assign(t.task.authority, { allowed_paths: ['.github/**'], control_plane_authorized: true, protected_paths_authorized: true })
  return t
}

test('review #1: review independence cannot be shown without a known author context, so it fails closed', () => {
  const t = controlPlane(); delete t.task.author_context_id
  const d = run(ACTIVE, request('publish_candidate_branch'), t, [ta(t), ev('test_results'), ev('independent_review', { over: { context_id: 'ctx-author' } }), ev('security_review')])
  assert.equal(d.decision, 'deny')
  assert.ok(d.rejected_evidence.some((r) => r.codes.includes('EVIDENCE.AUTHOR_CONTEXT_UNKNOWN')))
})

test('review #2: a reordered check list cannot make scope pass vacuously, and the validator forbids scope without path_validity', () => {
  const reordered = buildPolicy({ keys: KEYS, mutate: (c) => { c.actions.edit_files_in_task_worktree.checks = ['scope', 'path_validity'] } })
  const d = run(reordered, request('edit_files_in_task_worktree', { params: { paths: ['apps/web/x.tsx'] } }), trustedFor('implementer'))
  assert.ok(codes(d).includes('SCOPE.OUT_OF_SCOPE'))
  const c = structuredClone(loadContractFile()); c.actions.edit_files_in_task_worktree.checks = ['scope']
  assert.ok(validateContract(c).some((p) => p.includes('scope requires path_validity')))
})

test('review #3: accept_evidence demands a replay ledger', () => {
  const e = ev('delivery_verification')
  const d = evaluate({ policy: ACTIVE.policy, request: request('accept_evidence'), trusted: trustedFor('orchestrator'), evidence: [e], now: NOW })
  assert.ok(codes(d).includes('LEDGER.REQUIRED'))
  const ledger = new EvidenceLedger(); ledger.consume(e.payload.evidence_id)
  const replay = run(ACTIVE, request('accept_evidence'), trustedFor('orchestrator'), [e], { ledger })
  assert.equal(replay.decision, 'deny')
  assert.ok(replay.rejected_evidence.some((r) => r.codes.includes('EVIDENCE.REPLAYED')))
})

test('review #20: consumeAll is all-or-nothing, so two concurrent allows cannot both consume the same single-use evidence', () => {
  const l = new EvidenceLedger()
  assert.equal(l.consumeAll(['a', 'b']), true)
  assert.equal(l.consumeAll(['b', 'c']), false)
  assert.equal(l.isConsumed('c'), false, 'a failed batch consumes nothing')
})

test('review #4: resource ownership is read from the controller registry; a requester naming or describing a resource gains nothing', () => {
  const t = trustedFor('orchestrator'); delete t.resources
  assert.ok(codes(run(ACTIVE, request('cleanup_task_owned_resources', { params: { resource_id: 'res-own-stale' } }), t)).includes('RESOURCE.UNKNOWN'))
  const bad = trustedFor('orchestrator', { resources: { r: { owner_task_id: 'task-1', kind: 'rocket', lifecycle: 'stale' } } })
  assert.deepEqual(codes(run(ACTIVE, request('cleanup_task_owned_resources', { params: { resource_id: 'r' } }), bad)), ['INPUT.MALFORMED:resources'])
})

test('review #6: launches are checked for credential-shaped names, including the exported Claude token', () => {
  const launch = (names) => run(ACTIVE, request('launch_claude_session'), trustedFor('orchestrator', { launch: { env_names: names, settings: {},
    auth: { verified: true, verified_by: 'launcher', source: 'claude_subscription_oauth', plan: 'pro', paid_usage_enabled: false } } }))
  assert.equal(launch(['PATH', 'HOME']).decision, 'allow')
  for (const n of ['CLAUDE_CODE_OAUTH_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY', 'GITHUB_TOKEN', 'RAILWAY_TOKEN']) {
    const d = launch(['PATH', n])
    assert.equal(d.decision, 'deny', n)
    assert.ok(codes(d).some((c) => c.startsWith('CREDENTIAL.IN_WORKER_ENV') || c.startsWith('AUTH.FORBIDDEN_ENVIRONMENT')), n)
  }
})

test('review #8 and #17: incomplete, unverified-origin or symlink/gitlink facts are refused', () => {
  const t = (over) => trustedFor('implementer', { candidate: candidate(over) })
  const read = (tt) => run(ACTIVE, request('read_repository'), tt)
  assert.equal(read(t({})).decision, 'allow')
  assert.ok(codes(read(t({ problems: ['FACTS.TRIPWIRE_LINES_TRUNCATED'] }))).includes('FACTS.INCOMPLETE'))
  assert.ok(codes(read(t({ origin_matches: null }))).includes('FACTS.ORIGIN_UNVERIFIED'))
  assert.ok(codes(read(t({ origin_matches: false }))).includes('FACTS.ORIGIN_UNVERIFIED'))
  assert.ok(codes(read(t({ special_modes: ['apps/mobile/link'] }))).includes('PATH.SPECIAL_FILE_MODE'))
  assert.deepEqual(codes(read(trustedFor('implementer', { candidate: { ...candidate(), special_modes: undefined } }))), ['INPUT.MALFORMED:candidate'])
})

test('review #14: a new migration is only accepted against the CURRENT target tip', () => {
  const mk = (tip) => { const t = trustedFor('trusted_publisher', { candidate: candidate({ changes: [{ status: 'A', path: 'supabase/migrations/263_x.sql' }] }), target_tip_sha: tip }); t.task.authority.migrations_authorized = true; return t }
  const full = (t) => [ta(t), ev('test_results'), ev('independent_review'), ev('security_review')]
  assert.equal(run(ACTIVE, request('publish_candidate_branch'), mk(trustedFor('x').target_tip_sha), full(mk(trustedFor('x').target_tip_sha))).decision, 'allow')
  const stale = mk('a'.repeat(40))
  assert.ok(codes(run(ACTIVE, request('publish_candidate_branch'), stale, full(stale))).includes('MIGRATION.BASE_NOT_CURRENT'))
  const none = mk(undefined); delete none.target_tip_sha
  assert.ok(codes(run(ACTIVE, request('publish_candidate_branch'), none, full(none))).includes('MIGRATION.BASE_NOT_CURRENT'), 'no target tip fact means no decision')
})

test('review #17: dependency, lockfile, submodule, Docker and env files are protected; Windows device names are rejected', () => {
  for (const p of ['apps/mobile/package.json', 'package-lock.json', '.gitmodules', 'apps/api/Dockerfile', 'apps/api/.env.production', 'apps/web/.npmrc', 'vercel.json']) {
    const t = trustedFor('trusted_publisher', { candidate: candidate({ changes: [{ status: 'M', path: p }] }) }); t.task.authority.allowed_paths = ['**']
    assert.ok(codes(run(ACTIVE, request('publish_candidate_branch'), t, [ta(t), ev('test_results')])).includes('PROTECTED_PATH.NOT_AUTHORIZED_BY_TASK'), p)
  }
  for (const p of ['apps/CON', 'apps/aux.txt', 'apps/NUL.sql', 'apps/com1', 'apps/LPT9.ts']) assert.equal(normalizeRepoPath(p).ok, false, p)
  assert.equal(normalizeRepoPath('apps/console.ts').ok, true)
})

test('review #12 and #18: validateContract checks the sections the evaluator dereferences and uses own-property lookups', () => {
  const bad = {
    'tripwire not a regex': (c) => { c.customer_agent.tripwire_all = ['(['] },
    'tripwire missing': (c) => { delete c.customer_agent.tripwire_all },
    'bad migrations dir': (c) => { c.migrations.directory = '' },
    'bad credential pattern': (c) => { c.credential_environment_patterns = ['(['] },
    'inherited evidence name': (c) => { c.actions.merge_pull_request.required_evidence = ['toString'] },
    'inherited credential evidence': (c) => { c.credential_scopes.production.required_evidence = ['constructor'] },
  }
  for (const [n, m] of Object.entries(bad)) { const c = structuredClone(loadContractFile()); m(c); assert.notDeepEqual(validateContract(c), [], n) }
  const d = run(ACTIVE, request('read_repository'), trustedFor('implementer'), [{ ...ev('test_results'), payload: { ...ev('test_results').payload, evidence_type: 'toString' } }])
  assert.equal(d.decision, 'allow', 'unused malformed evidence does not break an allowed read')
  const acc = run(ACTIVE, request('accept_evidence'), trustedFor('orchestrator'), [{ ...ev('test_results'), payload: { ...ev('test_results').payload, evidence_type: 'toString' } }])
  assert.ok(acc.rejected_evidence[0].codes.includes('EVIDENCE.UNKNOWN_TYPE'))
})

test('review #22: the customer-agent tripwire is order-insensitive and linear-time on hostile long lines', () => {
  const t = (line) => { const x = trustedFor('trusted_publisher', { candidate: candidate({ changes: [{ status: 'A', path: 'supabase/migrations/263_s.sql' }], added_lines: { 'supabase/migrations/263_s.sql': [line] } }) }); x.task.authority.migrations_authorized = true; return x }
  const hit = (line) => { const x = t(line); return codes(run(ACTIVE, request('publish_candidate_branch'), x, [ta(x), ev('test_results'), ev('independent_review'), ev('security_review')])).includes('CUSTOMER_AGENT.ACTIVATION_TRIPWIRE') }
  assert.equal(hit('UPDATE agent_settings SET execution_enabled = true;'), true)
  assert.equal(hit('INSERT INTO flags (name, enabled) VALUES (\'agent_billing\', true);'), true)
  assert.equal(hit('-- agent notes only'), false)
  const started = Date.now()
  hit(`UPDATE ${'agent_'.repeat(2000)} SET ${'x'.repeat(50000)}`)
  assert.ok(Date.now() - started < 2000, 'tripwire must not backtrack catastrophically')
})

// ───────────────────────── git facts: hunk parsing and special file modes ─────────────────────────
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' }
const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
function repo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'd32-h-'))
  git(dir, 'init', '-q', '-b', 'main'); git(dir, 'config', 'core.autocrlf', 'false'); git(dir, 'config', 'commit.gpgsign', 'false')
  mkdirSync(path.join(dir, 'supabase/migrations'), { recursive: true }); writeFileSync(path.join(dir, 'supabase/migrations/001_a.sql'), 'select 1;\n')
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'base')
  const base = git(dir, 'rev-parse', 'HEAD'); git(dir, 'checkout', '-q', '-b', 'feat')
  return { dir, base, done: () => rmSync(dir, { recursive: true, force: true }) }
}
const facts = (r, head) => gatherCandidateFacts({ repoDir: r.dir, expectedRepository: 'henilllpatelll/PatelRep', baseSha: r.base, candidateSha: head, contract: loadContractFile() })

test('review #7: an added line that itself starts with "++" is still captured for the tripwire', () => {
  const r = repo()
  try {
    writeFileSync(path.join(r.dir, 'supabase/migrations/263_x.sql'), '++UPDATE agent_execution_flags SET enabled = true;\n+++ also\nplain\n')
    git(r.dir, 'add', '-A'); git(r.dir, 'commit', '-q', '-m', 'c')
    const f = facts(r, git(r.dir, 'rev-parse', 'HEAD'))
    assert.deepEqual(f.facts.added_lines['supabase/migrations/263_x.sql'], ['++UPDATE agent_execution_flags SET enabled = true;', '+++ also', 'plain'])
  } finally { r.done() }
})

test('review #17: new symlinks and gitlinks are reported as special modes', () => {
  const r = repo()
  try {
    const blob = execFileSync('git', ['-C', r.dir, 'hash-object', '-w', '--stdin'], { input: '../../etc/passwd', env: GIT_ENV, encoding: 'utf8' }).trim()
    git(r.dir, 'update-index', '--add', '--cacheinfo', `120000,${blob},apps/link`)
    git(r.dir, 'update-index', '--add', '--cacheinfo', `160000,${HEAD},apps/sub`)
    git(r.dir, 'commit', '-q', '-m', 'special')
    const f = facts(r, git(r.dir, 'rev-parse', 'HEAD'))
    assert.deepEqual(f.facts.special_modes.sort(), ['apps/link', 'apps/sub'])
    assert.deepEqual(f.facts.changes.map((c) => c.status), ['A', 'A'])
  } finally { r.done() }
})

// ───────────────────────── lifecycle ─────────────────────────
const LC = loadLifecycle()
let n = 0
const lev = (task, over = {}) => ({ event_id: `h${++n}`, idempotency_id: `hi${n}`, task_id: task.task_id, kind: 'transition', expected_revision: task.state_revision, fencing_token: task.fencing_token, ...over })
const step = (task, to, extra = {}) => { const r = applyEvent(LC, task, lev(task, { to, ...extra })); assert.equal(r.ok, true, `${task.state} -> ${to}: ${r.problems}`); return r.task }
const walk = (task, states) => states.reduce((t, s) => step(t, s), task)
const TO_MERGED = ['queued', 'planning', 'implementing', 'testing', 'independent_review', 'publishing', 'ci_running', 'staging_verification', 'merge_eligible', 'merged']
const fresh = (over = {}) => createTask({ task_id: 'task-1', security_review_required: false, ...over })

test('review #5: head and policy changes respect the task\'s EFFECTIVE state while it waits or is blocked', () => {
  const merged = walk(fresh(), TO_MERGED)
  const waiting = step(merged, 'waiting_external', { reason_code: 'GITHUB_UNAVAILABLE' })
  assert.deepEqual(applyEvent(LC, waiting, lev(waiting, { kind: 'head_changed', head_sha: HEAD })).problems, ['EVENT.HEAD_CHANGE_AFTER_MERGE'])
  assert.deepEqual(applyEvent(LC, waiting, lev(waiting, { kind: 'policy_changed', policy_revision: 'a'.repeat(64) })).problems, ['EVENT.POLICY_CHANGE_AFTER_MERGE'])
  const ci = walk(fresh(), TO_MERGED.slice(0, 7))
  const blocked = step(ci, 'blocked', { reason_code: 'OWNER_DECISION_REQUIRED' })
  const changed = applyEvent(LC, blocked, lev(blocked, { kind: 'head_changed', head_sha: HEAD }))
  assert.equal(changed.ok, true); assert.equal(changed.task.state, 'blocked'); assert.equal(changed.task.resume_to, 'testing', 'a blocked task no longer resumes into stale verification')
  assert.ok(changed.invalidated.includes('ci_gate'))
  const early = step(walk(fresh(), ['queued', 'planning']), 'paused', { reason_code: 'OWNER_PAUSED' })
  const e = applyEvent(LC, early, lev(early, { kind: 'head_changed', head_sha: HEAD }))
  assert.equal(e.task.resume_to, 'planning', 'a task paused before verification keeps its resume point')
})

test('review #11: a policy revision change invalidates all evidence and sends a verified task back to testing', () => {
  const t = walk(fresh(), TO_MERGED.slice(0, 7))
  const r = applyEvent(LC, t, lev(t, { kind: 'policy_changed', policy_revision: 'b'.repeat(64) }))
  assert.equal(r.ok, true); assert.equal(r.task.state, 'testing'); assert.deepEqual(r.invalidated, ['*'])
  assert.equal(applyEvent(LC, r.task, lev(r.task, { kind: 'policy_changed', policy_revision: 'b'.repeat(64) })).invalidated.length, 0, 'same revision is a no-op')
  assert.deepEqual(applyEvent(LC, t, lev(t, { kind: 'policy_changed' })).problems, ['EVENT.POLICY_REVISION_REQUIRED'])
})

test('review #11: security review is mandatory or skipped according to the task, never optional', () => {
  const req = walk(createTask({ task_id: 'task-1' }), ['queued', 'planning', 'implementing', 'testing', 'independent_review'])
  assert.deepEqual(applyEvent(LC, req, lev(req, { to: 'publishing' })).problems, ['TRANSITION.SECURITY_REVIEW_REQUIRED'])
  const skip = walk(fresh(), ['queued', 'planning', 'implementing', 'testing', 'independent_review'])
  assert.deepEqual(applyEvent(LC, skip, lev(skip, { to: 'security_review' })).problems, ['TRANSITION.SECURITY_REVIEW_NOT_REQUIRED'])
})

test('review #10: a wait that began as remediation can only return to implementing, however many waiting states it passes through', () => {
  const t = walk(fresh(), ['queued', 'planning', 'implementing', 'testing'])
  const rem = step(t, 'remediation', { reason_code: 'TEST_FAILED' })
  const paused = step(rem, 'paused', { reason_code: 'OWNER_PAUSED' })
  assert.deepEqual(applyEvent(LC, paused, lev(paused, { to: 'testing' })).problems, ['TRANSITION.MUST_RESUME_TO_RECORDED_STATE'])
  assert.equal(step(paused, 'implementing').state, 'implementing')
  const early = step(walk(fresh(), ['queued', 'planning']), 'paused', { reason_code: 'OWNER_PAUSED' })
  assert.deepEqual(applyEvent(LC, early, lev(early, { to: 'production_incident', reason_code: 'WATCHDOG_ALERT' })).problems, ['TRANSITION.ILLEGAL'])
  const ms = walk(fresh(), TO_MERGED)
  const wait = step(ms, 'waiting_external', { reason_code: 'CI_PENDING' })
  assert.equal(step(wait, 'production_incident', { reason_code: 'WATCHDOG_ALERT' }).state, 'production_incident')
})

test('review #9: idempotency replays are bound to the original event, and fencing is checked first', () => {
  const t = fresh()
  const e = lev(t, { to: 'queued' })
  const first = applyEvent(LC, t, e)
  const other = { ...e, to: 'planning', expected_revision: 99 }
  assert.deepEqual(applyEvent(LC, first.task, other).problems, ['EVENT.IDEMPOTENCY_CONFLICT'])
  assert.deepEqual(applyEvent(LC, first.task, { ...e, fencing_token: 5 }).problems, ['EVENT.STALE_FENCING_TOKEN'], 'a zombie worker gets no success, not even for a replay')
  assert.equal(applyEvent(LC, first.task, e).duplicate, true)
})

test('review #23: fencing tokens advance only by worker_recovered, exactly by one', () => {
  const t = fresh()
  assert.deepEqual(applyEvent(LC, t, lev(t, { kind: 'worker_recovered', new_fencing_token: 3 })).problems, ['EVENT.FENCING_TOKEN_MUST_INCREMENT'])
  const r = applyEvent(LC, t, lev(t, { kind: 'worker_recovered', new_fencing_token: 2 }))
  assert.equal(r.ok, true); assert.equal(r.task.fencing_token, 2)
  assert.deepEqual(applyEvent(LC, r.task, lev(t, { to: 'queued', expected_revision: 1 })).problems, ['EVENT.STALE_FENCING_TOKEN'], 'the old worker is fenced out')
})

test('review #19: admission validates thresholds and metric ranges instead of admitting on undefined comparisons', () => {
  const ok = { available_mb: 9000, commit_ratio: 0.5, paging_pages_per_sec: 10, cpu_pct: 30, disk_free_gb: 300, host_responsive: true, reasoning_sessions_active: 0, heavy_test_workloads_active: 0 }
  const lowMem = { ...ok, available_mb: 100, disk_free_gb: 0.1 }
  assert.equal(admitTask(lowMem, {}, {}).decision, 'wait')
  assert.ok(admitTask(lowMem, {}, {}).reason_codes[0].startsWith('RESOURCE.THRESHOLD_INVALID'))
  for (const bad of [{ cpu_pct: 250 }, { cpu_pct: -1 }, { commit_ratio: -0.2 }, { reasoning_sessions_active: 0.5 }, { disk_free_gb: -1 }]) assert.ok(admitTask({ ...ok, ...bad }).reason_codes.includes('RESOURCE.METRIC_OUT_OF_RANGE'), JSON.stringify(bad))
  assert.equal(admitTask(ok).decision, 'admit')
})
