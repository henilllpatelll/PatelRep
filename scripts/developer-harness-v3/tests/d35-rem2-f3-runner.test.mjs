// D3.5 independent-verification remediation, F3 — the resumable runner's PROCESS OWNERSHIP and TERMINATION. REAL disposable subprocesses only: the fixture "test file" starts a real
// long-lived grandchild; the tests kill ONLY the runner (parent-only termination), forge recorded identities, reuse pids and plant unrelated processes. Nothing outside the temp fixture
// directory is touched, no host setting is changed, and an unrelated process is never killed (every test that plants one asserts it is still alive).
//
// NOTE (Windows): libuv places every child a Node process spawns in a kill-on-close job object, so an ordinary child dies with its parent. What survives a parent-only termination is a DETACHED
// descendant (a server, browser or helper a test launches): the fixture's test file starts one. On POSIX hosts ordinary children survive too (the same code path proves them).
// Pre-fix behaviour (the same scenario against the previous runner): the unit was marked lost and RE-RUN while its old test process tree was still executing (`overlap` non-empty).
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { holderAlive } from '../ci/resumable-runner.mjs'
import { readProcessTable, readProcessTableSync, judgeWorkload, sameProcess, verifyWorkloadStopped } from '../ci/process-facts.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RUNNER = process.env.DH3_RUNNER_UNDER_TEST ?? path.join(HERE, '..', 'ci', 'resumable-runner.mjs') // (the previous runner can be pointed at for the pre-fix reproduction)
const ENV = { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, NODE_NO_WARNINGS: '1' }
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

test('F3 REPRODUCTION + FIX: the runner dies but its workload survives (parent-only termination) — the unit is NOT re-run until the old process tree is proven stopped and terminated; no overlap', { timeout: 180_000 }, async () => {
  const f = fixture(); let tree
  try {
    const x = await interrupted(f); tree = x.tree
    kill(tree.runner); await x.r1.done // ONLY the runner is killed
    assert.equal(unit(f, 'b.test.mjs').status, 'running', 'the dead runner left the unit running')
    assert.ok(alive(tree.grandchild), `the detached workload process really survived the runner (pid ${tree.grandchild})`)
    writeFileSync(path.join(f.root, 'old-pids.json'), JSON.stringify([tree.root, tree.test, tree.grandchild]))
    const res = await startRunner(f, 'a,b').done
    assert.equal(res.code, 0, res.out)
    const rr = runs(f); assert.equal(rr.length, 2, 'the unit was re-run exactly once')
    assert.deepEqual(rr[1].overlap, [], `the re-run started while the OLD workload was still alive: ${JSON.stringify(rr[1].overlap)}`)
    assert.match(res.out, /WORKLOAD b\.test\.mjs → terminated_task_owned/)
    assert.equal(alive(tree.grandchild), false, 'the surviving workload process was terminated before the re-run')
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
    assert.equal(res.code, 0, res.out); assert.match(res.out, /WORKLOAD b\.test\.mjs → already_stopped/)
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
    const res = await startRunner(f, 'a,b', ['--workload-wait-min', '0.01']).done
    assert.equal(res.code, 75, res.out); assert.match(res.out, /UNIT_WORKLOAD_NOT_PROVEN_STOPPED/); assert.match(res.out, /"why":"WORKLOAD_UNPROVEN"/)
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
  // root dead: an orphan created inside [root.start, lastSeen+slack] is ours; one created after that cannot be its child (a stranger's) and is neither ours nor claimed
  j = judgeWorkload([P(11, 10, 1100), P(13, 10, 9000)], rec, { lastSeenMs: 5000, slackMs: 1000 })
  assert.deepEqual(j.ours.map((p) => p.pid), [11]); assert.deepEqual(j.unproven, [])
  // a recorded descendant that died: its orphans are bounded by when IT was last seen alive
  const rec2 = { ...rec, descendants: [{ pid: 20, ppid: 10, start: '1500', name: 'node.exe', cmdline: 'c20', seen_at: 3000 }] }
  j = judgeWorkload([P(21, 20, 2500), P(22, 20, 4200)], rec2, { lastSeenMs: 5000, slackMs: 500 })
  assert.deepEqual(j.ours.map((p) => p.pid), [21], 'created while 20 was seen alive; the later one is beyond its last-seen window')
  // the recorded root's pid is now a STRANGER: it is never ours; only what was created strictly inside the window the root was seen alive is
  j = judgeWorkload([P(10, 1, 7777, 'other.exe', 'x'), P(11, 10, 1100), P(14, 10, 5200)], rec, { lastSeenMs: 5000 })
  assert.deepEqual(j.reused, [10]); assert.deepEqual(j.ours.map((p) => p.pid), [11], 'the stranger is not ours')
  // no heartbeat and no last-seen → the dead parent's lifetime cannot be bounded: an orphan CLAIMING descent is unproven (held, never killed)
  j = judgeWorkload([P(11, 10, 1100)], rec, { lastSeenMs: NaN }); assert.equal(j.ours.length, 0); assert.deepEqual(j.unproven.map((p) => p.pid), [11])
  assert.equal(sameProcess(P(10, 1, 1000, 'node.exe', 'c10'), rec.root), true); assert.equal(sameProcess(P(10, 1, 1001, 'node.exe', 'c10'), rec.root), false)
})

test('verifyWorkloadStopped: kills only what it proves (injected table + kill), re-reads after every round, and refuses when something remains', async () => {
  const P = (pid, ppid, start) => ({ pid, ppid, name: 'node.exe', start: String(start), cmdline: `c${pid}` })
  const rec = { root: { pid: 10, ppid: 1, start: '1000', name: 'node.exe', cmdline: 'c10' }, descendants: [] }
  let table = [P(10, 1, 1000), P(11, 10, 1100), P(99, 1, 500)]; const killed = []
  const r = await verifyWorkloadStopped({ recorded: rec, lastSeenMs: 5000, read: async () => ({ ok: true, procs: table }), kill: (pid) => { killed.push(pid); table = table.filter((p) => p.pid !== pid) }, pauseMs: 1 })
  assert.equal(r.verified, true); assert.equal(r.how, 'terminated_task_owned'); assert.deepEqual(killed, [11, 10], 'leaf first'); assert.ok(!killed.includes(99), 'the unrelated process is never killed')
  const stubborn = await verifyWorkloadStopped({ recorded: rec, lastSeenMs: 5000, read: async () => ({ ok: true, procs: [P(10, 1, 1000)] }), kill: () => {}, pauseMs: 1, rounds: 2 })
  assert.equal(stubborn.verified, false); assert.equal(stubborn.code, 'WORKLOAD_STILL_RUNNING')
  assert.equal((await verifyWorkloadStopped({ recorded: rec, lastSeenMs: 5000, read: async () => ({ ok: false, code: 'PROCESS_FACTS.UNAVAILABLE' }), pauseMs: 1 })).code, 'PROCESS_FACTS.UNAVAILABLE', 'no facts, no proof')
  assert.equal((await verifyWorkloadStopped({ recorded: null, read: async () => ({ ok: true, procs: [] }) })).code, 'WORKLOAD_IDENTITY_UNKNOWN')
  const real = await readProcessTable(); assert.ok(real.ok && real.procs.some((p) => p.pid === process.pid && p.start && p.name), 'the real process table is readable and includes this process with its creation time')
})
