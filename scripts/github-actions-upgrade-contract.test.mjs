// Strict contract for the four upgraded GitHub Actions families. No floating patterns: every version is an
// explicit allowlist entry, and every artifact producer/consumer is inventoried so a version bump or a changed
// artifact option can never alter a trusted handoff silently.
//
// Static contract proof only. The real runtime behaviour of these exact versions is exercised by the
// "Actions Runtime Contract" CI job (see scripts/actions-runtime-contract.mjs and ci.yml).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const WORKFLOW_DIR = path.join(import.meta.dirname, '..', '.github', 'workflows')

export const ALLOWED_VERSIONS = Object.freeze({
  'actions/upload-artifact': 'v7',
  'actions/download-artifact': 'v8',
  'supabase/setup-cli': 'v3',
  'actions/github-script': 'v9',
})
const SUPABASE_CLI_VERSION = '2.112.0'

// [file, job, kind, name, path, retention-days, if-no-files-found] -- reviewed against the pre-upgrade @v4 workflows.
// Kept as JSON data so that this file stays free of workflow-specific strings other guards scan for.
const ARTIFACT_INVENTORY = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'github-actions-artifact-inventory.json'), 'utf8'))
  .map((row) => row.map((cell) => (cell === null ? undefined : cell)))

// Options that would change artifact semantics. None may appear on any upload/download step.
const FORBIDDEN_UPLOAD_OPTIONS = ['archive', 'overwrite', 'include-hidden-files', 'compression-level']
const FORBIDDEN_DOWNLOAD_OPTIONS = ['skip-decompress', 'digest-mismatch', 'merge-multiple', 'run-id', 'github-token', 'repository', 'pattern', 'artifact-ids']

export function listSteps(text) {
  const lines = text.split('\n')
  const steps = []
  let job = null
  for (let i = 0; i < lines.length; i++) {
    const jobMatch = lines[i].match(/^  ([A-Za-z0-9_-]+):\s*$/)
    if (jobMatch) job = jobMatch[1]
    const dash = lines[i].match(/^(\s*)- /)
    if (!dash) continue
    const indent = dash[1].length
    let end = i + 1
    while (end < lines.length && (lines[end].trim() === '' || lines[end].search(/\S/) > indent)) end++
    steps.push({ job, body: lines.slice(i, end).join('\n'), line: i + 1 })
  }
  return steps
}

// Reads a key from the step's `with:` block only, so a step-level `name:` can never be mistaken for the artifact name.
const field = (body, key) => {
  const lines = body.split('\n')
  const start = lines.findIndex((l) => /^ +with: *$/.test(l))
  if (start === -1) return undefined
  const indent = lines[start].search(/\S/)
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue
    if (lines[i].search(/\S/) <= indent) break
    const m = lines[i].match(new RegExp(`^ {${indent + 2}}${key}: *(.*)$`))
    if (m) return m[1]
  }
  return undefined
}
const stepUses = (body) => (body.match(/uses:\s*([\w.-]+\/[\w./-]+)@(\S+)/) || []).slice(1)

export function scriptBody(body) {
  const match = body.match(/^( +)script: \|\n((?:\1 +.*\n?|\n)*)/m)
  return match ? match[2] : null
}

