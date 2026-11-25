// D3.3 D-3: bounded host-CPU sampling for isolation scenario 9. Deterministic: an injected clock, sleep, runner and sampler; no subprocess, no VM.
// The property under test is "retry only what could not be measured, never invent or hide a value, and prove it in the evidence".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import * as R from '../isolation/acceptance-rules.mjs'
import { BURN_SECONDS, BURN_WINDOW_S } from '../isolation/acceptance.mjs'
import { FULL_ATTEMPT_TIMEOUT_MS, HOST_CPU_SAMPLING_VERSION, MAX_PROCESS_FAILURES, MIN_BURN_SAMPLER_MS, parseTypeperf, parseTypeperfDetailed, sampleHostCpuWindow, sampleWindowsHost } from '../runtime/host-sampler.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const clone = (x) => JSON.parse(JSON.stringify(x))
const HEADER = '"(PDH-CSV 4.0)","\\\\H\\Memory\\Available MBytes","\\\\H\\Memory\\Committed Bytes","\\\\H\\Memory\\Commit Limit","\\\\H\\Memory\\Pages/sec","\\\\H\\Processor(_Total)\\% Processor Time"'
const csvWith = (cpuCell, avail = '3361') => `${HEADER}\r\n"t1","3400","21000000000","37259567104","0","0"\r\n"t2","${avail}","21400000000","37259567104","104.8","${cpuCell}"\r\n`

// ---- parser: every failure class is distinguishable and never becomes a number ----
test('typeperf parsing names each failure class and never substitutes a value', () => {
  const ok = parseTypeperfDetailed(csvWith('8.5'))
  assert.equal(ok.values.cpu_pct, 8.5); assert.deepEqual(ok.problems, {})
  const code = (csv, key = 'cpu_pct') => parseTypeperfDetailed(csv).problems[key]?.code
  assert.equal(code(csvWith(' ')), 'COUNTER.VALUE_BLANK')
  assert.equal(code(csvWith('')), 'COUNTER.VALUE_BLANK')
  assert.equal(code(csvWith('-1.#IND00')), 'COUNTER.VALUE_NON_NUMERIC')
  assert.equal(code(csvWith('1.2.3')), 'COUNTER.VALUE_NON_NUMERIC')
  assert.equal(code(csvWith('1e999')), 'COUNTER.VALUE_NON_NUMERIC', 'a non-finite number is not a measurement')
  assert.equal(code(csvWith('-3')), 'COUNTER.VALUE_NEGATIVE', 'a CPU % cannot be negative; it is not clamped to 0')
  assert.equal(code('garbage'), 'COUNTER.NO_ROWS')
  assert.equal(code(`${HEADER}\r\n`), 'COUNTER.NO_ROWS')
  assert.equal(code(csvWith('8.5').replace(',"\\\\H\\Processor(_Total)\\% Processor Time"', '')), 'COUNTER.COLUMN_MISSING')
  assert.equal(code(csvWith('8.5').replace(/,"8\.5"/, '')), 'COUNTER.ROW_SHORT')
  assert.equal(parseTypeperfDetailed(csvWith('?')).problems.cpu_pct.raw, '?', 'the raw cell is kept only as a sanitized, short diagnostic')
  assert.equal(parseTypeperfDetailed(csvWith('ab/c\\d e')).problems.cpu_pct.raw, 'ab?c?d?e', 'path and whitespace characters never reach the evidence')
  assert.ok(parseTypeperfDetailed(csvWith('x'.repeat(200))).problems.cpu_pct.raw.length <= 16)
  // a problem with one counter does not hide the others, and the legacy parser agrees with the detailed one
  const blank = parseTypeperfDetailed(csvWith(' '))
  assert.equal(blank.values.available_mb, 3361); assert.equal(blank.values.cpu_pct, null)
  assert.deepEqual(parseTypeperf(csvWith(' ')), blank.values)
  assert.deepEqual(Object.values(parseTypeperf('error')), [null, null, null, null, null])
})

// ---- the real sampler: failure classes surface; a failed subprocess yields no values ----
const fakeRunner = (res) => async () => res
const sampleVia = (res, opts = {}) => sampleWindowsHost({ diskPath: process.cwd(), runner: fakeRunner(res), ...opts })

test('sampleWindowsHost distinguishes timeout, spawn failure, non-zero exit, truncation, and bad counters', async () => {
  const good = await sampleVia({ ok: true, out: csvWith('12.5'), ms: 2100, code: null, exit_code: 0 })
  assert.equal(good.cpu_pct, 12.5); assert.equal(good.sampler_error, null); assert.deepEqual(good.counter_problems, {}); assert.equal(good.host_responsive, true)
  for (const [code, exit] of [['SAMPLER.TIMEOUT', null], ['SAMPLER.SPAWN_FAILED', null], ['SAMPLER.EXIT_NONZERO', 3], ['SAMPLER.OUTPUT_TOO_LARGE', null]]) {
    const s = await sampleVia({ ok: false, out: csvWith('99'), ms: 5, code, exit_code: exit })
    assert.equal(s.sampler_error, code); assert.equal(s.sampler_exit_code, exit)
    assert.equal(s.cpu_pct, null, `${code}: whatever the process printed, a failed run yields no value`); assert.equal(s.host_responsive, false)
  }
  const blank = await sampleVia({ ok: true, out: csvWith(' '), ms: 2000, code: null, exit_code: 0 })
  assert.equal(blank.sampler_error, null, 'typeperf itself succeeded'); assert.equal(blank.cpu_pct, null); assert.equal(blank.counter_problems.cpu_pct.code, 'COUNTER.VALUE_BLANK')
  assert.equal(blank.available_mb, 3361, 'the other counters stay readable')
  assert.equal((await sampleVia({ ok: true, out: csvWith('8'), ms: 16000, code: null, exit_code: 0 })).host_responsive, false, 'slow but measured: kept, and adverse')
  // the subprocess timeout is passed through (a deadline-bound caller bounds it)
  let seen = null
  await sampleWindowsHost({ diskPath: process.cwd(), typeperfTimeoutMs: 1234, runner: async (n, a, o) => { seen = o.timeoutMs; return { ok: false, out: '', ms: 1, code: 'SAMPLER.TIMEOUT', exit_code: null } } })
  assert.equal(seen, 1234)
})

