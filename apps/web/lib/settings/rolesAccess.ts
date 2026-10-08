/**
 * Pure logic for Settings > Roles & Access.
 *
 * Access is module-level and enforced in two places: the web route guard (lib/utils/routeGuard.ts, applied
 * by proxy.ts) and the API by base role. Custom roles and the Front Desk setting only choose which modules
 * appear for someone; they can never open a route the base role cannot. So the modules offered for a base
 * role are exactly the ones that role's route rules allow, mirrored by core/roles.py MODULE_ROLE_ACCESS.
 */
import type { CustomRole } from '@/lib/api/staff'
import type { UserRole } from '@/stores/authStore'
import { DEFAULT_FRONT_DESK_MODULES } from '@/lib/utils/navigation'
import { canRoleOpenRoute } from '@/lib/utils/routeGuard'

export interface ModuleDef { key: string; label: string; description: string }

/** Sidebar modules that custom roles / Front Desk can switch on or off. Dashboard is always available. */
export const MODULES: readonly ModuleDef[] = [
  { key: 'housekeeping', label: 'Housekeeping', description: 'Room board, assignments and inspections' },
  { key: 'engineering', label: 'Engineering', description: 'Work orders and maintenance tracking' },
  { key: 'lost-found', label: 'Lost & Found', description: 'Log and look up guest items' },
  { key: 'tasks', label: 'Tasks', description: 'Guest requests, ad-hoc tasks and everything that needs doing' },
  { key: 'logbook', label: 'Logbook', description: 'Shift-by-shift log entries' },
  { key: 'scheduling', label: 'Schedule', description: 'Staff scheduling and shifts' },
  { key: 'staff', label: 'People', description: 'Staff directory and management' },
  { key: 'sop', label: 'SOP Library', description: 'Standard operating procedures' },
  { key: 'reports', label: 'Reports', description: 'Analytics and daily summaries' },
  { key: 'ai', label: 'AI Copilot', description: 'AI-powered hotel insights and automation' },
]

/** Saved before Guest Requests merged into Tasks. Read as `tasks`, never offered. */
const LEGACY_ALIASES: Record<string, string> = { 'guest-requests': 'tasks' }
export const moduleLabel = (key: string): string => MODULES.find((m) => m.key === (LEGACY_ALIASES[key] ?? key))?.label ?? key

export function normalizeModules(keys: string[]): string[] {
  return Array.from(new Set(keys.map((k) => LEGACY_ALIASES[k] ?? k)))
}

/** Modules the base role can actually open. */
export function modulesForRole(role: UserRole): ModuleDef[] {
  return MODULES.filter((m) => canRoleOpenRoute(role, `/${m.key}`))
}

export function unsupportedFor(role: UserRole, keys: string[]): string[] {
  const allowed = new Set(modulesForRole(role).map((m) => m.key))
  return normalizeModules(keys).filter((k) => !allowed.has(k))
}

/** Selection after changing base role: keep what still applies, drop the rest (and report what was dropped). */
export function reconcileModules(role: UserRole, keys: string[]): { kept: string[]; dropped: string[] } {
  const bad = new Set(unsupportedFor(role, keys))
  const all = normalizeModules(keys)
  return { kept: all.filter((k) => !bad.has(k)), dropped: all.filter((k) => bad.has(k)) }
}

// ─── Roles ────────────────────────────────────────────────────────────────────

export interface BuiltInRole {
  id: UserRole
  name: string
  purpose: string
  /** `frontDesk` is the only built-in role whose module set is configurable. */
  access: 'system' | 'frontDesk'
  mobileOnly?: boolean
}

