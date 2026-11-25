// Developer Harness V2 — digests of an owner-pinned privileged closure (V2 permission transition).
//
// Used by the policy hook (to verify pins before a bypass session runs privileged infrastructure) and by bypass-pins.mjs (to print or
// refresh pins). Reads only regular files under the declared closure; a symlink, junction, special file or size overrun makes the whole
// closure unverifiable (null), which the authorizer treats as a denial. Content is hashed with CRLF normalized to LF so a Windows
// checkout (core.autocrlf) and a Linux checkout of the same commit produce the same digests.
import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

export const LIMITS = Object.freeze({ files: 2000, fileBytes: 5 * 1024 * 1024, totalBytes: 50 * 1024 * 1024 })

/** sha256 of the content with CRLF → LF (byte-exact otherwise). */
export function contentDigest(buf) {
  const text = Buffer.from(buf).toString('latin1').replace(/\r\n/g, '\n')
  return createHash('sha256').update(Buffer.from(text, 'latin1')).digest('hex')
}

const lc = (s) => s.toLowerCase()
const listed = (list, rel) => list.some((i) => (i.endsWith('/') ? lc(rel).startsWith(lc(i)) || lc(`${rel}/`) === lc(i) : lc(rel) === lc(i)))

/**
 * { 'repo/relative/file': sha256 } for every regular file in `closure` under `root`, or null when the closure cannot be verified.
 * Missing include entries contribute nothing (the comparison then reports them as removed).
 */
export function digestTree(root, closure, limits = LIMITS) {
  const out = {}
  let files = 0
  let bytes = 0
  const add = (rel, abs, st) => {
    if (st.size > limits.fileBytes) throw new Error('file too large')
    bytes += st.size
    if (++files > limits.files || bytes > limits.totalBytes) throw new Error('closure too large')
    out[rel] = contentDigest(readFileSync(abs))
  }
  const walk = (relDir) => {
    const abs = path.join(root, ...relDir.split('/').filter(Boolean))
    let st
    try { st = lstatSync(abs) } catch { return }
    if (st.isSymbolicLink() || !st.isDirectory()) throw new Error('closure directory is not a plain directory')
    for (const e of readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const rel = `${relDir}${e.name}`
      if (listed(closure.exclude ?? [], rel)) continue
      const childAbs = path.join(abs, e.name)
      const cst = lstatSync(childAbs)
      if (cst.isSymbolicLink()) throw new Error('symlink in closure')
      if (cst.isDirectory()) walk(`${rel}/`)
      else if (cst.isFile()) add(rel, childAbs, cst)
      else throw new Error('special file in closure')
    }
  }
  try {
    for (const inc of closure.include) {
      if (inc.endsWith('/')) { walk(inc); continue }
      if (listed(closure.exclude ?? [], inc)) continue
      const abs = path.join(root, ...inc.split('/'))
      let st
      try { st = lstatSync(abs) } catch { continue }
      if (st.isSymbolicLink() || !st.isFile()) throw new Error('closure file is not a regular file')
      add(inc, abs, st)
    }
  } catch {
    return null
  }
  return out
}

/** Changed, added and removed paths between pinned and actual digests (sorted). */
export function diffDigests(pinned, actual) {
  return [...new Set([...Object.keys(pinned), ...Object.keys(actual)])].sort().flatMap((p) => {
    if (!(p in actual)) return [{ path: p, change: 'removed' }]
    if (!(p in pinned)) return [{ path: p, change: 'added' }]
    return pinned[p] === actual[p] ? [] : [{ path: p, change: 'changed' }]
  })
}