// ---- the bounded window sampler ----
/** Virtual clock: sleeping and sampling move time forward; nothing real is waited for. */
function rig(script, { burnEndsAt = Infinity, deadlineMs = 30000, startMs = 8000 } = {}) {
  let t = 1_000_000; const origin = t
  const calls = []
  const now = () => t
  const sleep = async (ms) => { t += ms }
  const sample = async (args) => {
    const step = typeof script === 'function' ? script(calls.length, args, t - origin) : script[calls.length]
    calls.push({ at: t - origin, args })
    if (!step) throw new Error(`unscripted sample call #${calls.length}`)
    // The real runner kills the subprocess at its timeout; `overrun` models a kill that lands late.
    t += step.overrun ? step.ms : Math.min(step.ms ?? 2100, args.typeperfTimeoutMs)
    return step.res
  }
  t = origin + startMs
  const run = (extra = {}) => sampleHostCpuWindow({ diskPath: 'C:\\', origin, notBeforeAt: origin + startMs, deadlineAt: origin + deadlineMs, burnMs: 40000, burnEnded: () => t >= origin + burnEndsAt, sample, now, sleep, ...extra })
  return { run, calls, origin, now }
}
const okS = (cpu, o = {}) => ({ res: { sampler_error: null, sampler_exit_code: 0, counter_problems: {}, cpu_pct: cpu, available_mb: 3000, host_responsive: true, sampler_ms: 2100, ...o }, ms: o.ms })
const blankS = { res: { sampler_error: null, sampler_exit_code: 0, counter_problems: { cpu_pct: { code: 'COUNTER.VALUE_BLANK' } }, cpu_pct: null, available_mb: 3000, host_responsive: true, sampler_ms: 2000 }, ms: 2000 }
const failS = (code, exit = null, ms = 300) => ({ res: { sampler_error: code, sampler_exit_code: exit, counter_problems: {}, cpu_pct: null, available_mb: null, host_responsive: false, sampler_ms: ms }, ms })

test('successful sampling: three measured samples, one attempt each, inside the window', async () => {
  const r = rig([okS(12), okS(14), okS(11)]); const w = await r.run()
  assert.deepEqual(w.samples.map((s) => s.cpu_pct), [12, 14, 11]); assert.equal(w.attempts.length, 3); assert.equal(w.stop_reason, null)
  assert.ok(w.attempts.every((a) => a.outcome === 'accepted' && a.error === null && a.start_offset_ms >= 8000 && a.end_offset_ms <= 30000))
  assert.equal(w.version, HOST_CPU_SAMPLING_VERSION); assert.equal(w.version, R.S9_HOST_SAMPLING_VERSION)
  assert.deepEqual(w.window_ms, [8000, 30000])
  assert.ok(r.calls.every((c) => c.args.typeperfTimeoutMs <= 8000 && c.args.typeperfTimeoutMs > 0), 'every subprocess timeout is bounded')
})

test('a null measurement is retried and recovers; the failed attempt stays in the evidence', async () => {
  const r = rig([blankS, okS(13), okS(12), okS(11)]); const w = await r.run()
  assert.deepEqual(w.samples.map((s) => s.cpu_pct), [13, 12, 11])
  assert.equal(w.attempts.length, 4)
  const [bad, good] = w.attempts
  assert.deepEqual([bad.slot, bad.attempt, bad.outcome, bad.error, bad.cpu_pct], [0, 1, 'rejected_unmeasured', 'COUNTER.VALUE_BLANK', null])
  assert.deepEqual([good.slot, good.attempt, good.outcome, good.error, good.cpu_pct], [0, 2, 'accepted', null, 13])
  assert.equal(bad.counter_problems.cpu_pct.code, 'COUNTER.VALUE_BLANK')
  assert.equal(w.samples.filter((s) => s == null).length, 0)
})

test('persistent missing measurements stay null: bounded attempts, nothing substituted, and scenario 9 fails closed', async () => {
  const r = rig(() => blankS); const w = await r.run({ maxAttemptsPerSlot: 3 })
  assert.ok(w.samples.every((s) => s === null), 'no zero, average or cached value stands in for a missing sample')
  assert.equal(r.calls.length > 0 && w.attempts.filter((a) => a.slot === 0).length, 3, 'bounded per slot')
  assert.equal(w.stop_reason === 'ATTEMPTS_EXHAUSTED' || w.stop_reason === 'DEADLINE_EXHAUSTED', true)
  assert.ok(w.attempts.every((a) => a.outcome === 'rejected_unmeasured' && a.cpu_pct === null))
  const o = S9({ normal: { cpu: [null, null, null], sampling: w } })
  assert.ok(o.problems.includes('S9.HOST_CPU_CONTENDED')); assert.equal(o.verdict, 'FAIL')
})

