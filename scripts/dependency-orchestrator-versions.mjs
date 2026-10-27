// Dependency-free version helpers for the dependency orchestrator (semver subset + PEP 440 lite).
// Pure functions only: no I/O, so every behaviour is unit-testable.

const VERSION = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?(?:[-.+]?((?:a|b|rc|c|alpha|beta|preview|pre|dev|canary|next)[\w.-]*))?$/i

/** Parses "1.2.3", "v2", "16.3.0-preview.10", "2.0rc1" -> { nums, pre } or null. */
export function parseVersion(raw) {
  const text = String(raw ?? '').trim().replace(/^[\^~=<>! ]+/, '')
  const match = VERSION.exec(text)
  if (!match) return null
  const nums = [match[1], match[2] ?? '0', match[3] ?? '0', match[4] ?? '0'].map(Number)
  return { nums, pre: match[5] ?? null }
}

function comparePre(a, b) {
  if (a === b) return 0
  if (a === null) return 1 // a release is newer than any prerelease of the same numbers
  if (b === null) return -1
  const chunks = (s) => s.split(/[.-]/).map((c) => (/^\d+$/.test(c) ? Number(c) : c))
  const [ca, cb] = [chunks(a), chunks(b)]
  for (let i = 0; i < Math.max(ca.length, cb.length); i += 1) {
    const [x, y] = [ca[i], cb[i]]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1
    return String(x) < String(y) ? -1 : 1
  }
  return 0
}

/** Returns -1/0/1, or null when either side is not a comparable version. */
export function compareVersions(a, b) {
  const [pa, pb] = [parseVersion(a), parseVersion(b)]
  if (!pa || !pb) return null
  for (let i = 0; i < 4; i += 1) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] < pb.nums[i] ? -1 : 1
  }
  return comparePre(pa.pre, pb.pre)
}

/** major | minor | patch | prerelease | same | downgrade | unknown */
export function bumpKind(from, to) {
  const [pf, pt] = [parseVersion(from), parseVersion(to)]
  if (!pf || !pt) return 'unknown'
  const order = compareVersions(from, to)
  if (order === 0) return 'same'
  if (order > 0) return 'downgrade'
  if (pf.nums[0] !== pt.nums[0]) return 'major'
  if (pf.nums[1] !== pt.nums[1]) return pt.pre ? 'prerelease' : 'minor'
  if (pf.nums[2] !== pt.nums[2] || pf.nums[3] !== pt.nums[3]) return pt.pre ? 'prerelease' : 'patch'
  return 'prerelease'
}

const isWildcard = (token) => token === '*' || token === 'x' || token === 'X' || token === ''

function expandCaretTilde(op, token) {
  const parts = token.replace(/^v/, '').split('.')
  const nums = parts.map((p) => (isWildcard(p) ? null : Number(p)))
  const [maj, min = 0, pat = 0] = nums.map((n) => n ?? 0)
  const lower = `>=${maj}.${min}.${pat}`
  if (op === '^') {
    if (maj > 0 || nums.length === 1) return [lower, `<${maj + 1}.0.0`]
    if (min > 0 || nums.length === 2) return [lower, `<0.${min + 1}.0`]
    return [lower, `<0.0.${pat + 1}`]
  }
  return nums.length === 1 ? [lower, `<${maj + 1}.0.0`] : [lower, `<${maj}.${min + 1}.0`]
}

function expandXRange(token) {
  const parts = token.replace(/^v/, '').split('.')
  if (!parts.some(isWildcard)) return [`>=${token}`, `<=${token}`]
  const fixed = parts.filter((p) => !isWildcard(p)).map(Number)
  if (fixed.length === 0) return []
  const lower = [...fixed, 0, 0, 0].slice(0, 3).join('.')
  const upper = [...fixed.slice(0, -1), fixed[fixed.length - 1] + 1, 0, 0].slice(0, 3).join('.')
  return [`>=${lower}`, `<${upper}`]
}

function comparatorsFor(token) {
  const m = /^(\^|~>|~=|~|>=|<=|!=|==|=|>|<)?\s*(.*)$/.exec(token)
  const [op, rest] = [m[1] ?? '', m[2]]
  if (op === '^' || op === '~' || op === '~>' || op === '~=') return expandCaretTilde(op === '^' ? '^' : '~', rest)
  if (op === '' || op === '=' || op === '==') return expandXRange(rest)
  return [`${op}${rest}`]
}

function holds(version, comparator) {
  const m = /^(>=|<=|!=|>|<)(.+)$/.exec(comparator)
  const order = compareVersions(version, m[2])
  if (order === null) return false
  switch (m[1]) {
    case '>=': return order >= 0
    case '<=': return order <= 0
    case '>': return order > 0
    case '<': return order < 0
    default: return order !== 0
  }
}

/** True when `version` satisfies an npm range or a PEP 440 specifier set. Unparseable input fails closed. */
export function satisfies(version, range) {
  if (!parseVersion(version)) return false
  const text = String(range ?? '').trim()
  if (!text || text === '*' || text === 'latest') return true
  return text.split('||').some((set) => {
    const hyphen = /^\s*(\S+)\s+-\s+(\S+)\s*$/.exec(set)
    const tokens = hyphen ? [`>=${hyphen[1]}`, `<=${hyphen[2]}`] : set.replace(/(\^|~>|~=|~|>=|<=|!=|==|=|>|<)\s+/g, '$1').split(/[\s,]+/).filter(Boolean)
    return tokens.every((token) => comparatorsFor(token).every((c) => holds(version, c)))
  })
}

/** Strips range operators from a declared spec: "^13.0.0" -> "13.0.0". */
export const declaredVersion = (spec) => String(spec ?? '').trim().replace(/^[\^~=<>! ]+/, '')
