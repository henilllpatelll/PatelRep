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

test('REAL processes: the test-file child is killed by the "reaper" while memory is below the floor → verified resource kill, automatic wait, re-run FIRST, no repeats, exit 0', { timeout: 120_000 }, async () => {
  const f = fixture(); writeFileSync(f.marker, 'hold')
  const r = startRunner(f, 'a,b,c')
  const running = await waitFor(() => { const u = unitRow(f, 'b.test.mjs'); return u?.status === 'running' && JSON.parse(u.result_json).pid ? JSON.parse(u.result_json) : null })
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

test('REAL processes: the RUNNER itself is reaped mid-unit (whole tree killed) → the next invocation finds the unit lost, re-runs it first, and reuses the completed unit', { timeout: 120_000 }, async () => {
  const f = fixture(); writeFileSync(f.marker, 'hold')
  const r1 = startRunner(f, 'a,b,c')
  const running = await waitFor(() => { const u = unitRow(f, 'b.test.mjs'); return u?.status === 'running' && JSON.parse(u.result_json).pid ? JSON.parse(u.result_json) : null })
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
