// Developer Harness V3 (D3.4) — one reasoning stage = one or more SESSIONS, driven as bounded work units, with automatic context renewal.
//
// The runner owns the invariants around a session; the (injected) session adapter only runs work. In live use the adapter wraps the D3.3 trusted launcher
// (runtime/launcher.mjs runSession); in D3.4 only the SIMULATED adapter exists (live execution is disabled until the activation gates close).
//   * exactly one lease/slot, taken from the ledger BEFORE anything starts and released ONLY after termination is independently verified;
//   * every unit's stream is fed through the D3.3 telemetry parser; the requested vs ACTUAL model is checked (silent substitution = failure);
//   * the init event is verified (no API-key source, pinned CLI version, expected permission mode) or the session is ended;
//   * renewal follows the 10-step order of the brief: boundary → persist → verify checkpoint → graceful stop → verified stop → fresh lease → restore → verify → continue;
//   * crash hooks sit at every boundary so the subprocess crash tests can kill the controller there.
import { randomUUID } from 'node:crypto'
import { createTelemetry, feedLine, verifyInit } from '../runtime/session-telemetry.mjs'
import { classifyObservation, lifecycleFor, nextGovernorState } from '../runtime/subscription-governor.mjs'
import { renewalDecision, buildCheckpoint, verifyCheckpoint, composeRestorePrompt, verifyRestoredState, snapshotDirResolver } from './context-renewal.mjs'
import { createSnapshot } from './snapshot.mjs'
import { MODEL_FAMILIES, verifyActualModel } from './routing.mjs'

const fingerprint = (...parts) => parts.join('|').slice(0, 120)

/**
 * @param {object} e engine ({ledger, adapters, cfg, hook, rng, snapshotRoot})
 * @param {{stage:string, role:string, route:object, mandatory:boolean, readonly?:boolean, instruction:string, onLeased?:(lease:object)=>void}} spec
 */
