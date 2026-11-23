// Developer Harness V2 — Phase 6 regression checklist.
//
// Turns a selection into a human checklist of behaviours that may regress, each tied to the REAL PatelRep module that makes it
// adjacent, the automated suites selected for it (if any) and what evidence would establish a pass. Manual items are never
// reported as verified: `manual_status` is always NOT_VERIFIED and automated outcomes are attached only from actual results.
// Environments named here are local/hermetic only — never staging or production, and never apps/api/.env (it can point at production).
const LOCAL = 'localhost with hermetic/mock data (never staging or production)'
const CI = 'GitHub CI Gate and Staging Gate for this exact head SHA'

/** Items: `when(ctx)` decides relevance from the selection facts; `suites` lists candidate automated coverage. */
const ITEMS = [
  { id: 'AUTH.LOGIN_AND_SESSION', when: (c) => c.tag('SEC.AUTHN_AUTHZ') || c.domain('auth_access'),
    behavior: 'Web and mobile login, token refresh and the hotel_id/role claims baked in at login still work for every role',
    why: 'authentication/session code is shared by apps/api (core, middleware, routers), apps/web login and apps/mobile session handling',
    suites: ['api.security_contracts', 'web.unit', 'web.typecheck', 'mobile.jest_full', 'mobile.typecheck'], manual: true, env: LOCAL,
    evidence: 'listed suites PASSED at this head/tree; manual login as each of the six roles recorded by a human, plus an unauthenticated request being refused' },
  { id: 'TENANT.CROSS_HOTEL_NEGATIVE', when: (c) => c.tag('SEC.RLS_TENANT') || c.tag('tenant_isolation') || c.path(/hotel[_-]?id|tenant/i),
    behavior: 'A user of hotel A cannot read or write hotel B data through any changed query, route or policy',
    why: 'every Supabase query must scope to hotel_id; RLS is only a second layer',
    suites: ['api.smoke', 'api.security_contracts', 'db.replay_and_schema_contracts', 'db.api_integration'], manual: true, env: 'unit tests locally; RLS needs a disposable local database stack (separate approval)',
    evidence: 'tests/smoke/test_tenant_isolation.py PASSED, and the cross-tenant negative cases run against a migrated disposable database or CI' },
  { id: 'RBAC.ROLE_GATING', when: (c) => c.tag('SEC.RBAC') || c.path(/routers\/|rbac|require_role/i) && c.surface('api'),
    behavior: 'Each route is still reachable only by the roles in the RBAC matrix (housekeeper, engineer, supervisors, chief_engineer, front_desk, gm)',
    why: 'new or edited routes must carry require_role and the matrix is regenerated from the code',
    suites: ['api.security_contracts', 'api.smoke'], manual: true, env: 'unit tests locally', evidence: 'api.security_contracts PASSED; RBAC-MATRIX.md regenerated last if routes changed' },
  { id: 'DB.MIGRATION_FORWARD_ONLY', when: (c) => c.tag('database') || c.esc('MIGRATION_NOT_LIGHTWEIGHT'),
    behavior: 'Schema changes are new forward-only migrations; history, RLS and tenant isolation are preserved',
    why: 'migrations are not an ordinary edit: they change shared state for every surface and cannot be rolled back by reverting code',
    suites: ['db.migration_history', 'repo.db_static_contract', 'db.replay_and_schema_contracts', 'db.api_integration'], manual: true, env: 'static checks locally; replay needs a disposable local stack with separate human approval; never a remote database',
    evidence: 'check-migrations and the db contract tests PASSED; replay result from an approved disposable stack or CI Database Migration Gate' },
  { id: 'HOUSEKEEPING.ROOM_STATE_AND_ASSIGNMENT', when: (c) => c.domain('housekeeping'),
    behavior: 'Room status transitions, assignment visibility and supervisor Room Board / Assignments / My Rooms flows still agree',
    why: 'room_status and room_assignments are read by the API, the web Room Board and the mobile My Rooms and supervisor screens',
    suites: ['api.smoke', 'api.pytest_targeted', 'web.unit', 'mobile.jest_full', 'web.hermetic'], manual: true, env: LOCAL,
    evidence: 'listed suites PASSED; a human walks assign → clean → inspect → release in the hermetic harness' },
  { id: 'ENGINEERING.WORK_ORDERS_AND_ASSETS', when: (c) => c.domain('engineering'),
    behavior: 'Work-order lifecycle, task views, preventive-maintenance scheduling and asset/room-unavailability links still behave',
    why: 'work orders drive task views, PM schedules, parts consumption and room availability across API, web and mobile',
    suites: ['api.smoke', 'api.pytest_targeted', 'web.unit', 'mobile.jest_full'], manual: true, env: LOCAL, evidence: 'listed suites PASSED; manual create → assign → complete of a work order with an asset link' },
  { id: 'GUEST.REQUESTS_AND_RECOVERY', when: (c) => c.domain('guest_requests'),
    behavior: 'Guest requests, lost & found and service-recovery escalation keep their routing and permissions',
    why: 'guest requests bridge to work orders and notifications', suites: ['api.smoke', 'api.pytest_targeted', 'web.unit', 'mobile.jest_full'], manual: true, env: LOCAL, evidence: 'listed suites PASSED; manual request creation and escalation on hermetic data' },
  { id: 'TASKS.WORKSPACE', when: (c) => c.domain('tasks'),
    behavior: 'Task creation, claim, blockers, recurrence and bulk actions remain consistent between surfaces',
    why: 'unified tasks are rendered by web task views and mobile Tasks', suites: ['api.smoke', 'api.pytest_targeted', 'web.unit', 'mobile.jest_full'], manual: true, env: LOCAL, evidence: 'listed suites PASSED' },
  { id: 'SCHEDULING.SHIFTS_AND_COVERAGE', when: (c) => c.domain('scheduling'),
    behavior: 'Scheduling, availability, leave, swaps and coverage still compute and publish correctly',
    why: 'schedule revisions feed notifications and supervisor views', suites: ['api.smoke', 'api.pytest_targeted', 'web.unit', 'mobile.jest_full'], manual: true, env: LOCAL, evidence: 'listed suites PASSED' },
  { id: 'LOGBOOK.HANDOFF_AND_SOP', when: (c) => c.domain('logbook'),
    behavior: 'Logbook entries, shift handoff and SOP search keep their ordering and visibility rules',
    why: 'logbook is shared by every role and read offline on mobile', suites: ['api.smoke', 'api.pytest_targeted', 'web.unit', 'mobile.jest_full'], manual: false, env: LOCAL, evidence: 'listed suites PASSED' },
  { id: 'BILLING.AI_CREDIT_ACCOUNTING', when: (c) => c.tag('SEC.PAYMENTS') || c.domain('billing_ai'),
    behavior: 'AI credit usage logs ACTUAL token usage and billing true-up totals are unchanged',
    why: 'dynamic model routing means fixed cost estimates would mis-bill; true-up depends on the usage log', suites: ['api.smoke', 'api.pytest_targeted', 'api.pytest_full'], manual: true,
    env: 'unit tests locally; AI provider and Stripe live paths cannot run here (no OpenAI/Anthropic keys, test-mode Stripe only)', evidence: 'billing/credit tests PASSED; a human confirms no live provider call was made' },
  { id: 'INTEGRATIONS.STANDALONE_FIRST', when: (c) => c.domain('integrations'),
    behavior: 'The app still works standalone with Opera/Twilio flags off; webhooks verify signatures',
    why: 'Opera Cloud is feature-flagged and Twilio/OHIP credentials are absent locally', suites: ['api.smoke', 'api.pytest_targeted'], manual: true, env: LOCAL, evidence: 'listed suites PASSED; flag-off behaviour confirmed' },
  { id: 'REPORTS.EXPORTS', when: (c) => c.domain('reports'),
    behavior: 'Report filters, views and exports still produce the same totals', why: 'reports read housekeeping and engineering data on web', suites: ['api.smoke', 'api.pytest_targeted', 'web.unit'], manual: false, env: LOCAL, evidence: 'listed suites PASSED' },
  { id: 'NOTIFICATIONS.DELIVERY', when: (c) => c.domain('notifications'),
    behavior: 'Notification and push-token flows deliver once and to the right role', why: 'notifications are raised from tasks, work orders and schedules', suites: ['api.smoke', 'api.pytest_targeted', 'mobile.jest_full'], manual: true, env: LOCAL, evidence: 'listed suites PASSED; no real push sent' },
  { id: 'FLAGS.REGISTRY_PARITY', when: (c) => c.domain('settings') || c.path(/feature[_-]?flag/i),
    behavior: 'Backend and frontend feature-flag registries still agree; rollout scripts unchanged', why: 'flags gate every redesign surface on API, web and mobile', suites: ['repo.feature_flag_registry', 'web.feature_flag_scripts'], manual: false, env: 'node only', evidence: 'both suites PASSED' },
  { id: 'WEB.UI_AND_A11Y', when: (c) => c.surface('web') && !c.path(/\.test\./),
    behavior: 'Affected web routes render, EN/ES strings resolve, dark-mode contrast holds, frozen files are unchanged, no console errors',
    why: 'web components and styles are shared across the Room Board, tasks and settings pages', suites: ['web.lint', 'web.typecheck', 'web.unit', 'web.i18n_parity', 'web.contrast', 'web.frozen_files', 'web.hermetic', 'web.build'], manual: true, env: LOCAL,
    evidence: 'listed suites PASSED (web.build/web.hermetic need approval or CI); a human opens each affected route in the hermetic harness and reads the browser console' },
  { id: 'MOBILE.SCREENS_AND_NAVIGATION', when: (c) => c.surface('mobile') && !c.path(/__tests__/),
    behavior: 'Affected mobile screens, navigation, offline queue and role-specific home screens still render and navigate',
    why: 'expo-router layouts and shared stores are used by every role', suites: ['mobile.typecheck', 'mobile.lint', 'mobile.jest_related', 'mobile.jest_full'], manual: true, env: 'Expo web or a device with mocked backend (no production API)',
    evidence: 'listed suites PASSED (Jest with --maxWorkers=2); no device run is implied by green unit tests' },
  { id: 'DEPENDENCY.CLEAN_INSTALL', when: (c) => c.tag('dependency'),
    behavior: 'A clean install resolves, builds and passes lint/type/test; no new advisory', why: 'lockfiles and requirements are consumed by every job of that surface', suites: ['web.lint', 'web.typecheck', 'web.unit', 'api.ruff', 'api.smoke', 'mobile.typecheck', 'mobile.jest_full', 'ci.security_scan'], manual: true, env: 'clean checkout; installs need separate approval', evidence: 'listed suites PASSED and CI Security Scan green' },
  { id: 'CI.WORKFLOW_AND_RELEASE_CONTROLS', when: (c) => c.tag('ci-release') || c.esc('CI_AUTHORITATIVE_REQUIRED'),
    behavior: 'Workflow, gate, provenance and release controls are unchanged in strength; nothing was dispatched',
    why: 'workflows and release scripts are trusted infrastructure', suites: ['repo.release_workflow_contract', 'repo.mobile_ci_workflow_contract', 'repo.db_static_contract', 'ci.gate'], manual: true, env: CI, evidence: 'contract suites PASSED; independent security review; authoritative CI checks green for the exact head' },
  { id: 'HARNESS.POLICY_AND_ROLES', when: (c) => c.tag('harness'),
    behavior: 'The policy hook still fails closed, role tool scopes are subsets of the contract, protected paths are unchanged',
    why: 'developer-harness code and instructions govern every agent action', suites: ['harness.contract', 'harness.policy', 'harness.context', 'harness.routing', 'harness.coordination', 'harness.evaluation', 'harness.testing'], manual: true, env: 'node only', evidence: 'all harness suites PASSED; independent security review' },
  { id: 'TEST.LOST_COVERAGE_REVIEW', when: (c) => c.esc('LOST_COVERAGE_REVIEW'),
    behavior: 'A deleted or renamed-away test either moved with its assertions or was retired on purpose',
    why: 'removing a test removes coverage that no suite can report', suites: [], manual: true, env: 'code review', evidence: 'a reviewer records, per deleted test, where its assertions now live or why they are obsolete' },
  { id: 'TEST.CONFIG_DISCOVERY', when: (c) => c.tag('test_config') || c.path(/jest\.(config|setup)|pytest\.ini|conftest|eslint\.config|tsconfig/i),
    behavior: 'The test runner still discovers the same tests (same count before and after)', why: 'a config change can silently drop tests while staying green', suites: ['api.smoke', 'mobile.jest_full', 'web.unit'], manual: true, env: 'local', evidence: 'discovered-test counts compared before and after' },
]

