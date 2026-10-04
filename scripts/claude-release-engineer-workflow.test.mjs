import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const workflow = read('.github/workflows/claude-release-engineer.yml')
const productionRelease = read('.github/workflows/production-release.yml')
const stagingCandidate = read('.github/workflows/staging-candidate.yml')
const resolver = read('scripts/resolve-release-engineer-context.mjs')
const deployCheck = read('.github/workflows/deploy-check.yml')
const ciWorkflow = read('.github/workflows/ci.yml')
const publicSmoke = read('scripts/public-smoke.mjs')
const monitorSmoke = read('scripts/production-monitor-smoke.mjs')
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

test('triggers on manual dispatch and the five upstream workflows only', () => {
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /workflow_run:/)
  for (const name of ['CI', 'Staging Candidate', 'Production Migration Evidence Audit', 'Production Release', 'Deploy Health Check']) {
    assert.match(workflow, new RegExp(`^      - ${name}$`, 'm'))
  }
  assert.doesNotMatch(workflow, /^      - Claude Release Engineer$/m)
  assert.doesNotMatch(workflow, /pull_request_target/)
})

test('only failures from same-repository, non-recovery runs invoke Claude', () => {
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'failure'/)
  assert.doesNotMatch(workflow, /conclusion == 'success'/)
  assert.match(workflow, /workflow_run\.head_repository\.full_name == github\.repository/)
  assert.doesNotMatch(workflow, /startsWith\(github\.event\.workflow_run\.head_branch/)
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

test('production-release.yml changes only by the sanitized release-context handoff', () => {
  const digest = createHash('sha256').update(productionRelease).digest('hex')
  // Phase 1 follow-up: only change is the identifier-only production-release-context handoff artifact.
  // Update deliberately whenever production-release.yml is meant to change.
  assert.equal(digest, '23b47af4c0adea801d6c8bad3305aa4afbd7c75838953bb177226d898bbc2965')
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

const section = (text, from, to) => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)))

test('staging candidate publishes a sanitized, short-lived candidate context artifact early', () => {
  const resolveJob = section(stagingCandidate, '  resolve-candidate:', '  prepare-staging-database:')
  const step = section(resolveJob, '- name: Record sanitized candidate context', '- name: Upload sanitized candidate context')
  assert.match(step, /\{pr_number: \$pr_number, candidate_sha: \$candidate_sha, candidate_branch: \$candidate_branch, ci_run_id: \$ci_run_id\}/)
  assert.doesNotMatch(step, /secrets\.|vars\.|PASSWORD|TOKEN|RAILWAY|SUPABASE|http/i)
  const upload = resolveJob.slice(resolveJob.indexOf('- name: Upload sanitized candidate context'))
  assert.match(upload, /name: staging-candidate-context/)
  assert.match(upload, /retention-days: 3/)
  assert.match(upload, /if-no-files-found: error/)
  // Same job as the trusted-candidate resolution, so it exists even when later staging jobs fail.
  assert.ok(resolveJob.indexOf('id: candidate') < resolveJob.indexOf('Record sanitized candidate context'))
})

test('production release publishes only release identifiers for failure recovery', () => {
  assert.match(productionRelease, /JSON\.stringify\(\{ release_sha: targetSha, pr_number: prNumber \}\)/)
  assert.match(productionRelease, /name: production-release-context/)
  assert.match(productionRelease, /retention-days: 3/)
  assert.match(productionRelease, /check-db-drift\.mjs --environment production --allow-pending/)
})

test('repair context is resolved before checkout and checkout uses repair_sha', () => {
  assert.ok(workflow.indexOf('id: ctx') < workflow.indexOf('ref: ${{ steps.ctx.outputs.repair_sha }}'))
  assert.match(workflow, /ref: \$\{\{ steps\.ctx\.outputs\.repair_sha \}\}/)
  assert.doesNotMatch(workflow, /ref: \$\{\{[^}]*workflow_run\.head_sha/)
  assert.match(workflow, /scripts\/resolve-release-engineer-context\.mjs/)
  for (const output of ['repair_sha', 'repair_branch', 'repair_pr_number', 'root_failed_run_id', 'upstream_workflow']) {
    assert.match(resolver, new RegExp(`${output}:`))
    assert.match(workflow, new RegExp(`steps\.ctx\.outputs\.${output}`))
  }
})

test('resolver never trusts staging workflow_run head data and fails closed', () => {
  const staging = section(resolver, "run.name === 'Staging Candidate'", "run.name === 'Production Migration Evidence Audit'")
  assert.doesNotMatch(staging, /run\.head_sha|run\.head_branch/)
  assert.match(staging, /requireSameRepoPr\(pr, repo, context\.candidate_sha, context\.candidate_branch\)/)
  assert.match(resolver, /pr\.state !== 'open'/)
  assert.match(resolver, /base\?\.ref !== 'main'/)
  assert.match(resolver, /full_name !== repo/)
  assert.match(workflow, /Never push directly to main/)
})

test('direct pushes to main and force pushes are denied while repair-branch pushes stay allowed', () => {
  const deny = workflow.match(/--disallowedTools "([^"]*)"/)[1].split(',')
  for (const rule of [
    'Bash(git push origin main:*)',
    'Bash(git push origin HEAD:main:*)',
    'Bash(git push --force:*)',
    'Bash(git push -f:*)',
    'Bash(git push --force-with-lease:*)',
  ]) {
    assert.ok(deny.includes(rule), `missing deny rule ${rule}`)
  }
  const allow = workflow.match(/--allowedTools "([^"]*)"/)[1].split(',')
  assert.ok(allow.includes('Bash(git:*)'))
  assert.ok(!deny.includes('Bash(git push:*)') && !deny.includes('Bash(git push origin:*)'))
})

