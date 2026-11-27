// Developer Harness V3 (D3.6) — SIMULATION harness for the delivery path. Everything here is labelled SIMULATED and uses generated TEST keys outside every repository.
//
// Two configurations, never mixed:
//   * AUTHORITATIVE (default): the repository's own authority contract, evaluator and lifecycle with the repository's (empty) activation. Every delivery effect is REFUSED
//     (ACTIVATION.NOT_ACTIVE: since the D3.6 integration the contract KNOWS the delivery actions — P7 — and keeps every one of them inactive).
//   * INTEGRATED_TEST_ACTIVATION: the SAME repository authority, evaluator and (P6v3) lifecycle, with the delivery actions activated in a generated TEST policy whose keys and
//     ledgers live only under the OS temp directory. This is how the inactive delivery architecture is demonstrated end to end. Before the integration this configuration ran
//     the protected proposals from patched disposable copies (PROPOSAL_UNDER_TEST); now that P7 and P6v3 ARE the repository's code, no patched copy is used.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildPolicyBundle as realBundle, loadContractFile, loadPolicy as realLoad, policyRevision as realRevision } from '../../authority/contract.mjs'
import { evaluate as realEvaluate } from '../../authority/evaluator.mjs'
import * as realEvidence from '../../authority/evidence.mjs'
import { generateIssuerKey } from '../issuer/key-custody.mjs'
import { resolveGit, trustedGit } from '../../authority/trusted-git.mjs'
import { Ledger } from '../ledger/ledger.mjs'
import { DeliveryIssuer } from '../issuer/delivery-issuer.mjs'
import { DeliveryController } from '../delivery/controller.mjs'
import { durableViewClass } from '../delivery/authorize.mjs'
import { createFacts } from './facts-sim.mjs'
import { createDeliveryFacts } from './sim-delivery-facts.mjs'
import { SimGitHub } from './sim-github.mjs'
import { BASE, FixtureClock, createHarness } from './harness.mjs'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
export const PROPOSALS = path.join(ROOT, 'docs/developer-harness-v3/proposals')
export const DELIVERY_ROLES = Object.freeze(['orchestrator', 'independent_reviewer', 'security_reviewer', 'delivery_verifier', 'trusted_publisher', 'task_ingress'])
export const DELIVERY_ACTIONS = Object.freeze(['publish_candidate_branch', 'open_draft_pull_request', 'update_pull_request_metadata', 'mark_pull_request_ready', 'rerun_ci_jobs', 'dispatch_staging_candidate', 'verify_delivery_eligibility'])

const readManifest = () => JSON.parse(readFileSync(path.join(PROPOSALS, 'manifest.json'), 'utf8'))
/** The patches the D3.6 integration applied to the repository, in application order: the integrated proposals, then the separately reviewed integration corrections. */
export function integratedChain(manifest = readManifest()) {
  const by = Object.fromEntries(manifest.proposals.map((p) => [p.id, p]))
  return [...manifest.integration.integrated_chain.map((id) => by[id]), ...manifest.integration.corrections].map((p) => {
    const renamedTo = [...readFileSync(path.join(PROPOSALS, p.file), 'utf8').matchAll(/^rename to (\S+)$/gm)].map((m) => m[1]) // a rename's destination (touches lists the source)
    return { id: p.id, file: p.file, touches: [...new Set([...p.touches.map((t) => t.replace(/ \(new\)$/, '')), ...renamedTo])] }
  })
}
/**
 * Review M1: the reconstruction reverses ONLY the V3 root-of-trust files — authority/**, the lifecycle reducer, the two V3 contracts (and the old location of the moved
 * trusted-git.mjs). Those change only through an owner proposal APPENDED to the chain, so ordinary later edits of ci.yml, the staging workflow, V2 tests or non-authority V3 code
 * can never break it. The control-plane files of P2/C2 are protected by their own pins (the V2 workflow guard, the staging workflow tests), not by this reconstruction.
 */
