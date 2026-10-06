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

test('production-release.yml changes only deliberately (release-context handoff, Phase 2D automated mode, release-based versioning and the ephemeral verified migration-apply workspace)', () => {
  const digest = createHash('sha256').update(productionRelease).digest('hex')
  // Phase 1: identifier-only production-release-context handoff. Phase 2D: optional automation_source_run_id
  // provenance verification, run-name, actions: read, and release-based versioning (production-release-request-workflow.test.mjs
  // asserts the production Environment scoping, safety gates and concurrency lock are intact; no human Environment approval is assumed). Migration apply: production-migration-apply-workspace.test.mjs
  // pins the ephemeral-workspace apply contract.
  // Railway account-token auth: `variables set` is preceded by an explicit `railway link` (account tokens have no project scope).
  // Railway deploy: API `railway up --ci` uploads the repo root (service Root Directory apps/api selects the app); web uses `up apps/web --path-as-root` (no web Root Directory; root upload fell back to Railpack).
  // Railway variables: `variables set` passes --skip-deploys so only `railway up` deploys (no racing redeploy).
  // Skip propagation: deploy-api/deploy-web/verify/tag carry explicit fail-closed job-level `!cancelled()` conditions on direct dependency results.
  // Check-run pagination: the CI Gate / Staging Gate lookups use github.paginate so commits with >100 check runs are still found.
  // Comment-only: the Required Reviewer on the production Environment was removed outside the repo, so the human-approval wording was rewritten (no functional change).
  // Update deliberately whenever production-release.yml is meant to change.
  assert.equal(digest, '7d9f2d7de011cd95068a02ef372de81c570e8bba1ed85f66328c8369be23aa8e')
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

test('resolver never trusts staging workflow_run head data and fails closed', () => {
  const staging = section(resolver, "workflowName === 'Staging Candidate'", "workflowName === 'Production Migration Evidence Audit'")
  assert.doesNotMatch(staging, /run\.head_sha|run\.head_branch/)
  assert.match(staging, /requireSameRepoPr\(pr, repo, context\.candidate_sha, context\.candidate_branch\)/)
  assert.match(resolver, /pr\.state !== 'open'/)
  assert.match(resolver, /base\?\.ref !== 'main'/)
  assert.match(resolver, /full_name !== repo/)
  assert.match(workflow, /Never push directly to main/)
})

test('workflow-file edits are allowed through repair PRs, documented against the App permission', () => {
  assert.doesNotMatch(workflow, /disallowedTools[^\n]*\.github\/workflows/)
  assert.doesNotMatch(workflow, /Edit\(\.github/)
  assert.match(doc, /Workflows: Read & write/)
  assert.doesNotMatch(doc, /deliberately has no `workflows`/)
  assert.match(doc, /may\*\* repair\s+`\.github\/workflows\/\*\*`/)
})

test('Deploy Health Check is monitored, only failures of same-repository runs invoke Claude', () => {
  assert.match(workflow, /^      - Deploy Health Check$/m)
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'failure'/)
  assert.match(workflow, /head_repository\.full_name == github\.repository/)
  assert.match(resolver, /workflowName === 'Deploy Health Check'/)
  assert.match(resolver, /'\.github\/workflows\/production-release\.yml': 'Production Release'/)
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

test('exactly dependabot[bot] and the trusted publisher bot are allowed as non-human actors, never a wildcard', () => {
  const allowed = [...workflow.matchAll(/^\s+allowed_bots:\s*(.+)$/gm)].map((m) => m[1].trim())
  assert.deepEqual(allowed, ['dependabot[bot],patelrep-release-engineer[bot]'])
  const bots = allowed[0].split(',')
  assert.deepEqual(bots, ['dependabot[bot]', 'patelrep-release-engineer[bot]'])
  for (const bot of bots) assert.match(bot, /^[a-z0-9-]+\[bot\]$/)
  assert.doesNotMatch(workflow, /allowed_bots:[^\n]*\*/)
  assert.doesNotMatch(workflow, /allowed_non_write_users/)
})

// ---- Phase 2B: separated authority, bounded retries, trusted publishing ----
const jobSection = (name) => {
  const start = workflow.indexOf(`\n  ${name}:\n`)
  assert.ok(start >= 0, `job ${name} must exist`)
  const rest = workflow.slice(start + 1)
  const next = rest.slice(1).search(/\n  [a-z-]+:\n/)
  return next < 0 ? rest : rest.slice(0, next + 1)
}
const resolveJob = jobSection('resolve')
const withoutDenyList = (text) => text.split('\n').filter((line) => !/disallowedTools/.test(line)).join('\n')
const repairJob = jobSection('repair')
const publishJob = jobSection('publish')
const publisher = read('scripts/publish-release-engineer-repair.mjs')
const lineage = read('scripts/recovery-lineage.mjs')

test('Claude uses the read-only workflow token; only the publisher job holds the GitHub App token', () => {
  assert.match(repairJob, /github_token: \$\{\{ github\.token \}\}/)
  assert.doesNotMatch(repairJob, /app-token|PATELREP_APP|create-github-app-token/)
  assert.doesNotMatch(resolveJob, /app-token|PATELREP_APP|create-github-app-token/)
  assert.match(publishJob, /actions\/create-github-app-token@v3/)
  assert.match(publishJob, /client-id: \$\{\{ vars\.PATELREP_APP_CLIENT_ID \}\}/)
  assert.match(publishJob, /private-key: \$\{\{ secrets\.PATELREP_APP_PRIVATE_KEY \}\}/)
  assert.equal((workflow.match(/PATELREP_APP_PRIVATE_KEY/g) ?? []).length, 1)
  assert.doesNotMatch(workflow, /github_token: \$\{\{ steps\.app-token/)
  assert.doesNotMatch(repairJob, /persist-credentials: true/)
})

test('Claude cannot push, commit, create/edit/merge PRs, or dispatch workflows', () => {
  const deny = workflow.match(/--disallowedTools "([^"]*)"/)[1].split(',')
  for (const rule of [
    'Bash(git push:*)', 'Bash(git push --force:*)', 'Bash(git push -f:*)', 'Bash(git push --force-with-lease:*)',
    'Bash(git push origin main:*)', 'Bash(git push origin HEAD:main:*)', 'Bash(git commit:*)', 'Bash(git reset:*)',
    'Bash(gh pr create:*)', 'Bash(gh pr edit:*)', 'Bash(gh pr merge:*)', 'Bash(gh pr comment:*)', 'Bash(gh workflow:*)',
    'Bash(gh api * --method*)', 'Bash(gh api * -X*)',
  ]) {
    assert.ok(deny.includes(rule), `missing deny rule ${rule}`)
  }
  const allow = workflow.match(/--allowedTools "([^"]*)"/)[1].split(',')
  for (const broad of ['Bash(git:*)', 'Bash(gh:*)', 'Bash(git push:*)', 'Bash(git commit:*)']) {
    assert.ok(!allow.includes(broad), `allow list must not contain ${broad}`)
  }
  assert.ok(allow.includes('Bash(git diff:*)') && allow.includes('Bash(gh run download:*)'))
})

test('the trusted publisher is the only place that pushes, commits, or edits PRs', () => {
  assert.doesNotMatch(withoutDenyList(repairJob), /git push|git commit|gh pr (?:create|edit|merge)|--method (?:POST|PATCH)/)
  assert.doesNotMatch(resolveJob, /git push|git commit|gh pr (?:create|edit|merge)|--method (?:POST|PATCH)/)
  assert.match(publishJob, /node "\$GITHUB_WORKSPACE\/trusted-publisher\/scripts\/publish-release-engineer-repair\.mjs"/)
  assert.match(publisher, /'push', 'origin', `HEAD:refs\/heads\/\$\{branch\}`/)
  assert.doesNotMatch(publisher, /--force|force-with-lease/)
  assert.doesNotMatch(publisher, /gh pr merge|merge_pull|\/merge|gh workflow run|dispatches/)
})

test('publisher code and resolver both come from main, and publish needs a captured patch', () => {
  assert.match(resolveJob, /ref: main\n\s+path: \.trusted-resolver/)
  assert.match(publishJob, /needs\.repair\.outputs\.has_changes == 'true'/)
  assert.match(repairJob, /test "\$\(git rev-parse HEAD\)" = "\$REPAIR_SHA"/)
  assert.match(repairJob, /git diff --cached --binary "\$REPAIR_SHA"/)
})

test('repair and publish are serialized by the RESOLVED recovery root, never cancelled, and not workflow-level', () => {
  const groups = [...workflow.matchAll(/group: (claude-recovery-root-\$\{\{ needs\.resolve\.outputs\.root_failed_run_id \}\})/g)]
  assert.equal(groups.length, 2)
  assert.match(repairJob, /concurrency:\n\s+group: claude-recovery-root-/)
  assert.match(publishJob, /concurrency:\n\s+group: claude-recovery-root-/)
  assert.equal((workflow.match(/cancel-in-progress: false/g) ?? []).length, 2)
  assert.doesNotMatch(workflow, /cancel-in-progress: true/)
  assert.doesNotMatch(workflow, /group: claude-release-engineer-/)
  assert.doesNotMatch(workflow, /concurrency:[^\n]*\n\s+group:[^\n]*workflow_run\.id/)
})

test('repair context is resolved first and every repair checkout uses the resolved repair_sha', () => {
  assert.match(repairJob, /needs: resolve/)
  assert.ok(workflow.indexOf('id: ctx') < workflow.indexOf('ref: ${{ needs.resolve.outputs.repair_sha }}'))
  assert.equal((workflow.match(/ref: \$\{\{ needs\.resolve\.outputs\.repair_sha \}\}/g) ?? []).length, 2)
  assert.doesNotMatch(workflow, /ref: \$\{\{[^}]*workflow_run\.head_sha/)
  for (const output of ['repair_sha', 'repair_branch', 'repair_pr_number', 'root_failed_run_id', 'failed_run_id', 'repair_attempt', 'automatic_retry_allowed', 'upstream_workflow', 'skip']) {
    assert.match(resolver, new RegExp(`${output}:`))
    assert.match(workflow, new RegExp(`${output}: \\$\\{\\{ steps\\.ctx\\.outputs\\.${output} \\}\\}`))
  }
  assert.match(repairJob, /if: needs\.resolve\.outputs\.skip != 'true'/)
})

test('the retry limit is a checked-in constant of 3, enforced by the resolver and the publisher', () => {
  assert.match(lineage, /MAX_AUTOMATIC_REPAIR_ATTEMPTS = 3/)
  assert.match(resolver, /attempt > MAX_AUTOMATIC_REPAIR_ATTEMPTS/)
  assert.match(publisher, /attempt > MAX_AUTOMATIC_REPAIR_ATTEMPTS/)
  assert.match(resolveJob, /Report automatic retry exhaustion/)
  assert.doesNotMatch(workflow, /\b(?:max_attempts|MAX_ATTEMPTS)\s*[:=]\s*\d/)
})

test('lineage is authoritative in commit trailers written by the publisher, not in PR text or counts', () => {
  for (const trailer of ['PatelRep-Recovery-Root', 'PatelRep-Recovery-Attempt', 'PatelRep-Recovery-Source-Run']) {
    assert.ok(lineage.includes(trailer))
    assert.ok(doc.includes(trailer))
  }
  assert.match(publisher, /formatTrailers\(/)
  assert.doesNotMatch(resolver, /listWorkflowRuns|rev-list --count|comments|created_at|updated_at/)
  assert.match(publisher, /commit trailers are authoritative/)
})

test('the Phase 1 branch-name retry guard is gone and the dependabot allowance is preserved', () => {
  assert.doesNotMatch(resolver, /skip[^\n]*failedSourceBranch|failedSourceBranch[^\n]*skip/)
  assert.doesNotMatch(workflow, /startsWith\(github\.event\.workflow_run\.head_branch/)
  assert.match(repairJob, /allowed_bots: dependabot\[bot\],patelrep-release-engineer\[bot\]\r?\n/)
  assert.match(doc, /bounded recovery lineage/i)
  assert.doesNotMatch(doc, /Phase 2 replaces it with bounded/)
})

test('phase 2B adds no auto-merge and no Production Release dispatch', () => {
  assert.doesNotMatch(executable, /gh pr merge|merge_pull_request|--auto\b|gh workflow run|dispatches|production-release\.yml/)
  const deny = workflow.match(/--disallowedTools "([^"]*)"/)[1]
  assert.match(deny, /Bash\(gh pr merge:\*\)/)
  assert.match(deny, /Bash\(gh workflow:\*\)/)
  assert.match(workflow, /Do not dispatch Production Release|do not dispatch Production Release/i)
})

test('only failures from same-repository runs reach the resolver and fork protection remains', () => {
  assert.match(resolveJob, /github\.event\.workflow_run\.conclusion == 'failure'/)
  assert.doesNotMatch(workflow, /conclusion == 'success'/)
  assert.match(resolveJob, /workflow_run\.head_repository\.full_name == github\.repository/)
  assert.doesNotMatch(workflow, /startsWith\(github\.event\.workflow_run\.head_branch/)
  assert.doesNotMatch(workflow, /pull_request_target/)
})

test('credentials stay isolated: no production secrets or environment in any job', () => {
  assert.doesNotMatch(executable, /PRODUCTION_|RAILWAY|SUPABASE|STRIPE|SERVICE_ROLE|DATABASE_URL|DB_URL/i)
  assert.doesNotMatch(workflow, /^\s+environment:/m)
  assert.deepEqual([...new Set([...workflow.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]))].sort(), ['CLAUDE_CODE_OAUTH_TOKEN', 'PATELREP_APP_PRIVATE_KEY'])
  assert.doesNotMatch(repairJob, /PATELREP_APP_PRIVATE_KEY/)
})

test('the trusted control-plane SHA is captured from the resolver checkout of main and validated', () => {
  assert.match(resolveJob, /ref: main\n\s+path: \.trusted-resolver/)
  const capture = section(resolveJob, '- name: Capture trusted control-plane SHA', '# Deterministically resolve')
  assert.match(capture, /git -C \.trusted-resolver rev-parse HEAD/)
  assert.match(capture, /\^\[0-9a-f\]\{40\}\$/)
  assert.match(workflow, /trusted_control_plane_sha: \$\{\{ steps\.trusted-sha\.outputs\.sha \}\}/)
  assert.ok(workflow.indexOf('id: trusted-sha') < workflow.indexOf('id: ctx'))
})

test('the publisher uses the exact frozen control-plane SHA, never mutable main', () => {
  assert.doesNotMatch(publishJob, /ref: main/)
  assert.doesNotMatch(repairJob, /ref: main/)
  const trusted = section(publishJob, 'ref: ${{ needs.resolve.outputs.trusted_control_plane_sha }}', '- uses: actions/download-artifact')
  assert.match(trusted, /path: trusted-publisher/)
  assert.match(trusted, /persist-credentials: false/)
  assert.equal((workflow.match(/ref: main/g) ?? []).length, 1)
  assert.equal((workflow.match(/trusted_control_plane_sha/g) ?? []).length, 2)
})

test('failed candidate code never supplies the resolver or publisher implementation', () => {
  assert.doesNotMatch(workflow, /node [^\n]*repair-worktree\/scripts/)
  assert.doesNotMatch(workflow, /node \.\/scripts|node scripts\//)
  assert.doesNotMatch(repairJob, /scripts\/(?:resolve-release-engineer-context|publish-release-engineer-repair|recovery-lineage)/)
  assert.match(resolveJob, /node \.trusted-resolver\/scripts\/resolve-release-engineer-context\.mjs/)
})

test('the trusted publisher is a sibling checkout outside the repair worktree and patches only the worktree', () => {
  const repairCheckout = section(publishJob, 'path: repair-worktree', '- uses: actions/checkout@v7\n        with:\n          ref: ${{ needs.resolve.outputs.trusted_control_plane_sha }}')
  assert.match(publishJob, /token: \$\{\{ steps\.app-token\.outputs\.token \}\}\n\s+ref: \$\{\{ needs\.resolve\.outputs\.repair_sha \}\}\n\s+fetch-depth: 0\n\s+path: repair-worktree/)
  assert.ok(repairCheckout.length > 0)
  const paths = [...publishJob.matchAll(/^\s+path: (.+)$/gm)].map((m) => m[1].trim())
  assert.deepEqual(paths.filter((p) => !p.includes('runner.temp')).sort(), ['repair-worktree', 'trusted-publisher'])
  for (const p of paths) {
    assert.doesNotMatch(p, /^repair-worktree\/|^\.|^\//)
  }
  assert.doesNotMatch(workflow, /\.trusted-publisher/)
  // The publisher script runs from the trusted checkout; its git operations run in the repair worktree.
  assert.match(publishJob, /working-directory: repair-worktree\n\s+run: node "\$GITHUB_WORKSPACE\/trusted-publisher\/scripts\//)
  // The patch artifact is downloaded outside both checkouts, so it can only be applied by the publisher.
  assert.match(publishJob, /name: repair-output\n\s+path: \$\{\{ runner\.temp \}\}\/repair-out/)
  assert.match(publishJob, /PATCH_FILE: \$\{\{ runner\.temp \}\}\/repair-out\/repair\.patch/)
  // The publisher applies the patch via git in cwd only.
  assert.match(publisher, /'apply', '--index', '--binary', '--whitespace=nowarn', patchFile/)
  assert.doesNotMatch(publisher, /process\.chdir|cwd:/)
})
