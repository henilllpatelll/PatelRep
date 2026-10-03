import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const workflow = read('.github/workflows/claude-release-engineer.yml')
const productionRelease = read('.github/workflows/production-release.yml')
const doc = read('docs/AUTONOMOUS_RELEASE_ENGINEER.md')
const settings = JSON.parse(read('.claude/settings.json'))

// The deny-list legitimately names forbidden CLIs; every other line must not execute them.
const executable = workflow.split('\n').filter((line) => !/disallowedTools/.test(line)).join('\n')

test('authenticates with the Claude OAuth token and never the Anthropic API key', () => {
  assert.match(workflow, /claude_code_oauth_token: \$\{\{ secrets\.CLAUDE_CODE_OAUTH_TOKEN \}\}/)
  assert.doesNotMatch(workflow, /ANTHROPIC_API_KEY/)
  assert.match(workflow, /anthropics\/claude-code-action@v1/)
})

test('creates a PatelRep GitHub App token and passes it as github_token', () => {
  assert.match(workflow, /actions\/create-github-app-token@v3/)
  assert.match(workflow, /client-id: \$\{\{ vars\.PATELREP_APP_CLIENT_ID \}\}/)
  assert.match(workflow, /private-key: \$\{\{ secrets\.PATELREP_APP_PRIVATE_KEY \}\}/)
  assert.match(workflow, /github_token: \$\{\{ steps\.app-token\.outputs\.token \}\}/)
  assert.doesNotMatch(workflow, /github_token: \$\{\{ (?:secrets\.GITHUB_TOKEN|github\.token)/)
})

test('grants actions: read, keeps output hidden, and bounds the agent', () => {
  assert.match(workflow, /additional_permissions: \|\n\s+actions: read/)
  assert.doesNotMatch(workflow, /show_full_output/)
  assert.match(workflow, /--max-turns \d+/)
  assert.match(workflow, /timeout-minutes: \d+/)
})

test('triggers on manual dispatch and the four upstream workflows only', () => {
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /workflow_run:/)
  for (const name of ['CI', 'Staging Candidate', 'Production Migration Evidence Audit', 'Production Release']) {
    assert.match(workflow, new RegExp(`^      - ${name}$`, 'm'))
  }
  assert.doesNotMatch(workflow, /^      - Claude Release Engineer$/m)
  assert.doesNotMatch(workflow, /pull_request_target/)
})

test('only failures from same-repository, non-recovery runs invoke Claude', () => {
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'failure'/)
  assert.doesNotMatch(workflow, /conclusion == 'success'/)
  assert.match(workflow, /workflow_run\.head_repository\.full_name == github\.repository/)
  assert.match(workflow, /!startsWith\(github\.event\.workflow_run\.head_branch, 'claude\/recovery-'\)/)
})

test('serializes per failed run without cancelling an active repair', () => {
  assert.match(workflow, /group: claude-release-engineer-\$\{\{ github\.event\.workflow_run\.id/)
  assert.match(workflow, /cancel-in-progress: false/)
})

test('never receives production credentials or an environment', () => {
  assert.doesNotMatch(executable, /PRODUCTION_|RAILWAY|SUPABASE|STRIPE|SERVICE_ROLE|DATABASE_URL|DB_URL/i)
  assert.doesNotMatch(workflow, /^\s+environment:/m)
  const secretRefs = [...workflow.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1])
  assert.deepEqual([...new Set(secretRefs)].sort(), ['CLAUDE_CODE_OAUTH_TOKEN', 'PATELREP_APP_PRIVATE_KEY'])
})

test('does not itself run production database or deploy commands', () => {
  assert.doesNotMatch(executable, /supabase\s+db\s+push|migration\s+repair|railway\s+up|\bpsql\b/i)
  assert.match(workflow, /--disallowedTools "[^"]*Bash\(supabase:\*\)[^"]*Bash\(railway:\*\)[^"]*Bash\(psql:\*\)/)
})

test('the prompt points Claude at CLAUDE.md and the operating document', () => {
  assert.match(workflow, /read CLAUDE\.md and docs\/AUTONOMOUS_RELEASE_ENGINEER\.md/)
  for (const invariant of ['supabase migration repair', 'supabase_migrations', 'production-target-guard', 'staging-target-guard', 'exact release identity']) {
    assert.ok(doc.includes(invariant), `doc must state invariant: ${invariant}`)
  }
  assert.match(doc, /claude\/recovery-<workflow-run-id>/)
})

test('production-release.yml is unchanged by Phase 1', () => {
  const digest = createHash('sha256').update(productionRelease).digest('hex')
  // Update deliberately (Phase 2) when production-release.yml is meant to change.
  assert.equal(digest, '10ba09dda0941b6fd459b26f082f7490dd76e8a40ea91caf391363222032b221')
})

test('shared Claude settings are portable and CI-safe', () => {
  const text = JSON.stringify(settings)
  assert.doesNotMatch(text, /[A-Za-z]:[\\/]|\/Users\/|Scripts\/python\.exe/)
  assert.doesNotMatch(JSON.stringify(settings.hooks), /npm run dev:/)
  const commands = JSON.stringify(settings.hooks).match(/"command":"(?:[^"\\]|\\.)*"/g)
  assert.ok(commands.length > 0)
  for (const command of commands) {
    assert.match(command, /node \\"\$CLAUDE_PROJECT_DIR\/\.claude\/hooks\/local-hook\.mjs\\"/)
  }
})

test('local hook launcher is a no-op under CI', () => {
  for (const kind of ['dev-servers', 'graphify-update', 'wolf stop']) {
    const result = spawnSync(process.execPath, ['.claude/hooks/local-hook.mjs', ...kind.split(' ')], {
      env: { ...process.env, CI: 'true' },
      encoding: 'utf8',
      timeout: 10_000,
    })
    assert.equal(result.status, 0)
    assert.equal(result.stdout + result.stderr, '')
  }
})
