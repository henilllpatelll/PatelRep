// D3.4 test helper (not a test): one OS process racing to consume the same evidence through its OWN SQLite connection.
//   node d34-race-worker.mjs <ledger> <evidence_id> <label> <go-file>
import { existsSync } from 'node:fs'
import { Ledger } from '../orchestrator/ledger/ledger.mjs'
import { consumeAll } from '../orchestrator/ledger/evidence-store.mjs'

const [, , file, id, label, go] = process.argv
const L = Ledger.open(file)
while (!existsSync(go)) await new Promise((r) => setTimeout(r, 2)) // all workers released together
process.stdout.write(JSON.stringify({ label, ...consumeAll(L, [id], label) }))
L.close()
