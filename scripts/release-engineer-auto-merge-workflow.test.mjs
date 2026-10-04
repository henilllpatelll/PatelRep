import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'
import { classifyChangedFile } from './release-engineer-auto-merge-policy.mjs'

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const workflow = read('.github/workflows/claude-release-engineer-auto-merge.yml')
// Header comments name what this workflow must not do; these assertions inspect executable lines only.
const workflowCode = workflow.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n')
const claudeWorkflow = read('.github/workflows/claude-release-engineer.yml')
const doc = read('docs/AUTONOMOUS_RELEASE_ENGINEER.md')
const scripts = {
  policy: read('scripts/release-engineer-auto-merge-policy.mjs'),
  resolver: read('scripts/resolve-release-engineer-auto-merge.mjs'),
  merge: read('scripts/merge-release-engineer-repair.mjs'),
  deps: read('scripts/release-engineer-auto-merge-deps.mjs'),
}

const jobSection = (source, name) => {
  const start = source.indexOf(`\n  ${name}:\n`)
  assert.ok(start >= 0, `job ${name} exists`)
  const next = source.slice(start + 1).search(/\n  [a-z-]+:\n/)
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next)
}
const resolveJob = jobSection(workflow, 'resolve')
const mergeJob = jobSection(workflow, 'merge')

test('triggers only on completed Staging Candidate runs and only considers successful same-repository runs', () => {
  assert.match(workflow, /on:\n {2}workflow_run:\n {4}workflows:\n {6}- Staging Candidate\n {4}types: \[completed\]\n/)
  assert.doesNotMatch(workflow, /workflow_dispatch|pull_request|push:|schedule:|cron:|issue_comment|check_suite/)
  assert.match(resolveJob, /github\.event\.workflow_run\.conclusion == 'success'/)
  assert.match(resolveJob, /github\.event\.workflow_run\.head_repository\.full_name == github\.repository/)
})

test('it never polls, sleeps or enables GitHub native auto-merge', () => {
  assert.doesNotMatch(workflow, /sleep|until |while |enable-auto-merge|--auto|autoMerge/i)
  for (const [name, source] of Object.entries(scripts)) {
    assert.doesNotMatch(source, /enableAutoMerge|--auto\b|auto_merge/i, name)
  }
})

test('the resolve job is read-only and holds no App credential', () => {
  assert.doesNotMatch(resolveJob, /PATELREP_APP|create-github-app-token|app-token/)
  assert.doesNotMatch(resolveJob, /secrets\./)
  assert.match(resolveJob, /ref: main/)
  assert.match(resolveJob, /persist-credentials: false/)
  assert.match(resolveJob, /GH_TOKEN: \$\{\{ github\.token \}\}/)
  assert.match(workflow, /^permissions:\n {2}contents: read\n {2}actions: read\n {2}pull-requests: read\n {2}checks: read\n/m)
  assert.doesNotMatch(workflow, /^\s+(contents|actions|pull-requests|checks|issues|statuses|id-token): write$/m)
})

test('trusted control-plane SHA is captured, validated and reused by the merge job', () => {
  assert.match(resolveJob, /rev-parse HEAD/)
  assert.match(resolveJob, /\^\[0-9a-f\]\{40\}\$/)
  assert.match(workflow, /trusted_control_plane_sha: \$\{\{ steps\.trusted-sha\.outputs\.sha \}\}/)
  assert.match(mergeJob, /ref: \$\{\{ needs\.resolve\.outputs\.trusted_control_plane_sha \}\}/)
  assert.doesNotMatch(mergeJob, /ref: main/)
  assert.match(mergeJob, /persist-credentials: false/)
})

test('merge is gated on eligible=true and serialized globally without cancelling in-progress merges', () => {
  assert.match(mergeJob, /needs: resolve\n/)
  assert.match(mergeJob, /if: needs\.resolve\.outputs\.eligible == 'true'/)
  assert.match(mergeJob, /group: patelrep-release-engineer-auto-merge-main\n {6}cancel-in-progress: false/)
  assert.doesNotMatch(workflow, /cancel-in-progress: true/)
  assert.equal(workflow.match(/concurrency:/g).length, 1, 'only the merge job serializes')
})

