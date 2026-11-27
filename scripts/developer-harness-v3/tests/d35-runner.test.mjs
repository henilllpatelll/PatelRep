// D3.5-D — the RESUMABLE host runner with REAL subprocesses and REAL process termination (disposable fixture test files): the test plays the low-memory reaper.
// Simulated: only the free-memory reading (a sample file) and the reaper record. Real: the runner process, every `node --test` child, their termination, the state file.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RUNNER = path.join(HERE, '..', 'ci', 'resumable-runner.mjs')
const ENV = { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, NODE_NO_WARNINGS: '1' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dh35-runner-')); const tests = path.join(root, 'tests'); mkdirSync(tests)
  const marker = path.join(root, 'hold-b'); const mem = path.join(root, 'mem.json'); const reaper = path.join(root, 'reaper.json'); const state = path.join(root, 'state.sqlite')
  const ok = (n) => `import test from 'node:test'\ntest('${n} passes', () => {})\ntest('${n} passes too', () => {})\n`
  writeFileSync(path.join(tests, 'a.test.mjs'), ok('a'))
  writeFileSync(path.join(tests, 'b.test.mjs'), `import test from 'node:test'\nimport { existsSync } from 'node:fs'\ntest('b holds while the marker exists (a long unit)', async () => { while (existsSync(${JSON.stringify(marker)})) await new Promise((r) => setTimeout(r, 50)) })\ntest('b second', () => {})\ntest('b third', () => {})\n`)
  writeFileSync(path.join(tests, 'c.test.mjs'), ok('c'))
  writeFileSync(path.join(tests, 'd.test.mjs'), `import test from 'node:test'\nimport assert from 'node:assert/strict'\ntest('d genuinely fails', () => { assert.equal(1, 2) })\n`)
  writeFileSync(mem, JSON.stringify({ free_mb: 6000 }))
  return { root, marker, mem, reaper, state }
}
function startRunner(f, files, extra = []) {
  const p = spawn(process.execPath, [RUNNER, '--root', f.root, '--test-dir', 'tests', '--files', files, '--state', f.state, '--interval-ms', '100', '--sample-file', f.mem, '--reaper-record', f.reaper, '--max-wait-min', '5', ...extra], { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''; p.stdout.on('data', (d) => { out += d }); p.stderr.on('data', (d) => { out += d })
  const done = new Promise((res) => p.on('exit', (code) => res({ code, out })))
  return { p, done, out: () => out }
}
const unitRow = (f, unit) => { if (!existsSync(f.state)) return null; const db = new DatabaseSync(f.state, { readOnly: true }); try { return db.prepare('SELECT status, attempts, interruptions, result_json FROM test_units WHERE unit_id=?').get(unit) ?? null } catch { return null } finally { db.close() } }
async function waitFor(fn, ms = 60_000) { const t = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t > ms) throw new Error('timeout'); await sleep(50) } }
const killTree = (pid) => { try { process.kill(pid) } catch { /* already gone */ } }

