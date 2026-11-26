// Developer Harness V3 (D3.4) — runs the headline end-to-end SIMULATION once and writes a retained, clearly labelled evidence file.
//   node run-e2e.mjs <output.json>
// ONE task submission drives planning, implementation, context renewals, a failed test, mandatory review findings, a subscription pause and a memory pause to a verified handoff.
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FixtureClock, T0, createHarness } from './harness.mjs'

const out = process.argv[2]
if (!out || process.argv.length !== 3) { process.stderr.write('usage: run-e2e.mjs <output.json>\n'); process.exit(2) }
const MAND = (id, severity = 'high') => ({ id, severity, path: 'apps/mobile/feature.txt', evidence: 'simulated finding', reproduction: 'simulated', remediation: 'simulated fix' })
const scenario = { baseContext: 20_000, growthPerUnit: 45_000, contextWindow: 200_000, quota: [{ from: T0 + 60_000, to: T0 + 2 * 3600_000 }], pressure: [{ from: T0 + 2 * 3600_000, to: T0 + 2 * 3600_000 + 10 * 60_000, available_mb: 600 }],
  tests: [{ passed: false, fingerprint: 'ui-state', summary: 'simulated failure' }, { passed: true }],
  stages: { implementing: [{ units: 4 }, { units: 2 }, { units: 1 }], independent_review: [{ findings: [MAND('rv-1')] }, { findings: [] }], security_review: [{ findings: [MAND('sec-1', 'critical')] }, { findings: [] }] } }
const clock = new FixtureClock(); const h = createHarness({ root: mkdtempSync(path.join(os.tmpdir(), 'dh34-e2e-')), scenario, clock })
const id = h.submit(); let ticks = 0; let waits = 0
for (let i = 0; i < 200; i += 1) { const r = await h.engine.runUntilIdle({ maxTicks: 400 }); ticks += r.ticks; if (!r.next_wakeup) break; waits += 1; clock.advance(Math.max(1, r.next_wakeup - clock.now()) + 1) }
const L = h.ledger; const q = (s, ...a) => L.db.prepare(s).all(...a); const t = L.getTask(id)
const evidence = {
  label: 'SIMULATED — scripted sessions, fixture clock, test keys; no model, VM, network, provider credential or production key was involved. Not evidence of live behaviour.',
  schema: 'patelrep.developer-harness-v3.d34-e2e-simulation', version: 1, simulated: true, base_main_sha: '5ced4d309cf3532a490a48dbd06c575994822eac',
  submissions: L.db.prepare('SELECT COUNT(*) c FROM tasks').get().c, final_state: t.state, handoff_ready: t.handoff_ready === 1, completed: t.state === 'completed',
  engine_ticks: ticks, clock_wakeups_waited_out: waits, simulated_elapsed_minutes: Math.round((clock.now() - T0) / 60000),
  lifecycle_events: q('SELECT to_state s, COUNT(*) n FROM task_events WHERE task_id=? GROUP BY to_state ORDER BY to_state', id).map((r) => ({ state: r.s, n: r.n })),
  executions_by_role: Object.fromEntries(q('SELECT role, COUNT(*) n FROM executions WHERE task_id=? GROUP BY role', id).map((r) => [r.role, r.n])),
  models_requested: q('SELECT model_requested m, effort_requested e, COUNT(*) n FROM executions WHERE task_id=? GROUP BY m, e ORDER BY m, e', id).map((r) => `${r.m}/${r.e} x${r.n}`),
  context_renewals: L.recoveryHistory(id).filter((x) => x.kind === 'context_renewed').map((x) => ({ basis: x.detail.basis, measured: x.detail.measured, utilization: x.detail.utilization })),
  reviews: q('SELECT kind, round, status FROM reviews WHERE task_id=? ORDER BY created_at, rowid', id).map((r) => `${r.kind}#${r.round}:${r.status}`),
  test_runs: q('SELECT passed FROM test_runs WHERE task_id=? ORDER BY created_at, rowid', id).map((r) => (r.passed ? 'pass' : 'fail')),
  waiting_episodes: { subscription: q("SELECT COUNT(*) c FROM task_events WHERE to_state='waiting_subscription'").at(0).c, resources: q("SELECT COUNT(*) c FROM task_events WHERE to_state='waiting_resources'").at(0).c },
  remediations: q("SELECT COUNT(*) c FROM task_events WHERE to_state='remediation'").at(0).c,
  evidence_accepted: q('SELECT evidence_type t, COUNT(*) n FROM evidence GROUP BY evidence_type ORDER BY t').map((r) => `${r.t} x${r.n}`),
  owner_interventions: { blocked_events: q("SELECT COUNT(*) c FROM task_events WHERE to_state='blocked'").at(0).c, owner_action_events: q("SELECT COUNT(*) c FROM task_events WHERE event_json LIKE '%owner_action_id%'").at(0).c, genuine_blocker_notifications: q("SELECT COUNT(*) c FROM outbox WHERE kind='genuine_blocker'").at(0).c },
  notifications: h.adapters.notifier.sent.map((s) => s.kind), reasoning_slot_held_at_end: L.slotHolder() !== null,
  handoff: JSON.parse(L.meta(`handoff:${id}`) ?? 'null') && { digest: JSON.parse(L.meta(`handoff:${id}`)).digest, evidence_types: JSON.parse(L.meta(`handoff:${id}`)).evidence.map((e) => e.type), not_done: JSON.parse(L.meta(`handoff:${id}`)).not_done },
}
h.close(); writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`); process.stdout.write(`${JSON.stringify({ final_state: evidence.final_state, handoff_ready: evidence.handoff_ready, owner_interventions: evidence.owner_interventions })}\n`)
