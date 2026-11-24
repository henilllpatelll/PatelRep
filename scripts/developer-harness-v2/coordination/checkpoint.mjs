// Developer Harness V2 — Phase 5 durable LOCAL checkpoints.
//
// A checkpoint is a DATA record. It is local, untracked and non-authoritative: it can never grant approval, widen a role,
// authorize a side effect or prove that anything passed. The embedded sha256 only detects accidental corruption — anyone
// who can edit the file can recompute it, so it is NOT authentication and resume never treats it as trust.
import { execFileSync } from 'node:child_process'
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import path from 'node:path'
import { KINDS, RECORDERS, canonical, sha256 } from './evidence.mjs'
import { STATES } from './states.mjs'

export const CHECKPOINT_SCHEMA = 'developer-harness-v2/checkpoint@1'
export const STORE_REL = ['.wolf', 'runtime-logs', 'developer-harness-v2', 'checkpoints']
export const MAX_BYTES = 256 * 1024
const MAX_STR = 4000
const MAX_ARR = 2000
const ROLES = ['planner', 'implementer', 'test_coordinator', 'independent_reviewer', 'security_reviewer', 'context_manager']
const SHA = /^[0-9a-f]{40}$/
const HEX64 = /^[0-9a-f]{64}$/
const TASK_ID = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i
const SECRETISH = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\b[sr]k[-_](live|test)?[-_]?[A-Za-z0-9_-]{16,}/, /\bwhsec_[A-Za-z0-9]{16,}/, /\bAKIA[0-9A-Z]{16}\b/, /\bsbp_[A-Za-z0-9]{20,}/, /\bgithub_pat_[A-Za-z0-9_]{20,}/, /\bAIza[0-9A-Za-z_-]{30,}/, /\bxox[abpr]-[A-Za-z0-9-]{10,}/, /\b(SK|AC)[0-9a-f]{32}\b/, /\\?"(password|secret|api_?key|token)\\?"\s*:\s*\\?"[^"\\]{8,}/i, /\bgh[pousr]_[A-Za-z0-9]{20,}/, /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, /\b[A-Z][A-Z0-9_]*(SERVICE_ROLE|SECRET|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*[=:]\s*\S{8,}/]
const ISO = (s) => typeof s === 'string' && s.length <= 40 && !Number.isNaN(Date.parse(s))

export const isSafeTaskId = (id) => typeof id === 'string' && TASK_ID.test(id) && !id.includes('..') && !RESERVED.test(id)

// ── Strict schema validation (never repairs; returns every problem found) ───────────────────────────────────────
function keys(o, req, opt, where, p) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) { p.push(`SCHEMA.${where}.NOT_OBJECT`); return false }
  for (const k of Object.keys(o)) if (!req.includes(k) && !opt.includes(k)) p.push(`SCHEMA.${where}.UNKNOWN_KEY.${k.slice(0, 30)}`)
  for (const k of req) if (!(k in o)) p.push(`SCHEMA.${where}.MISSING.${k}`)
  return true
}
const str = (v, where, p, max = MAX_STR) => { if (typeof v !== 'string' || v.length > max) p.push(`SCHEMA.${where}.BAD_STRING`) }
const arr = (v, where, p, each) => { if (!Array.isArray(v) || v.length > MAX_ARR) { p.push(`SCHEMA.${where}.BAD_ARRAY`); return } v.forEach((x, i) => each(x, `${where}[${i}]`)) }

