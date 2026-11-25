// Developer Harness V3 (D3.4) — SIMULATED controller process, used by the crash/restart tests. A real OS process running the real Engine and ledger against a
// persistent simulation world; the parent kills it (SIGKILL) at a named boundary and starts it again.
//   node controller-main.mjs <config.json>
// config: { root, scenario, cfg, crash_at?: "<hook point>:<nth occurrence>", issuer_endpoints?, max_ticks }
// Exit: 0 = idle (result JSON on stdout), 3 = refused to start (another controller / unsafe), killed = crash.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHarness } from './harness.mjs'
import { recoverOnStart } from '../recovery.mjs'

const cfg = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const [crashPoint, crashNth] = (cfg.crash_at ?? ':').split(':'); const nth = Number(crashNth || 1); const seen = {}
const hook = (name) => { if (name !== crashPoint) return; seen[name] = (seen[name] ?? 0) + 1; if (seen[name] === nth) { writeFileSync(path.join(cfg.root, 'crashed-at.txt'), `${name}:${nth}`); process.kill(process.pid, 'SIGKILL') } }
const h = createHarness({ root: cfg.root, scenario: cfg.scenario ?? {}, cfg: cfg.cfg ?? {}, hook, issuerEndpoints: cfg.issuer_endpoints ?? null, clock: { now: Date.now, advance() {} } })
const started = await recoverOnStart(h.engine, { lockFile: path.join(cfg.root, 'controller.lock') })
if (!started.ok) { process.stderr.write(`${started.code}\n`); process.exit(3) }
const r = await h.engine.runUntilIdle({ maxTicks: cfg.max_ticks ?? 400 })
started.release()
process.stdout.write(JSON.stringify({ idle: r.idle, ticks: r.ticks, simulated: true, recovery: { uncertain: started.uncertain_intents, slot: started.slot } }))
h.close()
