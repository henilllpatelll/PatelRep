// D3.2 — trusted Git facts and migration classification, exercised against DISPOSABLE git repositories only.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { loadContractFile } from '../authority/contract.mjs'
import { gatherCandidateFacts } from '../authority/git-facts.mjs'
import { classifyMigrationChanges } from '../authority/migration-facts.mjs'
import { planRouting } from '../../developer-harness-v2/routing/router.mjs'

const C = loadContractFile()
const REPO = 'henilllpatelll/PatelRep'
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' }
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const write = (dir, rel, text) => { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), text) }

function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'd32-git-'))
  git(dir, 'init', '-q', '-b', 'main'); git(dir, 'config', 'core.autocrlf', 'false'); git(dir, 'config', 'commit.gpgsign', 'false')
  write(dir, 'supabase/migrations/001_init.sql', 'select 1;\n'); write(dir, 'supabase/migrations/262_agent_verified_human_identity.sql', 'select 262;\n')
  write(dir, 'apps/mobile/a.ts', 'export const a = 1\n')
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'base')
  const base = git(dir, 'rev-parse', 'HEAD')
  git(dir, 'checkout', '-q', '-b', 'feat')
  return { dir, base, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}
const commit = (dir, msg = 'c') => { git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', msg); return git(dir, 'rev-parse', 'HEAD') }
const facts = (f, head) => gatherCandidateFacts({ repoDir: f.dir, expectedRepository: REPO, baseSha: f.base, candidateSha: head, contract: C })
const classify = (r) => classifyMigrationChanges({ directory: C.migrations.directory, filePattern: C.migrations.file_pattern, baseFiles: r.facts.base_migrations, changes: r.facts.changes })

test('facts bind the exact candidate: sha, tree, patch digest, changes and base migrations come from Git', () => {
  const f = fixture()
  try {
    write(f.dir, 'apps/mobile/a.ts', 'export const a = 2\n')
    const head = commit(f.dir)
    const r = facts(f, head)
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.facts.source, 'git')
    assert.equal(r.facts.candidate_sha, head)
    assert.equal(r.facts.tree_digest, git(f.dir, 'rev-parse', `${head}^{tree}`))
    assert.deepEqual(r.facts.changes, [{ status: 'M', path: 'apps/mobile/a.ts' }])
    assert.deepEqual(r.facts.base_migrations.sort(), ['supabase/migrations/001_init.sql', 'supabase/migrations/262_agent_verified_human_identity.sql'])
    assert.match(r.facts.patch_digest, /^[0-9a-f]{64}$/)
    write(f.dir, 'apps/mobile/a.ts', 'export const a = 3\n')
    const head2 = commit(f.dir)
    const r2 = facts(f, head2)
    assert.notEqual(r2.facts.tree_digest, r.facts.tree_digest)
    assert.notEqual(r2.facts.patch_digest, r.facts.patch_digest)
    assert.equal(facts(f, head).facts.patch_digest, r.facts.patch_digest, 'deterministic')
  } finally { f.cleanup() }
})

test('a genuinely new migration is classified new from Git facts, whatever anyone calls it', () => {
  const f = fixture()
  try {
    write(f.dir, 'supabase/migrations/263_new_thing.sql', 'select 263;\n')
    const r = facts(f, commit(f.dir))
    assert.deepEqual(classify(r), { newMigrations: ['supabase/migrations/263_new_thing.sql'], violations: [], baseMaxNumber: 262 })
  } finally { f.cleanup() }
})

test('editing, deleting, renaming or re-adding a historical migration is a violation from Git facts', () => {
  const f = fixture()
  try {
    write(f.dir, 'supabase/migrations/262_agent_verified_human_identity.sql', 'select "tampered";\n')
    assert.deepEqual(classify(facts(f, commit(f.dir))).violations, [{ code: 'MIGRATION.HISTORICAL_MODIFIED', path: 'supabase/migrations/262_agent_verified_human_identity.sql' }])
    git(f.dir, 'mv', 'supabase/migrations/001_init.sql', 'supabase/migrations/263_renamed.sql')
    const v = classify(facts(f, commit(f.dir))).violations.map((x) => x.code).sort()
    assert.ok(v.includes('MIGRATION.HISTORICAL_DELETED'), `a rename deletes the historical path: ${v}`)
    git(f.dir, 'rm', '-q', 'supabase/migrations/262_agent_verified_human_identity.sql')
    assert.ok(classify(facts(f, commit(f.dir))).violations.some((x) => x.code === 'MIGRATION.HISTORICAL_DELETED'))
  } finally { f.cleanup() }
})

test('case-only collisions with a historical migration are caught (NTFS is case-insensitive)', () => {
  const r = classifyMigrationChanges({ directory: C.migrations.directory, filePattern: C.migrations.file_pattern,
    baseFiles: ['supabase/migrations/262_agent_verified_human_identity.sql'], changes: [{ status: 'A', path: 'supabase/migrations/262_Agent_Verified_Human_Identity.sql' }] })
  assert.deepEqual(r.violations.map((x) => x.code), ['MIGRATION.HISTORICAL_COLLISION'])
  assert.deepEqual(r.newMigrations, [])
})

