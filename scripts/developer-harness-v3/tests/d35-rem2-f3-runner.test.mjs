// D3.5 independent-verification remediation, F3 — the resumable runner's PROCESS OWNERSHIP and TERMINATION. REAL disposable subprocesses only: the fixture "test file" starts a real
// long-lived grandchild; the tests kill ONLY the runner (parent-only termination), forge recorded identities, reuse pids and plant unrelated processes. Nothing outside the temp fixture
// directory is touched, no host setting is changed, and an unrelated process is never killed (every test that plants one asserts it is still alive).
//
// NOTE (Windows): libuv places every child a Node process spawns in a kill-on-close job object, so an ordinary child dies with its parent. What survives a parent-only termination is a DETACHED
// descendant (a server, browser or helper a test launches): the fixture's test file starts one. On POSIX hosts ordinary children survive too (the same code path proves them).
// Pre-fix behaviour (the same scenario against the previous runner): the unit was marked lost and RE-RUN while its old test process tree was still executing (`overlap` non-empty).
// SECOND-ROUND REMEDIATION (this file, honestly changed): the runner no longer TERMINATES any recovered process. A survivor HOLDS the unit (exit 75); the test plays the operator and stops the survivor itself.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { holderAlive } from '../ci/resumable-runner.mjs'
import * as FACTS from '../ci/process-facts.mjs'
import { captureWorkload, readProcessTable, readProcessTableSync, judgeWorkload, refreshWorkload, sameProcess, validWorkload, verifyWorkloadStopped } from '../ci/process-facts.mjs'
import { Ledger } from '../orchestrator/ledger/ledger.mjs'
import { openGroup, recordOutcome, startUnit, unitsOf } from '../orchestrator/test-units.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RUNNER = process.env.DH3_RUNNER_UNDER_TEST ?? path.join(HERE, '..', 'ci', 'resumable-runner.mjs') // (the previous runner can be pointed at for the pre-fix reproduction)
const ENV = { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, NODE_NO_WARNINGS: '1' }
const RUNNER_SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ci', 'resumable-runner.mjs')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const alive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }
const kill = (pid) => { try { process.kill(pid) } catch { /* gone */ } }
async function waitFor(fn, ms = 60_000) { const t = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t > ms) throw new Error('timeout'); await sleep(50) } }

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dh35-f3-')); const tests = path.join(root, 'tests'); mkdirSync(tests)
  const FX = JSON.stringify(root.replace(/\\/g, '/'))
  writeFileSync(path.join(tests, 'a.test.mjs'), "import test from 'node:test'\ntest('a', () => {})\n")
  writeFileSync(path.join(tests, 'b.test.mjs'), `import test from 'node:test'
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
const FX = ${FX}
const log = FX + '/runs.log'
const before = existsSync(log) ? readFileSync(log, 'utf8').split('\\n').filter(Boolean).length : 0
const alive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }
const old = existsSync(FX + '/old-pids.json') ? JSON.parse(readFileSync(FX + '/old-pids.json', 'utf8')) : []
appendFileSync(log, JSON.stringify({ run: before + 1, pid: process.pid, overlap: old.filter(alive) }) + '\\n')
test('b holds on its first run (with a real long-lived grandchild) and passes at once on a rerun', async () => {
  if (before === 0) {
    const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: true })
    g.unref()
    writeFileSync(FX + '/gc.pid', String(g.pid))
    while (existsSync(FX + '/hold')) await new Promise((r) => setTimeout(r, 50))
    g.kill()
  }
})
test('b second', () => {})
`)
  writeFileSync(path.join(root, 'hold'), 'hold'); writeFileSync(path.join(root, 'mem.json'), JSON.stringify({ free_mb: 6000 }))
  return { root, hold: path.join(root, 'hold'), mem: path.join(root, 'mem.json'), state: path.join(root, 'state.sqlite'), runs: path.join(root, 'runs.log'), gc: path.join(root, 'gc.pid') }
}
function startRunner(f, files, extra = []) {
  const p = spawn(process.execPath, [RUNNER, '--root', f.root, '--test-dir', 'tests', '--files', files, '--state', f.state, '--interval-ms', '100', '--snap-ms', '500', '--sample-file', f.mem, '--max-wait-min', '5', ...extra], { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''; p.stdout.on('data', (d) => { out += d }); p.stderr.on('data', (d) => { out += d })
  return { p, done: new Promise((res) => p.on('exit', (code) => res({ code, out }))), out: () => out }
}
const unit = (f, name) => { if (!existsSync(f.state)) return null; const db = new DatabaseSync(f.state, { readOnly: true }); try { const r = db.prepare('SELECT status, attempts, result_json FROM test_units WHERE unit_id=?').get(name); return r ? { ...r, result: JSON.parse(r.result_json) } : null } catch { return null } finally { db.close() } }
const edit = (f, fn) => { const db = new DatabaseSync(f.state); try { fn(db) } finally { db.close() } }
const runs = (f) => (existsSync(f.runs) ? readFileSync(f.runs, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
const cleanup = (f, pids = []) => { for (const p of pids) kill(p); try { rmSync(f.root, { recursive: true, force: true, maxRetries: 25, retryDelay: 200 }) } catch { /* Windows may still hold the directory for a moment; the OS temp directory is the fixture's only home */ } }

/** R1 runs unit b (holding, with a grandchild); wait until the workload identity is recorded; return the pids of the whole tree. */
async function interrupted(f) {
  const r1 = startRunner(f, 'a,b')
  const rec = await waitFor(() => { const u = unit(f, 'b.test.mjs'); const g = existsSync(f.gc) ? Number(readFileSync(f.gc, 'utf8')) : null; return u?.status === 'running' && (process.env.DH3_RUNNER_UNDER_TEST || (g && u.result.workload?.descendants?.some((d) => d.pid === g))) && g && runs(f).length === 1 ? u : null }, 90_000) // the recorded identity includes the detached grandchild
  const tree = { root: rec.result.pid, test: runs(f)[0].pid, grandchild: Number(readFileSync(f.gc, 'utf8')), runner: r1.p.pid }
  return { r1, tree, rec }
}

test('F3 / second-round: the runner dies but its workload survives (parent-only termination) — the unit is HELD, NOTHING is terminated, nothing re-runs; once the OPERATOR stops the survivor the unit resumes with no overlap', { timeout: 180_000 }, async () => {
  const f = fixture(); let tree
  try {
    const x = await interrupted(f); tree = x.tree
    kill(tree.runner); await x.r1.done // ONLY the runner is killed
    assert.equal(unit(f, 'b.test.mjs').status, 'running', 'the dead runner left the unit running')
    assert.ok(alive(tree.grandchild), `the detached workload process really survived the runner (pid ${tree.grandchild})`)
    writeFileSync(path.join(f.root, 'old-pids.json'), JSON.stringify([tree.root, tree.test, tree.grandchild]))
    const held = await startRunner(f, 'a,b', ['--workload-wait-min', '0.02']).done
    assert.equal(held.code, 75, held.out); assert.match(held.out, /UNIT_WORKLOAD_NOT_PROVEN_STOPPED/); assert.match(held.out, /"why":"WORKLOAD_STILL_RUNNING"/)
    assert.doesNotMatch(held.out, /terminated_task_owned|task-owned process/, 'the runner never reports (or performs) a termination of a recovered process')
    assert.equal(alive(tree.grandchild), true, 'the surviving workload process was NOT killed by the runner'); assert.equal(runs(f).length, 1, 'no duplicate execution while the survivor runs'); assert.equal(unit(f, 'b.test.mjs').status, 'running')
    kill(tree.grandchild); await waitFor(() => !alive(tree.grandchild)) // the OPERATOR stops the survivor
    const res = await startRunner(f, 'a,b').done
    assert.equal(res.code, 0, res.out)
    const rr = runs(f); assert.equal(rr.length, 2, 'the unit was re-run exactly once, after the survivor was gone')
    assert.deepEqual(rr[1].overlap, [], `the re-run started while the OLD workload was still alive: ${JSON.stringify(rr[1].overlap)}`)
    assert.match(res.out, /WORKLOAD b\.test\.mjs → observed_stopped/); assert.doesNotMatch(res.out, /terminated_task_owned|task-owned process/)
    assert.equal(JSON.parse(res.out.trim().split('\n').at(-1)).ok, true)
  } finally { cleanup(f, tree ? [tree.root, tree.test, tree.grandchild, tree.runner] : []) }
})

test('F3: a recorded pid that is now held by an UNRELATED process (pid reuse) is never touched; the genuinely stopped workload is verified and the unit re-runs', { timeout: 180_000 }, async () => {
  const f = fixture(); let tree; const stranger = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  try {
    const x = await interrupted(f); tree = x.tree
    for (const pid of [tree.runner, tree.root, tree.test, tree.grandchild]) kill(pid) // the whole old tree is gone
    await x.r1.done; await waitFor(() => !alive(tree.grandchild) && !alive(tree.test))
    const t = readProcessTableSync(); const s = t.procs.find((p) => p.pid === stranger.pid); assert.ok(s)
    edit(f, (db) => { const row = db.prepare("SELECT result_json FROM test_units WHERE unit_id='b.test.mjs'").get(); const j = JSON.parse(row.result_json); j.workload.root = { ...j.workload.root, pid: stranger.pid }; j.workload.descendants = []; db.prepare("UPDATE test_units SET result_json=? WHERE unit_id='b.test.mjs'").run(JSON.stringify(j)) })
    const res = await startRunner(f, 'a,b').done
    assert.equal(res.code, 0, res.out); assert.match(res.out, /WORKLOAD b\.test\.mjs → observed_stopped/)
    assert.equal(alive(stranger.pid), true, 'the unrelated process that reuses a recorded pid was NOT killed')
    assert.equal(runs(f).length, 2)
  } finally { cleanup(f, tree ? [tree.root, tree.test, tree.grandchild, tree.runner] : []); kill(stranger.pid) }
})

test('F3: a surviving descendant whose ownership cannot be PROVEN holds the state — no duplicate execution, nothing killed, the unit stays running (exit 75)', { timeout: 180_000 }, async () => {
  const f = fixture(); let tree
  try {
    const x = await interrupted(f); tree = x.tree
    kill(tree.runner); await x.r1.done; await waitFor(() => !alive(tree.test)) // the runner dies, its job takes the test process with it; the detached grandchild is an orphan
    edit(f, (db) => { const row = db.prepare("SELECT result_json FROM test_units WHERE unit_id='b.test.mjs'").get(); const j = JSON.parse(row.result_json); j.workload.descendants = j.workload.descendants.filter((d) => d.pid !== tree.grandchild); for (const d of [j.workload.root, ...j.workload.descendants]) delete d.seen_at; db.prepare("UPDATE test_units SET result_json=? WHERE unit_id='b.test.mjs'").run(JSON.stringify(j)); db.prepare('DELETE FROM resource_samples').run() }) // nothing bounds when the dead parent was last alive: unprovable
    const beat = unit(f, 'b.test.mjs').result.heartbeat; assert.ok(Number.isFinite(beat), 'the unit carries its own heartbeat')
    const res = await startRunner(f, 'a,b', ['--workload-wait-min', '0.01']).done
    assert.equal(res.code, 75, res.out); assert.match(res.out, /UNIT_WORKLOAD_NOT_PROVEN_STOPPED/); assert.match(res.out, /"why":"WORKLOAD_UNPROVEN"/)
    const res2 = await startRunner(f, 'a,b', ['--workload-wait-min', '0.01']).done; assert.equal(res2.code, 75)
    assert.equal(unit(f, 'b.test.mjs').result.heartbeat, beat, 'review M1: held invocations never widen the window in which the dead root counts as alive')
    assert.equal(alive(tree.grandchild), true, 'the unproven orphan was NOT killed')
    assert.equal(unit(f, 'b.test.mjs').status, 'running', 'the held state is retained'); assert.equal(runs(f).length, 1, 'no duplicate execution')
  } finally { cleanup(f, tree ? [tree.root, tree.test, tree.grandchild, tree.runner] : []) }
})

test('F3: a unit whose workload identity was never recorded cannot be proven stopped — fail closed (exit 75), nothing re-run, nothing killed', { timeout: 180_000 }, async () => {
  const f = fixture(); let tree
  try {
    const x = await interrupted(f); tree = x.tree
    kill(tree.runner); await x.r1.done
    edit(f, (db) => { const row = db.prepare("SELECT result_json FROM test_units WHERE unit_id='b.test.mjs'").get(); const j = JSON.parse(row.result_json); delete j.workload; db.prepare("UPDATE test_units SET result_json=? WHERE unit_id='b.test.mjs'").run(JSON.stringify(j)) })
    const res = await startRunner(f, 'a,b').done
    assert.equal(res.code, 75, res.out); assert.match(res.out, /"why":"WORKLOAD_IDENTITY_UNKNOWN"/)
    assert.equal(runs(f).length, 1); assert.equal(alive(tree.grandchild), true, 'nothing was killed on an unproven identity')
  } finally { cleanup(f, tree ? [tree.root, tree.test, tree.grandchild, tree.runner] : []) }
})

test('review N3: the operator release of a unit whose identity was never recorded works ONLY when its recorded runner and root pid are both gone', { timeout: 180_000 }, async () => {
  const f = fixture(); let tree
  try {
    const x = await interrupted(f); tree = x.tree
    kill(tree.runner); await x.r1.done
    edit(f, (db) => { const row = db.prepare("SELECT result_json FROM test_units WHERE unit_id='b.test.mjs'").get(); const j = JSON.parse(row.result_json); delete j.workload; db.prepare("UPDATE test_units SET result_json=? WHERE unit_id='b.test.mjs'").run(JSON.stringify(j)) })
    // the root (node --test) died with the runner's job, but the forged record still names a live pid: refuse while ANY recorded owner could be alive
    edit(f, (db) => { const j = unit(f, 'b.test.mjs').result; j.pid = process.pid; db.prepare("UPDATE test_units SET result_json=? WHERE unit_id='b.test.mjs'").run(JSON.stringify(j)) })
    const refused = await startRunner(f, 'a,b', ['--release-unproven-unit', 'b.test.mjs']).done; assert.equal(refused.code, 75, refused.out); assert.match(refused.out, /RELEASE_REFUSED/); assert.equal(runs(f).length, 1)
    edit(f, (db) => { const j = unit(f, 'b.test.mjs').result; j.pid = tree.root; db.prepare("UPDATE test_units SET result_json=? WHERE unit_id='b.test.mjs'").run(JSON.stringify(j)) })
    kill(tree.grandchild); await waitFor(() => !alive(tree.grandchild) && !alive(tree.root))
    const released = await startRunner(f, 'a,b', ['--release-unproven-unit', 'b.test.mjs']).done; assert.equal(released.code, 0, released.out); assert.match(released.out, /released_by_operator/); assert.equal(runs(f).length, 2)
    // second-round: the release is an ATTESTATION. A recorded root pid that is gone proves nothing about descendants, so it is never reported as verified containment
    assert.match(released.out, /OPERATOR ATTESTATION/); assert.match(released.out, /containment NOT verified/); assert.doesNotMatch(released.out, /observed_stopped/)
    const summary = JSON.parse(released.out.trim().split('\n').at(-1)); assert.deepEqual(summary.operator_released_units, ['b.test.mjs']); assert.equal(summary.containment, 'NOT_VERIFIED')
    const db = new DatabaseSync(f.state, { readOnly: true }); try { const m = JSON.parse(db.prepare("SELECT value FROM meta WHERE key LIKE 'runner_release:%'").get().value); assert.equal(m.attested_by, 'operator'); assert.equal(m.containment, 'NOT_VERIFIED') } finally { db.close() }
  } finally { cleanup(f, tree ? [tree.root, tree.test, tree.grandchild, tree.runner] : []) }
})

test('F3: lock holders are judged by IDENTITY — a dead runner whose pid was reused is a dead holder (lock broken); a live runner is never displaced; an unknowable holder is never broken', { timeout: 120_000 }, async () => {
  const stranger = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  try {
    await waitFor(() => readProcessTableSync().procs.some((p) => p.pid === stranger.pid))
    const s = readProcessTableSync().procs.find((p) => p.pid === stranger.pid)
    assert.equal(holderAlive({ pid: stranger.pid, start: s.start }), true, 'same pid, same creation time: alive')
    assert.equal(holderAlive({ pid: stranger.pid, start: String(Number(s.start) - 60_000) }), false, 'same pid, other creation time: the recorded runner is dead (pid reuse)')
    assert.equal(holderAlive({ pid: stranger.pid }), true, 'a record without a start time keeps the conservative pid-only rule')
    assert.equal(holderAlive({ pid: 2_000_000_000, start: '1' }), false)
    assert.equal(holderAlive({ pid: stranger.pid, start: s.start }, { table: () => ({ ok: false, code: 'PROCESS_FACTS.UNAVAILABLE' }) }), null, 'cannot tell: fail closed')
    assert.equal(holderAlive({ pid: 'x' }), null)
    // end to end: a lock whose recorded runner pid is now the stranger's (different creation time) does not block a new runner
    const f = fixture(); rmSync(f.hold)
    writeFileSync(`${f.state}.lock`, JSON.stringify({ execution_id: 'runner-dead', pid: stranger.pid, start: String(Number(s.start) - 60_000), acquired_at: 'x', nonce: 'n' }))
    const ok = await startRunner(f, 'a').done; assert.equal(ok.code, 0, ok.out); assert.equal(alive(stranger.pid), true, 'the unrelated process owning the reused pid was left alone')
    rmSync(f.root, { recursive: true, force: true })
    const f2 = fixture(); rmSync(f2.hold)
    writeFileSync(`${f2.state}.lock`, JSON.stringify({ execution_id: 'runner-live', pid: stranger.pid, start: s.start, acquired_at: 'x', nonce: 'n' }))
    const refused = await startRunner(f2, 'a').done; assert.equal(refused.code, 75, refused.out); assert.match(refused.out, /RUNNER_ALREADY_ACTIVE/)
    rmSync(f2.root, { recursive: true, force: true })
  } finally { kill(stranger.pid) }
})

test('judgeWorkload (pure): recorded identity, descent from a proven process, orphans of the dead root created while it was provably alive — and nothing else', () => {
  const P = (pid, ppid, start, name = 'node.exe', cmdline = `c${pid}`) => ({ pid, ppid, name, start: String(start), cmdline })
  const rec = { root: { pid: 10, ppid: 1, start: '1000', name: 'node.exe', cmdline: 'c10' }, descendants: [], snap_ms: 500 }
  // root alive: its children (any depth) are ours; an unrelated process and a PRE-DATING "child" are not
  let j = judgeWorkload([P(10, 1, 1000), P(11, 10, 1100), P(12, 11, 1200), P(50, 1, 900), P(51, 10, 900)], rec, { lastSeenMs: 5000 })
  assert.deepEqual(j.ours.map((p) => p.pid).sort(), [10, 11, 12]); assert.deepEqual(j.unproven, [])
  // root dead: an orphan created inside [root.start, lastSeen+slack] is ours; one created after that still CLAIMS descent: unproven (held)
  j = judgeWorkload([P(11, 10, 1100), P(13, 10, 9000)], rec, { lastSeenMs: 5000, slackMs: 1000 })
  assert.deepEqual(j.ours.map((p) => p.pid), [11]); assert.deepEqual(j.unproven.map((p) => p.pid), [13], 'created after the window but still claiming descent from the dead root: held, never killed')
  // a recorded descendant that died: its orphans are bounded by when IT was last seen alive
  const rec2 = { ...rec, descendants: [{ pid: 20, ppid: 10, start: '1500', name: 'node.exe', cmdline: 'c20', seen_at: 3000 }] }
  j = judgeWorkload([P(21, 20, 2500), P(22, 20, 4200)], rec2, { lastSeenMs: 5000, slackMs: 500 })
  assert.deepEqual(j.ours.map((p) => p.pid), [21], 'created while 20 was seen alive; the later one is beyond its last-seen window')
  // the recorded root's pid is now a STRANGER: it is never ours; only what was created strictly inside the window the root was seen alive is
  j = judgeWorkload([P(10, 1, 7777, 'other.exe', 'x'), P(11, 10, 1100), P(14, 10, 5200)], rec, { lastSeenMs: 5000 })
  assert.deepEqual(j.reused, [10]); assert.deepEqual(j.ours.map((p) => p.pid), [11], 'the stranger is not ours')
  // review N1: an orphan of a recorded process that died is UNPROVEN when it falls outside every proven window (here: created long after the parent was last seen) — never silently "stopped"
  j = judgeWorkload([P(23, 20, 40000)], rec2, { lastSeenMs: 5000, slackMs: 500 }); assert.equal(j.ours.length, 0); assert.deepEqual(j.unproven.map((p) => p.pid), [23])
  // ...but a child of the STRANGER that now holds a recorded pid (created after the stranger) is the stranger's own and is left alone
  j = judgeWorkload([P(10, 1, 7777, 'other.exe', 'x'), P(60, 10, 8000)], rec, { lastSeenMs: 5000 }); assert.equal(j.ours.length, 0); assert.deepEqual(j.unproven, [])
  // no heartbeat and no last-seen → the dead parent's lifetime cannot be bounded: an orphan CLAIMING descent is unproven (held, never killed)
  j = judgeWorkload([P(11, 10, 1100)], rec, { lastSeenMs: NaN }); assert.equal(j.ours.length, 0); assert.deepEqual(j.unproven.map((p) => p.pid), [11])
  assert.equal(sameProcess(P(10, 1, 1000, 'node.exe', 'c10'), rec.root), true); assert.equal(sameProcess(P(10, 1, 1001, 'node.exe', 'c10'), rec.root), false)
})

test('security review S-1: no slack — a stranger that reuses a dead recorded pid and starts a child shortly after the last proof of life is NEVER attributed to the workload (held, not killed)', async () => {
  const P = (pid, ppid, start, name = 'node.exe') => ({ pid, ppid, name, start: String(start), cmdline: `c${pid}` })
  const rec = { root: { pid: 10, ppid: 1, start: '1000', name: 'node.exe', cmdline: 'c10', seen_at: 2000 }, descendants: [{ pid: 700, ppid: 10, start: '1500', name: 'git.exe', cmdline: 'c700', seen_at: 2000 }], snap_ms: 8000 }
  const j = judgeWorkload([P(701, 700, 8000, 'notepad.exe')], rec, { lastSeenMs: 2000 }) // 6 s after the last time pid 700 was seen alive: inside the OLD 18 s slack
  assert.equal(j.ours.length, 0); assert.deepEqual(j.unproven.map((p) => p.pid), [701])
  const killed = []; const r = await verifyWorkloadStopped({ recorded: rec, lastSeenMs: 2000, read: async () => ({ ok: true, procs: [P(701, 700, 8000, 'notepad.exe')] }), kill: (pid) => killed.push(pid), pauseMs: 1 })
  assert.equal(r.verified, false); assert.equal(r.code, 'WORKLOAD_UNPROVEN'); assert.deepEqual(killed, [], 'nothing was killed')
})

test('security review S-2: process facts are WINDOWS-only — any other platform is UNSUPPORTED and recovery fails closed (no mixed tick/ms time domains)', async () => {
  assert.equal((await readProcessTable({ platform: 'linux' })).code, 'PROCESS_FACTS.UNSUPPORTED_PLATFORM'); assert.equal(readProcessTableSync({ platform: 'linux' }).code, 'PROCESS_FACTS.UNSUPPORTED_PLATFORM')
})

test('security review S-3: the record keeps EVERY live recorded identity (even when its intermediate exited and 130 newer children came and went); over the bound dead entries go first and truncation fails closed', async () => {
  const P = (pid, ppid, start, name = 'node.exe') => ({ pid, ppid, name, start: String(start), cmdline: `c${pid}` })
  const daemonId = { pid: 900, ppid: 800, start: '1200', name: 'daemon.exe', cmdline: 'c900' }
  let w = { root: { pid: 10, ppid: 1, start: '1000', name: 'node.exe', cmdline: 'c10', seen_at: 1 }, descendants: [{ ...daemonId, seen_at: 1 }], snap_ms: 500 }
  const kids = Array.from({ length: 130 }, (_, i) => P(2000 + i, 10, 3000 + i, 'git.exe'))
  w = refreshWorkload(w, { ok: true, procs: [P(10, 1, 1000), P(900, 800, 1200, 'daemon.exe'), ...kids] }, { now: 50_000 }) // the daemon's parent (800) is gone: it is reachable only by identity
  assert.ok(w.descendants.some((d) => d.pid === 900 && d.seen_at === 50_000), 'the live daemon was refreshed and kept'); assert.ok(w.descendants.length <= 128); assert.equal(w.truncated, true, 'a live entry was shed: the record says so')
  assert.equal(validWorkload(w), true)
  const r = await verifyWorkloadStopped({ recorded: w, lastSeenMs: 50_000, read: async () => ({ ok: true, procs: [] }), pauseMs: 1 }); assert.equal(r.verified, false); assert.equal(r.code, 'WORKLOAD_RECORD_TRUNCATED')
  const small = refreshWorkload({ root: { pid: 10, ppid: 1, start: '1000', name: 'node.exe', cmdline: 'c10', seen_at: 1 }, descendants: [{ ...daemonId, seen_at: 1 }], snap_ms: 500 }, { ok: true, procs: [P(10, 1, 1000), P(900, 800, 1200, 'daemon.exe')] }, { now: 9 })
  assert.equal(small.truncated, undefined); assert.equal(small.descendants[0].seen_at, 9)
})

test('second-round: there is NO kill primitive for recovered processes (killVerified is gone) and a forged record is refused before anything is read', async () => {
  assert.equal('killVerified' in FACTS, false, 'process-facts exports no termination function')
  assert.deepEqual(Object.keys(FACTS).filter((k) => /kill|terminate|stop(?!ped)/i.test(k)), [], 'nothing in the module is named like a termination primitive')
  const forged = { root: { pid: 5, ppid: 1, start: 'not-a-number', name: 'node.exe', cmdline: 'c' }, descendants: [] }
  assert.equal(validWorkload(forged), false); assert.equal(validWorkload({ root: { pid: 5, ppid: 1, start: '1', name: 'n', cmdline: 'c' }, descendants: Array.from({ length: 300 }, () => ({ pid: 6, ppid: 5, start: '2', name: 'n', cmdline: 'c' })) }), false, 'oversized')
  assert.equal((await verifyWorkloadStopped({ recorded: forged, read: async () => { throw new Error('must not read') } })).code, 'WORKLOAD_RECORD_INVALID')
})

test('security review S-7: a recorded runner that is still alive (or unknowable) keeps the unit HELD — nothing is touched, no kill, exit 75', { timeout: 180_000 }, async () => {
  const f = fixture(); let tree; const stranger = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  try {
    const x = await interrupted(f); tree = x.tree
    kill(tree.runner); await x.r1.done
    await waitFor(() => readProcessTableSync().procs.some((p) => p.pid === stranger.pid)); const s = readProcessTableSync().procs.find((p) => p.pid === stranger.pid)
    edit(f, (db) => { const row = db.prepare("SELECT result_json FROM test_units WHERE unit_id='b.test.mjs'").get(); const j = JSON.parse(row.result_json); j.runner = { pid: stranger.pid, start: s.start }; db.prepare("UPDATE test_units SET result_json=? WHERE unit_id='b.test.mjs'").run(JSON.stringify(j)) }) // the recorded owner is ALIVE
    const res = await startRunner(f, 'a,b', ['--workload-wait-min', '0.01']).done
    assert.equal(res.code, 75, res.out); assert.match(res.out, /"why":"RECORDED_RUNNER_NOT_DEAD"/); assert.ok(alive(tree.grandchild), 'the workload was not touched'); assert.equal(runs(f).length, 1)
  } finally { cleanup(f, tree ? [tree.root, tree.test, tree.grandchild, tree.runner] : []); kill(stranger.pid) }
})

test('verifyWorkloadStopped (second-round): OBSERVATION only — a live recorded process holds, an unrelated one is ignored, a callback that would kill is never invoked, and only an all-gone table verifies', async () => {
  const P = (pid, ppid, start) => ({ pid, ppid, name: 'node.exe', start: String(start), cmdline: `c${pid}` })
  const rec = { root: { pid: 10, ppid: 1, start: '1000', name: 'node.exe', cmdline: 'c10' }, descendants: [] }
  const killed = []; const kill = (pid) => killed.push(pid)
  const live = await verifyWorkloadStopped({ recorded: rec, lastSeenMs: 5000, read: async () => ({ ok: true, procs: [P(10, 1, 1000), P(11, 10, 1100), P(99, 1, 500)] }), kill, terminate: true, guard: async () => true })
  assert.equal(live.verified, false); assert.equal(live.code, 'WORKLOAD_STILL_RUNNING'); assert.deepEqual(live.running.map((p) => p.pid).sort(), [10, 11]); assert.deepEqual(killed, [], 'a provably-ours process is still NOT terminated')
  const orphan = await verifyWorkloadStopped({ recorded: rec, lastSeenMs: 5000, read: async () => ({ ok: true, procs: [P(11, 10, 1100), P(99, 1, 500)] }), kill })
  assert.equal(orphan.verified, false, 'the root is gone but its orphan is alive: not stopped'); assert.deepEqual(killed, [])
  const gone = await verifyWorkloadStopped({ recorded: rec, lastSeenMs: 5000, read: async () => ({ ok: true, procs: [P(99, 1, 500)] }), kill })
  assert.equal(gone.verified, true); assert.equal(gone.how, 'observed_stopped'); assert.deepEqual(killed, [])
  assert.equal((await verifyWorkloadStopped({ recorded: rec, lastSeenMs: 5000, read: async () => ({ ok: false, code: 'PROCESS_FACTS.UNAVAILABLE' }) })).code, 'PROCESS_FACTS.UNAVAILABLE', 'no facts, no proof')
  assert.equal((await verifyWorkloadStopped({ recorded: null, read: async () => ({ ok: true, procs: [] }) })).code, 'WORKLOAD_IDENTITY_UNKNOWN')
  assert.equal((await verifyWorkloadStopped({ recorded: { ...rec, truncated: true }, read: async () => ({ ok: true, procs: [] }) })).code, 'WORKLOAD_RECORD_TRUNCATED')
  const real = await readProcessTable(); assert.ok(real.ok && real.procs.some((p) => p.pid === process.pid && p.start && p.name), 'the real process table is readable and includes this process with its creation time')
})

// ------------------------------------------------------------------------------------------------------- second-round remediation (ChatGPT review of b712f17f)
const P2 = (pid, ppid, start, name = 'node.exe', cmdline = `c${pid}`) => ({ pid, ppid, name, start: String(start), cmdline })
const REC = () => ({ root: { pid: 10, ppid: 1, start: '1000', name: 'node.exe', cmdline: 'c10', seen_at: 1 }, descendants: [{ pid: 20, ppid: 10, start: '1100', name: 'node.exe', cmdline: 'c20', seen_at: 1 }], snap_ms: 500 })

test('REPRODUCTION + FIX (injected tables): a REUSED root pid never causes an unrelated process tree to be recorded as the workload; the stranger is never refreshed, dead identities are kept', () => {
  const strangerTable = { ok: true, procs: [P2(10, 1, 7777, 'stranger.exe', 'stranger'), P2(11, 10, 7800, 'unrelated-child.exe', 'u'), P2(12, 11, 7900, 'unrelated-grandchild.exe', 'u2'), P2(20, 10, 1100)] }
  const w = refreshWorkload(REC(), strangerTable, { now: 9000 })
  assert.deepEqual(w.descendants.map((d) => d.pid), [20], 'ONLY the genuinely recorded descendant (verified by identity) is in the record — the stranger\'s children are not adopted')
  assert.equal(w.root.seen_at, 1, 'a stranger holding the root pid is not proof of life for the root'); assert.equal(w.descendants[0].seen_at, 9000, 'the identity-verified live descendant IS refreshed')
  // children of a verified-live recorded descendant ARE adopted (still ours by identity), even though the root is gone
  const w2 = refreshWorkload(REC(), { ok: true, procs: [P2(20, 10, 1100), P2(21, 20, 1200)] }, { now: 9000 })
  assert.deepEqual(w2.descendants.map((d) => d.pid).sort(), [20, 21]); assert.equal(w2.root.seen_at, 1)
  // the root's whole subtree is gone: the dead identities are KEPT (their last-seen times bound later orphans)
  const w3 = refreshWorkload(REC(), { ok: true, procs: [P2(99, 1, 5)] }, { now: 9000 }); assert.equal(w3.descendants.length, 1); assert.equal(w3.descendants[0].seen_at, 1)
})

test('captureWorkload (injected): a pid that does not look like the spawned child is never adopted as the root', () => {
  const t = { ok: true, procs: [P2(10, 1, 100000, 'node.exe', 'node --test tests/b.test.mjs'), P2(11, 10, 100100)] }
  const expect = { name: 'node.exe', cmdlineIncludes: 'tests/b.test.mjs', notBefore: 99000 }
  assert.equal(captureWorkload(t, 10, { expect }).descendants.length, 1)
  assert.equal(captureWorkload(t, 10, { expect: { ...expect, name: 'other.exe' } }), null, 'wrong image'); assert.equal(captureWorkload(t, 10, { expect: { ...expect, cmdlineIncludes: 'tests/zzz.test.mjs' } }), null, 'wrong command line')
  assert.equal(captureWorkload(t, 10, { expect: { ...expect, notBefore: 100001 } }), null, 'created before the spawn: a reused pid, not our child'); assert.equal(captureWorkload(t, 404, { expect }), null)
})

test('REPRODUCTION + FIX (temp ledger): an interrupted unit KEEPS its workload identity, root pid, recording runner and heartbeat; a passed unit and the outcome fields are unchanged', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dh35-keep-')); const L = Ledger.open(path.join(dir, 's.sqlite'))
  try {
    openGroup(L, { groupId: 'g', units: ['u.test.mjs', 'v.test.mjs'] })
    const workload = REC(); const runner = { pid: 5, start: '7' }
    for (const id of ['u.test.mjs', 'v.test.mjs']) { startUnit(L, 'g', id, {}); L.db.prepare('UPDATE test_units SET result_json=? WHERE unit_id=?').run(JSON.stringify({ started_at: 1, pid: 10, runner, heartbeat: 5, workload }), id) }
    recordOutcome(L, 'g', 'u.test.mjs', { kind: 'ambiguous_interruption', evidence: { e: 1 } }, {})
    const u = unitsOf(L, 'g')[0]; assert.equal(u.status, 'interrupted_ambiguous'); assert.deepEqual(u.result.workload, workload); assert.equal(u.result.pid, 10); assert.deepEqual(u.result.runner, runner); assert.equal(u.result.heartbeat, 5); assert.equal(u.result.kind, 'ambiguous_interruption'); assert.deepEqual(u.result.evidence, { e: 1 })
    recordOutcome(L, 'g', 'v.test.mjs', { kind: 'passed' }, { counts: { tests: 1, pass: 1, fail: 0 } })
    const v = unitsOf(L, 'g')[1]; assert.equal(v.status, 'passed'); assert.equal(v.result.workload, undefined, 'a completed unit is final and carries no interrupted-workload record')
  } finally { L.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('REAL processes, ORDINARY interrupted-child path: the runner is alive, its test child is interrupted while a DETACHED workload process survives — the unit is HELD (nothing killed, not re-run); once the survivor is stopped the unit re-runs first', { timeout: 180_000 }, async () => {
  const f = fixture(); let tree
  try {
    const r1 = startRunner(f, 'a,b', ['--workload-wait-min', '0.02'])
    const rec = await waitFor(() => { const u = unit(f, 'b.test.mjs'); const g = existsSync(f.gc) ? Number(readFileSync(f.gc, 'utf8')) : null; return u?.status === 'running' && g && u.result.workload?.descendants?.some((d) => d.pid === g) ? u : null }, 90_000)
    tree = { root: rec.result.pid, grandchild: Number(readFileSync(f.gc, 'utf8')), runner: r1.p.pid }
    kill(tree.root) // the "reaper" interrupts the test child; the RUNNER stays alive
    const res = await r1.done
    assert.equal(res.code, 75, res.out); assert.match(res.out, /UNIT_WORKLOAD_NOT_PROVEN_STOPPED/); assert.match(res.out, /"why":"WORKLOAD_STILL_RUNNING"/)
    const u = unit(f, 'b.test.mjs'); assert.match(u.status, /^interrupted_/); assert.ok(validWorkload(u.result.workload), 'the interrupted unit kept its workload identity (pre-fix: replaced by the outcome alone)'); assert.ok(u.result.workload.descendants.some((d) => d.pid === tree.grandchild))
    assert.equal(alive(tree.grandchild), true, 'the survivor was NOT terminated'); assert.equal(runs(f).length, 1, 'the unit was NOT re-run on top of the surviving workload (pre-fix: re-run at once)')
    kill(tree.grandchild); await waitFor(() => !alive(tree.grandchild))
    const again = await startRunner(f, 'a,b').done
    assert.equal(again.code, 0, again.out); assert.match(again.out, /WORKLOAD b\.test\.mjs → observed_stopped/); assert.equal(runs(f).length, 2); assert.deepEqual(runs(f)[1].overlap, [])
  } finally { cleanup(f, tree ? [tree.root, tree.grandchild, tree.runner] : []) }
})

test('REAL processes: a leftover takeover mutex next to a dead holder\'s lock is NEVER broken by the runner — it exits 75 and starts NO host workload (strict takeover)', { timeout: 120_000 }, async () => {
  const f = fixture(); rmSync(f.hold)
  try {
    writeFileSync(`${f.state}.lock`, JSON.stringify({ execution_id: 'runner-dead', pid: 2_000_000_000, start: '1', acquired_at: 'x', nonce: 'n' }))
    writeFileSync(`${f.state}.lock.takeover`, JSON.stringify({ execution_id: 'runner-dead-breaker', pid: 2_000_000_001, start: '1', acquired_at: 'x', nonce: 'm' }))
    const res = await startRunner(f, 'a,b').done
    assert.equal(res.code, 75, res.out); assert.match(res.out, /RUNNER_ALREADY_ACTIVE/); assert.match(res.out, /LOCK\.TAKEOVER_BUSY/)
    assert.equal(runs(f).length, 0, 'no test workload was started'); assert.equal(unit(f, 'a.test.mjs'), null, 'no state was even opened'); assert.equal(existsSync(`${f.state}.lock.takeover`), true, 'the leftover mutex was left for the operator')
  } finally { cleanup(f) }
})

test('static guard: the ONLY termination in the runner is p.kill() on the handle of the child it spawned (two call sites: file timeout, runner exit) and process-facts contains none', () => {
  const strip = (t) => t.replace(/\/\/[^\n]*/g, '') // comments may talk about killing; code may not
  const runner = strip(readFileSync(RUNNER_SRC, 'utf8')); const facts = strip(readFileSync(path.join(HERE, '..', 'ci', 'process-facts.mjs'), 'utf8'))
  const kills = [...runner.matchAll(/\b[\w.]*\.kill\(/g)].map((m) => m[0]); assert.equal(kills.length, 2, 'exactly the two known call sites (file timeout, runner exit) — a new one must be reviewed'); assert.equal(/\bimport\b[^\n]*['"]\.\.?\/[^'"]*(vm-controller|launcher|cleanup)/.test(strip(readFileSync(RUNNER_SRC, 'utf8')).replace(/import \{[^}]*isPidAlive[^}]*\} from '..\/runtime\/launcher.mjs'/, '')), false, 'the runner imports no module that terminates processes (launcher is imported for the read-only isPidAlive only)')
  assert.equal(kills.every((k) => k === 'p.kill('), true, 'every kill is p.kill() on the spawned child handle'); const all = runner + facts; assert.equal(/process\.kill\(|\.Kill\(\)/.test(all) || /taskkill|Stop-Process|TerminateProcess/i.test(all), false, 'no process.kill(pid), no PowerShell Kill(), no taskkill/Stop-Process anywhere')
})

// ------------------------------------------------------------------------------------------------------- review round 7 (Opus security) — mandatory findings
test('review r7-1 (injected tables): a recorded pid that appears TWICE (a dead recorded process and a later one that reused the pid) never hides a live descendant — held, not "observed_stopped"', async () => {
  const D1 = { pid: 30, ppid: 10, start: '1500', name: 'node.exe', cmdline: 'c30a', seen_at: 2000 }; const D2 = { pid: 30, ppid: 10, start: '4000', name: 'node.exe', cmdline: 'c30b', seen_at: 4500 }
  const rec = { root: { pid: 10, ppid: 1, start: '1000', name: 'node.exe', cmdline: 'c10', seen_at: 4600 }, descendants: [D1, D2], snap_ms: 500 }
  const O = P2(77, 30, 2500, 'orphan.exe', 'o') // detached by D1 AFTER D1's last snapshot (2500 > 2000), D1 and D2 and the root are all gone
  const twice = await verifyWorkloadStopped({ recorded: rec, lastSeenMs: 4600, read: async () => ({ ok: true, procs: [O] }) })
  assert.equal(twice.verified, false, 'pre-fix: verified:true with the orphan alive'); assert.equal(twice.code, 'WORKLOAD_UNPROVEN'); assert.deepEqual(twice.unproven.map((p) => p.pid), [77])
  const control = await verifyWorkloadStopped({ recorded: { ...rec, descendants: [D1] }, lastSeenMs: 4600, read: async () => ({ ok: true, procs: [O] }) }); assert.equal(control.code, 'WORKLOAD_UNPROVEN', 'the control without the duplicate already held')
  // D2 alive is still recognised as ours (by identity), D1's window still attributes what D1 started while it was seen alive, and a stranger on pid 30 is still a stranger
  let j = judgeWorkload([P2(30, 10, 4000, 'node.exe', 'c30b'), P2(31, 30, 4200)], rec, { lastSeenMs: 4600 }); assert.deepEqual(j.ours.map((p) => p.pid).sort(), [30, 31]); assert.deepEqual(j.reused, [])
  j = judgeWorkload([P2(30, 10, 1600, 'node.exe', 'c30a-other'), P2(32, 30, 1700)], rec, { lastSeenMs: 4600 }); assert.deepEqual(j.reused, [30], 'a live process that matches NO recorded identity for the pid is a stranger')
  j = judgeWorkload([P2(30, 1, 9000, 'stranger.exe', 'x'), P2(33, 30, 9500)], rec, { lastSeenMs: 4600 }); assert.deepEqual(j.unproven, [], 'a child created after the live stranger started is the stranger\'s own')
})

test('review r7-2 (REAL): the operator release is consumed ONCE and never replayed onto an interruption this invocation caused itself (a fast-dying unit is HELD, never auto-attested)', { timeout: 180_000 }, async () => {
  const f = fixture(); rmSync(f.hold)
  try {
    writeFileSync(path.join(f.root, 'tests', 'e.test.mjs'), "process.kill(process.ppid)\n") // kills its own `node --test` parent at once: no test counts, an ambiguous interruption, before any workload identity can be read
    const res = await startRunner(f, 'a,e', ['--release-unproven-unit', 'e.test.mjs', '--workload-wait-min', '0.01']).done
    assert.equal(res.code, 75, res.out); assert.doesNotMatch(res.out, /OPERATOR ATTESTATION|released_by_operator/, 'the flag was not honoured for a state the operator never saw')
    assert.match(res.out, /UNIT_WORKLOAD_NOT_PROVEN_STOPPED|UNIT_INTERRUPTED_REPEATEDLY/); assert.equal(JSON.parse(res.out.trim().split('\n').at(-1)).operator_released_units, undefined)
  } finally { cleanup(f) }
})

test('review r7-3 (REAL): the release flag does not cover an INVALID or forged workload record — it is held, with an honest hint, and not attested', { timeout: 180_000 }, async () => {
  const f = fixture(); let tree
  try {
    const x = await interrupted(f); tree = x.tree
    kill(tree.runner); await x.r1.done; kill(tree.grandchild); await waitFor(() => !alive(tree.grandchild) && !alive(tree.root))
    edit(f, (db) => { const row = db.prepare("SELECT result_json FROM test_units WHERE unit_id='b.test.mjs'").get(); const j = JSON.parse(row.result_json); j.workload.root.start = 'not-a-number'; db.prepare("UPDATE test_units SET result_json=? WHERE unit_id='b.test.mjs'").run(JSON.stringify(j)) })
    const res = await startRunner(f, 'a,b', ['--release-unproven-unit', 'b.test.mjs']).done
    assert.equal(res.code, 75, res.out); assert.match(res.out, /"why":"WORKLOAD_RECORD_INVALID"/); assert.match(res.out, /cannot be trusted/); assert.doesNotMatch(res.out, /OPERATOR ATTESTATION/); assert.equal(runs(f).length, 1)
  } finally { cleanup(f, tree ? [tree.root, tree.test, tree.grandchild, tree.runner] : []) }
})