export const BUILT_IN_ROLES: readonly BuiltInRole[] = [
  { id: 'gm', name: 'General Manager', purpose: 'Property administrator with full access, including Settings.', access: 'system' },
  { id: 'housekeeping_supervisor', name: 'Housekeeping Supervisor', purpose: 'Runs housekeeping: assignments, inspections and room readiness.', access: 'system' },
  { id: 'chief_engineer', name: 'Chief Engineer', purpose: 'Leads engineering: work orders, preventive maintenance and room-down decisions.', access: 'system' },
  { id: 'front_desk', name: 'Front Desk', purpose: 'Guest services and operational access.', access: 'frontDesk' },
  { id: 'engineer', name: 'Engineer', purpose: 'Works maintenance orders from the mobile app.', access: 'system', mobileOnly: true },
  { id: 'housekeeper', name: 'Housekeeper', purpose: 'Cleans assigned rooms from the mobile app.', access: 'system', mobileOnly: true },
]

export const ROLE_NAMES: Record<string, string> = Object.fromEntries(BUILT_IN_ROLES.map((r) => [r.id, r.name]))

/**
 * Base roles a custom role can be built on. The General Manager role is excluded (its access is not
 * editable). Chief Engineer is its own base role; there is no duplicate "Engineer" entry.
 */
export const CUSTOM_BASE_ROLES: readonly { value: UserRole; label: string }[] = BUILT_IN_ROLES
  .filter((r) => r.id !== 'gm')
  .map((r) => ({ value: r.id, label: r.name }))

export function roleModuleSummary(role: UserRole): string {
  const labels = modulesForRole(role).map((m) => m.label)
  return `Dashboard${labels.length ? ` + ${labels.join(', ')}` : ''}`
}

export interface RoleForm { name: string; description: string; base_role: UserRole; allowed_modules: string[] }

export const EMPTY_ROLE_FORM: RoleForm = { name: '', description: '', base_role: 'front_desk', allowed_modules: ['housekeeping', 'lost-found', 'tasks', 'logbook'] }

export function roleToForm(role: CustomRole): RoleForm {
  return { name: role.name, description: role.description ?? '', base_role: role.base_role, allowed_modules: normalizeModules(role.allowed_modules) }
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i])

export function roleFormChanged(a: RoleForm, b: RoleForm): boolean {
  return a.name.trim() !== b.name.trim() || a.description.trim() !== b.description.trim() || a.base_role !== b.base_role || !sameSet(a.allowed_modules, b.allowed_modules)
}

export const ROLE_NAME_MAX = 100

export interface RoleFormErrors { name?: string; modules?: string }

export function validateRoleForm(form: RoleForm, roles: CustomRole[], editingId?: string): RoleFormErrors {
  const errors: RoleFormErrors = {}
  const name = form.name.trim()
  if (!name) errors.name = 'Give the role a name.'
  else if (name.length > ROLE_NAME_MAX) errors.name = `Keep the name under ${ROLE_NAME_MAX} characters.`
  else if (BUILT_IN_ROLES.some((r) => r.name.toLowerCase() === name.toLowerCase())) errors.name = 'This is the name of a built-in role. Choose a different name.'
  else if (roles.some((r) => r.id !== editingId && r.name.trim().toLowerCase() === name.toLowerCase())) errors.name = 'A custom role with this name already exists.'
  const bad = unsupportedFor(form.base_role, form.allowed_modules)
  if (bad.length) errors.modules = `${ROLE_NAMES[form.base_role]} can't open: ${bad.map(moduleLabel).join(', ')}.`
  return errors
}

export function toRolePayload(form: RoleForm) {
  return {
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    base_role: form.base_role,
    allowed_modules: normalizeModules(form.allowed_modules),
  }
}

// ─── Front Desk ───────────────────────────────────────────────────────────────

/** The modules a hotel gets before anyone configures Front Desk (same list the sidebar falls back to). */
export const FRONT_DESK_DEFAULTS: readonly string[] = DEFAULT_FRONT_DESK_MODULES

/** Saved selection to show: the hotel's setting, or the defaults when none is saved. */
export function frontDeskSelection(saved: string[] | null | undefined): { selected: string[]; ignored: string[] } {
  const all = normalizeModules(saved ?? [...FRONT_DESK_DEFAULTS])
  const ignored = unsupportedFor('front_desk', all)
  return { selected: all.filter((k) => !ignored.includes(k)), ignored }
}

export function toggleModule(selected: string[], key: string): string[] {
  return selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]
}

export const sameModules = sameSet
