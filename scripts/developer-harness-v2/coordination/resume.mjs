// Developer Harness V2 — Phase 5 resume validator.
//
// The saved checkpoint is evidence of what WAS true. Every decision here is made from facts gathered NOW from git
// (read-only, no shell, no network) plus, optionally, a provider-verified GitHub snapshot. A checkpoint cannot vouch for
// itself; PR text, logs, agent messages and memory are data. Nothing in this file resets, stashes, cleans, rebases,
// force-pushes or deletes anything.
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { openBlockingFindings, isVerifiedRemote, latestPass, verifyRemoteSnapshot, classifyRecordedApproval, sha256, canonical } from './evidence.mjs'
import { loadCheckpoint } from './checkpoint.mjs'
import { ORDER, RECOVERY_ACTION, checkStateConsistency, liveGateProblems, localSupportProblems, rank, rebuildPlan, scopeDigestOf, syncWithFacts } from './states.mjs'
import { verifyDiffAgainstPlan } from '../routing/router.mjs'

export const OUTCOMES = Object.freeze({
  PERMITTED: 'RESUME_PERMITTED_AFTER_FRESH_VERIFICATION',
  READ_ONLY: 'RESUME_READ_ONLY_INSPECTION',
  INVALID: 'BLOCKED_INVALID_CHECKPOINT',
  IDENTITY: 'BLOCKED_REPOSITORY_IDENTITY_MISMATCH',
  STALE: 'BLOCKED_STALE_SHA_OR_SCOPE',
  APPROVAL: 'BLOCKED_MISSING_HUMAN_APPROVAL',
  DIRTY: 'BLOCKED_DIRTY_WORKTREE_UNRECONCILED',
  FINDING: 'BLOCKED_OPEN_BLOCKING_FINDING',
  TERMINAL: 'BLOCKED_TERMINAL_STATE',
  UNPROVEN: 'UNPROVEN_REMOTE_EVIDENCE',
})
const REMOTE_STATES = new Set(['pr_open', 'ci_running', 'staging_running', 'ready_for_human_review', 'unproven'])
const UNMERGED = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])
const MAX_UNTRACKED_HASH = 64 * 1024 * 1024 // larger untracked files are identified by size only (documented limitation)
/** `git status` must not opportunistically rewrite the index while we are only reading. */
// Inherit nothing that can redirect git (GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, ...): facts must be about `root`.
const GIT_ENV = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))), GIT_OPTIONAL_LOCKS: '0' }
const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p)

/** Read-only git facts about the CURRENT worktree. Throws on any git failure: unknown facts are never assumed. */
export function gatherFacts(root, { baseSha, recordedHead = null } = {}) {
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'core.fsmonitor=false', '-c', 'core.quotePath=false', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], env: GIT_ENV })
  const ok = (...args) => { try { execFileSync('git', ['-C', root, '-c', 'core.fsmonitor=false', ...args], { stdio: 'ignore', env: GIT_ENV }); return true } catch { return false } }
  const toplevel = realpathSync(git('rev-parse', '--show-toplevel').trim())
  const gitdir = realpathSync(git('rev-parse', '--absolute-git-dir').trim())
  const head_sha = git('rev-parse', 'HEAD').trim()
  let branch = null
  try { branch = git('symbolic-ref', '--short', '-q', 'HEAD').trim() || null } catch { /* detached */ }
  const raw = git('status', '--porcelain=v1', '-z', '--untracked-files=all').split('\0').filter(Boolean)
  const entries = []
  for (let i = 0; i < raw.length; i++) { entries.push(raw[i]); if (/^[RC]|^.[RC]/.test(raw[i])) i++ } // a rename/copy carries its origin path as a separate NUL field
  const untracked = entries.filter((e) => e.startsWith('??')).map((e) => e.slice(3)).sort()
  const dirty = entries.length > 0
  const unmerged = entries.some((e) => UNMERGED.has(e.slice(0, 2)))
  const operation_in_progress = ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG'].some((n) => existsSync(path.join(gitdir, n)))
  let tree_digest
  if (!dirty) tree_digest = sha256(canonical({ head: head_sha, clean: true, tree: git('rev-parse', 'HEAD^{tree}').trim() }))
  else {
    const files = untracked.map((f) => {
      try {
        const abs = path.join(toplevel, f); const st = lstatSync(abs)
        if (st.isSymbolicLink()) return [f, `symlink:${readlinkSync(abs)}`] // never follow: it could point at /dev/zero or a secret
        if (!st.isFile()) return [f, `special:${st.mode}`]
        if (st.size > MAX_UNTRACKED_HASH) return [f, `size:${st.size}`] // very large: size only (documented)
        return [f, sha256(readFileSync(abs).toString('latin1'))]
      } catch { return [f, 'unreadable'] }
    })
    tree_digest = sha256(canonical({ head: head_sha, status: entries.slice().sort(), diff: sha256(git('diff', 'HEAD', '--no-ext-diff', '--no-textconv', '--binary')), untracked: files }))
  }
  let changed_files = []
  let base_is_ancestor = false
  if (baseSha) {
    base_is_ancestor = ok('merge-base', '--is-ancestor', baseSha, 'HEAD')
    if (base_is_ancestor) {
      const mb = git('merge-base', baseSha, 'HEAD').trim()
      changed_files = [...new Set([...git('diff', '--name-only', '-z', '--no-renames', mb).split('\0'), ...git('ls-files', '-z', '--others', '--exclude-standard').split('\0')].filter(Boolean))].sort()
    }
  }
  let recorded_head_relation = 'unknown'
  if (recordedHead) recorded_head_relation = recordedHead === head_sha ? 'same' : !ok('cat-file', '-e', `${recordedHead}^{commit}`) ? 'unknown_object' : ok('merge-base', '--is-ancestor', recordedHead, 'HEAD') ? 'ancestor' : 'unrelated'
  return {
    toplevel, worktree_id: sha256(`${fold(toplevel)}|${fold(gitdir)}`), branch, head_sha, dirty, unmerged, operation_in_progress, tree_digest,
    base_is_ancestor, changed_files, scope_digest: scopeDigestOf(changed_files), recorded_head_relation,
  }
}