test('non-zero exit and timeout are retried, recorded with their class, and a timeout counts against host responsiveness', async () => {
  const r = rig([failS('SAMPLER.EXIT_NONZERO', 1), failS('SAMPLER.TIMEOUT', null, 8000), okS(10), okS(11), okS(12)]); const w = await r.run()
  assert.deepEqual(w.samples.map((s) => s.cpu_pct), [10, 11, 12])
  assert.deepEqual(w.attempts.slice(0, 2).map((a) => [a.error, a.exit_code, a.outcome]), [['SAMPLER.EXIT_NONZERO', 1, 'rejected_unmeasured'], ['SAMPLER.TIMEOUT', null, 'rejected_unmeasured']])
  assert.ok(w.responsive.includes(false), 'a sampler that could not finish is adverse evidence about the host')
  const t = S9({ normal: { cpu: w.samples.map((s) => s.cpu_pct), sampling: w } })
  assert.ok(t.problems.includes('S9.HOST_NOT_RESPONSIVE'), 'the rule derives this from the attempts itself: a recovered timeout still fails responsiveness')
  const sp = rig([failS('SAMPLER.SPAWN_FAILED'), okS(10), okS(11), okS(12)]); const w2 = await sp.run()
  assert.equal(w2.attempts[0].error, 'SAMPLER.SPAWN_FAILED'); assert.equal(w2.samples[0].cpu_pct, 10)
  assert.ok(S9({ normal: { cpu: w2.samples.map((s) => s.cpu_pct), sampling: w2 } }).problems.includes('S9.HOST_NOT_RESPONSIVE'), 'a sampler that cannot even start is not a healthy host')
  // a single non-zero exit, recovered, is tolerated: it is a sampler hiccup, not a host verdict
  const nz = rig([failS('SAMPLER.EXIT_NONZERO', 1), okS(10), okS(11), okS(12)]); const w3 = await nz.run()
  assert.equal(S9({ normal: { cpu: w3.samples.map((s) => s.cpu_pct), sampling: w3 } }).verdict, 'PASS')
})

test('a measurement that is valid but over the ceiling is NOT retried and NOT discarded', async () => {
  const r = rig([okS(95), okS(12), okS(11)]); const w = await r.run()
  assert.equal(r.calls.length, 3, 'one attempt per slot: a high reading is a result, not a failure')
  assert.deepEqual(w.samples.map((s) => s.cpu_pct), [95, 12, 11])
  const o = S9({ normal: { cpu: [95, 12, 11], sampling: w } })
  assert.ok(o.problems.includes('S9.HOST_CPU_CONTENDED')); assert.ok(!o.problems.some((c) => /SAMPLING|OUTSIDE/.test(c)), 'the evidence is sound; the ceiling rule rejects the value')
  // a slow-but-measured sample is accepted as it is, and recorded as not responsive
  const slow = rig([okS(10, { host_responsive: false }), okS(11), okS(12)]); const ws = await slow.run()
  assert.equal(slow.calls.length, 3); assert.ok(ws.responsive.includes(false))
  assert.ok(S9({ normal: { cpu: ws.samples.map((s) => s.cpu_pct), sampling: ws } }).problems.includes('S9.HOST_NOT_RESPONSIVE'))
})

test('the sampling deadline is hard: no attempt starts without time to finish, a late result is recorded but never accepted', async () => {
  // Every attempt returns a blank CPU cell, slowly; the window closes before the third slot can be tried.
  const slowBlank = { res: { ...blankS.res, sampler_ms: 8000 }, ms: 8000 }
  const r = rig(() => slowBlank, { deadlineMs: 30000 }); const w = await r.run()
  assert.equal(w.stop_reason, 'DEADLINE_EXHAUSTED'); assert.ok(w.samples.every((s) => s === null))
  assert.ok(w.attempts.every((a) => a.end_offset_ms <= 30000 + 1), 'no attempt runs past the window end')
  assert.ok(r.calls.every((c) => c.args.typeperfTimeoutMs <= 30000 - c.at), 'each subprocess timeout is capped at the time left')
  // too little time left at the very start: nothing is even attempted
  const none = rig([], { startMs: 8000, deadlineMs: 8000 + 3000 }); const wn = await none.run()
  assert.equal(none.calls.length, 0); assert.equal(wn.stop_reason, 'DEADLINE_EXHAUSTED'); assert.equal(wn.attempts.length, 0); assert.ok(wn.samples.every((s) => s === null))
  // a measured sample that ends AFTER the deadline (a late kill / slow return) is kept as evidence but is not a measurement of the burn window
  const late = rig([okS(12), { ...okS(13), ms: 5000, overrun: true }, okS(14)], { deadlineMs: 15200, startMs: 8000 })
  const wl = await late.run()
  const lateAttempt = wl.attempts.find((a) => a.outcome === 'rejected_outside_window')
  assert.ok(lateAttempt, 'the late sample is recorded'); assert.equal(lateAttempt.cpu_pct, 13, 'its value is preserved as evidence')
  assert.ok(lateAttempt.end_offset_ms > 15200)
  assert.deepEqual(wl.samples.map((s) => s?.cpu_pct ?? null), [12, null, null], 'the late value is not counted, and no later slot is attempted')
  assert.equal(wl.stop_reason, 'DEADLINE_EXHAUSTED'); assert.equal(late.calls.length, 2)
})

