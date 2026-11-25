// Developer Harness V3 (D3.3) — resource measurement (Windows host + Linux worker guest).
//
// Supported interfaces only: Windows performance counters via the built-in `typeperf` (small native tool, one short sample), `tasklist` for
// task-owned process memory, and statfs for disk; inside the worker, /proc/meminfo, /proc/pressure/*, /proc/stat and statfs-equivalent `df`.
// Every parser is pure. A value that cannot be read is `null` — never a default — and the governor treats null as "not healthy".
import { spawn } from 'node:child_process'
import { statfsSync } from 'node:fs'

export const WINDOWS_COUNTERS = Object.freeze({
  available_mb: '\\Memory\\Available MBytes',
  committed_bytes: '\\Memory\\Committed Bytes',
  commit_limit_bytes: '\\Memory\\Commit Limit',
  paging_pages_per_sec: '\\Memory\\Pages/sec',
  cpu_pct: '\\Processor(_Total)\\% Processor Time',
})

const finite = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null)
/** Counters whose value is a rate over an interval (they need two collections); the rest are gauges. */
const RATE_COUNTERS = Object.freeze(['cpu_pct', 'paging_pages_per_sec'])

/** A raw counter cell, reduced to a short, harmless diagnostic (never a path, never free text). */
const sanitizeCell = (s) => String(s).slice(0, 16).replace(/[^A-Za-z0-9.#+-]/g, '?')

/**
 * Parse `typeperf -sc N` CSV and say WHY a counter has no value. Uses the LAST row (rate counters need two samples). Columns are matched by
 * counter path, not position. `values[key]` is a finite, non-negative number or `null`; it is never a default, an average or a clamped value.
 * `problems[key]` is `{ code, raw? }` for every counter that is `null`: COUNTER.NO_ROWS (fewer than a header and one data row),
 * COUNTER.TOO_FEW_ROWS (only the RATE counters, cpu_pct and paging_pages_per_sec, when there is one data row; gauges are kept),
 * COUNTER.COLUMN_MISSING, COUNTER.ROW_SHORT, COUNTER.VALUE_BLANK, COUNTER.VALUE_NON_NUMERIC (includes typeperf's `-1.#IND00` style cells and
 * non-finite numbers) and COUNTER.VALUE_NEGATIVE. `raw` is a sanitized, length-capped copy of the cell.
 */
export function parseTypeperfDetailed(csv) {
  const values = Object.fromEntries(Object.keys(WINDOWS_COUNTERS).map((k) => [k, null]))
  const problems = {}
  const rows = String(csv).split(/\r?\n/).filter((l) => l.startsWith('"'))
  if (rows.length < 2) {
    for (const key of Object.keys(WINDOWS_COUNTERS)) problems[key] = { code: 'COUNTER.NO_ROWS' }
    return { values, problems }
  }
  // CPU % and Pages/sec are RATE counters: a value is an interval measurement only after two collections, so a header plus one data row (a run
  // that exited early) has no usable rate. The GAUGE counters (available memory, commit) are real readings on the first row and are kept: an
  // early exit must never throw away an adverse memory reading.
  const oneRow = rows.length < 3
  const cells = (l) => [...l.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1])
  const header = cells(rows[0])
  const last = cells(rows[rows.length - 1])
  for (const [key, path] of Object.entries(WINDOWS_COUNTERS)) {
    if (oneRow && RATE_COUNTERS.includes(key)) { problems[key] = { code: 'COUNTER.TOO_FEW_ROWS' }; continue }
    const idx = header.findIndex((h) => h.toLowerCase().endsWith(path.toLowerCase()))
    if (idx < 1) { problems[key] = { code: 'COUNTER.COLUMN_MISSING' }; continue }
    if (idx >= last.length) { problems[key] = { code: 'COUNTER.ROW_SHORT' }; continue }
    const raw = last[idx].trim()
    if (raw === '') { problems[key] = { code: 'COUNTER.VALUE_BLANK' }; continue }
    const n = /[^0-9.eE+-]/.test(raw) ? null : finite(Number(raw))
    if (n == null) { problems[key] = { code: 'COUNTER.VALUE_NON_NUMERIC', raw: sanitizeCell(raw) }; continue }
    if (n < 0) { problems[key] = { code: 'COUNTER.VALUE_NEGATIVE', raw: sanitizeCell(raw) }; continue }
    values[key] = n
  }
  return { values, problems }
}

/** Parse `typeperf -sc N` CSV into counter values (`null` for any counter that could not be read). See `parseTypeperfDetailed`. */
export function parseTypeperf(csv) {
  return parseTypeperfDetailed(csv).values
}

/** Derive the admission measurement shape from raw counters. Missing inputs stay null. */
export function deriveHostMetrics(raw, { diskFreeBytes = null } = {}) {
  const ratio = raw.committed_bytes != null && raw.commit_limit_bytes > 0 ? raw.committed_bytes / raw.commit_limit_bytes : null
  const cpu = raw.cpu_pct == null ? null : Math.min(100, Math.max(0, raw.cpu_pct))
  return {
    available_mb: raw.available_mb,
    commit_ratio: ratio == null ? null : Math.round(ratio * 10000) / 10000,
    committed_mb: raw.committed_bytes == null ? null : Math.round(raw.committed_bytes / 1048576),
    commit_limit_mb: raw.commit_limit_bytes == null ? null : Math.round(raw.commit_limit_bytes / 1048576),
    paging_pages_per_sec: raw.paging_pages_per_sec,
    cpu_pct: cpu == null ? null : Math.round(cpu * 10) / 10,
    disk_free_gb: diskFreeBytes == null ? null : Math.round((diskFreeBytes / 1073741824) * 10) / 10,
  }
}

/** Parse `tasklist /FO CSV /NH` rows → {pid → working_set_mb}. Only PIDs the caller asked about are returned. */
export function parseTasklist(csv, pids) {
  const want = new Set(pids.map(Number)); const out = {}
  for (const l of String(csv).split(/\r?\n/)) {
    const c = [...l.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1])
    if (c.length < 5) continue
    const pid = Number(c[1]); if (!want.has(pid)) continue
    const kb = Number(c[4].replace(/[^0-9]/g, ''))
    if (Number.isFinite(kb)) out[pid] = { image: c[0], working_set_mb: Math.round(kb / 1024) }
  }
  return out
}

