// Developer Harness V3 (D3.5-D) — RESUMABLE host-side sequential runner for the V3 test files. Same isolation as run-v3-suites.mjs (one `node --test` process per file,
// sequential, 1 GB heap, rebuilt minimal environment, no skips) PLUS durable, unit-granular state so a run interrupted by memory pressure (the 2026-11-26 incident, doc 23)
// is RESUMED, not restarted and never misreported:
//   * each file is a unit in a small SQLite state file (the V3 ledger schema, task-less units); a unit that PASSED is final for this exact code (the group id digests every
//     V3 source file, the Node version and the file list — a code change is a new group, so no result is ever reused for different code);
//   * before every unit the runner re-admits against the free-memory FLOOR (3072 MB for the 1 GB-heap runner; hysteresis: 3 consecutive samples) and, if it is not met,
//     WAITS with a bounded timer and a persisted next-eligible time (it never bypasses or disables the host's low-memory reaper and kills nothing but the test child it spawned itself, through that child's own handle);
//   * an interrupted unit is classified from evidence (classifyUnit): a reaper record or an external kill below the floor = verified resource kill; otherwise ambiguous —
//     either way it is RE-RUN FIRST (once its old workload is observed gone, below) and nothing is reported as a regression; a runner that was itself killed leaves its unit `running`, which the next invocation treats as lost;
//   * only a COMPLETE run that reports failures is a failure (exit 1).
//
//   node scripts/developer-harness-v3/ci/resumable-runner.mjs [--state <file>] [--floor-mb 3072] [--interval-ms 15000] [--max-wait-min 240] [--reaper-record <json file>]
//   test-only:  --root <dir> --test-dir <rel> --files a,b   --sample-file <json {free_mb}>   (fixtures; the pinned-registry check applies only to the real repository list)
// Exit: 0 all passed · 1 a genuine failure / registry problem · 75 the bounded resource wait was exceeded, another live runner owns the state, or an interrupted unit's workload could not be PROVEN stopped
// (state kept: re-invoke to resume). F3 (independent verification): a unit left `running` by a dead runner — or INTERRUPTED with a recorded workload — is NEVER re-run until its recorded process tree is
// OBSERVED gone (process-facts.mjs). SECOND-ROUND REMEDIATION: nothing recovered is ever TERMINATED here. A process found alive on resume is held, not killed (a recovered process is identified by
// inference, not ownership). The only termination this file performs is of the test child THIS runner spawned, through that child's own original handle (timeout, runner exit). A unit whose old
// workload cannot be observed gone — or whose ownership/exclusivity cannot be established — stays HELD (exit 75) until the survivor is gone or an operator releases it (an attestation, never containment).
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Ledger } from '../orchestrator/ledger/ledger.mjs'
import { acquireLock, holdsLock, releaseLock } from '../lib/atomic.mjs'
import { isPidAlive } from '../runtime/launcher.mjs'
import { captureWorkload, readProcessTable, readProcessTableSync, refreshWorkload, selfIdentity, validWorkload, verifyWorkloadStopped } from './process-facts.mjs'
import { UNIT_DEFAULTS, admitUnit, classifyUnit, groupIdFor, markLost, nextUnit, openGroup, recentSamples, recordOutcome, recordSample, startUnit, summarize, unitsOf } from '../orchestrator/test-units.mjs'
import { FILE_TIMEOUT_MS, ROOT, TEST_DIR, checkRegistry, discover, minimalEnv, parseCounts } from './run-v3-suites.mjs'

const CTX = 'host_runner'
const arg = (argv, k, d = null) => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d }

/** Digest of every file under the V3 code and contract directories: a passed unit is only ever reused for the SAME code. */
export function codeDigest(root, dirs) {
  const h = createHash('sha256'); const walk = (d) => { for (const n of readdirSync(d).sort()) { const p = path.join(d, n); const st = statSync(p); if (st.isDirectory()) walk(p); else h.update(`${path.relative(root, p).replace(/\\/g, '/')}\n`).update(readFileSync(p)) } }
  for (const d of dirs) if (existsSync(path.join(root, d))) walk(path.join(root, d))
  return h.digest('hex')
}

