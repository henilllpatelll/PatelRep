// Developer Harness V3 (D3.4) — one reasoning stage = one or more SESSIONS, driven as bounded work units, with automatic context renewal.
//
// The runner owns the invariants around a session; the (injected) session adapter only runs work. In live use the adapter wraps the D3.3 trusted launcher
// (runtime/launcher.mjs runSession); in D3.4 only the SIMULATED adapter exists (live execution is disabled until the activation gates close).
//   * exactly one lease/slot, taken from the ledger BEFORE anything starts and released ONLY after termination is independently verified;
//   * every unit's stream is fed through the D3.3 telemetry parser; the requested vs ACTUAL model is checked (silent substitution = failure);
//   * the init event is verified (no API-key source, pinned CLI version, expected permission mode) or the session is ended;
//   * renewal follows the 10-step order of the brief: boundary → persist → verify checkpoint → graceful stop → verified stop → fresh lease → restore → verify → continue;
//   * EVERY unit boundary and EVERY fresh-session renewal re-runs resource + subscription admission (pressure, eligibility, auth, extra-usage freshness, cancellation); a denial
//     preserves a verified checkpoint, terminates the session (verified) and enters the right waiting state — never a silent continue;
//   * every NON-completing exit (wait, failure, cancellation) preserves the worker's uncommitted scoped work as a verified checkpoint AFTER the stop is verified;
//   * crash hooks sit at every boundary so the subprocess crash tests can kill the controller there.
import { createTelemetry, feedLine, verifyInit } from '../runtime/session-telemetry.mjs'
import { classifyObservation, lifecycleFor, nextGovernorState } from '../runtime/subscription-governor.mjs'
import { renewalDecision, verifyCheckpoint, composeRestorePrompt, verifyRestoredState, snapshotDirResolver } from './context-renewal.mjs'
import { captureWork, persistCheckpoint, preserveOnExit } from './preserve.mjs'
import { safeCode } from './suspension.mjs'
import { MODEL_FAMILIES, verifyActualModel } from './routing.mjs'
import { normalizeFingerprint } from './engineering-recovery.mjs'

// D3.5-G: volatile tokens in UNTRUSTED failure text (hashes, uuids, line numbers, temp paths) are normalized so a failure cannot evade its budget by changing shape
const fingerprint = (...parts) => parts.map((p) => normalizeFingerprint(p ?? '')).join('|').slice(0, 120)
const isCount = (x) => Number.isSafeInteger(x) && x >= 0

/** Map a denied admission onto a session outcome (the stage handler's failStage turns it into the right waiting/blocked/suspended state). */
export function admissionOutcome(adm) {
  if (adm.kind === 'wait') return { status: 'wait', wait: { state: adm.state, reason: adm.reason, eligible_at: adm.eligible_at ?? null, code: adm.codes?.[0] ?? 'ADMISSION.WAIT', codes: adm.codes ?? [] } }
  if (adm.kind === 'blocked') return { status: 'wait', wait: { state: 'blocked', reason: adm.reason, code: adm.codes?.[0] ?? 'ADMISSION.BLOCKED', codes: adm.codes ?? [] } }
  if (adm.kind === 'cancelled') return { status: 'cancelled', code: 'TASK.CANCELLED' }
  if (adm.kind === 'suspend') return { status: 'suspend', cause: adm.cause, codes: adm.codes ?? [] }
  return { status: 'failed', code: 'ADMISSION.SLOT_CONFLICT', fingerprint: fingerprint('admission', 'slot-conflict') }
}