export const RECONSTRUCTION_SCOPE = Object.freeze([/^scripts\/developer-harness-v3\/authority\/[^/]+$/, /^scripts\/developer-harness-v3\/lifecycle\/lifecycle\.mjs$/,
  /^docs\/developer-harness-v3\/(authority-contract|task-lifecycle)\.json$/, /^scripts\/developer-harness-v3\/orchestrator\/trusted-git\.mjs$/])
export const inReconstructionScope = (f) => RECONSTRUCTION_SCOPE.some((r) => r.test(f))

/**
 * A DISPOSABLE copy of `files` (LF-exact: `core.autocrlf=false`), optionally first REVERSED to the pre-integration base (`preIntegration`: every patch of the integrated chain
 * reverse-applied, last first — exactly the tree the proposals were cut against), then with `patches` applied on top. Returns the copy's root. Never touches the repository.
 */
export function disposableCopy(patches, files, prefix = 'dh36-proposal-', { preIntegration = false } = {}) {
  const t = mkdtempSync(path.join(os.tmpdir(), prefix))
  const chain = preIntegration ? integratedChain().map((c) => ({ ...c, scoped: c.touches.filter(inReconstructionScope) })).filter((c) => c.scoped.length) : []
  const all = new Set(files); for (const c of chain) for (const f of c.scoped) all.add(f)
  for (const rel of all) { if (!existsSync(path.join(ROOT, rel))) continue; mkdirSync(path.dirname(path.join(t, rel)), { recursive: true }); copyFileSync(path.join(ROOT, rel), path.join(t, rel)) }
  const g = resolveGit(); if (!g.ok) throw new Error(`proposal copy: ${g.code}`) // the hardened, absolute, allow-listed git (never a bare `git` from PATH)
  for (const c of [...chain].reverse()) { try { trustedGit(g.exe, t, ['-c', 'core.autocrlf=false', 'apply', '--reverse', '-p1', ...c.scoped.map((f) => `--include=${f}`), path.join(PROPOSALS, c.file)]) } catch (e) { throw new Error(`integrated ${c.id} does not reverse-apply: ${e.message}`) } }
  for (const p of patches) { try { trustedGit(g.exe, t, ['-c', 'core.autocrlf=false', 'apply', '-p1', path.join(PROPOSALS, p)]) } catch (e) { throw new Error(`proposal ${p} does not apply: ${e.message}`) } }
  writeFileSync(path.join(t, 'PROPOSAL_UNDER_TEST.txt'), `Disposable copy${preIntegration ? ' (pre-integration base)' : ''} with ${patches.join(', ') || 'no patch'} applied for tests. NOT the repository's authority.\n`)
  return t
}
/** The repository's OWN authority (P7 integrated), exposed for the test-activation configuration. Nothing is copied or patched. */
export async function testActivationAuthority() {
  return { label: 'INTEGRATED_TEST_ACTIVATION', root: ROOT, loadPolicy: realLoad, buildPolicyBundle: realBundle, policyRevision: realRevision, contract: loadContractFile(), evaluate: realEvaluate, evidence: realEvidence }
}
/**
 * A labelled reducer from a DISPOSABLE copy of the lifecycle files with `patches` applied (none by default: the integrated reducer itself). This exists ONLY to exercise the
 * ledger's proposal-reducer safeguards (temp-only, labelled, never reopened as authoritative) for FUTURE lifecycle proposals; no integrated proposal is applied twice.
 */
export async function proposalReducer(patches = [], { preIntegration = false } = {}) {
  const t = disposableCopy(patches, ['scripts/developer-harness-v3/lifecycle/lifecycle.mjs', 'scripts/developer-harness-v3/lib/canonical.mjs', 'docs/developer-harness-v3/task-lifecycle.json'], 'dh3-proposal-reducer-', { preIntegration })
  const mod = await import(pathToFileURL(path.join(t, 'scripts/developer-harness-v3/lifecycle/lifecycle.mjs')).href)
  return { label: 'PROPOSAL_UNDER_TEST', applyEvent: mod.applyEvent, createTask: mod.createTask, lc: mod.loadLifecycle() }
}

