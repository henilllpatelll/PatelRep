// Developer Harness V3 (D3.4) — issuer process entry point. One process = one identity = one key. Started by the owner's service manager under that
// role's OWN OS account (activation gate G-ISSUER-ACCOUNTS); D3.4 development runs it only with test keys and fixture policies.
//
//   node issuer-main.mjs <config.json>
// The config is OWNER-controlled (never in a candidate checkout) and names: identity, key_id, key_dir, ledger_file (opened READ-ONLY), store_file, policy_bundle_file,
// policy_pin (sha256 revision pinned out of band), ipc_path, ipc_secret_file, facts_module (absolute path exporting createFacts(config)).
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { loadPolicy } from '../../authority/contract.mjs'
import { Ledger } from '../ledger/ledger.mjs'
import { IssuerCore } from './issuer-core.mjs'
import { startIssuerServer } from './ipc.mjs'

const fail = (code) => { process.stderr.write(`${code}\n`); process.exit(2) }
const cfgPath = process.argv[2]
if (!cfgPath || process.argv.length !== 3) fail('ISSUER.USAGE')
let cfg; try { cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) } catch { fail('ISSUER.CONFIG_UNREADABLE') }
for (const k of ['identity', 'key_id', 'key_dir', 'ledger_file', 'store_file', 'policy_bundle_file', 'policy_pin', 'ipc_path', 'ipc_secret_file', 'facts_module']) if (typeof cfg[k] !== 'string') fail(`ISSUER.CONFIG_MISSING:${k}`)
if (!path.isAbsolute(cfg.facts_module)) fail('ISSUER.FACTS_MODULE_MUST_BE_ABSOLUTE')
const loaded = loadPolicy(JSON.parse(readFileSync(cfg.policy_bundle_file, 'utf8')), cfg.policy_pin)
if (!loaded.ok) fail(`ISSUER.POLICY_REJECTED:${loaded.problems[0]}`)
const { createFacts } = await import(pathToFileURL(cfg.facts_module).href)
const core = new IssuerCore({ identity: cfg.identity, keyId: cfg.key_id, keyDir: cfg.key_dir, ledger: Ledger.openReadOnly(cfg.ledger_file), policy: loaded.policy, facts: createFacts(cfg), storeFile: cfg.store_file })
const secret = readFileSync(cfg.ipc_secret_file)
const srv = await startIssuerServer({ listenPath: cfg.ipc_path, secret, core })
process.stdout.write(`READY ${cfg.identity}\n`)
const stop = async () => { await srv.close(); core.close(); process.exit(0) }
process.on('SIGTERM', stop); process.on('SIGINT', stop)
