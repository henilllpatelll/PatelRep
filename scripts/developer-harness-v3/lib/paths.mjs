// Developer Harness V3 (D3.2) — repository path normalization and glob matching for policy decisions.
//
// Policy decisions never accept a raw path. Every path is normalized first and anything that could alias another file on the
// developer's Windows filesystem (trailing dot or space, 8.3 short names, device names, alternate data streams, backslashes, drive letters,
// `..`, control characters, undecodable bytes) is REJECTED rather than guessed at. Comparisons are case-insensitive because NTFS is.

/** @returns {{ok:true, path:string, key:string}|{ok:false, code:string}} */
export function normalizeRepoPath(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 1024) return { ok: false, code: 'PATH.INVALID' }
  if (/[\u0000-\u001f\u007f]/.test(raw)) return { ok: false, code: 'PATH.CONTROL_CHARACTER' }
  if (raw.includes('�')) return { ok: false, code: 'PATH.INVALID_ENCODING' }
  if (raw.includes('\\')) return { ok: false, code: 'PATH.BACKSLASH' }
  if (/[*?"<>|]/.test(raw)) return { ok: false, code: 'PATH.ILLEGAL_CHARACTER' } // illegal on NTFS, and a wildcard inside a path would confuse every glob
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) return { ok: false, code: 'PATH.ABSOLUTE' }
  const nfc = raw.normalize('NFC')
  for (const s of nfc.split('/')) {
    if (s === '') return { ok: false, code: 'PATH.EMPTY_SEGMENT' }
    if (s === '.' || s === '..') return { ok: false, code: 'PATH.DOT_SEGMENT' }
    if (/[. ]$/.test(s)) return { ok: false, code: 'PATH.WINDOWS_TRAILING_DOT_OR_SPACE' }
    if (s.includes(':')) return { ok: false, code: 'PATH.ALTERNATE_DATA_STREAM' }
    if (/~\d/.test(s)) return { ok: false, code: 'PATH.WINDOWS_SHORT_NAME' }
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(s)) return { ok: false, code: 'PATH.WINDOWS_DEVICE_NAME' }
  }
  return { ok: true, path: nfc, key: nfc.toLowerCase() }
}

export const MAX_GLOB_LENGTH = 200
/** Characters a contract glob may contain. No regex metacharacters other than the two wildcards, so a glob can never be a regex. */
export const GLOB_ALPHABET = /^[A-Za-z0-9_.*?/@+~-]+$/

/** `*` and `?` inside one name (case-insensitive). Iterative two-pointer matcher: no regex, no recursion, O(n*m) worst case. */
function matchName(pat, name) {
  const p = pat.toLowerCase(); const s = name.toLowerCase()
  let pi = 0; let si = 0; let star = -1; let mark = 0
  while (si < s.length) {
    if (pi < p.length && p[pi] === '*') { star = pi++; mark = si } else if (pi < p.length && (p[pi] === '?' || p[pi] === s[si])) { pi++; si++ } else if (star >= 0) { pi = star + 1; si = ++mark } else return false
  }
  while (pi < p.length && p[pi] === '*') pi++
  return pi === p.length
}

/**
 * Segment-wise glob matcher. A segment that is exactly `**` matches zero or more path segments; `*`/`?` never cross `/`; `**` inside a segment
 * behaves like `*`. Dynamic programming over (pattern segment, path segment): O(P*S), independent of how hostile the pattern is.
 */
export function matchesGlob(glob, normalizedPath) {
  if (typeof glob !== 'string' || glob.length > MAX_GLOB_LENGTH || typeof normalizedPath !== 'string') return false
  const ps = glob.split('/'); const ss = normalizedPath.split('/')
  // reach[i][j]: first i pattern segments can consume exactly the first j path segments
  let prev = new Array(ss.length + 1).fill(false); prev[0] = true
  for (let i = 1; i <= ps.length; i++) {
    const cur = new Array(ss.length + 1).fill(false)
    const seg = ps[i - 1]
    if (seg === '**') { for (let j = 0; j <= ss.length; j++) cur[j] = prev[j] || (j > 0 && cur[j - 1]) } else {
      for (let j = 1; j <= ss.length; j++) cur[j] = prev[j - 1] && matchName(seg.replace(/\*+/g, '*'), ss[j - 1])
    }
    prev = cur
  }
  return prev[ss.length]
}
export const matchesAny = (globs, normalizedPath) => globs.some((g) => matchesGlob(g, normalizedPath))

/** Environment-variable-style names (no `/`): the same wildcard rules, case-insensitive (Windows). */
export const matchesName = (pattern, name) => typeof pattern === 'string' && typeof name === 'string' && pattern.length <= MAX_GLOB_LENGTH && matchName(pattern.replace(/\*+/g, '*'), name)

/** @returns {string[]} problems for a list of contract globs */
export function validateGlobList(list, label, { allowSlash = true } = {}) {
  const p = []
  if (!Array.isArray(list) || !list.length || list.length > 500) return [`${label}: must be a non-empty list`]
  for (const g of list) {
    if (typeof g !== 'string' || g.length === 0 || g.length > MAX_GLOB_LENGTH || !GLOB_ALPHABET.test(g)) p.push(`${label}: invalid glob ${String(g).slice(0, 40)}`)
    else if ((g.match(/[*?]/g) ?? []).length > 12) p.push(`${label}: too many wildcards in ${g.slice(0, 40)}`)
    else if (g.startsWith('/') || g.endsWith('/') || g.split('/').some((seg) => seg === '' || seg === '.' || seg === '..' || /\*{3,}/.test(seg)
      // a normalized path never has a segment that ends in '.' or ' ', contains ~digit, or is a Windows device name, so such a glob can never match
      || /[. ]$/.test(seg) || /~\d/.test(seg) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(seg))) p.push(`${label}: ${g.slice(0, 40)} can never match a normalized path`)
    else if (!allowSlash && g.includes('/')) p.push(`${label}: ${g.slice(0, 40)} may not contain /`)
  }
  return p
}
