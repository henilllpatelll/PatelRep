// Developer Harness V3 (D3.5-D) — resumable, unit-granular test execution and deterministic RESOURCE-INTERRUPTION handling.
//
// Acceptance source: the REAL 2026-11-26 interruption recorded in doc 23 (a sequential Node 22 run reaped by the host's low-memory reaper during `d34-crash`, ~1.4 GB of
// 16 GB free, an idle reviewer alive, the owner's dev servers resident; the interrupted file rerun alone passed 33/33). Rules implemented here:
//   1. An INCOMPLETE run is never a regression. A unit is classified from evidence: `passed`, `genuine_failure` (a COMPLETE run that reports failures),
//      `verified_resource_kill` (an interruption signature AND independent resource evidence: a low-memory reaper record in the unit's window, or an external kill signal
//      while free memory was below the floor) or `ambiguous_interruption` (anything else incomplete). Interruptions spend NO remediation budget and record no failure fingerprint.
//   2. Completed units are FINAL (schema V3 trigger): a resumed run re-runs the INTERRUPTED unit first, then only the units that never completed.
//   3. Waiting is a persisted state with a next-eligible time (no polling loop in the engine, a bounded timer in the host CLI), re-admitted with hysteresis against the
//      host runner's free-memory FLOOR: 3072 MB for the 1 GB-heap sequential runner (the recorded conservative floor; NOT the D3.3 VM provisioning threshold).
//   4. Before waiting, only resources this task OWNS and that are idle (an idle review agent) are released, through the cleanup authority (cleanup.mjs). Unrelated
//      processes (the owner's dev servers, editors) are never touched, and no memory protection or reaper is ever bypassed.
//   5. Bounded: ambiguous reruns per unit, resource interruptions per unit and the total wait are capped; beyond them a TECHNICAL suspension with one diagnostic package.
import { createHash } from 'node:crypto'
import { executeCleanup, planTaskCleanup } from './cleanup.mjs'

export const UNIT_DEFAULTS = Object.freeze({ runnerHeapMb: 1024, freeFloorMb: 3072, clearSamples: 3, sampleIntervalMs: 15_000, maxWaitMs: 4 * 3600_000, maxAmbiguousReruns: 2, maxResourceInterruptions: 6, evidenceWindowMs: 60_000 })
const UNIT_ID = /^[A-Za-z0-9._-]{1,120}$/
const INTERRUPTED = ['interrupted_resource', 'interrupted_ambiguous']

export const groupIdFor = (parts) => `ug-${createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24)}`