export async function runSessionStage(e, taskId, spec) {
  const { ledger: L, adapters: A, cfg } = e
  const task = L.getTask(taskId)
  let acquired = L.acquireLease({ taskId, role: spec.role, stage: spec.stage, model: spec.route.model, effort: spec.route.effort, ttlMs: cfg.leaseTtlMs })
  if (!acquired.ok) return { status: 'busy', code: acquired.code }
  let lease = acquired.lease
  e.hook('after_lease_acquired', { taskId })
  let tel = createTelemetry(); let lastUsageAt = null; let turns = 0; let startedAt = L.now(); let deliverable = null; const executions = [lease.execution_id]
  let outcome = null
  try {
    const prep = await A.worker.ensure(task)
    if (!prep?.ok) { outcome = { status: 'failed', code: prep?.code ?? 'WORKER.NOT_AVAILABLE', fingerprint: fingerprint('worker', prep?.code) }; throw outcome }
    spec.onLeased?.(lease)
    let prompt = await buildPrompt(e, taskId, spec, null)
    if (!prompt.ok) { outcome = { status: 'failed', code: prompt.code, fingerprint: fingerprint('prompt', prompt.code) }; throw outcome }
    prompt = prompt.prompt
    let resume = false
    L.markExecutionRunning(lease.execution_id)
    e.hook('after_session_started', { taskId })
    for (let unitNo = 0; unitNo < cfg.maxUnitsPerStage; unitNo += 1) {
      const rl = L.renewLease(lease, cfg.leaseTtlMs)
      if (!rl.ok) { outcome = { status: 'failed', code: rl.code, fingerprint: fingerprint('lease', rl.code) }; throw outcome }
      const unit = await A.session.runUnit({ task: L.getTask(taskId), lease, route: spec.route, prompt, resume, readonly: spec.readonly === true, limits: { maxTurns: cfg.renewal.maxTurns, timeoutMs: cfg.renewal.maxMinutes * 60_000 }, stage: spec.stage })
      e.hook('after_unit', { taskId })
      const before = tel.assistant_messages
      for (const line of unit.lines ?? []) if (feedLine(tel, line) === 'assistant') lastUsageAt = L.now()
      turns += Number.isFinite(unit.turns) ? unit.turns : tel.assistant_messages - before
      const actual = tel.last_usage?.model ?? tel.init?.model ?? null
      L.recordTelemetry(lease.execution_id, { model_actual: actual, cli_version: tel.init?.claude_code_version ?? null, context_window: tel.context_window?.tokens ?? null, turns, telemetry: summarize(tel) })
      if (tel.context_window && tel.init?.claude_code_version) L.setMeta(`window:${tel.init.claude_code_version}:${tel.context_window.model}`, tel.context_window.tokens)

      const initProblems = verifyInit(tel.init, { permissionMode: 'dontAsk', version: cfg.cliVersion })
      if (initProblems.length) { outcome = { status: 'failed', code: initProblems[0], fingerprint: fingerprint('init', initProblems[0]) }; throw outcome }
      const foreign = [...tel.models].filter((m) => !MODEL_FAMILIES[spec.route.model]?.test(m))
      const mv = spec.mandatory && foreign.length ? { ok: false, code: 'ROUTE.MODEL_SUBSTITUTED' } : verifyActualModel({ requested: spec.route.model, actual, mandatory: spec.mandatory })
      if (!mv.ok) { outcome = { status: 'failed', code: mv.code, fingerprint: fingerprint('model', mv.code, actual) }; throw outcome }

      const obs = classifyObservation({ telemetry: tel, exit: unit.exit ?? null, killedReason: unit.killedReason ?? null }, { now: L.now() })
      const prevGov = A.subscription.load()
      const gov = nextGovernorState(prevGov, obs, { now: L.now(), rng: e.rng })
      if (gov) A.subscription.save(gov)
      if (obs.state && !['available', 'approaching'].includes(obs.state)) {
        const lf = lifecycleFor(obs.state)
        outcome = { status: 'wait', wait: { state: lf.state, reason: lf.reason, eligible_at: gov?.next_eligible_at ?? null, code: obs.reason_codes[0] } }; throw outcome
      }
      if (unit.status === 'failed') { outcome = { status: 'failed', code: unit.code ?? 'SESSION.UNIT_FAILED', fingerprint: fingerprint('unit', unit.code, unit.fingerprint) }; throw outcome }
      if (unit.status === 'work_complete') { deliverable = unit.work ?? {}; break }

      const knownWindows = Object.fromEntries(L.db.prepare("SELECT key, value FROM meta WHERE key LIKE 'window:%'").all().map((r) => [r.key.slice(7), Number(r.value)]))
      const dec = renewalDecision({ telemetry: tel, family: spec.route.model, cliVersion: cfg.cliVersion, knownWindows, now: L.now(), lastUsageAt, turns, startedAt, cfg: cfg.renewal })
      L.recordRecovery(taskId, 'renewal_check', { basis: dec.basis, measured: dec.measured, utilization: dec.utilization, renew: dec.renew, rejected: dec.rejected })
      if (!dec.renew) { prompt = 'Continue the remaining work for this stage.'; resume = true; continue }

      const r = await renew(e, taskId, spec, lease, dec)
      if (r.status !== 'renewed') { outcome = r; throw outcome }
      lease = r.lease; executions.push(lease.execution_id); prompt = r.prompt; resume = false
      tel = createTelemetry(); lastUsageAt = null; turns = 0; startedAt = L.now()
      spec.onLeased?.(lease)
    }
    if (!deliverable) { outcome = { status: 'failed', code: 'SESSION.UNIT_BUDGET_EXHAUSTED', fingerprint: fingerprint('units', spec.stage) }; throw outcome }
    outcome = { status: 'done', deliverable }
  } catch (err) {
    if (!outcome) outcome = { status: 'failed', code: 'SESSION.RUNNER_ERROR', fingerprint: fingerprint('runner', String(err?.message).slice(0, 60)) }
  }
  // A finished planning/implementing deliverable is persisted (plain data) BEFORE the session is torn down, so a crash anywhere after the session produced it —
  // including during termination — never costs a second paid session (the stage handler consumes and clears it). REVIEW results are not persisted here: a crash
  // between the lease close and the `submitted` transaction repeats ONE review session (documented residual, doc 18 §5).
  if (outcome.status === 'done' && ['planning', 'implementing'].includes(spec.stage)) L.setMeta(`stage_done:${taskId}:${spec.stage}`, JSON.stringify(outcome.deliverable))
  // Termination is verified INDEPENDENTLY of the adapter's session result, and the slot is released only on a verified stop.
  const term = await safeTerminate(A, lease)
  e.hook('after_session_terminated', { taskId })
  const closed = L.closeLease(lease, { terminationVerified: term.verified, endReason: outcome.status === 'done' ? 'completed' : outcome.code ?? outcome.status })
  e.hook('after_lease_closed', { taskId })
  if (!closed.ok) return { status: 'failed', code: closed.code, fingerprint: fingerprint('close', closed.code), executions }
  if (!term.verified) return { status: 'termination_unverified', executions, lease }
  return { ...outcome, executions, last_lease: lease }
}