test('measurements outside the burn window: the guest burn ending, or evidence outside the window, voids scenario 9', async () => {
  // the guest burn ends while we are sampling: nothing after that counts
  const r = rig([okS(10), okS(11), okS(12)], { burnEndsAt: 8000 + 2100 + 1500 + 1 }); const w = await r.run()
  assert.equal(w.samples[0].cpu_pct, 10); assert.equal(w.samples[1], null); assert.equal(w.stop_reason, 'BURN_ENDED')
  assert.ok(w.attempts.every((a) => a.outcome !== 'accepted' || a.slot === 0))
  // a rule-level check: tampered or out-of-window evidence cannot pass even with three finite values
  const early = S9({ normal: { cpu: [10, 11, 12], mutate: (hs) => { hs.attempts[0].start_offset_ms = 2000 } } })
  assert.ok(early.problems.includes('S9.HOST_CPU_SAMPLE_OUTSIDE_BURN_WINDOW'), 'before the window opens (start-up)')
  const lateRule = S9({ normal: { cpu: [10, 11, 12], mutate: (hs) => { hs.attempts[2].end_offset_ms = 31000 } } })
  assert.ok(lateRule.problems.includes('S9.HOST_CPU_SAMPLE_OUTSIDE_BURN_WINDOW'), 'after the window closes (teardown)')
  const afterBurn = S9({ capped: { cpu: [10, 11, 12], mutate: (hs) => { hs.burn_ended_offset_ms = 12000 } } })
  assert.ok(afterBurn.problems.includes('S9.HOST_CPU_SAMPLE_OUTSIDE_BURN_WINDOW'), 'a sample that ends after the guest burn ended')
  const wide = S9({ normal: { cpu: [10, 11, 12], mutate: (hs) => { hs.window_ms = [8000, 39000] } } })
  assert.ok(wide.problems.includes('S9.HOST_CPU_SAMPLING_WINDOW_INVALID'), 'the window must end well inside the burn')
  assert.ok(BURN_WINDOW_S[0] >= 5 && BURN_WINDOW_S[1] <= BURN_SECONDS - 4)
})

test('rule integrity: the evidence must prove what the sampler claims (no substituted, duplicated or unexplained values)', () => {
  const sp = (mutate) => S9({ normal: { cpu: [10, 11, 12], mutate } }).problems
  assert.deepEqual(S9({ normal: { cpu: [10, 11, 12] } }).problems, [], 'baseline passes')
  assert.ok(sp((hs) => { hs.attempts[1].cpu_pct = 99 }).includes('S9.HOST_CPU_SAMPLING_INCONSISTENT'), 'judged value differs from the accepted attempt')
  assert.ok(sp((hs) => { hs.attempts.push({ ...hs.attempts[0], attempt: 2 }) }).includes('S9.HOST_CPU_SAMPLING_INCONSISTENT'), 'a second accepted attempt in a slot / a retry after acceptance')
  assert.ok(sp((hs) => { hs.attempts[0].error = 'SAMPLER.TIMEOUT' }).includes('S9.HOST_CPU_SAMPLING_INCONSISTENT'), 'an accepted attempt cannot carry an error')
  assert.ok(sp((hs) => { hs.attempts = hs.attempts.slice(1) }).includes('S9.HOST_CPU_SAMPLING_INCONSISTENT'), 'a value with no attempt behind it')
  assert.ok(sp((hs) => { hs.attempts.unshift(...[1, 2, 3, 4].map((n) => ({ ...hs.attempts[0], attempt: n, outcome: 'rejected_unmeasured', cpu_pct: null, error: 'COUNTER.VALUE_BLANK' }))) }).includes('S9.HOST_CPU_SAMPLING_INCONSISTENT'), 'more attempts than the bound')
  assert.ok(sp((hs) => { hs.attempts.unshift({ ...hs.attempts[0], attempt: 1, outcome: 'rejected_unmeasured', cpu_pct: null, error: '' }) }).includes('S9.HOST_CPU_SAMPLING_INCONSISTENT'), 'a failed attempt must say why')
  assert.ok(sp((hs) => { hs.version = 0 }).includes('S9.HOST_CPU_SAMPLING_EVIDENCE_INVALID'))
  assert.ok(S9({ normal: { cpu: [10, 11, 12], drop: true } }).problems.includes('S9.HOST_CPU_SAMPLING_EVIDENCE_INVALID'), 'no evidence is not evidence')
  assert.ok(S9({ normal: { cpu: [10, 11, 12], mutate: (hs) => { hs.attempts[0].outcome = 'maybe' } } }).problems.includes('S9.HOST_CPU_SAMPLING_EVIDENCE_INVALID'))
})