/** Ask a provider (a function the CALLER supplies) for GitHub state. Anything but a well-formed snapshot is "unavailable". */
export function collectRemote(provider) {
  if (typeof provider !== 'function') return null
  try { return verifyRemoteSnapshot(provider()) } catch { return null }
}

const result = (outcome, codes, extra = {}) => ({ outcome, codes: [...new Set(codes)], mode: [OUTCOMES.PERMITTED].includes(outcome) ? 'full' : 'read_only', ...extra })

/**
 * Deterministic resume decision. `record` must already have passed checkpoint validation. `remote` is a verified snapshot or null.
 * Never mutates anything; `projected_record` shows what the state would become and must be persisted by an explicit CLI mutation.
 */
export function evaluateResume(record, facts, remote = null, now = new Date().toISOString()) {
  const base = { task_id: record.task_id, recorded_state: record.state, remote: isVerifiedRemote(remote) ? 'provider_verified' : 'unproven', fresh_authorizations_required: [], unusable_approvals: [], invalidations: [], preserve_worktree: facts.dirty }
  const done = (outcome, codes, extra = {}) => ({ ...base, ...result(outcome, codes, extra) })

  const consistency = checkStateConsistency(record)
  if (consistency.length) return done(OUTCOMES.INVALID, consistency, { legal_recovery_action: 'Do not repair or reconstruct. Return the checkpoint to the human.' })
  base.unusable_approvals = record.approvals.map((a) => classifyRecordedApproval(a, record, facts))
  if (record.state === 'blocked') return done(OUTCOMES.TERMINAL, record.stop?.codes ?? ['STATE.BLOCKED'], { legal_recovery_action: RECOVERY_ACTION.blocked })

  if (facts.worktree_id !== record.repo.worktree_id) return done(OUTCOMES.IDENTITY, ['IDENTITY.WORKTREE_CHANGED'], { legal_recovery_action: 'Resume only from the worktree the task started in.' })
  if (facts.branch !== record.repo.branch) return done(OUTCOMES.IDENTITY, ['IDENTITY.BRANCH_CHANGED'], { legal_recovery_action: 'Return to the task branch; never switch branches automatically.' })
  if (!facts.base_is_ancestor) return done(OUTCOMES.IDENTITY, ['IDENTITY.BASE_NOT_ANCESTOR_OF_HEAD'], { legal_recovery_action: 'History was rewritten or rebased; human review required. Nothing is reset.' })
  if (facts.unmerged || facts.operation_in_progress) return done(OUTCOMES.DIRTY, ['WORKTREE.UNRECONCILED_GIT_OPERATION'], { legal_recovery_action: 'A merge/rebase/cherry-pick or conflict is in progress. Preserved untouched; a human must resolve it.' })
  if (['unrelated', 'unknown_object'].includes(facts.recorded_head_relation)) return done(OUTCOMES.STALE, ['HISTORY.RECORDED_HEAD_NOT_AN_ANCESTOR'], { legal_recovery_action: 'The recorded head is no longer in this branch history. Human review; no automatic recovery.' })

  const { plan, problems } = rebuildPlan(record)
  if (problems.length) return done(OUTCOMES.STALE, problems, { legal_recovery_action: 'The routing plan or contract changed since the checkpoint; re-plan with the human.' })
  if (facts.changed_files.length) {
    const d = verifyDiffAgainstPlan(plan, facts.changed_files)
    if (!d.ok) return done(OUTCOMES.STALE, ['SCOPE.DIFF_NOT_COVERED_BY_PLAN', ...d.stops.map((s) => s.code), ...d.addedTriggers.map((t) => `SCOPE.ADDED_TRIGGER.${t}`), ...d.addedRoles.map((r) => `SCOPE.ADDED_ROLE.${r}`)], { legal_recovery_action: 'The actual diff needs more review/approval than planned. Stop for the human.' })
    if (record.scope.files.length && !facts.changed_files.every((f) => record.scope.files.includes(f))) return done(OUTCOMES.STALE, ['SCOPE.OUTSIDE_APPROVED_SCOPE'], { legal_recovery_action: 'Files outside the approved scope changed; changes are preserved. Human review.' })
  }
  if (facts.dirty && rank(record.state) < ORDER.implementing) return done(OUTCOMES.DIRTY, ['WORKTREE.CHANGES_BEFORE_IMPLEMENTATION'], { legal_recovery_action: 'Uncommitted changes exist before implementation began. They are preserved; a human decides.' })
  if (rank(record.state) >= ORDER.implementing && plan.human_approvals.length && !record.approvals.length) return done(OUTCOMES.APPROVAL, ['APPROVAL.NO_AUDIT_TRAIL_FOR_PROTECTED_PATHS'], { legal_recovery_action: 'Protected paths require a human approval that was never recorded. Obtain it fresh; the checkpoint grants nothing.' })

  const synced = syncWithFacts(record, facts, remote, now)
  const projected = synced.record
  const out = { projected_record: projected, invalidations: synced.invalidations, regressed: synced.regressed }
  const unsupported = projected.state === 'implementing' ? [] : localSupportProblems(projected, plan, facts).filter((c) => c !== 'FINDING.BLOCKING_OPEN')
  if (unsupported.length) return done(OUTCOMES.STALE, unsupported, { ...out, legal_recovery_action: 'The recorded lifecycle state is no longer supported by passing local tests/reviews. Nothing is assumed; return to the human.' })
  const blocking = openBlockingFindings(projected, facts)
  if (blocking.length && rank(projected.state) >= ORDER.pr_open) return done(OUTCOMES.FINDING, ['FINDING.BLOCKING_OPEN'], { ...out, open_blocking_findings: blocking.map((f) => f.id), legal_recovery_action: 'Re-review after remediation, or a human decision made this session. A stored resolution field is never enough.' })

  const authz = [...plan.human_approvals.map((a) => `${a.action} @ ${a.path}`), ...plan.side_effects_authorized.map((s) => `${s.action} (re-confirm the task authorization)`)]
  const fresh = [...new Set(authz)]
  if (REMOTE_STATES.has(projected.state)) {
    if (!isVerifiedRemote(remote)) return done(OUTCOMES.UNPROVEN, ['REMOTE.NO_VERIFIED_GITHUB_SNAPSHOT'], { ...out, fresh_authorizations_required: fresh, legal_recovery_action: RECOVERY_ACTION[projected.state === 'unproven' ? 'unproven' : projected.state] })
    if (!remote.pr || remote.pr.head_sha !== facts.head_sha) return done(OUTCOMES.STALE, ['REMOTE.PR_MISSING_OR_HEAD_MISMATCH'], { ...out, legal_recovery_action: 'The PR head is not the local head. No evidence is carried over. Human review.' })
    // The recorded state must still be believable against the LIVE snapshot (same predicates as the transitions use).
    const live = liveGateProblems(projected, facts, remote, projected.state === 'unproven' ? 'pr_open' : projected.state)
    if (live.length) return done(OUTCOMES.STALE, live, { ...out, legal_recovery_action: 'The live GitHub state no longer supports the recorded lifecycle state. Nothing is assumed; return to the human.' })
  }
  const awaitingPush = projected.state === 'reviewing' && !projected.evidence.some((e) => e.kind === 'pull_request') && plan.side_effects_authorized.some((s) => s.action === 'push_dedicated_branch_fast_forward')
    && Boolean(latestPass(projected, 'local_tests')) && Boolean(latestPass(projected, 'review')) && (!plan.reviews.security || Boolean(latestPass(projected, 'security_review')))
  const action = awaitingPush ? 'Every required review is valid for this exact head. A push/draft PR needs a freshly confirmed, task-authorized request; the checkpoint does not authorize it.' : RECOVERY_ACTION[projected.state]
  if (projected.state === 'ready_for_human_review') return done(OUTCOMES.READ_ONLY, ['STATE.READY_FOR_HUMAN_REVIEW'], { ...out, fresh_authorizations_required: [], legal_recovery_action: action })
  return done(OUTCOMES.PERMITTED, synced.regressed ? ['RESUME.REGRESSED_TO_IMPLEMENTING'] : ['RESUME.OK'], { ...out, projected_state: projected.state, awaiting_push: awaitingPush, fresh_authorizations_required: fresh, legal_recovery_action: action })
}

