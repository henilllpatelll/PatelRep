// Developer Harness V3 (D3.2) — canonical JSON, digests and strict shape checking.
//
// Pure, dependency-free and side-effect free. A digest produced here is an INTEGRITY check only. It is never authentication:
// authentication of evidence requires a signature verified against a key pinned by the ACTIVE policy (authority/evidence.mjs).
import { createHash } from 'node:crypto'

const MAX_DEPTH = 24

/** Deterministic JSON: sorted keys, no undefined/NaN/Infinity/-0/functions/symbols/bigint, plain objects only, no cycles, no `__proto__` key. */
export function canonicalize(value, depth = 0, seen = new Set()) {
  if (depth > MAX_DEPTH) throw new TypeError('canonicalize: nesting too deep')
  if (value === null) return 'null'
  switch (typeof value) {
    case 'string': return JSON.stringify(value)
    case 'boolean': return value ? 'true' : 'false'
    case 'number':
      if (!Number.isFinite(value) || Object.is(value, -0)) throw new TypeError('canonicalize: non-finite or negative-zero number')
      return JSON.stringify(value)
    case 'object': break
    default: throw new TypeError(`canonicalize: unsupported type ${typeof value}`)
  }
  if (seen.has(value)) throw new TypeError('canonicalize: cycle')
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length) throw new TypeError('canonicalize: sparse or decorated array')
      return `[${value.map((v) => canonicalize(v, depth + 1, seen)).join(',')}]`
    }
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) throw new TypeError('canonicalize: non-plain object')
    const keys = Object.keys(value).sort()
    if (keys.includes('__proto__')) throw new TypeError('canonicalize: __proto__ key')
    if (Object.getOwnPropertySymbols(value).length) throw new TypeError('canonicalize: symbol key')
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k], depth + 1, seen)}`).join(',')}}`
  } finally { seen.delete(value) }
}

export const sha256Hex = (text) => createHash('sha256').update(text, 'utf8').digest('hex')
export const digestOf = (value) => sha256Hex(canonicalize(value))

export const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v))

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/
/** Validators return true when the value is acceptable. */
export const v = Object.freeze({
  str: (x) => typeof x === 'string' && x.length > 0 && x.length <= 512 && !/[\u0000-\u001f]/.test(x),
  id: (x) => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(x),
  sha40: (x) => typeof x === 'string' && /^[0-9a-f]{40}$/.test(x),
  sha64: (x) => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x),
  repo: (x) => typeof x === 'string' && /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(x),
  // round-trip: rejects 2026-02-31 (rolls to March) and T24:00:00
  iso: (x) => typeof x === 'string' && ISO.test(x) && Number.isFinite(Date.parse(x)) && new Date(Date.parse(x)).toISOString().slice(0, 19) === x.slice(0, 19),
  int: (x) => Number.isSafeInteger(x) && x >= 0,
  bool: (x) => typeof x === 'boolean',
  oneOf: (...xs) => (x) => xs.includes(x),
  arrayOf: (inner, max = 1000) => (x) => Array.isArray(x) && x.length <= max && x.every(inner),
})

/** Strict shape check: every required key present and valid, no unknown keys. Returns a list of problem strings (empty = valid). */
export function checkShape(obj, { required = {}, optional = {} } = {}, label = 'object') {
  if (!isPlainObject(obj)) return [`${label}: not a plain object`]
  const problems = []
  for (const [k, ok] of Object.entries(required)) {
    if (!(k in obj)) problems.push(`${label}.${k}: missing`)
    else if (!ok(obj[k])) problems.push(`${label}.${k}: invalid`)
  }
  for (const [k, ok] of Object.entries(optional)) if (k in obj && !ok(obj[k])) problems.push(`${label}.${k}: invalid`)
  for (const k of Object.keys(obj)) if (!(k in required) && !(k in optional)) problems.push(`${label}.${k}: unknown key`)
  return problems
}

export const parseIso = (s) => Date.parse(s)
