// Developer Harness V2 — Phase 6 selection rules (data only).
//
// Each rule maps a changed PATH to suites, tags and escalations with a stable reason code. Rules are ADDITIVE: the selector
// takes the union over every rule that matches every changed path, so a high-risk file can never select fewer suites than
// an ordinary file in the same place, and adding a file can never shrink a selection (tested as monotonicity).
// Only paths are read — never file content — and no model is consulted: deterministic rules own the result.
import { SECURITY_TRIGGERS } from '../routing/router.mjs'
import { SUITES } from './catalog.mjs'

const RE = (re) => (p) => re.test(p)
export const HARNESS_ALL = Object.freeze(['harness.contract', 'harness.policy', 'harness.context', 'harness.routing', 'harness.coordination', 'harness.evaluation', 'harness.testing'])
export const REPO_NODE = Object.freeze(['repo.release_workflow_contract', 'repo.feature_flag_registry', 'repo.db_static_contract', 'repo.mobile_ci_workflow_contract', 'db.migration_history'])
export const WEB_ALL = Object.freeze(['web.lint', 'web.typecheck', 'web.unit', 'web.feature_flag_scripts', 'web.environment_safety', 'web.frozen_files', 'web.contrast', 'web.i18n_parity', 'web.build', 'web.hermetic'])
export const API_CORE = Object.freeze(['api.ruff', 'api.smoke'])
export const API_SHARED = Object.freeze(['api.ruff', 'api.smoke', 'api.security_contracts', 'api.pytest_full'])
export const MOBILE_ALL = Object.freeze(['mobile.typecheck', 'mobile.lint', 'mobile.jest_related', 'mobile.jest_full'])
export const DB_ALL = Object.freeze(['db.migration_history', 'repo.db_static_contract', 'repo.release_workflow_contract', 'db.replay_and_schema_contracts', 'db.api_integration'])
export const CI_CONTROL = Object.freeze(['repo.release_workflow_contract', 'repo.mobile_ci_workflow_contract', 'repo.db_static_contract', 'repo.feature_flag_registry', 'web.feature_flag_scripts', 'harness.contract', 'harness.policy'])
export const CROSS_AUTH = Object.freeze(['api.security_contracts', 'api.smoke', 'web.unit', 'web.typecheck', 'mobile.typecheck', 'mobile.jest_full'])
export const FALLBACK_LIGHTWEIGHT = 'ALL_LIGHTWEIGHT'
/** Docs have no executable effect, but repository-scanning node guards (contract tests, frozen-file and contrast gates) read them or the tree around them. */
export const DOCS_GUARDS = Object.freeze(['repo.release_workflow_contract', 'repo.feature_flag_registry', 'repo.db_static_contract', 'repo.mobile_ci_workflow_contract', 'db.migration_history', 'web.frozen_files', 'web.contrast', 'web.feature_flag_scripts', 'web.environment_safety'])
/** ci.yml defines every job, so changing it can change what any suite does. */
export const SUITES_WITH_CI_JOBS = Object.freeze(SUITES.filter((s) => s.ci_jobs.length > 0 && s.id !== 'ci.deploy_check').map((s) => s.id))

