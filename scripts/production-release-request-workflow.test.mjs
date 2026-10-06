import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'
import { classifyChangedFile } from './release-engineer-auto-merge-policy.mjs'

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const code = (source) => source.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n')
const request = read('.github/workflows/claude-release-engineer-production-request.yml')
const requestCode = code(request)
const rollbackRequest = read('.github/workflows/production-auto-rollback-request.yml')
const release = read('.github/workflows/production-release.yml')
const releaseCode = code(release)
const rollback = read('.github/workflows/production-rollback.yml')
const autoMerge = read('.github/workflows/claude-release-engineer-auto-merge.yml')
const doc = read('docs/AUTONOMOUS_RELEASE_ENGINEER.md')
const releaseProcess = read('docs/RELEASE_PROCESS.md')
const scripts = {
  policy: read('scripts/production-release-request-policy.mjs'),
  cli: read('scripts/production-release-request.mjs'),
  deps: read('scripts/production-release-request-deps.mjs'),
  version: read('scripts/release-version.mjs'),
  result: read('scripts/auto-merge-result.mjs'),
  merge: read('scripts/merge-release-engineer-repair.mjs'),
}

const jobSection = (source, name) => {
  const start = source.indexOf(`\n  ${name}:\n`)
  assert.ok(start >= 0, `job ${name} exists`)
  const next = source.slice(start + 1).search(/\n  [a-z-]+:\n/)
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next)
}
const resolveJob = jobSection(request, 'resolve')
const requestJob = jobSection(request, 'request-release')
const mergeJob = jobSection(autoMerge, 'merge')

// ---- the auto-merge-result handoff ---------------------------------------------------------------------------------

test('only the merge job, only after the merge script succeeded, uploads the 3-day auto-merge-result artifact', () => {
  assert.equal(autoMerge.match(/name: auto-merge-result/g).length, 1)
  assert.ok(mergeJob.includes('name: auto-merge-result'))
  assert.ok(!jobSection(autoMerge, 'resolve').includes('upload-artifact'))
  const upload = mergeJob.slice(mergeJob.indexOf('Upload sanitized auto-merge result'))
  assert.match(upload, /retention-days: 3/)
  assert.match(upload, /if-no-files-found: error/)
  assert.match(upload, /path: \$\{\{ runner\.temp \}\}\/auto-merge-result\/context\.json/)
  // No condition: the default success() means a failed or skipped merge step never produces the artifact.
  assert.doesNotMatch(upload, /\n\s+if:/)
  assert.doesNotMatch(autoMerge, /always\(\)|continue-on-error/)
  assert.ok(mergeJob.indexOf('merge-release-engineer-repair.mjs') < mergeJob.indexOf('upload-artifact'))
  assert.match(mergeJob, /RESULT_DIR: \$\{\{ runner\.temp \}\}\/auto-merge-result/)
})

test('the result is written by trusted code only after every merge verification, from identifiers only', () => {
  const body = scripts.merge
  assert.ok(body.indexOf('getCommit(mergeCommitSha)') < body.indexOf('return { ...candidate, mergeCommitSha, baseMainSha }'))
  assert.ok(body.indexOf('writeAutoMergeResult(env.RESULT_DIR, result)') > body.indexOf('const result = await mergeRepair('))
  assert.match(body, /await deps\.getMainSha\(\)/)
  assert.ok(body.indexOf('await deps.getMainSha()') < body.indexOf('await deps.merge('))
  assert.doesNotMatch(scripts.result, /body|title|label|token|secret|password|\.message/i)
})

// ---- the request workflow ------------------------------------------------------------------------------------------

test('triggers only on completed Auto-Merge runs: no polling, push, PR, schedule or manual trigger', () => {
  assert.match(request, /on:\n {2}workflow_run:\n {4}workflows:\n {6}- Claude Release Engineer Auto-Merge\n {4}types: \[completed\]\n/)
  assert.doesNotMatch(request, /workflow_dispatch|pull_request|push:|schedule:|cron:|issue_comment|check_suite/)
  assert.doesNotMatch(requestCode, /sleep|until |while |gh run watch/i)
  assert.match(resolveJob, /github\.event\.workflow_run\.conclusion == 'success'/)
  assert.match(resolveJob, /github\.event\.workflow_run\.head_repository\.full_name == github\.repository/)
})

