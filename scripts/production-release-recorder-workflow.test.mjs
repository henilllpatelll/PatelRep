import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { EVIDENCE_ARTIFACT, EVIDENCE_SCHEMA, RECORDER_PERMISSIONS, REQUIRED_SUCCESS_JOBS, SOURCE_WORKFLOW_PATH, TAG_JOB_NAME } from './production-release-recorder.mjs'

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const code = (source) => source.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n')
const release = read('.github/workflows/production-release.yml')
const record = read('.github/workflows/production-release-record.yml')
const recorder = read('scripts/production-release-recorder.mjs')
const deps = read('scripts/production-release-recorder-deps.mjs')
const docs = read('docs/RELEASE_RECORDING.md')

const jsCode = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n')
const jobSection = (source, name) => {
  const start = source.indexOf(`\n  ${name}:\n`)
  assert.ok(start >= 0, `job ${name} exists`)
  const next = source.slice(start + 1).search(/\n  [a-z-]+:\n/)
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next)
}
const jobName = (source, job) => jobSection(source, job).match(/\n {4}name: (.+)\n/)[1]
const recorderJobs = [
  ['production-release.yml', release, 'release-recording-preflight'],
  ['production-release.yml', release, 'tag-and-release'],
  ['production-release-record.yml', record, 'record'],
]

test('the recorder permission set is exactly contents + workflows write, and every token mint requests exactly that', () => {
  assert.deepEqual(RECORDER_PERMISSIONS, { contents: 'write', workflows: 'write' })
  for (const [file, source, job] of recorderJobs) {
    const section = jobSection(source, job)
    const mints = section.match(/uses: actions\/create-github-app-token@v3/g) ?? []
    assert.equal(mints.length, job === 'record' || job === 'tag-and-release' || job === 'release-recording-preflight' ? 1 : 0, `${file}:${job} mints one token`)
    const perms = [...section.matchAll(/^\s+permission-([a-z-]+): (\w+)$/gm)].map((m) => `${m[1]}:${m[2]}`).sort()
    assert.deepEqual(perms, ['contents:write', 'workflows:write'], `${file}:${job} requests only contents+workflows write`)
    assert.match(section, /client-id: \$\{\{ vars\.RELEASE_RECORDER_APP_CLIENT_ID \}\}/)
    assert.match(section, /private-key: \$\{\{ secrets\.RELEASE_RECORDER_APP_PRIVATE_KEY \}\}/)
    assert.doesNotMatch(section, /PATELREP_APP/, 'the existing PatelRep App is never reused for recording')
    assert.doesNotMatch(section, /owner:|repositories:/, 'defaults scope the token to this single repository')
  }
})

test('recorder credentials are scoped to the release-recording Environment and nowhere else', () => {
  for (const [file, source] of [['production-release.yml', release], ['production-release-record.yml', record]]) {
    const secretUsers = [...code(source).matchAll(/\n  ([a-z-]+):\n(?:(?!\n  [a-z-]+:\n)[\s\S])*?RELEASE_RECORDER_APP/g)].map((m) => m[1])
    for (const job of secretUsers) assert.match(jobSection(source, job), /environment: release-recording/, `${file}:${job} holds recorder credentials only inside release-recording`)
  }
  for (const other of ['.github/workflows/ci.yml', '.github/workflows/production-rollback.yml', '.github/workflows/staging-candidate.yml', '.github/workflows/claude-release-engineer.yml', '.github/workflows/production-release-audit.yml']) {
    assert.doesNotMatch(read(other), /RELEASE_RECORDER_APP/, `${other} has no access to recorder credentials`)
  }
  for (const [, source, job] of recorderJobs) {
    assert.doesNotMatch(jobSection(source, job), /environment: production|PRODUCTION_(RAILWAY|SUPABASE)|RAILWAY_API_TOKEN/, `${job} has no production credential`)
  }
})

