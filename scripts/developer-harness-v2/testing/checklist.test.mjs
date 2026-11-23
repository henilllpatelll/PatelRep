// Developer Harness V2 — Phase 6 regression-checklist tests: items map to REAL PatelRep modules and existing suites, manual items are
// never reported as verified, and automated outcomes come only from results that were actually produced.
// Run: node --test scripts/developer-harness-v2/testing/checklist.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'
import { SUITE_BY_ID } from './catalog.mjs'
import { buildChecklist } from './checklist.mjs'
import { changeSetFromEntries } from './changes.mjs'
import { selectTests } from './select.mjs'

const sel = (...e) => selectTests(changeSetFromEntries(e, { base_examined: true }))
const cl = (...e) => buildChecklist(sel(...e))
const item = (c, id) => c.items.find((i) => i.id === id)
const ids = (c) => c.items.map((i) => i.id)

test('an API authentication change checklist reaches web and mobile login, with automated coverage and a manual login check', () => {
  const c = cl('apps/api/core/auth.py'); const i = item(c, 'AUTH.LOGIN_AND_SESSION'); assert.ok(i)
  assert.deepEqual(i.automated.map((a) => a.suite_id).sort(), ['api.security_contracts', 'mobile.jest_full', 'mobile.typecheck', 'web.typecheck', 'web.unit'])
  assert.equal(i.manual_needed, true); assert.match(i.why_adjacent, /apps\/web.*apps\/mobile|apps\/mobile/); assert.match(i.environment, /never staging or production/); assert.match(i.pass_evidence, /six roles/)
})

test('a housekeeping assignment change lists room state, assignment visibility and supervisor workflows', () => {
  const i = item(cl('apps/api/routers/housekeeping_assignments.py'), 'HOUSEKEEPING.ROOM_STATE_AND_ASSIGNMENT'); assert.ok(i)
  assert.match(i.behavior, /Room status transitions, assignment visibility and supervisor/); assert.match(i.why_adjacent, /room_assignments|room_status/)
  for (const s of ['api.smoke', 'api.pytest_targeted', 'web.unit', 'mobile.jest_full']) assert.ok(i.automated.some((a) => a.suite_id === s), s)
})

test('a work-order change lists task views, PM scheduling and asset links; a billing change names actual-token accounting', () => {
  assert.match(item(cl('apps/api/routers/work_orders.py'), 'ENGINEERING.WORK_ORDERS_AND_ASSETS').behavior, /task views.*scheduling.*asset/)
  const b = item(cl('apps/api/routers/billing.py'), 'BILLING.AI_CREDIT_ACCOUNTING'); assert.match(b.behavior, /ACTUAL token usage/); assert.match(b.environment, /cannot run here/)
})

test('a tenant-isolation relevant change requires cross-tenant negative tests and says which cannot run locally', () => {
  const i = item(cl('apps/api/routers/hotels.py'), 'TENANT.CROSS_HOTEL_NEGATIVE'); assert.ok(i); assert.ok(i.automated.some((a) => a.suite_id === 'api.smoke')); assert.match(i.pass_evidence, /test_tenant_isolation/); assert.equal(i.manual_needed, true)
  const m = item(cl({ path: 'supabase/migrations/320_x.sql', status: 'A' }), 'TENANT.CROSS_HOTEL_NEGATIVE'); assert.ok(m.automated.some((a) => a.suite_id === 'db.replay_and_schema_contracts')); assert.match(m.environment, /separate approval/)
})

test('a migration is a forward-only, history-preserving item that needs a disposable stack with separate approval', () => {
  const i = item(cl({ path: 'supabase/migrations/321_x.sql', status: 'A' }), 'DB.MIGRATION_FORWARD_ONLY'); assert.ok(i); assert.match(i.behavior, /forward-only/); assert.match(i.environment, /separate human approval/); assert.match(i.environment, /never a remote database/)
})

test('web, mobile, dependency, workflow and harness changes each produce their own items', () => {
  assert.ok(ids(cl('apps/web/components/housekeeping/RoomCard.tsx')).includes('WEB.UI_AND_A11Y'))
  const m = item(cl('apps/mobile/app/(app)/home.tsx'), 'MOBILE.SCREENS_AND_NAVIGATION'); assert.match(m.pass_evidence, /maxWorkers=2/); assert.match(m.pass_evidence, /no device run is implied/)
  assert.ok(ids(cl('apps/web/package-lock.json')).includes('DEPENDENCY.CLEAN_INSTALL'))
  const w = item(cl('.github/workflows/production-release.yml'), 'CI.WORKFLOW_AND_RELEASE_CONTROLS'); assert.ok(w.automated.some((a) => a.suite_id === 'repo.release_workflow_contract')); assert.match(w.pass_evidence, /independent security review/)
  assert.ok(item(cl('scripts/developer-harness-v2/policy-engine.mjs'), 'HARNESS.POLICY_AND_ROLES').automated.length === 7)
  assert.ok(ids(cl('apps/api/pytest.ini')).includes('TEST.CONFIG_DISCOVERY'))
  assert.ok(ids(cl('apps/web/lib/utils/featureFlag.ts')).includes('FLAGS.REGISTRY_PARITY'))
})

