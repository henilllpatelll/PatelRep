#!/usr/bin/env node
// Developer Harness V2 — owner tool for the digests that let a bypass session run privileged infrastructure (V2 permission transition).
//
//   node scripts/developer-harness-v2/bypass-pins.mjs [--scope <id>] --print           digests of the working tree vs the pins (read-only)
//   node scripts/developer-harness-v2/bypass-pins.mjs [--scope <id>] --check           exit 1 when the working tree differs from the pins
//   node scripts/developer-harness-v2/bypass-pins.mjs [--scope <id>] --print --from-ref <sha>   digests of a commit's tree (read-only)
//   node scripts/developer-harness-v2/bypass-pins.mjs [--scope <id>] --verify-provenance [--fetch-if-shallow]
//        read-only: the pins name a full commit sha that resolves here and whose closure has exactly the pinned digests (exit 1 otherwise)
//   node scripts/developer-harness-v2/bypass-pins.mjs [--scope <id>] --write --from-ref <sha>   OWNER ONLY: rewrite the pins FROM that commit
//
// --write changes docs/developer-harness-v2/bypass-scopes.json, a protected policy file. The policy classifies that invocation as an
// owner-only control-plane change: a bypass session is always denied, a default-mode session must ask the owner. Review the printed diff
// of the privileged code BEFORE refreshing pins: a pin is the owner's statement that this exact code may run on the host without a prompt.
// Pins are always taken from an immutable commit (`--from-ref`) and record its full sha as `reviewed_source.ref`; a working tree is never
// recorded as reviewed provenance.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCOPES_FILE, inClosure, validateBypassScopes } from './bypass-authorization.mjs'
import { LIMITS, contentDigest, diffDigests, digestTree } from './bypass-digest.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const FULL_SHA = /^[0-9a-f]{40}$/
const REMOTE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/**
 * The git executable as an ABSOLUTE path from PATH. On Windows a bare 'git' may be looked up in the spawn's working directory first, so an
 * agent-written git.exe in the checkout would run as the owner; a PATH entry that is relative or inside `root` is never used.
 */
export function gitExecutable(root, env = process.env, platform = process.platform) {
  if (platform !== 'win32') return 'git'
  const inside = (d) => { const rel = path.relative(path.resolve(root), path.resolve(d)); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)) }
  for (const dir of String(env.PATH ?? env.Path ?? '').split(';').map((d) => d.trim().replace(/^"|"$/g, '')).filter(Boolean)) {
    if (!path.isAbsolute(dir) || inside(dir)) continue
    const exe = path.join(dir, 'git.exe')
    if (existsSync(exe)) return exe
  }
  throw new Error('git.exe not found on an absolute PATH entry outside the repository')
}
/**
 * Object reads that cannot be redirected (review N1): `--no-replace-objects` (a planted refs/replace/<X> would otherwise make X read as other
 * content), literal pathspecs, no hooks or fsmonitor, and no inherited GIT_* environment (GIT_DIR, GIT_OBJECT_DIRECTORY, GIT_REPLACE_REF_BASE…).
 */
function gitEnv() {
  const env = {}
  for (const [k, v] of Object.entries(process.env)) if (!/^GIT_/i.test(k) && v !== undefined) env[k] = v
  return { ...env, GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }
}
const git = (root, args, { buffer = false, timeout = 60_000 } = {}) => spawnSync(gitExecutable(root),
  ['--no-replace-objects', '--literal-pathspecs', '-C', root, '-c', 'core.hooksPath=', '-c', 'core.fsmonitor=false', ...args],
  { cwd: root, env: gitEnv(), encoding: buffer ? 'buffer' : 'utf8', maxBuffer: 64 * 1024 * 1024, timeout })

/**
 * The commit named by a FULL 40-hex sha, or throw. Abbreviations are refused (review B1): for a short hex string git resolves ref names such as a
 * branch called `<hex>` before object ids, so an agent could point an abbreviation at code the owner never reviewed. A full sha is always read
 * as an object id, and its type is checked without any name lookup.
 */
export function resolveCommit(root, ref) {
  if (typeof ref !== 'string' || !/^[0-9a-f]{40}$/i.test(ref)) throw new Error('--from-ref must be the full 40-hex sha of the reviewed commit (abbreviations and ref names are refused)')
  const sha = ref.toLowerCase()
  const t = git(root, ['cat-file', '-t', sha])
  if (t.status !== 0 || String(t.stdout).trim() !== 'commit') throw new Error(`--from-ref ${sha} is not a commit in this repository`)
  return sha
}

/**
 * Digests of a commit's closure files from git objects (no checkout), with the same rules as the working-tree digest: CRLF normalized, regular
 * files only (a symlink or submodule entry makes the closure unverifiable), the same file and size limits.
 */
export function digestRef(root, ref, closure) {
  const sha = resolveCommit(root, ref)
  const dirs = closure.include.map((i) => i.replace(/\/$/, ''))
  const ls = git(root, ['ls-tree', '-r', '-z', sha, '--', ...dirs])
  if (ls.status !== 0) throw new Error(`git ls-tree failed: ${String(ls.stderr).trim().slice(0, 200)}`)
  const out = {}
  let files = 0
  let bytes = 0
  const entries = ls.stdout.split('\0').filter(Boolean).map((line) => { const tab = line.indexOf('\t'); const [mode, type, oid] = line.slice(0, tab).split(' '); return { mode, type, oid, rel: line.slice(tab + 1) } })
  for (const { mode, type, oid, rel } of entries.sort((a, b) => (a.rel < b.rel ? -1 : 1))) {
    if (!inClosure(closure, rel)) continue
    if (type !== 'blob' || !['100644', '100755'].includes(mode) || !FULL_SHA.test(oid)) throw new Error(`closure entry ${rel} is not a regular file (${mode} ${type})`)
    const blob = git(root, ['cat-file', 'blob', oid], { buffer: true })
    if (blob.status !== 0) throw new Error(`git cat-file failed for ${rel}`)
    if (blob.stdout.length > LIMITS.fileBytes) throw new Error(`closure file ${rel} is too large`)
    bytes += blob.stdout.length
    if (++files > LIMITS.files || bytes > LIMITS.totalBytes) throw new Error('closure too large')
    out[rel] = contentDigest(blob.stdout)
  }
  return out
}

