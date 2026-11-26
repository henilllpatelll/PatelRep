// Developer Harness V3 (D3.4) — SIMULATION harness: wires a real temp ledger, a loaded policy pinned from generated TEST keys, real IssuerCore instances and
// the Engine, on a fixture clock. Used by the tests and by the subprocess controller. Everything it produces is labelled simulated; no production key exists here.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createIssuerClient } from '../issuer/issuer-client.mjs'
import { buildPolicyBundle, loadContractFile, loadPolicy, policyRevision } from '../../authority/contract.mjs'
import { Engine } from '../engine.mjs'
import { Ledger } from '../ledger/ledger.mjs'
import { IssuerCore } from '../issuer/issuer-core.mjs'
import { generateIssuerKey } from '../issuer/key-custody.mjs'
import { createFacts } from './facts-sim.mjs'
import { createSimAdapters } from './sim-adapters.mjs'
import { saveWorld, loadWorld } from './sim-world.mjs'

export const REPO = 'henilllpatelll/PatelRep'
export const BASE = '5ced4d309cf3532a490a48dbd06c575994822eac'
export const ENV_ID = 'vm-isolated-sim'
export const T0 = Date.parse('2026-11-25T12:00:00Z')
export const ROLES = ['orchestrator', 'independent_reviewer', 'security_reviewer', 'delivery_verifier']

export class FixtureClock { constructor(t = T0) { this.t = t } now = () => this.t; advance(ms) { this.t += ms; return this.t } }

/** Generate TEST keys (prefix `test-`, in a temp key directory OUTSIDE any repository) and the policy that pins them. */
export function makeTestPolicy({ keyDir, forbiddenRoots = [], activate = [] }) {
  const trusted_keys = {}; const keyIds = {}
  for (const identity of ROLES) {
    const keyId = `test-${identity.replace(/_/g, '-')}`
    const g = generateIssuerKey({ identity, keyId, keyDir, forbiddenRoots, notBefore: '2026-01-01T00:00:00Z', notAfter: '2027-12-31T00:00:00Z', test: true })
    if (!g.ok) throw new Error(`test key: ${g.code}`)
    const { key_id, ...rest } = g.entry; trusted_keys[key_id] = rest; keyIds[identity] = keyId
  }
  const contract = structuredClone(loadContractFile()); contract.activation = { ...contract.activation, active_actions: activate }
  const bundle = buildPolicyBundle({ contract, trusted_keys, parent_revision: null })
  const revision = policyRevision(bundle); const loaded = loadPolicy(bundle, revision)
  if (!loaded.ok) throw new Error(`test policy invalid: ${loaded.problems.join(',')}`)
  return { policy: loaded.policy, bundle, revision, keyIds }
}

export const defaultTask = (policy, over = {}) => ({ repository: REPO, base_sha: BASE, requirements: { text: 'Add the offline PM queue indicator to the mobile Engineering screen.' }, scope: { allowed_paths: ['apps/mobile/**'], denied_paths: [] },
  acceptance: { criteria: ['indicator visible when queue is non-empty', 'existing tests pass'], production_required: true }, risk_class: 'routine', policy_revision: policy.revision, environment_id: ENV_ID, ...over })

/** Policy + test keys are generated ONCE per root and reloaded on restart (a restarted controller must see the same pinned policy). */
export function loadOrMakePolicy(dirs) {
  const file = path.join(dirs.root, 'policy.json')
  if (existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    const loaded = loadPolicy(saved.bundle, saved.revision)
    if (!loaded.ok) throw new Error('saved test policy invalid')
    return { policy: loaded.policy, bundle: saved.bundle, revision: saved.revision, keyIds: saved.keyIds }
  }
  const pol = makeTestPolicy({ keyDir: dirs.keys })
  writeFileSync(file, JSON.stringify({ bundle: pol.bundle, revision: pol.revision, keyIds: pol.keyIds }))
  return pol
}

/**
 * @param {{root:string, scenario?:object, clock?:FixtureClock, cfg?:object, hook?:Function, isolation?:object, issuerEndpoints?:object|null}} o
 *   issuerEndpoints: when given, the engine talks to REAL issuer processes over authenticated IPC; otherwise IssuerCore instances run in-process (tests only).
 */
export function createHarness({ root, scenario = {}, clock = new FixtureClock(), cfg = {}, hook = null, isolation = null, issuerEndpoints = null, ledgerOptions = {}, makePolicy = null }) {
  const dirs = { root, keys: path.join(root, 'keys-outside-repo'), world: path.join(root, 'world'), snapshots: path.join(root, 'snapshots'), issuer: path.join(root, 'issuer'), ledger: path.join(root, 'ledger.sqlite') }
  for (const d of Object.values(dirs)) if (!d.endsWith('.sqlite')) mkdirSync(d, { recursive: true })
  const pol = makePolicy ? makePolicy(dirs) : loadOrMakePolicy(dirs) // D3.6: the delivery harness supplies its own (test-key) policy builder
  const ledger = Ledger.open(dirs.ledger, { clock: clock.now, ...ledgerOptions })
  saveWorld(dirs.world, loadWorld(dirs.world))
  const adapters = createSimAdapters({ dir: dirs.world, clock: clock.now, scenario, ledger })
  const facts = createFacts({ sim_world_dir: dirs.world, sim_isolation: isolation })
  const cores = {}
  if (issuerEndpoints) adapters.issuer = createIssuerClient(issuerEndpoints)
  else {
    for (const role of ROLES) {
      const ro = Ledger.openReadOnly(dirs.ledger, { clock: clock.now })
      cores[role] = new IssuerCore({ identity: role, keyId: pol.keyIds[role], keyDir: dirs.keys, ledger: ro, policy: pol.policy, facts, clock: clock.now, storeFile: path.join(dirs.issuer, `${role}.sqlite`) })
    }
    adapters.issuer = {
      testResults: async (task_id, run_id) => cores.orchestrator.handle('issue_test_results', { task_id, run_id }),
      review: async (kind, task_id, review_id) => (kind === 'security_review' ? cores.security_reviewer : cores.independent_reviewer).handle('issue_review', { task_id, review_id }),
      isolationAttestation: async (task_id, environment_id) => cores.delivery_verifier.handle('issue_isolation_attestation', { task_id, environment_id }),
    }
  }
  const engine = new Engine({ ledger, policy: pol.policy, adapters, cfg, rng: () => 0.5, hook, snapshotRoot: dirs.snapshots, mode: 'simulated' })
  const submit = (over = {}) => { const r = ledger.submitTask(defaultTask(pol.policy, over)); if (!r.ok) throw new Error(`submit: ${r.problems.join(',')}`); return r.task.task_id }
  const close = () => { for (const c of Object.values(cores)) { c.ledger.close(); c.close() } ledger.close() }
  writeFileSync(path.join(root, 'SIMULATED.txt'), 'Everything under this directory was produced by the D3.4 simulation harness. No model, VM, network or production key was involved.\n')
  return { ledger, engine, adapters, policy: pol.policy, pol, clock, dirs, cores, submit, close, facts }
}
