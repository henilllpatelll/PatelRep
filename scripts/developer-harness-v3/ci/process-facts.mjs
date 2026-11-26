// Developer Harness V3 (D3.5 independent-verification F3) — host PROCESS FACTS and the proof that an interrupted workload is really gone.
//
// A process is identified by FOUR facts together: pid, creation time, image name and full command line. A pid alone is not an identity (pids are reused); creation time makes it one for the
// life of the machine; the image and command line make an accidental match with an unrelated process practically impossible. Facts are READ-ONLY and come from supported system interfaces
// only: `Get-CimInstance Win32_Process` through the pinned absolute path of Windows PowerShell (the mechanism the D3.3 VM controller already uses) WINDOWS ONLY: on any other platform the facts are UNSUPPORTED and every recovery fails closed (a POSIX reader would have to convert start ticks to wall time and survive re-parenting of orphans to init; doc 29 R-15). Nothing here
// installs, configures or disables anything, and nothing is killed unless it is PROVABLY a process of the interrupted workload (below).
//
// What is "provably ours" (everything else is never touched, and anything ambiguous HOLDS the state instead):
//   1. a process whose full identity equals one RECORDED when the unit was started (the runner's child and, when captured, its descendants);
//   2. a live child (ppid) of a process already proven ours, created at or after its parent (a child cannot predate its parent), transitively;
//   3. a live child of a recorded process that is DEAD, created while that process was provably alive: between its creation and the last time it was SEEN alive (for the root: the unit's own
//      heartbeat). NO slack: a pid may be reused the moment its owner dies, so anything created after the last proof of life is not provable (it is UNPROVEN and holds the state).
//      The root cannot have died before its runner's last heartbeat while the unit was still `running`, so a pid reuse cannot have happened inside that window.
// A live process that claims descent from the workload (its ppid is a recorded pid) but fits none of the rules is UNPROVEN: it is reported, never killed, and the unit stays held.
import { execFile, spawnSync } from 'node:child_process'
import { POWERSHELL, sysEnv } from '../runtime/vm-controller.mjs'

const PS_TABLE = '$a = @(Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,Name,CreationDate,CommandLine -OperationTimeoutSec 20 | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId; name = [string]$_.Name; start = $(if ($_.CreationDate) { [string](([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds()) } else { "" }); cmdline = [string]$_.CommandLine } }); ConvertTo-Json -InputObject $a -Compress -Depth 2'
const normalize = (j) => (Array.isArray(j) ? j : [j]).filter((p) => p && Number.isInteger(p.pid) && p.pid > 0 && typeof p.start === 'string' && p.start !== '').map((p) => ({ pid: p.pid, ppid: Number.isInteger(p.ppid) ? p.ppid : 0, name: String(p.name ?? ''), start: p.start, cmdline: String(p.cmdline ?? '') }))

/** One read, bounded (a hung WMI provider must not stall the runner: the caller simply tries again at its next snapshot). */
function readOnceAsync(timeoutMs) {
  return new Promise((resolve) => {
    const cp = execFile(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', PS_TABLE], { env: sysEnv(), windowsHide: true, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' }, (err, stdout) => {
      if (err) return resolve({ ok: false, code: 'PROCESS_FACTS.UNAVAILABLE' })
      try { resolve({ ok: true, procs: normalize(JSON.parse(String(stdout).trim() || '[]')) }) } catch { resolve({ ok: false, code: 'PROCESS_FACTS.UNPARSEABLE' }) }
    })
    cp.stdin?.end() // never leave PowerShell waiting on an open stdin pipe
  })
}
/** Asynchronous process table (one retry). @returns {Promise<{ok:true, procs:object[]}|{ok:false, code:string}>} */
export async function readProcessTable({ platform = process.platform, timeoutMs = 25_000 } = {}) {
  if (platform !== 'win32') return { ok: false, code: 'PROCESS_FACTS.UNSUPPORTED_PLATFORM' }
  const first = await readOnceAsync(timeoutMs); return first.ok ? first : readOnceAsync(timeoutMs)
}
/** Synchronous variant (used only on the rare lock-contention path, where the lock helper's liveness callback is synchronous). */
export function readProcessTableSync({ platform = process.platform, timeoutMs = 30_000 } = {}) {
  if (platform !== 'win32') return { ok: false, code: 'PROCESS_FACTS.UNSUPPORTED_PLATFORM' }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const r = spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', PS_TABLE], { env: sysEnv(), windowsHide: true, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8', input: '' })
    if (r.status === 0) { try { return { ok: true, procs: normalize(JSON.parse(String(r.stdout).trim() || '[]')) } } catch { return { ok: false, code: 'PROCESS_FACTS.UNPARSEABLE' } } }
  }
  return { ok: false, code: 'PROCESS_FACTS.UNAVAILABLE' }
}