/** /proc/meminfo → MB values. */
export function parseMeminfo(text) {
  const get = (k) => { const m = new RegExp(`^${k}:\\s+(\\d+) kB$`, 'm').exec(String(text)); return m ? Math.round(Number(m[1]) / 1024) : null }
  return { mem_total_mb: get('MemTotal'), mem_available_mb: get('MemAvailable'), swap_total_mb: get('SwapTotal'), swap_free_mb: get('SwapFree') }
}

/** /proc/pressure/{memory,cpu,io} → {some_avg10, full_avg10}. Absent PSI (old kernel) → nulls. */
export function parsePressure(text) {
  const pick = (kind) => { const m = new RegExp(`^${kind} avg10=([0-9.]+) avg60=([0-9.]+)`, 'm').exec(String(text)); return m ? { avg10: Number(m[1]), avg60: Number(m[2]) } : null }
  const s = pick('some'); const f = pick('full')
  return { some_avg10: s?.avg10 ?? null, some_avg60: s?.avg60 ?? null, full_avg10: f?.avg10 ?? null }
}

/** `df -B1 --output=avail,size <path>` → bytes. */
export function parseDf(text) {
  const rows = String(text).trim().split(/\r?\n/)
  const m = rows.length >= 2 ? /^\s*(\d+)\s+(\d+)\s*$/.exec(rows[rows.length - 1]) : null
  return m ? { avail_bytes: Number(m[1]), size_bytes: Number(m[2]) } : { avail_bytes: null, size_bytes: null }
}

/** Two /proc/stat `cpu` lines → busy percent. */
export function cpuPctFromProcStat(a, b) {
  const p = (t) => { const m = /^cpu\s+(.+)$/m.exec(String(t)); return m ? m[1].trim().split(/\s+/).map(Number) : null }
  const x = p(a); const y = p(b)
  if (!x || !y || x.length < 4 || y.length !== x.length) return null
  const idle = (v) => v[3] + (v[4] ?? 0)
  const tot = (v) => v.reduce((s, n) => s + n, 0)
  const dt = tot(y) - tot(x); const di = idle(y) - idle(x)
  return dt > 0 ? Math.round(((dt - di) / dt) * 1000) / 10 : null
}

// Absolute System32 paths: a bare name would be resolved from the (agent-writable) current directory before PATH on Windows.
const SYS32 = `${process.env.SYSTEMROOT ?? 'C:\\Windows'}\\System32`
const SAMPLER_TOOLS = Object.freeze({ typeperf: `${SYS32}\\typeperf.exe`, tasklist: `${SYS32}\\tasklist.exe` })

