// Developer Harness V2 — Phase 8 workflow-contract guard.
//
// Runs inside the EXISTING `Verify release workflow contracts` step of the `Release Workflow Contract` job (NOT inside the harness
// step it guards). It is a TRIPWIRE against accidental or unnoticed weakening, not a security boundary: under `pull_request` a PR's
// own ci.yml and this file both run, so one PR could edit both. Human review of .github/** and scripts/** remains the backstop.
// It pins, against baselines taken from main eb597d55 (independent of the catalog this phase edits):
//   * the workflow preamble and top-level keys (no workflow-wide `defaults:` / `env:` / `permissions:`), triggers and concurrency;
//   * the exact harness step (command, timeout, no if/continue-on-error/env/shell) and its position after the existing step;
//   * the whole approved Phase 8 `release-workflow-contract` job block, byte-for-byte (sha256, LF-normalized), uniquely identified —
//     so alternate YAML spellings (`"if":`, `if :`, `? if`, flow mappings) or shell backgrounding cannot slip past the key readers;
//   * canonical YAML key spelling file-wide and an interpretable job structure (fail closed otherwise);
//   * the ENTIRE approved ci.yml by sha256 (future ci.yml changes need a separately reviewed pin update), and — independently —
//     exactly the approved job ids/names, each unique, every job a plain 4-space block mapping, and no extra `permissions` or
//     `CI Gate` identity in any spelling;
//   * the existing release-contract list as an ordered, digest-pinned prefix (nothing removed or reordered) plus this guard;
//   * the whole CI Gate job, byte-for-byte (sha256), and — by executing the real gate script, also with GITHUB_ACTIONS/CI set — that a
//     failed, cancelled, skipped or empty Release Workflow Contract or any other failed baseline check blocks the gate;
//   * no new permissions, secrets, environments or jobs renamed; the expected-skip allowlist and the harness test set.
// Every rule is also proven by a disposable in-memory mutation of ci.yml that must be rejected. Nothing on GitHub is touched.
// Run: node --test scripts/developer-harness-v2-ci-workflow.test.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { ALLOWED_SKIPS, BASELINE_SUITE_IDS } from './developer-harness-v2/ci/run-ci-suites.mjs'
import { SUITES } from './developer-harness-v2/testing/catalog.mjs'
import { HARNESS_ALL } from './developer-harness-v2/testing/rules.mjs'

const normalize = (t) => t.replace(/\r\n?/g, '\n') // CRLF and lone CR are both YAML line breaks
const CI_TEXT = normalize(readFileSync('.github/workflows/ci.yml', 'utf8'))
const GUARD = 'scripts/developer-harness-v2-ci-workflow.test.mjs'
const RUNNER = 'scripts/developer-harness-v2/ci/run-ci-suites.mjs'
const HARNESS_STEP = { name: 'Run Developer Harness V2 contract and security regression suites', 'timeout-minutes': '30', run: `node ${RUNNER}` }

// ── Baselines from main eb597d55 (literal on purpose) ─────────────────────────────────────────────────────────────────────────
// The 67-file release-contract list, pinned as an ORDERED prefix by digest (names are not repeated here: other contract tests scan
// scripts/*.mjs for some of those names). sha256 of the 67 tokens joined by single spaces, from main eb597d55.
const BASELINE_RELEASE_COUNT = 67
const BASELINE_RELEASE_SHA256 = '7c9f6443809b44048ede7f9392cb06580128a7a30d975db25f8ac94e6bfab42f'
/** sha256 of the whole `ci-gate` job block at eb597d55 (CI Gate is unchanged by Phase 8; any edit to it must be re-reviewed). */
const BASELINE_GATE_BLOCK_SHA256 = '49333cd7de5dbf7d6bce9a43437d4acbf46c1e9c9158ef81a52a06002961ba5a'
/**
 * sha256 of the whole approved Phase 8 `release-workflow-contract` job block (LF line endings; from its `  release-workflow-contract:`
 * head up to, not including, the next job head): eb597d55's checkout / Node 22 / contract step plus this phase's guard entry and
 * harness step. A regression tripwire, NOT a security boundary — a PR that edits this guard and ci.yml together can re-pin it.
 */
const BASELINE_RELEASE_BLOCK_SHA256 = '18ce2d137e477547611f1b96ea32004a620c2e2a89e53026afbc741644a2d282'
/**
 * sha256 of the ENTIRE approved Phase 8 ci.yml (LF line endings) — the content reviewed at 3f9e9667, literal on purpose (never derived
 * from the checkout). Any legitimate future change to ci.yml must come with a separately reviewed update of this pin. Like the block
 * pins it is a regression tripwire, NOT a security boundary against a change authorized to edit both ci.yml and this guard; the
 * structural checks below stay in force independently of it.
 */
