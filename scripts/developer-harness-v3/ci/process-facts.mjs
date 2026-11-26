// Developer Harness V3 (D3.5 independent-verification F3, second-round remediation) — host PROCESS FACTS and the OBSERVATION that an interrupted workload is gone (never its termination).
//
// A process is identified by FOUR facts together: pid, creation time, image name and full command line. A pid alone is not an identity (pids are reused); creation time makes it one for the
// life of the machine; the image and command line make an accidental match with an unrelated process practically impossible. Facts are READ-ONLY and come from supported system interfaces
// only: `Get-CimInstance Win32_Process` through the pinned absolute path of Windows PowerShell (the mechanism the D3.3 VM controller already uses) WINDOWS ONLY: on any other platform the facts are UNSUPPORTED and every recovery fails closed (a POSIX reader would have to convert start ticks to wall time and survive re-parenting of orphans to init; doc 29 R-15). Nothing here
// installs, configures or disables anything, and NOTHING IS EVER TERMINATED HERE: recovered host processes are observed, never killed (see verifyWorkloadStopped).
//
// What counts as the workload (used ONLY to decide that the unit must stay HELD; nothing is touched, and anything ambiguous HOLDS the state too):
//   1. a process whose full identity equals one RECORDED when the unit was started (the runner's child and, when captured, its descendants);
//   2. a live child (ppid) of a process already proven ours, created at or after its parent (a child cannot predate its parent), transitively;
//   3. a live child of a recorded process that is DEAD, created while that process was provably alive: between its creation and the last time it was SEEN alive (for the root: the unit's own
//      heartbeat). NO slack: a pid may be reused the moment its owner dies, so anything created after the last proof of life is not provable (it is UNPROVEN and holds the state).
//      The root cannot have died before its runner's last heartbeat while the unit was still `running`, so a pid reuse cannot have happened inside that window.
// A live process that claims descent from the workload (its ppid is a recorded pid) but fits none of the rules is UNPROVEN: it is reported, never touched, and the unit stays held.
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
/** Everything that descends (ppid link, created at or after its parent) from the given LIVE seed processes of THIS table. The seeds must already be identity-verified by the caller. */
function descendantsOf(table, seeds, now, seenIds = new Set()) {
  const seen = new Map(seeds.map((s) => [s.pid, s])); const desc = []; let truncated = false
  for (let grew = true; grew;) { grew = false; for (const p of table.procs) { const parent = seen.get(p.ppid); if (!seen.has(p.pid) && parent && Number(p.start) >= Number(parent.start)) { if (desc.length >= MAX_RECORDED) { truncated = true; break } seen.set(p.pid, p); if (!seenIds.has(`${p.pid}:${p.start}`)) desc.push(seenAt(p, now)); grew = true } } }
  return { desc, truncated }
}
/**
 * The identity of a freshly started workload: its ROOT process and whatever descends from it right now (bounded; `truncated` when the bound was hit). Each entry records when it was last SEEN alive.
 * `expect` ({ name, cmdlineIncludes, notBefore }) is what the caller KNOWS about the process it spawned: a pid is not an identity, so a process that does not look like the spawned child (reused pid, wrong
 * image, wrong command line, created before the spawn) is NEVER adopted as the root and nothing is captured (null).
 */
export function captureWorkload(table, rootPid, { runner = null, snapMs = 8000, now = Date.now(), expect = null } = {}) {
  const root = table.procs.find((p) => p.pid === rootPid); if (!root) return null
  if (expect && !((expect.name === undefined || root.name.toLowerCase() === String(expect.name).toLowerCase()) && (expect.cmdlineIncludes === undefined || root.cmdline.includes(expect.cmdlineIncludes)) && (expect.notBefore === undefined || Number(root.start) >= expect.notBefore))) return null
  const { desc, truncated } = descendantsOf(table, [root], now)
  return { root: seenAt(root, now), descendants: desc, runner, snap_ms: snapMs, captured_at: now, ...(truncated ? { truncated: true } : {}) }
}
/**
 * Merge a fresh table into a recorded workload. Ownership is ALWAYS by full identity (pid, creation time, image, command line), never by pid alone:
 *   - a recorded identity that is still alive gets a fresh `seen_at` (whether or not it is still reachable from the root through ppid links: a daemon whose intermediate exited is still ours);
 *   - NEW descendants are collected ONLY beneath recorded processes that were just verified alive by identity. A recorded pid now held by an unrelated process (a reused ROOT pid included) is a stranger:
 *     nothing beneath it is adopted, and its own `seen_at` is never refreshed;
 *   - dead entries are KEPT (their last-seen time bounds their orphans; interrupted workload records are preserved, never replaced). Over the bound, DEAD entries are evicted first and a LIVE one never
 *     is without marking the record `truncated` (verification then fails closed).
 */
