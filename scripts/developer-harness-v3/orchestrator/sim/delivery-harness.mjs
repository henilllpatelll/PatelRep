// Developer Harness V3 (D3.6) — SIMULATION harness for the delivery path. Everything here is labelled SIMULATED and uses generated TEST keys outside every repository.
//
// Two configurations, never mixed:
//   * AUTHORITATIVE (default): the repository's own authority contract, evaluator and lifecycle. Every delivery effect is REFUSED (ACTION.UNKNOWN or ACTIVATION.NOT_ACTIVE).
//   * PROPOSAL_UNDER_TEST: the protected proposals (P7 delivery authority; optionally P6v2 lifecycle) applied to DISPOSABLE COPIES in the OS temp directory, imported from there, with the
//     delivery actions activated in a TEST policy. This is how the inactive delivery architecture is demonstrated end to end. It never touches the repository's protected files, and its
//     ledgers are temp-only (the D3.5 proposal-reducer rule).
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildPolicyBundle as realBundle, loadContractFile, loadPolicy as realLoad, policyRevision as realRevision } from '../../authority/contract.mjs'
import { evaluate as realEvaluate } from '../../authority/evaluator.mjs'
import { generateIssuerKey } from '../issuer/key-custody.mjs'
import { resolveGit, trustedGit } from '../trusted-git.mjs'
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

/** Apply protected proposal patches to a DISPOSABLE copy of `files` and return the copy's root (LF-exact: `core.autocrlf=false`). */
export function disposableCopy(patches, files, prefix = 'dh36-proposal-') {
  const t = mkdtempSync(path.join(os.tmpdir(), prefix))
  for (const rel of files) { mkdirSync(path.dirname(path.join(t, rel)), { recursive: true }); copyFileSync(path.join(ROOT, rel), path.join(t, rel)) }
  const g = resolveGit(); if (!g.ok) throw new Error(`proposal copy: ${g.code}`) // the hardened, absolute, allow-listed git (never a bare `git` from PATH)
  for (const p of patches) { try { trustedGit(g.exe, t, ['-c', 'core.autocrlf=false', 'apply', '-p1', path.join(PROPOSALS, p)]) } catch (e) { throw new Error(`proposal ${p} does not apply: ${e.message}`) } }
  writeFileSync(path.join(t, 'PROPOSAL_UNDER_TEST.txt'), `Disposable copy with ${patches.join(', ')} applied for tests. NOT the repository's authority.\n`)
  return t
}
const AUTHORITY_FILES = ['scripts/developer-harness-v3/authority/contract.mjs', 'scripts/developer-harness-v3/authority/evaluator.mjs', 'scripts/developer-harness-v3/authority/evidence.mjs', 'scripts/developer-harness-v3/authority/migration-facts.mjs',
  'scripts/developer-harness-v3/authority/policy-version.mjs', 'scripts/developer-harness-v3/authority/spend.mjs', 'scripts/developer-harness-v3/lib/canonical.mjs', 'scripts/developer-harness-v3/lib/paths.mjs', 'docs/developer-harness-v3/authority-contract.json']
/** The P7-patched authority (contract loader + evaluator + the patched contract file), imported from a disposable copy. */
export async function proposalAuthority() {
  const t = disposableCopy(['P7-delivery-authority.patch'], AUTHORITY_FILES)
  const c = await import(pathToFileURL(path.join(t, 'scripts/developer-harness-v3/authority/contract.mjs')).href)
  const ev = await import(pathToFileURL(path.join(t, 'scripts/developer-harness-v3/authority/evaluator.mjs')).href)
  const evidence = await import(pathToFileURL(path.join(t, 'scripts/developer-harness-v3/authority/evidence.mjs')).href)
  return { label: 'PROPOSAL_UNDER_TEST', root: t, loadPolicy: c.loadPolicy, buildPolicyBundle: c.buildPolicyBundle, policyRevision: c.policyRevision, contract: c.loadContractFile(path.join(t, 'docs/developer-harness-v3/authority-contract.json')), evaluate: ev.evaluate, evidence }
}
/** The P6v2-patched lifecycle reducer (D3.5 proposal-reducer configuration). */
export const P6V3_PATCH = 'P6v3-lifecycle-consolidated-delivery-regression.patch'
export async function proposalReducer(patch = 'P6v2-lifecycle-consolidated-delivery.patch') {
  const t = disposableCopy([patch], ['scripts/developer-harness-v3/lifecycle/lifecycle.mjs', 'scripts/developer-harness-v3/lib/canonical.mjs', 'docs/developer-harness-v3/task-lifecycle.json'], 'dh36-p6v2-')
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
 * @param {{root:string, proposal?:boolean, lifecycle?:'authoritative'|'P6v2'|'P6v3', activate?:string[], scenario?:object, gh?:object, facts?:object, cfg?:object, dcfg?:object, clock?:FixtureClock, authority?:object, reducer?:object}} o
 */
export async function createDeliveryHarness({ root, proposal = false, lifecycle = 'authoritative', activate = proposal ? DELIVERY_ACTIONS : [], scenario = {}, gh = {}, facts = {}, cfg = {}, dcfg = {}, clock = new FixtureClock(), authority = null, reducer = null }) {
  // security review OPT-3: an ACTIVATED test policy (proposal or explicit activation) and its ledger may live ONLY under the OS temp directory
  if ((proposal || activate.length) && !Ledger.isTempLedgerPath(path.join(root, 'ledger.sqlite'))) throw new Error('DELIVERY_HARNESS.ACTIVATED_POLICY_OUTSIDE_TEMP')
  const auth = proposal ? (authority ?? await proposalAuthority()) : null
  const red = lifecycle === 'P6v2' || lifecycle === 'P6v3' ? (reducer ?? await proposalReducer(lifecycle === 'P6v3' ? P6V3_PATCH : undefined)) : null
  const h = createHarness({ root, scenario, clock, cfg, makePolicy: policyMaker({ authority: auth, activate }), ledgerOptions: red ? { proposalReducer: red } : {} })
  const github = new SimGitHub({ dir: h.dirs.world, clock: clock.now, mainSha: BASE, scenario: gh })
  const dfacts = createDeliveryFacts({ dir: h.dirs.world, ledger: h.ledger, contract: h.policy.contract, scenario: facts, evaluatorKnowsRisk: !!auth })
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
  writeFileSync(path.join(root, 'SIMULATED.txt'), `Produced by the D3.6 delivery simulation (${proposal ? 'PROPOSAL_UNDER_TEST: P7' : 'AUTHORITATIVE'}${red ? ` + ${lifecycle}` : ''}). No network, GitHub, staging, model or production key was involved.\n`)
  return { ...h, github, dfacts, issuers, delivery, credential, authority: auth, reducer: red, drive, close: () => close(), label: proposal ? 'PROPOSAL_UNDER_TEST' : 'AUTHORITATIVE' }
}
