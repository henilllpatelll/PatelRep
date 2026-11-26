// Developer Harness V3 (D3.4 remediation F2) — preserving a worker's UNCOMMITTED, scoped work as a verified checkpoint, on EVERY recoverable interruption.
//
// Two halves, so recovery can make the durable half atomic with the lease supersession:
//   captureWork()      async, filesystem-only: ask the git adapter for the uncommitted scoped files, PARTITION them (safe vs unsafe), write the safe subset as a snapshot directory.
//                      Leaves an orphan directory (harmless garbage) if the controller dies before persistCheckpoint(); never touches the ledger.
//   persistCheckpoint() synchronous, ledger-only: build + verify + mark the checkpoint. Safe to call inside a ledger transaction.
// Unsafe artifacts (credential-shaped names/content, out-of-scope paths, oversize, …) are QUARANTINED: recorded by path and problem code (never content), never restored, never silent.
import { randomUUID } from 'node:crypto'
import { buildCheckpoint, snapshotDirResolver, verifyCheckpoint } from './context-renewal.mjs'
import { createSnapshot, partitionFiles } from './snapshot.mjs'

/** @returns {Promise<{files:number, snapshot:{ref:string,digest:string}|null, quarantined:object[], workerHead:string|null, error?:string}>} */
export async function captureWork(e, taskId, lease = null) {
  const task = e.ledger.getTask(taskId)
  let raw = []; let workerHead = null
  try { raw = (await e.adapters.git.captureSnapshot(task, lease)) ?? [] } catch (err) { return { files: 0, snapshot: null, quarantined: [], workerHead: null, error: `CAPTURE.FAILED:${String(err?.message).slice(0, 60)}` } }
  try { workerHead = (await e.adapters.git.workerHead?.(task, lease))?.head_sha ?? null } catch { workerHead = null }
  const { safe, quarantined } = partitionFiles(raw, task.scope)
  if (!safe.length) return { files: 0, snapshot: null, quarantined, workerHead }
  const ref = `snap-${randomUUID()}`
  const made = createSnapshot({ dir: snapshotDirResolver(e.snapshotRoot)(ref), base_sha: task.base_sha, head_sha: task.head_sha, files: safe, scope: task.scope })
  if (!made.ok) return { files: 0, snapshot: null, quarantined: [...quarantined, ...safe.map((f) => ({ path: f.path, problems: made.problems.slice(0, 3) }))], workerHead, error: made.problems[0] }
  return { files: safe.length, snapshot: { ref, digest: made.digest }, quarantined, workerHead }
}

/**
 * Persist a verified checkpoint for a capture. `force` records one even when there is nothing to snapshot (so an EMPTY tree supersedes an older snapshot — a reverted change must not be resurrected).
 * @returns {{ok:boolean, id?:string, problems?:string[], recorded:boolean}}
 */
export function persistCheckpoint(e, taskId, cap, { reason, stage, force = false, always = false, carry = false, notes = '' }) {
  const L = e.ledger; const resolve = snapshotDirResolver(e.snapshotRoot)
  if (cap.quarantined.length) L.recordRecovery(taskId, 'unsafe_artifacts_quarantined', { reason, artifacts: cap.quarantined.slice(0, 50).map((q) => ({ path: q.path, problems: q.problems })), count: cap.quarantined.length })
  if (cap.error) L.recordRecovery(taskId, 'uncommitted_work_not_preserved', { reason, problems: [cap.error] })
  const prior = L.latestCheckpoint(taskId); const hasPriorSnapshot = !!prior?.snapshot_ref
  // RECOVERY carry-forward: a recovery bumps the fencing epoch, which (by design) makes every earlier checkpoint stale — so when the worktree itself is gone, the last checkpoint's snapshot is carried into a
  // NEW checkpoint of this epoch, but only if that earlier checkpoint is otherwise still valid (same stage, head, plan, requirements and an intact snapshot).
  if (carry && !cap.snapshot && hasPriorSnapshot) {
    const v = verifyCheckpoint(L, prior.checkpoint_id, { snapshotDir: resolve, stage })
    if (v.ok || v.problems.every((p) => p === 'CHECKPOINT.STALE_FENCING_TOKEN')) { cap = { ...cap, snapshot: { ref: prior.snapshot_ref, digest: prior.snapshot_digest }, files: 0 }; L.recordRecovery(taskId, 'checkpoint_carried_forward', { from: prior.checkpoint_id, snapshot: prior.snapshot_ref }) }
  }
  if (!always && !cap.snapshot && !cap.quarantined.length && !(force && hasPriorSnapshot)) return { ok: true, recorded: false }
  const cp = buildCheckpoint(L, taskId, { reason, snapshot: cap.snapshot, workerHead: cap.workerHead, stage, quarantined: cap.quarantined, notes })
  const v = verifyCheckpoint(L, cp.id, { snapshotDir: resolve, stage })
  if (!v.ok) { L.recordRecovery(taskId, 'uncommitted_work_not_preserved', { reason, checkpoint: cp.id, problems: v.problems }); return { ok: false, id: cp.id, problems: v.problems, recorded: true } }
  L.markCheckpointVerified(cp.id); L.recordRecovery(taskId, 'uncommitted_work_preserved', { reason, checkpoint: cp.id, files: cap.files, quarantined: cap.quarantined.length })
  return { ok: true, id: cp.id, recorded: true }
}

/** Best-effort exit preservation for a session that ended without a deliverable. Never throws; the session is already verified stopped (tree quiescent). */
export async function preserveOnExit(e, taskId, { reason, stage, lease }) {
  try { const cap = await captureWork(e, taskId, lease); return persistCheckpoint(e, taskId, cap, { reason, stage, force: true }) } catch (err) { e.ledger.recordRecovery(taskId, 'uncommitted_work_not_preserved', { reason, error: String(err?.message).slice(0, 80) }); return { ok: false, recorded: false } }
}
