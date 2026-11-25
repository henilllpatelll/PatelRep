// Developer Harness V3 (D3.4) — task-owned worktree snapshots (the uncommitted half of a checkpoint; committed work is recovered from the branch).
//
// A snapshot is UNTRUSTED INPUT every time it is read: it is produced from a worker's tree, stored by the controller, and restored into a worker's tree.
// So it is validated on the way in AND on the way out: every path normalized and scope-checked, no symlinks / gitlinks / `.git` segments / device names,
// no credential-shaped file names or contents, bounded counts and sizes, blobs addressed by their sha256 and re-hashed on verification, the manifest
// digest recomputed. The manifest is written LAST and atomically, so a snapshot without a manifest is simply absent (never half-valid).
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import path from 'node:path'
import { canonicalize, digestOf } from '../lib/canonical.mjs'
import { matchesAny, normalizeRepoPath } from '../lib/paths.mjs'

export const SNAPSHOT_SCHEMA = 'patelrep.developer-harness-v3.worktree-snapshot'
export const LIMITS = Object.freeze({ max_files: 2000, max_file_bytes: 5 * 1024 * 1024, max_total_bytes: 64 * 1024 * 1024, max_manifest_bytes: 2 * 1024 * 1024 })
const MODES = new Set(['100644', '100755', 'deleted'])
const CREDENTIAL_NAME = /(^|\/)(\.env(\..*)?|id_rsa|id_ed25519|.*\.(pem|p12|pfx|key|keystore)|\.npmrc|\.netrc|credentials(\.json)?|\.git-credentials)$/i
const CREDENTIAL_CONTENT = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bsk-ant-[A-Za-z0-9_-]{20,}/, /\bgh[pousr]_[A-Za-z0-9]{30,}/, /\bgithub_pat_[A-Za-z0-9_]{30,}/, /\bAKIA[0-9A-Z]{16}\b/, /\bsk_live_[A-Za-z0-9]{16,}/,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, /\b(SERVICE_ROLE_KEY|CLIENT_SECRET|PASSWORD|API_KEY|AUTH_TOKEN|ACCESS_TOKEN)\s*[=:]\s*["']?[A-Za-z0-9/+_.=-]{24,}/i]

export const sha256Buf = (b) => createHash('sha256').update(b).digest('hex')
export const scanContent = (buf) => (buf.includes(0) ? [] : CREDENTIAL_CONTENT.filter((re) => re.test(buf.toString('utf8'))).map((re) => `SNAPSHOT.CREDENTIAL_CONTENT:${re.source.slice(0, 24)}`))

/** Validate one manifest entry's PATH and MODE against the task scope. Pure. */
export function checkEntry(entry, scope) {
  const n = normalizeRepoPath(entry?.path)
  if (!n.ok) return [`SNAPSHOT.${n.code}`]
  const codes = []
  if (n.path.split('/').some((s) => s.toLowerCase() === '.git' || s.toLowerCase() === '.gitmodules')) codes.push('SNAPSHOT.GIT_INTERNALS')
  if (CREDENTIAL_NAME.test(n.path)) codes.push('SNAPSHOT.CREDENTIAL_FILE_NAME')
  if (!MODES.has(entry.mode)) codes.push('SNAPSHOT.MODE_NOT_ALLOWED') // 120000 symlink, 160000 gitlink and anything unknown are refused
  if (!matchesAny(scope.allowed_paths ?? [], n.path) || matchesAny(scope.denied_paths ?? [], n.path)) codes.push('SNAPSHOT.OUT_OF_SCOPE')
  return codes
}

const writeExclusive = (file, buf) => {
  const fd = openSync(file, 'wx', 0o600)
  try { writeSync(fd, buf); fsyncSync(fd) } finally { closeSync(fd) }
}
const atomicWrite = (file, buf) => { const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`; writeExclusive(tmp, buf); renameSync(tmp, file) }
const stripDigest = (m) => { const { digest, ...rest } = m; return rest }
export const manifestDigest = (m) => digestOf(stripDigest(m))

/**
 * @param {{dir:string, base_sha:string, head_sha:string|null, files:{path:string, mode:string, content:Buffer|null}[], scope:{allowed_paths:string[],denied_paths?:string[]}}} i
 * @returns {{ok:true, dir:string, digest:string, files:number}|{ok:false, problems:string[]}}
 */
export function createSnapshot({ dir, base_sha, head_sha, files, scope }) {
  const problems = []
  if (!Array.isArray(files) || files.length > LIMITS.max_files) return { ok: false, problems: ['SNAPSHOT.TOO_MANY_FILES'] }
  if (existsSync(dir)) return { ok: false, problems: ['SNAPSHOT.EXISTS'] }
  const seen = new Set(); let total = 0; const entries = []
  for (const f of files) {
    problems.push(...checkEntry(f, scope))
    const n = normalizeRepoPath(f?.path)
    if (!n.ok) continue
    if (seen.has(n.key)) problems.push('SNAPSHOT.DUPLICATE_OR_CASE_COLLISION'); seen.add(n.key)
    if (f.mode === 'deleted') { if (f.content != null) problems.push('SNAPSHOT.DELETED_WITH_CONTENT'); entries.push({ path: n.path, mode: 'deleted', size: 0, sha256: null }); continue }
    if (!Buffer.isBuffer(f.content)) { problems.push('SNAPSHOT.CONTENT_MISSING'); continue }
    if (f.content.length > LIMITS.max_file_bytes) problems.push('SNAPSHOT.FILE_TOO_LARGE')
    total += f.content.length
    problems.push(...scanContent(f.content))
    entries.push({ path: n.path, mode: f.mode, size: f.content.length, sha256: sha256Buf(f.content) })
  }
  if (total > LIMITS.max_total_bytes) problems.push('SNAPSHOT.TOO_LARGE')
  if (problems.length) return { ok: false, problems: [...new Set(problems)] }
  entries.sort((a, b) => (a.path < b.path ? -1 : 1))
  const manifest = { schema: SNAPSHOT_SCHEMA, version: 1, base_sha, head_sha, files: entries }
  const digest = digestOf(manifest)
  mkdirSync(path.join(dir, 'blobs'), { recursive: true })
  try {
    for (const f of files) if (f.mode !== 'deleted') { const h = sha256Buf(f.content); const p = path.join(dir, 'blobs', h); if (!existsSync(p)) writeExclusive(p, f.content) }
    atomicWrite(path.join(dir, 'manifest.json'), Buffer.from(`${canonicalize({ ...manifest, digest })}\n`)) // LAST: its presence marks a complete snapshot
  } catch (e) { rmSync(dir, { recursive: true, force: true }); return { ok: false, problems: [`SNAPSHOT.WRITE_FAILED:${e.code ?? 'ERR'}`] } }
  return { ok: true, dir, digest, files: entries.length }
}

/** Full re-verification from disk. Never trusts the manifest's own `digest` field without recomputing it. */
export function verifySnapshot(dir, { expectedDigest = null, scope = null } = {}) {
  const problems = []
  const mf = path.join(dir, 'manifest.json')
  try {
    if (!existsSync(mf)) return { ok: false, problems: ['SNAPSHOT.NO_MANIFEST'] }
    if (lstatSync(dir).isSymbolicLink() || lstatSync(mf).isSymbolicLink()) return { ok: false, problems: ['SNAPSHOT.SYMLINK'] }
    const raw = readFileSync(mf)
    if (raw.length > LIMITS.max_manifest_bytes) return { ok: false, problems: ['SNAPSHOT.MANIFEST_TOO_LARGE'] }
    const m = JSON.parse(raw.toString('utf8'))
    if (m?.schema !== SNAPSHOT_SCHEMA || m.version !== 1 || !Array.isArray(m.files) || m.files.length > LIMITS.max_files) return { ok: false, problems: ['SNAPSHOT.MALFORMED'] }
    const digest = digestOf(stripDigest(m))
    if (digest !== m.digest) problems.push('SNAPSHOT.DIGEST_MISMATCH')
    if (expectedDigest && digest !== expectedDigest) problems.push('SNAPSHOT.UNEXPECTED_DIGEST')
    const blobsDir = path.join(dir, 'blobs'); const wanted = new Set(); const seen = new Set(); let total = 0
    for (const e of m.files) {
      if (scope) problems.push(...checkEntry(e, scope)); else { const n = normalizeRepoPath(e.path); if (!n.ok) problems.push(`SNAPSHOT.${n.code}`); else if (!MODES.has(e.mode)) problems.push('SNAPSHOT.MODE_NOT_ALLOWED') }
      const key = String(e.path).toLowerCase(); if (seen.has(key)) problems.push('SNAPSHOT.DUPLICATE_OR_CASE_COLLISION'); seen.add(key)
      if (e.mode === 'deleted') continue
      if (!/^[0-9a-f]{64}$/.test(e.sha256 ?? '')) { problems.push('SNAPSHOT.BAD_BLOB_ID'); continue }
      wanted.add(e.sha256); total += e.size
      const bp = path.join(blobsDir, e.sha256)
      if (!existsSync(bp)) { problems.push('SNAPSHOT.BLOB_MISSING'); continue }
      const st = lstatSync(bp)
      if (!st.isFile() || st.isSymbolicLink()) { problems.push('SNAPSHOT.BLOB_NOT_REGULAR_FILE'); continue }
      if (st.size !== e.size || st.size > LIMITS.max_file_bytes) { problems.push('SNAPSHOT.BLOB_SIZE_MISMATCH'); continue }
      const b = readFileSync(bp)
      if (sha256Buf(b) !== e.sha256) problems.push('SNAPSHOT.BLOB_HASH_MISMATCH')
      problems.push(...scanContent(b))
    }
    if (total > LIMITS.max_total_bytes) problems.push('SNAPSHOT.TOO_LARGE')
    for (const name of existsSync(blobsDir) ? readdirSync(blobsDir) : []) if (!wanted.has(name)) problems.push('SNAPSHOT.UNREFERENCED_BLOB')
    return problems.length ? { ok: false, problems: [...new Set(problems)] } : { ok: true, digest, manifest: m }
  } catch { return { ok: false, problems: ['SNAPSHOT.UNREADABLE'] } }
}

/** True only if no component of `rel` (below `root`) is a symlink and the resolved path stays inside `root`. */
function safeTarget(root, rel) {
  const target = path.resolve(root, ...rel.split('/'))
  const back = path.relative(path.resolve(root), target)
  if (!back || back.startsWith('..') || path.isAbsolute(back)) return null
  let cur = path.resolve(root)
  for (const seg of back.split(path.sep)) {
    cur = path.join(cur, seg)
    try { if (lstatSync(cur).isSymbolicLink()) return null } catch (e) { if (e.code === 'ENOENT') break; return null }
  }
  return target
}

/** Restore a VERIFIED snapshot into a worktree. Re-verifies first; refuses any symlinked or escaping target. Returns what it wrote. */
export function restoreSnapshot(dir, worktree, { scope, expectedDigest = null }) {
  const v = verifySnapshot(dir, { scope, expectedDigest })
  if (!v.ok) return v
  const written = []; const removed = []
  for (const e of v.manifest.files) {
    const target = safeTarget(worktree, e.path)
    if (!target) return { ok: false, problems: ['SNAPSHOT.RESTORE_TARGET_UNSAFE'], written }
    if (e.mode === 'deleted') { if (existsSync(target) && lstatSync(target).isFile()) { rmSync(target); removed.push(e.path) } continue }
    mkdirSync(path.dirname(target), { recursive: true })
    if (!safeTarget(worktree, e.path)) return { ok: false, problems: ['SNAPSHOT.RESTORE_TARGET_UNSAFE'], written }
    atomicWrite(target, readFileSync(path.join(dir, 'blobs', e.sha256)))
    written.push(e.path)
  }
  return { ok: true, digest: v.digest, written, removed }
}