/** Test keys for every delivery role + a policy over `authority`'s contract, persisted so a restarted controller reloads the SAME pinned revision. */
function policyMaker({ authority, activate }) {
  return (dirs) => {
    const file = path.join(dirs.root, 'delivery-policy.json')
    const load = authority?.loadPolicy ?? realLoad
    if (existsSync(file)) { const s = JSON.parse(readFileSync(file, 'utf8')); const l = load(s.bundle, s.revision); if (!l.ok) throw new Error('saved delivery policy invalid'); return { policy: l.policy, bundle: s.bundle, revision: s.revision, keyIds: s.keyIds } }
    const trusted_keys = {}; const keyIds = {}
    for (const identity of DELIVERY_ROLES) {
      const keyId = `test-${identity.replace(/_/g, '-')}`
      const g = generateIssuerKey({ identity, keyId, keyDir: dirs.keys, notBefore: '2026-01-01T00:00:00Z', notAfter: '2027-12-31T00:00:00Z', test: true }); if (!g.ok) throw new Error(`test key: ${g.code}`)
      const { key_id, ...rest } = g.entry; trusted_keys[key_id] = rest; keyIds[identity] = keyId
    }
    const contract = structuredClone(authority?.contract ?? loadContractFile()); contract.activation = { ...contract.activation, active_actions: activate.filter((a) => Object.hasOwn(contract.actions, a)) }
    const bundle = (authority?.buildPolicyBundle ?? realBundle)({ contract, trusted_keys, parent_revision: null }); const revision = (authority?.policyRevision ?? realRevision)(bundle)
    const l = load(bundle, revision); if (!l.ok) throw new Error(`delivery policy invalid: ${l.problems.join(',')}`)
    writeFileSync(file, JSON.stringify({ bundle, revision, keyIds }))
    return { policy: l.policy, bundle, revision, keyIds }
  }
}

/**
 * `historicalLifecycle: 'pre-integration'` runs the ledger on the D3.6-TIME reducer (the integrated chain reversed on a disposable copy, labelled PROPOSAL_UNDER_TEST, temp-only):
 * it exists ONLY to keep regression coverage of the controller's fail-closed paths for a lifecycle WITHOUT the P6v3 edges. It is never the authoritative lifecycle.
 * @param {{root:string, testActivation?:boolean, historicalLifecycle?:null|'pre-integration', activate?:string[], scenario?:object, gh?:object, facts?:object, cfg?:object, dcfg?:object, clock?:FixtureClock, authority?:object}} o
 */