// ── D3.6 Linux compatibility: process facts (workload identity) are WINDOWS-only (ci/process-facts.mjs). Off Windows an interrupted unit can never be proven stopped, so the
// two "re-run after a verified resource kill" tests below assert the documented FAIL-CLOSED outcome instead: the unit is HELD (exit 75), never re-run on an assumption,
// nothing is killed by the runner. (Never a skip.) The other REAL tests here do not depend on process facts and run unchanged on every platform.
const PROCESS_FACTS_SUPPORTED = process.platform === 'win32'
async function reaperFailsClosedWithoutProcessFacts({ runnerDies }) {
  const f = fixture(); writeFileSync(f.marker, 'hold')
  const r1 = startRunner(f, 'a,b,c', ['--workload-wait-min', '0.02'])
  const running = await waitFor(() => { const u = unitRow(f, 'b.test.mjs'); return u?.status === 'running' && JSON.parse(u.result_json).pid ? JSON.parse(u.result_json) : null })
  await sleep(1500)
  assert.ok(running.workload === undefined || running.workload === null, 'off Windows no workload identity is recorded'); assert.ok(!unitRow(f, 'b.test.mjs').result_json.includes('"workload":{'), 'still none after several snapshots')
  writeFileSync(f.mem, JSON.stringify({ free_mb: 1400 })); writeFileSync(f.reaper, JSON.stringify({ kind: 'low_memory_reaper', at: Date.now() }))
  if (runnerDies) { killTree(r1.p.pid); killTree(running.pid); await r1.done } else killTree(running.pid)
  rmSync(f.marker); writeFileSync(f.mem, JSON.stringify({ free_mb: 4000 }))
  const res = runnerDies ? await startRunner(f, 'a,b,c', ['--workload-wait-min', '0.02']).done : await r1.done
  assert.equal(res.code, 75, res.out); assert.match(res.out, /UNIT_WORKLOAD_NOT_PROVEN_STOPPED/); assert.doesNotMatch(res.out, /observed_stopped|\(rerun\)/, 'no recovery is ever claimed without process facts')
  // (`verified_resource_kill` may still appear: it classifies the CAUSE of the interruption — reaper record + low memory — and is never a proof that the workload stopped)
  assert.match(res.out, /"why":"(RECORDED_RUNNER_NOT_DEAD|WORKLOAD_IDENTITY_UNKNOWN)"/, 'held because ownership/stop cannot be proven')
  assert.equal(unitRow(f, 'b.test.mjs').attempts, 1, 'the interrupted unit was NOT re-run'); assert.equal(unitRow(f, 'c.test.mjs')?.status ?? 'pending', 'pending', 'and nothing after it ran')
  rmSync(f.root, { recursive: true, force: true })
}

test('REAL processes: the test-file child is killed by the "reaper" while memory is below the floor → verified resource kill, automatic wait, re-run FIRST, no repeats, exit 0', { timeout: 120_000 }, !PROCESS_FACTS_SUPPORTED ? () => reaperFailsClosedWithoutProcessFacts({ runnerDies: false }) : async () => {
  const f = fixture(); writeFileSync(f.marker, 'hold')
  const r = startRunner(f, 'a,b,c')
  // D3.5 second-round (intentional expectation change, same reason as the next test): an interrupted unit whose workload identity was never recorded is HELD, not re-run on the assumption that nothing
  // survived — so the "reaper" must strike after the identity was recorded, as it does in a real incident (a unit that has been running for a while)
  const running = await waitFor(() => { const u = unitRow(f, 'b.test.mjs'); return u?.status === 'running' && JSON.parse(u.result_json).pid && JSON.parse(u.result_json).workload ? JSON.parse(u.result_json) : null })
  await sleep(400) // b is really inside its long test now
  writeFileSync(f.mem, JSON.stringify({ free_mb: 1400 })); writeFileSync(f.reaper, JSON.stringify({ kind: 'low_memory_reaper', at: Date.now() }))
  killTree(running.pid) // the reaper kills the running unit's process
  await waitFor(() => unitRow(f, 'b.test.mjs')?.status === 'interrupted_resource')
  await sleep(600); assert.equal(unitRow(f, 'c.test.mjs').status, 'pending', 'nothing else runs while memory is below the floor (the runner waits)')
  rmSync(f.marker); writeFileSync(f.mem, JSON.stringify({ free_mb: 4000 })) // pressure clears
  const res = await r.done
  assert.equal(res.code, 0, res.out)
  const lines = res.out.split('\n').filter((l) => /^(ok |FAIL|INTR)/.test(l)).map((l) => l.split(' tests=')[0])
  assert.deepEqual(lines, ['ok   a.test.mjs', 'INTR b.test.mjs', 'ok   b.test.mjs (rerun)', 'ok   c.test.mjs'])
  assert.equal(unitRow(f, 'a.test.mjs').attempts, 1); assert.equal(unitRow(f, 'b.test.mjs').attempts, 2)
  const summary = JSON.parse(res.out.trim().split('\n').at(-1)); assert.equal(summary.ok, true); assert.equal(summary.total_tests, 7)
  rmSync(f.root, { recursive: true, force: true })
})

