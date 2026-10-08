/**
 * Settings workspace information architecture — the single source of truth for Settings navigation,
 * search, legacy-route compatibility and role access. Pure data + functions (no React, no icons) so
 * it can be imported by the route guard, the sidebar model, components and unit tests alike.
 *
 * Route map (Phase 1) — existing routes are kept as the destinations; later phases replace page
 * content, not URLs:
 *
 *   /settings                  Settings Home (new; previously redirected to /settings/general)
 *   /settings/general          Property Profile
 *   /settings/rooms            Rooms & Accessibility
 *   /settings/housekeeping     Housekeeping            (?tab=cleaning|workload|assignment)
 *   /settings/inspections      Inspections
 *   /settings/guest-requests   Service SLAs
 *   /settings/roles            Roles & Access          (+ /settings/front-desk, /settings/departments)
 *   /settings/integrations     Integrations
 *   /settings/billing          Billing
 *   /settings/feedback         Staff Feedback          (retained under Advanced)
 *   /settings/activity         Activity & Audit        (planned for Phase 6 — not linkable yet)
 *   /settings/programs         → redirects to /programs   (same page, top-level route)
 *   /settings/sop              → redirects to /sop        (same page, top-level route)
 */

import type { UserRole } from '@/lib/utils/routeGuard'

/**
 * Roles allowed into the Settings workspace. Phase 1 deliberately preserves the existing GM-only
 * boundary (`/settings` in routeGuard + backend authorization). Hiding navigation is never the
 * authorization — this list is consumed by the route guard and re-checked by the layout.
 * Future delegation opportunities (NOT implemented): housekeeping_supervisor → Housekeeping,
 * Inspections, Service SLAs; chief_engineer → Rooms & Accessibility.
 */
export const SETTINGS_ROLES: readonly UserRole[] = ['gm']

export function canAccessSettings(role: UserRole | string | null | undefined): boolean {
  return !!role && (SETTINGS_ROLES as readonly string[]).includes(role)
}

export type SettingsGroupId =
  | 'overview' | 'property' | 'operations' | 'people' | 'systems' | 'account' | 'advanced'

export type SettingsIconKey =
  | 'home' | 'building' | 'hotel' | 'brush' | 'clipboard' | 'clock' | 'shield'
  | 'link' | 'card' | 'history' | 'message'

export interface SettingsRelatedPage { href: string; label: string }

export interface SettingsDestination {
  id: string
  href: string
  label: string
  description: string
  group: SettingsGroupId
  icon: SettingsIconKey
  /** Extra pathnames that belong to this destination (highlight it when active). */
  relatedPages?: SettingsRelatedPage[]
  /** Not built yet: shown as a disabled, clearly-labelled entry — never a link. */
  planned?: boolean
}

export const SETTINGS_GROUPS: ReadonlyArray<{ id: SettingsGroupId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'property', label: 'Property' },
  { id: 'operations', label: 'Operations' },
  { id: 'people', label: 'People & Access' },
  { id: 'systems', label: 'Connected Systems' },
  { id: 'account', label: 'Account' },
  { id: 'advanced', label: 'Advanced' },
]

export const SETTINGS_DESTINATIONS: readonly SettingsDestination[] = [
  { id: 'home', href: '/settings', label: 'Settings Home', group: 'overview', icon: 'home',
    description: 'Property overview and every configuration area in one place.' },
  { id: 'general', href: '/settings/general', label: 'Property Profile', group: 'property', icon: 'building',
    description: 'Hotel name, address, contact details, timezone and room count.' },
  { id: 'rooms', href: '/settings/rooms', label: 'Rooms & Accessibility', group: 'property', icon: 'hotel',
    description: 'Room inventory, room types and accessible-room features.' },
  { id: 'housekeeping', href: '/settings/housekeeping', label: 'Housekeeping', group: 'operations', icon: 'brush',
    description: 'Cleaning checklists, workload credits and room-assignment preferences.' },
  { id: 'inspections', href: '/settings/inspections', label: 'Inspections', group: 'operations', icon: 'clipboard',
    description: 'Inspection templates and checklists used by supervisors.' },
  { id: 'sla', href: '/settings/guest-requests', label: 'Service SLAs', group: 'operations', icon: 'clock',
    description: 'Response-time targets for guest requests by category and priority.' },
  { id: 'roles', href: '/settings/roles', label: 'Roles & Access', group: 'people', icon: 'shield',
    description: 'Custom roles, module access, front desk access and departments.',
    relatedPages: [
      { href: '/settings/roles', label: 'Roles' },
      { href: '/settings/front-desk', label: 'Front Desk Access' },
      { href: '/settings/departments', label: 'Departments' },
    ] },
  { id: 'integrations', href: '/settings/integrations', label: 'Integrations', group: 'systems', icon: 'link',
    description: 'Connect and monitor Opera Cloud and other property systems.' },
  { id: 'billing', href: '/settings/billing', label: 'Billing', group: 'account', icon: 'card',
    description: 'Plan, AI credit usage and billing details.' },
  { id: 'feedback', href: '/settings/feedback', label: 'Staff Feedback', group: 'advanced', icon: 'message',
    description: 'Problems and ideas submitted by staff from the feedback button.' },
  { id: 'activity', href: '/settings/activity', label: 'Activity & Audit', group: 'advanced', icon: 'history',
    description: 'A record of configuration changes — planned, not available yet.', planned: true },
]

