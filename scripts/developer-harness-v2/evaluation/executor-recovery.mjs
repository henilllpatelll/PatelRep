// Developer Harness V2 — Phase 7 disposable-repository scenarios (B-11 interruption, B-12 stale head).
//
// Drives the REAL Phase 5 recovery code against git repositories that THIS module creates under the OS temp directory and
// removes afterwards. It never touches the developer's worktree, any remote, or any credential. Only `git` is spawned, with an
// argument array (no shell) and a scrubbed environment.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { saveCheckpoint, storePaths } from '../coordination/checkpoint.mjs'
import { ApprovalLedger } from '../coordination/evidence.mjs'
import { buildHandoff, recordEvidence, updateHandoff } from '../coordination/handoff.mjs'
import { OUTCOMES, gatherFacts, resumeFromDisk } from '../coordination/resume.mjs'
import { applyTransition, createRecord, requestAction } from '../coordination/states.mjs'

const PREFIX = 'dhv2-p7-'
const SIDE_EFFECT_KEYS = { push: 'push', open_draft_pr: 'open_draft_pr', comment_on_pr: 'comment_on_pr' }
const created = new Set()
const gitEnv = () => ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))), GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' })
// A developer's global git config must not run code inside the benchmark repository (hooks, templates, fsmonitor).
const SAFE_CFG = ['-c', 'core.hooksPath=.git/dhv2-no-hooks', '-c', 'init.templateDir=', '-c', 'core.fsmonitor=false']
const G = (root, ...a) => execFileSync('git', ['-C', root, ...SAFE_CFG, '-c', 'user.name=bench', '-c', 'user.email=bench@example.invalid', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: gitEnv(), timeout: 30000 }).trim()

export const gitAvailable = () => { try { execFileSync('git', ['--version'], { stdio: 'ignore', env: gitEnv(), timeout: 10000 }); return true } catch { return false } }

/** Remove ONLY directories this module created (tracked, inside the OS temp dir, with our prefix). Existing work is never touched. */
export function cleanupOwned() {
  for (const d of [...created]) {
    try {
      const real = realpathSync(d)
      if (path.basename(real).startsWith(PREFIX) && path.dirname(real) === realpathSync(os.tmpdir())) rmSync(real, { recursive: true, force: true })
    } catch { /* already gone */ }
    created.delete(d)
  }
}

function mkEnv(id) {
  const root = mkdtempSync(path.join(os.tmpdir(), PREFIX))
  created.add(root)
  G(root, 'init', '-q', '-b', 'main')
  writeFileSync(path.join(root, '.gitignore'), '.wolf/runtime-logs/\n')
  mkdirSync(path.join(root, 'apps/web/lib'), { recursive: true })
  writeFileSync(path.join(root, 'apps/web/lib/footer.ts'), 'export const a = 1\n')
  G(root, 'add', '-A'); G(root, 'commit', '-q', '-m', 'base')
  const base = G(root, 'rev-parse', 'HEAD')
  G(root, 'checkout', '-q', '-b', 'task/one')
  const env = { root, base, id, n: 0, rev: 0, ledger: new ApprovalLedger(), remote: null }
  env.facts = () => gatherFacts(root, { baseSha: base, recordedHead: env.rec?.repo.head_sha })
  const files = ['apps/web/lib/footer.ts']
  env.rec = createRecord({ task_id: id, input: { task: 'Fix typo in the web footer label', files, modification: 'edit', authorize: ['push', 'open_draft_pr'].map((a) => SIDE_EFFECT_KEYS[a]) }, base_sha: base, facts: env.facts() })
  return env
}
const commit = (env, text) => { writeFileSync(path.join(env.root, 'apps/web/lib/footer.ts'), text); G(env.root, 'add', '-A'); G(env.root, 'commit', '-q', '-m', 'work'); return G(env.root, 'rev-parse', 'HEAD') }
const must = (r, what) => { if (!r.ok) throw new Error(`${what}: ${(r.codes ?? []).join(',')}`); return r }
const T = (env, to, extra = {}) => { const r = applyTransition(env.rec, to, { facts: env.facts(), remote: env.remote, ledger: env.ledger, event_id: `ev-${++env.n}`, reason_code: 'BENCH', ...extra }); if (r.ok || extra.keep) env.rec = r.record; return r }
function role(env, r) {
  const b = must(buildHandoff(env.rec, r, { facts: env.facts() }), `handoff ${r}`)
  env.rec = b.record
  for (const s of ['active', 'completed']) { const u = must(updateHandoff(env.rec, b.handoff.id, s, new Date().toISOString()), `handoff ${r} ${s}`); env.rec = u.record }
}
const evid = (env, kind, by) => { const r = must(recordEvidence(env.rec, { kind, by, result: 'pass', summary: 'fixture evidence' }, env.facts()), `evidence ${kind}`); env.rec = r.record }
const persist = (env) => { env.rec = { ...env.rec, revision: env.rev + 1 }; must(saveCheckpoint(env.root, env.rec), 'save'); env.rev += 1 }
const check = (id, ok, observed, expected) => ({ id, ok: Boolean(ok), observed, expected })