/** Between work units: cancellation, a task moved out of its stage, and FRESH admission for the next unit (the running session is admitted against itself, not against an occupied slot). */
async function boundaryCheck(e, taskId, spec, lease) {
  const t = e.ledger.getTask(taskId)
  if (t.cancelled) return { status: 'cancelled', code: 'TASK.CANCELLED' }
  if (t.state !== spec.stage) return { status: 'cancelled', code: 'TASK.STATE_CHANGED' }
  const need = e.needFor(spec.stage); if (!need) return null
  const adm = await e.checkAdmission(taskId, need, { ownLease: lease })
  return adm.ok ? null : admissionOutcome(adm)
}

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
    // D3.5-C: a worker INCIDENT (failed sanitizer, contaminated worker, broken/missing overlay, golden mismatch) goes to the recovery supervisor, not to a blind retry
    if (!prep?.ok) { outcome = prep?.incident ? { status: 'incident', incident: prep.incident, code: prep.code ?? null, detail: prep.detail ?? {} } : { status: 'failed', code: prep?.code ?? 'WORKER.NOT_AVAILABLE', fingerprint: fingerprint('worker', prep?.code) }; throw outcome }
    spec.onLeased?.(lease)
    let prompt = await buildPrompt(e, taskId, spec, null)
    if (!prompt.ok) { outcome = prompt.incident ? { status: 'incident', incident: prompt.incident.kind, code: prompt.code, detail: prompt.incident } : { status: 'failed', code: prompt.code, fingerprint: fingerprint('prompt', prompt.code) }; throw outcome }
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
      turns += Math.max(isCount(unit.turns) ? unit.turns : 0, tel.assistant_messages - before) // the adapter's report can only RAISE the count above what the stream itself shows: a low or garbled number cannot weaken the ceilings
      const actual = tel.last_usage?.model ?? tel.init?.model ?? null
      L.recordTelemetry(lease.execution_id, { model_actual: actual, cli_version: tel.init?.claude_code_version ?? null, context_window: tel.context_window?.tokens ?? null, turns, telemetry: summarize(tel) })
      if (tel.context_window && tel.init?.claude_code_version) L.setMeta(`window:${tel.init.claude_code_version}:${tel.context_window.model}`, tel.context_window.tokens)

      // the provider/billing classification comes FIRST: an API-key source or an extra-usage signal must reach the governor (and the owner) before any other complaint can turn it into a retry
      const obs = classifyObservation({ telemetry: tel, exit: unit.exit ?? null, killedReason: unit.killedReason ?? null }, { now: L.now() })
      const prevGov = A.subscription.load()
      const gov = nextGovernorState(prevGov, obs, { now: L.now(), rng: e.rng })
      if (gov) A.subscription.save(gov)
      if (['unauthorized_billing', 'auth_expired', 'auth_unverified'].includes(obs.state)) { const lf = lifecycleFor(obs.state); outcome = { status: 'wait', wait: { state: lf.state, reason: lf.reason, eligible_at: null, code: obs.reason_codes[0], codes: obs.reason_codes } }; throw outcome }
      const initProblems = verifyInit(tel.init, { permissionMode: 'dontAsk', version: cfg.cliVersion })
      if (initProblems.length) { outcome = { status: 'failed', code: initProblems[0], fingerprint: fingerprint('init', initProblems[0]) }; throw outcome }
      const foreign = [...tel.models].filter((m) => !MODEL_FAMILIES[spec.route.model]?.test(m))
      const mv = spec.mandatory && foreign.length ? { ok: false, code: 'ROUTE.MODEL_SUBSTITUTED' } : verifyActualModel({ requested: spec.route.model, actual, mandatory: spec.mandatory })
      if (!mv.ok) { outcome = { status: 'failed', code: mv.code, fingerprint: fingerprint('model', mv.code, actual) }; throw outcome }

      if (obs.state && !['available', 'approaching'].includes(obs.state)) {
        const lf = lifecycleFor(obs.state)
        outcome = { status: 'wait', wait: { state: lf.state, reason: lf.reason, eligible_at: gov?.next_eligible_at ?? null, code: obs.reason_codes[0] } }; throw outcome
      }
      if (unit.status === 'failed') { outcome = { status: 'failed', code: unit.code ?? 'SESSION.UNIT_FAILED', fingerprint: fingerprint('unit', unit.code, unit.fingerprint) }; throw outcome }
      if (unit.status === 'work_complete') { deliverable = unit.work ?? {}; break }

      const bd = await boundaryCheck(e, taskId, spec, lease)
      if (bd) { outcome = bd; throw outcome }

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
  // including during termination — never costs a second paid session (the stage handler consumes and clears it). REVIEW deliverables are persisted too (next block).
  if (outcome.status === 'done' && ['planning', 'implementing'].includes(spec.stage)) L.setMeta(`stage_done:${taskId}:${spec.stage}`, JSON.stringify(outcome.deliverable))
  // A finished REVIEW deliverable is ALSO durable before teardown (F6) — but UNTRUSTED: it is consumed only after termination, candidate binding, context independence and the read-only proof are verified
  // (stages.mjs `review`), and the issuer refuses a review that is not `submitted` with a verified-stopped execution. A crash anywhere after this line never costs a second paid review.
  if (outcome.status === 'done' && spec.persistDeliverable) {
    try { spec.persistDeliverable(outcome.deliverable, lease) } catch (err) { outcome = { status: 'failed', code: 'REVIEW.DELIVERABLE_UNPERSISTABLE', fingerprint: fingerprint('persist', String(err?.message).slice(0, 40)) } } // never let a hostile deliverable block the teardown below
    if (outcome.status === 'done') e.hook('after_review_deliverable_persisted', { taskId })
  }
  // Termination is verified INDEPENDENTLY of the adapter's session result, and the slot is released only on a verified stop.
  const term = await safeTerminate(A, lease)
  e.hook('after_session_terminated', { taskId })
  // The stop is VERIFIED, so the worker tree is quiescent: preserve whatever uncommitted scoped work a non-completing exit leaves behind BEFORE the slot is released (a crash in between is
  // found by recovery, which captures it atomically with the supersession). An unverified stop captures nothing now — recovery does, once cleanup is verified.
  if (outcome.status !== 'done' && term.verified && !outcome.checkpointed && spec.readonly !== true) await preserveOnExit(e, taskId, { reason: `SESSION_EXIT:${outcome.status}`, stage: spec.stage, lease })
  const closed = L.closeLease(lease, { terminationVerified: term.verified, endReason: outcome.status === 'done' ? 'completed' : safeCode(outcome.code ?? outcome.status) })
  e.hook('after_lease_closed', { taskId })
  if (!closed.ok) return { status: 'failed', code: closed.code, fingerprint: fingerprint('close', closed.code), executions }
  if (!term.verified) return { status: 'termination_unverified', executions, lease }
  return { ...outcome, executions, last_lease: lease }
}