/** Cards on Settings Home, in display order. */
export const HOME_SECTIONS: ReadonlyArray<{ id: string; label: string; destinationIds: readonly string[] }> = [
  { id: 'operations', label: 'Property & Operations', destinationIds: ['general', 'rooms', 'housekeeping', 'inspections', 'sla'] },
  { id: 'administration', label: 'Administration', destinationIds: ['roles', 'integrations', 'billing', 'activity'] },
]

// ─── Role gating ──────────────────────────────────────────────────────────────

/** Destinations the role may see/open. Currently every destination shares the GM-only boundary. */
export function getVisibleDestinations(role: UserRole | string | null | undefined): SettingsDestination[] {
  return canAccessSettings(role) ? [...SETTINGS_DESTINATIONS] : []
}

export function getDestination(id: string): SettingsDestination | undefined {
  return SETTINGS_DESTINATIONS.find((d) => d.id === id)
}

export function getSettingsHref(destination: SettingsDestination): string | null {
  return destination.planned ? null : destination.href
}

// ─── Route matching & legacy compatibility ────────────────────────────────────

/** Old Settings URLs that now live at a top-level route. Bookmarks and deep links keep working. */
export const LEGACY_SETTINGS_REDIRECTS: Readonly<Record<string, string>> = {
  '/settings/programs': '/programs',
  '/settings/sop': '/sop',
}

export function getLegacySettingsRedirect(pathname: string): string | null {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return LEGACY_SETTINGS_REDIRECTS[clean] ?? null
}

function pathMatches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/')
}

/** The destination that owns `pathname` (longest matching href wins; Home only matches exactly). */
export function resolveActiveDestination(pathname: string): SettingsDestination | undefined {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  if (clean === '/settings') return getDestination('home')
  let best: SettingsDestination | undefined
  let bestLen = -1
  for (const d of SETTINGS_DESTINATIONS) {
    if (d.id === 'home') continue
    const hrefs = [d.href, ...(d.relatedPages?.map((p) => p.href) ?? [])]
    for (const href of hrefs) {
      if (pathMatches(clean, href) && href.length > bestLen) { best = d; bestLen = href.length }
    }
  }
  return best
}

// ─── Search ───────────────────────────────────────────────────────────────────

export interface SettingsSearchEntry {
  id: string
  destinationId: string
  /** Section within the destination, absent for the destination itself. */
  section?: string
  href: string
  keywords: readonly string[]
}

