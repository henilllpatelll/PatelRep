import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const code = (source) => source.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n')
const workflow = read('.github/workflows/mobile-ci.yml')
const workflowCode = code(workflow)
const ci = read('.github/workflows/ci.yml')

const jobBlock = (name) => {
  const match = workflowCode.match(new RegExp(`^  ${name}:\\n((?: {4}.*\\n|\\n)+)`, 'm'))
  assert.ok(match, `job ${name} exists`)
  return match[1]
}

test('Mobile CI runs on push to main and every pull request to main, with no path filters', () => {
  assert.match(workflowCode, /^on:\n {2}push:\n {4}branches: \[main\]\n {2}pull_request:\n {4}branches: \[main\]\n {4}types: \[opened, synchronize, reopened\]\n/m)
  assert.doesNotMatch(workflowCode, /paths(-ignore)?:/)
  assert.doesNotMatch(workflowCode, /pull_request_target|workflow_run|workflow_dispatch|schedule:/)
})

test('Mobile CI is read-only and holds no secrets, environments or artifacts', () => {
  assert.match(workflowCode, /^permissions:\n {2}contents: read\n/m)
  assert.doesNotMatch(workflowCode, /^\s+[a-z-]+: write$/m)
  assert.doesNotMatch(workflowCode, /secrets\.|environment:|id-token|upload-artifact|download-artifact|github-script|create-github-app-token/)
  assert.doesNotMatch(workflowCode, /RAILWAY|SUPABASE|EXPO_TOKEN|eas |expo publish|eas update|git push|gh (pr|release|workflow)/i)
  assert.doesNotMatch(workflowCode, /continue-on-error:/)
})

test('Mobile CI uses only the pinned checkout and setup-node actions, without persisting credentials', () => {
  const uses = [...workflowCode.matchAll(/uses: (\S+)/g)].map((m) => m[1])
  assert.ok(uses.length > 0)
  for (const action of uses) assert.match(action, /^actions\/(checkout|setup-node)@v7$/)
  assert.equal(workflowCode.split('persist-credentials: false').length - 1, uses.filter((a) => a.startsWith('actions/checkout')).length)
})

test('every job is bounded and the checks run the real mobile commands', () => {
  const jobs = ['workflow-contract', 'type-check', 'lint', 'test']
  for (const name of jobs) assert.match(jobBlock(name), /^ {4}timeout-minutes: \d+$/m, `${name} has a timeout`)
  assert.match(jobBlock('type-check'), /run: cd apps\/mobile && npm ci\n/)
  assert.match(jobBlock('type-check'), /run: cd apps\/mobile && npm run type-check\n/)
  assert.match(jobBlock('lint'), /run: cd apps\/mobile && npm run lint\n/)
  assert.match(jobBlock('test'), /run: cd apps\/mobile && npx jest --ci --maxWorkers=2\n/)
  assert.match(jobBlock('workflow-contract'), /run: node --test scripts\/mobile-ci-workflow\.test\.mjs\n/)
  const names = [...workflowCode.matchAll(/^ {4}name: (.+)$/gm)].map((m) => m[1])
  assert.deepEqual(names, ['Mobile CI Workflow Contract', 'Mobile / Type-check', 'Mobile / Lint', 'Mobile / Jest'])
})

test('Jest flakiness is never hidden by retries, raised timeouts or forced exits', () => {
  assert.doesNotMatch(workflowCode, /--testTimeout|--forceExit|--bail|retryTimes|--detectOpenHandles|--no-cache|\|\| true|nick-fields\/retry/)
})

test('the existing gates are untouched: CI Gate does not depend on Mobile CI', () => {
  assert.doesNotMatch(ci, /Mobile CI|mobile-ci|Mobile \/ /)
  const gate = ci.match(/^ {2}ci-gate:\n[\s\S]*?^ {4}steps:/m)
  assert.ok(gate, 'ci-gate job found')
  assert.doesNotMatch(gate[0], /mobile/i)
})
