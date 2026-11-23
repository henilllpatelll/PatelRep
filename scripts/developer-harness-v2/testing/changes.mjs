// Developer Harness V2 — Phase 6 changed-file collection.
//
// READ-ONLY git (argument arrays, no shell, GIT_OPTIONAL_LOCKS=0, no inherited GIT_* variables). Reports what the working
// tree REALLY differs by from the merge base: committed + staged + unstaged changes plus untracked files, with renames
// carrying BOTH the old and the new path and deletions kept as deletions. Claims about changed files in a PR description,
// task text or checkpoint are never used here: git is the only source. Identity (head, branch, tree digest) comes from the
// Phase 5 `gatherFacts`, and the two views of the changed set must agree or collection fails closed.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { SUITES } from './catalog.mjs'
import { sha256, canonical } from '../coordination/evidence.mjs'
import { gatherFacts } from '../coordination/resume.mjs'

export const LARGE_DIFF_FILES = 400
export const MAX_PATHS = 20000
const GIT_ENV = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))), GIT_OPTIONAL_LOCKS: '0' }
const REF = /^[A-Za-z0-9._/~^-]{1,200}$/

/** Normalize one repo-relative path. Absolute, drive-qualified, home-relative, escaping, control-character and `.git` paths are rejected. */
export function normalizeChangedPath(raw) {
  if (typeof raw !== 'string') return { ok: false, code: 'PATH.NOT_STRING' }
  const s = raw.replace(/\\/g, '/').trim()
  if (!s) return { ok: false, code: 'PATH.EMPTY' }
  if (/[\0\r\n]/.test(s)) return { ok: false, code: 'PATH.CONTROL_CHARACTER' }
  if (/^([A-Za-z]:|\/|~)/.test(s)) return { ok: false, code: 'PATH.NOT_RELATIVE' }
  const parts = s.split('/')
  if (parts.some((x) => x === '..')) return { ok: false, code: 'PATH.ESCAPES_REPOSITORY' }
  const n = parts.filter((x) => x && x !== '.').join('/')
  if (!n) return { ok: false, code: 'PATH.EMPTY' }
  if (n === '.git' || n.startsWith('.git/')) return { ok: false, code: 'PATH.GIT_INTERNAL' }
  return { ok: true, path: n }
}

const STATUS = { A: 'A', M: 'M', D: 'D', R: 'R', C: 'C', T: 'M', U: 'M' }

/**
 * Build a change set from explicit entries `{ path, status?, old_path? }` (or bare strings). Pure. Invalid paths are kept in
 * `invalid` (never dropped silently) and make the set unproven for the selector. A rename lists both paths in `all_paths`.
 */
export function changeSetFromEntries(input, meta = {}) {
  const invalid = []
  const byPath = new Map()
  for (const raw of input) {
    const e = typeof raw === 'string' ? { path: raw } : raw
    const n = normalizeChangedPath(e?.path)
    if (!n.ok) { invalid.push({ raw: String(e?.path).slice(0, 120), code: n.code }); continue }
    const status = STATUS[String(e.status ?? 'M')[0]] ?? null
    if (!status) { invalid.push({ raw: n.path, code: 'STATUS.UNSUPPORTED' }); continue }
    let old_path = null
    if (e.old_path !== undefined && e.old_path !== null) {
      const o = normalizeChangedPath(e.old_path)
      if (!o.ok) { invalid.push({ raw: String(e.old_path).slice(0, 120), code: o.code }); continue }
      old_path = o.path
    }
    const prev = byPath.get(n.path)
    byPath.set(n.path, prev ? { ...prev, status: prev.status === 'D' || status === 'D' ? 'D' : prev.status } : { path: n.path, status, old_path, untracked: Boolean(e.untracked), sources: e.sources ?? [] })
  }
  const entries = [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : 1))
  const all_paths = [...new Set(entries.flatMap((e) => (e.old_path ? [e.old_path, e.path] : [e.path])))].sort()
  const digestInput = entries.map((e) => [e.status, e.path, e.old_path]).sort((a, b) => canonical(a).localeCompare(canonical(b)))
  return {
    ok: true, entries, all_paths, invalid, too_large: entries.length > LARGE_DIFF_FILES, truncated: entries.length > MAX_PATHS,
    changed_file_digest: sha256(canonical({ entries: digestInput, invalid: invalid.map((i) => i.code).sort() })), ...meta,
  }
}

function parseNameStatus(out) {
  const f = out.split('\0')
  const rows = []
  for (let i = 0; i < f.length; i++) {
    const st = f[i]
    if (!st) continue
    if (/^[RC]/.test(st)) { rows.push({ status: st[0], old_path: f[i + 1], path: f[i + 2] }); i += 2 } else { rows.push({ status: st[0], path: f[i + 1] }); i += 1 }
  }
  return rows
}

/**
 * Collect the real change set for `root`. `base` is the verified base ref/sha; without it only staged, unstaged and untracked
 * work (vs HEAD) is visible and the result says so (`base_examined: false`). Returns `{ ok: false, code }` when git state is
 * unavailable, the base is unresolved, or the two views disagree: callers must treat that as UNPROVEN, never as "no changes".
 */
