import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workflow = readFileSync(new URL('../../../.github/workflows/feature-rollout.yml', import.meta.url), 'utf8')
const code = workflow.replace(/^\s*#.*$/gm, '')

function stepBlock(nameFragment) {
  const start = code.indexOf(`- name: ${nameFragment}`)
  assert.notEqual(start, -1, `step "${nameFragment}" not found`)
  const next = code.indexOf('\n      - ', start + 1)
  return code.slice(start, next === -1 ? undefined : next)
}

test('keeps the dispatch interface and per-environment concurrency lock', () => {
  assert.match(code, /workflow_dispatch:/)
  for (const input of ['environment:', 'tenant_slug:', 'feature_key:', 'enabled:']) assert.ok(code.includes(`      ${input}`), input)
  assert.match(code, /options: \[staging, production\]/)
  assert.match(code, /group: feature-rollout-\$\{\{ inputs\.environment \}\}/)
  assert.match(code, /cancel-in-progress: false/)
})

test('still binds the job to the selected GitHub Environment', () => {
  assert.match(code, /environment: \$\{\{ inputs\.environment \}\}/)
})

test('resolves configuration before installing dependencies or writing anything', () => {
  const order = ['Validate feature key', 'Resolve this Environment', 'Install apply-flag dependencies', 'Resolve tenant slug and apply the flag']
  const positions = order.map((name) => code.indexOf(`- name: ${name}`))
  assert.ok(positions.every((position) => position >= 0))
  assert.deepEqual([...positions].sort((a, b) => a - b), positions)
})

test('never selects between environments with a fallback expression', () => {
  // `a || b` inside ${{ }} would let a missing staging value fall through to production (or the reverse).
  for (const expression of code.match(/\$\{\{[^}]*\}\}/g) ?? []) {
    assert.doesNotMatch(expression, /\|\||&&/, `expression must not fall back between sources: ${expression}`)
  }
})

test('the apply step takes its target only from the resolved configuration', () => {
  const apply = stepBlock('Resolve tenant slug and apply the flag')
  assert.doesNotMatch(apply, /SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|EXPECTED_SUPABASE_HOST|secrets\.|vars\./)
  assert.match(apply, /TENANT_SLUG: \$\{\{ inputs\.tenant_slug \}\}/)
  assert.match(apply, /CHANGE_SOURCE: github-actions:feature-rollout:\$\{\{ github\.run_id \}\}:\$\{\{ github\.actor \}\}/)
})

test('only the resolve step touches secrets, and the service-role key is never echoed', () => {
  const secretReferences = code.match(/secrets\.[A-Z_]+/g) ?? []
  assert.ok(secretReferences.length > 0)
  const resolve = stepBlock('Resolve this Environment')
  for (const reference of secretReferences) assert.ok(resolve.includes(reference), `${reference} used outside the resolve step`)
  assert.doesNotMatch(code, /echo[^\n]*(SERVICE_ROLE|secrets\.)/)
})

test('verification and status keep working, and status is skipped when nothing was resolved', () => {
  assert.match(stepBlock('Post-enable verification'), /if: inputs\.enabled == 'true'/)
  const status = stepBlock('Current status for this tenant')
  assert.match(status, /always\(\)/)
  assert.match(status, /env\.SUPABASE_URL != ''/)
  assert.match(status, /env\.SUPABASE_SERVICE_ROLE_KEY != ''/)
})