function runBounded(name, args, { timeoutMs, maxBytes = 1048576 }) {
  return new Promise((resolve) => {
    const started = Date.now()
    let out = ''; let done = false; let truncated = false
    const cmd = SAMPLER_TOOLS[name]
    if (!cmd) { resolve({ ok: false, out, ms: 0, code: 'SAMPLER.TOOL_NOT_PINNED', exit_code: null }); return }
    const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], env: { SYSTEMROOT: process.env.SYSTEMROOT, SYSTEMDRIVE: process.env.SYSTEMDRIVE, PATH: process.env.SYSTEMROOT ? `${process.env.SYSTEMROOT}\\System32` : '' } })
    const t = setTimeout(() => { if (!done) { done = true; child.kill(); resolve({ ok: false, out, ms: Date.now() - started, code: 'SAMPLER.TIMEOUT', exit_code: null }) } }, timeoutMs)
    child.stdout.on('data', (d) => { out += d; if (out.length > maxBytes) { truncated = true; child.kill() } })
    child.on('error', () => { if (!done) { done = true; clearTimeout(t); resolve({ ok: false, out, ms: Date.now() - started, code: 'SAMPLER.SPAWN_FAILED', exit_code: null }) } })
    child.on('close', (code) => {
      if (done) return
      done = true; clearTimeout(t)
      const exit = Number.isInteger(code) ? code : null
      resolve({ ok: code === 0 && !truncated, out, ms: Date.now() - started, code: truncated ? 'SAMPLER.OUTPUT_TOO_LARGE' : code === 0 ? null : 'SAMPLER.EXIT_NONZERO', exit_code: exit })
    })
  })
}

/**
 * One host sample (≈2 s, one short-lived typeperf + optional tasklist). `host_responsive` is false when the sampler itself took far longer
 * than its nominal duration (the controller could not get CPU/IO in time) — a conservative heartbeat, not a UI-latency measurement.
 *
 * Failure classes stay distinguishable: `sampler_error` is SAMPLER.TIMEOUT / SAMPLER.SPAWN_FAILED / SAMPLER.EXIT_NONZERO (with
 * `sampler_exit_code`) / SAMPLER.OUTPUT_TOO_LARGE / SAMPLER.TOOL_NOT_PINNED; when typeperf itself succeeded, `counter_problems` names every
 * counter that has no usable value (see `parseTypeperfDetailed`). `typeperfTimeoutMs` bounds the subprocess (default 30 s); a caller that
 * works against a deadline passes a smaller value. `runner` exists for deterministic tests only; it defaults to the pinned-path runner.
 */
export async function sampleWindowsHost({ diskPath, ownedPids = [], responsiveBudgetMs = 15000, typeperfTimeoutMs = 30000, runner = runBounded } = {}) {
  const t = await runner('typeperf', [...Object.values(WINDOWS_COUNTERS), '-sc', '2', '-si', '1'], { timeoutMs: typeperfTimeoutMs })
  const parsed = t.ok ? parseTypeperfDetailed(t.out) : parseTypeperfDetailed('')
  // A FAILED run is never a measurement, but whatever CPU % and available memory it printed are kept as UNVERIFIED diagnostics: an adverse one
  // must not be hidden by a retry (the scenario 9 rule judges them).
  const unverified = t.ok ? null : parseTypeperfDetailed(t.out ?? '').values
  const unverifiedCpu = unverified?.cpu_pct ?? null; const unverifiedAvailable = unverified?.available_mb ?? null
  let disk = null
  try { const s = statfsSync(diskPath); disk = Number(s.bavail) * Number(s.bsize) } catch { disk = null }
  const metrics = deriveHostMetrics(parsed.values, { diskFreeBytes: disk })
  let owned = {}
  if (ownedPids.length) { const tl = await runner('tasklist', ['/FO', 'CSV', '/NH'], { timeoutMs: 15000 }); owned = tl.ok ? parseTasklist(tl.out, ownedPids) : {} }
  return { at: new Date().toISOString(), source: 'windows_typeperf', sampler_ms: t.ms, sampler_error: t.code, sampler_exit_code: t.exit_code ?? null, counter_problems: t.ok ? parsed.problems : {}, unverified_cpu_pct: unverifiedCpu, unverified_available_mb: unverifiedAvailable,
    host_responsive: t.ok && t.ms <= responsiveBudgetMs, ...metrics, owned_processes: owned }
}

