// Developer Harness V3 (D3.2) — trusted Git fact gathering (read-only).
//
// MUST run in the TRUSTED VERIFIER against a verifier-controlled clone, never inside the candidate's writable environment: the
// facts are only as trustworthy as the clone they came from. `expectedRepository` is supplied by the verifier's own configuration;
// the clone's remote URL is only cross-checked against it. No network, no write, no hook, no external diff or textconv driver.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { v } from '../lib/canonical.mjs'
import { matchesAny, normalizeRepoPath } from '../lib/paths.mjs'

const MAX_PATCH_BYTES = 128 * 1024 * 1024
const MAX_ADDED_LINES = 5000
const MAX_TRIPWIRE_PATHS = 200

// An EMPTY config file stands in for the user's global git config (os.devNull is not accepted by Git for Windows as a config path).
const EMPTY_CONFIG = (() => { const d = mkdtempSync(path.join(os.tmpdir(), 'd32-gitcfg-')); const f = path.join(d, 'empty.gitconfig'); writeFileSync(f, ''); return f })()

function cleanEnv() {
  const env = {}
  for (const [k, val] of Object.entries(process.env)) if (!/^GIT_/i.test(k) && val !== undefined) env[k] = val
  return { ...env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: EMPTY_CONFIG, GIT_EXTERNAL_DIFF: '' }
}
const git = (repoDir, args, { maxBuffer = 64 * 1024 * 1024 } = {}) =>
  execFileSync('git', ['--literal-pathspecs', '-C', repoDir, '-c', 'core.hooksPath=', '-c', 'diff.external=', '-c', 'core.fsmonitor=false', '-c', 'color.ui=false', '-c', 'diff.ignoreSubmodules=none',
    '-c', 'diff.renames=false', '-c', 'core.attributesFile=', '-c', 'diff.context=3', '-c', 'diff.interHunkContext=0', '-c', 'diff.algorithm=default', '-c', 'diff.noprefix=false', '-c', 'diff.mnemonicPrefix=false', ...args], { env: cleanEnv(), maxBuffer, stdio: ['ignore', 'pipe', 'ignore'] })

/** `git diff --raw -z --no-abbrev`: ":oldmode newmode oldsha newsha STATUS\0path\0". Modes 120000 (symlink) and 160000 (gitlink) are reported separately. */
function parseRaw(buf) {
  const parts = buf.toString('utf8').split('\0')
  if (parts.at(-1) === '') parts.pop()
  const changes = []; const special = []
  for (let i = 0; i < parts.length; i += 2) {
    const m = /^:(\d{6}) (\d{6}) [0-9a-f]{40} [0-9a-f]{40} ([A-Z])$/.exec(parts[i] ?? '')
    if (!m || parts[i + 1] === undefined) throw new Error('unparseable raw diff output')
    if (parts[i + 1].includes('\uFFFD')) throw new Error('undecodable path')
    changes.push({ status: m[3], path: parts[i + 1] })
    if (['120000', '160000'].includes(m[1]) || ['120000', '160000'].includes(m[2])) special.push(parts[i + 1])
  }
  return { changes, special }
}

/**
 * @returns {{ok:true, facts:object}|{ok:false, problems:string[]}}
 */