test('REAL processes: the RUNNER itself is reaped mid-unit (whole tree killed) → the next invocation finds the unit lost, re-runs it first, and reuses the completed unit', { timeout: 120_000 }, !PROCESS_FACTS_SUPPORTED ? () => reaperFailsClosedWithoutProcessFacts({ runnerDies: true }) : async () => {
  const f = fixture(); writeFileSync(f.marker, 'hold')
  const r1 = startRunner(f, 'a,b,c')
  // D3.5 F3 (intentional expectation change): the reaper must strike AFTER the workload's identity was recorded — an unrecorded workload can never be proven stopped, so a runner killed in the first
  // instants of a unit is (correctly) refused on resume (d35-rem2-f3-runner.test.mjs); a real incident hits a unit that has been running for a while
  const running = await waitFor(() => { const u = unitRow(f, 'b.test.mjs'); return u?.status === 'running' && JSON.parse(u.result_json).pid && JSON.parse(u.result_json).workload ? JSON.parse(u.result_json) : null })
  await sleep(300)
  writeFileSync(f.reaper, JSON.stringify({ kind: 'low_memory_reaper', at: Date.now() }))
  killTree(r1.p.pid); killTree(running.pid); await r1.done
  assert.equal(unitRow(f, 'b.test.mjs').status, 'running', 'the dead runner left b running (no outcome was ever reported)')
  rmSync(f.marker)
  const r2 = startRunner(f, 'a,b,c'); const res = await r2.done
  assert.equal(res.code, 0, res.out)
  assert.match(res.out, /LOST b\.test\.mjs → verified_resource_kill/)
  assert.match(res.out, /1 unit\(s\) already passed for this exact code are NOT re-run/)
  const lines = res.out.split('\n').filter((l) => /^(ok |FAIL|INTR)/.test(l)).map((l) => l.split(' tests=')[0])
  assert.deepEqual(lines, ['ok   b.test.mjs (rerun)', 'ok   c.test.mjs'])
  assert.equal(unitRow(f, 'a.test.mjs').attempts, 1)
  rmSync(f.root, { recursive: true, force: true })
})

test('REAL processes: a COMPLETE run that reports a failure is a genuine failure (exit 1, not re-run); a code change starts a NEW group (no reuse across code)', { timeout: 120_000 }, async () => {
  const f = fixture()
  const res = await startRunner(f, 'a,d').done
  assert.equal(res.code, 1, res.out)
  assert.match(res.out, /FAIL d\.test\.mjs/); assert.doesNotMatch(res.out, /INTR/)
  assert.equal(unitRow(f, 'd.test.mjs').status, 'failed'); assert.equal(unitRow(f, 'd.test.mjs').attempts, 1)
  writeFileSync(path.join(f.root, 'tests', 'd.test.mjs'), "import test from 'node:test'\ntest('d fixed', () => {})\n")
  const res2 = await startRunner(f, 'a,d').done
  assert.equal(res2.code, 0, res2.out)
  assert.doesNotMatch(res2.out, /already passed/, 'changed code: a is re-run under the new group, nothing is reused')
  rmSync(f.root, { recursive: true, force: true })
})

test('REAL processes: a second runner on the SAME state file is refused while the first is alive (an orphaned runner is never shared); a dead holder\'s lock is broken', { timeout: 120_000 }, async () => {
  const f = fixture(); writeFileSync(f.marker, 'hold')
  const r1 = startRunner(f, 'a,b,c')
  await waitFor(() => unitRow(f, 'b.test.mjs')?.status === 'running')
  const r2 = await startRunner(f, 'a,b,c').done
  assert.equal(r2.code, 75); assert.match(r2.out, /RUNNER_ALREADY_ACTIVE/)
  assert.equal(unitRow(f, 'b.test.mjs').status, 'running', 'the refused runner did not mark the live unit lost')
  rmSync(f.marker); const r = await r1.done; assert.equal(r.code, 0, r.out)
  writeFileSync(`${f.state}.lock`, JSON.stringify({ execution_id: 'runner-dead', pid: 999999, acquired_at: new Date().toISOString() }))
  const r3 = await startRunner(f, 'a,b,c').done; assert.equal(r3.code, 0, r3.out); assert.match(r3.out, /already passed/)
  rmSync(f.root, { recursive: true, force: true })
})
