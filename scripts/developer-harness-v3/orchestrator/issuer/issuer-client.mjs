// Developer Harness V3 (D3.4) — the ONLY issuer-facing module the orchestrator may import. It can ask; it cannot sign and it can never load a key.
// (A static test forbids the engine from importing issuer-core / key-custody / any crypto signing primitive.)
import { readFileSync } from 'node:fs'
import { callIssuer } from './ipc.mjs'

/** Roles → the single operation each issuer exposes. The client mirrors, but does not enforce, the server's allow-list. */
export const ROLE_OPS = Object.freeze({ orchestrator: 'issue_test_results', independent_reviewer: 'issue_review', security_reviewer: 'issue_review', delivery_verifier: 'issue_isolation_attestation' })

/** @param {Record<string,{listenPath:string, secretFile:string}>} endpoints one per issuer role */
export function createIssuerClient(endpoints) {
  const secrets = new Map()
  const secretFor = (role) => { if (!secrets.has(role)) secrets.set(role, readFileSync(endpoints[role].secretFile)); return secrets.get(role) }
  const ask = async (role, op, params) => {
    if (!endpoints[role] || ROLE_OPS[role] !== op) return { ok: false, code: 'CLIENT.UNKNOWN_ROLE_OR_OPERATION' }
    try { return await callIssuer({ listenPath: endpoints[role].listenPath, secret: secretFor(role), op, params }) } catch (e) { return { ok: false, code: 'CLIENT.ISSUER_UNREACHABLE', detail: String(e.message).slice(0, 60) } }
  }
  return Object.freeze({
    testResults: (task_id, run_id) => ask('orchestrator', 'issue_test_results', { task_id, run_id }),
    review: (kind, task_id, review_id) => ask(kind === 'security_review' ? 'security_reviewer' : 'independent_reviewer', 'issue_review', { task_id, review_id }),
    isolationAttestation: (task_id, environment_id) => ask('delivery_verifier', 'issue_isolation_attestation', { task_id, environment_id }),
  })
}
