import type { UserRole } from '@/stores/authStore'

export interface LogbookCapabilities {
  canCreateEntry: boolean
  canEditAnyEntry: boolean
  canDeleteAnyEntry: boolean
  canGenerateShiftSummary: boolean
  canAcknowledgeShiftSummary: boolean
  canUseAdvancedFilters: boolean
  /** Entry-ownership-independent floor — the drawer still requires
   * author-or-privileged per entry, same as edit/delete/resolve/archive today. */
  canCarryForwardAnyEntry: boolean
  canResolveAnyEntry: boolean
  canArchiveAnyEntry: boolean
  canDeletePermanently: boolean
  canComment: boolean
  canDeleteAnyComment: boolean
  canSendAcknowledgmentReminder: boolean
}

const PRIVILEGED_ENTRY_ROLES: UserRole[] = ['gm', 'housekeeping_supervisor', 'engineer', 'chief_engineer']
const ADVANCED_FILTER_ROLES: UserRole[] = ['gm', 'housekeeping_supervisor', 'chief_engineer']

/** Presentation-only capability map. Entry ownership remains a per-entry check —
 * an author may always carry forward/resolve/archive/edit their own entry even
 * when these role-level flags are false; the backend is authoritative either way. */
export function getLogbookCapabilities(role: UserRole | null): LogbookCapabilities {
  const isAuthenticated = role !== null
  const canManageAnyEntry = !!role && PRIVILEGED_ENTRY_ROLES.includes(role)

  return {
    canCreateEntry: isAuthenticated,
    canEditAnyEntry: canManageAnyEntry,
    canDeleteAnyEntry: canManageAnyEntry,
    canGenerateShiftSummary: canManageAnyEntry,
    canAcknowledgeShiftSummary: isAuthenticated,
    canUseAdvancedFilters: !!role && ADVANCED_FILTER_ROLES.includes(role),
    canCarryForwardAnyEntry: canManageAnyEntry,
    canResolveAnyEntry: canManageAnyEntry,
    canArchiveAnyEntry: canManageAnyEntry,
    // Permanent deletion removes the audit record and any unshared private files.
    // The API deliberately permits only GMs; the client mirrors that narrow gate.
    canDeletePermanently: role === 'gm',
    canComment: isAuthenticated,
    canDeleteAnyComment: canManageAnyEntry,
    canSendAcknowledgmentReminder: canManageAnyEntry,
  }
}

/** Per-entry check mirroring the backend's `is_author or is_privileged` gate on
 * resolve/carry-forward/archive/edit/delete — used by the drawer to decide
 * whether to render each action for the entry actually open. */
export function canManageLogbookEntry(
  capabilities: LogbookCapabilities,
  entryAuthorId: string,
  currentUserId: string,
): boolean {
  return capabilities.canEditAnyEntry || entryAuthorId === currentUserId
}
