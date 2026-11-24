// Developer Harness V3 (D3.2) — migration classification from TRUSTED Git facts.
//
// Reproduced defect in V2 (see 01-verification-register.md R-06): routing/router.mjs decides "new" versus "existing" migration from the
// human-supplied `--modification` label alone. Labelling an existing migration `add` routed it as a new forward-only migration
// (human_approval, no STOP), and labelling a genuinely new file `migration` or `edit` produced a false STOP.EXISTING_MIGRATION.
//
// This module never reads a label. Its inputs are the base-tree migration listing and the base..candidate name-status list, both of which
// the trusted verifier computes from Git (git-facts.mjs). Pure and deterministic.
import { normalizeRepoPath } from '../lib/paths.mjs'

const leadingNumber = (name) => { const m = /^([0-9]+)_/.exec(name); return m ? Number.parseInt(m[1], 10) : null }

/**
 * @param {{directory:string, filePattern:string, baseFiles:string[], changes:{status:string,path:string}[]}} input
 * @returns {{newMigrations:string[], violations:{code:string,path:string}[], baseMaxNumber:number}}
 */
export function classifyMigrationChanges({ directory, filePattern, baseFiles, changes }) {
  const pattern = new RegExp(filePattern)
  const dirKey = `${directory.toLowerCase()}/`
  const violations = []
  const newMigrations = []

  const baseKeys = new Set()
  let baseMax = -1
  for (const f of baseFiles) {
    const n = normalizeRepoPath(f)
    if (!n.ok) { violations.push({ code: 'MIGRATION.BASE_LISTING_INVALID', path: String(f).slice(0, 200) }); continue }
    baseKeys.add(n.key)
    const base = n.path.slice(directory.length + 1)
    const num = pattern.test(base) ? leadingNumber(base) : null
    if (num !== null && num > baseMax) baseMax = num
  }

  const seenNumbers = new Map()
  for (const ch of changes) {
    const n = normalizeRepoPath(ch.path)
    if (!n.ok) { violations.push({ code: n.code, path: String(ch.path).slice(0, 200) }); continue }
    const inDir = n.key.startsWith(dirKey) || n.key === directory.toLowerCase()
    if (!inDir) continue
    const rel = n.path.slice(directory.length + 1)
    switch (ch.status) {
      case 'M': case 'T': violations.push({ code: 'MIGRATION.HISTORICAL_MODIFIED', path: n.path }); break
      case 'D': violations.push({ code: 'MIGRATION.HISTORICAL_DELETED', path: n.path }); break
      case 'A': {
        if (baseKeys.has(n.key)) { violations.push({ code: 'MIGRATION.HISTORICAL_COLLISION', path: n.path }); break }
        if (rel.includes('/') || !pattern.test(rel)) { violations.push({ code: 'MIGRATION.MALFORMED_NAME', path: n.path }); break }
        const num = leadingNumber(rel)
        if (num === null || num <= baseMax) { violations.push({ code: 'MIGRATION.OUT_OF_ORDER', path: n.path }); break }
        if (seenNumbers.has(num)) { violations.push({ code: 'MIGRATION.DUPLICATE_NUMBER', path: n.path }); break }
        seenNumbers.set(num, n.path)
        newMigrations.push(n.path)
        break
      }
      default: violations.push({ code: 'MIGRATION.UNSUPPORTED_STATUS', path: n.path })
    }
  }
  return { newMigrations, violations, baseMaxNumber: baseMax }
}