test('global permissions are read-only and the resolver holds no secret, App key, environment or dispatch', () => {
  assert.match(request, /^permissions:\n {2}contents: read\n {2}actions: read\n {2}pull-requests: read\n {2}checks: read\n/m)
  assert.doesNotMatch(request, /^\s+(contents|actions|pull-requests|checks|issues|statuses|id-token|deployments): write$/m)
  assert.doesNotMatch(resolveJob, /PATELREP_APP|create-github-app-token|app-token|secrets\.|environment:|gh workflow|dispatches/)
  assert.match(resolveJob, /ref: main/)
  assert.match(resolveJob, /persist-credentials: false/)
  assert.match(resolveJob, /GH_TOKEN: \$\{\{ github\.token \}\}/)
  assert.match(resolveJob, /production-release-request\.mjs resolve/)
})

test('the trusted control-plane SHA is frozen by the resolver and checked out exactly by the request job', () => {
  assert.match(resolveJob, /rev-parse HEAD/)
  assert.match(resolveJob, /\^\[0-9a-f\]\{40\}\$/)
  assert.match(request, /trusted_control_plane_sha: \$\{\{ steps\.trusted-sha\.outputs\.sha \}\}/)
  assert.match(requestJob, /ref: \$\{\{ needs\.resolve\.outputs\.trusted_control_plane_sha \}\}/)
  assert.doesNotMatch(requestJob, /ref: main/)
  assert.equal(requestJob.match(/actions\/checkout@/g).length, 1)
  assert.match(requestJob, /persist-credentials: false/)
  assert.match(requestJob, /sparse-checkout: scripts/)
  assert.doesNotMatch(requestJob, /workflow_run\.head_(sha|branch)|npm (ci|install|run)|pip install|setup-node|download-artifact/)
})

test('request-release is gated, globally serialized without cancelling, and revalidates before any token exists', () => {
  assert.match(requestJob, /needs: resolve\n/)
  assert.match(requestJob, /if: needs\.resolve\.outputs\.eligible == 'true'/)
  assert.match(requestJob, /group: patelrep-production-release-request\n {6}cancel-in-progress: false/)
  assert.doesNotMatch(request, /cancel-in-progress: true/)
  assert.ok(requestJob.indexOf('actions/checkout') < requestJob.indexOf('production-release-request.mjs request'))
  assert.ok(requestJob.indexOf('production-release-request.mjs request') < requestJob.indexOf('create-github-app-token'))
  assert.ok(requestJob.indexOf('create-github-app-token') < requestJob.indexOf('gh workflow run'))
  assert.match(requestJob, /EXPECTED_MERGE_COMMIT_SHA: \$\{\{ needs\.resolve\.outputs\.merge_commit_sha \}\}/)
})