export const identityOf = (p) => ({ pid: p.pid, ppid: p.ppid, start: p.start, name: p.name, cmdline: p.cmdline.slice(0, 600) })
/** Full identity equality: pid, creation time, image and command line. */
export const sameProcess = (live, rec) => !!live && !!rec && live.pid === rec.pid && !!live.start && live.start === rec.start && live.name === rec.name && live.cmdline.slice(0, 600) === rec.cmdline
export const selfIdentity = (table = readProcessTableSync()) => (table.ok ? (table.procs.find((p) => p.pid === process.pid) ?? null) : null)

const seenAt = (p, now) => ({ ...identityOf(p), seen_at: now })
const MAX_RECORDED = 128
/** The identity of a freshly started workload: its ROOT process and whatever descends from it right now (bounded; `truncated` when the bound was hit). Each entry records when it was last SEEN alive. */
export function captureWorkload(table, rootPid, { runner = null, snapMs = 8000, now = Date.now() } = {}) {
  const root = table.procs.find((p) => p.pid === rootPid); if (!root) return null
  const desc = []; const seen = new Map([[root.pid, root]]); let truncated = false
  for (let grew = true; grew;) { grew = false; for (const p of table.procs) { const parent = seen.get(p.ppid); if (!seen.has(p.pid) && parent && Number(p.start) >= Number(parent.start)) { if (desc.length >= MAX_RECORDED) { truncated = true; break } seen.set(p.pid, p); desc.push(seenAt(p, now)); grew = true } } }
  return { root: seenAt(root, now), descendants: desc, runner, snap_ms: snapMs, captured_at: now, ...(truncated ? { truncated: true } : {}) }
}
/**
 * Merge a fresh table into a recorded workload: EVERY recorded identity that is still alive (same pid, creation time, image, command line) gets a fresh `seen_at` — whether or not it is still reachable
 * from the root through ppid links (a daemon whose intermediate exited is still ours) — new descendants are added, dead ones are kept (their last-seen time bounds their orphans). Over the bound, DEAD
 * entries are evicted first and a LIVE one never is without marking the record `truncated` (verification then fails closed).
 */
export function refreshWorkload(prev, table, { now = Date.now() } = {}) {
  const live = new Map(table.procs.map((p) => [p.pid, p])); const fresh = captureWorkload(table, prev.root.pid, { runner: prev.runner, snapMs: prev.snap_ms, now })
  const key = (d) => `${d.pid}:${d.start}`; const by = new Map()
  for (const d of prev.descendants) by.set(key(d), sameProcess(live.get(d.pid), d) ? { ...d, seen_at: now } : d)
  for (const d of fresh?.descendants ?? []) by.set(key(d), { ...(by.get(key(d)) ?? d), seen_at: now })
  let all = [...by.values()]; let truncated = !!prev.truncated || !!fresh?.truncated
  if (all.length > MAX_RECORDED) {
    const alive = (d) => sameProcess(live.get(d.pid), d); const dead = all.filter((d) => !alive(d)).sort((a, b) => a.seen_at - b.seen_at)
    for (const d of dead) { if (all.length <= MAX_RECORDED) break; all = all.filter((x) => x !== d) }
    if (all.length > MAX_RECORDED) { all = all.sort((a, b) => b.seen_at - a.seen_at).slice(0, MAX_RECORDED); truncated = true }
  }
  const rootLive = sameProcess(live.get(prev.root.pid), prev.root)
  return { ...prev, root: rootLive ? { ...prev.root, seen_at: now } : prev.root, descendants: all, ...(truncated ? { truncated: true } : {}) }
}

