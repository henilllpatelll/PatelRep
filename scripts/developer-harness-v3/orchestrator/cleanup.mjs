// Developer Harness V3 (D3.5-E) — safe, task-owned resource cleanup.
//
// Ownership is established by IDENTITY and PROVENANCE recorded by the controller when it created the resource (schema V3 `resources` columns): task, execution and fencing
// token, canonical path or process identity (pid + creation time — never a name), a creation id, a lifecycle state and a protected class. A name, an executable image or a
// path pattern is never enough. Authorization is the D3.2 evaluator's `cleanup_task_owned_resources` + `resource_ownership` check (via the D3.3 cleanupPlan), AFTER a stricter
// local pre-filter that refuses: another task's resource, an unregistered/identity-less resource, a live lease's execution, a migration, the primary worktree, a shared resource,
// the task's LAST recoverable checkpoint, a symlink/junction, a path outside the task's own workspace root or one whose canonical path changed, and a process whose pid was reused.
// Every cleanup is a DURABLE INTENT (planned → executing → verified | failed | unknown). Unknown evidence is never success; a crash mid-cleanup is reconciled, never retried blind.
// D3.5 authorizes NO real destructive cleanup: execution requires simulated adapters (disposable fixtures only); live execution is refused.
import { randomUUID } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { digestOf } from '../lib/canonical.mjs'
import { evaluate } from '../authority/evaluator.mjs'
import { cleanupPlan } from '../runtime/worker-lifecycle.mjs'

const KINDS = new Set(['worker_overlay', 'worktree', 'snapshot', 'checkpoint_snapshot', 'review_agent', 'test_process', 'vm_process', 'log', 'temp_dir', 'migration'])
const PROTECTED = new Set(['migration', 'primary_worktree', 'shared', 'golden_image', 'last_checkpoint'])
const LIFECYCLES = new Set(['running', 'idle', 'stale', 'exited', 'removed'])
const isProc = (k) => ['review_agent', 'test_process', 'vm_process'].includes(k)

/** Register a resource the controller just CREATED for `taskId`. Returns the resource id. */
export function registerOwned(L, taskId, { kind, executionId = null, canonicalRef = null, processIdentity = null, protectedClass = null, lifecycle = 'running', detail = {} }) {
  if (!KINDS.has(kind)) throw new Error('RESOURCE.KIND_UNKNOWN')
  if (!LIFECYCLES.has(lifecycle)) throw new Error('RESOURCE.LIFECYCLE_UNKNOWN')
  if (protectedClass !== null && !PROTECTED.has(protectedClass)) throw new Error('RESOURCE.PROTECTED_CLASS_UNKNOWN')
  if (isProc(kind) && !(processIdentity && Number.isSafeInteger(processIdentity.pid) && processIdentity.pid > 0 && Number.isSafeInteger(processIdentity.start_time_ms) && processIdentity.start_time_ms > 0)) throw new Error('RESOURCE.PROCESS_IDENTITY_REQUIRED')
  if (!isProc(kind) && kind !== 'migration' && !(typeof canonicalRef === 'string' && path.isAbsolute(canonicalRef))) throw new Error('RESOURCE.CANONICAL_PATH_REQUIRED')
  const t = L.getTask(taskId); if (!t) throw new Error('TASK.UNKNOWN')
  const id = `res-${randomUUID()}`
  L.db.prepare('INSERT INTO resources(resource_id,task_id,kind,lifecycle,detail_json,registered_at,execution_id,fencing_token,canonical_ref,process_identity_json,creation_id,protected_class) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, taskId, kind, lifecycle, JSON.stringify(detail), L.now(), executionId, t.fencing_token, canonicalRef, processIdentity ? JSON.stringify(processIdentity) : null, randomUUID(), protectedClass)
  return id
}
export function setOwnedLifecycle(L, id, lifecycle) { if (!LIFECYCLES.has(lifecycle)) throw new Error('RESOURCE.LIFECYCLE_UNKNOWN'); L.db.prepare('UPDATE resources SET lifecycle=? WHERE resource_id=?').run(lifecycle, id) }
export const ownedResources = (L, taskId) => L.db.prepare('SELECT * FROM resources WHERE task_id=? ORDER BY registered_at, resource_id').all(taskId).map((r) => ({ ...r }))

/** The trusted task block for the D3.2 evaluator, built from the ledger (never from a request). */
export function taskContext(L, taskId) {
  const t = L.getTask(taskId)
  return { task_id: t.task_id, fencing_token: t.fencing_token, state_revision: t.state_revision, authority: { repository: t.repository, base_sha: t.base_sha, allowed_paths: t.scope.allowed_paths ?? [], denied_paths: t.scope.denied_paths ?? [] } }
}

const within = (root, p) => { const r = path.resolve(root); const q = path.resolve(p); const rel = path.relative(r, q); return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel) }
/** Local filesystem facts for a path resource: refuses links/junctions (lstat), traversal, and a canonical path that no longer matches the registered one. */
export function pathFacts(ref, root) {
  if (typeof ref !== 'string' || ref.split(/[\\/]/).includes('..')) return { ok: false, code: 'CLEANUP.PATH_TRAVERSAL' }
  if (!root || !within(root, ref)) return { ok: false, code: 'CLEANUP.OUTSIDE_TASK_WORKSPACE' }
  let st
  try { st = lstatSync(ref) } catch (e) { return e.code === 'ENOENT' ? { ok: true, exists: false } : { ok: false, code: 'CLEANUP.PATH_UNREADABLE' } }
  if (st.isSymbolicLink()) return { ok: false, code: 'CLEANUP.LINK_REFUSED' } // Node reports NTFS junctions as symbolic links too
  // every ancestor inside the root must be a real directory too (a junction higher up would redirect the delete)
  for (let p = path.dirname(path.resolve(ref)); within(root, p); p = path.dirname(p)) { try { if (lstatSync(p).isSymbolicLink()) return { ok: false, code: 'CLEANUP.LINK_REFUSED' } } catch { return { ok: false, code: 'CLEANUP.PATH_UNREADABLE' } } }
  let real; try { real = realpathSync.native(ref) } catch { return { ok: false, code: 'CLEANUP.PATH_UNREADABLE' } }
  let realRoot; try { realRoot = realpathSync.native(root) } catch { return { ok: false, code: 'CLEANUP.ROOT_UNREADABLE' } }
  if (!within(realRoot, real) || path.resolve(real).toLowerCase() !== path.resolve(ref).toLowerCase()) return { ok: false, code: 'CLEANUP.PATH_CHANGED' }
  return { ok: true, exists: true, dir: st.isDirectory() }
}