test('V2 CHARACTERIZATION: the V2 router decides new-vs-existing from a human label; V3 does not (reproduced defect, V2 left unchanged)', () => {
  const plan = (files, modification) => planRouting({ task: 'tweak migration', files, modification })
  const stops = (p) => p.stop_conditions.map((s) => s.code)
  const approvals = (p) => p.human_approvals.map((a) => a.action)
  // existing migration 262 labeled `add` -> V2 treats it as a NEW forward-only migration (no STOP)
  const existingAsAdd = plan(['supabase/migrations/262_agent_verified_human_identity.sql'], 'add')
  assert.deepEqual(stops(existingAsAdd), [])
  assert.deepEqual(approvals(existingAsAdd), ['author_new_forward_only_migration'])
  // genuinely new 263 labeled `migration` or `edit` -> V2 reports a false STOP.EXISTING_MIGRATION
  assert.deepEqual(stops(plan(['supabase/migrations/263_new_thing.sql'], 'migration')), ['STOP.EXISTING_MIGRATION'])
  assert.deepEqual(stops(plan(['supabase/migrations/263_new_thing.sql'], 'edit')), ['STOP.EXISTING_MIGRATION'])
  // V3: same inputs, label-free, and the answers are the correct ones
  const base = ['supabase/migrations/262_agent_verified_human_identity.sql']
  const run = (changes) => classifyMigrationChanges({ directory: C.migrations.directory, filePattern: C.migrations.file_pattern, baseFiles: base, changes })
  assert.deepEqual(run([{ status: 'M', path: base[0] }]).violations.map((x) => x.code), ['MIGRATION.HISTORICAL_MODIFIED'])
  assert.deepEqual(run([{ status: 'A', path: 'supabase/migrations/263_new_thing.sql' }]).newMigrations, ['supabase/migrations/263_new_thing.sql'])
  assert.equal(classifyMigrationChanges.length, 1, 'the classifier takes exactly one argument object with no label field')
})

test('fact gathering fails closed on bad shas, unrelated history, a different origin and hostile environments', () => {
  const f = fixture()
  try {
    write(f.dir, 'apps/mobile/a.ts', 'export const a = 2\n')
    const head = commit(f.dir)
    const g = (over) => gatherCandidateFacts({ repoDir: f.dir, expectedRepository: REPO, baseSha: f.base, candidateSha: head, contract: C, ...over })
    assert.deepEqual(g({ candidateSha: 'HEAD' }).problems, ['FACTS.SHA_INVALID'])
    assert.deepEqual(g({ baseSha: 'a'.repeat(40) }).problems, ['FACTS.COMMIT_UNRESOLVED'])
    assert.deepEqual(g({ expectedRepository: 'not a repo' }).problems, ['FACTS.REPOSITORY_INVALID'])
    assert.deepEqual(g({ baseSha: head, candidateSha: f.base }).problems, ['FACTS.BASE_NOT_ANCESTOR'])
    assert.equal(g({ repoDir: path.join(f.dir, 'nope') }).ok, false)
    git(f.dir, 'remote', 'add', 'origin', 'https://github.com/someone-else/other.git')
    assert.deepEqual(g().problems, ['FACTS.ORIGIN_MISMATCH'])
    git(f.dir, 'remote', 'set-url', 'origin', `https://github.com/${REPO}.git`)
    assert.equal(g().facts.origin_matches, true)
    // an ambient GIT_DIR must not redirect fact gathering to some other repository
    const saved = process.env.GIT_DIR
    process.env.GIT_DIR = path.join(f.dir, 'does-not-exist')
    try { assert.equal(g().ok, true) } finally { if (saved === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = saved }
    const tooMany = { ...C, limits: { ...C.limits, max_changed_paths: 0 } }
    assert.deepEqual(g({ contract: tooMany }).problems, ['FACTS.TOO_MANY_CHANGES'])
  } finally { f.cleanup() }
})

test('fact gathering never runs a repository-configured external diff driver or textconv', () => {
  const f = fixture()
  try {
    const marker = path.join(f.dir, '..', `d32-marker-${path.basename(f.dir)}`).replace(/\\/g, '/')
    const script = path.join(os.tmpdir(), `d32-ext-${path.basename(f.dir)}.mjs`)
    writeFileSync(script, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'ran')\n`)
    git(f.dir, 'config', 'diff.external', `node ${script.replace(/\\/g, '/')}`)
    git(f.dir, 'config', 'diff.evil.textconv', `node ${script.replace(/\\/g, '/')}`)
    write(f.dir, '.gitattributes', '*.ts diff=evil\n')
    write(f.dir, 'apps/mobile/a.ts', 'export const a = 2\n')
    const head = commit(f.dir)
    const r = facts(f, head)
    assert.equal(r.ok, true)
    assert.equal(existsSync(marker), false, 'a repository-configured diff driver executed during fact gathering')
    rmSync(script, { force: true })
  } finally { f.cleanup() }
})

test('customer-agent tripwire input: added lines are gathered only for watched paths and are capped', () => {
  const f = fixture()
  try {
    write(f.dir, 'supabase/migrations/263_agent_flags.sql', 'UPDATE agent_execution_flags SET enabled = true;\n')
    write(f.dir, 'apps/mobile/b.ts', 'secret untracked-by-tripwire\n')
    const r = facts(f, commit(f.dir))
    assert.deepEqual(r.facts.added_lines, { 'supabase/migrations/263_agent_flags.sql': ['UPDATE agent_execution_flags SET enabled = true;'] })
  } finally { f.cleanup() }
})