/** Only sections that exist today. Keep keywords to terms staff would actually type. */
export const SETTINGS_SEARCH_ENTRIES: readonly SettingsSearchEntry[] = [
  { id: 'general', destinationId: 'general', href: '/settings/general',
    keywords: ['hotel profile', 'hotel name', 'address', 'phone', 'timezone', 'time zone', 'room count', 'average daily rate', 'adr', 'property'] },
  { id: 'rooms', destinationId: 'rooms', href: '/settings/rooms',
    keywords: ['room inventory', 'room types', 'floors', 'import rooms'] },
  { id: 'rooms-accessibility', destinationId: 'rooms', section: 'Accessibility features', href: '/settings/rooms',
    keywords: ['ada', 'accessible rooms', 'accessibility features'] },
  { id: 'housekeeping', destinationId: 'housekeeping', href: '/settings/housekeeping',
    keywords: ['housekeepers', 'cleaning'] },
  { id: 'housekeeping-cleaning', destinationId: 'housekeeping', section: 'Cleaning checklists', href: '/settings/housekeeping?tab=cleaning',
    keywords: ['cleaning checklist', 'checklist', 'clean steps', 'room clean tasks'] },
  { id: 'housekeeping-workload', destinationId: 'housekeeping', section: 'Workload', href: '/settings/housekeeping?tab=workload',
    keywords: ['credits', 'target credits', 'credit weights', 'workload', 'capacity', 'clean type', 'departure', 'stayover'] },
  { id: 'housekeeping-assignment', destinationId: 'housekeeping', section: 'Assignment preferences', href: '/settings/housekeeping?tab=assignment',
    keywords: ['assignment preferences', 'auto assign', 'balance workload', 'same floor', 'same building', 'on break'] },
  { id: 'inspections', destinationId: 'inspections', href: '/settings/inspections',
    keywords: ['inspection checklist', 'inspection templates', 'inspect', 'qa'] },
  { id: 'sla', destinationId: 'sla', href: '/settings/guest-requests',
    keywords: ['sla policies', 'response time', 'guest requests', 'service level', 'escalation', 'service recovery'] },
  { id: 'roles', destinationId: 'roles', href: '/settings/roles',
    keywords: ['custom roles', 'permissions', 'modules', 'staff access'] },
  { id: 'roles-front-desk', destinationId: 'roles', section: 'Front desk access', href: '/settings/front-desk',
    keywords: ['front desk access', 'front desk modules', 'front desk'] },
  { id: 'roles-departments', destinationId: 'roles', section: 'Departments', href: '/settings/departments',
    keywords: ['departments', 'teams'] },
  { id: 'integrations', destinationId: 'integrations', href: '/settings/integrations',
    keywords: ['opera', 'opera cloud', 'pms', 'sync', 'reservations', 'connect'] },
  { id: 'billing', destinationId: 'billing', href: '/settings/billing',
    keywords: ['invoices', 'subscription', 'plan', 'payment', 'usage', 'overage', 'ai credit'] },
  { id: 'feedback', destinationId: 'feedback', href: '/settings/feedback',
    keywords: ['feedback', 'bug reports', 'staff reports', 'ideas'] },
]

export interface SettingsSearchResult {
  id: string
  destinationId: string
  destinationLabel: string
  /** Label shown as the result title (section name, or the destination's own). */
  label: string
  description: string
  href: string
  score: number
}

function norm(value: string): string {
  return value.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
}

function wordStartsWith(haystack: string, token: string): boolean {
  return haystack.split(' ').some((w) => w.startsWith(token))
}

/**
 * Client-side navigation search. Every query token must match something on the entry; results are
 * ranked by where the match lands (title word > keyword phrase > description) with destination
 * entries ahead of their own sections on ties. Planned destinations are never returned.
 */
export function searchSettings(query: string, role: UserRole | string | null | undefined): SettingsSearchResult[] {
  const tokens = norm(query).split(' ').filter(Boolean)
  if (tokens.length === 0) return []
  const visible = new Set(getVisibleDestinations(role).map((d) => d.id))
  const results: SettingsSearchResult[] = []

  SETTINGS_SEARCH_ENTRIES.forEach((entry, index) => {
    const dest = getDestination(entry.destinationId)
    if (!dest || dest.planned || !visible.has(dest.id)) return
    const title = norm(entry.section ?? dest.label)
    const destTitle = norm(dest.label)
    const keywordText = entry.keywords.map(norm)
    const description = norm(dest.description)

    let score = 0
    for (const token of tokens) {
      if (wordStartsWith(title, token)) score += 10
      else if (entry.section && wordStartsWith(destTitle, token)) score += 6
      else if (keywordText.some((k) => wordStartsWith(k, token))) score += 5
      else if (description.includes(token)) score += 2
      else return
    }
    // A whole-phrase keyword hit beats scattered per-word hits ("front desk access").
    const phrase = norm(query)
    if (keywordText.some((k) => k === phrase || k.startsWith(phrase))) score += 6
    if (!entry.section) score += 0.5
    score -= index / 1000

    results.push({
      id: entry.id,
      destinationId: dest.id,
      destinationLabel: dest.label,
      label: entry.section ?? dest.label,
      description: entry.section ? `${dest.label} — ${dest.description}` : dest.description,
      href: entry.href,
      score,
    })
  })

  return results.sort((a, b) => b.score - a.score)
}

// ─── Keyboard helper ──────────────────────────────────────────────────────────

/** Next focus index for a vertical list: arrows move (wrapping), Home/End jump. */
export function nextListIndex(current: number, key: string, length: number): number | null {
  if (length <= 0) return null
  switch (key) {
    case 'ArrowDown': return current < 0 ? 0 : (current + 1) % length
    case 'ArrowUp': return current <= 0 ? length - 1 : current - 1
    case 'Home': return 0
    case 'End': return length - 1
    default: return null
  }
}