test('the App token is only ever passed as TAG_TOKEN to the recorder script, after all read-only work, never to checkout or shell', () => {
  for (const [file, source, job] of recorderJobs) {
    const section = jobSection(source, job)
    assert.equal((section.match(/steps\.recorder-token\.outputs\.token/g) ?? []).length, 1, `${file}:${job} uses the token exactly once`)
    assert.match(section, /TAG_TOKEN: \$\{\{ steps\.recorder-token\.outputs\.token \}\}/)
    assert.doesNotMatch(section, /GH_TOKEN: \$\{\{ steps\.recorder-token/)
    assert.doesNotMatch(section, /github-token:|token: \$\{\{ steps/)
    assert.doesNotMatch(section, /echo[^\n]*TOKEN|set-output|::add-mask/)
    for (const use of section.matchAll(/uses: actions\/checkout@v7[\s\S]*?(?=\n {6}- )/g)) assert.match(use[0], /persist-credentials: false/, `${file}:${job} checkouts persist no credential`)
    assert.ok(section.indexOf('create-github-app-token') < section.lastIndexOf('production-release-recorder.mjs'), 'token is minted immediately before the recorder runs')
  }
})

test('recording cannot start unless production verification succeeded; deploys cannot start unless recording is possible', () => {
  const tag = jobSection(release, 'tag-and-release')
  assert.match(tag, /needs: \[resolve-and-verify-eligibility, compute-version, verify-production-release\]/)
  assert.match(tag, /needs\.verify-production-release\.result == 'success'/)
  assert.doesNotMatch(tag, /always\(\)/)

  const preflight = jobSection(release, 'release-recording-preflight')
  assert.match(preflight, /needs: resolve-and-verify-eligibility/)
  assert.match(preflight, /node scripts\/production-release-recorder\.mjs preflight/)
  assert.doesNotMatch(code(preflight), /\brecord\b|\brecover\b|createRef|gh release/, 'preflight writes nothing')
  assert.match(jobSection(release, 'production-db-migrate'), /needs\.release-recording-preflight\.result == 'success'/)
  const api = jobSection(release, 'deploy-api')
  assert.match(api, /needs: \[[^\]]*release-recording-preflight[^\]]*\]/)
  assert.match(api, /needs\.release-recording-preflight\.result == 'success'/)
  assert.ok(release.indexOf('release-recording-preflight:') < release.indexOf('production-db-migrate:'))
  assert.match(jobSection(release, 'production-release-evidence'), /- release-recording-preflight/)
})

test('the release workflow token is read-only by default; contents: write is confined to the tag job (Release creation)', () => {
  assert.match(release, /^permissions:\n {2}contents: read\n/m)
  assert.match(jobSection(release, 'tag-and-release'), /permissions:\n {6}contents: write\n {6}actions: read\n {6}checks: read/)
  assert.equal((code(release).match(/^\s+contents: write$/gm) ?? []).length, 1)
  assert.doesNotMatch(code(release), /^s+(workflows|id-token): write$/m)
})

test('trusted recorder code comes from the workflow commit, never from the release target', () => {
  for (const [file, source, job] of recorderJobs.filter((entry) => entry[2] !== 'release-recording-preflight')) {
    const section = jobSection(source, job)
    assert.match(section, /ref: \$\{\{ github\.sha \}\}\n\s+path: \.trusted-recorder\n\s+sparse-checkout: scripts/, `${file}:${job}`)
    assert.doesNotMatch(section, /node (?!\.\.?\/?\.trusted-recorder|\.trusted-recorder)(?:target\/)?scripts\//, `${file}:${job} runs no script from the target checkout`)
    assert.doesNotMatch(section, /node target\/|npm (ci|install|run)|npx |pip |bash target/, 'no target code executes')
  }
  assert.match(jobSection(release, 'release-recording-preflight'), /ref: \$\{\{ github\.sha \}\}\n\s+sparse-checkout: scripts/)
})

test('record-only recovery workflow: manual, main-only, shares the production lock, no production or deploy authority', () => {
  const c = code(record)
  assert.match(c, /^on:\n {2}workflow_dispatch:/m)
  assert.doesNotMatch(c, /schedule:|workflow_run:|pull_request|push:|repository_dispatch/)
  assert.match(c, /concurrency:\n {2}group: production-deploy\n {2}cancel-in-progress: false/)
  assert.match(c, /if: \$\{\{ github\.ref == 'refs\/heads\/main' \}\}/)
  assert.match(c, /^permissions:\n {2}contents: read\n {2}actions: read\n {2}checks: read/m)
  assert.doesNotMatch(c, /railway|supabase|psql|PRODUCTION_|gh workflow run|gh run rerun|gh run cancel|gh pr |auto-merge|git push/i)
  for (const input of ['version', 'release_sha', 'source_run_id']) assert.match(c, new RegExp(`${input}:\\n {8}description: [^\\n]*\\n {8}required: true\\n {8}type: string`))
  const record_ = jobSection(record, 'record')
  const order = ['Validate dispatch inputs', 'Prove exact release checkout', 'Build release notes', 'Verify record-only recovery evidence', 'Create Release Recorder GitHub App token', 'Re-verify and record']
  let at = -1
  for (const step of order) {
    const found = record_.indexOf(step)
    assert.ok(found > at, `${step} in order`)
    at = found
  }
  assert.match(record_, /production-release-recorder\.mjs verify/)
  assert.match(record_, /production-release-recorder\.mjs recover/)
  for (const key of ['RELEASE_VERSION: ${{ inputs.version }}', 'RELEASE_SHA: ${{ inputs.release_sha }}', 'SOURCE_RUN_ID: ${{ inputs.source_run_id }}']) assert.ok(record_.includes(key))
  assert.doesNotMatch(record_, /run: [^\n]*\$\{\{ inputs\./, 'dispatch inputs are never interpolated into shell; only passed through env')
})

test('recorder constants stay pinned to the real workflow job names, workflow path and evidence artifact', () => {
  assert.equal(SOURCE_WORKFLOW_PATH, '.github/workflows/production-release.yml')
  assert.equal(jobName(release, 'tag-and-release'), TAG_JOB_NAME)
  assert.deepEqual(
    ['resolve-and-verify-eligibility', 'deploy-api', 'deploy-web', 'verify-production-release'].map((job) => jobName(release, job)),
    [...REQUIRED_SUCCESS_JOBS],
  )
  assert.match(release, new RegExp(`name: ${EVIDENCE_ARTIFACT}\\n`))
  assert.match(read('scripts/production-release-evidence.mjs'), new RegExp(EVIDENCE_SCHEMA.replace(/\./g, '\\.')))
})

test('the recorder has no destructive or ref-moving capability', () => {
  const all = jsCode(recorder) + jsCode(deps)
  assert.doesNotMatch(all, /--method['", ]+(PATCH|PUT|DELETE)|-X['", ]+(PATCH|PUT|DELETE)|git push|update-ref|--force|git tag -[df]|deleteRef|updateRef|release delete|release edit|gh workflow|gh pr |merge|rerun|cancel/i)
  assert.equal((deps.match(/'--method', 'POST'/g) ?? []).length, 2, 'exactly the two ref-creating POSTs: git/tags and git/refs')
  assert.match(deps, /git\/tags/)
  assert.match(deps, /git\/refs/)
  assert.equal((deps.match(/gh\(\['release', 'create'/g) ?? []).length, 1)
  assert.match(deps, /'--verify-tag'/)
})

test('credentials in the dependency layer are never mixed: the App token only creates the tag', () => {
  const tagTokenUses = [...jsCode(deps).matchAll(/tagToken/g)].length
  assert.equal(tagTokenUses, 4) // parameter, readRecorderRepo (read), two POSTs
  const create = jsCode(deps).slice(jsCode(deps).indexOf('createAnnotatedTag'), jsCode(deps).indexOf('createRelease'))
  assert.equal((create.match(/tagToken/g) ?? []).length, 2)
  const rel = jsCode(deps).slice(jsCode(deps).indexOf('createRelease'))
  assert.match(rel, /releaseToken/)
  assert.doesNotMatch(rel, /tagToken/)
  assert.doesNotMatch(deps.slice(0, deps.indexOf('createAnnotatedTag')).replace(/readRecorderRepo[^\n]*\n/, ''), /gh\([^)]*tagToken\)/)
})

test('docs list every human configuration step and the safe v1.9.2 procedure', () => {
  for (const needle of [
    'PatelRep Release Recorder',
    'Contents: Read and write',
    'Workflows: Read and write',
    'Only on this account',
    'release-recording',
    'RELEASE_RECORDER_APP_CLIENT_ID',
    'RELEASE_RECORDER_APP_PRIVATE_KEY',
    'Selected branches',
    'v*',
    'Production Release Record',
    'v1.9.2',
    '8e4ee88b354360754d1134d62d81b8af370b0434',
    '38189513925',
    'Do not re-dispatch Production Release',
    'incident',
  ]) assert.ok(docs.toLowerCase().includes(needle.toLowerCase()), `docs mention ${needle}`)
})