const summarize = (t) => ({ lines: t.lines, malformed: t.malformed, models: [...t.models], compactions: t.compactions, usage: t.last_usage, window: t.context_window, init: t.init && { model: t.init.model, permissionMode: t.init.permissionMode, version: t.init.claude_code_version, apiKeySource: t.init.apiKeySource } })

async function safeTerminate(A, lease) {
  try { const r = await A.worker.terminateSession(lease); return { verified: r?.verified === true } } catch { return { verified: false } }
}

async function buildPrompt(e, taskId, spec) {
  const { ledger: L } = e
  const cp = L.latestCheckpoint(taskId, { verifiedOnly: true })
  const consumed = Number(L.meta(`cp_consumed:${taskId}`) ?? 0)
  const usable = cp && cp.seq > consumed ? cp : null
  let checkpoint = null
  if (usable) { const v = verifyCheckpoint(L, usable.checkpoint_id, { snapshotDir: snapshotDirResolver(e.snapshotRoot) }); if (v.ok) checkpoint = usable; else L.recordRecovery(taskId, 'stale_checkpoint_ignored', { checkpoint_id: usable.checkpoint_id, problems: v.problems }) }
  const task = L.getTask(taskId)
  const observed = await e.adapters.git.prepareWorktree(task, { snapshotDir: checkpoint?.snapshot_ref ? snapshotDirResolver(e.snapshotRoot)(checkpoint.snapshot_ref) : null, readonly: spec.readonly === true })
  if (!observed?.ok) return { ok: false, code: observed?.code ?? 'WORKTREE.PREPARE_FAILED' }
  if (checkpoint) {
    const rs = verifyRestoredState({ ledger: L, taskId, checkpointId: checkpoint.checkpoint_id, observed })
    if (!rs.ok) return { ok: false, code: rs.problems[0] }
    L.setMeta(`cp_consumed:${taskId}`, checkpoint.seq)
  }
  const pack = await e.adapters.contextPack?.({ task }) ?? ''
  const p = composeRestorePrompt({ ledger: L, taskId, checkpoint, contextPackMarkdown: pack, stageInstruction: spec.instruction })
  return p.ok ? { ok: true, prompt: p.prompt } : { ok: false, code: p.code }
}