/** Idempotent: create the group's units (in order). The unit list of a group is fixed: a different list is a different group. */
export function openGroup(L, { groupId, taskId = null, units, candidate = {} }) {
  if (!Array.isArray(units) || !units.length || units.length > 500 || !units.every((u) => typeof u === 'string' && UNIT_ID.test(u)) || new Set(units).size !== units.length) throw new Error('UNITS.MALFORMED')
  return L.tx(() => {
    const have = L.db.prepare('SELECT unit_id FROM test_units WHERE group_id=? ORDER BY ordinal').all(groupId).map((r) => r.unit_id)
    if (have.length) { if (have.join('\n') !== units.join('\n')) throw new Error('UNITS.GROUP_MISMATCH'); return { created: false } }
    const now = L.now()
    units.forEach((u, i) => L.db.prepare('INSERT INTO test_units(group_id,unit_id,task_id,ordinal,candidate_sha,tree_digest,status,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(groupId, u, taskId, i, candidate.candidate_sha ?? null, candidate.tree_digest ?? null, 'pending', now))
    return { created: true }
  })
}
export const unitsOf = (L, groupId) => L.db.prepare('SELECT * FROM test_units WHERE group_id=? ORDER BY ordinal').all(groupId).map((r) => ({ ...r, result: JSON.parse(r.result_json) }))

/** The next unit to run: an INTERRUPTED unit first (decides resource exhaustion vs regression), then the never-completed ones in order. */
export function nextUnit(L, groupId) {
  const us = unitsOf(L, groupId)
  return us.find((u) => INTERRUPTED.includes(u.status)) ?? us.find((u) => u.status === 'pending') ?? null
}

export function startUnit(L, groupId, unitId, meta = {}) {
  L.db.prepare("UPDATE test_units SET status='running', attempts=attempts+1, result_json=?, updated_at=? WHERE group_id=? AND unit_id=? AND status IN ('pending','interrupted_resource','interrupted_ambiguous')").run(JSON.stringify({ started_at: L.now(), ...meta }), L.now(), groupId, unitId)
}

/**
 * Classify one unit's outcome from evidence only.
 * @param {{status:number|null, signal?:string|null, timedOut?:boolean, counts?:object|null, lost?:boolean, startedAt:number, endedAt?:number|null, samples?:{at:number,free_mb:number}[], reaper?:{kind:string,at:number}|null}} o
 */
export function classifyUnit(o, cfg = UNIT_DEFAULTS) {
  const c = o.counts ?? null
  const finite = !!c && ['tests', 'pass', 'fail'].every((k) => Number.isFinite(c[k]))
  const complete = finite && c.tests > 0 && !o.signal && !o.timedOut && !o.lost && Number.isInteger(o.status) && !(c.cancelled > 0)
  if (complete && c.fail === 0 && c.pass === c.tests && !(c.skipped > 0) && o.status === 0) return { kind: 'passed' }
  if (complete && (c.fail > 0 || c.skipped > 0)) return { kind: 'genuine_failure', evidence: { fail: c.fail, skipped: c.skipped ?? 0 } } // a complete run that reports failures (or forbidden skips) IS a result
  const lo = o.startedAt - cfg.evidenceWindowMs; const hi = (o.endedAt ?? o.startedAt) + cfg.evidenceWindowMs
  const inWindow = (o.samples ?? []).filter((s) => s.at >= lo && s.at <= hi && Number.isFinite(s.free_mb))
  const minFree = inWindow.length ? Math.min(...inWindow.map((s) => s.free_mb)) : null
  const low = minFree !== null && minFree < cfg.freeFloorMb
  const reaped = !!o.reaper && o.reaper.kind === 'low_memory_reaper' && Number.isFinite(o.reaper.at) && o.reaper.at >= lo && o.reaper.at <= (o.lost ? Number.MAX_SAFE_INTEGER : hi)
  const evidence = { signal: o.signal ?? null, lost: !!o.lost, timed_out: !!o.timedOut, min_free_mb: minFree, reaper: reaped, partial: finite ? { tests: c.tests, pass: c.pass, fail: c.fail } : null }
  if (reaped || (low && !!o.signal)) return { kind: 'verified_resource_kill', evidence }
  return { kind: 'ambiguous_interruption', evidence }
}

const STATUS = { passed: 'passed', genuine_failure: 'failed', verified_resource_kill: 'interrupted_resource', ambiguous_interruption: 'interrupted_ambiguous' }
export function recordOutcome(L, groupId, unitId, cls, raw = {}) {
  const status = STATUS[cls.kind]; if (!status) throw new Error('UNITS.BAD_CLASSIFICATION')
  const result = { kind: cls.kind, evidence: cls.evidence ?? null, counts: raw.counts ?? null, ended_at: L.now() }
  L.db.prepare(`UPDATE test_units SET status=?, interruptions=interruptions+?, result_json=?, updated_at=? WHERE group_id=? AND unit_id=? AND status='running'`).run(status, INTERRUPTED.includes(status) ? 1 : 0, JSON.stringify(result), L.now(), groupId, unitId)
}

/** A runner (or controller) that died mid-unit leaves the unit `running`: it is classified as LOST from the evidence available now, never as a failure. */
export function markLost(L, groupId, { samples = [], reaper = null } = {}, cfg = UNIT_DEFAULTS) {
  const out = []
  for (const u of unitsOf(L, groupId).filter((x) => x.status === 'running')) {
    const cls = classifyUnit({ status: null, lost: true, startedAt: u.result.started_at ?? u.updated_at, endedAt: null, samples, reaper }, cfg)
    recordOutcome(L, groupId, u.unit_id, cls); out.push({ unit: u.unit_id, ...cls })
  }
  return out
}

/** Hysteresis admission against the host runner floor: the last `clearSamples` samples must ALL be at or above the floor. */
export function admitUnit(samples, cfg = UNIT_DEFAULTS) {
  const last = (samples ?? []).slice(-cfg.clearSamples)
  if (last.length < cfg.clearSamples) return { admit: false, code: 'RESOURCE.UNIT_FLOOR_SAMPLES_INSUFFICIENT' }
  if (last.some((s) => !Number.isFinite(s.free_mb))) return { admit: false, code: 'RESOURCE.METRIC_UNAVAILABLE:free_mb' }
  return last.every((s) => s.free_mb >= cfg.freeFloorMb) ? { admit: true } : { admit: false, code: 'RESOURCE.BELOW_UNIT_FLOOR' }
}
export function summarize(L, groupId) {
  const us = unitsOf(L, groupId); const by = (s) => us.filter((u) => u.status === s).length
  const sum = (k) => us.reduce((n, u) => n + (Number.isFinite(u.result?.counts?.[k]) && u.status !== 'interrupted_resource' && u.status !== 'interrupted_ambiguous' ? u.result.counts[k] : 0), 0)
  return { units: us.length, passed: by('passed'), failed: by('failed'), pending: by('pending'), interrupted: by('interrupted_resource') + by('interrupted_ambiguous'), running: by('running'), tests: sum('tests'), pass: sum('pass'), fail: sum('fail') }
}

// ------------------------------------------------------------------------------------------------------------- engine integration (stages.testing)
export const recordSample = (L, taskId, context, s) => L.db.prepare('INSERT INTO resource_samples(task_id,context,sample_json,at) VALUES (?,?,?,?)').run(taskId, context, JSON.stringify(s), s.at)
export const recentSamples = (L, taskId, context, n = 20) => L.db.prepare('SELECT sample_json FROM resource_samples WHERE task_id IS ? AND context=? ORDER BY sample_id DESC LIMIT ?').all(taskId, context, n).map((r) => JSON.parse(r.sample_json)).reverse()

async function sampleFree(e, taskId) {
  const s = await e.adapters.resources.sample(); const x = { at: e.ledger.now(), free_mb: s?.host?.available_mb ?? null }
  recordSample(e.ledger, taskId, 'test_unit', x); return x
}

/** Release ONLY idle resources this task owns (an idle reviewer) through the cleanup authority. Never anything unregistered or another task's. */
export async function releaseIdleOwned(e, taskId) {
  const A = e.adapters
  if (!A.cleanup || !A.procFacts) { e.ledger.recordRecovery(taskId, 'idle_release_skipped', { reason: 'NO_CLEANUP_EXECUTOR' }); return [] }
  const p = await planTaskCleanup(e, taskId, { procFacts: A.procFacts, kinds: ['review_agent', 'test_process'] })
  if (!p.ok) return []
  const r = await executeCleanup(e, p, { executor: A.cleanup, dryRun: false })
  const freed = (r.results ?? []).filter((x) => x.status === 'verified').map((x) => x.id)
  e.ledger.recordRecovery(taskId, 'idle_owned_released', { freed, refused: p.plan.refused.map((x) => ({ id: x.id, codes: x.codes.slice(0, 3) })) })
  return freed
}

/** The per-task waiting record for a resource wait: bounded total wait, persisted next-eligible time, and the floor the resume check must see. */
function waitFor(e, taskId, { groupId, unit, code }) {
  const L = e.ledger; const cfg = { ...UNIT_DEFAULTS, ...(e.cfg.units ?? {}) }; const now = L.now()
  const since = Number(L.meta(`unit_wait_since:${groupId}`) ?? now); if (!L.meta(`unit_wait_since:${groupId}`)) L.setMeta(`unit_wait_since:${groupId}`, now)
  if (now - since > cfg.maxWaitMs) return { suspend: true, cause: 'RESOURCE_WAIT_EXCEEDED', codes: [code] }
  return { wait: { kind: 'wait', state: 'waiting_resources', reason: 'MEMORY_PRESSURE', eligible_at: now + cfg.sampleIntervalMs, codes: [code], detail: { resume_check: 'unit_floor', min_free_mb: cfg.freeFloorMb, clear_samples: cfg.clearSamples, group_id: groupId, unit } } }
}

/**
 * Run (or resume) the candidate's test UNITS. @returns {Promise<{done:true,res:object}|{wait:object}|{suspend:true,cause:string,codes:string[]}>}
 * Adapter contract: tests.units({task,candidate}) → string[]; tests.runUnit({task,candidate,unit}) → {status, signal?, timedOut?, counts, reaper?}.
 */
export async function runTestUnits(e, taskId, task, cand) {
  const L = e.ledger; const A = e.adapters; const cfg = { ...UNIT_DEFAULTS, ...(e.cfg.units ?? {}) }
  const units = await A.tests.units({ task, candidate: cand })
  const groupId = groupIdFor({ task: taskId, candidate: cand.candidate_sha, tree: cand.tree_digest, token: task.fencing_token, units })
  openGroup(L, { groupId, taskId, units, candidate: cand })
  const lost = markLost(L, groupId, { samples: recentSamples(L, taskId, 'test_unit'), reaper: await A.tests.reaperRecord?.() ?? null }, cfg)
  for (const x of lost) L.recordRecovery(taskId, 'test_unit_interrupted', { group_id: groupId, unit: x.unit, kind: x.kind, lost: true, evidence: x.evidence })
  for (let guard = 0; guard < units.length * (cfg.maxResourceInterruptions + cfg.maxAmbiguousReruns + 2); guard += 1) {
    const u = nextUnit(L, groupId)
    if (!u) break
    if (u.status === 'interrupted_ambiguous' && u.interruptions > cfg.maxAmbiguousReruns) return { suspend: true, cause: 'TEST_UNIT_INTERRUPTED_REPEATEDLY', codes: [`UNIT:${u.unit_id}:ambiguous`] }
    if (u.status === 'interrupted_resource' && u.interruptions > cfg.maxResourceInterruptions) return { suspend: true, cause: 'TEST_UNIT_INTERRUPTED_REPEATEDLY', codes: [`UNIT:${u.unit_id}:resource`] }
    await sampleFree(e, taskId)
    const adm = admitUnit(recentSamples(L, taskId, 'test_unit'), cfg)
    if (!adm.admit && recentSamples(L, taskId, 'test_unit').length >= cfg.clearSamples) { await releaseIdleOwned(e, taskId); return waitFor(e, taskId, { groupId, unit: u.unit_id, code: adm.code }) }
    if (!adm.admit) continue // not enough samples yet: take another (deterministic, bounded by the guard)
    L.db.prepare('DELETE FROM meta WHERE key=?').run(`unit_wait_since:${groupId}`)
    const startedAt = L.now(); startUnit(L, groupId, u.unit_id, { rerun_of: INTERRUPTED.includes(u.status) ? u.status : null })
    e.hook('after_unit_started', { taskId, unit: u.unit_id })
    let raw
    try { raw = await A.tests.runUnit({ task, candidate: cand, unit: u.unit_id }) } catch { raw = { status: null, lost: true } }
    await sampleFree(e, taskId)
    const cls = classifyUnit({ ...raw, startedAt, endedAt: L.now(), samples: recentSamples(L, taskId, 'test_unit'), reaper: raw?.reaper ?? null }, cfg)
    recordOutcome(L, groupId, u.unit_id, cls, raw)
    e.hook('after_unit_recorded', { taskId, unit: u.unit_id, kind: cls.kind })
    if (cls.kind === 'verified_resource_kill' || cls.kind === 'ambiguous_interruption') {
      L.recordRecovery(taskId, 'test_unit_interrupted', { group_id: groupId, unit: u.unit_id, kind: cls.kind, evidence: cls.evidence, completed: summarize(L, groupId).passed })
      await releaseIdleOwned(e, taskId)
      return waitFor(e, taskId, { groupId, unit: u.unit_id, code: `RESOURCE.TEST_UNIT_INTERRUPTED:${cls.kind}` })
    }
  }
  const s = summarize(L, groupId)
  if (s.pending || s.interrupted || s.running) return { wait: { kind: 'wait', state: 'waiting_resources', reason: 'MEMORY_PRESSURE', eligible_at: L.now() + cfg.sampleIntervalMs, codes: ['RESOURCE.UNITS_INCOMPLETE'] } }
  const failedUnits = unitsOf(L, groupId).filter((u) => u.status === 'failed').map((u) => u.unit_id)
  return { done: true, res: { passed: failedUnits.length === 0, results: { passed: s.pass, failed: s.fail, skipped: 0, units: s.units, group_id: groupId }, fingerprint: failedUnits.length ? `units:${failedUnits.join('+')}`.slice(0, 100) : null, summary: failedUnits.length ? `failing units: ${failedUnits.join(', ')}` : '' } }
}

/** Engine.tryResume hook for a `unit_floor` wait: re-sample and re-admit WITHOUT a lifecycle transition until the floor holds (no event flapping). */
export async function unitFloorReady(e, taskId, w) {
  const cfg = { ...UNIT_DEFAULTS, ...(e.cfg.units ?? {}), freeFloorMb: w.detail.min_free_mb, clearSamples: w.detail.clear_samples }
  await sampleFree(e, taskId)
  const adm = admitUnit(recentSamples(e.ledger, taskId, 'test_unit'), cfg)
  if (adm.admit) return { ready: true }
  const since = Number(e.ledger.meta(`unit_wait_since:${w.detail.group_id}`) ?? e.ledger.now())
  if (e.ledger.now() - since > (e.cfg.units?.maxWaitMs ?? UNIT_DEFAULTS.maxWaitMs)) return { ready: false, suspend: true }
  return { ready: false, eligible_at: e.ledger.now() + (e.cfg.units?.sampleIntervalMs ?? UNIT_DEFAULTS.sampleIntervalMs) }
}
