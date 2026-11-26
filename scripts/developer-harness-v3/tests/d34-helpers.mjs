// D3.4 test helpers shared by the multi-process tests (not a test file). Test keys only.
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { OPS } from '../orchestrator/issuer/issuer-core.mjs'
import { ipcPath } from '../orchestrator/issuer/ipc.mjs'

export const HERE = path.dirname(fileURLToPath(import.meta.url))
export const ORCH = path.join(HERE, '..', 'orchestrator')
export const tmp = (p = 'dh34-') => mkdtempSync(path.join(os.tmpdir(), p))
export const CHILD_ENV = { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, NODE_NO_WARNINGS: '1' }

/** Start REAL issuer processes (one per identity, own key, own IPC secret) for a harness root. Returns endpoints for createIssuerClient. */
export async function startIssuers(h) {
  const secrets = {}; const endpoints = {}; const procs = []
  writeFileSync(path.join(h.dirs.root, 'bundle.json'), JSON.stringify(h.pol.bundle))
  for (const role of Object.keys(OPS)) {
    const secretFile = path.join(h.dirs.root, `${role}.secret`); secrets[role] = randomBytes(32); writeFileSync(secretFile, secrets[role], { mode: 0o600 })
    const listenPath = ipcPath(`d34-${role}-${randomBytes(4).toString('hex')}`, h.dirs.root); endpoints[role] = { listenPath, secretFile }
    const cfg = { identity: role, key_id: h.pol.keyIds[role], key_dir: h.dirs.keys, ledger_file: h.dirs.ledger, store_file: path.join(h.dirs.issuer, `p-${role}.sqlite`), policy_bundle_file: path.join(h.dirs.root, 'bundle.json'), policy_pin: h.pol.revision, ipc_path: listenPath, ipc_secret_file: secretFile, allow_test_keys: true,
      facts_module: path.join(ORCH, 'sim', 'facts-sim.mjs'), sim_world_dir: h.dirs.world }
    const cfgFile = path.join(h.dirs.root, `${role}.json`); writeFileSync(cfgFile, JSON.stringify(cfg))
    const p = spawn(process.execPath, [path.join(ORCH, 'issuer', 'issuer-main.mjs'), cfgFile], { stdio: ['ignore', 'pipe', 'pipe'], env: CHILD_ENV })
    await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('issuer start timeout')), 20000); p.stdout.on('data', (d) => { if (String(d).includes('READY')) { clearTimeout(t); res() } }); p.on('exit', (c) => rej(new Error(`issuer exited ${c}`))) })
    procs.push(p)
  }
  return { secrets, endpoints, stop: () => procs.forEach((p) => p.kill()) }
}
