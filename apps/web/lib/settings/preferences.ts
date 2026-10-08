/**
 * My Preferences — pure model for the personal-preferences page (no React, no I/O).
 *
 * Personal preferences are deliberately NOT part of property Settings (GM-only): every signed-in web
 * role can open `/preferences` from the account menu. Persistence scope of each control:
 *
 *   Appearance (theme, density, accent)  browser-local — `uiPreferencesStore` (`patelrep-ui-prefs`)
 *   Language (English / Español)         browser-local — i18n (`patelrep-language`), same as the header toggle
 *   Profile                              read-only here — `/auth/me`; the only profile write API is GM-only
 *   Notification preferences             not supported by the backend — intentionally no editor
 *   Password                             Supabase Auth reset e-mail (same flow as the login screen)
 */

import type { UserRole } from '@/lib/utils/routeGuard'

export const PREFERENCES_HREF = '/preferences'

export type ThemeChoice = 'light' | 'dark'
export type DensityChoice = 'comfortable' | 'balanced' | 'dense'
export type AccentChoice = 'terracotta' | 'teal' | 'blue' | 'rose'
export type LanguageChoice = 'en' | 'es'

/** The store has no "system" theme, so none is offered; adding one would need a store + shell change. */
export const THEME_OPTIONS: ReadonlyArray<{ value: ThemeChoice; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

export const DENSITY_OPTIONS: ReadonlyArray<{ value: DensityChoice; label: string; hint: string }> = [
  { value: 'comfortable', label: 'Comfortable', hint: 'More space around content' },
  { value: 'balanced', label: 'Balanced', hint: 'The default layout' },
  { value: 'dense', label: 'Compact', hint: 'Fit more on screen' },
]

export const ACCENT_OPTIONS: ReadonlyArray<{ value: AccentChoice; label: string; swatch: string }> = [
  { value: 'terracotta', label: 'Terracotta', swatch: '#b8431c' },
  { value: 'teal', label: 'Teal', swatch: '#0c6e63' },
  { value: 'blue', label: 'Blue', swatch: '#265d8a' },
  { value: 'rose', label: 'Rose', swatch: '#a6263c' },
]

/** Matches `AppLanguage` in `@/i18n`; native names so a user can always find their own language. */
export const LANGUAGE_OPTIONS: ReadonlyArray<{ value: LanguageChoice; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
]

export interface ProfileSource {
  fullName?: string | null
  preferredName?: string | null
  email?: string | null
  phone?: string | null
  roleLabel?: string | null
  hotelName?: string | null
}

export interface ProfileRow { id: string; label: string; value: string }

const clean = (value: string | null | undefined): string => (typeof value === 'string' ? value.trim() : '')

/**
 * Only fields the user can meaningfully read about themselves. Internal ids, tenant ids and auth
 * metadata are never included. Empty values are omitted rather than shown as blanks.
 */
export function buildProfileRows(source: ProfileSource): ProfileRow[] {
  const rows: ProfileRow[] = []
  const add = (id: string, label: string, value: string | null | undefined) => {
    const text = clean(value)
    if (text) rows.push({ id, label, value: text })
  }
  add('name', 'Name', source.fullName)
  // A preferred name that merely repeats the full name adds nothing.
  if (clean(source.preferredName).toLowerCase() !== clean(source.fullName).toLowerCase()) {
    add('preferred', 'Preferred name', source.preferredName)
  }
  add('email', 'Email', source.email)
  add('phone', 'Phone', source.phone)
  add('role', 'Role', source.roleLabel)
  add('hotel', 'Property', source.hotelName)
  return rows
}

/**
 * The profile write endpoint (`PATCH /staff/{id}/profile`) is GM-only, so only a GM has a real place
 * to change profile details (People). Everyone else is told who to ask. Backend RBAC stays authoritative.
 */
export function canEditProfileInPeople(role: UserRole | string | null | undefined): boolean {
  return role === 'gm'
}

export function isLanguageChoice(value: unknown): value is LanguageChoice {
  return value === 'en' || value === 'es'
}
