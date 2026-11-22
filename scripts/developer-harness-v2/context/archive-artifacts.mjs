#!/usr/bin/env node
// Developer Harness V2 — Phase 3 archive-first tool for tracked historical artifacts.
//
// Copies the exact git blobs of selected tracked paths (at a pinned source commit) to an archive directory
// OUTSIDE the git working tree, writes a SHA-256 manifest, and verifies the archive by re-reading every file.
// It never modifies the repository, never deletes anything and never untracks anything: untracking is a separate,
// human-approved operation (see docs/developer-harness-v2/08-phase-3-context-and-memory-report.md §7).
//
//   node archive-artifacts.mjs archive --repo <dir> --commit <sha> --out <archiveDir>
//   node archive-artifacts.mjs verify  --repo <dir> --manifest <archiveDir>/MANIFEST.json
//
// No network, no model calls. Paths are read from git, not from the working tree, so a dirty checkout
// cannot change what is archived.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Tracked-path selectors for the Phase 3 archive. Prefix entries end with '/'. */
export const ARCHIVE_SELECTORS = Object.freeze([
  '.wolf/token-ledger.json',
  '.wolf/memory.md',
  '.wolf/buglog.json',
  '.wolf/anatomy.md',
  '.wolf/cerebrum.md',
  '.wolf/supervisor_ui.xml',
  '.wolf/hooks/_session.json',
  '.wolf/cron-state.json',
  '.wolf/runtime-logs/',
  'graphify-out/',
])

/**
 * Paths the human owner explicitly approved (2026-11-22, Phase 3) for `git rm --cached` AFTER the verified archive.
 * Each is archived (subset of ARCHIVE_SELECTORS) and gitignored. Local files are kept on disk.
 */
export const APPROVED_UNTRACK = Object.freeze([
  '.wolf/token-ledger.json',
  '.wolf/memory.md',
  '.wolf/hooks/_session.json',
  '.wolf/runtime-logs/',
  '.wolf/supervisor_ui.xml',
  'graphify-out/cache/',
])

export function selectUntrackPaths(repo, commit) {
  return selectArchivePaths(repo, commit).filter((p) => isMangledRootPath(p) || APPROVED_UNTRACK.some((s) => (s.endsWith('/') ? p.startsWith(s) : p === s)))
}

/** Tracked files whose names are mangled Windows paths (written by a past hook path-normalization bug). */
export const isMangledRootPath = (p) => !p.includes('/') && /^C\uF03AUsers/i.test(p)

const git = (repo, args, opts = {}) => execFileSync('git', ['-C', repo, ...args], { maxBuffer: 1 << 30, ...opts })

export function selectArchivePaths(repo, commit) {
  const all = git(repo, ['ls-tree', '-r', '-z', '--name-only', commit]).toString('utf8').split('\0').filter(Boolean)
  const picked = all.filter((p) => isMangledRootPath(p) || ARCHIVE_SELECTORS.some((s) => (s.endsWith('/') ? p.startsWith(s) : p === s)))
  return [...new Set(picked)].sort()
}

/** Archive-relative file name: keeps the repo path; a mangled root name gets a safe, stable name. */
export function archiveName(p) {
  if (isMangledRootPath(p)) return `_mangled-root/${createHash('sha256').update(p).digest('hex').slice(0, 12)}.md`
  return p
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

export function archive({ repo, commit, out }) {
  const resolvedCommit = git(repo, ['rev-parse', '--verify', `${commit}^{commit}`]).toString().trim()
  const top = git(repo, ['rev-parse', '--show-toplevel']).toString().trim()
  const rel = path.relative(path.resolve(top), path.resolve(out))
  if (!(rel === '..' || rel.startsWith(`..${path.sep}`)) && !path.isAbsolute(rel)) throw new Error('archive directory must be outside the git working tree')
  const entries = []
  for (const p of selectArchivePaths(repo, resolvedCommit)) {
    const blob = git(repo, ['rev-parse', `${resolvedCommit}:${p}`]).toString().trim()
    const data = git(repo, ['cat-file', 'blob', blob])
    const name = archiveName(p)
    const dest = path.join(out, 'files', ...name.split('/'))
    mkdirSync(path.dirname(dest), { recursive: true })
    writeFileSync(dest, data)
    entries.push({ path: p, archive_file: `files/${name}`, git_blob: blob, bytes: data.length, sha256: sha256(data) })
  }
  const manifest = {
    kind: 'developer-harness-v2/phase-3-archive',
    version: 1,
    repository: 'henilllpatelll/PatelRep',
    source_commit: resolvedCommit,
    selectors: ARCHIVE_SELECTORS,
    file_count: entries.length,
    total_bytes: entries.reduce((n, e) => n + e.bytes, 0),
    entries,
  }
  writeFileSync(path.join(out, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

/** Re-reads every archived file and the source blob; returns a list of problems (empty = verified). */
export function verify({ repo, manifestPath }) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const base = path.dirname(manifestPath)
  const problems = []
  for (const e of manifest.entries) {
    const file = path.join(base, ...e.archive_file.split('/'))
    if (!existsSync(file)) { problems.push(`${e.path}: archive file missing`); continue }
    const data = readFileSync(file)
    if (data.length !== e.bytes) problems.push(`${e.path}: size ${data.length} != ${e.bytes}`)
    if (sha256(data) !== e.sha256) problems.push(`${e.path}: archive sha256 mismatch`)
    if (repo) {
      const src = git(repo, ['cat-file', 'blob', e.git_blob])
      if (sha256(src) !== e.sha256) problems.push(`${e.path}: source blob sha256 mismatch`)
      const atCommit = git(repo, ['rev-parse', `${manifest.source_commit}:${e.path}`]).toString().trim()
      if (atCommit !== e.git_blob) problems.push(`${e.path}: blob differs from source commit`)
    }
  }
  if (manifest.file_count !== manifest.entries.length) problems.push('file_count mismatch')
  return { manifest, problems }
}

function parseArgs(argv) {
  const [cmd, ...rest] = argv
  const opts = {}
  for (let i = 0; i < rest.length; i += 2) opts[rest[i].replace(/^--/, '')] = rest[i + 1]
  return { cmd, opts }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { cmd, opts } = parseArgs(process.argv.slice(2))
  if (cmd === 'archive') {
    const m = archive({ repo: opts.repo ?? '.', commit: opts.commit ?? 'HEAD', out: opts.out })
    console.log(JSON.stringify({ source_commit: m.source_commit, file_count: m.file_count, total_bytes: m.total_bytes }))
  } else if (cmd === 'plan') {
    // Prints the exact NUL-separated paths for `git rm --cached --pathspec-from-file=- --pathspec-file-nul`.
    process.stdout.write(selectUntrackPaths(opts.repo ?? '.', opts.commit ?? 'HEAD').join('\0'))
  } else if (cmd === 'verify') {
    const { manifest, problems } = verify({ repo: opts.repo, manifestPath: opts.manifest })
    console.log(JSON.stringify({ source_commit: manifest.source_commit, file_count: manifest.file_count, problems }))
    process.exitCode = problems.length ? 1 : 0
  } else {
    console.error('usage: archive-artifacts.mjs archive|verify ...')
    process.exitCode = 2
  }
}