test('a deleted test produces a lost-coverage review item with no automated coverage', () => {
  const i = item(cl({ path: 'apps/api/tests/smoke/test_x.py', status: 'D' }), 'TEST.LOST_COVERAGE_REVIEW'); assert.ok(i); assert.deepEqual(i.automated, []); assert.equal(i.manual_needed, true); assert.match(i.pass_evidence, /where its assertions now live/)
})

test('every item is a manual-unverified claim; nothing is reported as verified by the tool', () => {
  for (const c of [cl('apps/api/core/auth.py', 'apps/mobile/lib/a.ts'), cl('mystery/x.bin'), cl('docs/G.md')]) {
    assert.equal(c.authoritative, false); assert.match(c.note, /not automatically verified/)
    for (const i of c.items) { assert.equal(i.manual_status, 'NOT_VERIFIED'); assert.ok(i.behavior && i.why_adjacent && i.environment && i.pass_evidence, i.id); assert.ok(!('verified' in i) && !('passed' in i)) }
    assert.ok(ids(c).includes('CI.AUTHORITATIVE_GATES'))
  }
})

test('automated suites listed for an item are always selected suites that exist, and uncovered items are marked as gaps', () => {
  const s = sel('apps/api/routers/housekeeping_assignments.py'); const c = buildChecklist(s); const selected = new Set(s.suites.map((x) => x.id))
  for (const i of c.items) for (const a of i.automated) { assert.ok(selected.has(a.suite_id) && SUITE_BY_ID[a.suite_id], a.suite_id) }
  const gapSel = { ...s, suites: s.suites.filter((x) => !x.id.startsWith('web.') && !x.id.startsWith('mobile.')) }
  const i = item(buildChecklist(gapSel), 'HOUSEKEEPING.ROOM_STATE_AND_ASSIGNMENT'); assert.ok(!i.automated.some((a) => a.suite_id.startsWith('web.'))); assert.equal(i.coverage_gap, false) // api suites still cover it
  assert.equal(item(buildChecklist({ ...s, suites: [] }), 'HOUSEKEEPING.ROOM_STATE_AND_ASSIGNMENT').coverage_gap, true)
})

test('unproven coverage becomes an explicit manual gap item per gap', () => {
  const c = cl('mystery/file.dat', 'apps/web/odd.weird'); const gaps = c.items.filter((i) => i.id.startsWith('GAP.'))
  assert.deepEqual(gaps.map((g) => g.id).sort(), ['GAP.COVERAGE.AMBIGUOUS_TYPE', 'GAP.COVERAGE.UNPROVEN']); for (const g of gaps) { assert.equal(g.coverage_gap, true); assert.equal(g.manual_needed, true); assert.deepEqual(g.automated, []) }
})

test('automated outcomes come only from supplied results; without results they are null, and unrun suites say NOT_RUN', () => {
  const s = sel('apps/api/core/auth.py'); const none = buildChecklist(s); assert.ok(item(none, 'AUTH.LOGIN_AND_SESSION').automated.every((a) => a.outcome === null))
  const withResults = buildChecklist(s, [{ suite_id: 'api.security_contracts', status: 'FAILED' }, { suite_id: 'web.unit', status: 'PASSED' }])
  const a = Object.fromEntries(item(withResults, 'AUTH.LOGIN_AND_SESSION').automated.map((x) => [x.suite_id, x.outcome])); assert.equal(a['api.security_contracts'], 'FAILED'); assert.equal(a['web.unit'], 'PASSED'); assert.equal(a['mobile.jest_full'], 'NOT_RUN')
  assert.equal(item(withResults, 'AUTH.LOGIN_AND_SESSION').manual_status, 'NOT_VERIFIED')
})

test('environments never point at staging or production data, and never at the local API .env', () => {
  const c = cl('apps/api/core/auth.py', 'apps/web/components/a.tsx', 'apps/mobile/lib/a.ts', 'supabase/migrations/330_x.sql', 'apps/api/routers/billing.py')
  for (const i of c.items) { assert.ok(!/use (staging|production)\b|against (staging|production)\b|apps\/api\/\.env/i.test(i.environment), `${i.id}: ${i.environment}`) }
})