/** A path that is a test, a fixture or test configuration (for deleted-coverage and test-config rules). */
export const isTestPath = (p) => /(^|\/)(__tests__|tests?|e2e|fixtures)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$|_test\.py$|(^|\/)conftest\.py$/i.test(p)
const area = (p) => (/^apps\/api\//.test(p) ? 'api' : /^apps\/web\//.test(p) ? 'web' : /^apps\/mobile\//.test(p) ? 'mobile' : /^(scripts\/developer-harness-v2\/|docs\/developer-harness-v2\/|\.claude\/|\.wolf\/)/.test(p) ? 'harness' : /^(scripts\/|\.github\/|supabase\/)/.test(p) ? 'repo' : 'other')
/** The suites that lose coverage when a test file of this area disappears: the whole area, never just the nearest suite. */
export const LOST_TEST_SUITES = Object.freeze({ api: ['api.smoke', 'api.pytest_full', 'api.ruff'], web: ['web.unit', 'web.hermetic', 'web.lint', 'web.typecheck'], mobile: ['mobile.jest_full', 'mobile.typecheck', 'mobile.lint'], harness: HARNESS_ALL, repo: ['repo.release_workflow_contract', 'repo.db_static_contract', 'repo.feature_flag_registry'], other: [FALLBACK_LIGHTWEIGHT] })
export const testAreaOf = area

const WEB_SRC = /^apps\/web\/(app|components|lib|hooks|styles|types|messages|locales|public|middleware|src|utils|config|i18n|contexts|providers|store|stores)\//
const MOB_SRC = /^apps\/mobile\/(app|components|lib|stores|i18n|scripts|assets|hooks|constants|theme|types|contexts|providers)\//

/** Path rules in evaluation order. All matching rules apply (union). `inert` marks paths with no executable effect. */
export const RULES = Object.freeze([
  { id: 'ARTIFACT.GENERATED_OR_BINARY', match: RE(/(^graphify-out\/|^node\/|^node\.tar\.xz$|(^|\/)\.tmp-[^/]+\.(png|xml|jpg|json|txt)$|^[^/]+\.(png|jpe?g|gif|webp|html|zip|tar\.xz|log)$)/i), inert: true },
  { id: 'DOCS.MAY_BE_CONTRACT_INPUT', match: RE(/^(docs\/(?!developer-harness-v2\/|staging-previews\/)|\.planning\/)|\.md$/i), suites: DOCS_GUARDS, tags: ['docs'], when: (p) => !/(^|\/)(CLAUDE|AGENTS)\.md$/.test(p) && !/^docs\/developer-harness-v2\//.test(p) },
  { id: 'DB.STAGING_PREVIEW_DOCS', match: RE(/^docs\/staging-previews\//), suites: ['repo.release_workflow_contract', 'repo.db_static_contract', 'db.migration_history'], tags: ['database', 'security'], escalate: ['SECURITY_REVIEW_REQUIRED', 'CI_AUTHORITATIVE_REQUIRED'] },
  { id: 'HARNESS.CONTROL_PLANE', match: RE(/^(scripts\/developer-harness-v2\/|docs\/developer-harness-v2\/|\.claude\/|\.carl\/|\.mcp\.json$|\.wolf\/hooks\/|\.wolf\/(OPENWOLF\.md|config\.json|cron-manifest\.json|cerebrum\.md|knowledge\/|anatomy\.md|buglog\.json|reframe-frameworks\.md|identity\.md)|\.vscode\/)|(^|\/)(CLAUDE|AGENTS)\.md$/i), suites: HARNESS_ALL, tags: ['harness', 'security'], escalate: ['SECURITY_REVIEW_REQUIRED'] },
  { id: 'HARNESS.WOLF_STATE', match: RE(/^\.wolf\//), suites: ['harness.context', 'harness.contract'], tags: ['harness'] },
  { id: 'CI.WORKFLOWS_AND_HOOKS', match: RE(/^(\.github\/|\.githooks\/|\.husky\/)/), suites: CI_CONTROL, tags: ['ci-release', 'security'], escalate: ['SECURITY_REVIEW_REQUIRED', 'CI_AUTHORITATIVE_REQUIRED'] },
  { id: 'CI.PIPELINE_DEFINITION', match: RE(/^\.github\/workflows\/ci\.yml$/), suites: SUITES_WITH_CI_JOBS, tags: ['ci-release'], escalate: ['SECURITY_REVIEW_REQUIRED', 'CI_AUTHORITATIVE_REQUIRED'] },
  { id: 'CI.MOBILE_PIPELINE_DEFINITION', match: RE(/^\.github\/workflows\/mobile-ci\.yml$/), suites: MOBILE_ALL.concat(['repo.mobile_ci_workflow_contract']), tags: ['ci-release'], escalate: ['SECURITY_REVIEW_REQUIRED', 'CI_AUTHORITATIVE_REQUIRED'] },
  { id: 'REPO.SCRIPTS', match: RE(/^scripts\/(?!developer-harness-v2\/)/), suites: ['repo.release_workflow_contract', 'repo.db_static_contract', 'repo.feature_flag_registry'], tags: ['ci-release'], escalate: ['SECURITY_REVIEW_REQUIRED', 'CI_AUTHORITATIVE_REQUIRED'] },
  { id: 'REPO.DB_SCRIPTS', match: RE(/^scripts\/[^/]*(migration|schema|db-|-db|database)[^/]*$/i), suites: DB_ALL, tags: ['database', 'security'], escalate: ['MIGRATION_NOT_LIGHTWEIGHT'] },
  { id: 'DB.SUPABASE', match: RE(/^supabase\//), suites: DB_ALL.concat(['api.smoke', 'api.security_contracts']), tags: ['database', 'security', 'tenant_isolation'], escalate: ['MIGRATION_NOT_LIGHTWEIGHT', 'SECURITY_REVIEW_REQUIRED', 'DB_STACK_APPROVAL_REQUIRED'] },
  { id: 'DB.MIGRATION_HISTORY_MUTATION', match: RE(/^supabase\/migrations\//), when: (p, e) => e.status !== 'A' || Boolean(e.old_path), escalate: ['MIGRATION_HISTORY_MUTATION'] },
  { id: 'ROOT.CONFIG', match: RE(/^(package(-lock)?\.json|\.gitignore|\.gitattributes|\.editorconfig|\.nvmrc|\.npmrc|tsconfig[^/]*\.json|playwright[^/]*\.config\.[a-z]+|vercel\.json|railway\.toml|nixpacks[^/]*)$/), suites: REPO_NODE.concat(['harness.contract', 'web.typecheck', 'mobile.typecheck']), tags: ['config'], escalate: ['SECURITY_REVIEW_REQUIRED'] },
  { id: 'ROOT.E2E_LIVE', match: RE(/^e2e\//), suites: ['ci.web_public_smoke', 'ci.pixel_diff'], tags: ['e2e'], gap: { code: 'COVERAGE.CI_ONLY', note: 'root e2e drives deployed environments; never run automatically' } },
  // ── API ──
  // Added from corpus evidence: manifest-only diffs failed jobs of OTHER surfaces (e.g. Mobile / Jest on a Python requirements change).
  { id: 'DEP.ANY_MANIFEST_SHARED_TOOLCHAIN', match: RE(/(^|\/)(requirements[^/]*\.txt|package(-lock)?\.json)$/), suites: SUITES_WITH_CI_JOBS, tags: ['dependency'] },
  { id: 'API.DEPENDENCIES', match: RE(/^apps\/api\/requirements[^/]*\.txt$/), suites: API_SHARED.concat(['ci.security_scan']), tags: ['dependency'] },
  { id: 'API.TEST_CONFIG', match: RE(/^apps\/api\/(pytest\.ini|conftest\.py|pyrightconfig\.json|setup\.cfg|tox\.ini|ruff\.toml|pyproject\.toml|tests\/conftest\.py)$/), suites: API_SHARED, tags: ['test_config'] },
  { id: 'API.SMOKE_TEST', match: RE(/^apps\/api\/tests\/smoke\//), suites: ['api.ruff', 'api.smoke'], tags: ['test'] },
  { id: 'API.INTEGRATION_TEST', match: RE(/^apps\/api\/tests\/integration\//), suites: ['api.ruff', 'api.smoke', 'db.api_integration', 'db.replay_and_schema_contracts'], tags: ['test', 'database'], escalate: ['DB_STACK_APPROVAL_REQUIRED'] },
  { id: 'API.ROOT_TEST', match: RE(/^apps\/api\/tests\/(?!smoke\/|integration\/|fixtures\/|sql\/|load\/)[^/]+\.py$/), suites: ['api.ruff', 'api.smoke', 'api.pytest_targeted'], tags: ['test'] },
  { id: 'API.TEST_SUPPORT', match: RE(/^apps\/api\/tests\/(fixtures|sql|load)\//), suites: API_SHARED, tags: ['test'] },
  { id: 'API.SOURCE', match: RE(/^apps\/api\/(routers|services|models|schemas|core|middleware|scripts)\/.*\.py$|^apps\/api\/[^/]+\.py$/), suites: ['api.ruff', 'api.smoke', 'api.pytest_targeted'], tags: ['api'] },
  { id: 'API.RUNTIME_USED_BY_INTEGRATION_TESTS', match: RE(/^apps\/api\/(routers|services|models|schemas|core|middleware)\/.*\.py$|^apps\/api\/main\.py$/), suites: ['db.api_integration'], escalate: ['DB_STACK_APPROVAL_REQUIRED'] },
  { id: 'API.SHARED_RUNTIME', match: RE(/^apps\/api\/(core|middleware|models|schemas)\/|^apps\/api\/main\.py$|^apps\/api\/services\/(policy|ai|opera)/), suites: API_SHARED, tags: ['shared'] },
  { id: 'API.CLIENT_CONTRACT', match: RE(/^apps\/api\/(routers|models|schemas|main\.py)/), suites: ['web.typecheck', 'mobile.typecheck'], tags: ['client_contract'] },
  { id: 'API.RBAC_DATA', match: RE(/^apps\/api\/(RBAC-MATRIX\.md|rbac_bare_comparison_allowlist\.json)$/), suites: ['api.security_contracts', 'api.smoke'], tags: ['security'] },
  { id: 'API.DEPLOY', match: RE(/^apps\/api\/(Dockerfile|railway\.toml|\.dockerignore)$/), suites: ['api.smoke'], tags: ['deploy'], escalate: ['SECURITY_REVIEW_REQUIRED'] },
  { id: 'API.ENV', match: RE(/^apps\/api\/\.env/), tags: ['secrets'], escalate: ['SECURITY_REVIEW_REQUIRED'], suites: ['api.smoke'] },
  // ── Web ──
  { id: 'WEB.DEPENDENCIES', match: RE(/^apps\/web\/(package(-lock)?\.json|\.npmrc|\.nvmrc)$/), suites: WEB_ALL.concat(['ci.security_scan']), tags: ['dependency'] },
  { id: 'WEB.CONFIG', match: RE(/^apps\/web\/(eslint\.config\.[a-z]+|\.eslintrc[^/]*|tsconfig[^/]*\.json|next\.config\.[a-z]+|postcss\.config\.[a-z]+|tailwind\.config\.[a-z]+|playwright[^/]*\.config\.[a-z]+|components\.json|frozen-files[^/]*\.json|next-env\.d\.ts|vercel\.json|Dockerfile|railway\.toml)$/), suites: WEB_ALL, tags: ['config'] },
  { id: 'WEB.TEST', match: RE(/^apps\/web\/(e2e\/|.*\.test\.[a-z]+$|.*\/__tests__\/)/), suites: ['web.unit', 'web.lint', 'web.typecheck'], tags: ['test'] },
  { id: 'WEB.E2E_SNAPSHOTS', match: RE(/^apps\/web\/e2e\/.*(snapshots?|baseline)[^/]*(\/|\.)|^apps\/web\/e2e\/hermetic\//i), suites: ['web.hermetic', 'ci.pixel_diff', 'web.unit', 'web.frozen_files', 'web.contrast'], tags: ['visual'] },
  { id: 'WEB.SCRIPTS', match: RE(/^apps\/web\/scripts\//), suites: ['web.lint', 'web.typecheck', 'web.unit', 'web.feature_flag_scripts', 'web.environment_safety', 'web.frozen_files', 'web.contrast', 'web.i18n_parity'], tags: ['scripts'] },
  { id: 'WEB.SOURCE', match: RE(WEB_SRC), suites: ['web.lint', 'web.typecheck', 'web.unit', 'web.frozen_files', 'web.contrast', 'web.i18n_parity', 'web.build', 'web.hermetic'], tags: ['web'] },
  { id: 'WEB.LOCALES', match: RE(/^apps\/web\/.*\/(locales?|messages|i18n)\//i), suites: ['web.i18n_parity', 'web.unit'], tags: ['i18n'] },
  // ── Mobile ──
  { id: 'MOBILE.DEPENDENCIES', match: RE(/^apps\/mobile\/(package(-lock)?\.json|\.npmrc)$/), suites: MOBILE_ALL, tags: ['dependency'] },
  { id: 'MOBILE.CONFIG', match: RE(/^apps\/mobile\/(app\.json|eas\.json|babel\.config\.js|metro\.config\.js|jest\.config\.js|jest\.setup\.js|eslint\.config\.mjs|tsconfig\.json|google-services\.json|\.easignore|\.env\.example)$/), suites: MOBILE_ALL, tags: ['config'] },
  { id: 'MOBILE.DEPLOY_CONFIG', match: RE(/^apps\/mobile\/(app\.json|eas\.json|google-services\.json)$/), tags: ['deploy'], escalate: ['SECURITY_REVIEW_REQUIRED'] },
  { id: 'MOBILE.TEST', match: RE(/^apps\/mobile\/__tests__\//), suites: MOBILE_ALL, tags: ['test'] },
  { id: 'MOBILE.SOURCE', match: RE(MOB_SRC), suites: MOBILE_ALL, tags: ['mobile'] },
])

/** Source-surface suites for a changed domain, used to select ADJACENT surfaces (e.g. an API change also selects web and mobile). */
export const SURFACE_SUITES = Object.freeze({ api: ['api.smoke', 'api.pytest_targeted'], web: ['web.unit', 'web.typecheck'], mobile: ['mobile.jest_full', 'mobile.typecheck'] })

/** Product domains: path and test-name patterns plus the regression behaviours they protect (consumed by the checklist). */
export const DOMAINS = Object.freeze([
  { id: 'housekeeping', path: /housekeep|room[_-]?(status|board|readiness|sequenc|unavail|down)|clean|assignment|inspection|my[_-]?rooms|team[_-]?plan|breakout|reclean|linen/i, tests: /housekeeping|assignment|room_|clean|inspection|my_rooms|reclean|readiness|linen/i },
  { id: 'engineering', path: /work[_-]?orders?|engineering|preventive|(^|[/_-])pm([/_.-]|$)|asset|inventory|maintenance|repair|spare|parts|condition[_-]?monitor|failure[_-]?predict/i, tests: /work_order|engineering|(^|_)pm_|asset|inventory|repair|condition|failure|prediction|parts/i },
  { id: 'guest_requests', path: /guest|lost[_-]?found|service[_-]?recovery|escalation/i, tests: /guest|lost_found|recovery|escalation/i },
  { id: 'tasks', path: /(^|[/_-])tasks?([/_.-]|$)|blockers|recurrence|unified[_-]?tasks/i, tests: /(^|_)task_|tasks?_/i },
  { id: 'scheduling', path: /schedul|shifts?|staff(ing)?|availability|leave|swaps?|coverage|forecast|people/i, tests: /schedul|shift|staff|availability|leave|swap|coverage|forecast|people/i },
  { id: 'logbook', path: /logbook|handoff|(^|[/_-])sops?([/_.-]|$)/i, tests: /logbook|shift_handoff|sop/i },
  { id: 'billing_ai', path: /billing|credits?|stripe|usage|true[_-]?up|(^|[/_-])ai[_-]|copilot|agent/i, tests: /billing|(^|_)ai_|copilot|credit|usage|agent/i },
  { id: 'integrations', path: /opera|twilio|sms|webhook|integration|sftp/i, tests: /opera|twilio|integration|webhook|sftp/i },
  { id: 'reports', path: /reports?|(^|[/_-])roi|insights|analytics/i, tests: /report|roi|insights/i },
  { id: 'notifications', path: /notif|push[_-]?token|(^|[/_-])push([/_.-]|$)/i, tests: /notif|push/i },
  { id: 'auth_access', path: /auth|login|session|jwt|rbac|permission|roles?([/_.-]|$)|tenant|hotel[_-]?id/i, tests: /auth|rbac|roles_access|bare_role|tenant|security/i },
  { id: 'settings', path: /settings|feature[_-]?flag|rooms[_-]?master/i, tests: /settings|feature_flags|rooms_master/i },
])
export const domainsOf = (p) => DOMAINS.filter((d) => d.path.test(p)).map((d) => d.id)

const splitCamel = (f) => f.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
/** Phase 4's authoritative security path triggers, reused unchanged. */
export const securityTriggersFor = (p) => SECURITY_TRIGGERS.filter((t) => t.paths.test(p) || t.paths.test(splitCamel(p))).map((t) => t.id)
/** Extra suites a security trigger adds on top of whatever the area rules selected (additive only). */
export const TRIGGER_SUITES = Object.freeze({
  'SEC.AUTHN_AUTHZ': CROSS_AUTH, 'SEC.RBAC': CROSS_AUTH, 'SEC.RLS_TENANT': CROSS_AUTH, 'SEC.PAYMENTS': ['api.smoke', 'api.pytest_targeted'],
  'SEC.CUSTOMER_AGENT_HARNESS': ['api.smoke', 'api.pytest_full', 'db.api_integration'], 'SEC.MIGRATIONS': DB_ALL, 'SEC.DB_PRIVILEGES': DB_ALL,
  'SEC.CLAUDE_CONTROL': HARNESS_ALL, 'SEC.HARNESS_POLICY': HARNESS_ALL, 'SEC.WORKFLOWS_GATES': CI_CONTROL, 'SEC.DEPLOYMENT': ['repo.release_workflow_contract'],
  'SEC.RELEASE_ROLLBACK': CI_CONTROL, 'SEC.AUTOMERGE_RECOVERY': CI_CONTROL, 'SEC.REPO_CONTROLS': CI_CONTROL, 'SEC.SECRETS': ['ci.security_scan'],
})
export const FEATURE_FLAG_PATH = /(^|[/_.-])(feature[_-]?flags?|flags?)([/_.-]|$)/i
