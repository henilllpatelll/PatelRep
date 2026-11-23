// Developer Harness V2 — Phase 6 test catalog.
//
// DATA + VALIDATION ONLY. Every suite here is a thing that ALREADY exists in PatelRep (a CI job, an npm script or a test
// directory); nothing is invented. A command is never assembled from free text: a suite carries structured `steps`
// (`node_bin`, `node_script`, `node_test`, `tsx_test`, `python`) that `validateStep` checks against an allowlist, and the
// runner turns them into an argv ARRAY (never a shell string). Records read from a checkpoint, fixture, PR text or
// model output are DATA and can never add or alter a command: the runner re-derives every command from (suite id, validated
// path params) at execution time. Drift between this file and ci.yml / package.json is caught by catalog.test.mjs.
//
// LOCAL TEST SELECTION IS NON-AUTHORITATIVE. CI Gate and Staging Gate remain required.

export const CATALOG_SCHEMA = 'developer-harness-v2/test-catalog@1'
export const BANNER = 'LOCAL TEST SELECTION — NON-AUTHORITATIVE. CI Gate and Staging Gate remain required.'

/** lightweight: node+git only, runs now. prereq: needs installed deps (never installed here). expensive: explicit per-suite approval. ci_only: never local. */
export const TIERS = Object.freeze(['lightweight', 'prereq', 'expensive', 'ci_only'])
export const LIMITS = Object.freeze({ jestMaxWorkers: 2, maxDbStacks: 1, defaultAutoDbStacks: 0, maxOutputBytes: 256 * 1024, maxSuiteTimeoutMs: 30 * 60 * 1000, nodeOldSpaceMb: 2048, maxDynamicPaths: 200 })

