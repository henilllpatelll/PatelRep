import assert from 'node:assert/strict'
import test from 'node:test'
import type { SlaPolicy } from '../api/guest_requests'
import type { CustomRole } from '../api/staff'
import {
  DEFAULT_RESPONSE_MINUTES, EMPTY_RULE_FORM, EMPTY_RULE_FILTERS, describeRule, filterRules, formatDuration, ruleFormChanged,
  ruleToForm, sortRules, specificity, toRulePayload, validateRuleForm, CATEGORY_OPTIONS, PRIORITY_OPTIONS, IMPACT_OPTIONS,
} from './slaRules'
import {
  BUILT_IN_ROLES, CUSTOM_BASE_ROLES, EMPTY_ROLE_FORM, FRONT_DESK_DEFAULTS, MODULES, frontDeskSelection, modulesForRole,
  normalizeModules, reconcileModules, roleFormChanged, roleToForm, toRolePayload, toggleModule, unsupportedFor, validateRoleForm,
} from './rolesAccess'
import { ALL_ROLES } from '../utils/routeGuard'
import { NAV_BY_ROLE, DEFAULT_FRONT_DESK_MODULES } from '../utils/navigation'

const rule = (id: string, category: SlaPolicy['category'], priority: SlaPolicy['priority'], impact: SlaPolicy['guest_impact'], minutes: number): SlaPolicy =>
  ({ id, category, priority, guest_impact: impact, sla_minutes: minutes, created_at: '2026-01-01' })

const rules = [
  rule('a', 'housekeeping', null, null, 30),
  rule('b', null, 'urgent', null, 15),
  rule('c', 'housekeeping', 'urgent', null, 10),
  rule('d', null, null, 'high', 20),
]

// ─── SLAs ────────────────────────────────────────────────────────────────────

test('the built-in default matches the backend and options match the API enums', () => {
  assert.equal(DEFAULT_RESPONSE_MINUTES, 240)
  assert.deepEqual(CATEGORY_OPTIONS.map((o) => o.value), ['service', 'housekeeping', 'maintenance', 'accessibility', 'other'])
  assert.deepEqual(PRIORITY_OPTIONS.map((o) => o.value), ['normal', 'urgent'])
  assert.deepEqual(IMPACT_OPTIONS.map((o) => o.value), ['low', 'standard', 'high'])
})

test('durations are human readable', () => {
  assert.equal(formatDuration(15), '15 min')
  assert.equal(formatDuration(60), '1 hr')
  assert.equal(formatDuration(90), '1 hr 30 min')
  assert.equal(formatDuration(1440), '1 day')
  assert.equal(formatDuration(1500), '1 day 1 hr')
  assert.equal(formatDuration(10080), '7 days')
  assert.equal(formatDuration(0), '—')
})

test('rules describe themselves and sort by specificity like the backend resolves them', () => {
  assert.equal(describeRule(rules[2]), 'Housekeeping · Urgent priority · Any guest impact')
  assert.equal(specificity(rules[2]), 2)
  assert.deepEqual(sortRules(rules).map((r) => r.id), ['c', 'b', 'd', 'a'])
  assert.deepEqual(rules.map((r) => r.id), ['a', 'b', 'c', 'd'], 'input is not mutated')
})

test('filters keep rules that apply to the chosen value, including "Any" rules', () => {
  const ids = (f: Partial<typeof EMPTY_RULE_FILTERS>) => filterRules(rules, { ...EMPTY_RULE_FILTERS, ...f }).map((r) => r.id)
  assert.deepEqual(ids({}), ['a', 'b', 'c', 'd'])
  assert.deepEqual(ids({ category: 'service' }), ['b', 'd'])
  assert.deepEqual(ids({ priority: 'normal' }), ['a', 'd'])
  assert.deepEqual(ids({ q: '15 min' }), ['b'])
  assert.deepEqual(ids({ q: 'housekeeping' }), ['a', 'c'])
})

test('rule form validation: combination, accessibility, duplicates, minutes', () => {
  const form = { ...EMPTY_RULE_FORM, minutes: '20' }
  assert.ok(validateRuleForm(form, rules).combination)
  assert.deepEqual(validateRuleForm({ ...form, category: 'service' }, rules), {})
  assert.ok(validateRuleForm({ ...form, category: 'accessibility', priority: 'normal' }, rules).combination)
  assert.deepEqual(validateRuleForm({ ...form, category: 'accessibility', priority: 'urgent' }, rules), {})
  assert.ok(validateRuleForm({ ...form, category: 'housekeeping' }, rules).combination, 'duplicate of rule a')
  assert.deepEqual(validateRuleForm({ ...form, category: 'housekeeping' }, rules, 'a'), {}, 'editing a rule is not a duplicate of itself')
  for (const bad of ['', '0', '-5', '1.5', 'abc', '10081']) {
    assert.ok(validateRuleForm({ ...form, category: 'service', minutes: bad }, rules).minutes, bad)
  }
  assert.deepEqual(validateRuleForm({ ...form, category: 'service', minutes: '1' }, rules), {})
  assert.deepEqual(validateRuleForm({ ...form, category: 'service', minutes: '10080' }, rules), {})
})

test('rule payload and edit round-trip; dirty detection', () => {
  const f = ruleToForm(rules[2])
  assert.deepEqual(toRulePayload(f), { category: 'housekeeping', priority: 'urgent', guest_impact: null, sla_minutes: 10 })
  assert.equal(ruleFormChanged(f, ruleToForm(rules[2])), false)
  assert.equal(ruleFormChanged(f, { ...f, minutes: ' 10 ' }), false)
  assert.equal(ruleFormChanged(f, { ...f, minutes: '11' }), true)
  assert.equal(ruleFormChanged(f, { ...f, guest_impact: 'low' }), true)
})

