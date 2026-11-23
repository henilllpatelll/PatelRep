// Developer Harness V2 — Phase 6 report assembly.
//
// Every report states, in its first line, that it is a LOCAL, NON-AUTHORITATIVE selection and that CI Gate and Staging Gate
// remain required. A report binds to the exact head SHA, tree digest and changed-file digest it was computed for; a result
// whose tree moved is INVALID. Test EVIDENCE is produced only from commands that actually ran, and only as a CANDIDATE
// the caller must hand to Phase 5's `recordEvidence` itself: this module never writes a checkpoint and never marks anything
// "passed" because a selection exists.
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, renameSync, writeSync } from 'node:fs'
import path from 'node:path'
import { sha256, canonical } from '../coordination/evidence.mjs'
import { isGitIgnored } from '../coordination/checkpoint.mjs'
import { BANNER } from './catalog.mjs'
import { RESULT, publicEntries } from './runner.mjs'

export const REPORT_SCHEMA = 'developer-harness-v2/test-report@1'
export const RUN_STORE_REL = ['.wolf', 'runtime-logs', 'developer-harness-v2', 'testing']
const BAD = new Set([RESULT.FAILED, RESULT.TIMED_OUT, RESULT.INTERRUPTED, RESULT.NO_TESTS, RESULT.INVALID])

const PERMANENT = (s) => s.blocked && /^(RUNNER\.NOT_AUTOMATED|DB_STACK\.)/.test(s.blocked.code) // can never run in this tool: reported as ci_required, not silently passed
const ciRequiredOf = (selection) => selection.suites.filter((s) => s.tier === 'ci_only' || PERMANENT(s)).map((s) => s.id)

/** Identity facts for the report: from a verified change set and, optionally, read-only task facts. Nothing here is trusted from text. */
export function identityFrom(change, { taskId = null, taskRecord = null } = {}) {
  const id = { task_id: taskId, base_sha: change.base_sha ?? null, head_sha: change.head_sha ?? null, branch: change.branch ?? null, tree_digest: change.tree_digest ?? null, changed_file_digest: change.changed_file_digest ?? null, phase5_scope_digest: change.phase5_scope_digest ?? null, task_checkpoint: 'not_consulted' }
  const problems = []
  if (taskRecord) {
    id.task_checkpoint = 'read_only_consulted'
    if (taskRecord.task_id !== taskId) problems.push('TASK.ID_MISMATCH')
    if (taskRecord.repo?.base_sha && change.base_sha && taskRecord.repo.base_sha !== change.base_sha) problems.push('TASK.BASE_MISMATCH')
    if (taskRecord.repo?.branch && change.branch && taskRecord.repo.branch !== change.branch) problems.push('TASK.BRANCH_MISMATCH')
  }
  return { identity: id, problems }
}