test('the GitHub App token exists only in the merge job, only as the merge credential', () => {
  assert.equal(workflow.match(/create-github-app-token/g).length, 1)
  assert.equal(workflow.match(/PATELREP_APP_PRIVATE_KEY/g).length, 1)
  assert.ok(mergeJob.includes('PATELREP_APP_PRIVATE_KEY'))
  assert.match(mergeJob, /permission-contents: write/)
  assert.match(mergeJob, /permission-pull-requests: write/)
  assert.doesNotMatch(mergeJob, /permission-(workflows|actions|administration|checks|issues|statuses|environments|secrets)/)
  assert.match(mergeJob, /GH_MERGE_TOKEN: \$\{\{ steps\.app-token\.outputs\.token \}\}/)
  assert.match(mergeJob, /GH_READ_TOKEN: \$\{\{ github\.token \}\}/)
  // The App token is created after the (credential-free) trusted checkout and never used by checkout.
  assert.ok(mergeJob.indexOf('actions/checkout') < mergeJob.indexOf('create-github-app-token'))
  assert.doesNotMatch(mergeJob, /token: \$\{\{ steps\.app-token/)
  assert.doesNotMatch(claudeWorkflow, /patelrep-release-engineer-auto-merge|merge-release-engineer-repair/)
})

test('the merge job runs only trusted merge code and never checks out or executes candidate code', () => {
  assert.equal(mergeJob.match(/actions\/checkout@/g).length, 1)
  assert.match(mergeJob, /path: trusted-merge/)
  assert.match(mergeJob, /sparse-checkout: scripts/)
  assert.doesNotMatch(mergeJob, /ref: \$\{\{ (needs\.resolve\.outputs\.(candidate|repair)|github\.event\.workflow_run\.head)/)
  assert.doesNotMatch(mergeJob, /npm (ci|install|run)|pip install|setup-node|setup-python|download-artifact/)
  assert.match(mergeJob, /run: node trusted-merge\/scripts\/merge-release-engineer-repair\.mjs/)
  // Candidate identity reaches the script only as EXPECTATIONS that it re-validates.
  assert.match(mergeJob, /EXPECTED_SHA: /)
  assert.match(scripts.merge, /expected/)
  assert.match(scripts.merge, /validateAutoMergeCandidate/)
})

test('merge uses the exact-SHA merge API with normal merge commits and no bypass, force or branch updates', () => {
  assert.match(scripts.deps, /merge_method: 'merge'/)
  assert.match(scripts.deps, /JSON\.stringify\(\{ sha, merge_method: 'merge' \}\)/)
  assert.match(scripts.deps, /'PUT', `repos\/\$\{repo\}\/pulls\/\$\{number\}\/merge`/)
  assert.match(scripts.merge, /deps\.merge\(candidate\.prNumber, candidate\.sha\)/)
  for (const source of Object.values(scripts)) {
    assert.doesNotMatch(source, /squash|rebase|update-branch|--force|force-with-lease|git push|git merge|delete.*branch|git\/refs/i)
  }
  assert.match(scripts.merge, /merged !== true/)
  assert.match(scripts.merge, /merged\.head\?\.sha !== candidate\.sha/)
  assert.doesNotMatch(scripts.merge, /deleteBranch|git push/)
})

test('Phase 2C ends at merge: no production credentials, environments or release/rollback dispatch', () => {
  assert.doesNotMatch(workflow, /environment:/)
  assert.doesNotMatch(workflow, /PRODUCTION_|SUPABASE|RAILWAY|STRIPE|OPENAI|ANTHROPIC|CLAUDE_CODE_OAUTH/)
  assert.doesNotMatch(workflow, /workflow_dispatch|gh workflow run|actions\/workflows\/.*dispatches|createWorkflowDispatch/)
  assert.doesNotMatch(workflowCode, /production-release|production-rollback|Production Release|Production Rollback|production-migration/i)
  for (const source of Object.values(scripts)) {
    assert.doesNotMatch(source, /workflows\/.*dispatches|createWorkflowDispatch|workflow run|production-release\.yml|production-rollback\.yml|psql|supabase db|railway /i)
  }
})

test('workflow, merge scripts and every control-plane path classify as human-merge only (no self-authorizing merges)', () => {
  for (const file of [
    '.github/workflows/claude-release-engineer-auto-merge.yml',
    '.github/workflows/claude-release-engineer.yml',
    'scripts/release-engineer-auto-merge-policy.mjs',
    'scripts/merge-release-engineer-repair.mjs',
    'scripts/resolve-release-engineer-auto-merge.mjs',
    'scripts/release-engineer-auto-merge-deps.mjs',
    'scripts/publish-release-engineer-repair.mjs',
    'scripts/recovery-lineage.mjs',
  ]) {
    assert.ok(classifyChangedFile(file), `${file} must require a human merge`)
  }
})

test('Claude still cannot merge, push, commit or edit PRs, and the exact bot allowlist is unchanged', () => {
  assert.match(claudeWorkflow, /allowed_bots: dependabot\[bot\],patelrep-release-engineer\[bot\]\n/)
  assert.doesNotMatch(claudeWorkflow, /allowed_bots:[^\n]*\*/)
  assert.match(claudeWorkflow, /github_token: \$\{\{ github\.token \}\}/)
  for (const denied of ['Bash(gh pr merge:*)', 'Bash(git push:*)', 'Bash(git commit:*)', 'Bash(gh pr create:*)', 'Bash(gh pr edit:*)', 'Bash(gh workflow:*)']) {
    assert.ok(claudeWorkflow.includes(denied), `${denied} stays denied`)
  }
  assert.match(claudeWorkflow, /MAX_AUTOMATIC_REPAIR_ATTEMPTS|trusted_control_plane_sha/)
})

test('no other workflow gains merge authority or main-ruleset bypass', () => {
  for (const file of readdirSync('.github/workflows')) {
    if (file === 'claude-release-engineer-auto-merge.yml') continue
    // The Claude deny-list legitimately names the forbidden merge command.
    const source = read(`.github/workflows/${file}`).split('\n').filter((line) => !/disallowedTools/.test(line)).join('\n')
    assert.doesNotMatch(source, /pulls\/\$\{[^}]*\}\/merge|gh pr merge|merge-release-engineer-repair|enable-auto-merge|bypass_actors/, file)
  }
  assert.doesNotMatch(workflowCode, /bypass|rulesets|branches\/main\/protection/i)
})

test('the operating document records the Phase 2C boundaries', () => {
  assert.match(doc, /Phase 2C/)
  assert.match(doc, /claude\/recovery-<numeric-root>/)
  assert.match(doc, /never auto-merge/i)
  assert.match(doc, /Phase 2D/)
})

test('both resolver and merge paths verify the recovery-branch ruleset through the shared policy, read-only', () => {
  assert.match(scripts.policy, /await requirePublisherOnlyRecoveryBranches\(deps\)/)
  assert.match(scripts.policy, /deps\.getApp\(PUBLISHER_APP_SLUG\)/)
  assert.match(scripts.policy, /refs\/heads\/claude\/recovery-\*/)
  assert.match(scripts.policy, /actor\.actor_id === app\.id/)
  assert.doesNotMatch(scripts.policy, /actor_id: \d|actor_id === \d/, 'the App id is resolved from the slug, never hard-coded')
  assert.match(scripts.resolver, /evaluateAutoMerge/)
  assert.match(scripts.merge, /validateAutoMergeCandidate/)
  assert.match(scripts.deps, /apps\/\$\{encodeURIComponent\(slug\)\}/)
  assert.match(scripts.deps, /rulesets\?per_page=100/)
  // Rulesets are only ever read: the single mutating API call in all scripts is the exact-SHA merge PUT.
  const mutating = [...Object.values(scripts).join('\n').matchAll(/'--method', '(PUT|POST|PATCH|DELETE)'/g)].map((m) => m[1])
  assert.deepEqual(mutating, ['PUT'])
  assert.doesNotMatch(workflowCode, /administration/i)
})

test('the one-time recovery-branch ruleset setup is documented and the main ruleset stays separate', () => {
  assert.match(doc, /refs\/heads\/claude\/recovery-\*/)
  assert.match(doc, /Restrict creations/)
  assert.match(doc, /Restrict updates/)
  assert.match(doc, /patelrep-release-engineer/)
  assert.match(doc, /Integration/)
  assert.match(doc, /17358515/)
  assert.match(doc, /fail[s-]closed|stays ineligible|remains ineligible/i)
})

test('a no-candidate Staging Candidate run ends in the unprivileged job: eligible=false, merge skipped, no App token', () => {
  assert.match(scripts.resolver, /: \{ eligible: 'false' \}/)
  assert.match(mergeJob, /if: needs\.resolve\.outputs\.eligible == 'true'/)
  assert.ok(!resolveJob.includes('create-github-app-token'))
  // Only a proven-absent artifact is a clean no-op; download/format problems stay hard errors.
  assert.match(scripts.policy, /context === null\) refuse\('Staging Candidate run has no PR candidate context'\)/)
  assert.match(scripts.deps, /if \(matches\.length === 0\) return null/)
  assert.doesNotMatch(scripts.deps, /catch \{\s*return null/)
})