// ─── Roles ───────────────────────────────────────────────────────────────────

const role = (over: Partial<CustomRole>): CustomRole =>
  ({ id: 'r1', name: 'Night Auditor', base_role: 'front_desk', allowed_modules: ['tasks'], is_active: true, created_at: '', ...over })

test('built-in roles are the real role set, with no duplicates and no GM base for custom roles', () => {
  assert.deepEqual([...BUILT_IN_ROLES.map((r) => r.id)].sort(), [...ALL_ROLES].sort())
  assert.equal(new Set(BUILT_IN_ROLES.map((r) => r.name)).size, BUILT_IN_ROLES.length)
  assert.equal(BUILT_IN_ROLES.filter((r) => r.access === 'frontDesk').length, 1)
  assert.equal(CUSTOM_BASE_ROLES.some((r) => r.value === 'gm'), false)
  assert.equal(CUSTOM_BASE_ROLES.filter((r) => r.label === 'Chief Engineer').length, 1)
  assert.equal(CUSTOM_BASE_ROLES.find((r) => r.label === 'Chief Engineer')?.value, 'chief_engineer')
  assert.equal(new Set(CUSTOM_BASE_ROLES.map((r) => r.value)).size, CUSTOM_BASE_ROLES.length, 'one entry per identifier')
})

test('offered modules are exactly what each role can open', () => {
  const keys = (r: Parameters<typeof modulesForRole>[0]) => modulesForRole(r).map((m) => m.key).sort()
  assert.deepEqual(keys('front_desk'), ['ai', 'housekeeping', 'logbook', 'lost-found', 'tasks'])
  assert.deepEqual(keys('housekeeper'), ['housekeeping', 'tasks'])
  assert.ok(keys('gm').includes('staff') && !keys('housekeeping_supervisor').includes('staff'))
  // The sidebar's per-role defaults only ever contain modules the route guard allows.
  for (const role of ALL_ROLES) {
    const allowed = new Set(keys(role))
    for (const href of NAV_BY_ROLE[role]) {
      const key = href.slice(1)
      if (MODULES.some((m) => m.key === key)) assert.ok(allowed.has(key), `${role} ${key}`)
    }
  }
})

test('Front Desk defaults are the sidebar defaults (no engineering, no retired guest-requests)', () => {
  assert.deepEqual([...FRONT_DESK_DEFAULTS], DEFAULT_FRONT_DESK_MODULES)
  assert.deepEqual([...FRONT_DESK_DEFAULTS].sort(), ['housekeeping', 'logbook', 'lost-found', 'tasks'])
  assert.deepEqual(frontDeskSelection(null), { selected: [...FRONT_DESK_DEFAULTS], ignored: [] })
})

test('saved Front Desk values that Front Desk cannot open are reported, legacy aliases resolve', () => {
  const r = frontDeskSelection(['guest-requests', 'logbook', 'engineering', 'reports', 'tasks'])
  assert.deepEqual(r.selected, ['tasks', 'logbook'])
  assert.deepEqual(r.ignored, ['engineering', 'reports'])
  assert.deepEqual(normalizeModules(['tasks', 'guest-requests']), ['tasks'])
  assert.deepEqual(toggleModule(['a', 'b'], 'a'), ['b'])
  assert.deepEqual(toggleModule(['a'], 'b'), ['a', 'b'])
})

test('changing base role keeps what still applies and reports what was dropped', () => {
  assert.deepEqual(reconcileModules('housekeeper', ['housekeeping', 'lost-found', 'tasks']), { kept: ['housekeeping', 'tasks'], dropped: ['lost-found'] })
  assert.deepEqual(unsupportedFor('front_desk', ['tasks', 'staff']), ['staff'])
})

test('role form validation covers name rules and module/base-role compatibility', () => {
  const existing = [role({}), role({ id: 'r2', name: 'Evening Desk' })]
  const ok = { ...EMPTY_ROLE_FORM, name: 'Weekend Desk' }
  assert.deepEqual(validateRoleForm(ok, existing), {})
  assert.ok(validateRoleForm({ ...ok, name: '   ' }, existing).name)
  assert.ok(validateRoleForm({ ...ok, name: 'night auditor' }, existing).name, 'case-insensitive duplicate')
  assert.deepEqual(validateRoleForm({ ...ok, name: 'night auditor' }, existing, 'r1'), {}, 'editing keeps its own name')
  assert.ok(validateRoleForm({ ...ok, name: 'General Manager' }, existing).name, 'built-in names are reserved')
  assert.ok(validateRoleForm({ ...ok, name: 'x'.repeat(101) }, existing).name)
  assert.ok(validateRoleForm({ ...ok, allowed_modules: ['tasks', 'reports'] }, existing).modules)
})

test('role payload normalises modules; edit round-trip and dirty detection', () => {
  const r = role({ allowed_modules: ['guest-requests', 'tasks', 'logbook'], description: undefined })
  const f = roleToForm(r)
  assert.deepEqual(f.allowed_modules, ['tasks', 'logbook'])
  assert.equal(roleFormChanged(f, roleToForm(r)), false)
  assert.equal(roleFormChanged(f, { ...f, allowed_modules: ['logbook', 'tasks'] }), false, 'order is not a change')
  assert.equal(roleFormChanged(f, { ...f, allowed_modules: ['tasks'] }), true)
  assert.equal(roleFormChanged(f, { ...f, base_role: 'housekeeper' }), true)
  const payload = toRolePayload({ ...f, name: ' Desk ', description: '  ' })
  assert.deepEqual(payload, { name: 'Desk', description: undefined, base_role: 'front_desk', allowed_modules: ['tasks', 'logbook'] })
})