export function buildReport({ selection, plan = null, run = null, identity, identityProblems = [], now = new Date().toISOString() }) {
  const executed = Boolean(run) && !run.request_problems?.length
  // A non-passing step keeps a sanitized head (first errors) and tail (summary) — `output` was already scrubbed by the runner.
  const excerpt = (output) => { const t = String(output); return { ...(t.length > 3000 ? { output_head: t.slice(0, 1000) } : {}), output_tail: t.slice(-2000) } }
  const outcomes = run ? run.results.map(({ steps, ...r }) => ({ ...r, steps: (steps ?? []).map(({ output, ...s }) => (s.status === RESULT.PASSED || !output ? s : { ...s, ...excerpt(output) })) })) :(plan?.entries ?? []).map((e) => ({ suite_id: e.suite_id, tier: e.tier, status: RESULT.NOT_RUN, code: e.action === 'WILL_RUN' ? 'PREVIEW_ONLY' : e.code, reason: e.action === 'WILL_RUN' ? 'preview: nothing was executed' : e.reason }))
  // Defence in depth: whatever a run object claims, a CI-required suite was never run here, so its outcome can never be a pass/fail.
  const ciReq = new Set(ciRequiredOf(selection))
  for (const [i, x] of outcomes.entries()) if (ciReq.has(x.suite_id) && [RESULT.PASSED, RESULT.DEDUPED].includes(x.status)) outcomes[i] = { suite_id: x.suite_id, tier: x.tier, status: RESULT.NOT_RUN, code: 'CI.RESULT_IGNORED', reason: 'a CI-required suite is never run by this tool; the supplied result was ignored' }
  const by = (st) => outcomes.filter((o) => o.status === st).map((o) => o.suite_id)
  const summary = { passed: by(RESULT.PASSED), failed: by(RESULT.FAILED), timed_out: by(RESULT.TIMED_OUT), interrupted: by(RESULT.INTERRUPTED), no_tests_discovered: by(RESULT.NO_TESTS), invalid_tree_changed: by(RESULT.INVALID), blocked: by(RESULT.BLOCKED), not_run: by(RESULT.NOT_RUN), deduped: by(RESULT.DEDUPED) }
  const rep = {
    schema: REPORT_SCHEMA, banner: BANNER, authoritative: false, ci_equivalent: false, mode: executed ? 'EXECUTED' : 'PREVIEW', generated_at: now,
    identity, identity_problems: identityProblems,
    selection: { status: selection.status, coverage: selection.coverage, selection_digest: selection.selection_digest, suite_ids: selection.suites.map((s) => s.id), suites: selection.suites.map((s) => ({ id: s.id, tier: s.tier, local_action: s.local_action, reasons: s.reasons.map((r) => r.code), targeted: s.targeted })) },
    escalations: selection.escalations, required_ci_jobs: selection.required_ci_jobs,
    // Required coverage this tool can NEVER provide locally (CI-only, or permanently blocked: Docker/DB, not automated). Never executed here, never passing here.
    ci_required_suites: ciRequiredOf(selection),
    plan: plan ? publicEntries(plan) : null, outcomes, summary,
    tree_digest_start: run?.tree_digest_start ?? null, tree_digest_end: run?.tree_digest_end ?? null, stopped: run?.stopped ?? null,
  }
  rep.evidence = evidenceCandidate(rep, selection)
  rep.report_digest = sha256(canonical({ ...rep, generated_at: null, report_digest: undefined }))
  return rep
}

/**
 * A candidate for Phase 5 `local_tests` evidence. A FAIL is always offered (a failure must be recordable); a PASS only when every
 * locally runnable selected suite actually ran and passed against the unchanged tree with no unproven coverage. Never persisted here.
 */
export function evidenceCandidate(rep, selection) {
  const bound = { head_sha: rep.identity.head_sha, tree_digest: rep.identity.tree_digest }
  if (rep.mode !== 'EXECUTED') return { eligible: false, reasons: ['NOT_EXECUTED'], note: 'a selection or preview is not test evidence' }
  if (!bound.head_sha || !bound.tree_digest) return { eligible: false, reasons: ['IDENTITY.UNKNOWN'] }
  const o = rep.outcomes
  const bad = o.filter((x) => BAD.has(x.status))
  const summary = `local selection (non-authoritative): ${rep.summary.passed.length} passed, ${bad.length} not passing, ${rep.summary.blocked.length} blocked, ${rep.summary.not_run.length} not run; CI Gate and Staging Gate required`
  if (bad.length) return { eligible: true, kind: 'local_tests', by: 'test_coordinator', result: 'fail', summary: summary.slice(0, 280), bound, failing: bad.map((x) => x.suite_id) }
  const reasons = []
  // EVERY selected suite that is not CI-only must have passed: expensive-without-approval, blocked, missing-parameter and DB suites make a PASS ineligible (a FAIL is still offered above).
  const ciRequired = ciRequiredOf(selection)
  // Fail closed: a selected DB / not-automated suite can never pass in this tool, so it makes a local PASS ineligible (a FAIL is still offered above).
  for (const s of selection.suites.filter((x) => x.tier !== 'ci_only')) { const r = o.find((x) => x.suite_id === s.id); if (PERMANENT(s)) reasons.push(`CI_REQUIRED_NOT_RUNNABLE:${s.id}`); else if (!r || (r.status !== RESULT.PASSED && r.status !== RESULT.DEDUPED)) reasons.push(`SUITE_NOT_PASSED:${s.id}`) }
  if (!o.some((x) => x.status === RESULT.PASSED)) reasons.push('NOTHING_PASSED')
  if (rep.tree_digest_start !== rep.identity.tree_digest || rep.tree_digest_end !== rep.identity.tree_digest) reasons.push('TREE_CHANGED_OR_UNPROVEN')
  if (selection.coverage.status === 'COVERAGE.UNPROVEN') reasons.push('COVERAGE.UNPROVEN')
  if (rep.identity_problems.length) reasons.push(...rep.identity_problems)
  return reasons.length ? { eligible: false, reasons } : { eligible: true, kind: 'local_tests', by: 'test_coordinator', result: 'pass', summary: summary.slice(0, 280), bound, ci_required: ciRequired }
}