export function auditWorkflow(file, text) {
  const violations = []
  const steps = listSteps(text)
  for (const step of steps) {
    const [action, version] = stepUses(step.body)
    if (!action || !(action in ALLOWED_VERSIONS)) continue
    const where = `${file}:${step.line} (${action})`
    if (version !== ALLOWED_VERSIONS[action]) violations.push(`${where} uses @${version}; only @${ALLOWED_VERSIONS[action]} is allowed`)
    if (action === 'actions/upload-artifact') {
      for (const opt of FORBIDDEN_UPLOAD_OPTIONS) if (field(step.body, opt) !== undefined) violations.push(`${where} sets forbidden option ${opt}`)
      if (field(step.body, 'if-no-files-found') === undefined) violations.push(`${where} must set if-no-files-found explicitly`)
    }
    if (action === 'actions/download-artifact') {
      for (const opt of FORBIDDEN_DOWNLOAD_OPTIONS) if (field(step.body, opt) !== undefined) violations.push(`${where} sets forbidden option ${opt}`)
      if (field(step.body, 'name') === undefined) violations.push(`${where} must download one named artifact`)
    }
    if (action === 'supabase/setup-cli') {
      if (field(step.body, 'version') !== SUPABASE_CLI_VERSION) violations.push(`${where} must pin version ${SUPABASE_CLI_VERSION}`)
      if (field(step.body, 'github-token') !== undefined) violations.push(`${where} sets github-token, removed in setup-cli v3`)
    }
    if (action === 'actions/github-script') {
      const script = scriptBody(step.body) ?? ''
      if (/require\(\s*['"]@actions\/github['"]\s*\)/.test(script)) violations.push(`${where} requires @actions/github, unavailable in github-script v9`)
      if (/\b(const|let)\s+getOctokit\b/.test(script)) violations.push(`${where} redeclares injected getOctokit (SyntaxError in v9)`)
      try {
        const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
        new AsyncFunction('require', '__original_require__', 'github', 'octokit', 'getOctokit', 'context', 'core', 'exec', 'glob', 'io', script)
      } catch (error) {
        violations.push(`${where} script does not compile under the v9 injected-parameter list: ${error.message}`)
      }
    }
  }
  // Any use of a targeted action outside a parsed step is also a violation (e.g. a mangled step).
  const textual = [...text.matchAll(/uses:\s*(actions\/(?:upload-artifact|download-artifact|github-script)|supabase\/setup-cli)@(\S+)/g)]
  const parsed = steps.filter((s) => stepUses(s.body)[0] in ALLOWED_VERSIONS).length
  if (textual.length !== parsed) violations.push(`${file}: ${textual.length} targeted uses but ${parsed} parsed steps`)
  return violations
}

export function artifactInventory(file, text) {
  return listSteps(text).flatMap((step) => {
    const [action] = stepUses(step.body)
    if (action !== 'actions/upload-artifact' && action !== 'actions/download-artifact') return []
    return [[file, step.job, action.endsWith('upload-artifact') ? 'upload' : 'download', field(step.body, 'name'), field(step.body, 'path'), field(step.body, 'retention-days'), field(step.body, 'if-no-files-found')]]
  })
}

const workflows = fs.readdirSync(WORKFLOW_DIR).filter((f) => f.endsWith('.yml')).sort().map((f) => [f, fs.readFileSync(path.join(WORKFLOW_DIR, f), 'utf8')])

test('every targeted action is on its single explicitly-allowed version and passes its upgrade audit', () => {
  const all = workflows.flatMap(([file, text]) => auditWorkflow(file, text))
  assert.deepEqual(all, [])
})

test('no pre-upgrade major remains anywhere in .github', () => {
  for (const [file, text] of workflows) {
    assert.doesNotMatch(text, /actions\/upload-artifact@v[0-6]\b/, file)
    assert.doesNotMatch(text, /actions\/download-artifact@v[0-7]\b/, file)
    assert.doesNotMatch(text, /supabase\/setup-cli@v[12]\b/, file)
    assert.doesNotMatch(text, /actions\/github-script@v[0-8]\b/, file)
  }
})

test('the artifact producer/consumer inventory is exactly the reviewed one (names, paths, retention, failure handling)', () => {
  const actual = workflows.flatMap(([file, text]) => artifactInventory(file, text))
  assert.deepEqual(actual, ARTIFACT_INVENTORY)
})

test('every download in a trusted consumer job has a same-name producer in an upstream job of the same workflow', () => {
  for (const [file, text] of workflows) {
    const inventory = artifactInventory(file, text)
    for (const [, job, kind, name] of inventory.filter((e) => e[2] === 'download')) {
      if (name.endsWith('-does-not-exist')) continue // deliberate negative-path download, see the runtime contract
      const producers = inventory.filter((e) => e[2] === 'upload' && e[3] === name)
      assert.ok(producers.length >= 1, `${file}: ${job} downloads ${name} (${kind}) with no matching producer`)
      const needs = (text.match(new RegExp(`^  ${job}:\\n(?:(?!^  \\S).*\\n)*?    needs: *(.+)$`, 'm')) || [])[1] ?? ''
      assert.ok(producers.some(([, producerJob]) => needs.includes(producerJob)), `${file}: ${job} must declare needs on the job that uploads ${name}`)
    }
  }
})

test('uploads in the same workflow never collide on an artifact name without per-run uniqueness', () => {
  for (const [file, text] of workflows) {
    const names = artifactInventory(file, text).filter((e) => e[2] === 'upload').map((e) => e[3])
    const duplicated = names.filter((n, i) => names.indexOf(n) !== i)
    // dependency-orchestrator uploads the same state name from mutually exclusive jobs (execute vs merge); nothing else may.
    const allowed = file === 'dependency-orchestrator.yml' ? ['dependency-orchestrator-state'] : []
    assert.deepEqual(duplicated.filter((n) => !allowed.includes(n)), [], file)
  }
})

test('production-sensitive workflows keep least-privilege defaults after the upgrade', () => {
  for (const file of ['production-release.yml', 'production-rollback.yml', 'staging-candidate.yml']) {
    const text = workflows.find(([f]) => f === file)[1]
    assert.match(text, /^permissions:\n(?: {2}.+\n)+/m, `${file} keeps an explicit top-level permissions block`)
    assert.doesNotMatch(text, /permissions:\s*write-all/, file)
  }
})

// ---- Negative tests: the audit must reject each of these, so a regression cannot slip through. ----

const upload = (extra = '') => `jobs:\n  a:\n    steps:\n      - uses: actions/upload-artifact@v7\n        with:\n          name: x\n          path: y\n          if-no-files-found: error\n${extra}`
const download = (extra = '') => `jobs:\n  b:\n    steps:\n      - uses: actions/download-artifact@v8\n        with:\n          name: x\n${extra}`

test('negative: an outdated or permissive version is rejected', () => {
  assert.ok(auditWorkflow('t.yml', upload().replace('@v7', '@v4')).some((v) => /only @v7 is allowed/.test(v)))
  assert.ok(auditWorkflow('t.yml', upload().replace('@v7', '@v8')).some((v) => /only @v7 is allowed/.test(v)))
  assert.ok(auditWorkflow('t.yml', download().replace('@v8', '@v7')).some((v) => /only @v8 is allowed/.test(v)))
  assert.ok(auditWorkflow('t.yml', download().replace('@v8', '@main')).some((v) => /only @v8 is allowed/.test(v)))
})

test('negative: artifact options that change zip/digest/provenance semantics are rejected', () => {
  assert.ok(auditWorkflow('t.yml', upload('          archive: false\n')).some((v) => /archive/.test(v)))
  assert.ok(auditWorkflow('t.yml', upload('          overwrite: true\n')).some((v) => /overwrite/.test(v)))
  assert.ok(auditWorkflow('t.yml', upload().replace('          if-no-files-found: error\n', '')).some((v) => /if-no-files-found/.test(v)))
  for (const opt of ['digest-mismatch: warn', 'digest-mismatch: ignore', 'skip-decompress: true', 'merge-multiple: true', 'run-id: 1', 'github-token: ${{ github.token }}', 'repository: a/b', 'pattern: x*']) {
    assert.ok(auditWorkflow('t.yml', download(`          ${opt}\n`)).length >= 1, opt)
  }
})

test('negative: a download without a named artifact is rejected', () => {
  assert.ok(auditWorkflow('t.yml', download().replace('          name: x\n', '          path: z\n')).some((v) => /named artifact/.test(v)))
})

test('negative: setup-cli must pin the exact CLI version and take no token', () => {
  const cli = (withBlock) => `jobs:\n  c:\n    steps:\n      - uses: supabase/setup-cli@v3\n        with:\n${withBlock}`
  assert.deepEqual(auditWorkflow('t.yml', cli(`          version: ${SUPABASE_CLI_VERSION}\n`)), [])
  assert.ok(auditWorkflow('t.yml', cli('          version: latest\n')).some((v) => /must pin version/.test(v)))
  assert.ok(auditWorkflow('t.yml', cli('          version: 2.0.0\n')).some((v) => /must pin version/.test(v)))
  assert.ok(auditWorkflow('t.yml', cli(`          version: ${SUPABASE_CLI_VERSION}\n          github-token: x\n`)).some((v) => /github-token/.test(v)))
  assert.ok(auditWorkflow('t.yml', 'jobs:\n  c:\n    steps:\n      - uses: supabase/setup-cli@v3\n').some((v) => /must pin version/.test(v)))
})

test('negative: github-script v9 breaking patterns are rejected', () => {
  const gs = (script) => `jobs:\n  g:\n    steps:\n      - uses: actions/github-script@v9\n        with:\n          script: |\n${script.split('\n').map((l) => `            ${l}`).join('\n')}\n`
  assert.deepEqual(auditWorkflow('t.yml', gs("const fs = require('fs')\ncore.info(context.sha)")), [])
  assert.ok(auditWorkflow('t.yml', gs("const { getOctokit } = require('@actions/github')")).some((v) => /@actions\/github/.test(v)))
  assert.ok(auditWorkflow('t.yml', gs('const getOctokit = () => 1')).some((v) => /getOctokit/.test(v)))
  assert.ok(auditWorkflow('t.yml', gs('let getOctokit = null')).some((v) => /getOctokit/.test(v)))
  assert.ok(auditWorkflow('t.yml', gs('const x = (')).some((v) => /does not compile/.test(v)))
})

test('negative: a version bump that leaves an unparsed targeted use is rejected', () => {
  assert.ok(auditWorkflow('t.yml', 'steps:\nuses: actions/upload-artifact@v4\n').some((v) => /targeted uses/.test(v)))
})