/** The recorded workload is state-file content (another local account could have forged it): it is validated and bounded before ANY use. */
const ID = (d) => !!d && typeof d === 'object' && Number.isInteger(d.pid) && d.pid > 0 && Number.isInteger(d.ppid) && typeof d.start === 'string' && /^\d{1,20}$/.test(d.start) && typeof d.name === 'string' && d.name.length <= 260 && typeof d.cmdline === 'string' && d.cmdline.length <= 600 && (d.seen_at === undefined || Number.isFinite(d.seen_at))
export const validWorkload = (w) => !!w && typeof w === 'object' && ID(w.root) && Array.isArray(w.descendants ?? []) && (w.descendants ?? []).length <= 256 && (w.descendants ?? []).every(ID)

/**
 * PURE judgement of a process table against a recorded workload.
 * @returns {{ours:object[], unproven:object[], reused:number[]}} ours: provably the workload's, leaf-first; unproven: claims descent but cannot be proven (never killed); reused: recorded pids now held by other processes (never touched).
 */
export function judgeWorkload(table, recorded, { lastSeenMs } = {}) {
  const live = new Map(table.map((p) => [p.pid, p])); const rec = [recorded.root, ...(recorded.descendants ?? [])].filter(Boolean)
  const ours = new Map(); const reused = []
  for (const r of rec) { const l = live.get(r.pid); if (l && sameProcess(l, r)) ours.set(l.pid, l); else if (l) reused.push(r.pid) }
  const closure = () => { for (let grew = true; grew;) { grew = false; for (const p of table) if (!ours.has(p.pid) && ours.has(p.ppid) && Number(p.start) >= Number(ours.get(p.ppid).start)) { ours.set(p.pid, p); grew = true } } }
  closure() // rule 2
  // rule 3: a recorded process that is not alive any more was alive until (at least) the last time it was SEEN — for the root, until its runner's last heartbeat. A process created by it inside that window is its child.
  const lastAlive = (r) => Math.max(Number.isFinite(Number(r.seen_at)) ? Number(r.seen_at) : -Infinity, r === recorded.root && Number.isFinite(lastSeenMs) ? lastSeenMs : -Infinity)
  const recStart = new Map(rec.map((r) => [r.pid, Number(r.start)]))
  for (let grew = true; grew;) {
    grew = false
    for (const r of rec) {
      if (ours.has(r.pid)) continue; const bound = lastAlive(r); if (!Number.isFinite(bound)) continue
      const limit = bound // strictly inside the window the recorded process was PROVEN alive (a slack would let a pid-reusing stranger's child be attributed to the workload)
      for (const p of table) if (!ours.has(p.pid) && p.ppid === r.pid && Number(p.start) >= Number(r.start) && Number(p.start) <= limit) { ours.set(p.pid, p); grew = true }
    }
    closure()
  }
  // unproven (review N1): ANY live process that claims descent from a recorded process (its ppid is that pid, it was created after it) and is not proven ours — held, never killed. The only exception is a
  // pid now held by a live STRANGER: a process created after that stranger started is the stranger's own child (a child cannot predate its parent), not ours and not in doubt.
  const unproven = table.filter((p) => !ours.has(p.pid) && recStart.has(p.ppid) && Number(p.start) >= recStart.get(p.ppid) && !(live.has(p.ppid) && reused.includes(p.ppid) && Number(p.start) >= Number(live.get(p.ppid).start))).map((p) => ({ ...identityOf(p), reason: 'CLAIMS_DESCENT_UNPROVEN' }))
  return { ours: [...ours.values()].sort((a, b) => Number(b.start) - Number(a.start)), unproven, reused }
}