export function renderText(rep, checklist = null) {
  const L = [BANNER, '', `Mode: ${rep.mode}   Head: ${rep.identity.head_sha ?? 'unknown'}   Branch: ${rep.identity.branch ?? 'unknown'}`, `Tree digest: ${rep.identity.tree_digest ?? 'unknown'}`, `Changed-file digest: ${rep.identity.changed_file_digest ?? 'unknown'}${rep.identity.task_id ? `   Task: ${rep.identity.task_id}` : ''}`, `Coverage: ${rep.selection.coverage.status}`]
  for (const g of rep.selection.coverage.gaps) L.push(`  gap ${g.code}: ${g.note}${g.paths.length ? ` [${g.paths.slice(0, 4).join(', ')}]` : ''}`)
  L.push('', 'Suites:')
  for (const s of rep.selection.suites) {
    const o = rep.outcomes.find((x) => x.suite_id === s.id)
    L.push(`  ${(o?.status ?? 'NOT_RUN').padEnd(20)} ${s.id.padEnd(34)} [${s.tier}] ${o?.code ?? ''} ${s.reasons.slice(0, 3).join(',')}`)
  }
  if (rep.escalations.length) { L.push('', 'Escalations:'); for (const e of rep.escalations) L.push(`  ${e.code}${e.paths.length ? ` (${e.paths.slice(0, 3).join(', ')})` : ''}`) }
  L.push('', `Required CI jobs (authoritative, not replaced by this report): ${rep.required_ci_jobs.length}`, `CI-required suites (never run or passed by this tool; CI must provide them): ${rep.ci_required_suites.length ? rep.ci_required_suites.join(', ') : 'none selected'}`,`Evidence candidate: ${rep.evidence.eligible ? `${rep.evidence.result} (record via Phase 5 recordEvidence yourself)` : `none (${(rep.evidence.reasons ?? []).join(', ')})`}`)
  if (checklist) L.push('', renderChecklistText(checklist))
  L.push('', BANNER)
  return L.join('\n')
}
function renderChecklistText(c) {
  const out = ['Regression checklist (manual items are NOT verified by this tool):']
  for (const i of c.items) out.push(`  [ ] ${i.id}: ${i.behavior}`, `      why: ${i.why_adjacent}`, `      automated: ${i.automated.length ? i.automated.map((a) => `${a.suite_id}${a.outcome ? `=${a.outcome}` : ''}`).join(', ') : 'NONE SELECTED/AVAILABLE'}   manual: ${i.manual_needed ? 'YES' : 'no'}   env: ${i.environment}`, `      pass evidence: ${i.pass_evidence}`)
  return out.join('\n')
}

/** Persist a (partial or final) run record under the git-ignored store. Atomic, no symlinks, refused unless the exact path is ignored. */
export function writeRunRecord(root, report, runId = `${report.generated_at.replace(/[^0-9]/g, '').slice(0, 14)}-${report.report_digest.slice(0, 8)}`) {
  if (!/^[0-9]{14}-[0-9a-f]{8}$/.test(runId)) return { ok: false, code: 'RUN_STORE.BAD_ID' }
  const dir = path.join(root, ...RUN_STORE_REL)
  const rel = [...RUN_STORE_REL, `${runId}.json`].join('/')
  if (!isGitIgnored(root, rel)) return { ok: false, code: 'RUN_STORE.NOT_GIT_IGNORED' }
  let cur = root
  for (const part of RUN_STORE_REL) {
    cur = path.join(cur, part)
    if (existsSync(cur)) { if (!lstatSync(cur).isDirectory()) return { ok: false, code: 'RUN_STORE.NOT_A_REAL_DIRECTORY' } } else mkdirSync(cur)
  }
  const text = `${JSON.stringify(report, null, 1)}\n`
  if (Buffer.byteLength(text) > 2 * 1024 * 1024) return { ok: false, code: 'RUN_STORE.TOO_LARGE' }
  const file = path.join(dir, `${runId}.json`)
  const tmp = `${file}.tmp-${process.pid}`
  const fd = openSync(tmp, 'wx', 0o600)
  try { writeSync(fd, text); fsyncSync(fd) } finally { closeSync(fd) }
  renameSync(tmp, file)
  return { ok: true, file, run_id: runId }
}