export function validateRecord(r) {
  const p = []
  if (!keys(r, ['schema', 'schema_version', 'revision', 'task_id', 'created_at', 'updated_at', 'repo', 'state', 'state_history', 'stop', 'plan', 'scope', 'handoffs', 'evidence', 'findings', 'approvals', 'event_ids'], ['integrity'], 'record', p)) return p
  if (r.schema !== CHECKPOINT_SCHEMA || r.schema_version !== 1) p.push('SCHEMA.VERSION_UNSUPPORTED')
  if (!Number.isInteger(r.revision) || r.revision < 1) p.push('SCHEMA.REVISION')
  if (!isSafeTaskId(r.task_id)) p.push('SCHEMA.TASK_ID_UNSAFE')
  if (!ISO(r.created_at) || !ISO(r.updated_at)) p.push('SCHEMA.TIMESTAMP')
  if (!STATES.includes(r.state)) p.push('SCHEMA.STATE_UNKNOWN')
  if (keys(r.repo, ['base_sha', 'branch', 'head_sha', 'worktree_id', 'tree_digest'], [], 'repo', p)) {
    if (!SHA.test(r.repo.base_sha) || !SHA.test(r.repo.head_sha)) p.push('SCHEMA.repo.SHA')
    str(r.repo.branch, 'repo.branch', p, 200); if (!HEX64.test(r.repo.worktree_id) || !HEX64.test(r.repo.tree_digest)) p.push('SCHEMA.repo.DIGEST')
  }
  arr(r.state_history, 'state_history', p, (h, w) => {
    if (!keys(h, ['from', 'to', 'at', 'event_id', 'actor', 'reason_code', 'reason', 'evidence_ids'], [], w, p)) return
    if (h.from !== null && !STATES.includes(h.from)) p.push(`SCHEMA.${w}.FROM`); if (!STATES.includes(h.to)) p.push(`SCHEMA.${w}.TO`)
    if (!ISO(h.at)) p.push(`SCHEMA.${w}.AT`); if (!['coordinator', 'system'].includes(h.actor)) p.push(`SCHEMA.${w}.ACTOR`)
    str(h.event_id, `${w}.event_id`, p, 200); str(h.reason_code, `${w}.reason_code`, p, 120); str(h.reason, `${w}.reason`, p, 500); arr(h.evidence_ids, `${w}.evidence_ids`, p, (e, ww) => str(e, ww, p, 80))
  })
  if (!r.state_history?.length) p.push('SCHEMA.state_history.EMPTY')
  if (r.stop !== null && keys(r.stop, ['kind', 'codes', 'detail'], [], 'stop', p)) { if (!['blocked', 'unproven'].includes(r.stop.kind)) p.push('SCHEMA.stop.KIND'); arr(r.stop.codes, 'stop.codes', p, (c, w) => str(c, w, p, 120)); str(r.stop.detail, 'stop.detail', p, 500) }
  if ((r.stop === null) === ['blocked', 'unproven'].includes(r.state)) p.push('SCHEMA.stop.STATE_MISMATCH')
  if (keys(r.plan, ['schema', 'input', 'digest', 'contract_digest', 'status', 'sequence', 'required_roles', 'security_required', 'human_approvals', 'side_effects'], [], 'plan', p)) {
    if (!HEX64.test(r.plan.digest) || !HEX64.test(r.plan.contract_digest)) p.push('SCHEMA.plan.DIGEST')
    if (keys(r.plan.input, ['task', 'files', 'surface', 'modification', 'authorize'], [], 'plan.input', p)) {
      str(r.plan.input.task, 'plan.input.task', p); arr(r.plan.input.files, 'plan.input.files', p, (f, w) => str(f, w, p, 300)); arr(r.plan.input.authorize, 'plan.input.authorize', p, (f, w) => str(f, w, p, 40))
      if (r.plan.input.surface !== null) str(r.plan.input.surface, 'plan.input.surface', p, 40); str(r.plan.input.modification, 'plan.input.modification', p, 40)
    }
    arr(r.plan.sequence, 'plan.sequence', p, (x, w) => str(x, w, p, 40)); arr(r.plan.required_roles, 'plan.required_roles', p, (x, w) => str(x, w, p, 40)); arr(r.plan.side_effects, 'plan.side_effects', p, (x, w) => str(x, w, p, 80))
    arr(r.plan.human_approvals, 'plan.human_approvals', p, (a, w) => { if (keys(a, ['action', 'path'], [], w, p)) { str(a.action, w, p, 80); str(a.path, w, p, 300) } })
    if (typeof r.plan.security_required !== 'boolean') p.push('SCHEMA.plan.SECURITY_FLAG')
  }
  if (keys(r.scope, ['files', 'digest'], [], 'scope', p)) { arr(r.scope.files, 'scope.files', p, (f, w) => str(f, w, p, 300)); if (!HEX64.test(r.scope.digest)) p.push('SCHEMA.scope.DIGEST') }
  arr(r.handoffs, 'handoffs', p, (h, w) => {
    if (!keys(h, ['id', 'role', 'model', 'writes_code', 'status', 'requested_at', 'head_sha'], ['completed_at', 'justification', 'output_ref'], w, p)) return
    if (!['pending', 'active', 'completed', 'failed'].includes(h.status)) p.push(`SCHEMA.${w}.STATUS`); if (!SHA.test(h.head_sha)) p.push(`SCHEMA.${w}.SHA`)
    if (!ISO(h.requested_at) || (h.completed_at !== undefined && !ISO(h.completed_at))) p.push(`SCHEMA.${w}.TIMESTAMP`)
    if (!ROLES.includes(h.role)) p.push(`SCHEMA.${w}.ROLE`); if (typeof h.writes_code !== 'boolean') p.push(`SCHEMA.${w}.WRITES`); for (const k of ['id', 'role', 'model']) str(h[k], `${w}.${k}`, p, 80)
  })
  arr(r.evidence, 'evidence', p, (e, w) => {
    if (!keys(e, ['id', 'kind', 'status', 'result', 'by', 'bound', 'summary', 'recorded_at', 'digest'], ['invalidated'], w, p)) return
    if (!KINDS.includes(e.kind) || !RECORDERS[e.kind]?.includes(e.by)) p.push(`SCHEMA.${w}.KIND_OR_RECORDER`); if (!['valid', 'invalidated'].includes(e.status)) p.push(`SCHEMA.${w}.STATUS`); if (!['pass', 'fail', 'pending'].includes(e.result)) p.push(`SCHEMA.${w}.RESULT`)
    if (!HEX64.test(e.digest)) p.push(`SCHEMA.${w}.DIGEST`); str(e.summary, `${w}.summary`, p, 500)
    if (keys(e.bound, [], ['head_sha', 'candidate_sha', 'tree_digest', 'scope_digest', 'pr_number', 'branch', 'finding_id', 'finding_digest', 'remediates_head'], `${w}.bound`, p)) {
      for (const [k, v] of Object.entries(e.bound)) if (!(typeof v === 'string' ? v.length <= 200 : Number.isInteger(v) || v === null)) p.push(`SCHEMA.${w}.bound.${k}`)
      // Each kind must carry the SHA (and digests) it is bound to; otherwise it could never be reconciled.
      if (!SHA.test(String(e.kind === 'staging_candidate' ? e.bound.candidate_sha : e.bound.head_sha))) p.push(`SCHEMA.${w}.bound.SHA_REQUIRED`)
      if (['local_tests', 'review', 'security_review', 'pr_ready'].includes(e.kind) && !HEX64.test(String(e.bound.tree_digest))) p.push(`SCHEMA.${w}.bound.TREE_REQUIRED`)
      if (['review', 'security_review'].includes(e.kind) && !HEX64.test(String(e.bound.scope_digest))) p.push(`SCHEMA.${w}.bound.SCOPE_REQUIRED`)
    }
    if (typeof e.id !== 'string' || !e.id.startsWith(`${e.kind}-`) || e.id.length > 80) p.push(`SCHEMA.${w}.ID`); if (!ISO(e.recorded_at)) p.push(`SCHEMA.${w}.RECORDED_AT`)
    if ((e.status === 'invalidated') !== (e.invalidated !== undefined)) p.push(`SCHEMA.${w}.INVALIDATED_OBJECT`)
    else if (e.invalidated !== undefined && keys(e.invalidated, ['code', 'at', 'reason'], [], `${w}.invalidated`, p)) { str(e.invalidated.code, `${w}.invalidated.code`, p, 120); str(e.invalidated.reason, `${w}.invalidated.reason`, p, 500); if (!ISO(e.invalidated.at)) p.push(`SCHEMA.${w}.invalidated.AT`) }
  })
  arr(r.findings, 'findings', p, (f, w) => {
    if (!keys(f, ['id', 'severity', 'summary', 'source_role', 'found_at_head', 'recorded_at'], ['resolution'], w, p)) return
    if (!ISO(f.recorded_at) || typeof f.id !== 'string' || f.id.length > 40) p.push(`SCHEMA.${w}.ID_OR_TIME`)
    if (!['independent_reviewer', 'security_reviewer'].includes(f.source_role)) p.push(`SCHEMA.${w}.SOURCE_ROLE`); if (!['critical', 'high', 'medium', 'low', 'info'].includes(f.severity)) p.push(`SCHEMA.${w}.SEVERITY`); if (!SHA.test(f.found_at_head)) p.push(`SCHEMA.${w}.SHA`); str(f.summary, `${w}.summary`, p, 1000)
    if (f.resolution !== undefined && keys(f.resolution, ['kind'], ['evidence_id'], `${w}.resolution`, p)) { str(f.resolution.kind, `${w}.resolution.kind`, p, 60); if (f.resolution.evidence_id !== undefined) str(f.resolution.evidence_id, `${w}.resolution.evidence_id`, p, 80) }
  })
  arr(r.approvals, 'approvals', p, (a, w) => {
    if (!keys(a, ['id', 'action', 'target', 'task_id', 'head_sha', 'recorded_at', 'expires_at', 'single_use', 'consumed', 'audit_only', 'origin'], ['stale'], w, p)) return
    for (const k of ['action', 'target', 'task_id', 'origin']) str(a[k], `${w}.${k}`, p, 300)
    if (!SHA.test(a.head_sha) || typeof a.consumed !== 'boolean' || a.single_use !== true) p.push(`SCHEMA.${w}.FIELDS`)
    if (a.audit_only !== true) p.push(`SCHEMA.${w}.MUST_BE_AUDIT_ONLY`); if (a.task_id !== r.task_id) p.push('APPROVAL.DIFFERENT_TASK_IN_CHECKPOINT')
  })
  arr(r.event_ids, 'event_ids', p, (e, w) => str(e, w, p, 200))
  return [...new Set(p)]
}