/** One item per unresolved coverage gap: the tool cannot say what covers these paths. */
const gapItem = (g) => ({ id: `GAP.${g.code}`, behavior: `Determine by hand what covers: ${g.paths.slice(0, 5).join(', ') || 'the changed set'}`, why_adjacent: g.note, automated: [], coverage_gap: true, manual_needed: true, environment: 'human judgement', pass_evidence: 'a reviewer names the covering check or accepts the risk in writing', manual_status: 'NOT_VERIFIED' })

export function buildChecklist(selection, results = null) {
  const sel = new Set(selection.suites.map((s) => s.id))
  const tags = new Set(selection.tags)
  const domains = new Set(selection.domains)
  const esc = new Set(selection.escalations.map((e) => e.code))
  const paths = selection.changed.all_paths
  const ctx = { tag: (t) => tags.has(t), domain: (d) => domains.has(d), esc: (e) => esc.has(e), path: (re) => paths.some((p) => re.test(p)), surface: (s) => paths.some((p) => p.startsWith(`apps/${s}/`)) }
  const items = []
  for (const it of ITEMS) {
    if (!it.when(ctx)) continue
    const automated = it.suites.filter((id) => sel.has(id)).map((id) => ({ suite_id: id, outcome: results ? (results.find((r) => r.suite_id === id)?.status ?? 'NOT_RUN') : null }))
    items.push({ id: it.id, behavior: it.behavior, why_adjacent: it.why, automated, coverage_gap: it.suites.length > 0 && automated.length === 0, manual_needed: it.manual, environment: it.env, pass_evidence: it.evidence, manual_status: 'NOT_VERIFIED' })
  }
  for (const g of selection.coverage.gaps) items.push(gapItem(g))
  items.push({ id: 'CI.AUTHORITATIVE_GATES', behavior: 'CI Gate and Staging Gate pass for the exact PR head SHA', why_adjacent: 'a local selection is a subset and never replaces CI', automated: [], coverage_gap: false, manual_needed: true, environment: CI, pass_evidence: 'live GitHub state shows both gates passed for the current head', manual_status: 'NOT_VERIFIED' })
  return { schema: 'developer-harness-v2/regression-checklist@1', authoritative: false, note: 'Manual items are not automatically verified. Automated outcomes come only from commands that actually ran.', items }
}