export async function createDeliveryHarness({ root, testActivation = false, historicalLifecycle = null, activate = testActivation ? DELIVERY_ACTIONS : [], scenario = {}, gh = {}, facts = {}, cfg = {}, dcfg = {}, clock = new FixtureClock(), authority = null, ...rest }) {
  // D3.6 integration: P6v2/P6v3 and P7 are the repository's own lifecycle and authority now. Asking for a patched proposal copy is a mistake, not a configuration.
  if (Object.hasOwn(rest, 'proposal') || Object.hasOwn(rest, 'reducer') || (rest.lifecycle !== undefined && rest.lifecycle !== 'authoritative')) throw new Error('DELIVERY_HARNESS.PROPOSAL_INTEGRATED')
  if (historicalLifecycle !== null && historicalLifecycle !== 'pre-integration') throw new Error('DELIVERY_HARNESS.UNKNOWN_HISTORICAL_LIFECYCLE')
  // security review OPT-3: an ACTIVATED test policy (test activation or explicit activation) and its ledger may live ONLY under the OS temp directory
  if ((testActivation || activate.length) && !Ledger.isTempLedgerPath(path.join(root, 'ledger.sqlite'))) throw new Error('DELIVERY_HARNESS.ACTIVATED_POLICY_OUTSIDE_TEMP')
  const auth = testActivation ? (authority ?? await testActivationAuthority()) : null
  const red = historicalLifecycle ? await proposalReducer([], { preIntegration: true }) : null
  const h = createHarness({ root, scenario, clock, cfg, makePolicy: policyMaker({ authority: auth, activate }), ledgerOptions: red ? { proposalReducer: red } : {} })
  const github = new SimGitHub({ dir: h.dirs.world, clock: clock.now, mainSha: BASE, scenario: gh })
  const dfacts = createDeliveryFacts({ dir: h.dirs.world, ledger: h.ledger, contract: h.policy.contract, scenario: facts })
  const simFacts = createFacts({ sim_world_dir: h.dirs.world })
  const issuers = {}; const ro = []
  for (const identity of ['delivery_verifier', 'trusted_publisher', 'task_ingress']) {
    const l = Ledger.openReadOnly(h.dirs.ledger, { clock: clock.now }); ro.push(l)
    issuers[identity] = new DeliveryIssuer({ identity, keyId: h.pol.keyIds[identity], keyDir: h.dirs.keys, ledger: l, policy: h.policy, reader: { view: () => github.view(), jobLog: (r, a) => github.jobLog(r, a) }, facts: simFacts, clock: clock.now, storeFile: path.join(h.dirs.issuer, `delivery-${identity}.sqlite`) })
  }
  const credential = Object.freeze({ scope: 'publisher', simulated: true }) // held by the publisher adapter ONLY; never placed in a worker, a session or the environment
  const delivery = new DeliveryController({ engine: h.engine, verifier: issuers.delivery_verifier, publisherIssuer: issuers.trusted_publisher, ingress: issuers.task_ingress, publisher: github, credential, facts: dfacts,
    evaluateFn: auth ? auth.evaluate : realEvaluate, ...(auth ? { View: durableViewClass(auth.evidence.EvidenceLedger) } : {}), cfg: dcfg })
  const close = () => { for (const i of Object.values(issuers)) i.close(); for (const l of ro) l.close(); h.close() }
  /** Drive engine + delivery deterministically, advancing the fixture clock to the next wake-up when nothing is runnable. Stops when `until()` holds or nothing is scheduled. */
  async function drive({ until = () => false, maxRounds = 400, stepMs = 60_000, onRound = null } = {}) {
    const log = []
    for (let i = 0; i < maxRounds; i += 1) {
      if (until()) return { done: true, rounds: i, log }
      const a = await h.engine.tick(); const b = await delivery.tick(); log.push({ engine: a.action ?? null, delivery: b.steps.filter((s) => s.progressed || s.action).map((s) => `${s.task_id}:${s.action ?? s.waiting}`) })
      if (onRound) await onRound(i, { a, b })
      if (!a.progressed && !b.progressed) {
        const next = [h.engine.nextWakeup(), delivery.nextWakeup()].filter((x) => Number.isFinite(x) && x > clock.now())
        clock.advance(next.length ? Math.min(Math.min(...next) - clock.now() + 1, 10 * 60_000) : stepMs)
      }
    }
    return { done: until(), rounds: maxRounds, log }
  }
  const label = `${testActivation ? 'INTEGRATED_TEST_ACTIVATION' : 'AUTHORITATIVE'}${red ? '+PRE_INTEGRATION_LIFECYCLE' : ''}`
  writeFileSync(path.join(root, 'SIMULATED.txt'), `Produced by the D3.6 delivery simulation (${label}). No network, GitHub, staging, model or production key was involved.\n`)
  return { ...h, github, dfacts, issuers, delivery, credential, authority: auth, drive, close: () => close(), label }
}
