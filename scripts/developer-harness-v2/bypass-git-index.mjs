// Developer Harness V2 — staged-content secret check for owner-launched bypass commits (V2 permission transition).
//
// GitHub secret-scanning push protection is not enabled on the repository, so before a bypass session's `git commit` is authorized the
// hook inspects exactly what the commit would add. This is the ONLY place the policy hook runs a subprocess: two fixed, read-only git
// invocations (`git diff --cached --name-only -z`, then `git cat-file --batch` over the staged blob shas read from the index), shell:false,
// a sanitized environment, fsmonitor and hooks disabled, a 6 s timeout. They run only for a bypass `git commit` the policy would
// otherwise authorize. Anything that fails, times out or exceeds the bounds makes the scan unverifiable, which the authorizer denies.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

export const SCAN_LIMITS = Object.freeze({ entries: 20000, blobs: 2000, blobBytes: 5 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, indexBytes: 64 * 1024 * 1024 })

/** The worktree's git dir (index lives here) and the common dir (objects live here). */
export function gitDirs(root) {
  const dotgit = path.join(root, '.git')
  if (!existsSync(dotgit)) return null
  let gitDir = dotgit
  if (statSync(dotgit).isFile()) {
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotgit, 'utf8'))
    if (!m) return null
    gitDir = path.resolve(root, m[1].trim())
  }
  let commonDir = gitDir
  const common = path.join(gitDir, 'commondir')
  if (existsSync(common)) commonDir = path.resolve(gitDir, readFileSync(common, 'utf8').trim())
  return { gitDir, commonDir }
}

/** [{ path, sha }] for every index entry. Throws on a malformed or unsupported index. */
export function readIndex(buf) {
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'DIRC') throw new Error('not an index')
  const version = buf.readUInt32BE(4)
  if (version < 2 || version > 4) throw new Error('unsupported index version')
  const count = buf.readUInt32BE(8)
  if (count > SCAN_LIMITS.entries) throw new Error('index too large')
  const out = []
  let off = 12
  let prev = ''
  for (let i = 0; i < count; i++) {
    const start = off
    if (off + 62 > buf.length) throw new Error('truncated index')
    const sha = buf.toString('hex', off + 40, off + 60)
    const flags = buf.readUInt16BE(off + 60)
    off += 62
    if (version >= 3 && (flags & 0x4000)) off += 2
    let name
    if (version === 4) {
      let strip = 0; let b; let shift = 0
      // offset-varint used by index v4 for the prefix strip count
      b = buf[off++]; strip = b & 0x7f
      while (b & 0x80) { b = buf[off++]; strip = ((strip + 1) << 7) | (b & 0x7f); if (++shift > 8) throw new Error('bad varint') }
      const end = buf.indexOf(0, off)
      if (end < 0) throw new Error('truncated path')
      name = prev.slice(0, prev.length - strip) + buf.toString('utf8', off, end)
      off = end + 1
    } else {
      const end = buf.indexOf(0, off)
      if (end < 0) throw new Error('truncated path')
      name = buf.toString('utf8', off, end)
      off = start + Math.ceil((end - start + 1) / 8) * 8
    }
    prev = name
    out.push({ path: name, sha, stage: (flags >> 12) & 3 })
  }
  return out
}

/** Minimal environment for the read-only git calls: no GIT_* overrides from the session, no credentials. */
function gitEnv(env = process.env) {
  const keep = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'TEMP', 'TMP', 'LANG', 'ComSpec']
  return { ...Object.fromEntries(keep.filter((k) => env[k] !== undefined).map((k) => [k, env[k]])), GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }
}
// Read-only, fixed argv, shell:false. fsmonitor and hooks are disabled; no diff drivers/textconv/filters run for these subcommands.
const GIT_BASE = ['-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`, '-c', 'diff.external=', '--no-pager']

/** Text views of a blob for the secret pattern: UTF-8, plus UTF-16LE (PowerShell 5.1 `>` output, with or without a BOM). */
function textViews(body) {
  const views = [body.toString('utf8')]
  const hasNulPairs = body.length > 1 && body.subarray(0, 4096).filter((b, i) => i % 2 === 1 && b === 0).length > 8
  if ((body[0] === 0xff && body[1] === 0xfe) || hasNulPairs) views.push(body.toString('utf16le'))
  if (body[0] === 0xfe && body[1] === 0xff) views.push(Buffer.from(body).swap16().toString('utf16le'))
  views.push(body.toString('latin1').replace(/\0/g, ''))
  return views
}

/**
 * Scan exactly the content that `git commit` would add: every path whose staged blob differs from HEAD (`git diff --cached`), read
 * from the index's staged sha via `git cat-file --batch`. Returns { ok: true, hits, scanned } or { ok: false, reason }.
 */
export function scanStagedChanges(root, secretRe, { env = process.env, limits = SCAN_LIMITS, run = spawnSync } = {}) {
  try {
    const opts = { cwd: root, env: gitEnv(env), shell: false, windowsHide: true, timeout: 6000, maxBuffer: limits.totalBytes + 1024 * 1024 }
    const diff = run('git', [...GIT_BASE, 'diff', '--cached', '--name-only', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', '--diff-filter=ACMRT'], opts)
    if (diff.status !== 0 || diff.error) return { ok: false, reason: 'git diff --cached failed' }
    const paths = Buffer.from(diff.stdout).toString('utf8').split('\0').filter(Boolean)
    if (!paths.length) return { ok: true, hits: [], scanned: 0 }
    if (paths.length > limits.blobs) return { ok: false, reason: 'too many staged files to inspect' }
    const dirs = gitDirs(root)
    if (!dirs) return { ok: false, reason: 'no git directory' }
    const indexFile = path.join(dirs.gitDir, 'index')
    if (statSync(indexFile).size > limits.indexBytes) return { ok: false, reason: 'index too large' }
    const bySha = new Map()
    const wanted = new Set(paths)
    for (const e of readIndex(readFileSync(indexFile))) if (e.stage === 0 && wanted.has(e.path)) bySha.set(e.path, e.sha)
    const shas = paths.map((p) => bySha.get(p))
    if (shas.some((s) => !s)) return { ok: false, reason: 'staged entry not found in the index' }
    const cat = run('git', [...GIT_BASE, 'cat-file', '--batch'], { ...opts, input: `${shas.join('\n')}\n` })
    if (cat.status !== 0 || cat.error) return { ok: false, reason: 'git cat-file failed' }
    const out = Buffer.from(cat.stdout)
    const hits = []
    let off = 0
    let total = 0
    for (let i = 0; i < shas.length; i++) {
      const nl = out.indexOf(0x0a, off)
      if (nl < 0) return { ok: false, reason: 'truncated cat-file output' }
      const header = out.toString('latin1', off, nl).split(' ')
      if (header[0] !== shas[i] || header.length !== 3) return { ok: false, reason: 'unexpected cat-file output' }
      const size = Number(header[2])
      if (!Number.isSafeInteger(size) || size > limits.blobBytes) return { ok: false, reason: 'staged file too large to inspect' }
      total += size
      if (total > limits.totalBytes) return { ok: false, reason: 'staged content too large to inspect' }
      const body = out.subarray(nl + 1, nl + 1 + size)
      off = nl + 1 + size + 1
      if (header[1] !== 'blob') continue
      if (textViews(body).some((t) => secretRe.test(t))) hits.push(paths[i])
    }
    return { ok: true, hits, scanned: shas.length }
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? 'scan failed').slice(0, 80) }
  }
}