/** Environment the child process may inherit: names only, matched case-insensitively. Nothing else (no tokens, no *_KEY, no SUPABASE_*). */
export const BASE_ENV_ALLOW = Object.freeze(['PATH', 'PATHEXT', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'ALLUSERSPROFILE', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS', 'OS', 'LANG', 'LC_ALL', 'TZ'])
/** Fixed placeholders identical to the `Test / API` job in ci.yml (nothing real; checked against ci.yml by the drift test). */
export const API_TEST_ENV = Object.freeze({
  SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-key', SUPABASE_JWT_SECRET: 'test-jwt-secret-minimum-32-characters-long!!',
  OPENAI_API_KEY: 'test-key', ANTHROPIC_API_KEY: 'test-key', STRIPE_SECRET_KEY: 'sk_test_placeholder', STRIPE_WEBHOOK_SECRET: 'stripe-webhook-secret-test',
  CRON_SECRET: 'test-cron-secret', APP_ENV: 'test', APP_URL: 'http://localhost:3000', API_URL: 'http://localhost:8000',
})
export const ENV_PROFILES = Object.freeze({
  node: Object.freeze({ NODE_OPTIONS: `--max-old-space-size=${LIMITS.nodeOldSpaceMb}` }),
  api_test: Object.freeze({ ...API_TEST_ENV, PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1' }),
})

/** The only node tools the runner will execute from node_modules, and the exact scripts it may run from the repo. */
export const NODE_BINS = Object.freeze({ eslint: 'node_modules/eslint/bin/eslint.js', tsc: 'node_modules/typescript/bin/tsc', jest: 'node_modules/jest/bin/jest.js', tsx: 'node_modules/tsx/dist/cli.mjs' })
export const ALLOWED_NODE_SCRIPTS = Object.freeze(['scripts/check-migrations.mjs', 'scripts/check-feature-flag-registry.mjs', 'scripts/check-frozen-files.mjs', 'scripts/check-contrast.mjs', 'scripts/check-i18n-parity.mjs', 'scripts/verify-i18n-gate.mjs', 'scripts/check-programs-i18n.mjs'])
export const PYTHON_MODULES = Object.freeze(['pytest', 'ruff'])
export const FORBIDDEN_EXECUTABLES = Object.freeze(['docker', 'docker-compose', 'supabase', 'psql', 'gh', 'git', 'railway', 'vercel', 'eas', 'npx', 'npm', 'sh', 'bash', 'cmd', 'powershell', 'pwsh', 'curl', 'wget'])

const SAFE_PATH = /^[A-Za-z0-9_@()[\]+=,. /-]+$/
/** Repo-relative POSIX path that cannot escape, start a flag, or smuggle control characters. */
export function isSafeRepoPath(p) {
  if (typeof p !== 'string' || !p || p.length > 400 || !SAFE_PATH.test(p)) return false
  if (p.startsWith('-') || p.startsWith('/') || p.includes('//') || /^[A-Za-z]:/.test(p)) return false
  return !p.split('/').some((seg) => seg === '..' || seg === '.' || seg === '')
}
const okArg = (a) => typeof a === 'string' && a.length > 0 && a.length <= 4096 && !/[\0\r\n]/.test(a)

const TEST_FILE = /\.test\.(mjs|ts)$/
const PYTEST_FILE = /^tests\/(?:[A-Za-z0-9_]+\/)*test_[A-Za-z0-9_]+\.py$/
const PYTEST_STATIC = new Set(['-v', '-q', '--tb=short', '--no-header', '--ignore=tests/integration', '-p', 'no:cacheprovider'])
const PYTEST_DIRS = new Set(['tests/', 'tests/smoke/', 'tests/integration/'])

/** Problems (stable codes) with one structured step. Empty array means the step is allowlisted. */
export function validateStep(step) {
  const p = []
  if (!step || typeof step !== 'object' || Array.isArray(step)) return ['STEP.NOT_OBJECT']
  const a = step.args ?? []
  if (!Array.isArray(a) || !a.every(okArg)) p.push('STEP.BAD_ARGS')
  switch (step.kind) {
    case 'node_bin': {
      if (!Object.hasOwn(NODE_BINS, step.bin)) { p.push('STEP.BIN_NOT_ALLOWED'); break }
      if (step.bin === 'eslint' && !(a.length === 1 && a[0] === '.')) p.push('STEP.ESLINT_ARGS') // no --fix, --config, --plugin, --rulesdir
      if (step.bin === 'tsc' && !(a.length === 1 && a[0] === '--noEmit')) p.push('STEP.TSC_ARGS')
      if (step.bin === 'jest') {
        const w = a.filter((x) => /^(--maxWorkers|-w$|--workers|--runInBand|-i$)/.test(x))
        if (w.length !== 1 || w[0] !== `--maxWorkers=${LIMITS.jestMaxWorkers}`) p.push('STEP.JEST_WORKERS') // exactly two workers, never more
        if (!a.includes('--ci')) p.push('STEP.JEST_NEEDS_CI') // --ci refuses to write snapshots
        const flags = a.filter((x) => x.startsWith('-'))
        if (flags.some((x) => !['--ci', `--maxWorkers=${LIMITS.jestMaxWorkers}`, '--findRelatedTests'].includes(x))) p.push('STEP.JEST_FLAG_NOT_ALLOWED')
        const i = a.indexOf('--findRelatedTests')
        const rest = i < 0 ? [] : a.slice(i + 1)
        if (i >= 0 && (rest.length === 0 || rest.length > LIMITS.maxDynamicPaths || !rest.every((x) => isSafeRepoPath(x) && /\.(tsx?|jsx?|json)$/.test(x)))) p.push('STEP.JEST_RELATED_PATHS')
        if (a.filter((x) => !x.startsWith('-')).length !== rest.length) p.push('STEP.JEST_POSITIONAL')
      }
      if (step.bin === 'tsx') p.push('STEP.USE_TSX_TEST')
      break
    }
    case 'node_script':
      if (!ALLOWED_NODE_SCRIPTS.includes(step.script)) p.push('STEP.SCRIPT_NOT_ALLOWED')
      if (a.length) p.push('STEP.SCRIPT_ARGS_NOT_ALLOWED')
      break
    case 'node_test': case 'tsx_test':
      if (!Array.isArray(step.files) || !step.files.length || !step.files.every((f) => isSafeRepoPath(f) && TEST_FILE.test(f))) p.push('STEP.TEST_FILES')
      if (a.length) p.push('STEP.TEST_ARGS_NOT_ALLOWED')
      break
    case 'python': {
      if (!PYTHON_MODULES.includes(step.module)) { p.push('STEP.PYTHON_MODULE_NOT_ALLOWED'); break }
      if (step.module === 'ruff' && !(a.length === 3 && a[0] === 'check' && a[1] === '--no-cache' && a[2] === '.')) p.push('STEP.RUFF_ARGS') // never --fix / --add-noqa
      if (step.module === 'pytest') {
        const bad = a.filter((x, i) => !(PYTEST_STATIC.has(x) || PYTEST_DIRS.has(x) || PYTEST_FILE.test(x)) || (x === '-p' && a[i + 1] !== 'no:cacheprovider'))
        if (bad.length) p.push('STEP.PYTEST_ARGS')
        if (!a.some((x) => PYTEST_DIRS.has(x) || PYTEST_FILE.test(x))) p.push('STEP.PYTEST_TARGET_REQUIRED')
      }
      break
    }
    default: p.push('STEP.KIND_NOT_ALLOWED')
  }
  if (step.kind !== 'python' && 'module' in step) p.push('STEP.UNEXPECTED_FIELD')
  const known = new Set(['kind', 'bin', 'script', 'args', 'files', 'module', 'label'])
  if (Object.keys(step).some((k) => !known.has(k))) p.push('STEP.UNKNOWN_FIELD')
  return p
}

/** Problems with a suite definition: structure, tier consistency, and the hard resource rules. */
export function validateSuite(s) {
  const p = []
  if (!s || typeof s !== 'object') return ['SUITE.NOT_OBJECT']
  if (!/^[a-z]+(\.[a-z0-9_]+)+$/.test(s.id ?? '')) p.push('SUITE.BAD_ID')
  if (!TIERS.includes(s.tier)) p.push('SUITE.BAD_TIER')
  if (s.cwd !== '.' && !isSafeRepoPath(s.cwd)) p.push('SUITE.BAD_CWD')
  if (!Object.hasOwn(ENV_PROFILES, s.env)) p.push('SUITE.BAD_ENV')
  if (!(Number.isInteger(s.timeout_ms) && s.timeout_ms > 0 && s.timeout_ms <= LIMITS.maxSuiteTimeoutMs)) p.push('SUITE.BAD_TIMEOUT')
  if (!Array.isArray(s.steps)) p.push('SUITE.BAD_STEPS')
  else for (const [i, st] of s.steps.entries()) for (const c of validateStep(st)) p.push(`${c}@${i}`)
  const r = s.requires ?? {}
  if ((s.tier === 'ci_only' || r.docker || r.db_stack || r.remote_credentials || r.network || r.live_environment) && s.steps?.length) p.push('SUITE.UNSAFE_REQUIREMENT_HAS_STEPS')
  if ((s.tier === 'ci_only' || r.docker || r.db_stack || r.remote_credentials) && !s.blocked) p.push('SUITE.NEEDS_BLOCK_REASON')
  if (s.tier === 'lightweight' && (r.deps || r.approval || r.docker || r.db_stack || r.network)) p.push('SUITE.LIGHTWEIGHT_HAS_REQUIREMENTS')
  if (s.tier === 'expensive' && !s.blocked && !r.approval) p.push('SUITE.EXPENSIVE_NEEDS_APPROVAL_FLAG')
  if (r.db_stack && Number(r.db_stack) > LIMITS.maxDbStacks) p.push('SUITE.TOO_MANY_DB_STACKS')
  return p
}

const L = (s) => s.trim().split(/\s+/)
const RELEASE_CONTRACT = L(`scripts/feature-builder.test.mjs scripts/feature-builder-workflow.test.mjs scripts/feature-orchestrator-policy.test.mjs
scripts/feature-orchestrator-workflow.test.mjs scripts/staging-candidate-workflow.test.mjs scripts/destructive-db-guard.test.mjs
scripts/staging-migration-plan.test.mjs scripts/migration-security-classifier.test.mjs scripts/database-safety-contract.test.mjs
scripts/staging-target-guard.test.mjs scripts/remote-migration-apply.test.mjs scripts/staging-railway-deploy.test.mjs
scripts/claude-release-engineer-workflow.test.mjs scripts/resolve-release-engineer-context.test.mjs scripts/production-monitor-smoke.test.mjs
scripts/recovery-lineage-resolver.test.mjs scripts/publish-release-engineer-repair.test.mjs scripts/release-engineer-auto-merge-policy.test.mjs
scripts/release-engineer-auto-merge-workflow.test.mjs scripts/public-smoke.test.mjs scripts/production-release-request-policy.test.mjs
scripts/production-release-request-workflow.test.mjs scripts/production-release-recorder.test.mjs
scripts/production-release-recorder-workflow.test.mjs scripts/production-release-evidence.test.mjs scripts/production-release-stabilization.test.mjs
scripts/production-release-stabilization-workflow.test.mjs scripts/production-auto-rollback-policy.test.mjs
scripts/production-auto-rollback-workflow.test.mjs scripts/production-auto-rollback-circuit-breaker.test.mjs
scripts/production-rollback-runtime-capture.test.mjs scripts/production-rollback-evidence.test.mjs
scripts/production-rollback-evidence-workflow.test.mjs scripts/production-incident-reentry.test.mjs
scripts/production-incident-reentry-workflow.test.mjs scripts/production-operations-notify.test.mjs
scripts/production-operations-notify-workflow.test.mjs scripts/production-release-audit.test.mjs scripts/production-release-audit-workflow.test.mjs
scripts/release-resilience-drill.test.mjs scripts/release-resilience-drill-workflow.test.mjs scripts/production-recovery-readiness.test.mjs
scripts/production-recovery-readiness-workflow.test.mjs scripts/production-automation-watchdog.test.mjs
scripts/production-automation-watchdog-notify.test.mjs scripts/production-automation-watchdog-workflow.test.mjs
scripts/production-readiness-certification.test.mjs scripts/production-readiness-certification-workflow.test.mjs
scripts/production-runtime-identity.test.mjs scripts/production-release-request-cli.test.mjs scripts/check-db-drift.test.mjs
scripts/audit-production-migration-evidence.test.mjs scripts/production-migration-reconciliation.test.mjs
scripts/production-migration-apply-workspace.test.mjs scripts/staging-migration-apply-workspace.test.mjs
scripts/staging-trusted-control-plane.test.mjs scripts/staging-trusted-execution.test.mjs scripts/staging-reviewed-migration-preview.test.mjs
scripts/staging-reviewed-migration-preview-workflow.test.mjs scripts/dependency-orchestrator-policy.test.mjs
scripts/dependency-orchestrator-engine.test.mjs scripts/dependency-orchestrator-run.test.mjs scripts/dependency-orchestrator-workflow.test.mjs
scripts/ci-gate-room-board.test.mjs scripts/github-actions-upgrade-contract.test.mjs scripts/actions-runtime-contract.test.mjs
scripts/security-scan-contract.test.mjs`)
const DB_STATIC = L(`scripts/check-migrations.test.mjs scripts/build-migration-replay-workspace.test.mjs scripts/check-db-drift.test.mjs
scripts/staging-target-guard.test.mjs scripts/production-target-guard.test.mjs scripts/check-feature-flag-registry.test.mjs
scripts/public-smoke.test.mjs scripts/release-content-summary.test.mjs scripts/remote-migration-apply.test.mjs scripts/destructive-db-guard.test.mjs
scripts/staging-migration-plan.test.mjs scripts/staging-reviewed-migration-preview.test.mjs
scripts/staging-reviewed-migration-preview-workflow.test.mjs scripts/database-safety-contract.test.mjs scripts/staging-candidate-workflow.test.mjs
scripts/audit-production-migration-evidence.test.mjs scripts/production-migration-evidence-workflow.test.mjs
scripts/claude-release-engineer-workflow.test.mjs scripts/resolve-release-engineer-context.test.mjs scripts/production-monitor-smoke.test.mjs
scripts/recovery-lineage-resolver.test.mjs scripts/publish-release-engineer-repair.test.mjs scripts/release-engineer-auto-merge-policy.test.mjs
scripts/release-engineer-auto-merge-workflow.test.mjs scripts/production-release-request-policy.test.mjs
scripts/production-release-request-workflow.test.mjs scripts/production-runtime-identity.test.mjs scripts/production-release-request-cli.test.mjs
scripts/production-migration-reconciliation.test.mjs scripts/production-migration-apply-workspace.test.mjs`)
const WEB_UNIT = L(`e2e/fixtures/staging-fixture-users.test.mjs lib/api/apiUrl.test.ts lib/api/operationalWorkflows.test.ts lib/housekeeping/roomState.test.ts
lib/housekeeping/roomCardView.test.ts lib/housekeeping/roomDetailView.test.ts lib/housekeeping/inspectionWorkflow.test.ts
lib/housekeeping/boardView.test.ts lib/housekeeping/assignmentView.test.ts lib/housekeeping/teamPlanView.test.ts
lib/housekeeping/housekeeperMyRooms.test.ts lib/utils/cleanType.test.ts lib/utils/housekeepingBoardFilters.test.ts
lib/utils/housekeepingDashboardMetrics.test.ts lib/utils/lostFoundInventory.test.ts lib/utils/navigation.test.ts lib/settings/navigation.test.ts
lib/settings/roomsAdmin.test.ts lib/settings/housekeepingConfig.test.ts lib/settings/inspectionTemplates.test.ts lib/settings/slaAndRoles.test.ts
lib/settings/integrationsBilling.test.ts lib/settings/aiBilling.test.ts lib/aiControlCenter/model.test.ts lib/settings/activity.test.ts
lib/settings/preferences.test.ts lib/settings/formResolvers.test.ts scripts/lint-config.test.mjs lib/utils/roomType.test.ts
lib/utils/unifiedTasks.test.ts lib/utils/taskWorkspace.test.ts lib/utils/taskCreation.test.ts lib/utils/taskNextAction.test.ts
lib/utils/taskViews.test.ts lib/utils/taskBulkActions.test.ts lib/utils/copilotRoute.test.ts lib/utils/workOrderQueue.test.ts
lib/utils/roomDownQueue.test.ts lib/utils/preventiveSchedule.test.ts lib/utils/assetWorkspace.test.ts lib/utils/assetReliability.test.ts
lib/utils/logbookCapabilities.test.ts lib/utils/logbookWorkspace.test.ts lib/utils/logbookHandoff.test.ts lib/utils/logbookHistory.test.ts
lib/utils/logbookSearch.test.ts lib/utils/environment.test.ts lib/utils/release.test.ts lib/utils/featureFlag.test.ts
lib/design/designV2Tokens.test.ts lib/design/shellV2.test.ts lib/design/dashboardV2Model.test.ts lib/design/contentRemapV2.test.ts
lib/design/dialogA11yContract.test.ts lib/design/designV2Permanent.test.ts lib/reports/fixtureShape.test.ts lib/utils/routeSegmentLabel.test.ts
lib/utils/tradeLabel.test.ts lib/utils/i18nKeysResolve.test.ts lib/utils/playwrightPhase0Config.test.ts lib/utils/smokeFailures.test.ts
lib/utils/loginMobileOnlyRedirect.test.ts lib/reports/filters.test.ts lib/reports/drawerState.test.ts lib/reports/printOptions.test.ts
lib/reports/exportOptions.test.ts lib/api/staff.test.ts lib/api/clientRateLimit.test.ts lib/people/peopleDirectory.test.ts
lib/people/peopleDrawers.test.ts e2e/fixtures/regression-fixture-auth.test.mjs e2e/fixtures/regression-fixture-status.test.mjs
e2e/regression-login-diagnostics.test.ts e2e/hermetic/mock-backend.test.mjs e2e/hermetic/workflow-fixtures.test.mjs`)
const WEB_FLAG_SCRIPTS = L('scripts/apply-feature-flag.test.mjs scripts/feature-flag-status.test.mjs scripts/verify-feature-rollout.test.mjs scripts/resolve-rollout-config.test.mjs scripts/feature-rollout-workflow.test.mjs')
const H = 'scripts/developer-harness-v2/'
const hf = (...f) => f.map((x) => H + x)
const API_SECURITY = ['tests/smoke/test_tenant_isolation.py', 'tests/smoke/test_rbac_matrix_contract.py', 'tests/smoke/test_bare_role_comparison_guard.py', 'tests/smoke/test_auth_decode.py', 'tests/smoke/test_auth_fixture_claims.py', 'tests/smoke/test_integrations_security.py', 'tests/smoke/test_sop_security.py', 'tests/smoke/test_api_security_rate_limit.py', 'tests/test_roles_access_phase4.py']
const PYTEST_BASE = ['-v', '--tb=short', '-p', 'no:cacheprovider']

const S = (id, title, tier, o = {}) => Object.freeze({ id, title, tier, cwd: '.', areas: [], ci_jobs: [], steps: [], env: 'node', timeout_ms: 10 * 60 * 1000, dynamic: null, requires: {}, blocked: null, discovery: null, note: '', ...o })
const nodeTest = (files) => ({ kind: 'node_test', files })
const ciOnly = (id, title, jobs, reason, requires = {}) => S(id, title, 'ci_only', { ci_jobs: jobs, blocked: { code: 'CI.ONLY', reason }, requires })
const WEB = { cwd: 'apps/web', areas: ['web'] }
const MOB = { cwd: 'apps/mobile', areas: ['mobile'] }
const API = { cwd: 'apps/api', areas: ['api'], env: 'api_test' }

export const SUITES = Object.freeze([
  // ── Developer harness (Phases 1–6): node --test only, no dependencies ──
  S('harness.contract', 'Harness Phase 1 contract tests', 'lightweight', { areas: ['harness'], steps: [nodeTest(hf('contract.test.mjs'))], discovery: 'node_test' }),
  S('harness.policy', 'Harness Phase 2 policy and security regressions', 'lightweight', { areas: ['harness', 'security'], timeout_ms: 15 * 60 * 1000, discovery: 'node_test',
    steps: [nodeTest(hf('policy-engine.test.mjs', 'policy-hook.test.mjs', 'm1-hardening.test.mjs', 'copymove-remediation.test.mjs', 'path-resolution.test.mjs', 'runtime-sandbox-env.test.mjs'))] }),
  S('harness.context', 'Harness Phase 3 context and memory tests', 'lightweight', { areas: ['harness'], discovery: 'node_test',
    steps: [nodeTest(hf('context/archive.test.mjs', 'context/context-packs.test.mjs', 'context/instructions.test.mjs', 'context/memory-curate.test.mjs', 'context/openwolf-hooks.test.mjs'))] }),
  S('harness.routing', 'Harness Phase 4 routing and role tests', 'lightweight', { areas: ['harness', 'security'], discovery: 'node_test', steps: [nodeTest(hf('routing/roles.test.mjs', 'routing/router.test.mjs'))] }),
  S('harness.coordination', 'Harness Phase 5 coordination, checkpoint and recovery tests', 'lightweight', { areas: ['harness'], timeout_ms: 15 * 60 * 1000, discovery: 'node_test', steps: [nodeTest(hf('coordination/coordination.test.mjs'))] }),
  S('harness.testing', 'Harness Phase 6 smart-testing tests', 'lightweight', { areas: ['harness'], timeout_ms: 15 * 60 * 1000, discovery: 'node_test',
    steps: [nodeTest(hf('testing/catalog.test.mjs', 'testing/changes.test.mjs', 'testing/select.test.mjs', 'testing/runner.test.mjs', 'testing/checklist.test.mjs', 'testing/evaluate.test.mjs'))] }),
  // ── Repository workflow / database contracts (node only) ──
  S('repo.release_workflow_contract', 'Release workflow contract tests', 'lightweight', { areas: ['ci-release', 'security'], ci_jobs: ['Release Workflow Contract'], timeout_ms: 15 * 60 * 1000, discovery: 'node_test', steps: [nodeTest(RELEASE_CONTRACT)] }),
  S('repo.feature_flag_registry', 'Feature flag registry parity (API/web)', 'lightweight', { areas: ['api', 'web'], ci_jobs: ['Feature Flag Registry Gate'],
    steps: [{ kind: 'node_script', script: 'scripts/check-feature-flag-registry.mjs' }, nodeTest(['scripts/check-feature-flag-registry.test.mjs'])] }),
  S('repo.mobile_ci_workflow_contract', 'Mobile CI workflow contract', 'lightweight', { areas: ['mobile', 'ci-release'], ci_jobs: ['Mobile CI Workflow Contract'], discovery: 'node_test', steps: [nodeTest(['scripts/mobile-ci-workflow.test.mjs'])] }),
  S('repo.db_static_contract', 'Database and migration static contract tests (npm run db:test)', 'lightweight', { areas: ['database', 'security'], timeout_ms: 15 * 60 * 1000, discovery: 'node_test', steps: [nodeTest(DB_STATIC)] }),
  S('db.migration_history', 'Immutable migration history and destructive SQL review', 'lightweight', { areas: ['database', 'security'], ci_jobs: ['Database Migration Gate'], steps: [{ kind: 'node_script', script: 'scripts/check-migrations.mjs' }] }),
  S('db.replay_and_schema_contracts', 'Migration replay and schema/RLS contracts on a local Supabase stack', 'expensive', { areas: ['database', 'security'], ci_jobs: ['Database Migration Gate'],
    requires: { docker: true, db_stack: 1, approval: true }, blocked: { code: 'DB_STACK.APPROVAL_REQUIRED', reason: 'needs Docker and a disposable local Supabase stack; Phase 6 never starts one (separate human approval, max one stack)' } }),
  S('db.api_integration', 'API integration tests against a migrated local database', 'expensive', { areas: ['database', 'api', 'security'], ci_jobs: ['Database Migration Gate'],
    requires: { docker: true, db_stack: 1, approval: true }, blocked: { code: 'DB_STACK.APPROVAL_REQUIRED', reason: 'needs the migrated local Supabase stack; Phase 6 never starts one' } }),
  // ── API ──
  S('api.ruff', 'API lint (ruff)', 'prereq', { ...API, ci_jobs: ['Lint / API'], requires: { deps: 'api' }, steps: [{ kind: 'python', module: 'ruff', args: ['check', '--no-cache', '.'] }] }),
  S('api.smoke', 'API smoke tests (hermetic, fake Supabase)', 'prereq', { ...API, ci_jobs: ['Test / API'], requires: { deps: 'api' }, timeout_ms: 20 * 60 * 1000, discovery: 'pytest',
    steps: [{ kind: 'python', module: 'pytest', args: ['tests/smoke/', ...PYTEST_BASE] }] }),
  S('api.security_contracts', 'API auth, RBAC and tenant-isolation contract tests (subset of smoke + roles)', 'prereq', { ...API, areas: ['api', 'security'], requires: { deps: 'api' }, discovery: 'pytest',
    steps: [{ kind: 'python', module: 'pytest', args: [...API_SECURITY, ...PYTEST_BASE] }] }),
  S('api.pytest_targeted', 'API pytest files adjacent to the changed domain (not CI-gated)', 'prereq', { ...API, requires: { deps: 'api' }, dynamic: 'pytest_files', discovery: 'pytest',
    note: 'tests/test_*.py are not part of CI Gate; a failure may pre-date the change' }),
  S('api.pytest_full', 'Full API pytest tree without integration (not CI-gated)', 'expensive', { ...API, requires: { deps: 'api', approval: true }, timeout_ms: 30 * 60 * 1000, discovery: 'pytest',
    steps: [{ kind: 'python', module: 'pytest', args: ['tests/', '--ignore=tests/integration', ...PYTEST_BASE] }] }),
  // ── Web ──
  S('web.lint', 'Web ESLint', 'prereq', { ...WEB, ci_jobs: ['Lint + Type-check / Web'], requires: { deps: 'web' }, steps: [{ kind: 'node_bin', bin: 'eslint', args: ['.'] }] }),
  S('web.typecheck', 'Web TypeScript type-check', 'prereq', { ...WEB, ci_jobs: ['Lint + Type-check / Web'], requires: { deps: 'web' }, steps: [{ kind: 'node_bin', bin: 'tsc', args: ['--noEmit'] }] }),
  S('web.unit', 'Web unit tests (npm run test:unit)', 'prereq', { ...WEB, ci_jobs: ['Test / Web unit'], requires: { deps: 'web' }, timeout_ms: 15 * 60 * 1000, discovery: 'node_test', steps: [{ kind: 'tsx_test', files: WEB_UNIT }] }),
  S('web.feature_flag_scripts', 'Web feature-flag rollout script tests (import @supabase/supabase-js)', 'prereq', { ...WEB, ci_jobs: ['Test / Web unit'], requires: { deps: 'web' }, discovery: 'node_test', steps: [nodeTest(WEB_FLAG_SCRIPTS)] }),
  S('web.environment_safety', 'Web environment-validation tests', 'lightweight', { ...WEB, discovery: 'node_test', steps: [nodeTest(['scripts/validate-environment.test.mjs'])] }),
  S('web.frozen_files', 'Frozen-file and room-status-value guard', 'lightweight', { ...WEB, ci_jobs: ['Frozen-File Guard'], steps: [{ kind: 'node_script', script: 'scripts/check-frozen-files.mjs' }] }),
  S('web.contrast', 'Dark-mode contrast gate', 'lightweight', { ...WEB, ci_jobs: ['Dark-Mode Contrast Gate'], steps: [{ kind: 'node_script', script: 'scripts/check-contrast.mjs' }] }),
  S('web.i18n_parity', 'EN/ES i18n parity, i18n gate and floor-copy checks', 'prereq', { ...WEB, ci_jobs: ['EN/ES i18n Parity'], requires: { deps: 'web' },
    steps: [{ kind: 'node_script', script: 'scripts/check-i18n-parity.mjs' }, { kind: 'node_script', script: 'scripts/verify-i18n-gate.mjs' }, { kind: 'node_script', script: 'scripts/check-programs-i18n.mjs' }] }),
  S('web.build', 'Web production build (next build with placeholder env)', 'expensive', { ...WEB, ci_jobs: ['Build / Web'], requires: { deps: 'web', approval: true },
    blocked: { code: 'RUNNER.NOT_AUTOMATED', reason: 'heavy build; not automated in Phase 6 — CI Build / Web is authoritative' } }),
  S('web.hermetic', 'Room-Board hermetic visual regression (Playwright against a mock origin)', 'expensive', { ...WEB, ci_jobs: ['Room-Board Hermetic Visual Regression'], requires: { deps: 'web', browser: true, approval: true },
    blocked: { code: 'RUNNER.NOT_AUTOMATED', reason: 'builds the app and launches a browser; not automated in Phase 6 — CI is authoritative' } }),
  // ── Mobile ──
  S('mobile.typecheck', 'Mobile TypeScript type-check', 'prereq', { ...MOB, ci_jobs: ['Mobile / Type-check'], requires: { deps: 'mobile' }, steps: [{ kind: 'node_bin', bin: 'tsc', args: ['--noEmit'] }] }),
  S('mobile.lint', 'Mobile ESLint', 'prereq', { ...MOB, ci_jobs: ['Mobile / Lint'], requires: { deps: 'mobile' }, steps: [{ kind: 'node_bin', bin: 'eslint', args: ['.'] }] }),
  S('mobile.jest_related', 'Mobile Jest for tests related to the changed files (2 workers)', 'prereq', { ...MOB, ci_jobs: ['Mobile / Jest'], requires: { deps: 'mobile' }, dynamic: 'jest_related', discovery: 'jest', timeout_ms: 25 * 60 * 1000 }),
  S('mobile.jest_full', 'Mobile Jest, full suite (2 workers)', 'expensive', { ...MOB, ci_jobs: ['Mobile / Jest'], requires: { deps: 'mobile', approval: true }, timeout_ms: 30 * 60 * 1000, discovery: 'jest',
    steps: [{ kind: 'node_bin', bin: 'jest', args: ['--ci', `--maxWorkers=${LIMITS.jestMaxWorkers}`] }] }),
  // ── CI-only: need a runner, network, secrets, a live environment or a Docker stack ──
  ciOnly('ci.security_scan', 'Dependency vulnerability scan (pip-audit / npm audit)', ['Security Scan'], 'needs network and advisory databases', { network: true }),
  ciOnly('ci.web_public_smoke', 'Web public login-readiness smoke (Playwright)', ['Test / Web public smoke'], 'builds the app and drives a browser', { browser: true }),
  ciOnly('ci.pixel_diff', 'Room-Board pixel-diff regression', ['Room-Board Pixel-Diff Regression'], 'compares against a deployed environment; never run automatically', { live_environment: true }),
  ciOnly('ci.supabase_cli_apply', 'Supabase CLI apply contract', ['Supabase CLI Apply Contract'], 'needs the pinned Supabase CLI and Docker', { docker: true }),
  ciOnly('ci.actions_runtime_contract', 'Actions runtime contract (produce/consume)', ['Actions Runtime Contract / produce', 'Actions Runtime Contract / consume'], 'needs GitHub Actions artifact services'),
  ciOnly('ci.deploy_check', 'Deployment drift check', ['Deploy'], 'compares deployed environments', { live_environment: true }),
  ciOnly('ci.gate', 'CI Gate (aggregate of every required job)', ['CI Gate'], 'the authoritative aggregate; only GitHub can produce it'),
])

export const SUITE_BY_ID = Object.freeze(Object.fromEntries(SUITES.map((s) => [s.id, s])))
export const getSuite = (id) => SUITE_BY_ID[id] ?? null
/** Older job names that mean the same job today. */
export const JOB_ALIASES = Object.freeze({ 'Lint Web': 'Lint + Type-check / Web' })
export const jobToSuites = (job) => SUITES.filter((s) => s.ci_jobs.includes(JOB_ALIASES[job] ?? job)).map((s) => s.id)
export const CI_JOBS = Object.freeze([...new Set(SUITES.flatMap((s) => s.ci_jobs))])
export const CI_ONLY_SUITE_IDS = Object.freeze(SUITES.filter((s) => s.tier === 'ci_only').map((s) => s.id))
export const LISTS = Object.freeze({ RELEASE_CONTRACT, DB_STATIC, WEB_UNIT, WEB_FLAG_SCRIPTS, API_SECURITY })