test('failed-attempt diagnostics are preserved in the scenario 9 evidence record', async () => {
  const r = rig([blankS, failS('SAMPLER.EXIT_NONZERO', 1), okS(12), okS(13), okS(11)]); const w = await r.run()
  const o = S9({ normal: { cpu: w.samples.map((s) => s?.cpu_pct ?? null), sampling: w } })
  assert.equal(o.verdict, 'PASS', o.problems.join(','))
  const kept = o.evidence.cpu.normal.host_cpu_sampling
  assert.equal(kept.attempts.length, 5); assert.deepEqual(kept.attempts.filter((a) => a.outcome !== 'accepted').map((a) => a.error), ['COUNTER.VALUE_BLANK', 'SAMPLER.EXIT_NONZERO'])
  assert.deepEqual(kept.window_ms, [8000, 30000])
  const text = JSON.stringify(kept)
  assert.ok(!/[A-Za-z]:\\|\\\\|\/Users\//.test(text), 'no host path in the sampling evidence')
})

// ---- independent review findings (B-1, S-1 … S-5) ----
test('B-1: a retry can add evidence but never remove an adverse reading (low memory, high CPU, even from a rejected attempt)', async () => {
  // attempt 1: CPU cell blank but memory MEASURED low; the retry then looks healthy. The low reading must still fail the run.
  const lowMem = { res: { ...blankS.res, available_mb: 800 }, ms: 2000 }
  const a = rig([lowMem, okS(13), okS(12), okS(11)]); const wa = await a.run()
  assert.equal(wa.attempts[0].available_mb, 800, 'the measured value is kept on the rejected attempt'); assert.equal(wa.attempts[0].cpu_pct, null)
  assert.deepEqual(wa.samples.map((s) => s.cpu_pct), [13, 12, 11])
  const oa = S9({ normal: { cpu: wa.samples.map((s) => s.cpu_pct), sampling: wa } })
  assert.ok(oa.problems.includes('S9.HOST_MEMORY_LOW'), 'the rule recomputes the floor from every attempt, not from the accepted ones'); assert.equal(oa.verdict, 'FAIL')
  // attempt 1: CPU measured at 95 % but memory blank; the retry is healthy. The 95 % must still fail the run.
  const highCpu = { res: { sampler_error: null, sampler_exit_code: 0, counter_problems: { available_mb: { code: 'COUNTER.VALUE_BLANK' } }, cpu_pct: 95, available_mb: null, host_responsive: true, sampler_ms: 2000 }, ms: 2000 }
  const b = rig([highCpu, okS(12), okS(11), okS(10)]); const wb = await b.run()
  assert.deepEqual([wb.attempts[0].cpu_pct, wb.attempts[0].outcome, wb.attempts[0].error], [95, 'rejected_unmeasured', 'COUNTER.AVAILABLE_UNMEASURED'])
  const ob = S9({ normal: { cpu: wb.samples.map((s) => s.cpu_pct), sampling: wb } })
  assert.ok(ob.problems.includes('S9.HOST_CPU_CONTENDED'), 'a measured 95 % is judged even though that attempt was retried'); assert.equal(ob.verdict, 'FAIL')
  // a measurement taken just after the window (late return) is still adverse evidence
  const c = rig([okS(12), { ...okS(95), ms: 5000, overrun: true }, okS(14)], { deadlineMs: 15200, startMs: 8000 }); const wc = await c.run()
  assert.ok(S9({ normal: { cpu: wc.samples.map((s) => s?.cpu_pct ?? null), sampling: wc } }).problems.includes('S9.HOST_CPU_CONTENDED'))
  // caller-side minimum includes every attempt too (acceptance.mjs), and the real run's value is not inflated by it
  assert.ok(readFileSync(path.join(HERE, '..', 'isolation', 'acceptance.mjs'), 'utf8').includes('.flatMap((a) => [a.available_mb, a.unverified_available_mb]).filter(Number.isFinite)'))
})

test('S-3: a failed run is never a measurement, but a high CPU % it printed is kept and judged; process failures are bounded', async () => {
  const s = await sampleVia({ ok: false, out: csvWith('95'), ms: 5, code: 'SAMPLER.EXIT_NONZERO', exit_code: 1 })
  assert.equal(s.cpu_pct, null); assert.equal(s.unverified_cpu_pct, 95)
  assert.equal((await sampleVia({ ok: false, out: '', ms: 5, code: 'SAMPLER.SPAWN_FAILED', exit_code: null })).unverified_cpu_pct, null)
  assert.equal((await sampleVia({ ok: true, out: csvWith('8'), ms: 2100, code: null, exit_code: 0 })).unverified_cpu_pct, null)
  const r = rig([{ res: { ...failS('SAMPLER.EXIT_NONZERO', 1).res, unverified_cpu_pct: 95 }, ms: 300 }, okS(10), okS(11), okS(12)]); const w = await r.run()
  assert.equal(w.attempts[0].unverified_cpu_pct, 95)
  assert.ok(S9({ normal: { cpu: w.samples.map((x) => x.cpu_pct), sampling: w } }).problems.includes('S9.HOST_CPU_CONTENDED'))
  // more than two process-level failures per burn end the sampling and fail the run
  const many = rig(() => failS('SAMPLER.EXIT_NONZERO', 1)); const wm = await many.run()
  assert.equal(wm.stop_reason, 'PROCESS_FAILURES_EXCEEDED'); assert.equal(wm.attempts.length, R.S9_MAX_PROCESS_FAILURES + 1)
  const om = S9({ normal: { cpu: [null, null, null], sampling: wm } })
  assert.ok(om.problems.includes('S9.HOST_CPU_SAMPLING_PROCESS_FAILURES')); assert.equal(om.verdict, 'FAIL')
  assert.equal(S9({ normal: { cpu: [10, 11, 12], mutate: (hs) => { hs.attempts[0].error = 'SAMPLER.EXIT_NONZERO'; hs.attempts[0].outcome = 'rejected_unmeasured'; hs.attempts[0].cpu_pct = null } } }).problems.includes('S9.HOST_CPU_SAMPLING_PROCESS_FAILURES'), false, 'one is tolerated')
})

test('S-1: the rule rejects forged, reordered, duplicated, mislabelled or reused attempt records', () => {
  const run = (mutate, cpu = [10, 11, 12]) => S9({ normal: { cpu, mutate } }).problems
  const INC = 'S9.HOST_CPU_SAMPLING_INCONSISTENT'
  // a reading labelled "outside the window" while it was inside, followed by an accepted attempt (hides an adverse in-window reading)
  assert.ok(run((hs) => { hs.attempts.splice(0, 0, { ...hs.attempts[0], outcome: 'rejected_outside_window', cpu_pct: 95, end_offset_ms: 9000 }); hs.attempts[1].attempt = 2; hs.attempts[1].start_offset_ms = 9100 }).includes(INC))
  // an outside-window attempt that really is outside, but is not the last attempt overall
  assert.ok(run((hs) => { hs.attempts[0].outcome = 'rejected_outside_window'; hs.attempts[0].start_offset_ms = 100; hs.attempts[0].end_offset_ms = 2100 }).includes(INC))
  // the same accepted record copied into another slot (a cached/reused sample)
  assert.ok(run((hs) => { hs.attempts[1] = { ...hs.attempts[0], slot: 1 } }).includes(INC), 'overlapping/identical offsets')
  // chronology swapped, attempt numbers wrong, a slot skipped, slot order reversed
  assert.ok(run((hs) => { [hs.attempts[0], hs.attempts[1]] = [hs.attempts[1], hs.attempts[0]] }).includes(INC))
  assert.ok(run((hs) => { hs.attempts[1].attempt = 2 }).includes(INC))
  assert.ok(run((hs) => { hs.attempts[1].slot = 2; hs.attempts[2].slot = 1 }).includes(INC))
  // a failed attempt that is actually a clean measurement, or has no reason
  assert.ok(run((hs) => { hs.attempts.unshift({ ...hs.attempts[0], outcome: 'rejected_unmeasured', error: 'COUNTER.VALUE_BLANK', cpu_pct: 10, available_mb: 3000, start_offset_ms: 8100, end_offset_ms: 8300 }); hs.attempts[1].attempt = 2; hs.attempts[1].start_offset_ms = 8500 }).includes(INC), 'error code on a clean measurement is still a clean measurement')
  // an accepted attempt must be a clean, long-enough, responsive run with both counters measured
  assert.ok(run((hs) => { hs.attempts[0].available_mb = null }).includes(INC))
  assert.ok(run((hs) => { hs.attempts[0].sampler_ms = 100 }).includes(INC), 'a run too short to span the interval')
  assert.ok(run((hs) => { hs.attempts[0].host_responsive = false }).includes('S9.HOST_NOT_RESPONSIVE'))
  assert.ok(run((hs) => { hs.attempts[0].cpu_pct = -4 }, [-4, 11, 12]).includes('S9.HOST_CPU_CONTENDED'), 'a negative CPU % is never an idle host')
  assert.ok(S9({ normal: { cpu: [-1, 11, 12] } }).problems.includes('S9.HOST_CPU_CONTENDED'))
})

test('S-4: burn, window, retry bound and the guest burn end are pinned by the rule, not read from the record', () => {
  const run = (mutate) => S9({ normal: { cpu: [10, 11, 12], mutate } }).problems
  assert.ok(run((hs) => { hs.burn_ms = 1e9; hs.window_ms = [8000, 900000] }).includes('S9.HOST_CPU_SAMPLING_WINDOW_INVALID'))
  assert.ok(run((hs) => { hs.burn_ms = 1e9 }).includes('S9.HOST_CPU_SAMPLING_WINDOW_INVALID'))
  assert.ok(run((hs) => { hs.window_ms = [0, 30000] }).includes('S9.HOST_CPU_SAMPLING_WINDOW_INVALID'))
  assert.ok(run((hs) => { hs.max_attempts_per_slot = 5 }).includes('S9.HOST_CPU_SAMPLING_EVIDENCE_INVALID'))
  assert.ok(run((hs) => { hs.burn_ended_offset_ms = null }).includes('S9.HOST_CPU_SAMPLING_EVIDENCE_INVALID'), 'the guest burn end must be recorded')
  assert.ok(run((hs) => { hs.burn_ended_offset_ms = 29000 }).includes('S9.HOST_CPU_SAMPLE_OUTSIDE_BURN_WINDOW'), 'the guest burn ended before the window closed')
  // the pinned values equal the ones the run actually uses
  assert.equal(R.S9_BURN_MS, BURN_SECONDS * 1000); assert.deepEqual([...R.S9_BURN_WINDOW_MS], BURN_WINDOW_S.map((s) => s * 1000))
  assert.equal(R.S9_MAX_PROCESS_FAILURES, MAX_PROCESS_FAILURES); assert.equal(R.S9_MIN_SAMPLER_MS, MIN_BURN_SAMPLER_MS)
})

test('R2-B1: a one-row typeperf run has no rate (CPU, paging) but its gauge readings (memory) are kept, adverse ones included', async () => {
  const oneRowMem = (avail) => `${HEADER}\r\n"t2","${avail}","21400000000","37259567104","104.8","8.5"\r\n`
  const d = parseTypeperfDetailed(oneRowMem(800))
  assert.equal(d.values.available_mb, 800, 'Available MBytes is a gauge: the first row is a real reading'); assert.equal(d.values.committed_bytes, 21400000000)
  assert.equal(d.problems.cpu_pct.code, 'COUNTER.TOO_FEW_ROWS'); assert.equal(d.problems.paging_pages_per_sec.code, 'COUNTER.TOO_FEW_ROWS')
  assert.equal(d.values.cpu_pct, null, 'a rate from one collection is never a value (and never the fake 0 % first row)'); assert.equal(d.values.paging_pages_per_sec, null)
  // the mid-run sample keeps its memory reading (it is not retried), so a healthy early exit cannot become a false FAIL and a low one is not lost
  const mid = await sampleVia({ ok: true, out: oneRowMem(2600), ms: 1500, code: null, exit_code: 0 })
  assert.equal(mid.available_mb, 2600); assert.equal(mid.cpu_pct, null)
  // a one-row run showing LOW memory, then a healthy retry: the low reading must still fail the run
  const early = await sampleVia({ ok: true, out: oneRowMem(800), ms: 2000, code: null, exit_code: 0 })
  const lowThenOk = rig([{ res: early, ms: 2000 }, okS(13), okS(12), okS(11)]); const w = await lowThenOk.run()
  assert.deepEqual([w.attempts[0].available_mb, w.attempts[0].cpu_pct, w.attempts[0].outcome, w.attempts[0].error], [800, null, 'rejected_unmeasured', 'COUNTER.TOO_FEW_ROWS'])
  const o = S9({ normal: { cpu: w.samples.map((s) => s.cpu_pct), sampling: w } })
  assert.ok(o.problems.includes('S9.HOST_MEMORY_LOW')); assert.equal(o.verdict, 'FAIL')
  // a FAILED run that printed low memory keeps it as an unverified reading, judged the same way
  const failed = await sampleVia({ ok: false, out: oneRowMem(700), ms: 40, code: 'SAMPLER.EXIT_NONZERO', exit_code: 1 })
  assert.equal(failed.available_mb, null); assert.equal(failed.unverified_available_mb, 700)
  const f = rig([{ res: failed, ms: 300 }, okS(13), okS(12), okS(11)]); const wf = await f.run()
  assert.equal(wf.attempts[0].unverified_available_mb, 700)
  assert.ok(S9({ normal: { cpu: wf.samples.map((s) => s.cpu_pct), sampling: wf } }).problems.includes('S9.HOST_MEMORY_LOW'))
  assert.ok(readFileSync(path.join(HERE, '..', 'isolation', 'acceptance.mjs'), 'utf8').includes('[a.available_mb, a.unverified_available_mb]'), 'the reported minimum includes unverified readings')
})

test('R2-S1: a timeout cut short by the window deadline is not a host-responsiveness failure; a full-budget timeout is', async () => {
  // time left is only 4000 ms when the attempt starts: its timeout is 4000, not 8000
  const short = rig([blankS, failS('SAMPLER.TIMEOUT', null, 8000)], { deadlineMs: 8000 + 2000 + 500 + 4000, startMs: 8000 }); const ws = await short.run()
  const cut = ws.attempts.find((a) => a.error === 'SAMPLER.TIMEOUT')
  assert.ok(cut, 'the cut-short timeout is recorded'); assert.ok(cut.timeout_ms < R.S9_FULL_ATTEMPT_TIMEOUT_MS)
  assert.ok(!ws.responsive.includes(false), 'the sampler does not blame the host for a deadline-capped kill')
  const oShort = S9({ normal: { cpu: ws.samples.map((s) => s?.cpu_pct ?? null), sampling: ws } })
  assert.ok(!oShort.problems.includes('S9.HOST_NOT_RESPONSIVE')); assert.ok(oShort.problems.includes('S9.HOST_CPU_CONTENDED'), 'the slot is unmeasured, so the run still fails closed')
  // a timeout that used the full budget is adverse, and the rule agrees on its own
  const full = rig([failS('SAMPLER.TIMEOUT', null, 8000), okS(10), okS(11), okS(12)]); const wf = await full.run()
  assert.equal(wf.attempts[0].timeout_ms, R.S9_FULL_ATTEMPT_TIMEOUT_MS); assert.ok(wf.responsive.includes(false))
  assert.ok(S9({ normal: { cpu: wf.samples.map((s) => s.cpu_pct), sampling: wf } }).problems.includes('S9.HOST_NOT_RESPONSIVE'))
  assert.equal(R.S9_FULL_ATTEMPT_TIMEOUT_MS, FULL_ATTEMPT_TIMEOUT_MS)
  // R3-S1: the timeout a record claims must be the full budget or exactly the time left; a shorter claim cannot launder a timeout
  assert.ok(S9({ normal: { cpu: [10, 11, 12], mutate: (hs) => { hs.attempts[0].timeout_ms = 5000 } } }).problems.includes('S9.HOST_CPU_SAMPLING_INCONSISTENT'))
  assert.ok(S9({ normal: { cpu: [10, 11, 12], mutate: (hs) => { hs.attempts[0].timeout_ms = 9000 } } }).problems.includes('S9.HOST_CPU_SAMPLING_INCONSISTENT'))
  assert.ok(S9({ normal: { cpu: [10, 11, 12], mutate: (hs) => { delete hs.attempts[0].timeout_ms } } }).problems.includes('S9.HOST_CPU_SAMPLING_EVIDENCE_INVALID'), 'the timeout used is part of the evidence')
})

test('S-5: a typeperf run that returned too fast is not an interval measurement', async () => {
  const oneRow = `${HEADER}\r\n"t2","3361","21400000000","37259567104","104.8","8.5"\r\n`
  assert.equal(parseTypeperf(oneRow).cpu_pct, null)
  const s = await sampleVia({ ok: true, out: oneRow, ms: 2000, code: null, exit_code: 0 })
  assert.equal(s.cpu_pct, null); assert.equal(s.counter_problems.cpu_pct.code, 'COUNTER.TOO_FEW_ROWS')
  const fast = { res: { sampler_error: null, sampler_exit_code: 0, counter_problems: {}, cpu_pct: 20, available_mb: 3000, host_responsive: true, sampler_ms: 120 }, ms: 120 }
  const r = rig([fast, okS(12), okS(11), okS(10)]); const w = await r.run()
  assert.deepEqual([w.attempts[0].error, w.attempts[0].outcome, w.attempts[0].cpu_pct], ['SAMPLER.TOO_FAST', 'rejected_unmeasured', 20])
  assert.deepEqual(w.samples.map((x) => x.cpu_pct), [12, 11, 10])
})

// ---- scenario 9 harness: a full, valid evidence set with the burn under test replaced ----
const cleanEvidence = (cpu) => ({ version: 1, slots: 3, max_attempts_per_slot: 3, window_ms: [8000, 30000], burn_ms: 40000, burn_ended_offset_ms: 41000, stop_reason: null,
  attempts: cpu.map((v, slot) => ({ slot, attempt: 1, start_offset_ms: 8500 + slot * 3500, end_offset_ms: 10600 + slot * 3500, sampler_ms: 2100, timeout_ms: 8000, error: null, exit_code: 0, counter_problems: {}, cpu_pct: v, available_mb: 3000, unverified_cpu_pct: null, unverified_available_mb: null, host_responsive: true, outcome: 'accepted' })) })
/** over.normal / over.capped = { cpu: [3 values], sampling?: window result from the sampler, mutate?: (evidence) => void, drop?: true } */
function S9(over) {
  const burn = (i) => ({ iterations: i, cpu_seconds: 59.8, reports: 2, busy_pct: 99, seconds: 30, workers: 2, cpus: 2 })
  const side = (which, cap, job, iterations, cpu) => {
    const o = over[which]
    const b = { capPct: cap, job, burn: burn(iterations), hostCpuPct: o?.cpu ?? cpu, qemuHostCpuPct: cap === 40 ? 10.4 : 5.0 }
    // exactly what production persists: the sampler's window facts, without the raw sample objects or the responsiveness list
    const { samples: _s, responsive: _r, ...kept } = o?.sampling ? clone(o.sampling) : cleanEvidence(o?.cpu ?? cpu)
    if (kept.burn_ended_offset_ms === undefined) kept.burn_ended_offset_ms = 41000 // production sets this from the guest burn's own ssh session end
    kept.burn_ms = 40000
    o?.mutate?.(kept)
    if (!o?.drop) b.hostSampling = kept
    return b
  }
  return R.evalS9({ alloc: { exitCode: 137, outcome: 'oom_killed' }, qemuAliveAfterAlloc: true, qemuWorkingSetMb: 1853, memoryLimitMb: 2304, hostAvailableMbMin: 2600, hostResponsive: [true, true, true],
    cpu: { logicalCpus: 20, vcpus: 2, normal: side('normal', 40, { flags: 5, rate: 4000 }, 100000, [16, 18, 15]), capped: side('capped', 5, { flags: 5, rate: 500 }, 51000, [12, 11, 13]) } })
}

// ---- trusted-closure hygiene for the changed files ----
test('the sampler keeps absolute system executable paths and a restricted subprocess environment', () => {
  const src = readFileSync(path.join(HERE, '..', 'runtime', 'host-sampler.mjs'), 'utf8')
  assert.match(src, /typeperf: `\$\{SYS32\}\\\\typeperf\.exe`/); assert.match(src, /tasklist: `\$\{SYS32\}\\\\tasklist\.exe`/)
  assert.ok(src.includes("const SYS32 = `${process.env.SYSTEMROOT ?? 'C:\\\\Windows'}\\\\System32`"))
  assert.ok(/env: \{ SYSTEMROOT: process\.env\.SYSTEMROOT, SYSTEMDRIVE: process\.env\.SYSTEMDRIVE, PATH: /.test(src), 'the subprocess environment is an explicit allow-list')
  assert.ok(!/spawn(Sync)?\(\s*['"`](typeperf|tasklist)/.test(src), 'no bare tool name is ever spawned')
  const acc = readFileSync(path.join(HERE, '..', 'isolation', 'acceptance.mjs'), 'utf8')
  assert.ok(!/ownedPids: rec\?\.qemu_pid \? \[rec\.qemu_pid\] : \[\] \}\)\); await sleep\(1500\)/.test(acc), 'the old unbounded three-shot loop is gone')
  assert.ok(acc.includes('sampleHostCpuWindow(') && acc.includes('burnEnded: () => burnEndedAt !== null'))
})