export function gatherCandidateFacts({ repoDir, expectedRepository, baseSha, candidateSha, contract }) {
  const problems = []
  try {
    if (!v.repo(expectedRepository)) return { ok: false, problems: ['FACTS.REPOSITORY_INVALID'] }
    if (!v.sha40(baseSha) || !v.sha40(candidateSha)) return { ok: false, problems: ['FACTS.SHA_INVALID'] }
    for (const sha of [baseSha, candidateSha]) {
      let resolved = null
      try { resolved = git(repoDir, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]).toString('utf8').trim() } catch { resolved = null }
      if (resolved !== sha) return { ok: false, problems: ['FACTS.COMMIT_UNRESOLVED'] }
    }
    try { git(repoDir, ['merge-base', '--is-ancestor', baseSha, candidateSha]) } catch { return { ok: false, problems: ['FACTS.BASE_NOT_ANCESTOR'] } }

    const treeDigest = git(repoDir, ['rev-parse', '--verify', `${candidateSha}^{tree}`]).toString('utf8').trim()
    if (!v.sha40(treeDigest)) return { ok: false, problems: ['FACTS.TREE_UNRESOLVED'] }

    const { changes, special } = parseRaw(git(repoDir, ['diff', '--raw', '--no-abbrev', '--no-renames', '--no-color', '--ignore-submodules=none', '--no-ext-diff', '--no-textconv', '-z', baseSha, candidateSha]))
    if (changes.length > contract.limits.max_changed_paths) return { ok: false, problems: ['FACTS.TOO_MANY_CHANGES'] }

    const patch = git(repoDir, ['diff', '--binary', '--full-index', '--no-renames', '--no-color', '--ignore-submodules=none', '--no-ext-diff', '--no-textconv', baseSha, candidateSha], { maxBuffer: MAX_PATCH_BYTES })
    const patchDigest = createHash('sha256').update(patch).digest('hex')

    const baseFiles = git(repoDir, ['ls-tree', '-r', '-z', '--name-only', baseSha, '--', contract.migrations.directory]).toString('utf8').split('\0').filter(Boolean)

    // Heuristic input only (customer-agent tripwire): added lines of changed files that match the contract's customer-agent globs.
    const watched = changes.map((c) => ({ c, n: normalizeRepoPath(c.path) })).filter(({ c, n }) => n.ok && c.status !== 'D' && matchesAny(contract.customer_agent.path_globs, n.path))
    const addedLines = {}
    if (watched.length > MAX_TRIPWIRE_PATHS) problems.push('FACTS.TRIPWIRE_PATHS_TRUNCATED')
    let budget = MAX_ADDED_LINES
    for (const { n } of watched.slice(0, MAX_TRIPWIRE_PATHS)) {
      if (budget <= 0) { problems.push('FACTS.TRIPWIRE_LINES_TRUNCATED'); break }
      const diff = git(repoDir, ['diff', '-U0', '--text', '--no-renames', '--no-color', '--ignore-submodules=none', '--no-ext-diff', '--no-textconv', baseSha, candidateSha, '--', n.path]).toString('utf8')
      // Only lines AFTER the first hunk header are content; an added line that itself starts with '++' is still an added line.
      const all = diff.split('\n'); const firstHunk = all.findIndex((l) => l.startsWith('@@'))
      const lines = (firstHunk < 0 ? [] : all.slice(firstHunk)).filter((l) => l.startsWith('+')).map((l) => l.slice(1, 4001)).slice(0, budget)
      budget -= lines.length
      addedLines[n.path] = lines
    }

    let originMatches = null
    try {
      const url = git(repoDir, ['config', '--get', 'remote.origin.url']).toString('utf8').trim()
      const m = /^(?:https:\/\/(?:[^@/\s]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(url)
      originMatches = m ? m[1].toLowerCase() === expectedRepository.toLowerCase() : false
    } catch { originMatches = null }
    if (originMatches === false) return { ok: false, problems: ['FACTS.ORIGIN_MISMATCH'] }

    return { ok: true, problems, facts: { source: 'git', repository: expectedRepository, base_sha: baseSha, candidate_sha: candidateSha, tree_digest: treeDigest,
      patch_digest: patchDigest, changes, special_modes: special, base_migrations: baseFiles, added_lines: addedLines, origin_matches: originMatches } }
  } catch (e) {
    // Only a status or code is reported: git's message would echo local paths.
    return { ok: false, problems: [`FACTS.GIT_ERROR:${String(e?.status ?? e?.code ?? 'unknown').slice(0, 30)}`] }
  }
}