/**
 * Terminate ONE process, but only if the process holding that pid RIGHT NOW is still the recorded one: a single PowerShell call opens the process by pid, compares its creation time and image to the
 * recorded identity and kills THAT handle (`$p.Handle` caches ONE process handle that StartTime and Kill() then share) — a pid reused in the meantime is never killed. Name and start are validated before they reach the command text.
 * @returns {Promise<'KILLED'|'CHANGED'|'GONE'|'ERROR'>}
 */
export function killVerified(p, { platform = process.platform } = {}) {
  if (platform !== 'win32' || !Number.isInteger(p?.pid) || p.pid <= 0 || !/^\d{1,20}$/.test(String(p.start)) || !/^[A-Za-z0-9._ -]{1,64}$/.test(String(p.name))) return Promise.resolve('ERROR')
  const script = `$ErrorActionPreference='Stop'; try { $p=[System.Diagnostics.Process]::GetProcessById(${p.pid}); $null=$p.Handle; $ms=([DateTimeOffset]$p.StartTime).ToUnixTimeMilliseconds(); if ([math]::Abs($ms - ${p.start}) -le 2 -and (($p.ProcessName + '.exe') -ieq '${p.name}')) { $p.Kill(); 'KILLED' } else { 'CHANGED' } } catch [System.ArgumentException] { 'GONE' } catch { 'ERROR' }`
  return new Promise((resolve) => {
    const cp = execFile(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', script], { env: sysEnv(), windowsHide: true, timeout: 20_000, encoding: 'utf8' }, (err, stdout) => resolve(err ? 'ERROR' : (['KILLED', 'CHANGED', 'GONE'].find((x) => String(stdout).trim() === x) ?? 'ERROR')))
    cp.stdin?.end()
  })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/**
 * Prove that the interrupted unit's workload is stopped, terminating ONLY what is provably task-owned. Re-reads the process table after every kill round.
 * `guard()` (async, optional) must still say "we hold exclusivity" before EVERY kill round; `kill(pid, identity)` may be async.
 * @returns {Promise<{verified:boolean, code?:string, how?:string, terminated?:object[], unproven?:object[], reused?:number[]}>}
 */
export async function verifyWorkloadStopped({ recorded, lastSeenMs, terminate = true, read = readProcessTable, kill = (pid, p) => killVerified(p), guard = null, rounds = 6, pauseMs = 400 }) {
  if (!recorded?.root || !Number.isInteger(recorded.root.pid) || typeof recorded.root.start !== 'string') return { verified: false, code: 'WORKLOAD_IDENTITY_UNKNOWN' } // never recorded: nothing can be proven
  if (!validWorkload(recorded)) return { verified: false, code: 'WORKLOAD_RECORD_INVALID' } // forged or corrupt state: never acted upon
  const terminated = []
  for (let i = 0; i <= rounds; i += 1) {
    const t = await read(); if (!t.ok) return { verified: false, code: t.code ?? 'PROCESS_FACTS.UNAVAILABLE', terminated }
    const j = judgeWorkload(t.procs, recorded, { lastSeenMs })
    if (!j.ours.length && !j.unproven.length) return recorded.truncated ? { verified: false, code: 'WORKLOAD_RECORD_TRUNCATED', terminated, reused: j.reused } : { verified: true, how: terminated.length ? 'terminated_task_owned' : 'already_stopped', terminated, reused: j.reused }
    if (!j.ours.length) return { verified: false, code: 'WORKLOAD_UNPROVEN', unproven: j.unproven, terminated, reused: j.reused } // something may belong to the workload: held, never killed
    if (!terminate || i === rounds) return { verified: false, code: 'WORKLOAD_STILL_RUNNING', unproven: j.unproven, terminated, reused: j.reused }
    if (guard && (await guard()) !== true) return { verified: false, code: 'RUNNER_LOCK_LOST', terminated }
    for (const p of j.ours) { const r = await kill(p.pid, { pid: p.pid, start: p.start, name: p.name }); terminated.push({ pid: p.pid, name: p.name, start: p.start, result: typeof r === 'string' ? r : undefined }) } // judged from THIS table moments ago; the kill re-checks the identity on the handle
    await sleep(pauseMs)
  }
  return { verified: false, code: 'WORKLOAD_STILL_RUNNING', terminated }
}