/** B-11: persist a mid-task checkpoint, discard all in-memory state ("kill"), then recover from disk only. */
export function runInterruption() {
  const env = mkEnv('bench-b11')
  must(T(env, 'planned'), 'planned'); must(T(env, 'implementing'), 'implementing'); role(env, 'implementer')
  commit(env, 'export const a = 2\n'); must(T(env, 'testing'), 'testing'); evid(env, 'local_tests', 'test_coordinator'); persist(env)
  const file = storePaths(env.root, env.id).file
  const headBefore = G(env.root, 'rev-parse', 'HEAD')
  const countBefore = Number(G(env.root, 'rev-list', '--count', 'HEAD'))
  const fileBefore = readFileSync(file, 'utf8')
  env.rec = null; env.ledger = null // simulated termination: nothing survives except the disposable repo and its checkpoint file
  const r = resumeFromDisk(env.root, env.id)
  const headAfter = G(env.root, 'rev-parse', 'HEAD')
  const countAfter = Number(G(env.root, 'rev-list', '--count', 'HEAD'))
  const out = [
    check('resume_permitted_after_verification', r.outcome === OUTCOMES.PERMITTED, `${r.outcome} ${(r.codes ?? []).join(',')}`, OUTCOMES.PERMITTED),
    check('no_duplicate_commits', countBefore === countAfter, `${countBefore} -> ${countAfter}`, 'commit count unchanged by resume'),
    check('head_unchanged_by_resume', headBefore === headAfter && readFileSync(file, 'utf8') === fileBefore, `${headBefore.slice(0, 8)} -> ${headAfter.slice(0, 8)}`, 'resume is read-only: HEAD and checkpoint untouched'),
  ]
  // A corrupt checkpoint can never certify recovery.
  const j = JSON.parse(fileBefore); j.state = 'reviewing'
  writeFileSync(file, JSON.stringify(j, null, 2))
  const bad = resumeFromDisk(env.root, env.id)
  out.push(check('corrupt_checkpoint_cannot_certify', bad.outcome === OUTCOMES.INVALID, bad.outcome, OUTCOMES.INVALID))
  writeFileSync(file, fileBefore)
  // Identity revalidation: a different branch is never silently resumed.
  G(env.root, 'checkout', '-q', '-b', 'other')
  const moved = resumeFromDisk(env.root, env.id)
  out.push(check('branch_change_blocks_resume', moved.outcome === OUTCOMES.IDENTITY, moved.outcome, OUTCOMES.IDENTITY))
  return { checks: out, evidence: [{ kind: 'disposable_repo', simulated: true, note: 'Termination simulated by discarding in-memory state; the checkpoint file and git repository are real but disposable.' }] }
}

/** B-12: the head moves after review; recorded evidence and an approval given for the old head must stop counting. */
export function runStaleHead() {
  const env = mkEnv('bench-b12')
  must(T(env, 'planned'), 'planned'); must(T(env, 'implementing'), 'implementing'); role(env, 'implementer')
  commit(env, 'export const a = 3\n'); must(T(env, 'testing'), 'testing'); evid(env, 'local_tests', 'test_coordinator')
  must(T(env, 'reviewing'), 'reviewing'); role(env, 'independent_reviewer'); evid(env, 'review', 'independent_reviewer')
  const validBefore = env.rec.evidence.filter((e) => e.status === 'valid').length
  commit(env, 'export const a = 4\n') // head moves after review
  const regress = T(env, 'implementing', { keep: true })
  const invalidated = env.rec.evidence.length > 0 && env.rec.evidence.every((e) => e.status === 'invalidated' && e.invalidated?.code === 'EVIDENCE.HEAD_CHANGED')
  must(T(env, 'testing'), 'testing again')
  const forward = T(env, 'reviewing')
  const out = [
    check('evidence_invalidated_on_head_change', validBefore >= 2 && invalidated, `${validBefore} valid before; all invalidated=${invalidated}`, 'every recorded evidence item is invalidated by EVIDENCE.HEAD_CHANGED'),
    check('state_regressed', regress.ok === false && regress.codes.includes('TRANSITION.STATE_REGRESSED') && env.rec.state === 'testing', `${regress.codes.join(',')} state=${env.rec.state}`, 'task regressed out of the reviewed state'),
    check('old_evidence_cannot_advance', forward.ok === false && forward.codes.includes('EVIDENCE.LOCAL_TESTS_MISSING_OR_STALE'), (forward.codes ?? []).join(','), 'cannot re-enter review on stale evidence'),
  ]
  // Approval given for head A is rejected at head B, with no side effect.
  const e2 = mkEnv('bench-b12b')
  must(T(e2, 'planned'), 'planned'); must(T(e2, 'implementing'), 'implementing'); role(e2, 'implementer')
  commit(e2, 'export const a = 5\n'); must(T(e2, 'testing'), 'testing'); evid(e2, 'local_tests', 'test_coordinator'); must(T(e2, 'reviewing'), 'reviewing')
  const shaA = e2.facts().head_sha
  e2.ledger.grant({ action: 'push_dedicated_branch_fast_forward', target: 'task/one', task_id: e2.id, head_sha: shaA })
  commit(e2, 'export const a = 6\n')
  let ran = 0
  const r = requestAction(e2.rec, { action: 'push_dedicated_branch_fast_forward', target: 'task/one' }, { facts: e2.facts(), ledger: e2.ledger }, () => { ran++ })
  out.push(check('stale_approval_rejected', r.allowed === false && r.code === 'APPROVAL.STALE_SHA' && ran === 0, `${r.code} ran=${ran}`, 'APPROVAL.STALE_SHA and the side effect never ran'))
  return { checks: out, evidence: [{ kind: 'disposable_repo', simulated: true, note: 'Evidence items are created by harness fixtures, not by a real reviewer.' }] }
}


