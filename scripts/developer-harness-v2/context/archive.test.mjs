// Developer Harness V2 — Phase 3 archive and untracking safety tests. Offline; never modifies the repository.
// Run: node --test scripts/developer-harness-v2/context/archive.test.mjs
// Optional: DH_V2_ARCHIVE=<dir> to verify a local copy of the external archive (default: the Phase 3 location if present).
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { APPROVED_UNTRACK, ARCHIVE_SELECTORS, archive, isMangledRootPath, verify } from './archive-artifacts.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..', '..')
const manifest = JSON.parse(readFileSync(path.join(REPO, 'docs/developer-harness-v2/phase-3-archive-manifest.json'), 'utf8'))
const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { maxBuffer: 1 << 26 }).toString('utf8')
const indexFiles = new Set(git('ls-files', '-z').split('\0').filter(Boolean))
const hasCommit = (sha) => spawnSync('git', ['-C', REPO, 'cat-file', '-e', `${sha}^{commit}`]).status === 0
const isUntrackSelected = (p) => isMangledRootPath(p) || APPROVED_UNTRACK.some((s) => (s.endsWith('/') ? p.startsWith(s) : p === s))

test('approved untrack selectors are a subset of the archived selectors', () => {
  for (const s of APPROVED_UNTRACK) assert.ok(ARCHIVE_SELECTORS.some((a) => a === s || (a.endsWith('/') && s.startsWith(a))), `${s} is covered by an archive selector`)
})

test('archive manifest is internally consistent', () => {
  assert.equal(manifest.kind, 'developer-harness-v2/phase-3-archive')
  assert.equal(manifest.file_count, manifest.entries.length)
  assert.equal(manifest.total_bytes, manifest.entries.reduce((n, e) => n + e.bytes, 0))
  for (const e of manifest.entries) {
    assert.match(e.sha256, /^[0-9a-f]{64}$/)
    assert.match(e.git_blob, /^[0-9a-f]{40}$/)
    assert.ok(e.archive_file.startsWith('files/'))
  }
  assert.deepEqual(manifest.entries.map((e) => e.path), [...manifest.entries.map((e) => e.path)].sort())
})

test('manifest entries match the source commit blobs (when history is available)', (t) => {
  if (!hasCommit(manifest.source_commit)) { t.skip('source commit not in local history'); return }
  const tree = new Map(git('ls-tree', '-r', '-z', manifest.source_commit).split('\0').filter(Boolean).map((l) => { const [meta, p] = l.split('\t'); return [p, meta.split(' ')[2]] }))
  for (const e of manifest.entries) assert.equal(tree.get(e.path), e.git_blob, e.path)
  assert.equal(spawnSync('git', ['-C', REPO, 'merge-base', '--is-ancestor', manifest.source_commit, 'HEAD']).status, 0, 'no history rewrite: source commit is an ancestor of HEAD')
})

test('every approved path is archived, removed from the index, and ignored for future work', () => {
  const selected = manifest.entries.filter((e) => isUntrackSelected(e.path))
  assert.ok(selected.length >= 200, `${selected.length} approved paths`)
  for (const e of selected) {
    assert.ok(!indexFiles.has(e.path), `${e.path} is no longer tracked`)
    if (!isMangledRootPath(e.path)) {
      assert.equal(spawnSync('git', ['-C', REPO, 'check-ignore', '-q', '--no-index', e.path]).status, 0, `${e.path} is ignored`)
    }
  }
})

test('curated knowledge and source files remain tracked and are not ignored', () => {
  const keep = ['.wolf/cerebrum.md', '.wolf/knowledge/_provenance.json', '.wolf/buglog.json', '.wolf/anatomy.md', '.wolf/OPENWOLF.md', '.wolf/config.json',
    '.wolf/cron-manifest.json', '.wolf/hooks/session-start.js', 'graphify-out/auto_update.py', 'CLAUDE.md', 'scripts/developer-harness-v2/context/archive-artifacts.mjs']
  for (const p of keep) {
    assert.notEqual(spawnSync('git', ['-C', REPO, 'check-ignore', '-q', '--no-index', p]).status, 0, `${p} not ignored`)
  }
  for (const p of keep.filter((x) => indexFiles.has(x) || existsSync(path.join(REPO, x)))) assert.ok(existsSync(path.join(REPO, p)), p)
  for (const p of ['.wolf/cerebrum.md', '.wolf/buglog.json', '.wolf/anatomy.md', 'graphify-out/auto_update.py']) assert.ok(indexFiles.has(p), `${p} tracked`)
})

test('only approved paths were untracked relative to the source commit', (t) => {
  if (!hasCommit(manifest.source_commit)) { t.skip('source commit not in local history'); return }
  const removed = git('diff', '--name-only', '--no-renames', '-z', '--diff-filter=D', manifest.source_commit, '--cached').split('\0').filter(Boolean)
  for (const p of removed) assert.ok(isUntrackSelected(p), `unexpected removal: ${p}`)
})

test('external archive verifies byte-for-byte against the manifest (when the archive is present locally)', (t) => {
  const dir = process.env.DH_V2_ARCHIVE ?? 'C:/Users/Henil/projects/PatelRep-archive/developer-harness-v2-phase3/2026-11-21'
  const m = path.join(dir, 'MANIFEST.json')
  if (!existsSync(m)) { t.skip(`archive not present at ${dir}`); return }
  const { manifest: local, problems } = verify({ repo: hasCommit(manifest.source_commit) ? REPO : null, manifestPath: m })
  assert.deepEqual(problems, [])
  assert.deepEqual(local, manifest, 'committed manifest copy equals the archive manifest')
})

test('archive() refuses an output directory inside the working tree and verify() detects tampering', () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'dhv2-arch-repo-'))
  const out = mkdtempSync(path.join(os.tmpdir(), 'dhv2-arch-out-'))
  try {
    const g = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' })
    g('init', '-q'); g('config', 'user.email', 'fixture@example.com'); g('config', 'user.name', 'fixture')
    mkdirSync(path.join(repo, '.wolf'), { recursive: true })
    writeFileSync(path.join(repo, '.wolf/memory.md'), 'history\n')
    writeFileSync(path.join(repo, 'keep.txt'), 'x\n')
    g('add', '.'); g('commit', '-qm', 'fixture')
    assert.throws(() => archive({ repo, commit: 'HEAD', out: path.join(repo, 'inside') }), /outside the git working tree/)
    const m = archive({ repo, commit: 'HEAD', out })
    assert.deepEqual(m.entries.map((e) => e.path), ['.wolf/memory.md'])
    assert.deepEqual(verify({ repo, manifestPath: path.join(out, 'MANIFEST.json') }).problems, [])
    writeFileSync(path.join(out, 'files/.wolf/memory.md'), 'tampered\n')
    assert.ok(verify({ repo, manifestPath: path.join(out, 'MANIFEST.json') }).problems.length >= 1)
  } finally {
    rmSync(repo, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true })
  }
})

test('the archive tool never deletes, untracks or rewrites history', () => {
  const src = readFileSync(path.join(HERE, 'archive-artifacts.mjs'), 'utf8')
  assert.doesNotMatch(src, /\brmSync\b|\bunlinkSync\b|\['rm'|'rm',|filter-repo|filter-branch|'update-ref'|'reset'|'push'|'commit'/)
  const gitArgs = [...src.matchAll(/git\(repo, \['([a-z-]+)'/g)].map((m) => m[1])
  assert.deepEqual([...new Set(gitArgs)].sort(), ['cat-file', 'ls-tree', 'rev-parse'], 'only read-only git plumbing is used')
})