const hasCommit = (root, sha) => git(root, ['cat-file', '-e', `${sha}^{commit}`]).status === 0
const isShallow = (root) => String(git(root, ['rev-parse', '--is-shallow-repository']).stdout).trim() === 'true'

/**
 * Provenance of one trusted execution's pins (read-only, fail closed):
 *   * `reviewed_source.ref` is a full lowercase 40-hex commit sha (never a label such as "working tree");
 *   * that commit resolves in this repository. In a SHALLOW clone (a CI checkout) and only when `fetchIfShallow` is set, exactly that one
 *     commit is fetched from `remote` first; nothing is fetched in a full clone;
 *   * the commit's closure, computed from git objects, has exactly the pinned file set and digests.
 * Returns { ok, problems[], commit?, files? }. Problems: PIN_REF_NOT_A_COMMIT, PIN_DIGESTS_EMPTY, PIN_REF_UNRESOLVABLE,
 * PIN_REF_UNVERIFIABLE:<why>, PIN_DIGEST_MISMATCH:<path>:<changed|added|removed>.
 */
export function verifyPinProvenance(root, execution, { fetchIfShallow = false, remote = 'origin' } = {}) {
  const ref = execution?.reviewed_source?.ref
  if (typeof ref !== 'string' || !FULL_SHA.test(ref)) return { ok: false, problems: ['PIN_REF_NOT_A_COMMIT'] }
  const pinned = execution.digests
  if (!pinned || typeof pinned !== 'object' || Object.keys(pinned).length === 0) return { ok: false, problems: ['PIN_DIGESTS_EMPTY'] }
  if (!hasCommit(root, ref) && fetchIfShallow && REMOTE_NAME.test(remote) && isShallow(root)) {
    git(root, ['fetch', '--quiet', '--no-tags', '--no-recurse-submodules', '--depth=1', remote, ref], { timeout: 180_000 })
  }
  if (!hasCommit(root, ref)) return { ok: false, problems: ['PIN_REF_UNRESOLVABLE'] }
  let actual
  try { actual = digestRef(root, ref, execution.closure) } catch (e) { return { ok: false, problems: [`PIN_REF_UNVERIFIABLE:${String(e.message).slice(0, 200)}`] } }
  const diff = diffDigests(pinned, actual)
  if (diff.length) return { ok: false, problems: diff.map((d) => `PIN_DIGEST_MISMATCH:${d.path}:${d.change}`) }
  return { ok: true, problems: [], commit: ref, files: Object.keys(actual).length }
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
  if (argv.includes('--verify-provenance')) {
    const results = scope.trusted_executions.map((e) => ({ execution: e.id, ref: e.reviewed_source?.ref ?? null, ...verifyPinProvenance(ROOT, e, { fetchIfShallow: argv.includes('--fetch-if-shallow') }) }))
    console.log(JSON.stringify(results, null, 2))
    return results.every((r) => r.ok) ? 0 : 1
  }
  const write = argv.includes('--write')
  const fromRef = opt('from-ref')
  if (write && !fromRef) { console.error('--write requires --from-ref <commit>: pins are taken from the reviewed immutable commit, never from the working tree'); return 2 }
  const sha = fromRef ? resolveCommit(ROOT, fromRef) : null
  let drift = false
  const report = scope.trusted_executions.map((e) => {
    const actual = sha ? digestRef(ROOT, sha, e.closure) : digestTree(ROOT, e.closure)
    if (!actual) throw new Error(`closure of ${e.id} is unverifiable (symlink, special file or size limit)`)
    const diff = diffDigests(e.digests, actual)
    if (diff.length) drift = true
    return { execution: e.id, entrypoint: e.entrypoint, source: sha ? `git ${sha}` : 'working tree', files: Object.keys(actual).length, diff, digests: actual }
  })
  if (write) {
    const raw = doc.scopes.find((s) => s.id === scope.id)
    for (const r of report) {
      const e = raw.trusted_executions.find((x) => x.id === r.execution)
      e.digests = r.digests
      e.reviewed_source = { ...(e.reviewed_source ?? {}), ref: sha, pinned_at: new Date().toISOString().slice(0, 10) }
      const tree = digestTree(ROOT, e.closure)
      const local = tree ? diffDigests(r.digests, tree) : null
      if (!local || local.length) console.error(`warning: the working tree's ${e.id} closure ${local ? `differs from ${sha} in ${local.length} file(s)` : 'is unverifiable'}; bypass runs stay denied until it matches the pinned commit`)
    }
    validateBypassScopes(doc, contract)
    writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`)
    console.log(`pins for scope ${scope.id} rewritten from ${sha} (${report.map((r) => `${r.execution}: ${r.files} files`).join('; ')}); review and commit ${SCOPES_FILE}`)
    return 0
  }
  console.log(JSON.stringify(argv.includes('--json') ? report : report.map(({ digests, ...r }) => r), null, 2))
  if (argv.includes('--check')) return drift ? 1 : 0
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)) } catch (error) { console.error(`bypass-pins: ${error.message}`); process.exitCode = 2 }
}
