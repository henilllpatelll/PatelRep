import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workflow = readFileSync(new URL('../.github/workflows/autonomous-feature-builder.yml', import.meta.url), 'utf8')

function jobSection(name) {
  const marker = `  ${name}:\n`
  const start = workflow.indexOf(marker)
  assert.notEqual(start, -1, `missing job ${name}`)
  const rest = workflow.slice(start + marker.length)
  const next = rest.search(/\n  [a-zA-Z0-9_-]+:\n/)
  return next === -1 ? workflow.slice(start) : workflow.slice(start, start + marker.length + next)
}

test('feature builder is manual-only and starts from exact main', () => {
  assert.match(workflow, /workflow_dispatch:/)
  assert.doesNotMatch(workflow, /\npush:/)
  assert.doesNotMatch(workflow, /\npull_request:/)
  assert.match(jobSection('resolve'), /test "\$GITHUB_REF" = refs\/heads\/main/)
  assert.match(jobSection('resolve'), /test "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA"/)
})

test('coding agent has read-only repository authority and cannot publish or deploy', () => {
  const build = jobSection('build')
  assert.match(workflow, /permissions:\n  contents: read\n  actions: read\n  pull-requests: read/)
  assert.match(build, /github_token: \$\{\{ github\.token \}\}/)
  for (const denied of ['git push', 'git commit', 'gh pr create', 'gh pr merge', 'gh workflow', 'railway:', 'supabase:', 'psql;']) {
    assert.match(build, new RegExp(denied.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.doesNotMatch(build, /PATELREP_APP_PRIVATE_KEY/)
  assert.doesNotMatch(build, /environment:\s*production/)
})

test('only trusted publish job receives the GitHub App write token', () => {
  const resolve = jobSection('resolve')
  const build = jobSection('build')
  const publish = jobSection('publish')
  assert.doesNotMatch(resolve, /create-github-app-token/)
  assert.doesNotMatch(build, /create-github-app-token/)
  assert.match(publish, /actions\/create-github-app-token@v3/)
  assert.match(publish, /PATELREP_APP_CLIENT_ID/)
  assert.match(publish, /PATELREP_APP_PRIVATE_KEY/)
  assert.match(publish, /publish-feature-builder-change\.mjs/)
})

test('workflow contains no merge or production mutation path', () => {
  assert.match(jobSection('build'), /Bash\(gh pr merge:\*\)/, 'merge command must be explicitly denied to the agent')
  assert.doesNotMatch(workflow, /run:\s*gh pr merge/)
  assert.doesNotMatch(workflow, /merge_pull_request/)
  assert.doesNotMatch(workflow, /production-release\.yml/)
  assert.doesNotMatch(workflow, /production-rollback\.yml/)
  assert.doesNotMatch(workflow, /environment:\s*production/)
  assert.doesNotMatch(workflow, /railway up/)
  assert.doesNotMatch(workflow, /supabase db/)
})

test('publisher receives exact provenance and only a captured patch artifact', () => {
  const publish = jobSection('publish')
  assert.match(publish, /BASE_SHA: \$\{\{ needs\.resolve\.outputs\.base_sha \}\}/)
  assert.match(publish, /FEATURE_BRANCH: \$\{\{ needs\.resolve\.outputs\.branch \}\}/)
  assert.match(publish, /FEATURE_RUN_ID: \$\{\{ github\.run_id \}\}/)
  assert.match(publish, /actions\/download-artifact@v4/)
  assert.match(publish, /name: feature-builder-output/)
})
