// Developer Harness V3 (D3.4) — issuer key custody: generation, ACL plan, registration / rotation / revocation PROPOSALS, emergency deactivation.
//
// Ground rules (each enforced and tested):
//  * Private keys are generated into a key directory that is OUTSIDE every repository / candidate / worker path, created exclusively (wx) with owner-only mode.
//    On Windows, mode bits mean nothing, so the real control is the ACL PLAN below, applied by the owner ceremony to dedicated per-role accounts
//    (gate G-ISSUER-ACCOUNTS). Separate directories or role prompts under ONE OS account are NOT credential isolation and are never claimed to be.
//  * This module PROPOSES policy changes (new trusted_keys entries); it can never activate one. Key changes are root-of-trust: D3.2's diffPolicy classifies
//    them `root_of_trust` and automated promotion is impossible — the owner ceremony is the only path.
//  * Only the issuer process loads a private key (loadSigningKey). The orchestrator imports issuer-client.mjs only; a static test enforces that.
//  * No development key is ever registered as a real one: generated test keys carry a `test-` key_id prefix and `not_after` in the past of any real policy.
import { createPrivateKey, generateKeyPairSync, randomBytes } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, writeSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { IDENTITIES } from '../../authority/contract.mjs'
import { validateTrustedKeys } from '../../authority/contract.mjs'
import { diffPolicy } from '../../authority/policy-version.mjs'

export const ISSUING_IDENTITIES = Object.freeze(['orchestrator', 'independent_reviewer', 'security_reviewer', 'delivery_verifier', 'trusted_publisher', 'merger', 'production_releaser', 'recovery', 'task_ingress', 'policy_promoter'])
const KEY_ID = /^[a-z][a-z0-9._-]{2,63}$/

const real = (p) => { try { return realpathSync(p) } catch { return path.resolve(p) } }
/** A key directory must not be, contain, or live under any forbidden root (repo, worktrees, worker area). */
export function assertOutside(dir, forbiddenRoots) {
  const d = real(dir).toLowerCase()
  for (const r of forbiddenRoots) {
    const x = real(r).toLowerCase()
    if (d === x || d.startsWith(x + path.sep) || x.startsWith(d + path.sep)) return { ok: false, code: 'KEY.DIRECTORY_INSIDE_FORBIDDEN_ROOT', root: r }
  }
  return { ok: true }
}

export const privatePath = (keyDir, keyId) => path.join(keyDir, `${keyId}.pem`)
export const deactivationMarker = (keyDir, keyId) => path.join(keyDir, `${keyId}.deactivated`)

/**
 * @returns {{ok:true, entry:{key_id:string, identity:string, alg:'ed25519', public_key:string, not_before:string, not_after:string}}|{ok:false, code:string}}
 * The entry is the PUBLIC half only: it is what the owner ceremony adds to the policy bundle. The private half never leaves `keyDir`.
 */
export function generateIssuerKey({ identity, keyId, keyDir, forbiddenRoots = [], notBefore, notAfter, test = false }) {
  if (!ISSUING_IDENTITIES.includes(identity) || !IDENTITIES.includes(identity)) return { ok: false, code: 'KEY.IDENTITY_NOT_AN_ISSUER' }
  if (identity === 'implementer') return { ok: false, code: 'KEY.IMPLEMENTER_MAY_NOT_HOLD_A_KEY' }
  if (!KEY_ID.test(keyId ?? '') || (test && !keyId.startsWith('test-')) || (!test && keyId.startsWith('test-'))) return { ok: false, code: 'KEY.BAD_KEY_ID_OR_TEST_PREFIX' }
  if (!(Date.parse(notAfter) > Date.parse(notBefore))) return { ok: false, code: 'KEY.BAD_VALIDITY_WINDOW' }
  const out = assertOutside(keyDir, forbiddenRoots)
  if (!out.ok) return out
  mkdirSync(keyDir, { recursive: true, mode: 0o700 })
  const file = privatePath(keyDir, keyId)
  if (existsSync(file) || existsSync(`${file}.revoked`)) return { ok: false, code: 'KEY.ALREADY_EXISTS' }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const fd = openSync(file, 'wx', 0o600)
  try { writeSync(fd, privateKey.export({ type: 'pkcs8', format: 'pem' })); fsyncSync(fd) } finally { closeSync(fd) }
  return { ok: true, entry: { key_id: keyId, identity, alg: 'ed25519', public_key: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), not_before: notBefore, not_after: notAfter } }
}

/** ISSUER PROCESS ONLY. Refuses when the key was deactivated (checked on EVERY call, not once at start-up). */
export function loadSigningKey(keyDir, keyId) {
  if (existsSync(deactivationMarker(keyDir, keyId))) return { ok: false, code: 'KEY.DEACTIVATED' }
  const file = privatePath(keyDir, keyId)
  if (!existsSync(file)) return { ok: false, code: 'KEY.NOT_FOUND' }
  try { return { ok: true, key: createPrivateKey(readFileSync(file)) } } catch { return { ok: false, code: 'KEY.UNREADABLE' } }
}