/** Load + gather + evaluate. Every failure is a BLOCKED outcome, never an exception and never a repair. */
export function resumeFromDisk(root, taskId, { provider = null, now } = {}) {
  const loaded = loadCheckpoint(root, taskId)
  if (!loaded.ok) return { task_id: taskId, ...result(OUTCOMES.INVALID, loaded.problems ?? [loaded.code]), recorded_state: null, remote: 'unproven', legal_recovery_action: 'Do not repair or reconstruct the checkpoint; return it to the human.', fresh_authorizations_required: [], invalidations: [], unusable_approvals: [], orphan_temp_files: loaded.orphan_temp_files ?? [] }
  let facts
  try { facts = gatherFacts(root, { baseSha: loaded.record.repo.base_sha, recordedHead: loaded.record.repo.head_sha }) } catch { return { task_id: taskId, ...result(OUTCOMES.IDENTITY, ['IDENTITY.GIT_FACTS_UNAVAILABLE']), recorded_state: loaded.record.state, remote: 'unproven', legal_recovery_action: 'Git facts could not be read; nothing is assumed.', fresh_authorizations_required: [], invalidations: [], unusable_approvals: [] } }
  const remote = collectRemote(provider)
  return { ...evaluateResume(loaded.record, facts, remote, now), record: loaded.record, facts, orphan_temp_files: loaded.orphan_temp_files }
}

