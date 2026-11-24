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

/** Parse `typeperf -sc N` CSV. Uses the LAST row (rate counters need two samples). Columns are matched by counter path, not position. */
export function parseTypeperf(csv) {
  const out = Object.fromEntries(Object.keys(WINDOWS_COUNTERS).map((k) => [k, null]))
  const rows = String(csv).split(/\r?\n/).filter((l) => l.startsWith('"'))
  if (rows.length < 2) return out
  const cells = (l) => [...l.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1])
  const header = cells(rows[0])
  const last = cells(rows[rows.length - 1])
  for (const [key, path] of Object.entries(WINDOWS_COUNTERS)) {
    const idx = header.findIndex((h) => h.toLowerCase().endsWith(path.toLowerCase()))
    if (idx < 1 || idx >= last.length) continue
    const raw = last[idx].trim()
    if (raw === '' || /[^0-9.eE+-]/.test(raw)) continue
    out[key] = finite(Number(raw))
  }
  return out
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

function runBounded(cmd, args, { timeoutMs, maxBytes = 1048576 }) {
  return new Promise((resolve) => {
    const started = Date.now()
    let out = ''; let done = false
    const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], env: { SYSTEMROOT: process.env.SYSTEMROOT, SYSTEMDRIVE: process.env.SYSTEMDRIVE, PATH: process.env.SYSTEMROOT ? `${process.env.SYSTEMROOT}\\System32` : '' } })
    const t = setTimeout(() => { if (!done) { done = true; child.kill(); resolve({ ok: false, out, ms: Date.now() - started, code: 'SAMPLER.TIMEOUT' }) } }, timeoutMs)
    child.stdout.on('data', (d) => { out += d; if (out.length > maxBytes) child.kill() })
    child.on('error', () => { if (!done) { done = true; clearTimeout(t); resolve({ ok: false, out, ms: Date.now() - started, code: 'SAMPLER.SPAWN_FAILED' }) } })
    child.on('close', (code) => { if (!done) { done = true; clearTimeout(t); resolve({ ok: code === 0, out, ms: Date.now() - started, code: code === 0 ? null : 'SAMPLER.EXIT_NONZERO' }) } })
  })
}

/**
 * One host sample (≈2 s, one short-lived typeperf + optional tasklist). `host_responsive` is false when the sampler itself took far longer
 * than its nominal duration (the controller could not get CPU/IO in time) — a conservative heartbeat, not a UI-latency measurement.
 */
export async function sampleWindowsHost({ diskPath, ownedPids = [], responsiveBudgetMs = 15000 } = {}) {
  const t = await runBounded('typeperf', [...Object.values(WINDOWS_COUNTERS), '-sc', '2', '-si', '1'], { timeoutMs: 30000 })
  const raw = t.ok ? parseTypeperf(t.out) : parseTypeperf('')
  let disk = null
  try { const s = statfsSync(diskPath); disk = Number(s.bavail) * Number(s.bsize) } catch { disk = null }
  const metrics = deriveHostMetrics(raw, { diskFreeBytes: disk })
  let owned = {}
  if (ownedPids.length) { const tl = await runBounded('tasklist', ['/FO', 'CSV', '/NH'], { timeoutMs: 15000 }); owned = tl.ok ? parseTasklist(tl.out, ownedPids) : {} }
  return { at: new Date().toISOString(), source: 'windows_typeperf', sampler_ms: t.ms, sampler_error: t.code, host_responsive: t.ok && t.ms <= responsiveBudgetMs, ...metrics, owned_processes: owned }
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