export const integrityOf = (r) => { const { integrity, ...rest } = r; return sha256(canonical(rest)) }
export const withIntegrity = (r) => ({ ...r, integrity: { algo: 'sha256', digest: integrityOf(r), note: 'detects accidental corruption only; NOT authentication; the file is untrusted data' } })

/** Full validation of a parsed record: schema, secret-likeness, integrity. */
export function validateCheckpoint(raw, { expectedTaskId = null } = {}) {
  const problems = validateRecord(raw)
  if (!problems.length) {
    if (!raw.integrity || raw.integrity.algo !== 'sha256' || raw.integrity.digest !== integrityOf(raw)) problems.push('CHECKPOINT.INTEGRITY_MISMATCH')
    if (expectedTaskId && raw.task_id !== expectedTaskId) problems.push('CHECKPOINT.TASK_ID_MISMATCH')
    const text = JSON.stringify(raw)
    if (SECRETISH.some((re) => re.test(text))) problems.push('CHECKPOINT.SECRET_LIKE_CONTENT')
  }
  return problems
}

// ── Filesystem safety ───────────────────────────────────────────────────────────────────────────────────────────
/** Environment without GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE etc.: git must answer about `root`, not a redirected repository. */
export const cleanGitEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')))
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: cleanGitEnv() })
const lst = (p) => { try { return lstatSync(p) } catch { return null } }
const inside = (child, parent) => { const rel = path.relative(parent, child); return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel) }

