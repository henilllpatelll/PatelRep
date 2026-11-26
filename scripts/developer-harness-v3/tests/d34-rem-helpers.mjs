// D3.4 remediation tests: shared helpers (not a test file). Everything here drives the SIMULATED harness — no model, VM, network or production key.
import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHarness } from '../orchestrator/sim/harness.mjs'
import { commitDir, loadWorld } from '../orchestrator/sim/sim-world.mjs'

export const tmp = (p = 'dh34-rem-') => mkdtempSync(path.join(os.tmpdir(), p))
export const H = (o = {}) => createHarness({ root: tmp(), ...o })
/** Run until nothing can progress, jumping the fixture clock to the next scheduled wake-up (waits, back-off, cool-downs) — no human involved. */
export async function drive(h, { rounds = 120 } = {}) {
  let last
  for (let i = 0; i < rounds; i += 1) {
    last = await h.engine.runUntilIdle({ maxTicks: 400 }); assert.ok(last.idle, 'engine must reach idle (no runaway loop)')
    if (!last.next_wakeup) return last
    if (last.next_wakeup <= h.clock.now()) { h.clock.advance(1000); continue }
    h.clock.advance(last.next_wakeup - h.clock.now() + 1)
  }
  throw new Error('drive: still waking after many rounds')
}
/** Run until idle WITHOUT advancing the clock (the world as it is right now). */
export const settle = async (h) => { const r = await h.engine.runUntilIdle({ maxTicks: 400 }); assert.ok(r.idle); return r }
export function spy(h) {
  const calls = []; const orig = h.adapters.session.runUnit.bind(h.adapters.session)
  h.adapters.session.runUnit = async (a) => { calls.push({ stage: a.stage, model: a.route.model, effort: a.route.effort, resume: a.resume, readonly: a.readonly, prompt: a.prompt, task: a.task.task_id, exec: a.lease.execution_id, at: h.clock.now() }); return orig(a) }
  return calls
}
export const execs = (h, id) => h.ledger.db.prepare('SELECT * FROM executions WHERE task_id=? ORDER BY ordinal').all(id)
export const owner = (h) => ({ blockedEvents: h.ledger.db.prepare("SELECT COUNT(*) c FROM task_events WHERE to_state='blocked'").get().c, ownerActions: h.ledger.db.prepare("SELECT COUNT(*) c FROM task_events WHERE event_json LIKE '%owner_action_id%'").get().c,
  blockerRows: h.ledger.db.prepare("SELECT COUNT(*) c FROM outbox WHERE kind='genuine_blocker'").get().c })
export const MAND = (id, sev = 'high') => ({ id, severity: sev, path: 'apps/mobile/feature.txt', evidence: 'the indicator never hides', reproduction: 'open the screen with an empty queue', remediation: 'hide it when the queue is empty' })
/** The ACTUAL bytes of the task's final committed feature file in the simulated git store. */
export function finalBytes(h, id, file = 'apps/mobile/feature.txt') { const w = loadWorld(h.dirs.world); return readFileSync(path.join(commitDir(h.dirs.world, id, w.versions[id]), ...file.split('/')), 'utf8') }
export const unitLines = (n, v = 1) => Array.from({ length: n }, (_, i) => `unit ${i + 1} of v${v}\n`).join('')
/** Install a clock-independent mutation that fires at the n-th occurrence of a hook point. */
export function onHook(point, nth, fn) { let seen = 0; return (name, ctx) => { if (name === point && ++seen === nth) fn(ctx) } }
export const govSet = (h, mut) => { const g = h.adapters.subscription.load(); h.adapters.subscription.save(mut(structuredClone(g))) }

/**
 * Run `mutate` AFTER the n-th IMPLEMENTING unit has been fully processed by the runner (including its subscription-governor update), i.e. exactly at the boundary the next admission looks at.
 * (Hook points fire before the governor update, which would overwrite a governor mutation; the planning unit also counts as an `after_unit`.)
 */
export function afterImplementingUnit(h, n, mutate) {
  let units = 0; let armed = false; const origRun = h.adapters.session.runUnit.bind(h.adapters.session); const origSave = h.adapters.subscription.save.bind(h.adapters.subscription)
  h.adapters.session.runUnit = async (a) => { const r = await origRun(a); if (a.stage === 'implementing' && ++units === n) armed = true; return r }
  h.adapters.subscription.save = (g) => { origSave(g); if (armed) { armed = false; mutate() } }
}