const summarize = (t) => ({ lines: t.lines, malformed: t.malformed, models: [...t.models], compactions: t.compactions, usage: t.last_usage, window: t.context_window, init: t.init && { model: t.init.model, permissionMode: t.init.permissionMode, version: t.init.claude_code_version, apiKeySource: t.init.apiKeySource } })

async function safeTerminate(A, lease) {
  try { const r = await A.worker.terminateSession(lease); return { verified: r?.verified === true } } catch { return { verified: false } }
}

/**
 * The session's prompt and worktree. CRASH-SAFE: restoration never "consumes" a checkpoint — the newest verified checkpoint that is still valid for this stage / head / epoch is restored EVERY time
 * a session starts, so a crash after (or during) a restore can always be restored again. If no checkpoint is usable (corrupt, missing, stale) the live worktree is preserved BEFORE it is reset,
 * and the unusable checkpoint is recorded: work is never discarded silently.
 */
async function buildPrompt(e, taskId, spec) {
  const { ledger: L } = e; const resolve = snapshotDirResolver(e.snapshotRoot)
  let checkpoint = null
  if (!spec.readonly) {
    const newest = L.latestCheckpoint(taskId, { verifiedOnly: true })
    const liveHead = (await e.adapters.git.workerHead?.(L.getTask(taskId), null))?.head_sha ?? null
    if (newest) {
      const v = verifyCheckpoint(L, newest.checkpoint_id, { snapshotDir: resolve, stage: spec.stage })
      // A checkpoint is a snapshot of uncommitted work ON a worker head. If the worker has COMMITTED since (the ledger head only moves when a candidate is recorded), restoring it would overlay
      // an older tree on newer committed work: it is SUPERSEDED, never restored.
      if (v.ok && (newest.payload.worker_head_sha ?? null) !== liveHead) { v.ok = false; v.problems = ['CHECKPOINT.SUPERSEDED_BY_WORKER_COMMIT'] }
      if (v.ok) checkpoint = newest
      else if (!L.meta(`cp_unusable:${newest.checkpoint_id}`)) { L.setMeta(`cp_unusable:${newest.checkpoint_id}`, '1'); L.recordRecovery(taskId, 'checkpoint_unusable', { checkpoint_id: newest.checkpoint_id, problems: v.problems, held_snapshot: !!newest.snapshot_ref }) }
    }
    const lastRole = L.db.prepare('SELECT role FROM executions WHERE task_id=? ORDER BY ordinal DESC LIMIT 1 OFFSET 1').get(taskId)?.role ?? '' // OFFSET 1: row 0 is THIS session's own execution
    if (!checkpoint && /reviewer/.test(lastRole)) L.recordRecovery(taskId, 'reviewer_residue_discarded', { last_role: lastRole }) // files left by a READ-ONLY session are never work to preserve (they would be committed by the next writer)
    else if (!checkpoint) { // nothing usable: whatever the worktree still holds is preserved before prepareWorktree resets it
      const cap = await captureWork(e, taskId, null)
      if (cap.error) return { ok: false, code: cap.error.split(':').slice(0, 2).join(':') } // work that cannot be preserved is never reset: the stage fails (bounded, budgeted) with the worktree untouched
      const p = persistCheckpoint(e, taskId, cap, { reason: 'PRE_RESET_PRESERVATION', stage: spec.stage })
      if (p.ok && p.id && p.recorded) checkpoint = L.getCheckpoint(p.id)
    }
  }
  const task = L.getTask(taskId)
  const observed = await e.adapters.git.prepareWorktree(task, { snapshotDir: checkpoint?.snapshot_ref ? resolve(checkpoint.snapshot_ref) : null, readonly: spec.readonly === true })
  // a checkpoint whose snapshot cannot be restored is a RESTORE incident (the supervisor de-verifies it and falls back to an older one), not a retry of the same failing restore
  if (!observed?.ok) return { ok: false, code: observed?.code ?? 'WORKTREE.PREPARE_FAILED', incident: checkpoint && /^(SNAPSHOT|CHECKPOINT)\./.test(observed?.code ?? '') ? { kind: 'restore_failed', checkpoint_id: checkpoint.checkpoint_id } : null }
  if (checkpoint) {
    const rs = verifyRestoredState({ ledger: L, taskId, checkpointId: checkpoint.checkpoint_id, observed })
    if (!rs.ok) return { ok: false, code: rs.problems[0] }
    e.hook('after_checkpoint_restored', { taskId })
  }
  const pack = await e.adapters.contextPack?.({ task }) ?? ''
  const p = composeRestorePrompt({ ledger: L, taskId, checkpoint, contextPackMarkdown: pack, stageInstruction: spec.instruction })
  return p.ok ? { ok: true, prompt: p.prompt } : { ok: false, code: p.code }
}