export const HOST_CPU_SAMPLING_VERSION = 1
/** `typeperf -sc 2 -si 1` collects two samples one second apart; a run that returns in well under that did not measure an interval. */
export const MIN_BURN_SAMPLER_MS = 900
export const MAX_PROCESS_FAILURES = 2
/** The subprocess timeout of a burn attempt that is not cut short by the window deadline; `attemptTimeoutMs` defaults to it. */
export const FULL_ATTEMPT_TIMEOUT_MS = 8000
const finiteOrNull = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null)
/**
 * A burn sample is usable only with a measured CPU % AND a measured available-memory figure (both feed scenario 9), from a run that exited
 * cleanly and long enough to have spanned its interval. Nothing else is accepted.
 */
const usableBurnSample = (s) => !!s && s.sampler_error == null && Number.isFinite(s.cpu_pct) && s.cpu_pct >= 0 && Number.isFinite(s.available_mb)
  && Number.isFinite(s.sampler_ms) && s.sampler_ms >= MIN_BURN_SAMPLER_MS
const attemptError = (s) => s?.sampler_error ?? (Number.isFinite(s?.cpu_pct)
  ? (Number.isFinite(s?.available_mb) ? (Number.isFinite(s?.sampler_ms) && s.sampler_ms >= MIN_BURN_SAMPLER_MS ? null : 'SAMPLER.TOO_FAST') : 'COUNTER.AVAILABLE_UNMEASURED')
  : (s?.counter_problems?.cpu_pct?.code ?? 'COUNTER.CPU_UNMEASURED'))

/**
 * Collect `slots` host samples INSIDE a bounded window of the guest burn, retrying only samples that could not be MEASURED.
 *
 *  - A retry happens only when an attempt produced no usable measurement (timeout, spawn failure, non-zero exit, truncated or too-fast run,
 *    missing or malformed counter). A measured value is accepted whatever it is: a high CPU %, a low available-memory figure or a slow,
 *    unresponsive sample is adverse evidence, never a reason to try again.
 *  - Nothing measured is ever dropped: every attempt records each value that WAS measured (even when its sibling counter failed), and a failed
 *    run's printed CPU % and available memory are kept as `unverified_cpu_pct` / `unverified_available_mb`. The scenario 9 rule judges ALL of
 *    them, not only the accepted ones.
 *  - Nothing is ever substituted: a slot that never obtains a measurement stays `null`. No zero, average, neighbour or earlier value is used.
 *  - `deadlineAt` (epoch ms) is a hard end. An attempt starts only if `minAttemptMs` remain, its subprocess timeout is capped at the time left,
 *    and an attempt that ends after the deadline (or after the guest burn ended, via `burnEnded()`) is recorded but NOT accepted, so every
 *    accepted measurement lies inside [`notBeforeAt`, `deadlineAt`] and inside the burn.
 *  - Process-level failures (any SAMPLER.* error) are bounded for the whole burn (`maxProcessFailures`); one more ends sampling (fail closed).
 *  - Every attempt is recorded, including failures, with offsets relative to `origin` (epoch ms of the burn start).
 *
 * Returns `{ samples, attempts, responsive, stop_reason, ...window facts }`; `samples[i]` is the accepted sample or `null`.
 */
