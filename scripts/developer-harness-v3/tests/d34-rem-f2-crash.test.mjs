// D3.4 remediation F2/F6 — SUBPROCESS crash tests: a real controller OS process is SIGKILLed at the boundaries the earlier suite did not cover, restarted, and the ACTUAL BYTES of all
// completed work are checked. Simulated world (no model/VM); real SQLite files, real processes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHarness } from '../orchestrator/sim/harness.mjs'
import { Ledger } from '../orchestrator/ledger/ledger.mjs'
import { commitDir, loadWorld, wipe, wtDir } from '../orchestrator/sim/sim-world.mjs'
import { CHILD_ENV, ORCH, tmp } from './d34-helpers.mjs'
import { unitLines } from './d34-rem-helpers.mjs'

const MAIN = path.join(ORCH, 'sim', 'controller-main.mjs')
const RENEW = { baseContext: 20_000, growthPerUnit: 40_000, contextWindow: 200_000, stages: { implementing: [{ units: 5 }] }, tests: [{ passed: true }] }
const PLAIN = { baseContext: 20_000, growthPerUnit: 1_000, contextWindow: 200_000, stages: { implementing: [{ units: 5 }] }, tests: [{ passed: true }] }
function controller(root, scenario, over = {}) {
  const cfgFile = path.join(root, `ctl-${Math.random().toString(36).slice(2)}.json`); writeFileSync(cfgFile, JSON.stringify({ root, scenario, max_ticks: 400, ...over }))
  const r = spawnSync(process.execPath, [MAIN, cfgFile], { encoding: 'utf8', timeout: 240_000, env: CHILD_ENV }); return { status: r.status, signal: r.signal, out: r.stdout, err: r.stderr }
}
function prepare(scenario) { const root = tmp('dh34-rem-crash-'); const h = createHarness({ root, scenario }); const id = h.submit(); h.close(); return { root, id } }
const crashedAt = (root) => (existsSync(path.join(root, 'crashed-at.txt')) ? readFileSync(path.join(root, 'crashed-at.txt'), 'utf8') : null)
const bytes = (root, id) => { const w = loadWorld(path.join(root, 'world')); return readFileSync(path.join(commitDir(path.join(root, 'world'), id, w.versions[id]), 'apps', 'mobile', 'feature.txt'), 'utf8') }
const done = (root, id) => { const L = Ledger.open(path.join(root, 'ledger.sqlite')); try { const t = L.getTask(id); return { handoff: t.handoff_ready, state: t.state, slot: L.slotHolder(), history: L.recoveryHistory(id).map((x) => x.kind) } } finally { L.close() } }
const restartUntilDone = (root, scenario) => { const r = controller(root, scenario); assert.equal(r.status, 0, r.err.slice(0, 400)); return r }

test('F2: a checkpoint is NOT consumed by restoration — SIGKILL right after a restore, with the guest worktree then lost, the work is restored again from the same checkpoint', () => {
  const { root, id } = prepare(RENEW); const first = controller(root, RENEW, { crash_at: 'after_checkpoint_restored:1' }); assert.equal(crashedAt(root), 'after_checkpoint_restored:1', first.err.slice(0, 200))
  // a guest reboot / power loss: the uncommitted tree is gone, only the controller-owned checkpoint remains
  wipe(wtDir(path.join(root, 'world'), id)); restartUntilDone(root, RENEW)
  const s = done(root, id); assert.equal(s.handoff, 1); assert.equal(bytes(root, id), unitLines(5), 'every unit written before the crash AND the restore is in the final candidate, exactly once')
})

test('F2: SIGKILL between lease supersession and the recovery snapshot (and just before it): no work is lost either way', () => {
  for (const point of ['after_lease_superseded:1', 'before_lease_supersede:1']) {
    const { root, id } = prepare(PLAIN)
    controller(root, PLAIN, { crash_at: 'after_unit:3' }); assert.equal(crashedAt(root), 'after_unit:3'); rmCrash(root) // dies mid-implementation, lease and live session left behind
    controller(root, PLAIN, { crash_at: point }); assert.equal(crashedAt(root), point, `the recovery crash point ${point} was reached`); rmCrash(root)
    if (point === 'after_lease_superseded:1') wipe(wtDir(path.join(root, 'world'), id)) // the supersession committed: the guest tree is now expendable — ONLY durable controller state carries the work (before the commit the work is still in the guest and is captured by the next recovery)
    restartUntilDone(root, PLAIN); const s = done(root, id); assert.equal(s.handoff, 1, point); assert.equal(s.slot, null)
    assert.equal(bytes(root, id), unitLines(5), `${point}: units 1-3 (written before the first crash) survive both crashes, exactly once`)
  }
})

const rmCrash = (root) => rmSync(path.join(root, 'crashed-at.txt'), { force: true })