/** Short human-facing progress summary. Plain text; contains no checkpoint-supplied instructions beyond reason codes. */
export function renderSummary(record, resume) {
  const sh = (s) => String(s).slice(0, 8)
  const valid = (k) => record.evidence.filter((e) => e.kind === k && e.status === 'valid').at(-1)?.result ?? 'none'
  const stale = record.evidence.filter((e) => e.status === 'invalidated')
  const lines = [
    `task ${record.task_id}: ${record.state}${record.stop ? ` (${record.stop.codes.join(', ')})` : ''}`,
    `branch ${record.repo.branch} head ${sh(record.repo.head_sha)} base ${sh(record.repo.base_sha)}`,
    `plan: ${record.plan.sequence.join(' > ') || 'none'}; security review ${record.plan.security_required ? 'required' : 'not required'}`,
    `evidence: tests=${valid('local_tests')} review=${valid('review')} security=${valid('security_review')} CI=${valid('ci_gate')} staging=${valid('staging_gate')}`,
    `invalidated evidence: ${stale.length}${stale.length ? ` (${[...new Set(stale.map((e) => e.invalidated?.code ?? 'unknown'))].join(', ')})` : ''}`,
    `blocking findings open: ${openBlockingFindings(record, resume?.facts ?? { head_sha: record.repo.head_sha }).length}`,
  ]
  if (resume) lines.push(`resume: ${resume.outcome} [${resume.codes.join(', ')}]`, `remote evidence: ${resume.remote}`, `next: ${resume.legal_recovery_action}`)
  return lines.join('\n')
}