export function refreshWorkload(prev, table, { now = Date.now() } = {}) {
  const live = new Map(table.procs.map((p) => [p.pid, p])); const aliveRec = (d) => sameProcess(live.get(d.pid), d)
  const rootLive = aliveRec(prev.root); const seeds = [...(rootLive ? [live.get(prev.root.pid)] : []), ...prev.descendants.filter(aliveRec).map((d) => live.get(d.pid))]
  const key = (d) => `${d.pid}:${d.start}`; const by = new Map()
  for (const d of prev.descendants) by.set(key(d), aliveRec(d) ? { ...d, seen_at: now } : d)
  const known = new Set([key(prev.root), ...by.keys()]); const fresh = descendantsOf(table, seeds, now, known)
  for (const d of fresh.desc) by.set(key(d), d)
  let all = [...by.values()]; let truncated = !!prev.truncated || fresh.truncated
  if (all.length > MAX_RECORDED) {
    const dead = all.filter((d) => !aliveRec(d)).sort((a, b) => a.seen_at - b.seen_at)
    for (const d of dead) { if (all.length <= MAX_RECORDED) break; all = all.filter((x) => x !== d) }
    if (all.length > MAX_RECORDED) { all = all.sort((a, b) => b.seen_at - a.seen_at).slice(0, MAX_RECORDED); truncated = true }
  }
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
 * OBSERVE whether an interrupted unit's recorded workload is gone. THIS FUNCTION NEVER TERMINATES ANYTHING (D3.5 second-round remediation): a recovered host process is identified only by inference
 * (a recorded identity, ppid ancestry, creation-time windows), and inference is not ownership — Windows reuses pids, reparents nothing and has no process-group kill. There is deliberately NO kill
 * primitive in this module; a directly spawned child is only ever terminated by the runner that spawned it, through that child's own original handle (resumable-runner.mjs).
 * Verified means exactly: the record is valid and complete (not truncated), the process table was readable, and EVERY recorded identity is observed absent with nothing alive that claims descent from one.
 * That is an OBSERVATION of the recorded set — it is not OS-enforced containment (R-16 stays open under G-LIVE-RECOVERY-ADAPTERS). Anything alive holds the unit.
 * @returns {Promise<{verified:boolean, code?:string, how?:string, running?:object[], unproven?:object[], reused?:number[]}>}
 */
export async function verifyWorkloadStopped({ recorded, lastSeenMs, read = readProcessTable }) {
  if (!recorded?.root || !Number.isInteger(recorded.root.pid) || typeof recorded.root.start !== 'string') return { verified: false, code: 'WORKLOAD_IDENTITY_UNKNOWN' } // never recorded: nothing can be proven
  if (!validWorkload(recorded)) return { verified: false, code: 'WORKLOAD_RECORD_INVALID' } // forged or corrupt state: never acted upon
  const t = await read(); if (!t.ok) return { verified: false, code: t.code ?? 'PROCESS_FACTS.UNAVAILABLE' }
  const j = judgeWorkload(t.procs, recorded, { lastSeenMs })
  if (j.ours.length) return { verified: false, code: 'WORKLOAD_STILL_RUNNING', running: j.ours.map((p) => ({ pid: p.pid, name: p.name })), unproven: j.unproven, reused: j.reused } // held: nothing is ever killed on inference
  if (j.unproven.length) return { verified: false, code: 'WORKLOAD_UNPROVEN', unproven: j.unproven, reused: j.reused }
  if (recorded.truncated) return { verified: false, code: 'WORKLOAD_RECORD_TRUNCATED', reused: j.reused } // the record shed live identities: what it does not name cannot be observed
  return { verified: true, how: 'observed_stopped', reused: j.reused }
}