const BASELINE_WORKFLOW_SHA256 = 'ab4011f9e3ec0b14ad08452b8902f07beaaae1b3cc3a652589fd5e2550377018'
/** Baseline counts of words that grant or identify authority (any case, any YAML spelling): `permissions`, and `CI Gate` / `ci-gate`. */
const BASELINE_PERMISSIONS_WORDS = 3
const BASELINE_CI_GATE_WORDS = 6
/** Keys whose effect on execution matters; they must never appear in a flow mapping (`{"if": false}`) anywhere in the file. */
const EXEC_KEYS = 'if|permissions|environment|continue-on-error|shell|defaults|env|secrets|needs|uses|run|runs-on|timeout-minutes|with|strategy|container|services|steps'
const BASELINE_JOBS = {
  'lint-api': 'Lint / API', 'lint-web': 'Lint + Type-check / Web', 'build-web': 'Build / Web', 'test-web-public-smoke': 'Test / Web public smoke',
  'test-api': 'Test / API', 'database-migration-gate': 'Database Migration Gate', 'test-unit-web': 'Test / Web unit', 'feature-flag-registry-gate': 'Feature Flag Registry Gate',
  'frozen-guard': 'Frozen-File Guard', contrast: 'Dark-Mode Contrast Gate', 'i18n-parity': 'EN/ES i18n Parity', 'room-board-regression': 'Room-Board Pixel-Diff Regression',
  'room-board-hermetic': 'Room-Board Hermetic Visual Regression', security: 'Security Scan', 'release-workflow-contract': 'Release Workflow Contract',
  'actions-runtime-contract-produce': 'Actions Runtime Contract / produce', 'actions-runtime-contract-consume': 'Actions Runtime Contract / consume',
  'supabase-cli-apply-contract': 'Supabase CLI Apply Contract', 'ci-gate': 'CI Gate', 'pr-comment': 'PR Status',
}
/** CI Gate wiring at baseline: env var -> needed job id -> required check name (the Room-Board live gate has its own Dependabot rule). */
const BASELINE_GATE = [
  ['LINT_API', 'lint-api', 'Lint / API'], ['LINT_WEB', 'lint-web', 'Lint + Type-check / Web'], ['BUILD_WEB', 'build-web', 'Build / Web'],
  ['TEST_WEB_PUBLIC_SMOKE', 'test-web-public-smoke', 'Test / Web public smoke'], ['TEST_API', 'test-api', 'Test / API'],
  ['DATABASE_MIGRATION_GATE', 'database-migration-gate', 'Database Migration Gate'], ['SECURITY_SCAN', 'security', 'Security Scan'],
  ['TEST_UNIT_WEB', 'test-unit-web', 'Test / Web unit'], ['FEATURE_FLAG_REGISTRY_GATE', 'feature-flag-registry-gate', 'Feature Flag Registry Gate'],
  ['FROZEN_GUARD', 'frozen-guard', 'Frozen-File Guard'], ['CONTRAST', 'contrast', 'Dark-Mode Contrast Gate'], ['I18N_PARITY', 'i18n-parity', 'EN/ES i18n Parity'],
  ['ROOM_BOARD_HERMETIC', 'room-board-hermetic', 'Room-Board Hermetic Visual Regression'], ['RELEASE_WORKFLOW_CONTRACT', 'release-workflow-contract', 'Release Workflow Contract'],
  ['SUPABASE_CLI_APPLY_CONTRACT', 'supabase-cli-apply-contract', 'Supabase CLI Apply Contract'],
  ['ACTIONS_RUNTIME_PRODUCE', 'actions-runtime-contract-produce', 'Actions Runtime Contract / produce'],
  ['ACTIONS_RUNTIME_CONSUME', 'actions-runtime-contract-consume', 'Actions Runtime Contract / consume'],
]
const ROOM_BOARD_RULES = [
  'if [ "$EVENT_NAME" = "pull_request" ] && [ "$PR_AUTHOR" = "dependabot[bot]" ]; then',
  'required_checks+=("Room-Board Pixel-Diff Regression (skipped for Dependabot):$ROOM_BOARD_REGRESSION:skipped")',
  'required_checks+=("Room-Board Pixel-Diff Regression:$ROOM_BOARD_REGRESSION:success")',
  "if: github.event_name != 'pull_request' || github.event.pull_request.user.login != 'dependabot[bot]'",
]
const BASELINE_HEADER = `on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
    types: [opened, synchronize, reopened]

concurrency:
  group: ci-\${{ github.ref }}
  cancel-in-progress: true
`
/** The only baseline occurrence of the word "secrets" that is not a `secrets.<NAME>` reference (a YAML comment in room-board-regression). */
const SECRETS_PROSE_LINE = '\n      # configured as repo secrets — globalSetup fails loudly (not a silent\n'
const BASELINE_SECRETS = ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'PLAYWRIGHT_BASE_URL', 'REGRESSION_GM_EMAIL', 'REGRESSION_GM_PASSWORD', 'REGRESSION_SUP_EMAIL', 'REGRESSION_SUP_PASSWORD']
const BASELINE_PERMISSIONS = { 'actions-runtime-contract-produce': 'contents: read', 'actions-runtime-contract-consume': 'actions: read|checks: read|contents: read', 'pr-comment': 'pull-requests: write' }
const BASELINE_HARNESS_FILES = `contract policy-engine policy-hook m1-hardening copymove-remediation path-resolution runtime-sandbox-env context/archive context/context-packs
context/instructions context/memory-curate context/openwolf-hooks routing/roles routing/router coordination/coordination evaluation/usage-import
evaluation/evaluation testing/catalog testing/changes testing/select testing/runner testing/checklist testing/evaluate`.split(/\s+/).map((x) => `scripts/developer-harness-v2/${x}.test.mjs`)
/** Independent copy of the approved expected-skip allowlist (file, name, nesting, reason). */
const PINNED_ALLOWED_SKIPS = [
  ['scripts/developer-harness-v2/context/archive.test.mjs', 'manifest entries match the source commit blobs (when history is available)', 0, 'source commit not in local history'],
  ['scripts/developer-harness-v2/context/archive.test.mjs', 'only approved paths were untracked relative to the source commit', 0, 'source commit not in local history'],
  ['scripts/developer-harness-v2/context/memory-curate.test.mjs', 'old-to-new mapping re-derived from the source blob (when available in local history)', 0, 'source blob 8cccb11b944e not in local history (shallow clone)'],
  ['scripts/developer-harness-v2/context/openwolf-hooks.test.mjs', 'simulated session: Phase 2 baseline hooks wrote tracked .wolf files; the Phase 3 hooks write nothing', 0, 'Phase 2 settings not in local history'],
  ['scripts/developer-harness-v2/context/openwolf-hooks.test.mjs', 'enforcement and hook source files are byte-identical to Phase 2; graphify auto_update untouched', 0, 'Phase 2 commit not in local history'],
]

// ── Minimal, strict structure readers for this workflow's layout ──────────────────────────────────────────────────────────────
const uncomment = (t) => t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
function jobs(text) {
  const body = text.slice(text.indexOf('\njobs:\n') + 7)
  const heads = [...body.matchAll(/^ {2}([a-z0-9-]+):\n/gm)]
  return Object.fromEntries(heads.map((m, i) => [m[1], body.slice(m.index, heads[i + 1]?.index ?? body.length)]))
}
const jobKeys = (block) => [...block.matchAll(/^ {4}([a-z-]+):/gm)].map((m) => m[1])
const jobName = (block) => /^ {4}name: (.+)$/m.exec(block)?.[1].trim()
function steps(block) {
  const s = block.indexOf('\n    steps:\n')
  if (s < 0) return []
  return uncomment(block.slice(s + 12)).split(/^ {6}- /m).slice(1).map((chunk) => {
    const keys = {}
    for (const [i, l] of chunk.split('\n').entries()) {
      const m = i === 0 ? /^([a-z-]+):\s*(.*)$/.exec(l) : /^ {8}([a-z-]+):\s*(.*)$/.exec(l)
      if (m) keys[m[1]] = m[2]
    }
    return { keys, text: chunk }
  })
}
function permissionsByJob(text) {
  const out = {}
  for (const [id, block] of Object.entries(jobs(text))) {
    const m = /^ {4}permissions:[ \t]*(.*)\n((?: {6}.+\n)*)/m.exec(block)
    if (m) out[id] = m[1].trim() || m[2].trim().split('\n').map((l) => l.trim()).sort().join('|')
  }
  return out
}
function gateScript(block) {
  const run = block.indexOf('        run: |\n')
  return run < 0 ? '' : block.slice(run + 15).split('\n').filter((l) => l === '' || l.startsWith('          ')).map((l) => l.slice(10)).join('\n')
}
function runGate(script, env) {
  const all = Object.fromEntries(BASELINE_GATE.map(([v]) => [v, 'success']))
  // Run as a GitHub Actions runner would see it too, so a gate that behaves differently under CI cannot pass the guard.
  const r = spawnSync('bash', ['-c', script], { env: { PATH: process.env.PATH, CI: 'true', GITHUB_ACTIONS: 'true', RUNNER_TEMP: '/tmp', ...all, ROOM_BOARD_REGRESSION: 'success', EVENT_NAME: 'pull_request', PR_AUTHOR: 'someone', ...env }, encoding: 'utf8' })
  return r.status === 0
}
const sha256 = (s) => createHash('sha256').update(s).digest('hex')

