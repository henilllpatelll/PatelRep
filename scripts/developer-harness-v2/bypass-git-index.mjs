// Developer Harness V2 — staged-content secret check for owner-launched bypass commits (V2 permission transition).
//
// The hook cannot run git, and GitHub secret-scanning push protection is not enabled on the repository, so before a bypass session's
// `git commit` is authorized the hook inspects what is staged: it parses the worktree's index (versions 2–4) and reads every staged blob
// that is a LOOSE object (newly written by `git add`; content already packed is older history) by inflating it with zlib. Binary blobs
// are skipped. Anything it cannot read or that exceeds the bounds makes the scan unverifiable, which the authorizer treats as a denial.
// Pure reads; nothing is written.
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { inflateSync } from 'node:zlib'

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

/**
 * Scan newly staged (loose) blobs with `secretRe`. Returns { ok: true, hits: [paths], scanned } or { ok: false, reason }.
 */
export function scanStagedBlobs(root, secretRe, limits = SCAN_LIMITS) {
  try {
    const dirs = gitDirs(root)
    if (!dirs) return { ok: false, reason: 'no git directory' }
    const indexFile = path.join(dirs.gitDir, 'index')
    if (!existsSync(indexFile)) return { ok: true, hits: [], scanned: 0 }
    if (statSync(indexFile).size > limits.indexBytes) return { ok: false, reason: 'index too large' }
    const entries = readIndex(readFileSync(indexFile))
    const hits = []
    let scanned = 0
    let total = 0
    for (const e of entries) {
      const file = path.join(dirs.commonDir, 'objects', e.sha.slice(0, 2), e.sha.slice(2))
      if (!existsSync(file)) continue // packed: already part of earlier history
      if (++scanned > limits.blobs) return { ok: false, reason: 'too many newly staged files to inspect' }
      const raw = inflateSync(readFileSync(file), { maxOutputLength: limits.blobBytes + 64 })
      const nul = raw.indexOf(0)
      const header = raw.toString('latin1', 0, nul)
      if (!/^blob \d+$/.test(header)) continue // gitlinks/trees are not file content
      const body = raw.subarray(nul + 1)
      total += body.length
      if (total > limits.totalBytes) return { ok: false, reason: 'newly staged content too large to inspect' }
      if (body.subarray(0, 8192).includes(0)) continue // binary
      if (secretRe.test(body.toString('utf8'))) hits.push(e.path)
    }
    return { ok: true, hits, scanned }
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? 'scan failed').slice(0, 80) }
  }
}
