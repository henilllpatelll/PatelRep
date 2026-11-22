// Developer Harness V2 — Phase 3 instruction-accuracy tests (CLAUDE.md, OpenWolf protocol). Offline.
// Run: node --test scripts/developer-harness-v2/context/instructions.test.mjs
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..', '..')
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8')
const claude = read('CLAUDE.md')
const pkg = JSON.parse(read('package.json'))

test('CLAUDE.md no longer asserts a web-only scope and scopes work to the requested surface', () => {
  assert.doesNotMatch(claude, /web app only/i)
  assert.doesNotMatch(claude, /Do not touch `apps\/mobile\/` unless/)
  assert.match(claude, /Product surfaces: web \(`apps\/web\/`\), mobile \(`apps\/mobile\/`\), API \(`apps\/api\/`\) and infrastructure/)
  assert.match(claude, /Scope each task to the surface\(s\) the human's request names/)
  assert.match(claude, /Customer Agent Harness work .* separate from developer tooling/)
})

test('documented ports match the package.json scripts', () => {
  const apiPort = /--port (\d+)/.exec(pkg.scripts['dev:api'])[1]
  assert.equal(apiPort, '8003')
  assert.doesNotMatch(claude, /:8000\b/)
  const apiMentions = [...claude.matchAll(/dev:api`? \(port (\d{4})\)|dev:api\s+# FastAPI on :(\d{4})/g)].map((m) => m[1] ?? m[2])
  assert.ok(apiMentions.length >= 2, 'API port documented in Commands and Self-Verification')
  for (const p of apiMentions) assert.equal(p, apiPort)
  assert.match(claude, /dev:web`? \(:3000\)|dev:web\s+# Next\.js on :3000/)
})

test('framework versions stated in CLAUDE.md match the manifests', () => {
  const nextMajor = /(\d+)/.exec(JSON.parse(read('apps/web/package.json')).dependencies.next)[1]
  const stated = [...claude.matchAll(/Next\.js (\d+)/g)].map((m) => m[1])
  assert.ok(stated.length >= 2)
  for (const v of stated) assert.equal(v, nextMajor, `Next.js ${v} vs manifest ${nextMajor}`)
})

test('references to missing documentation are gone', () => {
  assert.doesNotMatch(claude, /REMAINING_WORK\.md/)
  for (const line of claude.split('\n').filter((l) => !/retired|previous mechanism/i.test(l))) {
    for (const m of line.matchAll(/`((?:docs|apps|scripts|\.github)\/[^`*<>\s]+\.(?:md|ya?ml|json))`/g)) {
      assert.ok(existsSync(path.join(REPO, m[1])), `CLAUDE.md references ${m[1]}`)
    }
  }
})

test('mandatory per-turn OpenWolf requirements are removed everywhere they load automatically', () => {
  assert.doesNotMatch(claude, /Read and follow \.wolf\/OPENWOLF\.md every session/)
  assert.doesNotMatch(claude, /Check \.wolf\/anatomy\.md before reading files/)
  assert.doesNotMatch(claude, /read `\.wolf\/cerebrum\.md` and `\.wolf\/anatomy\.md`/)
  const wolf = read('.wolf/OPENWOLF.md')
  const rule = read('.claude/rules/openwolf.md')
  for (const [name, text] of [['OPENWOLF.md', wolf], ['rules/openwolf.md', rule]]) {
    assert.doesNotMatch(text, /\(MANDATORY|These rules apply every turn|BEFORE reading any file|ALWAYS log|Before generating code, read/i, name)
    assert.doesNotMatch(text, /append a one-line entry to `?\.wolf\/memory\.md/i, name)
    assert.match(text, /authority|authorize/i, `${name} states the trust boundary`)
  }
  assert.match(wolf, /Routine Claude Code actions do \*\*not\*\* run OpenWolf hooks/)
  assert.match(wolf, /Do not start dev servers yourself/)
  assert.match(wolf, /Design QC \(explicit request only\)/)
  assert.match(wolf, /Reframe .*\(explicit request only\)/)
})

test('dev servers are human-started only; production-connected auto-start is not implied', () => {
  assert.doesNotMatch(claude, /Start the relevant dev server\(s\) if not already running/)
  assert.match(claude, /Dev servers are never started automatically/)
  assert.match(claude, /may point at production Supabase/)
})

test('human approval, protected infrastructure and safety instructions are preserved', () => {
  for (const needle of [
    'Never: alter Supabase migration history, use `supabase migration repair`',
    'Never automatically: merge PRs, enable auto-merge, bypass branch protection',
    '`merged`, `approved`, `done`, `looks good` do not authorize production',
    '### GitHub is the source of truth',
    '### Control-plane work (not normal features)',
    '### Release Engineer',
    '### `ready_for_human_review` — only when ALL hold',
    'Ready for human review. Test the feature in staging. If it looks correct, manually merge the PR.',
    '.eq("hotel_id", user.hotel_id)',
    '## Non-Regression Policy (MANDATORY)',
    'new forward-only migrations only, preserving RLS and tenant isolation',
  ]) assert.ok(claude.includes(needle), `kept: ${needle}`)
  assert.ok(read('AGENTS.md').includes('`CLAUDE.md` in the repository root is the **canonical**'), 'AGENTS.md redirect intact')
  assert.match(claude, /^@\.wolf\/OPENWOLF\.md$/m, 'AGENTS.md\'s "imported by CLAUDE.md" statement stays true')
})