/** Every violated rule (stable codes). An empty list means the workflow keeps the baseline and runs the harness step as approved. */
function checkWorkflow(raw) {
  const p = []
  const text = normalize(raw)
  // Fail closed when the line-oriented readers below cannot be trusted to see what a YAML parser sees (review MEDIUM).
  if (/[\x85\u2028\u2029\uFEFF]/.test(text)) p.push('STRUCTURE_UNINTERPRETABLE') // YAML 1.1 line breaks / BOM
  const jobsAt = text.indexOf('\njobs:\n')
  if (jobsAt < 0 || text.indexOf('\njobs:\n', jobsAt + 1) >= 0) p.push('STRUCTURE_UNINTERPRETABLE')
  // Lines indented 1–3 spaces under `jobs:` can only be job keys (block-scalar content is always deeper): each must be a canonical head.
  if (text.slice(jobsAt + 7).split('\n').some((l) => /^ {1,3}[^\s#]/.test(l) && !/^ {2}[a-z0-9-]+:$/.test(l))) p.push('STRUCTURE_UNINTERPRETABLE')
  // Canonical key spelling only, file-wide: no explicit `? key` / `: value` entries, quoted block keys or whitespace before the colon,
  // and no execution key inside a flow mapping. The baseline has none of these (also not inside run/script blocks).
  if (/^\s*(?:-\s+)?[?:](?:\s|$)/m.test(text)) p.push('YAML_NONCANONICAL_KEY')
  if (/^\s*(?:-\s+)?(?:"[^"\n]*"|'[^'\n]*')\s*:(?:\s|$)/m.test(text)) p.push('YAML_NONCANONICAL_KEY')
  if (/^\s*(?:-\s+)?[A-Za-z_][\w-]*\s+:(?:\s|$)/m.test(text)) p.push('YAML_NONCANONICAL_KEY')
  if (new RegExp(String.raw`[{,]\s*(?:\?\s*)?["']?(?:${EXEC_KEYS})["']?\s*:`).test(text)) p.push('YAML_NONCANONICAL_KEY')
  if (/^permissions:/m.test(text)) p.push('TOP_LEVEL_PERMISSIONS')
  // Workflow-wide keys (`defaults:`, `env:`, `permissions:` …) anywhere at column 0, or anything before `on:`, would reach every job.
  const topLevel = text.split('\n').filter((l) => /^[^\s#]/.test(l)).map((l) => /^([A-Za-z_][\w-]*):/.exec(l)?.[1] ?? `<${l.slice(0, 20)}>`)
  if (topLevel.join() !== 'name,on,concurrency,jobs' || !text.startsWith('name: CI\n\non:\n')) p.push('TOP_LEVEL_KEYS_CHANGED')
  if (text.slice(text.indexOf('\non:\n') + 1, text.indexOf('\njobs:\n') + 1) !== `${BASELINE_HEADER}\n`) p.push('TRIGGERS_OR_CONCURRENCY_CHANGED')
  if (/^\s+environment:/m.test(text)) p.push('ENVIRONMENT_ADDED')
  if (/secrets:\s*inherit/.test(text)) p.push('SECRETS_INHERITED')
  // Allowlist, not denylist, and no expression parsing to fool: GitHub expressions are case-insensitive and have many forms
  // (`secrets[...]`, `toJSON(secrets)`, `secrets.*` …), can sit on `#`-looking lines inside `run: |` blocks, and can contain `}}`
  // inside string literals. So EVERY occurrence of the word `secrets` in the RAW file, in any letter case, must be exactly
  // `secrets.<one of the baseline names>`, except the single baseline prose comment pinned verbatim below (expected exactly once).
  // The set of names used must still equal the baseline.
  const prose = text.split(SECRETS_PROSE_LINE)
  if (prose.length !== 2) p.push('SECRETS_CHANGED')
  const rest = prose.join('\n')
  const exact = new RegExp(`^secrets\\.(${BASELINE_SECRETS.join('|')})(?![A-Za-z0-9_])`)
  const words = [...rest.matchAll(/\bsecrets\b/gi)].map((m) => exact.exec(rest.slice(m.index, m.index + 80))?.[1] ?? null)
  if (words.some((n) => n === null)) p.push('SECRETS_CHANGED')
  if ([...new Set(words.filter(Boolean))].sort().join() !== BASELINE_SECRETS.join()) p.push('SECRETS_CHANGED')
  // Independent re-review L1f: YAML double-quoted scalars decode escapes (`\x73ecrets`, an escaped line join) BEFORE GitHub
  // evaluates the expression, so the raw scan above would not see the word. The baseline has none, so reject any backslash in a
  // double-quoted scalar (block or flow position) and any double-quoted scalar left open at the end of its line (multi-line).
  // An optional YAML anchor/tag may sit before the quote (`X: &a "\x73…"`, `X: !!str "…"`): allowed for in both rules (review L1g).
  // Both rules accept the quote directly after `:` or `,` with no space (JSON-style flow pairs `{"X":"…`, `["a","…`) — whether
  // GitHub's parser accepts every such form is deliberately not assumed (final review LOW).
  const props = String.raw`(?:[&!][^\s"]*\s+)*`
  if (new RegExp(String.raw`(?:^\s*-|:|[[{,])\s*${props}"[^"\n]*\\`, 'm').test(text) || new RegExp(String.raw`(?:^\s*-|:|[[{,])\s*${props}"[^"\n]*$`, 'm').test(text)) p.push('YAML_DOUBLE_QUOTED_ESCAPE')
  // Stricter still: the baseline uses no YAML anchors, aliases or tags at all, so any node property is rejected (review L1g).
  if (/(?:^\s*-|:)[ \t]+[&*!][^\s=]/m.test(text)) p.push('YAML_NODE_PROPERTY')
  const perms = permissionsByJob(text)
  if (JSON.stringify(Object.entries(perms).sort()) !== JSON.stringify(Object.entries(BASELINE_PERMISSIONS).sort())) p.push('PERMISSIONS_CHANGED')
  if ((text.match(/continue-on-error:/g) ?? []).length !== 1 || !/continue-on-error: true/.test(jobs(text)['actions-runtime-contract-consume'] ?? '')) p.push('CONTINUE_ON_ERROR_CHANGED')
  if (sha256(text) !== BASELINE_WORKFLOW_SHA256) p.push('WORKFLOW_CHANGED')
  const all = jobs(text)
  for (const [id, name] of Object.entries(BASELINE_JOBS)) if (jobName(all[id] ?? '') !== name) p.push(`JOB_MISSING_OR_RENAMED:${id}`)
  // Strict job integrity, independent of the whole-file pin (review mediums A and B), fail closed:
  // exactly the approved job ids, in order, each declared once; …
  const heads = [...text.slice(jobsAt + 7).matchAll(/^ {2}([a-z0-9-]+):$/gm)].map((m) => m[1])
  if (heads.join() !== Object.keys(BASELINE_JOBS).join()) p.push('JOB_SET_CHANGED')
  if (new Set(heads).size !== heads.length) p.push('DUPLICATE_JOB_ID')
  // … every job body a plain block mapping at exactly 4 spaces that starts with `name:` (no flow mapping, no other indentation),
  // with no line indented 5 spaces outside a block scalar — so the 4-space key readers see every job-level key;
  for (const [id, block] of Object.entries(all)) {
    const body = block.split('\n').slice(1).filter((l) => l.trim() !== '' && !/^\s*#/.test(l))
    if (!/^ {4}name: \S/.test(body[0] ?? '') || body.some((l) => !/^ {4}/.test(l) || /^ {5}[^ ]/.test(l))) p.push(`JOB_BODY_NONCANONICAL:${id}`)
  }
  // … displayed names unique and exactly the approved ones;
  const names = Object.values(all).map((b) => [...b.matchAll(/^ {4}name: (.+)$/gm)].map((m) => m[1].trim())).flat()
  if (new Set(names).size !== names.length) p.push('DUPLICATE_JOB_NAME')
  if (JSON.stringify([...names].sort()) !== JSON.stringify(Object.values(BASELINE_JOBS).sort())) p.push('JOB_NAMES_CHANGED')
  // … and, whatever the spelling or position (quoted, flow, folded across lines, another indent), no extra `permissions` grant and no
  // second `CI Gate` identity anywhere in the file. (Escaped double-quoted spellings are rejected by YAML_DOUBLE_QUOTED_ESCAPE.)
  if ((text.match(/permissions/gi) ?? []).length !== BASELINE_PERMISSIONS_WORDS) p.push('PERMISSIONS_CHANGED')
  if ((text.match(/c\s*i[\s_-]*gate/gi) ?? []).length !== BASELINE_CI_GATE_WORDS || (text.match(/\bname\b["']?\s*:\s*["']?\s*CI\s*Gate/gi) ?? []).length !== 1) p.push('DUPLICATE_JOB_NAME')
  for (const rule of ROOM_BOARD_RULES) if (!text.includes(rule)) p.push('DEPENDABOT_RULE_CHANGED')

  // Release Workflow Contract: exactly checkout, Node 22, the existing contract step, then the harness step.
  const rel = all['release-workflow-contract'] ?? ''
  // The whole approved block, byte-for-byte, found exactly once (the id also appears only in CI Gate's pinned `needs` and env).
  if ((text.match(/^ {2}release-workflow-contract:$/gm) ?? []).length !== 1 || (text.match(/release-workflow-contract/g) ?? []).length !== 3) p.push('RELEASE_BLOCK_NOT_UNIQUE')
  if (sha256(rel) !== BASELINE_RELEASE_BLOCK_SHA256) p.push('RELEASE_BLOCK_CHANGED')
  if (jobKeys(rel).sort().join() !== 'name,runs-on,steps' || !/^ {4}runs-on: ubuntu-latest$/m.test(rel)) p.push('RELEASE_JOB_KEYS')
  // Exit-status masking, plus backgrounding (`& wait`, a lone `&`), `wait` and line continuations that could hide the runner's status.
  if (/\|\||set \+e|;\s*true\b|\bexit 0\b|2>\s*\/dev\/null|(?<!&)&(?!&)|\bwait\b|\\$/m.test(uncomment(rel))) p.push('RELEASE_JOB_MASKING')
  const st = steps(rel)
  if (st.length !== 4) p.push('RELEASE_STEP_COUNT')
  if (st[0]?.keys.uses !== 'actions/checkout@v7' || Object.keys(st[0]?.keys ?? {}).join() !== 'uses') p.push('RELEASE_CHECKOUT')
  if (st[1]?.keys.uses !== 'actions/setup-node@v7' || !/^ {10}node-version: "22"$/m.test(st[1]?.text ?? '')) p.push('RELEASE_NODE_VERSION')
  const verify = st[2]
  if (verify?.keys.name !== 'Verify release workflow contracts' || Object.keys(verify.keys).sort().join() !== 'name,run') p.push('RELEASE_VERIFY_STEP')
  const tokens = (verify?.keys.run ?? '').split(/\s+/).filter(Boolean)
  const files = tokens.slice(2)
  if (tokens[0] !== 'node' || tokens[1] !== '--test' || !files.every((x) => /^scripts\/[a-z0-9-]+\.test\.mjs$/.test(x)) || new Set(files).size !== files.length) p.push('RELEASE_VERIFY_COMMAND')
  if (files.length < BASELINE_RELEASE_COUNT || sha256(files.slice(0, BASELINE_RELEASE_COUNT).join(' ')) !== BASELINE_RELEASE_SHA256) p.push('RELEASE_LIST_BASELINE_CHANGED')
  if (!files.includes(GUARD)) p.push('GUARD_NOT_IN_EXISTING_STEP')
  const h = st[3]
  if (!h || JSON.stringify(Object.entries(h.keys).sort()) !== JSON.stringify(Object.entries(HARNESS_STEP).sort())) p.push('HARNESS_STEP_NOT_EXACT')
  if (st.filter((s) => (s.keys.run ?? '').includes('run-ci-suites')).length !== 1 || (text.match(/run-ci-suites\.mjs/g) ?? []).length !== 1) p.push('HARNESS_STEP_NOT_UNIQUE')

  // CI Gate: always runs, needs and wires every baseline job, requires every baseline check, and actually fails on a bad result.
  const gate = all['ci-gate'] ?? ''
  if (sha256(gate) !== BASELINE_GATE_BLOCK_SHA256) p.push('GATE_BLOCK_CHANGED') // step keys (if/shell/env), script text, needs — all of it
  if (!/^ {4}if: \$\{\{ always\(\) \}\}$/m.test(gate)) p.push('GATE_NOT_ALWAYS')
  const needs = [...(gate.match(/^ {4}needs:\n((?: {6}- .+\n)+)/m)?.[1] ?? '').matchAll(/- (.+)/g)].map((m) => m[1].trim())
  for (const [v, job, check] of BASELINE_GATE) {
    if (!needs.includes(job)) p.push(`GATE_NEED_MISSING:${job}`)
    if (!gate.includes(`          ${v}: \${{ needs.${job}.result }}\n`)) p.push(`GATE_RESULT_NOT_WIRED:${job}`)
    if (!gate.includes(`            "${check}:$${v}"\n`)) p.push(`GATE_CHECK_NOT_REQUIRED:${check}`)
  }
  if (!needs.includes('room-board-regression') || !gate.includes('          ROOM_BOARD_REGRESSION: ${{ needs.room-board-regression.result }}\n')) p.push('GATE_NEED_MISSING:room-board-regression')
  const script = gateScript(gate)
  if (!runGate(script, {})) p.push('GATE_REJECTS_ALL_GREEN')
  for (const bad of ['failure', 'cancelled', 'skipped', '']) if (runGate(script, { RELEASE_WORKFLOW_CONTRACT: bad })) p.push(`GATE_ACCEPTS_RELEASE_CONTRACT_${bad || 'EMPTY'}`)
  for (const [v] of BASELINE_GATE) if (runGate(script, { [v]: 'failure' })) p.push(`GATE_ACCEPTS_FAILED:${v}`)
  return [...new Set(p)]
}

// ── Tests ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('the shipped ci.yml satisfies every Phase 8 rule against the eb597d55 baseline', () => {
  assert.equal(BASELINE_GATE.length, 17)
  assert.deepEqual(checkWorkflow(CI_TEXT), [])
  assert.ok(existsSync(RUNNER), 'the runner the step invokes exists')
})

const mutate = (from, to) => { assert.ok(CI_TEXT.includes(from), `mutation anchor present: ${from.slice(0, 60)}`); return CI_TEXT.replace(from, to) }
const STEP = `      - name: ${HARNESS_STEP.name}\n        timeout-minutes: 30\n        run: node ${RUNNER}\n`
const MUTATIONS = {
  'harness step removed': [STEP, '', 'HARNESS_STEP_NOT_EXACT'],
  'continue-on-error on the harness step': [STEP, STEP.replace('        timeout-minutes', '        continue-on-error: true\n        timeout-minutes'), 'CONTINUE_ON_ERROR_CHANGED'],
  'if: false on the harness step': [STEP, STEP.replace('        timeout-minutes', '        if: false\n        timeout-minutes'), 'HARNESS_STEP_NOT_EXACT'],
  'if: always() on the harness step': [STEP, STEP.replace('        timeout-minutes', "        if: ${{ always() }}\n        timeout-minutes"), 'HARNESS_STEP_NOT_EXACT'],
  'exit status suppressed with || true': [`run: node ${RUNNER}`, `run: node ${RUNNER} || true`, 'RELEASE_JOB_MASKING'],
  'exit status suppressed with ; exit 0': [`run: node ${RUNNER}`, `run: node ${RUNNER}; exit 0`, 'RELEASE_JOB_MASKING'],
  'runner swapped for another command': [`run: node ${RUNNER}`, 'run: node scripts/developer-harness-v2/contract.test.mjs', 'HARNESS_STEP_NOT_EXACT'],
  'runner given a narrowing argument': [`run: node ${RUNNER}`, `run: node ${RUNNER} --only harness.contract`, 'HARNESS_STEP_NOT_EXACT'],
  'step timeout removed': ['        timeout-minutes: 30\n', '', 'HARNESS_STEP_NOT_EXACT'],
  'shell override added': [STEP, STEP.replace('        run:', '        shell: bash {0}\n        run:'), 'HARNESS_STEP_NOT_EXACT'],
  'harness step duplicated': [`      - name: Verify release workflow contracts\n`, `${STEP}      - name: Verify release workflow contracts\n`, 'HARNESS_STEP_NOT_UNIQUE'],
  'guard dropped from the existing step': [` ${GUARD}\n`, '\n', 'GUARD_NOT_IN_EXISTING_STEP'],
  'baseline release test dropped': [' scripts/security-scan-contract.test.mjs', '', 'RELEASE_LIST_BASELINE_CHANGED'],
  'baseline release tests reordered': ['scripts/feature-builder.test.mjs scripts/feature-builder-workflow.test.mjs', 'scripts/feature-builder-workflow.test.mjs scripts/feature-builder.test.mjs', 'RELEASE_LIST_BASELINE_CHANGED'],
  // Independent review M1: weakenings inside the CI Gate step itself.
  'gate step skipped with if: false': ['      - name: Require every release check to succeed\n', '      - name: Require every release check to succeed\n        if: false\n', 'GATE_BLOCK_CHANGED'],
  'gate step shell overridden': ['      - name: Require every release check to succeed\n', '      - name: Require every release check to succeed\n        shell: bash -c "exit 0" {0}\n', 'GATE_BLOCK_CHANGED'],
  'gate exits early only on a real runner': ['          required_checks=(\n', '          if [ -n "$GITHUB_ACTIONS" ]; then exit 0; fi\n          required_checks=(\n', 'GATE_ACCEPTS_RELEASE_CONTRACT_failure'],
  // Independent review M2: workflow-wide keys outside the on:…jobs: window.
  'workflow-wide defaults before on:': ['name: CI\n\non:\n', 'name: CI\n\ndefaults:\n  run:\n    shell: bash -c "exit 0" {0}\n\non:\n', 'TOP_LEVEL_KEYS_CHANGED'],
  'workflow-wide env before on:': ['name: CI\n\non:\n', 'name: CI\nenv:\n  NODE_OPTIONS: --import=./x.mjs\n\non:\n', 'TOP_LEVEL_KEYS_CHANGED'],
  // Independent review L1: other secret expression forms.
  'secret via index expression': [STEP, `${STEP}        env:\n          X: \${{ secrets['RAILWAY_TOKEN'] }}\n`, 'SECRETS_CHANGED'],
  'all secrets via toJSON': [STEP, `${STEP}        env:\n          X: \${{ toJSON(secrets) }}\n`, 'SECRETS_CHANGED'],
  // Independent re-review L1b: expressions are case-insensitive.
  'secret via upper-case context': [STEP, `${STEP}        env:\n          X: \${{ SECRETS.RAILWAY_TOKEN }}\n`, 'SECRETS_CHANGED'],
  'secret via mixed-case index': [STEP, `${STEP}        env:\n          X: \${{ Secrets['RAILWAY_TOKEN'] }}\n`, 'SECRETS_CHANGED'],
  'baseline secret re-spelled in another case': ['secrets.PLAYWRIGHT_BASE_URL', 'Secrets.PLAYWRIGHT_BASE_URL', 'SECRETS_CHANGED'],
  'all secrets via upper-case toJSON': [STEP, `${STEP}        env:\n          X: \${{ toJSON(SECRETS) }}\n`, 'SECRETS_CHANGED'],
  // Independent re-review L1c: object-filter form, and a baseline name used as a prefix of a longer one.
  'all secret values via object filter': [STEP, `${STEP}        env:\n          X: \${{ join(secrets.*, ',') }}\n`, 'SECRETS_CHANGED'],
  'baseline name as a prefix': ['secrets.PLAYWRIGHT_BASE_URL', 'secrets.PLAYWRIGHT_BASE_URL_2', 'SECRETS_CHANGED'],
  // Independent re-review L1d: a `#` line inside a run block is script content and is still expanded by GitHub.
  'secrets expanded on a comment-looking script line': ['        run: |\n          psql --set ON_ERROR_STOP=1 --single-transaction', "        run: |\n          # ${{ toJSON(secrets) }}\n          psql --set ON_ERROR_STOP=1 --single-transaction", 'SECRETS_CHANGED'],
  // Independent re-review L1e / I-if: `}}` inside a string literal, a multi-line if:, and a second copy of the pinned prose line.
  'secrets after a string-literal }}': [STEP, `${STEP}        env:\n          X: \${{ format('}}{0}', toJSON(secrets)) }}\n`, 'SECRETS_CHANGED'],
  'secret in a multi-line if:': ['    name: Release Workflow Contract\n', "    name: Release Workflow Contract\n    if: >-\n      secrets.X != ''\n", 'SECRETS_CHANGED'],
  'pinned prose line duplicated to hide a reference': ['    runs-on: ubuntu-latest\n    timeout-minutes: 25\n', `    runs-on: ubuntu-latest\n    timeout-minutes: 25\n${SECRETS_PROSE_LINE.slice(1)}`, 'SECRETS_CHANGED'],
  // Independent re-review L1f: escapes in YAML double-quoted scalars hide the word from a raw scan.
  'secrets spelled with a YAML \\x escape': [STEP, `${STEP}        env:\n          X: "\${{ toJSON(\\x73ecrets) }}"\n`, 'YAML_DOUBLE_QUOTED_ESCAPE'],
  'secrets split by an escaped YAML line join': [STEP, `${STEP}        env:\n          X: "\${{ toJSON(sec\\\n            rets) }}"\n`, 'YAML_DOUBLE_QUOTED_ESCAPE'],
  'secrets spelled with a YAML \\u escape': [STEP, `${STEP}        env:\n          X: "\${{ toJSON(\\u0073ecrets) }}"\n`, 'YAML_DOUBLE_QUOTED_ESCAPE'],
  // Independent re-review L1g: a YAML anchor or tag before the opening quote.
  'escape behind a YAML anchor': [STEP, `${STEP}        env:\n          X: &a "\\x73ecrets"\n`, 'YAML_DOUBLE_QUOTED_ESCAPE'],
  'escape behind a YAML tag': [STEP, `${STEP}        env:\n          X: !!str "\\x73ecrets"\n`, 'YAML_DOUBLE_QUOTED_ESCAPE'],
  'YAML anchor/alias introduced': [STEP, `${STEP}        env:\n          X: &a "\${{ github.sha }}"\n          Y: *a\n`, 'YAML_NODE_PROPERTY'],
  'secrets escaped in a flow sequence item': [STEP, `${STEP}        env:\n          X: [ "\\x73ecrets" ]\n`, 'YAML_DOUBLE_QUOTED_ESCAPE'],
  'secret in a bare if: expression': ['    if: github.event_name != \'pull_request\' || github.event.pull_request.user.login != \'dependabot[bot]\'\n', "    if: (github.event_name != 'pull_request' || github.event.pull_request.user.login != 'dependabot[bot]') && secrets.X != ''\n", 'SECRETS_CHANGED'],
  'job-level continue-on-error': ['    name: Release Workflow Contract\n', '    name: Release Workflow Contract\n    continue-on-error: true\n', 'RELEASE_JOB_KEYS'],
  'job-level if': ['    name: Release Workflow Contract\n', "    name: Release Workflow Contract\n    if: github.actor == 'nobody'\n", 'RELEASE_JOB_KEYS'],
  'job permissions broadened': ['    name: Release Workflow Contract\n', '    name: Release Workflow Contract\n    permissions:\n      contents: write\n', 'PERMISSIONS_CHANGED'],
  'top-level write-all permissions': ['\njobs:\n', '\npermissions: write-all\n\njobs:\n', 'TOP_LEVEL_PERMISSIONS'],
  'secret handed to the harness step': [STEP, `${STEP}        env:\n          TOKEN: \${{ secrets.RAILWAY_TOKEN }}\n`, 'SECRETS_CHANGED'],
  'environment binding added': ['    name: Release Workflow Contract\n', '    name: Release Workflow Contract\n    environment: staging\n', 'ENVIRONMENT_ADDED'],
  'Node version changed': ['          node-version: "22"\n      - name: Verify release workflow contracts', '          node-version: "20"\n      - name: Verify release workflow contracts', 'RELEASE_NODE_VERSION'],
  'workflow_dispatch trigger added': ['  pull_request:\n    branches: [main]\n', '  workflow_dispatch:\n  pull_request:\n    branches: [main]\n', 'TRIGGERS_OR_CONCURRENCY_CHANGED'],
  'release contract removed from CI Gate needs': ['      - release-workflow-contract\n', '', 'GATE_NEED_MISSING:release-workflow-contract'],
  'release contract removed from required checks': ['            "Release Workflow Contract:$RELEASE_WORKFLOW_CONTRACT"\n', '', 'GATE_CHECK_NOT_REQUIRED:Release Workflow Contract'],
  'release contract result unwired': ['RELEASE_WORKFLOW_CONTRACT: ${{ needs.release-workflow-contract.result }}', 'RELEASE_WORKFLOW_CONTRACT: success', 'GATE_RESULT_NOT_WIRED:release-workflow-contract'],
  'gate exit status forced to 0': ['          exit "$failed"\n', '          exit 0\n', 'GATE_ACCEPTS_RELEASE_CONTRACT_failure'],
  'gate accepts skipped results': ['            if [ "$result" != "$expected" ]; then', '            if [ "$result" != "$expected" ] && [ "$result" != "skipped" ]; then', 'GATE_ACCEPTS_RELEASE_CONTRACT_skipped'],
  'another baseline check dropped from the gate': ['            "Security Scan:$SECURITY_SCAN"\n', '', 'GATE_CHECK_NOT_REQUIRED:Security Scan'],
  'migration gate removed from needs': ['      - database-migration-gate\n', '', 'GATE_NEED_MISSING:database-migration-gate'],
  'gate no longer always runs': ['    if: ${{ always() }}\n', '', 'GATE_NOT_ALWAYS'],
  'Dependabot exception widened': ['[ "$PR_AUTHOR" = "dependabot[bot]" ]; then', '[ -n "$PR_AUTHOR" ]; then', 'DEPENDABOT_RULE_CHANGED'],
  'a baseline job renamed': ['    name: Database Migration Gate\n', '    name: Database Migration Gate (optional)\n', 'JOB_MISSING_OR_RENAMED:database-migration-gate'],
}

test('every weakening of the harness step, the existing contract step or CI Gate is rejected (disposable in-memory mutations)', () => {
  for (const [label, [from, to, code]] of Object.entries(MUTATIONS)) {
    const problems = checkWorkflow(mutate(from, to))
    assert.ok(problems.includes(code), `${label}: expected ${code}, got [${problems.join(', ')}]`)
  }
  // Moving the step ahead of the existing one (so a failing existing step could no longer be "after" it) changes the step order.
  const moved = CI_TEXT.replace(STEP, '').replace('      - name: Verify release workflow contracts\n', `${STEP}      - name: Verify release workflow contracts\n`)
  assert.notEqual(moved, CI_TEXT)
  assert.ok(checkWorkflow(moved).includes('HARNESS_STEP_NOT_EXACT'))
  assert.ok(checkWorkflow(moved).includes('RELEASE_VERIFY_STEP'))
  // Independent review M2: a workflow-wide key appended after the last job.
  assert.ok(checkWorkflow(`${CI_TEXT}\ndefaults:\n  run:\n    shell: bash -c "exit 0" {0}\n`).includes('TOP_LEVEL_KEYS_CHANGED'))
  assert.ok(checkWorkflow(`${CI_TEXT}\nenv:\n  NODE_OPTIONS: --import=./x.mjs\n`).includes('TOP_LEVEL_KEYS_CHANGED'))
})

// Final review MEDIUM + both LOWs: alternate YAML spellings, backgrounding, JSON-style flow pairs. [label, mutated text, codes, oldBypass]
// `oldBypass` marks the reproduced original bypasses: with only the pre-hardening rules they produced no problem at all.
const NEW_CODES = new Set(['RELEASE_BLOCK_CHANGED', 'RELEASE_BLOCK_NOT_UNIQUE', 'YAML_NONCANONICAL_KEY', 'STRUCTURE_UNINTERPRETABLE', 'WORKFLOW_CHANGED'])
const OTHER = '        run: cd apps/web && npm audit --audit-level=high\n'
const withEnv = (envLines) => mutate(OTHER, `${OTHER}        env:\n${envLines}`)
const JOB_HEAD = '    name: Release Workflow Contract\n'
const HARDENING = [
  ['"if": false on the harness step', mutate(STEP, STEP.replace('        timeout-minutes', '        "if": false\n        timeout-minutes')), ['RELEASE_BLOCK_CHANGED', 'YAML_NONCANONICAL_KEY'], true],
  ['if : false on the harness step', mutate(STEP, STEP.replace('        timeout-minutes', '        if : false\n        timeout-minutes')), ['RELEASE_BLOCK_CHANGED', 'YAML_NONCANONICAL_KEY'], true],
  ['explicit ? if / : false on the harness step', mutate(STEP, STEP.replace('        timeout-minutes', '        ? if\n        : false\n        timeout-minutes')), ['RELEASE_BLOCK_CHANGED', 'YAML_NONCANONICAL_KEY'], true],
  ["quoted 'continue-on-error' on the harness step", mutate(STEP, STEP.replace('        timeout-minutes', "        'continue-on-error': true\n        timeout-minutes")), ['RELEASE_BLOCK_CHANGED', 'YAML_NONCANONICAL_KEY']],
  ['quoted "if" at job level', mutate(JOB_HEAD, `${JOB_HEAD}    "if": false\n`), ['RELEASE_BLOCK_CHANGED', 'YAML_NONCANONICAL_KEY']],
  ['quoted "permissions" at job level', mutate(JOB_HEAD, `${JOB_HEAD}    "permissions":\n      contents: write\n`), ['RELEASE_BLOCK_CHANGED', 'YAML_NONCANONICAL_KEY']],
  ["quoted 'environment' at job level", mutate(JOB_HEAD, `${JOB_HEAD}    'environment': staging\n`), ['RELEASE_BLOCK_CHANGED', 'YAML_NONCANONICAL_KEY']],
  ['quoted "environment" in another job', mutate('    name: Security Scan\n', '    name: Security Scan\n    "environment": production\n'), ['YAML_NONCANONICAL_KEY']],
  ['harness step as a JSON-style flow mapping with "if"', mutate(STEP, `      - {"name": "${HARNESS_STEP.name}", "if": false, "timeout-minutes": 30, "run": "node ${RUNNER}"}\n`), ['RELEASE_BLOCK_CHANGED', 'YAML_NONCANONICAL_KEY']],
  ['quoted duplicate job key appended', `${CI_TEXT}  "release-workflow-contract":\n    name: Release Workflow Contract\n    runs-on: ubuntu-latest\n`, ['RELEASE_BLOCK_NOT_UNIQUE', 'STRUCTURE_UNINTERPRETABLE']],
  // LOW 1: backgrounding / continuation that could conceal the runner's exit status.
  ['runner backgrounded with & wait', mutate(`run: node ${RUNNER}`, `run: node ${RUNNER} & wait`), ['RELEASE_BLOCK_CHANGED', 'RELEASE_JOB_MASKING']],
  ['runner backgrounded in a block scalar', mutate(`run: node ${RUNNER}\n`, `run: |\n          node ${RUNNER} &\n          wait\n`), ['RELEASE_BLOCK_CHANGED', 'RELEASE_JOB_MASKING']],
  ['runner line continued', mutate(`run: node ${RUNNER}\n`, `run: |\n          node ${RUNNER} \\\n            --help\n`), ['RELEASE_BLOCK_CHANGED', 'RELEASE_JOB_MASKING']],
  ['existing contract step backgrounded', mutate(` ${GUARD}\n`, ` ${GUARD} & wait\n`), ['RELEASE_BLOCK_CHANGED', 'RELEASE_JOB_MASKING']],
  // Exactness of the pin: a trailing space, a comment edit, a lone CR that YAML reads as a line break.
  ['trailing space in the block', mutate(`run: node ${RUNNER}\n`, `run: node ${RUNNER} \n`), ['RELEASE_BLOCK_CHANGED']],
  ['comment in the block edited', mutate('      # Developer Harness V2 (Phase 8)', '      # Developer Harness V2 (Phase 8, edited)'), ['RELEASE_BLOCK_CHANGED']],
  ['lone CR splits a line', mutate(`run: node ${RUNNER}\n`, `run: node ${RUNNER}\r        if: false\n`), ['RELEASE_BLOCK_CHANGED']],
  ['U+2028 line separator', mutate(`run: node ${RUNNER}\n`, `run: node ${RUNNER}\u2028\n`), ['STRUCTURE_UNINTERPRETABLE']],
  // LOW 2: JSON-style flow pairs, the quote directly after `:` or `,` (escape, or a quote left open to the next line).
  ['escape directly after : in a flow pair', withEnv('          X: {"A":"\\x73ecrets"}\n'), ['YAML_DOUBLE_QUOTED_ESCAPE']],
  ['escape directly after , in a flow sequence', withEnv('          X: ["a","\\x73ecrets"]\n'), ['YAML_DOUBLE_QUOTED_ESCAPE']],
  ['escape in a second flow pair', withEnv('          X: {"A":"x","B":"\\u0073ecrets"}\n'), ['YAML_DOUBLE_QUOTED_ESCAPE']],
  ['open quote directly after : continues on the next line', withEnv('          X: {"A":"open\n            rest"}\n'), ['YAML_DOUBLE_QUOTED_ESCAPE']],
  ['open quote directly after , continues on the next line', withEnv('          X: ["a","open\n            rest"]\n'), ['YAML_DOUBLE_QUOTED_ESCAPE']],
]

test('alternate YAML key spellings, backgrounding and JSON-style flow pairs are rejected; the release job block is pinned exactly', () => {
  assert.deepEqual(checkWorkflow(CI_TEXT.replace(/\n/g, '\r\n')), [], 'CRLF line endings are normalized, not rejected')
  for (const [label, text, codes, oldBypass] of HARDENING) {
    assert.notEqual(text, CI_TEXT, label)
    const problems = checkWorkflow(text)
    for (const code of codes) assert.ok(problems.includes(code), `${label}: expected ${code}, got [${problems.join(', ')}]`)
    if (oldBypass) assert.deepEqual(problems.filter((c) => !NEW_CODES.has(c)), [], `${label}: reproduces the original bypass of the pre-hardening rules`)
  }
})

// Final review mediums A (job permissions missed at other indents / in flow mappings) and B (a second job displayed as `CI Gate`).
const GATE_HEAD = '  ci-gate:\n'
const addJob = (job) => mutate(GATE_HEAD, `${job}\n${GATE_HEAD}`)
const JOB_INTEGRITY = [
  ['new job with permissions: statuses: write', addJob('  extra:\n    name: Extra\n    runs-on: ubuntu-latest\n    permissions:\n      statuses: write\n    steps:\n      - run: echo hi\n'), ['WORKFLOW_CHANGED', 'JOB_SET_CHANGED', 'PERMISSIONS_CHANGED']],
  ['new job with permissions: checks: write', addJob('  extra:\n    name: Extra\n    runs-on: ubuntu-latest\n    permissions:\n      checks: write\n    steps:\n      - run: echo hi\n'), ['WORKFLOW_CHANGED', 'JOB_SET_CHANGED', 'PERMISSIONS_CHANGED']],
  ['new job body at 6-space indent with write-all (reproduced bypass)', addJob('  extra:\n      name: Extra\n      runs-on: ubuntu-latest\n      permissions: write-all\n      steps:\n        - run: echo hi\n'), ['WORKFLOW_CHANGED', 'JOB_SET_CHANGED', 'JOB_BODY_NONCANONICAL:extra', 'PERMISSIONS_CHANGED']],
  ['new job as a commented flow mapping with write-all (reproduced bypass)', addJob('  extra:\n    { # a\n      name: Extra, # b\n      permissions: write-all, # c\n      runs-on: ubuntu-latest, # d\n      steps: [ { # e\n        run: echo hi } ] }\n'), ['WORKFLOW_CHANGED', 'JOB_SET_CHANGED', 'JOB_BODY_NONCANONICAL:extra', 'PERMISSIONS_CHANGED']],
  ['new job at 6-space indent posting statuses', addJob('  extra:\n      name: Extra\n      runs-on: ubuntu-latest\n      permissions:\n        statuses: write\n      steps:\n        - run: gh api repos/x/statuses/y -f context="CI Gate" -f state=success\n'), ['JOB_SET_CHANGED', 'JOB_BODY_NONCANONICAL:extra', 'PERMISSIONS_CHANGED', 'DUPLICATE_JOB_NAME']],
  ['existing job gains a flow-mapped permission', mutate('    name: Lint / API\n', '    name: Lint / API\n    permissions: {statuses: write}\n'), ['WORKFLOW_CHANGED', 'PERMISSIONS_CHANGED']],
  ['existing job gains a permission at 5-space indent', mutate('    name: Lint / API\n', '    name: Lint / API\n     permissions: write-all\n'), ['WORKFLOW_CHANGED', 'JOB_BODY_NONCANONICAL:lint-api', 'PERMISSIONS_CHANGED']],
  ['additional job displayed as CI Gate (reproduced bypass)', addJob('  ci-gate-shadow:\n    name: CI Gate\n    runs-on: ubuntu-latest\n    needs: [ci-gate]\n    if: ${{ always() }}\n    steps:\n      - run: echo ok\n'), ['WORKFLOW_CHANGED', 'JOB_SET_CHANGED', 'DUPLICATE_JOB_NAME']],
  ['additional job displayed as quoted "CI Gate"', addJob('  extra:\n    name: "CI Gate"\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n'), ['JOB_SET_CHANGED', 'DUPLICATE_JOB_NAME', 'JOB_NAMES_CHANGED']],
  ['additional job displayed as CI Gate via a folded scalar', addJob('  extra:\n    name: >-\n      CI\n      Gate\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n'), ['JOB_SET_CHANGED', 'DUPLICATE_JOB_NAME']],
  ['existing job renamed to CI Gate', mutate('    name: PR Status\n', "    name: 'CI Gate'\n"), ['WORKFLOW_CHANGED', 'DUPLICATE_JOB_NAME', 'JOB_NAMES_CHANGED']],
  ['duplicate ci-gate job id', `${CI_TEXT}  ci-gate:\n    name: Gate copy\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n`, ['WORKFLOW_CHANGED', 'JOB_SET_CHANGED', 'DUPLICATE_JOB_ID']],
  ['double-quoted job id', addJob('  "extra":\n    name: Extra\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n'), ['WORKFLOW_CHANGED', 'STRUCTURE_UNINTERPRETABLE']],
  ["single-quoted copy of the ci-gate id", addJob("  'ci-gate':\n    name: Extra\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n"), ['WORKFLOW_CHANGED', 'STRUCTURE_UNINTERPRETABLE', 'DUPLICATE_JOB_NAME']],
  ['job id outside the canonical alphabet', addJob('  Extra_Job.1:\n    name: Extra\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n'), ['WORKFLOW_CHANGED', 'STRUCTURE_UNINTERPRETABLE']],
  ['job id as an explicit ? key', addJob('  ? extra\n  :\n    name: Extra\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n'), ['WORKFLOW_CHANGED', 'STRUCTURE_UNINTERPRETABLE', 'YAML_NONCANONICAL_KEY']],
  // Whole-file pin: harmless-looking edits anywhere that no structural rule objects to are still rejected.
  ['comment edited in an unrelated job', mutate('    # the credential-free Room-Board Hermetic job below', '    # the credential-free Room-Board Hermetic job, below'), ['WORKFLOW_CHANGED']],
  ['blank line added between jobs', mutate(GATE_HEAD, `\n${GATE_HEAD}`), ['WORKFLOW_CHANGED']],
  ['unrelated step command changed', mutate('run: cd apps/web && npm audit --audit-level=high', 'run: cd apps/web && npm audit --audit-level=critical'), ['WORKFLOW_CHANGED']],
]

test('job identity and permissions are strict and the whole approved ci.yml is pinned (final mediums A and B)', () => {
  // The legitimate CI Gate and Release Workflow Contract are unchanged and the shipped file passes.
  const shipped = jobs(CI_TEXT)
  assert.equal(sha256(CI_TEXT), BASELINE_WORKFLOW_SHA256)
  assert.equal(sha256(shipped['ci-gate']), BASELINE_GATE_BLOCK_SHA256)
  assert.equal(sha256(shipped['release-workflow-contract']), BASELINE_RELEASE_BLOCK_SHA256)
  assert.deepEqual(checkWorkflow(CI_TEXT), [])
  for (const [label, text, codes] of JOB_INTEGRITY) {
    assert.notEqual(text, CI_TEXT, label)
    const problems = checkWorkflow(text)
    for (const code of codes) assert.ok(problems.includes(code), `${label}: expected ${code}, got [${problems.join(', ')}]`)
  }
})

test('the approved expected-skip allowlist is pinned exactly', () => {
  assert.deepEqual(ALLOWED_SKIPS.map((a) => [a.file, a.name, a.nesting, a.reason]), PINNED_ALLOWED_SKIPS)
})

test('the harness registry still covers every baseline suite and test file, and this phase\'s runner test', () => {
  const harness = SUITES.filter((s) => s.id.startsWith('harness.'))
  const files = harness.flatMap((s) => s.steps[0].files)
  for (const id of ['harness.contract', 'harness.policy', 'harness.context', 'harness.routing', 'harness.coordination', 'harness.evaluation', 'harness.testing']) {
    assert.ok(HARNESS_ALL.includes(id) && harness.some((s) => s.id === id) && BASELINE_SUITE_IDS.includes(id), id)
  }
  for (const f of [...BASELINE_HARNESS_FILES, 'scripts/developer-harness-v2/ci/ci-integration.test.mjs']) assert.equal(files.filter((x) => x === f).length, 1, f)
})