/** The renewal sequence. Any failure BEFORE the old session is verified stopped leaves the old lease in place (and the caller ends the stage as a failure). */
async function renew(e, taskId, spec, lease, dec) {
  const { ledger: L, adapters: A, cfg } = e
  const task = L.getTask(taskId)
  // 1-2. stop starting new work (we are at a unit boundary) and capture the uncommitted scoped work
  const files = await A.git.captureSnapshot(task, lease)
  let snapshot = null
  if (files && files.length) {
    const ref = `snap-${randomUUID()}`
    const made = createSnapshot({ dir: snapshotDirResolver(e.snapshotRoot)(ref), base_sha: task.base_sha, head_sha: task.head_sha, files, scope: task.scope })
    if (!made.ok) return { status: 'failed', code: made.problems[0], fingerprint: fingerprint('snapshot', made.problems[0]) }
    snapshot = { ref, digest: made.digest }
  }
  // 3. the task enters context_recovery (CONTEXT_RENEWAL) BEFORE anything is torn down: a crash from here on is found in that state
  const resumeTo = L.getTask(taskId).state
  const t1 = L.transition(taskId, 'context_recovery', { reason_code: 'CONTEXT_RENEWAL' })
  if (!t1.ok) return { status: 'failed', code: t1.problems[0], fingerprint: fingerprint('renew-transition', t1.problems[0]) }
  // 4-5. persist then VERIFY the checkpoint for completeness and integrity
  const cp = buildCheckpoint(L, taskId, { reason: `CONTEXT_RENEWAL:${dec.basis}`, snapshot, notes: await A.session.notes?.(lease) ?? '', workerHead: (await A.git.workerHead?.(task, lease))?.head_sha ?? null })
  e.hook('after_checkpoint_recorded', { taskId })
  const v = verifyCheckpoint(L, cp.id, { snapshotDir: snapshotDirResolver(e.snapshotRoot) })
  if (!v.ok) { L.transition(taskId, resumeTo); return { status: 'failed', code: v.problems[0], fingerprint: fingerprint('checkpoint', v.problems[0]) } }
  L.markCheckpointVerified(cp.id)
  e.hook('after_checkpoint_verified', { taskId })
  // 6-7. graceful stop, then INDEPENDENT verification of the stop before the slot is released
  const term = await safeTerminate(A, lease)
  const closed = L.closeLease(lease, { terminationVerified: term.verified, endReason: 'CONTEXT_RENEWAL' })
  if (!closed.ok || !term.verified) return { status: 'termination_unverified', code: 'RENEWAL.OLD_SESSION_NOT_VERIFIED_STOPPED' }
  e.hook('after_renewal_old_stopped', { taskId })
  // 8. fresh lease and a fresh context (new context id), 9. restore and verify, 10. continue
  const next = L.acquireLease({ taskId, role: spec.role, stage: spec.stage, model: spec.route.model, effort: spec.route.effort, ttlMs: cfg.leaseTtlMs })
  if (!next.ok) return { status: 'failed', code: next.code, fingerprint: fingerprint('renew-lease', next.code) }
  e.hook('after_renewal_new_lease', { taskId })
  const back = L.transition(taskId, resumeTo)
  if (!back.ok) { L.closeLease(next.lease, { terminationVerified: (await safeTerminate(A, next.lease)).verified, endReason: 'RENEWAL_ABORTED' }); return { status: 'failed', code: back.problems[0], fingerprint: fingerprint('renew-resume', back.problems[0]) } }
  const p = await buildPrompt(e, taskId, spec)
  if (!p.ok) { L.closeLease(next.lease, { terminationVerified: (await safeTerminate(A, next.lease)).verified, endReason: 'RENEWAL_RESTORE_FAILED' }); return { status: 'failed', code: p.code, fingerprint: fingerprint('renew-restore', p.code) } }
  L.markExecutionRunning(next.lease.execution_id)
  L.recordRecovery(taskId, 'context_renewed', { basis: dec.basis, measured: dec.measured, utilization: dec.utilization, checkpoint: cp.id, from: lease.execution_id, to: next.lease.execution_id })
  return { status: 'renewed', lease: next.lease, prompt: p.prompt }
}