/** The renewal sequence. Any failure BEFORE the old session is verified stopped leaves the old lease in place (and the caller ends the stage as a failure). */
async function renew(e, taskId, spec, lease, dec) {
  const { ledger: L, adapters: A, cfg } = e
  // 1-2. stop starting new work (we are at a unit boundary) and capture the uncommitted scoped work (unsafe files are quarantined, never allowed to cost the safe ones)
  const cap = await captureWork(e, taskId, lease)
  // 3. the task enters context_recovery (CONTEXT_RENEWAL) BEFORE anything is torn down: a crash from here on is found in that state
  const resumeTo = L.getTask(taskId).state
  const t1 = L.transition(taskId, 'context_recovery', { reason_code: 'CONTEXT_RENEWAL' })
  if (!t1.ok) return { status: 'failed', code: t1.problems[0], fingerprint: fingerprint('renew-transition', t1.problems[0]) }
  // 4-5. persist then VERIFY the checkpoint for completeness and integrity (persistCheckpoint verifies and marks it)
  const p = persistCheckpoint(e, taskId, cap, { reason: `CONTEXT_RENEWAL:${dec.basis}`, stage: spec.stage, always: true, notes: await A.session.notes?.(lease) ?? '' })
  e.hook('after_checkpoint_recorded', { taskId })
  if (!p.ok) { L.transition(taskId, resumeTo); return { status: 'failed', code: p.problems?.[0] ?? 'CHECKPOINT.NOT_VERIFIED', fingerprint: fingerprint('checkpoint', p.problems?.[0]) } }
  e.hook('after_checkpoint_verified', { taskId })
  // 6-7. graceful stop, then INDEPENDENT verification of the stop before the slot is released
  const term = await safeTerminate(A, lease)
  const closed = L.closeLease(lease, { terminationVerified: term.verified, endReason: 'CONTEXT_RENEWAL' })
  if (!closed.ok || !term.verified) return { status: 'termination_unverified', code: 'RENEWAL.OLD_SESSION_NOT_VERIFIED_STOPPED' }
  e.hook('after_renewal_old_stopped', { taskId })
  // 7b. a FRESH session is a new admission: resource pressure, subscription eligibility, authentication, extra-usage freshness and cancellation are re-checked NOW. If denied, the verified
  // checkpoint and the verified stop above are exactly what the waiting state needs; no lease is acquired and nothing starts.
  const adm = await e.checkAdmission(taskId, e.needFor(spec.stage) ?? { stage: spec.stage, ai: true, profile: 'reasoning' })
  if (!adm.ok) return { ...admissionOutcome(adm), checkpointed: true }
  // 8. fresh lease and a fresh context (new context id), 9. restore and verify, 10. continue
  const next = L.acquireLease({ taskId, role: spec.role, stage: spec.stage, model: spec.route.model, effort: spec.route.effort, ttlMs: cfg.leaseTtlMs })
  if (!next.ok) return { status: 'failed', code: next.code, fingerprint: fingerprint('renew-lease', next.code) }
  e.hook('after_renewal_new_lease', { taskId })
  const back = L.transition(taskId, resumeTo)
  if (!back.ok) { L.closeLease(next.lease, { terminationVerified: (await safeTerminate(A, next.lease)).verified, endReason: 'RENEWAL_ABORTED' }); return { status: 'failed', code: back.problems[0], fingerprint: fingerprint('renew-resume', back.problems[0]) } }
  const pr = await buildPrompt(e, taskId, spec)
  if (!pr.ok) { L.closeLease(next.lease, { terminationVerified: (await safeTerminate(A, next.lease)).verified, endReason: 'RENEWAL_RESTORE_FAILED' }); return { status: 'failed', code: pr.code, fingerprint: fingerprint('renew-restore', pr.code) } }
  L.markExecutionRunning(next.lease.execution_id)
  L.recordRecovery(taskId, 'context_renewed', { basis: dec.basis, measured: dec.measured, utilization: dec.utilization, checkpoint: p.id, from: lease.execution_id, to: next.lease.execution_id })
  return { status: 'renewed', lease: next.lease, prompt: pr.prompt }
}
