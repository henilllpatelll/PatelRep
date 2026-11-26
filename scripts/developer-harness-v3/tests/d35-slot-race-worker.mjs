// D3.5 test helper (not a test): one OS process racing for a slot through its OWN SQLite connection, or opening a ledger whose migration is killed mid-transaction.
//   node d35-slot-race-worker.mjs lease <ledger> <taskId> <label> <go-file>
//   node d35-slot-race-worker.mjs work  <ledger> <taskId> <label> <go-file>
//   node d35-slot-race-worker.mjs kill-migration <ledger> <version>      (SIGKILLs ITSELF inside the migration transaction of <version>)
import { existsSync } from 'node:fs'
import { Ledger } from '../orchestrator/ledger/ledger.mjs'
import { acquireWork } from '../orchestrator/ledger/slots.mjs'

const [, , mode, file, a, label, go] = process.argv
if (mode === 'kill-migration') {
  Ledger.open(file, { migrationHook: (v) => { if (v === Number(a)) { process.stdout.write('KILLING\n'); process.kill(process.pid, 'SIGKILL') } } })
  process.stdout.write('NOT_KILLED\n')
} else {
  let L
  try { L = Ledger.open(file) } catch (e) { process.stdout.write(JSON.stringify({ label, ok: false, code: `OPEN_THROW:${String(e.message).slice(0, 80)}`, slot: null })); process.exit(0) }
  while (!existsSync(go)) await new Promise((r) => setTimeout(r, 2)) // all workers released together
  let r
  try { r = mode === 'work' ? acquireWork(L, { taskId: a, unitRef: `race:${label}` }) : L.acquireLease({ taskId: a, role: 'implementer', stage: 'implementing', model: 'sonnet', effort: 'high' }) } catch (e) { r = { ok: false, code: `THROW:${String(e.message).slice(0, 80)}` } }
  process.stdout.write(JSON.stringify({ label, ok: r.ok, code: r.code ?? null, slot: r.lease?.slot ?? r.work?.slot_no ?? null }))
  L.close()
}