export function readFree(sampleFile) {
  if (sampleFile) { try { const v = JSON.parse(readFileSync(sampleFile, 'utf8')).free_mb; return Number.isFinite(v) ? v : null } catch { return null } }
  return Math.floor(os.freemem() / 1048576) // available physical memory (GlobalMemoryStatusEx ullAvailPhys on Windows)
}
const readReaper = (f) => { if (!f || !existsSync(f)) return null; try { const r = JSON.parse(readFileSync(f, 'utf8')); return r && r.kind === 'low_memory_reaper' && Number.isFinite(r.at) ? r : null } catch { return null } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Liveness of a recorded lock holder by IDENTITY (pid + creation time): a reused pid is a DEAD holder; anything unknowable is null (fail closed). A record without a start time falls back to the pid alone. */
export function holderAlive(h, { table = readProcessTableSync, alive = isPidAlive } = {}) {
  if (!Number.isInteger(h?.pid)) return null
  if (!alive(h.pid)) return false
  if (typeof h.start !== 'string') return true
  const t = table(); if (!t.ok) return null
  const p = t.procs.find((x) => x.pid === h.pid)
  return p ? p.start === h.start : null
}

function runChild(root, rel, { onPid, onWorkload, workloadOf, beat, sample, intervalMs, snapMs }) {
  return new Promise((resolve) => {
    const spawnedAt = Date.now()
    const p = spawn(process.execPath, ['--test', '--test-reporter=spec', '--test-concurrency=1', rel], { cwd: root, env: minimalEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
    onPid(p.pid)
    const expect = { name: path.basename(process.execPath), cmdlineIncludes: rel, notBefore: spawnedAt - 5000 } // what we KNOW we spawned: a pid that does not look like it is never adopted as the root
    // identity of the workload, recorded as soon as it can be read and REFRESHED while it runs (what descends from it, and when each process was last seen alive): an unrecorded workload can never be proven stopped
    let snapping = false; let exited = false
    // `at` is taken BEFORE the read: proof of life is never later than the moment the table was requested
    const snap = async () => { if (snapping || exited) return; snapping = true; try { const at = Date.now(); const t = await readProcessTable(); if (t.ok && !exited) { const prev = workloadOf(); const w = prev ? refreshWorkload(prev, t, { now: at }) : captureWorkload(t, p.pid, { snapMs, now: at, expect }); if (w) onWorkload(w) } } catch { /* identity capture is best effort; its absence makes a later recovery fail closed */ } finally { snapping = false } }
    const first = setTimeout(snap, 700); const snapTimer = setInterval(snap, snapMs); snap()
    let out = ''; const cap = 64 * 1024 * 1024
    const killOnExit = () => { try { p.kill() } catch { /* gone */ } }; process.once('exit', killOnExit) // our own child never outlives the runner (review S-7)
    p.stdout.on('data', (d) => { if (out.length < cap) out += d }); p.stderr.on('data', (d) => { if (out.length < cap) out += d })
    const tick = setInterval(() => { sample(); beat() }, Math.max(200, Math.floor(intervalMs / 3))) // memory is sampled WHILE the unit runs: the classification needs in-window evidence
    let timedOut = false; const kill = setTimeout(() => { timedOut = true; p.kill() }, FILE_TIMEOUT_MS)
    p.on('exit', (code, signal) => { exited = true; clearInterval(tick); clearTimeout(kill); clearTimeout(first); clearInterval(snapTimer); process.removeListener('exit', killOnExit); resolve({ status: code, signal, out, timedOut }) })
  })
}

export async function main(argv = process.argv.slice(2), log = (s) => process.stdout.write(s)) {
  const root = path.resolve(arg(argv, '--root', ROOT)); const testDir = arg(argv, '--test-dir', TEST_DIR)
  const fixture = root !== ROOT
  const files = arg(argv, '--files') ? arg(argv, '--files').split(',').map((f) => (f.endsWith('.test.mjs') ? f : `${f}.test.mjs`)) : discover(root)
  if (!fixture) { const reg = checkRegistry(files); if (reg.length) { log(`${JSON.stringify({ ok: false, problems: reg })}\n`); return 1 } }
  const cfg = { ...UNIT_DEFAULTS, freeFloorMb: Number(arg(argv, '--floor-mb', UNIT_DEFAULTS.freeFloorMb)), sampleIntervalMs: Number(arg(argv, '--interval-ms', UNIT_DEFAULTS.sampleIntervalMs)), maxWaitMs: Number(arg(argv, '--max-wait-min', 240)) * 60_000, workloadWaitMs: Number(arg(argv, '--workload-wait-min', 5)) * 60_000, snapMs: Number(arg(argv, '--snap-ms', 8000)) }
  const sampleFile = arg(argv, '--sample-file'); const reaperFile = arg(argv, '--reaper-record')
  const code = codeDigest(root, fixture ? [testDir] : ['scripts/developer-harness-v3', 'docs/developer-harness-v3', 'scripts/developer-harness-v2', 'docs/developer-harness-v2']) // every input the V3 files read (review S-7)
  const groupId = groupIdFor({ runner: 'v3-host', node: process.version, code, files })
  const stateFile = path.resolve(arg(argv, '--state', path.join(os.tmpdir(), 'dh3-resumable-runner', `${groupId}.sqlite`)))
  mkdirSync(path.dirname(stateFile), { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32' && !arg(argv, '--state')) { const st = statSync(path.dirname(stateFile)); if (st.uid !== process.getuid() || (st.mode & 0o022) !== 0) { log(`${JSON.stringify({ ok: false, code: 'STATE_DIR_NOT_PRIVATE', dir: path.dirname(stateFile) })}\n`); return 1 } } // a shared /tmp directory another account created is never trusted
  // ONE runner per state file (found live during D3.5: the low-memory reaper stopped the shell but an orphaned runner kept running; a second runner then took the orphan's in-progress
  // unit for LOST). The lock records our pid; a holder that is verifiably dead is broken, a live (or unknown) one is never shared.
  const lockFile = `${stateFile}.lock`
  let me = selfIdentity(); for (let i = 0; i < 2 && !me && process.platform === 'win32'; i += 1) me = selfIdentity()
  if (!me && process.platform === 'win32') { log(`${JSON.stringify({ ok: false, code: 'PROCESS_IDENTITY_UNAVAILABLE', state: stateFile })}\n`); return 75 } // a runner that cannot name itself could leave units no later runner can prove anything about
  // one process-table read: the lock records WHO we are (pid + creation time), so a reused pid can never keep a dead runner's lock alive
  const lock = acquireLock(lockFile, { execution_id: `runner-${process.pid}`, acquired_at: new Date().toISOString(), start: me?.start ?? null, name: me?.name ?? null }, { isHolderAlive: (h) => holderAlive(h), strict: true }) // strict: this lock authorizes REAL host workloads, so a leftover takeover mutex is never broken automatically
  if (!lock.ok) { log(`${JSON.stringify({ ok: false, code: 'RUNNER_ALREADY_ACTIVE', lock: lock.code, holder_pid: lock.holder?.pid ?? null, state: stateFile })}\n`); return 75 }
  process.once('exit', () => { try { releaseLock(lockFile, { execution_id: `runner-${process.pid}`, nonce: lock.nonce }) } catch { /* best effort */ } })
  const L = Ledger.open(stateFile)
  try {
    openGroup(L, { groupId, units: files })
    const sample = () => { const s = { at: L.now(), free_mb: readFree(sampleFile) }; recordSample(L, null, CTX, s); return s }
    sample()
    // F3: a unit still `running` belongs to a runner that is gone — but its WORKLOAD (the test process tree) may not be. An INTERRUPTED unit (also ours, this invocation) may have left a surviving workload too.
    // Either is re-run only after its RECORDED workload is OBSERVED gone. Nothing is ever terminated here: a survivor HOLDS the unit (exit 75) and the operator deals with it.
    const releaseUnit = arg(argv, '--release-unproven-unit') // OPERATOR ACTION (docs 29/30): an ATTESTATION for ONE unit whose workload identity was never recorded; it is never reported as verified containment
    const released = new Set(); const releasedEver = []; let releaseUsed = false
    const ownRunner = (r) => !!me && !!r && r.pid === me.pid && r.start === me.start
    /** @returns {Promise<boolean>} true = the unit may proceed; false = HELD (the caller returns 75) */
    const gateUnit = async (u) => {
      if (released.has(u.unit_id)) return true
      // the attestation covers ONE state the operator could have seen: a unit left by an EARLIER invocation (never this invocation's own interruption), with NO workload record at all, and only once
      if (releaseUnit === u.unit_id && !releaseUsed && !ownRunner(u.result.runner) && (u.result.workload === undefined || u.result.workload === null)) {
        const runnerDead = u.result.runner ? holderAlive(u.result.runner) === false : true; const rootGone = Number.isInteger(u.result.pid) ? !isPidAlive(u.result.pid) : true
        if (runnerDead === true && rootGone) {
          L.setMeta(`runner_release:${groupId}:${u.unit_id}`, JSON.stringify({ at: L.now(), runner: u.result.runner ?? null, pid: u.result.pid ?? null, attested_by: 'operator', containment: 'NOT_VERIFIED' })); released.add(u.unit_id); releasedEver.push(u.unit_id); releaseUsed = true
          log(`WORKLOAD ${u.unit_id} → released_by_operator (OPERATOR ATTESTATION: no workload identity was recorded; the recorded root pid being gone proves nothing about its descendants — containment NOT verified)\n`); return true
        }
        log(`${JSON.stringify({ ok: false, code: 'RELEASE_REFUSED', unit: u.unit_id, runner_dead: runnerDead, root_gone: rootGone, state: stateFile })}\n`); return false
      }
      const waitStart = L.now(); let v
      for (;;) {
        const runnerAlive = ownRunner(u.result.runner) ? false : (u.result.runner ? holderAlive(u.result.runner) : null) // a recorded runner that is alive — or NOT recorded at all — may still own this unit: nothing is touched (the operator release is the explicit way out)
        v = runnerAlive !== false ? { verified: false, code: 'RECORDED_RUNNER_NOT_DEAD' } : await verifyWorkloadStopped({ recorded: u.result.workload, lastSeenMs: Number(u.result.heartbeat) })
        if (v.verified || ['WORKLOAD_IDENTITY_UNKNOWN', 'WORKLOAD_RECORD_INVALID', 'WORKLOAD_RECORD_TRUNCATED'].includes(v.code) || L.now() - waitStart > cfg.workloadWaitMs) break
        await sleep(cfg.sampleIntervalMs)
      }
      if (!v.verified) { L.setMeta(`runner_hold:${groupId}`, JSON.stringify({ unit: u.unit_id, code: v.code, at: L.now() })); log(`${JSON.stringify({ ok: false, code: 'UNIT_WORKLOAD_NOT_PROVEN_STOPPED', unit: u.unit_id, status: u.status, why: v.code, hint: v.code === 'WORKLOAD_IDENTITY_UNKNOWN' ? 'no identity was recorded; if the recorded runner and root pid are gone, an operator may attest with --release-unproven-unit <unit> (containment is NOT verified by that; usable once, for a unit left by an earlier invocation)' : v.code === 'RECORDED_RUNNER_NOT_DEAD' ? 'the runner that recorded this unit is alive or could not be shown dead: do NOT touch its processes; wait for it, or confirm it is gone and re-invoke' : ['WORKLOAD_RECORD_INVALID', 'WORKLOAD_RECORD_TRUNCATED'].includes(v.code) ? 'the recorded workload cannot be trusted (invalid, forged or truncated): inspect the state file by hand; the release flag does not cover this' : 'a recorded process is still alive or could not be accounted for: nothing was terminated; stop it yourself (or wait for it to exit) and re-invoke', still_running: (v.running ?? []).slice(0, 10), unproven: (v.unproven ?? []).map((p) => ({ pid: p.pid, name: p.name, reason: p.reason })).slice(0, 10), state: stateFile })}\n`); return false }
      log(`WORKLOAD ${u.unit_id} → ${v.how} (every recorded process observed gone; nothing was terminated)\n`)
      return true
    }
    for (const u of unitsOf(L, groupId).filter((x) => x.status === 'running')) if (!(await gateUnit(u))) return 75
    for (const x of markLost(L, groupId, { samples: recentSamples(L, null, CTX, 200), reaper: readReaper(reaperFile) }, cfg)) log(`LOST ${x.unit} → ${x.kind} (re-run first)\n`)
    const reused = unitsOf(L, groupId).filter((u) => u.status === 'passed').map((u) => u.unit_id)
    if (reused.length) log(`resuming group ${groupId}: ${reused.length} unit(s) already passed for this exact code are NOT re-run\n`)
    for (let guard = 0; guard < files.length * (cfg.maxResourceInterruptions + cfg.maxAmbiguousReruns + 2); guard += 1) {
      const u = nextUnit(L, groupId); if (!u) break
      if (u.interruptions > (u.status === 'interrupted_resource' ? cfg.maxResourceInterruptions : cfg.maxAmbiguousReruns)) { log(`${JSON.stringify({ ok: false, code: 'UNIT_INTERRUPTED_REPEATEDLY', unit: u.unit_id, state: stateFile })}\n`); return 75 }
      // an interrupted unit is NEVER re-run on the assumption that its old workload died with it: its preserved record must show every recorded process gone (a detached survivor holds it)
      if (u.status !== 'pending' && !(await gateUnit(u))) return 75
      // admission: wait (bounded, persisted) until the floor holds for `clearSamples` consecutive samples
      const waitStart = L.now()
      for (;;) {
        sample()
        const a = admitUnit(recentSamples(L, null, CTX, cfg.clearSamples), cfg)
        if (a.admit) break
        if (L.now() - waitStart > cfg.maxWaitMs) { L.setMeta(`runner_wait:${groupId}`, JSON.stringify({ since: waitStart, exceeded_at: L.now(), unit: u.unit_id })); log(`${JSON.stringify({ ok: false, code: 'RESOURCE_WAIT_EXCEEDED', unit: u.unit_id, state: stateFile })}\n`); return 75 }
        L.setMeta(`runner_wait:${groupId}`, JSON.stringify({ since: waitStart, next_eligible_at: L.now() + cfg.sampleIntervalMs, unit: u.unit_id, code: a.code, floor_mb: cfg.freeFloorMb }))
        await sleep(cfg.sampleIntervalMs)
      }
      L.db.prepare('DELETE FROM meta WHERE key=?').run(`runner_wait:${groupId}`)
      if (!holdsLock(lockFile, lock.nonce)) { log(`${JSON.stringify({ ok: false, code: 'RUNNER_LOCK_LOST', state: stateFile })}
`); return 75 } // exclusivity is re-proven before EVERY unit
      const startedAt = L.now(); const rerun = u.status !== 'pending'; released.delete(u.unit_id)
      startUnit(L, groupId, u.unit_id, { rerun })
      const r = await runChild(root, path.join(testDir, u.unit_id), { onPid: (pid) => L.db.prepare('UPDATE test_units SET result_json=? WHERE group_id=? AND unit_id=?').run(JSON.stringify({ started_at: startedAt, pid, rerun, runner: me ? { pid: me.pid, start: me.start } : null }), groupId, u.unit_id),
        beat: () => { const cur = L.db.prepare("SELECT result_json FROM test_units WHERE group_id=? AND unit_id=? AND status='running'").get(groupId, u.unit_id); if (cur) L.db.prepare("UPDATE test_units SET result_json=? WHERE group_id=? AND unit_id=? AND status='running'").run(JSON.stringify({ ...JSON.parse(cur.result_json), heartbeat: L.now() }), groupId, u.unit_id) }, // THIS unit's own liveness proof: only the runner that is executing it writes it (an invocation that merely held or died earlier cannot widen it)
        workloadOf: () => { const cur = L.db.prepare("SELECT result_json FROM test_units WHERE group_id=? AND unit_id=? AND status='running'").get(groupId, u.unit_id); return cur ? (JSON.parse(cur.result_json).workload ?? null) : null }, snapMs: cfg.snapMs,
        onWorkload: (workload) => { const cur = L.db.prepare("SELECT result_json FROM test_units WHERE group_id=? AND unit_id=? AND status='running'").get(groupId, u.unit_id); if (cur) L.db.prepare("UPDATE test_units SET result_json=? WHERE group_id=? AND unit_id=? AND status='running'").run(JSON.stringify({ ...JSON.parse(cur.result_json), workload }), groupId, u.unit_id) }, sample, intervalMs: cfg.sampleIntervalMs })
      sample()
      const counts = parseCounts(r.out)
      const cls = classifyUnit({ status: r.status, signal: r.signal, timedOut: r.timedOut, counts, startedAt, endedAt: L.now(), samples: recentSamples(L, null, CTX, 200), reaper: readReaper(reaperFile) }, cfg)
      recordOutcome(L, groupId, u.unit_id, cls, { counts })
      if (cls.kind !== 'passed') { // a non-passing unit keeps a bounded, credential-scanned tail of its output for investigation (never authority)
        const tail = r.out.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').split('\n').filter((l) => /✖|not ok|Error|assert|expected|actual|at .*\.mjs/.test(l)).slice(0, 60).join('\n').slice(0, 8000)
        const safe = /gh[pousr]_[A-Za-z0-9]{20,}|sk[-_](live_|test_|ant-)?[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}/.test(tail) ? '[REDACTED: credential-shaped content]' : tail
        L.setMeta(`unit_output:${groupId}:${u.unit_id}:${u.attempts + 1}`, safe)
        log(`${safe.split('\n').slice(0, 12).map((l) => `     | ${l}`).join('\n')}\n`) // stdout gets the SAME redaction (review S-7)
      }
      const tag = { passed: 'ok  ', genuine_failure: 'FAIL', verified_resource_kill: 'INTR', ambiguous_interruption: 'INTR' }[cls.kind]
      log(`${tag} ${u.unit_id}${rerun ? ' (rerun)' : ''} tests=${counts.tests} pass=${counts.pass} fail=${counts.fail} skipped=${counts.skipped}${cls.kind.includes('interrupt') || cls.kind.includes('kill') ? ` → ${cls.kind}: not a result; will re-run first after re-admission` : ''}\n`)
    }
    const s = summarize(L, groupId)
    const ok = s.passed === s.units
    log(`${JSON.stringify({ ok, total_tests: s.tests, files: s.units, passed_files: s.passed, failed_files: s.failed, reused_files: reused.length, interrupted_now: s.interrupted, ...(releasedEver.length ? { operator_released_units: releasedEver, containment: 'NOT_VERIFIED' } : {}), group: groupId, state: stateFile })}\n`)
    return ok ? 0 : (s.failed ? 1 : 75)
  } finally { L.close(); releaseLock(lockFile, { execution_id: `runner-${process.pid}`, nonce: lock.nonce }) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main())
