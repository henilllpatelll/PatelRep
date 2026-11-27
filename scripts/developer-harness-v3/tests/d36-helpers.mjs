// D3.6 test helpers (not a test file). Everything is SIMULATED: temp ledgers, the simulated GitHub/staging world, generated TEST keys. No network, GitHub, staging or real credential.
import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sign } from 'node:crypto'
import { canonicalize } from '../lib/canonical.mjs'
import { OBSERVATION_DOMAIN, OBSERVATION_SCHEMA, verifyRemoteObservation } from '../orchestrator/delivery/observation.mjs'
import { P6V3_PATCH, createDeliveryHarness, proposalAuthority, proposalReducer } from '../orchestrator/sim/delivery-harness.mjs'
import { privatePath } from '../orchestrator/issuer/key-custody.mjs'
import { createPrivateKey } from 'node:crypto'

export const tmp = (p = 'dh36-') => mkdtempSync(path.join(os.tmpdir(), p))
let AUTH = null; let RED = null; let RED3 = null
/** The labelled PROPOSAL_UNDER_TEST authority (P7 on a disposable copy), built once per test file. */
export const auth = async () => (AUTH ??= await proposalAuthority())
export const p6v2 = async () => (RED ??= await proposalReducer())
export const p6v3 = async () => (RED3 ??= await proposalReducer(P6V3_PATCH))
export async function harness(o = {}) {
  const proposal = o.proposal ?? true
  return createDeliveryHarness({ root: o.root ?? tmp(), ...o, proposal, ...(proposal ? { authority: await auth() } : {}), ...(o.lifecycle === 'P6v2' ? { reducer: await p6v2() } : {}), ...(o.lifecycle === 'P6v3' ? { reducer: await p6v3() } : {}) })
}
const DELIVERY = ['publishing', 'ci_running', 'staging_verification', 'merge_eligible']
/** Drive the ENGINE only, until the task's local handoff (nothing is published). */
export async function toHandoff(h, id) {
  for (let i = 0; i < 200 && h.ledger.getTask(id).handoff_ready !== 1; i += 1) { const r = await h.engine.tick(); if (!r.progressed) h.clock.advance(60_000) }
  if (h.ledger.getTask(id).handoff_ready !== 1) throw new Error(`no handoff: ${h.ledger.getTask(id).state}`)
}
export const state = (h, id) => h.ledger.getTask(id).state
export const untilState = (h, id, states) => () => [].concat(states).includes(state(h, id)) || !!h.ledger.getSuspension(id) || state(h, id) === 'blocked'
export const inDelivery = (h, id) => DELIVERY.includes(state(h, id))
export const intents = (h, id = null) => h.ledger.db.prepare(`SELECT * FROM action_intents${id ? ' WHERE task_id=?' : ''} ORDER BY created_at, rowid`).all(...(id ? [id] : [])).map((r) => ({ ...r }))
export const ops = (h, op = null) => h.github.s.ops.filter((o) => !op || o.op === op)
export const ownerInterventions = (h) => h.ledger.db.prepare("SELECT COUNT(*) c FROM task_events WHERE json_extract(event_json,'$.owner_action_id') IS NOT NULL").get().c
/** A verified observation straight from the harness's verifier. */
export async function observe(h, op, params, expect = {}) {
  const r = await h.issuers.delivery_verifier.handle(op, params); if (!r.ok) return r
  return verifyRemoteObservation(r.envelope, { policy: h.policy, now: h.ledger.now(), expect })
}
/** Sign an arbitrary observation payload with the TEST key of `identity` (forgery fixtures: the right domain with the wrong key, the right key with the wrong domain, …). */
export function signObservation(h, identity, payload, { domain = OBSERVATION_DOMAIN } = {}) {
  const keyId = h.pol.keyIds[identity]
  const key = createPrivateKey(readFileSync(privatePath(h.dirs.keys, keyId)))
  const value = sign(null, Buffer.from(`${domain}${canonicalize(payload)}`, 'utf8'), key).toString('base64')
  return { schema: OBSERVATION_SCHEMA, version: 1, payload, signature: { alg: 'ed25519', key_id: keyId, value } }
}