export function storePaths(root, taskId) {
  const dir = path.join(root, ...STORE_REL)
  return { dir, file: path.join(dir, `${taskId}.json`), lock: path.join(dir, `${taskId}.lock`), rel: [...STORE_REL, `${taskId}.json`].join('/') }
}

/** Walk the store path: every existing component must be a real directory (no symlinks / junctions). Optionally create the missing ones. */
function walkStore(root, create) {
  let cur = realpathSync(root)
  for (const seg of STORE_REL) {
    cur = path.join(cur, seg)
    const st = lst(cur)
    if (!st) { if (!create) return { ok: false, code: 'STORE.MISSING' }; mkdirSync(cur, { mode: 0o700 }); continue }
    if (st.isSymbolicLink()) return { ok: false, code: 'STORE.SYMLINK_COMPONENT' }
    if (!st.isDirectory()) return { ok: false, code: 'STORE.COMPONENT_NOT_DIRECTORY' }
    if (!inside(realpathSync(cur), realpathSync(root))) return { ok: false, code: 'STORE.ESCAPES_REPOSITORY' }
  }
  return { ok: true }
}
function checkTarget(file) {
  const st = lst(file)
  if (!st) return { ok: true, exists: false }
  if (st.isSymbolicLink()) return { ok: false, code: 'STORE.TARGET_IS_SYMLINK' }
  if (!st.isFile()) return { ok: false, code: 'STORE.TARGET_NOT_REGULAR_FILE' }
  if (st.nlink > 1) return { ok: false, code: 'STORE.TARGET_HARDLINKED' }
  return { ok: true, exists: true, size: st.size }
}
/** The checkpoint path must be IGNORED by git (so it can never be committed). Re-checked before every write. */
export function isGitIgnored(root, rel) {
  try { git(root, 'check-ignore', '-q', '--', rel); return true } catch { return false }
}

