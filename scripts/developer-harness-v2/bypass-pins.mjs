#!/usr/bin/env node
// Developer Harness V2 — owner tool for the digests that let a bypass session run privileged infrastructure (V2 permission transition).
//
//   node scripts/developer-harness-v2/bypass-pins.mjs [--scope <id>] --print           digests of the working tree vs the pins (read-only)
//   node scripts/developer-harness-v2/bypass-pins.mjs [--scope <id>] --check           exit 1 when the working tree differs from the pins
//   node scripts/developer-harness-v2/bypass-pins.mjs [--scope <id>] --print --from-ref <sha>   digests of a commit's tree (read-only)
//   node scripts/developer-harness-v2/bypass-pins.mjs [--scope <id>] --write [--from-ref <sha>]  OWNER ONLY: rewrite the pins
//
// --write changes docs/developer-harness-v2/bypass-scopes.json, a protected policy file. The policy classifies that invocation as an
// owner-only control-plane change: a bypass session is always denied, a default-mode session must ask the owner. Review the printed diff
// of the privileged code BEFORE refreshing pins: a pin is the owner's statement that this exact code may run on the host without a prompt.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCOPES_FILE, inClosure, validateBypassScopes } from './bypass-authorization.mjs'
import { contentDigest, diffDigests, digestTree } from './bypass-digest.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Digests of a commit's closure files from git objects (no checkout). */
export function digestRef(root, ref, closure) {
  if (!/^[0-9a-f]{7,40}$/i.test(ref)) throw new Error('--from-ref must be a commit sha')
  const dirs = closure.include.map((i) => i.replace(/\/$/, ''))
  const ls = spawnSync('git', ['ls-tree', '-r', '--name-only', ref, '--', ...dirs], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (ls.status !== 0) throw new Error(`git ls-tree failed: ${ls.stderr.trim().slice(0, 200)}`)
  const out = {}
  for (const rel of ls.stdout.split('\n').filter(Boolean).sort()) {
    if (!inClosure(closure, rel)) continue
    const blob = spawnSync('git', ['show', `${ref}:${rel}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 })
    if (blob.status !== 0) throw new Error(`git show failed for ${rel}`)
    out[rel] = contentDigest(blob.stdout)
  }
  return out
}

function main(argv) {
  const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] }
  const file = path.join(ROOT, ...SCOPES_FILE.split('/'))
  const doc = JSON.parse(readFileSync(file, 'utf8'))
  const contract = JSON.parse(readFileSync(path.join(ROOT, 'docs', 'developer-harness-v2', 'contract.json'), 'utf8'))
  const scopes = validateBypassScopes(doc, contract)
  const id = opt('scope') ?? (scopes.scopes.length === 1 ? scopes.scopes[0].id : null)
  const scope = scopes.scopes.find((s) => s.id === id)
  if (!scope) { console.error(`unknown or ambiguous scope (${id}); scopes: ${scopes.scopes.map((s) => s.id).join(', ')}`); return 2 }
  const ref = opt('from-ref')
  let drift = false
  const report = scope.trusted_executions.map((e) => {
    const actual = ref ? digestRef(ROOT, ref, e.closure) : digestTree(ROOT, e.closure)
    if (!actual) throw new Error(`closure of ${e.id} is unverifiable (symlink, special file or size limit)`)
    const diff = diffDigests(e.digests, actual)
    if (diff.length) drift = true
    return { execution: e.id, entrypoint: e.entrypoint, source: ref ? `git ${ref}` : 'working tree', files: Object.keys(actual).length, diff, digests: actual }
  })
  if (argv.includes('--write')) {
    const raw = doc.scopes.find((s) => s.id === scope.id)
    for (const r of report) {
      const e = raw.trusted_executions.find((x) => x.id === r.execution)
      e.digests = r.digests
      e.reviewed_source = { ...(e.reviewed_source ?? {}), ref: ref ?? 'working tree', pinned_at: new Date().toISOString().slice(0, 10) }
    }
    validateBypassScopes(doc, contract)
    writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`)
    console.log(`pins for scope ${scope.id} rewritten (${report.map((r) => `${r.execution}: ${r.files} files`).join('; ')}); review and commit ${SCOPES_FILE}`)
    return 0
  }
  console.log(JSON.stringify(argv.includes('--json') ? report : report.map(({ digests, ...r }) => r), null, 2))
  if (argv.includes('--check')) return drift ? 1 : 0
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)) } catch (error) { console.error(`bypass-pins: ${error.message}`); process.exitCode = 2 }
}