/**
 * DRY-RUN plan for `taskId`: which of ITS registered resources may be cleaned now, and exactly why every other one is refused. Nothing is changed.
 * @param {{procFacts:(identity)=>Promise<{alive:boolean|null,start_time_ms?:number}>, workspaceRoot?:string, protectedRoots?:string[], kinds?:string[]}} o
 */
export async function planTaskCleanup(e, taskId, { procFacts, workspaceRoot = null, protectedRoots = [], kinds = null, now = e.ledger.now() } = {}) {
  const L = e.ledger; const t = L.getTask(taskId)
  if (!t) return { ok: false, code: 'TASK.UNKNOWN' }
  const root = workspaceRoot ?? L.db.prepare('SELECT worktree_path FROM task_workspaces WHERE task_id=?').get(taskId)?.worktree_path ?? null
  const rows = ownedResources(L, taskId).filter((r) => r.lifecycle !== 'removed' && (!kinds || kinds.includes(r.kind)))
  const lastCp = L.latestCheckpoint(taskId)
  const pre = []; const refused = []
  for (const r of rows) {
    const codes = []
    if (!r.creation_id) codes.push('CLEANUP.UNREGISTERED_IDENTITY')
    if (r.protected_class) codes.push(`CLEANUP.PROTECTED:${r.protected_class}`)
    if (r.kind === 'migration') codes.push('CLEANUP.PROTECTED:migration')
    if (r.fencing_token !== null && r.fencing_token > t.fencing_token) codes.push('CLEANUP.FUTURE_FENCING_TOKEN')
    if (r.execution_id && L.liveLeaseOfExecution(r.execution_id)) codes.push('CLEANUP.ACTIVE_LEASE')
    if (r.kind === 'checkpoint_snapshot' && lastCp && (JSON.parse(r.detail_json || '{}').checkpoint_id === lastCp.checkpoint_id)) codes.push('CLEANUP.LAST_RECOVERABLE_CHECKPOINT')
    let facts = null
    if (!codes.length && isProc(r.kind)) {
      const id = r.process_identity_json ? JSON.parse(r.process_identity_json) : null
      let pf = null; try { pf = await procFacts?.(id) } catch { pf = null }
      if (!pf || (pf.alive !== true && pf.alive !== false)) codes.push('CLEANUP.PROCESS_FACTS_UNKNOWN')
      else if (pf.alive && pf.start_time_ms !== id.start_time_ms) codes.push('CLEANUP.PID_REUSED') // that pid is somebody else's process now
      else facts = { alive: pf.alive }
    } else if (!codes.length && r.canonical_ref) {
      if (protectedRoots.some((p) => path.resolve(p).toLowerCase() === path.resolve(r.canonical_ref).toLowerCase() || within(r.canonical_ref, p))) codes.push('CLEANUP.PROTECTED:primary_worktree')
      else { const pf = pathFacts(r.canonical_ref, root); if (!pf.ok) codes.push(pf.code); else facts = pf }
    }
    if (codes.length) refused.push({ id: r.resource_id, kind: r.kind, codes }); else pre.push({ row: r, facts })
  }
  // the ONE policy: the D3.2 evaluator, over the controller's registry of THIS task's resources (lifecycle `running` is unsafe for it)
  // the evaluator's resource classes are process | container | cache | migration: every D3.5 kind maps onto one of them (a path resource is task-owned cache)
  const evalKind = (k) => (isProc(k) ? 'process' : k === 'migration' ? 'migration' : 'cache')
  const registry = Object.fromEntries(pre.map(({ row }) => [row.resource_id, { owner_task_id: row.task_id, kind: evalKind(row.kind), lifecycle: row.lifecycle }]))
  const ev = cleanupPlan({ registry, taskId, evaluateFn: evaluate, policy: e.policy, taskCtx: taskContext(L, taskId), now })
  for (const x of ev.refused) refused.push({ id: x.id, kind: pre.find((p) => p.row.resource_id === x.id).row.kind, codes: x.reason_codes })
  const allowed = pre.filter(({ row }) => ev.allowed.includes(row.resource_id)).map(({ row, facts }) => ({ id: row.resource_id, kind: row.kind, ref: row.canonical_ref, process: row.process_identity_json ? JSON.parse(row.process_identity_json) : null, facts }))
  const plan = { task_id: taskId, at: now, allowed, refused }
  return { ok: true, plan, digest: digestOf(plan) }
}