export function loadCheckpoint(root, taskId) {
  if (!isSafeTaskId(taskId)) return { ok: false, code: 'CHECKPOINT.UNSAFE_TASK_ID', problems: ['CHECKPOINT.UNSAFE_TASK_ID'] }
  const w = walkStore(root, false)
  if (!w.ok) return { ok: false, code: w.code, problems: [w.code] }
  const { file, dir } = storePaths(root, taskId)
  const t = checkTarget(file)
  if (!t.ok) return { ok: false, code: t.code, problems: [t.code] }
  if (!t.exists) return { ok: false, code: 'CHECKPOINT.NOT_FOUND', problems: ['CHECKPOINT.NOT_FOUND'] }
  if (t.size > MAX_BYTES) return { ok: false, code: 'CHECKPOINT.TOO_LARGE', problems: ['CHECKPOINT.TOO_LARGE'] }
  let raw
  try { raw = JSON.parse(readFileSync(file, 'utf8')) } catch { return { ok: false, code: 'CHECKPOINT.CORRUPT_JSON', problems: ['CHECKPOINT.CORRUPT_JSON'] } }
  const problems = validateCheckpoint(raw, { expectedTaskId: taskId })
  const orphans = readdirSync(dir).filter((f) => f.startsWith(`${taskId}.json.tmp-`))
  if (problems.length) return { ok: false, code: problems[0], problems, orphan_temp_files: orphans }
  return { ok: true, record: raw, orphan_temp_files: orphans }
}

/**
 * Atomic, lock-protected, revision-checked write. `record.revision` must be exactly (revision on disk + 1).
 * Fails closed: an existing lock is never removed automatically (a crash can leave one for a human to inspect).
 */
export function saveCheckpoint(root, record) {
  const problems = validateRecord(record)
  if (problems.length) return { ok: false, code: 'CHECKPOINT.INVALID_RECORD', problems }
  const sealed = withIntegrity({ ...record, integrity: undefined })
  const text = `${JSON.stringify(sealed, null, 2)}\n`
  if (Buffer.byteLength(text) > MAX_BYTES) return { ok: false, code: 'CHECKPOINT.TOO_LARGE', problems: ['CHECKPOINT.TOO_LARGE'] }
  if (SECRETISH.some((re) => re.test(text))) return { ok: false, code: 'CHECKPOINT.SECRET_LIKE_CONTENT', problems: ['CHECKPOINT.SECRET_LIKE_CONTENT'] }
  const paths = storePaths(root, record.task_id)
  // Inspect the EXISTING store components first, creating nothing and following no link: git refuses a path beyond a symbolic link
  // (Linux), which would otherwise mask a symlinked/junctioned store as STORE.NOT_GIT_IGNORED. A missing component is fine here.
  const pre = walkStore(root, false)
  if (!pre.ok && pre.code !== 'STORE.MISSING') return { ok: false, code: pre.code, problems: [pre.code] }
  if (!isGitIgnored(root, paths.rel)) return { ok: false, code: 'STORE.NOT_GIT_IGNORED', problems: ['STORE.NOT_GIT_IGNORED'] }
  const w = walkStore(root, true)
  if (!w.ok) return { ok: false, code: w.code, problems: [w.code] }
  const t = checkTarget(paths.file)
  if (!t.ok) return { ok: false, code: t.code, problems: [t.code] }
  let lockFd
  try { lockFd = openSync(paths.lock, 'wx', 0o600) } catch { return { ok: false, code: 'CHECKPOINT.LOCKED', problems: ['CHECKPOINT.LOCKED'] } }
  // Re-verify everything under the lock: another writer may have created the file or swapped a component since the first check.
  const w2 = walkStore(root, false)
  const t2 = checkTarget(paths.file)
  if (!w2.ok || !t2.ok) { closeSync(lockFd); try { unlinkSync(paths.lock) } catch { /* ours */ } return { ok: false, code: w2.code ?? t2.code, problems: [w2.code ?? t2.code] } }
  t.exists = t2.exists
  const tmp = `${paths.file}.tmp-${process.pid}-${sha256(`${Date.now()}${Math.random()}`).slice(0, 8)}`
  try {
    writeSync(lockFd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }))
    let onDisk = 0
    if (t.exists) {
      const cur = loadCheckpoint(root, record.task_id)
      if (!cur.ok) return { ok: false, code: 'CHECKPOINT.EXISTING_INVALID', problems: cur.problems }
      onDisk = cur.record.revision
    }
    if (record.revision !== onDisk + 1) return { ok: false, code: 'CHECKPOINT.REVISION_CONFLICT', problems: ['CHECKPOINT.REVISION_CONFLICT'], on_disk_revision: onDisk }
    const fd = openSync(tmp, 'wx', 0o600)
    try { writeSync(fd, text); fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(tmp, paths.file)
    return { ok: true, file: paths.file, revision: record.revision }
  } finally {
    closeSync(lockFd)
    try { unlinkSync(paths.lock) } catch { /* the lock we created; if it cannot be removed the next writer fails closed */ }
  }
}