export function collectChanges(root, { base = null } = {}) {
  const git = (...a) => execFileSync('git', ['-C', root, '-c', 'core.quotePath=false', '-c', 'core.fsmonitor=false', ...a], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], env: GIT_ENV })
  if (base !== null && (typeof base !== 'string' || !REF.test(base) || base.startsWith('-'))) return { ok: false, code: 'GIT.BASE_INVALID' }
  let facts
  try {
    const baseSha = base === null ? null : git('rev-parse', '--verify', `${base}^{commit}`).trim()
    facts = gatherFacts(root, { baseSha })
  } catch { return { ok: false, code: base === null ? 'GIT.STATE_UNAVAILABLE' : 'GIT.BASE_UNRESOLVED' } }
  if (base !== null && !facts.base_is_ancestor) return { ok: false, code: 'GIT.BASE_UNRESOLVED' }
  try {
    const mb = base ? git('merge-base', base, 'HEAD').trim() : 'HEAD'
    const committed = base ? new Set(git('diff', '--name-only', '-z', '--no-renames', mb, 'HEAD').split('\0').filter(Boolean)) : new Set()
    const staged = new Set(git('diff', '--cached', '--name-only', '-z', '--no-renames', 'HEAD').split('\0').filter(Boolean))
    const unstaged = new Set(git('diff', '--name-only', '-z', '--no-renames').split('\0').filter(Boolean))
    const rows = parseNameStatus(git('diff', '--name-status', '-z', '-M', mb))
    const untracked = git('ls-files', '-z', '--others', '--exclude-standard').split('\0').filter(Boolean)
    const sources = (p) => [committed.has(p) && 'committed', staged.has(p) && 'staged', unstaged.has(p) && 'unstaged'].filter(Boolean)
    const entries = [...rows.map((r) => ({ ...r, sources: sources(r.path) })), ...untracked.map((p) => ({ path: p, status: 'A', untracked: true, sources: ['untracked'] }))]
    const set = changeSetFromEntries(entries, {
      // A base equal to HEAD examines NO committed work (the diff against HEAD is just staged/unstaged), so it is not a verified comparison base.
      base_examined: Boolean(base) && git('rev-parse', `${base}^{commit}`).trim() !== facts.head_sha, base_is_head: Boolean(base) && git('rev-parse', `${base}^{commit}`).trim() === facts.head_sha,
      base_sha: base ? git('rev-parse', `${base}^{commit}`).trim() : null, merge_base: base ? mb : null,
      head_sha: facts.head_sha, branch: facts.branch, tree_digest: facts.tree_digest, phase5_scope_digest: facts.scope_digest, dirty: facts.dirty,
      source_counts: { committed: committed.size, staged: staged.size, unstaged: unstaged.size, untracked: untracked.length },
    })
    // Phase 5's own (--no-renames) view must equal ours when a base is examined; otherwise the tree moved while we were looking.
    if (base && canonical([...new Set(facts.changed_files)].sort()) !== canonical(set.all_paths)) return { ok: false, code: 'GIT.VIEWS_DISAGREE' }
    return set
  } catch { return { ok: false, code: 'GIT.STATE_UNAVAILABLE' } }
}

// ── Repository index: which tests READ which repository paths ──
// A hidden coupling (an API smoke test that parses a mobile source file, a workflow-contract test that reads a workflow) is
// invisible to path rules. The index is built from the tests' own string literals: any repo path a test names is a file whose
// change can fail that test. It is an over-approximation by design (comments count) and read-only; it is rebuilt per run.
const PATH_TOKEN = /(?<![A-Za-z0-9_./-])((?:apps|scripts|supabase|\.github|\.githooks|docs|infra|e2e|\.claude|\.wolf)\/[A-Za-z0-9_@()[\]+=,./-]*[A-Za-z0-9_)\]])/g
const MAX_TEST_BYTES = 768 * 1024
const walk = (dir, out = []) => {
  let ents = []
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of ents) { const f = path.join(dir, e.name); if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '__pycache__') walk(f, out) } else out.push(f) }
  return out
}

export function buildRepoIndex(root) {
  const rel = (f) => path.relative(root, f).split(path.sep).join('/')
  const apiDir = path.join(root, 'apps/api/tests')
  const apiTests = existsSync(apiDir) ? readdirSync(apiDir).filter((n) => /^test_[A-Za-z0-9_]+\.py$/.test(n)).sort().map((n) => `tests/${n}`) : []
  const testSuites = new Map() // repo-relative test file -> suite ids
  const tag = (file, id) => testSuites.set(file, new Set([...(testSuites.get(file) ?? []), id]))
  for (const s of SUITES) for (const st of s.steps) for (const f of st.files ?? []) tag(s.cwd === '.' ? f : `${s.cwd}/${f}`, s.id)
  for (const f of walk(apiDir).map(rel).filter((x) => /\/test_[^/]+\.py$/.test(x))) tag(f, /\/smoke\//.test(f) ? 'api.smoke' : /\/integration\//.test(f) ? 'db.api_integration' : 'api.pytest_full')
  for (const f of walk(path.join(root, 'apps/mobile/__tests__')).map(rel).filter((x) => /\.(tsx?|jsx?)$/.test(x))) tag(f, 'mobile.jest_full')
  const own = (f) => (/^apps\/api\/tests\//.test(f) ? 'apps/api/tests' : /^apps\/mobile\/__tests__\//.test(f) ? 'apps/mobile/__tests__' : path.posix.dirname(f))
  const tokens = new Map() // path -> Set(suite)
  for (const [file, suites] of testSuites) {
    let text = ''
    try { const abs = path.join(root, file); if (statSync(abs).size > MAX_TEST_BYTES) continue; text = readFileSync(abs, 'utf8') } catch { continue }
    for (const m of text.matchAll(PATH_TOKEN)) {
      const t = m[1].replace(/\/+$/, '')
      if (t === file || t === own(file) || t.startsWith(`${own(file)}/`) || !existsSync(path.join(root, t))) continue
      const set = tokens.get(t) ?? new Set()
      for (const s of suites) set.add(s)
      tokens.set(t, set)
    }
  }
  const readers = [...tokens.entries()].map(([p, s]) => ({ path: p, suites: [...s].sort() })).sort((a, b) => (a.path < b.path ? -1 : 1))
  return { api_root_tests: apiTests, readers }
}