export async function sampleHostCpuWindow({
  diskPath, origin, notBeforeAt, deadlineAt, burnMs, slots = 3, gapMs = 1500, retryDelayMs = 500, attemptTimeoutMs = FULL_ATTEMPT_TIMEOUT_MS, minAttemptMs = 3500, maxAttemptsPerSlot = 3,
  maxProcessFailures = MAX_PROCESS_FAILURES,
  burnEnded = () => false, sample = sampleWindowsHost, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const attempts = []; const samples = []; const responsive = []
  let stop = null; let processFailures = 0
  for (let slot = 0; slot < slots; slot += 1) {
    let accepted = null
    for (let k = 1; k <= maxAttemptsPerSlot && !stop; k += 1) {
      if (k > 1) { const wait = Math.min(retryDelayMs, deadlineAt - now()); if (wait > 0) await sleep(wait) }
      const startedAt = now()
      if (burnEnded()) { stop = 'BURN_ENDED'; break }
      if (deadlineAt - startedAt < minAttemptMs) { stop = 'DEADLINE_EXHAUSTED'; break }
      const timeoutMs = Math.min(attemptTimeoutMs, deadlineAt - startedAt) // shortened by the deadline near the end of the window
      const s = await sample({ diskPath, typeperfTimeoutMs: timeoutMs })
      const endedAt = now()
      const inside = endedAt <= deadlineAt && startedAt >= notBeforeAt && !burnEnded()
      const usable = usableBurnSample(s)
      const error = attemptError(s)
      const rec = { slot, attempt: k, start_offset_ms: startedAt - origin, end_offset_ms: endedAt - origin, sampler_ms: finiteOrNull(s?.sampler_ms),
        timeout_ms: timeoutMs, error, exit_code: s?.sampler_exit_code ?? null, counter_problems: s?.counter_problems ?? {},
        // Whatever was MEASURED is kept, whether or not the attempt was accepted; only a value that does not exist is null.
        cpu_pct: finiteOrNull(s?.cpu_pct), available_mb: finiteOrNull(s?.available_mb), unverified_cpu_pct: finiteOrNull(s?.unverified_cpu_pct), unverified_available_mb: finiteOrNull(s?.unverified_available_mb),
        host_responsive: s?.host_responsive === true, outcome: !usable ? 'rejected_unmeasured' : inside ? 'accepted' : 'rejected_outside_window' }
      attempts.push(rec)
      // A sampler that could not run, or could not finish in its FULL budget, says something adverse about the host: that counts against
      // responsiveness. A timeout cut short by the window deadline says nothing about the host (the slot simply stays unmeasured).
      if (error === 'SAMPLER.SPAWN_FAILED' || error === 'SAMPLER.OUTPUT_TOO_LARGE' || (error === 'SAMPLER.TIMEOUT' && timeoutMs >= FULL_ATTEMPT_TIMEOUT_MS)) responsive.push(false)
      if (typeof error === 'string' && error.startsWith('SAMPLER.')) { processFailures += 1; if (processFailures > maxProcessFailures) { stop = 'PROCESS_FAILURES_EXCEEDED'; break } }
      if (rec.outcome === 'accepted') { accepted = s; responsive.push(s.host_responsive === true); break }
      if (rec.outcome === 'rejected_outside_window') { stop = burnEnded() ? 'BURN_ENDED' : 'DEADLINE_EXHAUSTED'; break }
    }
    samples.push(accepted)
    if (slot < slots - 1 && !stop) { const wait = Math.min(gapMs, deadlineAt - now()); if (wait > 0) await sleep(wait) }
  }
  const missing = samples.filter((s) => s == null).length
  return { version: HOST_CPU_SAMPLING_VERSION, slots, max_attempts_per_slot: maxAttemptsPerSlot, window_ms: [notBeforeAt - origin, deadlineAt - origin], burn_ms: burnMs ?? null,
    stop_reason: stop ?? (missing ? 'ATTEMPTS_EXHAUSTED' : null), samples, attempts, responsive }
}

/** Shell snippet run INSIDE the guest (via the controller's SSH channel) whose output `parseGuestSample` reads. Read-only. */
export const GUEST_SAMPLE_SCRIPT = 'cat /proc/meminfo; echo @@PSI; cat /proc/pressure/memory 2>/dev/null; echo @@STAT1; head -1 /proc/stat; sleep 1; echo @@STAT2; head -1 /proc/stat; echo @@DF; df -B1 --output=avail,size / ; echo @@END'

export function parseGuestSample(text) {
  const s = String(text)
  const part = (a, b) => { const i = s.indexOf(a); const j = b ? s.indexOf(b, i + 1) : -1; return i < 0 ? '' : s.slice(i + a.length, j < 0 ? undefined : j) }
  if (!s.includes('@@END')) return { complete: false, mem_total_mb: null, mem_available_mb: null, psi_memory_some_avg10: null, cpu_pct: null, disk_free_gb: null }
  const mem = parseMeminfo(s.slice(0, s.indexOf('@@PSI')))
  const psi = parsePressure(part('@@PSI', '@@STAT1'))
  const df = parseDf(part('@@DF', '@@END'))
  return { complete: true, ...mem, psi_memory_some_avg10: psi.some_avg10, psi_memory_full_avg10: psi.full_avg10, cpu_pct: cpuPctFromProcStat(part('@@STAT1', '@@STAT2'), part('@@STAT2', '@@DF')),
    disk_free_gb: df.avail_bytes == null ? null : Math.round((df.avail_bytes / 1073741824) * 10) / 10 }
}