/** Emergency deactivation: marker first (stops signing immediately, even in a running issuer), then the key file is renamed out of the loadable name. Idempotent. */
export function emergencyDeactivate(keyDir, keyId, { reason = 'unspecified', now = Date.now() } = {}) {
  if (!KEY_ID.test(keyId ?? '')) return { ok: false, code: 'KEY.BAD_KEY_ID' }
  try {
    writeFileSync(deactivationMarker(keyDir, keyId), JSON.stringify({ key_id: keyId, reason: String(reason).slice(0, 200), at: new Date(now).toISOString() }), { mode: 0o600 })
    const file = privatePath(keyDir, keyId)
    if (existsSync(file)) renameSync(file, `${file}.revoked.${randomBytes(4).toString('hex')}`)
    return { ok: true }
  } catch (e) { return { ok: false, code: `KEY.DEACTIVATION_FAILED:${e.code ?? 'ERR'}` } } // e.g. EACCES when the ACL excludes the caller: reported, never thrown
}

// ---------------------------------------------------------------- policy proposals (root-of-trust: owner ceremony only)
const withKeys = (bundle, keys) => ({ ...bundle, trusted_keys: keys, parent_revision: null })
function propose(active, nextKeys) {
  const proposed = withKeys(active, nextKeys)
  const problems = validateTrustedKeys(nextKeys, active.contract)
  const diff = problems.length ? null : diffPolicy({ contract: active.contract, trusted_keys: active.trusted_keys }, { contract: proposed.contract, trusted_keys: proposed.trusted_keys })
  return { ok: problems.length === 0, problems, proposed_bundle: proposed, diff, automated_promotion_possible: false, requires: 'owner root-of-trust ceremony (04-policy-bootstrap-and-promotion.md)' }
}
export function proposeKeyRegistration(activeBundle, entry) {
  if (activeBundle.trusted_keys[entry.key_id]) return { ok: false, problems: ['KEY.ID_ALREADY_REGISTERED'], automated_promotion_possible: false }
  const { key_id, ...rest } = entry
  return propose(activeBundle, { ...activeBundle.trusted_keys, [key_id]: rest })
}
/** Rotation = register the new key with an overlapping window and shorten the old key's `not_after` to the cut-over. Evidence signed after the cut-over by the old key stops verifying. */
export function proposeKeyRotation(activeBundle, { oldKeyId, newEntry, cutoverIso }) {
  const old = activeBundle.trusted_keys[oldKeyId]
  if (!old) return { ok: false, problems: ['KEY.OLD_KEY_UNKNOWN'], automated_promotion_possible: false }
  if (old.identity !== newEntry.identity) return { ok: false, problems: ['KEY.IDENTITY_MISMATCH'], automated_promotion_possible: false }
  const keys = { ...activeBundle.trusted_keys, [oldKeyId]: { ...old, not_after: cutoverIso } }
  const { key_id, ...rest } = newEntry
  keys[key_id] = rest
  return propose(activeBundle, keys)
}
/** Revocation removes the entry: nothing signed by it verifies afterwards, including evidence issued earlier (the conservative choice). */
export function proposeKeyRevocation(activeBundle, keyId) {
  if (!activeBundle.trusted_keys[keyId]) return { ok: false, problems: ['KEY.UNKNOWN'], automated_promotion_possible: false }
  const keys = { ...activeBundle.trusted_keys }; delete keys[keyId]
  return propose(activeBundle, keys)
}

/**
 * The ACL plan the owner ceremony applies: the key directory is readable ONLY by the issuer's own account and SYSTEM/Administrators-for-recovery; the
 * controller account gets NO read on key material; the IPC secret directory is shared between the controller and that one issuer only.
 * This module returns commands; it never runs them. Tests prove the plan's shape, NOT that Windows enforced it (gate G-ISSUER-ACCOUNTS).
 */
export function aclPlan({ keyDir, ipcDir, issuerAccount, controllerAccount }) {
  const q = (s) => `"${String(s).replace(/"/g, '')}"`
  for (const a of [issuerAccount, controllerAccount]) if (!/^[A-Za-z0-9._\\-]{1,64}$/.test(a ?? '')) return { ok: false, code: 'ACL.BAD_ACCOUNT' }
  if (issuerAccount === controllerAccount) return { ok: false, code: 'ACL.ISSUER_AND_CONTROLLER_MUST_DIFFER' }
  return { ok: true, commands: [
    ['icacls', q(keyDir), '/inheritance:r'],
    ['icacls', q(keyDir), '/grant:r', `${issuerAccount}:(OI)(CI)F`, 'SYSTEM:(OI)(CI)F', 'Administrators:(OI)(CI)F'],
    ['icacls', q(keyDir), '/deny', `${controllerAccount}:(OI)(CI)(R,W,X)`],
    ['icacls', q(ipcDir), '/inheritance:r'],
    ['icacls', q(ipcDir), '/grant:r', `${issuerAccount}:(OI)(CI)R`, `${controllerAccount}:(OI)(CI)R`, 'SYSTEM:(OI)(CI)F'],
  ], note: 'Applied by the owner ceremony from an elevated prompt. Verify afterwards with `icacls <dir>`; the harness cannot prove Windows enforced it.' }
}