test('workflow-file edits are allowed through repair PRs, documented against the App permission', () => {
  assert.doesNotMatch(workflow, /disallowedTools[^\n]*\.github\/workflows/)
  assert.doesNotMatch(workflow, /Edit\(\.github/)
  assert.match(doc, /Workflows: Read & write/)
  assert.doesNotMatch(doc, /deliberately has no `workflows`/)
  assert.match(doc, /may\*\* repair\s+`\.github\/workflows\/\*\*`/)
  assert.match(doc, /Phase 2 replaces it with bounded\s+autonomous retries/)
})

test('phase 1 does not auto-merge or auto-dispatch Production Release', () => {
  assert.doesNotMatch(executable, /gh pr merge|merge_pull_request|--auto\b|gh workflow run|gh api[^\n]*dispatches/)
  const deny = workflow.match(/--disallowedTools "([^"]*)"/)[1]
  assert.match(deny, /Bash\(gh pr merge:\*\)/)
  assert.match(deny, /Bash\(gh workflow run production-release\*\)/)
  assert.match(workflow, /Do not dispatch Production Release/)
})

test('fork-run rejection and the phase 1 recovery retry guard are preserved', () => {
  assert.match(workflow, /workflow_run\.head_repository\.full_name == github\.repository/)
  // The coarse job condition must not try to infer the Staging candidate branch (it reports main).
  const jobIf = section(workflow, '    if: >-', '    steps:')
  assert.doesNotMatch(jobIf, /head_branch|recovery/)
  // The trusted resolver owns retry classification, keyed on the failed source, not the repair branch.
  assert.match(resolver, /failedSourceBranch\?\.startsWith\(RECOVERY_PREFIX\)/)
  assert.doesNotMatch(resolver, /repairBranch\.startsWith/)
  assert.match(workflow, /steps\.ctx\.outputs\.skip != 'true'/)
})

test('the resolver is checked out from main, never from failed code', () => {
  const trusted = section(workflow, '# Trusted copy of the resolver', '- name: Resolve repair context')
  assert.match(trusted, /ref: main/)
  assert.match(trusted, /persist-credentials: false/)
  assert.match(trusted, /sparse-checkout: scripts/)
  assert.doesNotMatch(trusted, /repair_sha|workflow_run\.head_sha/)
})

test('Deploy Health Check is monitored, only failures of same-repository runs invoke Claude', () => {
  assert.match(workflow, /^      - Deploy Health Check$/m)
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'failure'/)
  assert.match(workflow, /head_repository\.full_name == github\.repository/)
  assert.match(resolver, /run\.name === 'Deploy Health Check'/)
  assert.doesNotMatch(executable, /^\s+environment:/m)
})

test('Deploy Health Check is a runtime monitor using the dedicated smoke, not source gates', () => {
  assert.doesNotMatch(deployCheck, /floor-copy/)
  assert.match(ciWorkflow, /check:floor-copy/)
  assert.match(deployCheck, /node scripts\/production-monitor-smoke\.mjs/)
  assert.doesNotMatch(deployCheck, /scripts\/public-smoke\.mjs/)
  assert.doesNotMatch(deployCheck, /secrets\./)
  assert.doesNotMatch(deployCheck, /::warning::API health|::warning::Web health/)
  assert.equal((deployCheck.match(/^\s+exit 1$/gm) ?? []).length >= 3, true)
  for (const trigger of ['push:', 'schedule:', 'workflow_dispatch:']) assert.ok(deployCheck.includes(trigger))
})

test('release verification stays strict and the legacy no-/ready contract lives only in the monitor', () => {
  assert.match(publicSmoke, /resolveUrl\(apiUrl, 'ready'\)/)
  assert.match(publicSmoke, /readiness\.status !== 'ready' \|\| readiness\.database !== 'compatible'/)
  assert.doesNotMatch(publicSmoke, /legacy|classifyProductionContract/)
  assert.match(productionRelease, /node scripts\/public-smoke\.mjs/)
  assert.match(productionRelease, /EXPECTED_RELEASE_SHA:/)
  assert.match(productionRelease, /EXPECTED_RELEASE_VERSION:/)
  assert.doesNotMatch(productionRelease, /production-monitor-smoke/)
  assert.match(monitorSmoke, /classifyProductionContract/)
  assert.doesNotMatch(monitorSmoke, /status === 404|\.status === 404/)
})

test('only dependabot[bot] is allowed as a non-human actor, never a wildcard', () => {
  const allowed = [...workflow.matchAll(/^\s+allowed_bots:\s*(.+)$/gm)].map((m) => m[1].trim())
  assert.deepEqual(allowed, ['dependabot[bot]'])
  assert.doesNotMatch(workflow, /allowed_bots:\s*['"]?\*/)
  assert.doesNotMatch(workflow, /allowed_non_write_users|allowed_bots:[^\n]*[,*]/)
})

test('bot allowance does not loosen same-repository failed-run, fork, or credential protections', () => {
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'failure'/)
  assert.match(workflow, /workflow_run\.head_repository\.full_name == github\.repository/)
  assert.doesNotMatch(executable, /^\s+environment:/m)
  assert.doesNotMatch(executable, /PRODUCTION_|RAILWAY|SUPABASE|STRIPE|SERVICE_ROLE/i)
  assert.doesNotMatch(executable, /gh pr merge|gh workflow run|--auto\b/)
  assert.match(workflow, /ref: main/)
})