test('the App token exists only in request-release, after revalidation, scoped to actions: write, and only dispatches', () => {
  assert.equal(request.match(/create-github-app-token/g).length, 1)
  assert.equal(request.match(/PATELREP_APP_PRIVATE_KEY/g).length, 1)
  assert.match(requestJob, /id: app-token\n {8}if: steps\.revalidate\.outputs\.dispatch == 'true'/)
  assert.match(requestJob, /permission-actions: write/)
  assert.doesNotMatch(requestJob, /permission-(contents|pull-requests|workflows|administration|checks|issues|statuses|environments|secrets|deployments)/)
  assert.equal(requestJob.match(/steps\.app-token\.outputs\.token/g).length, 1, 'the token feeds only the dispatch step')
  assert.doesNotMatch(requestJob, /token: \$\{\{ steps\.app-token/)
  const dispatchStep = requestJob.slice(requestJob.indexOf('Request Production Release'))
  assert.match(dispatchStep, /gh workflow run production-release\.yml --repo "\$REPO" --ref main/)
  assert.match(dispatchStep, /-f version_bump=patch/)
  assert.match(dispatchStep, /-f release_sha="\$TARGET_SHA"/)
  assert.match(dispatchStep, /-f automation_source_run_id="\$SOURCE_RUN_ID"/)
  assert.equal(request.match(/gh workflow run/g).length, 1)
  assert.doesNotMatch(requestCode, /version_bump=(minor|major)|version_bump: (minor|major)/)
})

test('the requester has zero production authority and cannot roll back', () => {
  assert.doesNotMatch(requestCode, /environment:|PRODUCTION_(?!AUTO_RELEASE_ENABLED)|SUPABASE|RAILWAY|STRIPE|OPENAI|ANTHROPIC|CLAUDE_CODE_OAUTH/)
  assert.doesNotMatch(requestCode, /production-rollback|rollback/i)
  assert.doesNotMatch(requestCode, /approve|reviewers|deployment_protection|environments\//i)
  assert.doesNotMatch(requestCode, /gh pr merge|merge-release-engineer-repair|enable-auto-merge|bypass|rulesets/i)
  assert.doesNotMatch(requestCode, /gh (variable|secret) (set|delete)/)
  assert.match(requestCode, /vars\.PRODUCTION_AUTO_RELEASE_ENABLED/)
})

test('request scripts only read GitHub and never mutate, dispatch, approve or touch variables', () => {
  for (const [name, source] of Object.entries({ policy: scripts.policy, cli: scripts.cli, deps: scripts.deps, version: scripts.version })) {
    const executable = source.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n')
    assert.doesNotMatch(executable, /'--method'|--method|-X ['"]?(PUT|POST|PATCH|DELETE)|workflow run|dispatches|createWorkflowDispatch|git push|gh variable|gh secret|gh release create|gh pr merge/, name)
    assert.doesNotMatch(executable, /psql|supabase|railway/i, name)
  }
  assert.match(scripts.deps, /Every call here is a GET/)
})

test('automation scripts and workflows classify as human-merge only', () => {
  for (const file of [
    '.github/workflows/claude-release-engineer-production-request.yml',
    '.github/workflows/production-auto-rollback-request.yml',
    '.github/workflows/production-release.yml',
    'scripts/production-release-request.mjs',
    'scripts/production-auto-rollback-request.mjs',
    'scripts/production-auto-rollback-policy.mjs',
    'scripts/production-auto-rollback-deps.mjs',
    'scripts/production-release-request-policy.mjs',
    'scripts/production-release-request-deps.mjs',
    'scripts/release-version.mjs',
    'scripts/auto-merge-result.mjs',
  ]) {
    assert.ok(classifyChangedFile(file), `${file} must require a human merge`)
  }
})

test('only the two dedicated request workflows can dispatch Production Release or Rollback', () => {
  for (const file of readdirSync('.github/workflows')) {
    if (['claude-release-engineer-production-request.yml', 'production-auto-rollback-request.yml'].includes(file)) continue
    const source = code(read(`.github/workflows/${file}`)).split('\n').filter((line) => !/disallowedTools/.test(line)).join('\n')
    assert.doesNotMatch(source, /gh workflow run production-(release|rollback)|workflows\/production-(release|rollback)\.yml\/dispatches/, file)
  }
  assert.match(requestCode, /gh workflow run production-release\.yml/)
  assert.doesNotMatch(requestCode, /gh workflow run production-rollback\.yml/)
  const rollbackRequestCode = code(rollbackRequest)
  assert.match(rollbackRequestCode, /gh workflow run production-rollback\.yml/)
  assert.doesNotMatch(rollbackRequestCode, /gh workflow run production-release\.yml/)
})

// ---- Production Release: authority preserved, automated provenance independently verified -----------------------------

test('every production job keeps the `production` Environment (secret scoping) and the shared non-cancelling lock', () => {
  assert.match(release, /concurrency:\n {2}# [^\n]*\n {2}# [^\n]*\n {2}group: production-deploy\n {2}cancel-in-progress: false/)
  const gated = ['resolve-and-verify-eligibility', 'production-db-preflight', 'production-db-migrate', 'deploy-api', 'deploy-web', 'verify-production-release']
  for (const job of gated) assert.match(jobSection(release, job), /environment:/, `${job} keeps its production environment`)
  assert.equal(releaseCode.match(/^\s+environment:/gm).length, gated.length, 'no production job lost or gained an environment')
  assert.doesNotMatch(releaseCode, /continue-on-error|migration repair|--force|environment: staging/)
  // The tag and GitHub Release stay last, behind full production verification.
  assert.match(jobSection(release, 'tag-and-release'), /needs: \[resolve-and-verify-eligibility, compute-version, verify-production-release\]/)
  assert.ok(release.indexOf('verify-production-release:') < release.indexOf('tag-and-release:'))
  assert.equal(release.match(/git tag -a/g).length, 1)
  assert.equal(release.match(/gh release create/g).length, 1)
})

test('Production Release automated mode: optional input, provenance verified in the first production job before anything else', () => {
  assert.match(release, /automation_source_run_id:\n {8}description: [^\n]*\n {8}required: false\n {8}type: string/)
  assert.match(release, /run-name: Production Release \$\{\{ inputs\.release_sha \|\| 'main-tip' \}\}/)
  const job = jobSection(release, 'resolve-and-verify-eligibility')
  assert.match(job, /environment: production/)
  const step = job.slice(job.indexOf('Verify automated request provenance'), job.indexOf('- id: resolve'))
  assert.match(step, /if: inputs\.automation_source_run_id != ''/)
  assert.match(step, /test "\$GITHUB_REF" = refs\/heads\/main\n\s+node scripts\/production-release-request\.mjs release/)
  assert.match(step, /SOURCE_RUN_ID: \$\{\{ inputs\.automation_source_run_id \}\}/)
  assert.match(step, /RELEASE_SHA: \$\{\{ inputs\.release_sha \}\}/)
  assert.match(step, /VERSION_BUMP: \$\{\{ inputs\.version_bump \}\}/)
  assert.match(step, /PRODUCTION_AUTO_RELEASE_ENABLED: \$\{\{ vars\.PRODUCTION_AUTO_RELEASE_ENABLED \}\}/)
  assert.match(step, /GH_TOKEN: \$\{\{ github\.token \}\}/)
  // It runs before eligibility resolution and every production-touching job depends on that job.
  assert.ok(job.indexOf('Verify automated request provenance') < job.indexOf('- id: resolve'))
  for (const downstream of ['compute-version', 'production-db-preflight', 'deploy-api']) {
    assert.match(jobSection(release, downstream), /resolve-and-verify-eligibility/)
  }
  assert.match(release, /^permissions:\n {2}contents: write\n {2}actions: read\n {2}checks: read\n {2}pull-requests: read\n/m)
})

test('manual mode is unchanged: the verification step is skipped unless the automation input is present', () => {
  assert.equal(release.match(/inputs\.automation_source_run_id != ''/g).length, 2) // setup-node + verification only
  assert.match(release, /version_bump:\n {8}description: [^\n]*\n {8}required: true\n {8}type: choice\n {8}default: patch\n {8}options: \[patch, minor, major\]/)
  assert.match(release, /release_sha:\n {8}description: [^\n]*\n {8}required: false/)
  assert.match(release, /requestedSha \|\| currentMainSha/)
})

test('versioning comes from completed GitHub Releases through the tested module, not tags or a v0.0.0 fallback', () => {
  const job = jobSection(release, 'compute-version')
  assert.match(job, /run: node scripts\/release-version\.mjs/)
  assert.match(job, /BUMP: \$\{\{ inputs\.version_bump \}\}/)
  assert.doesNotMatch(release, /v0\.0\.0|git describe/)
  assert.match(job, /sparse-checkout: scripts/)
  assert.doesNotMatch(job, /ref: \$\{\{ needs\.resolve-and-verify-eligibility\.outputs\.target_sha \}\}/)
})

test('Production Release and Rollback authenticate Railway with the account token via RAILWAY_API_TOKEN only', () => {
  for (const [name, workflow] of [['release', release], ['rollback', rollback]]) {
    const wf = code(workflow)
    assert.equal((wf.match(/RAILWAY_API_TOKEN: \$\{\{ secrets\.PRODUCTION_RAILWAY_API_TOKEN \}\}/g) ?? []).length, 4, `${name}: 4 Railway steps use the account token`)
    assert.doesNotMatch(wf, /PRODUCTION_RAILWAY_TOKEN/, `${name}: legacy secret not referenced`)
    assert.doesNotMatch(wf, /^\s*RAILWAY_TOKEN:/m, `${name}: RAILWAY_TOKEN is never set alongside RAILWAY_API_TOKEN`)
    for (const step of wf.split(/\n {6}- name: /).filter((part) => /@railway\/cli/.test(part))) {
      if (/railway\/cli@[\d.]+ variables set/.test(step)) {
        const link = step.match(/railway\/cli@[\d.]+ link --project "\$PRODUCTION_RAILWAY_PROJECT_ID" --environment production --service "\$PRODUCTION_RAILWAY_(API|WEB)_SERVICE_ID"\n/)
        assert.ok(link, `${name}: an account token has no project scope, so variables set needs an explicit link first`)
        assert.doesNotMatch(step.replace(link?.[0] ?? '', ''), /--project/, `${name}: variables set stays free of --project`)
        assert.match(step, /--environment production --service "\$PRODUCTION_RAILWAY_(API|WEB)_SERVICE_ID"/)
      } else {
        assert.match(step, /railway\/cli@[\d.]+ up (apps\/web )?--ci (--path-as-root )?--project "\$PRODUCTION_RAILWAY_PROJECT_ID" --environment production --service "\$PRODUCTION_RAILWAY_(API|WEB)_SERVICE_ID"/)
      }
    }
  }
})

test('Production Release and Rollback upload the repo root for the API (service Root Directory apps/api) but apps/web as the archive root for web (the web service has no Root Directory; a root upload made Railway fall back to Railpack and fail)', () => {
  for (const wf of [releaseCode, code(rollback)]) {
    const ups = wf.match(/railway\/cli@[\d.]+ up\b[^\r\n]*/g) ?? []
    assert.equal(ups.length, 2, 'expected API and web railway up calls')
    const [api, web] = ups
    assert.match(api, /^railway\/cli@[\d.]+ up --ci --project "\$PRODUCTION_RAILWAY_PROJECT_ID" --environment production --service "\$PRODUCTION_RAILWAY_API_SERVICE_ID"$/)
    assert.match(web, /^railway\/cli@[\d.]+ up apps\/web --ci --path-as-root --project "\$PRODUCTION_RAILWAY_PROJECT_ID" --environment production --service "\$PRODUCTION_RAILWAY_WEB_SERVICE_ID"$/)
    assert.equal((wf.match(/--path-as-root/g) ?? []).length, 1, 'only the web upload uses --path-as-root')
  }
})

test('Production Release and Rollback set Railway release variables with --skip-deploys so only `railway up` deploys (a variable-triggered redeploy raced the upload and failed it)', () => {
  for (const wf of [releaseCode, code(rollback)]) {
    const calls = wf.match(/railway\/cli@4\.30\.0 variables set[\s\S]*?--service "[^"]+"[^\n]*/g) ?? []
    assert.equal(calls.length, 2, 'expected API and web variables set calls')
    for (const call of calls) assert.match(call, /--skip-deploys$/)
  }
})

test('Production Rollback is pinned and remains human-only', () => {
  assert.equal(createHash('sha256').update(rollback).digest('hex'), 'eee774c492130f51a8079bafa5db94c847b21ffe2220d8720f1a18e3b8e96c36')
  assert.match(rollback, /on:\n {2}workflow_dispatch:/)
  assert.doesNotMatch(rollback, /automation_source_run_id/)
  assert.match(rollback, /group: production-deploy/)
})

// ---- no human Environment approval is assumed or impersonated; the trusted gates are the safety boundary -----------------

test('no workflow impersonates a human deployment approval and no production file claims a required reviewer', () => {
  for (const file of readdirSync('.github/workflows')) {
    const source = code(read(`.github/workflows/${file}`))
    assert.doesNotMatch(source, /pending_deployments|deployment_protection_rule|environments\/[^\n]*(reviewers|protection)|\/approve\b/i, `${file} never calls the deployment-approval API`)
  }
  for (const [name, text] of [['production-release', release], ['production-rollback', rollback], ['production-request', request]]) {
    assert.doesNotMatch(text, /human (production )?environment approval|awaits? (a )?human|required reviewer|Approve and deploy|Review deployments/i, `${name} asserts no human Environment approval`)
  }
})

test('Production Release keeps every fail-closed gate now that no Environment approval pauses it', () => {
  for (const gate of [
    /main\.data\.commit\.sha/, // resolves the exact requested SHA
    /CI Gate/, /Staging Gate/, // trusted status contexts
    /tree/i, // merged tree identity vs the staging-verified tree
    /production-target-guard|Refuse a non-production/i, // production DB / Railway target guards
    /check-db-drift\.mjs --environment production --allow-pending/, // migration-history/drift verification
    /git checkout --detach/, // exact detached checkout
    /needs: \[[^\]]*deploy-api[^\]]*\]/, // web only after the API deploy
    /verify-production-release/, // final verification before tag/release
  ]) assert.match(releaseCode, gate, `production-release.yml keeps ${gate}`)
  assert.doesNotMatch(releaseCode, /continue-on-error/, 'no soft failure on production-critical jobs')
  // Phase 3A adds exactly one job-level always(): the read-only evidence ledger must run after failures.
  // The pre-existing context-artifact upload remains the only step-level always().
  assert.equal(releaseCode.match(/always\(\)/g).length, 2)
  const ledger = jobSection(release, 'production-release-evidence')
  assert.match(ledger, /if: \$\{\{ always\(\) \}\}/)
  assert.equal((releaseCode.match(/^ {4}if: \$\{\{ always\(\) \}\}$/gm) ?? []).length, 1)
  const cancelGuards = releaseCode.match(/^ {4}if: \$\{\{ !cancelled\(\).*$/gm)
  assert.ok(cancelGuards.length >= 1)
  for (const guard of cancelGuards) assert.match(guard, /\.result == 'success'/, `${guard} requires explicit upstream success`)
  assert.match(releaseCode, /test "\$GITHUB_REF" = refs\/heads\/main/, 'automated provenance verification still pins main')
  assert.match(releaseCode, /node scripts\/production-release-request\.mjs release/)
})

test('Phase 3A ledger is evidence-only, always runs, and has no production authority', () => {
  const ledger = jobSection(release, 'production-release-evidence')
  for (const dep of ['resolve-and-verify-eligibility', 'compute-version', 'release-content-summary', 'production-db-preflight', 'production-db-migrate', 'deploy-api', 'deploy-web', 'verify-production-release', 'tag-and-release']) {
    assert.ok(ledger.includes(`- ${dep}`), `ledger waits for ${dep}`)
  }
  assert.match(ledger, /if: \$\{\{ always\(\) \}\}/)
  assert.match(ledger, /permissions:\n {6}contents: read/)
  assert.doesNotMatch(ledger, /environment: production|secrets\.|PRODUCTION_(SUPABASE|RAILWAY)|supabase|railway|psql|git push|gh release create|production-rollback|create-github-app-token/i)
  assert.match(ledger, /node scripts\/production-release-evidence\.mjs/)
  assert.match(ledger, /name: production-release-evidence/)
  assert.match(ledger, /retention-days: 90/)
  assert.match(ledger, /if-no-files-found: error/)
  assert.match(ledger, /CONTROL_PLANE_SHA: \$\{\{ github\.sha \}\}/)
  assert.match(ledger, /DB_MIGRATE_RESULT: \$\{\{ needs\.production-db-migrate\.result \}\}/)
  assert.match(ledger, /API_RESULT: \$\{\{ needs\.deploy-api\.result \}\}/)
  assert.match(ledger, /WEB_RESULT: \$\{\{ needs\.deploy-web\.result \}\}/)
})

// ---- documentation -------------------------------------------------------------------------------------------------

test('the docs state the authority chain, the first release and that a request is not an approval', () => {
  assert.match(doc, /Phase 2D/)
  assert.match(doc, /Automatic request ≠ automatic production approval/)
  assert.match(doc, /PRODUCTION_AUTO_RELEASE_ENABLED/)
  assert.match(doc, /Deploy Health Check/)
  assert.match(doc, /auto-merge-result/)
  assert.match(doc, /Production Rollback[^\n]*human/i)
  assert.match(releaseProcess, /v1\.8\.0/)
  assert.match(releaseProcess, /Automatic request ≠ automatic production approval/)
  assert.match(releaseProcess, /automation_source_run_id/)
  assert.doesNotMatch(releaseProcess, /v0\.0\.1/)
})

// ---- required CI actually runs the Phase 2D tests ---------------------------------------------------------------------------

test('the required Release Workflow Contract CI job permanently runs the Phase 2D and Phase 3A tests', () => {
  const ci = read('.github/workflows/ci.yml')
  const job = jobSection(ci, 'release-workflow-contract')
  const command = job.match(/run: (node --test [^\n]+)/)[1]
  const files = command.split(/\s+/).slice(2)
  for (const file of [
    'scripts/production-release-request-policy.test.mjs',
    'scripts/production-release-request-workflow.test.mjs',
    'scripts/production-runtime-identity.test.mjs',
    'scripts/production-release-request-cli.test.mjs',
    'scripts/production-release-evidence.test.mjs',
  ]) {
    assert.ok(files.includes(file), `${file} must run in Release Workflow Contract`)
  }
  // The older release-engineer set stays, every listed file exists, and nothing is optional.
  for (const file of ['scripts/staging-candidate-workflow.test.mjs', 'scripts/claude-release-engineer-workflow.test.mjs', 'scripts/release-engineer-auto-merge-policy.test.mjs', 'scripts/release-engineer-auto-merge-workflow.test.mjs', 'scripts/public-smoke.test.mjs']) {
    assert.ok(files.includes(file), `${file} stays in the job`)
  }
  for (const file of files) assert.ok(existsSync(file), `${file} exists`)
  assert.equal(new Set(files).size, files.length, 'no duplicates')
  assert.doesNotMatch(job, /continue-on-error|\n\s+if:/)
  // CI Gate must keep requiring this job.
  const gate = jobSection(ci, 'ci-gate')
  assert.match(gate, /- release-workflow-contract\n/)
  assert.match(gate, /RELEASE_WORKFLOW_CONTRACT: \$\{\{ needs\.release-workflow-contract\.result \}\}/)
  assert.match(gate, /"Release Workflow Contract:\$RELEASE_WORKFLOW_CONTRACT"/)
})

test('production-release job gates are fail-closed and do not propagate an intentionally skipped migration', () => {
  const jobIf = (name) => {
    const match = jobSection(release, name).match(/\n    if: (.+)\n/)
    assert.ok(match, `${name} has an explicit job-level if`)
    return match[1]
  }
  const gated = ['deploy-api', 'deploy-web', 'verify-production-release', 'tag-and-release']
  for (const name of gated) {
    const condition = jobIf(name)
    assert.match(condition, /^\$\{\{ !cancelled\(\) && /, `${name} continues only via !cancelled()`)
    assert.doesNotMatch(condition, /always\(\)/, `${name} must not use always()`)
  }
  for (const name of [...release.matchAll(/\n  ([a-z-]+):\n    (?:name|needs|if|runs-on):/g)].map((m) => m[1]).filter((name) => name !== 'production-release-evidence')) {
    const header = jobSection(release, name).split('\n    steps:')[0]
    assert.doesNotMatch(header, /always\(\)/, `${name} job-level condition must not use always()`)
  }

  const api = jobIf('deploy-api')
  assert.match(api, /needs\.resolve-and-verify-eligibility\.outputs\.eligible == 'true'/)
  assert.match(api, /needs\.production-db-preflight\.result == 'success'/)
  assert.match(api, /\(needs\.production-db-migrate\.result == 'success' \|\| needs\.production-db-migrate\.result == 'skipped'\)/)

  const web = jobIf('deploy-web')
  for (const clause of [
    "needs.resolve-and-verify-eligibility.result == 'success'",
    "needs.resolve-and-verify-eligibility.outputs.eligible == 'true'",
    "needs.compute-version.result == 'success'",
    "needs.deploy-api.result == 'success'",
  ]) assert.ok(web.includes(clause), `deploy-web requires ${clause}`)

  const verify = jobIf('verify-production-release')
  for (const dep of ['resolve-and-verify-eligibility', 'compute-version', 'deploy-api', 'deploy-web']) {
    assert.ok(verify.includes(`needs.${dep}.result == 'success'`), `verification requires ${dep} success`)
  }

  const tag = jobIf('tag-and-release')
  for (const dep of ['resolve-and-verify-eligibility', 'compute-version', 'verify-production-release']) {
    assert.ok(tag.includes(`needs.${dep}.result == 'success'`), `tagging requires ${dep} success`)
  }

  // Only the API gate may tolerate the skipped migration; no other job references it or accepts 'skipped'.
  for (const name of ['deploy-web', 'verify-production-release', 'tag-and-release']) {
    const condition = jobIf(name)
    assert.doesNotMatch(condition, /production-db-migrate/, `${name} must not reference the migration job`)
    assert.doesNotMatch(condition, /'skipped'/, `${name} must not accept a skipped dependency`)
  }
})