/**
 * Execute a plan. `dryRun` records the intents only. Real execution requires SIMULATED adapters (D3.5 authorizes no real destructive cleanup). Each item: durable intent →
 * executing → executor.remove (which must re-check identity itself) → executor.verifyGone → verified | failed | unknown.
 */
export async function executeCleanup(e, planned, { executor, dryRun = true } = {}) {
  const L = e.ledger; const out = []
  if (!dryRun && e.adapters?.simulated !== true) return { ok: false, code: 'CLEANUP.LIVE_EXECUTION_NOT_AUTHORIZED' }
  for (const item of planned.plan.allowed) {
    const intentId = `ci-${randomUUID()}`; const now = L.now()
    try { L.db.prepare('INSERT INTO cleanup_intents(intent_id,task_id,resource_id,plan_digest,dry_run,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(intentId, planned.plan.task_id, item.id, planned.digest, dryRun ? 1 : 0, 'planned', now, now) } catch (err) {
      if (/UNIQUE/.test(String(err.message))) { out.push({ id: item.id, status: 'refused', code: 'CLEANUP.INTENT_IN_FLIGHT' }); continue } throw err
    }
    if (dryRun) { out.push({ id: item.id, status: 'planned', dry_run: true }); continue }
    L.db.prepare("UPDATE cleanup_intents SET status='executing', updated_at=? WHERE intent_id=?").run(L.now(), intentId)
    e.hook('cleanup_executing', { taskId: planned.plan.task_id, resourceId: item.id })
    let status = 'unknown'; let detail = null
    try {
      const r = await executor.remove(item)
      const g = await executor.verifyGone(item)
      status = g?.gone === true ? 'verified' : g?.gone === false ? 'failed' : 'unknown'
      detail = { removed: r?.ok === true, code: r?.code ?? null }
    } catch (err) { status = 'unknown'; detail = { error: String(err?.message).slice(0, 80) } }
    finishIntent(L, intentId, item, status, detail)
    out.push({ id: item.id, status })
  }
  return { ok: true, results: out }
}

function finishIntent(L, intentId, item, status, detail) {
  L.tx(() => {
    L.db.prepare('UPDATE cleanup_intents SET status=?, outcome_json=?, updated_at=? WHERE intent_id=?').run(status, JSON.stringify(detail ?? {}), L.now(), intentId)
    if (status === 'verified') L.db.prepare("UPDATE resources SET lifecycle='removed', termination_verified=? WHERE resource_id=?").run(isProc(item.kind) ? 1 : 0, item.id)
  })
}

/** Controller start-up: an intent left `executing` (or `unknown`) is RE-VERIFIED, never re-executed blind and never assumed done. */
export async function reconcileCleanup(e, { executor }) {
  const L = e.ledger; const out = []
  for (const ci of L.db.prepare("SELECT c.*, r.kind, r.canonical_ref, r.process_identity_json FROM cleanup_intents c JOIN resources r ON r.resource_id=c.resource_id WHERE c.dry_run=0 AND c.status IN ('executing','unknown')").all()) {
    const item = { id: ci.resource_id, kind: ci.kind, ref: ci.canonical_ref, process: ci.process_identity_json ? JSON.parse(ci.process_identity_json) : null }
    let g = null; try { g = await executor.verifyGone(item) } catch { g = null }
    const status = g?.gone === true ? 'verified' : 'unknown'
    finishIntent(L, ci.intent_id, item, status, { reconciled: true })
    out.push({ id: ci.resource_id, status })
  }
  return out
}
