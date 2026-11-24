// Developer Harness V3 (D3.2) — repository path normalization and glob matching for policy decisions.
//
// Policy decisions never accept a raw path. Every path is normalized first and anything that could alias another file on the
// developer's Windows filesystem (trailing dot or space, 8.3 short names, alternate data streams, backslashes, drive letters,
// `..`, control characters) is REJECTED rather than guessed at. Comparisons are case-insensitive because NTFS is.

/** @returns {{ok:true, path:string, key:string}|{ok:false, code:string}} */
export function normalizeRepoPath(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 1024) return { ok: false, code: 'PATH.INVALID' }
  if (/[\u0000-\u001f\u007f]/.test(raw)) return { ok: false, code: 'PATH.CONTROL_CHARACTER' }
  if (raw.includes('\\')) return { ok: false, code: 'PATH.BACKSLASH' }
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) return { ok: false, code: 'PATH.ABSOLUTE' }
  const nfc = raw.normalize('NFC')
  const segs = nfc.split('/')
  for (const s of segs) {
    if (s === '' ) return { ok: false, code: 'PATH.EMPTY_SEGMENT' }
    if (s === '.' || s === '..') return { ok: false, code: 'PATH.DOT_SEGMENT' }
    if (/[. ]$/.test(s)) return { ok: false, code: 'PATH.WINDOWS_TRAILING_DOT_OR_SPACE' }
    if (s.includes(':')) return { ok: false, code: 'PATH.ALTERNATE_DATA_STREAM' }
    if (/~\d/.test(s)) return { ok: false, code: 'PATH.WINDOWS_SHORT_NAME' }
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(s)) return { ok: false, code: 'PATH.WINDOWS_DEVICE_NAME' }
  }
  return { ok: true, path: nfc, key: nfc.toLowerCase() }
}

const cache = new Map()
/** `**` crosses directories, `*` and `?` stay inside one segment. Case-insensitive. */
export function globToRegExp(glob) {
  if (cache.has(glob)) return cache.get(glob)
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?' } else re += '.*'
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  const out = new RegExp(`^${re}$`, 'i')
  cache.set(glob, out)
  return out
}

export const matchesGlob = (glob, normalizedPath) => globToRegExp(glob).test(normalizedPath)
export const matchesAny = (globs, normalizedPath) => globs.some((g) => matchesGlob(g, normalizedPath))
