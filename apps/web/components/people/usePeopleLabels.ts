'use client'

import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { UserRole } from '@/stores/authStore'
import {
  formatShiftRange,
  type DirectoryEntry,
  type DirectoryStatus,
  type TodayState,
} from '@/lib/people/peopleDirectory'

export type TodaySource = 'loading' | 'error' | 'ready'

export interface TodayText {
  primary: string
  secondary: string | null
  tone: 'live' | 'normal' | 'muted'
}

/** Single place that turns directory data into display text, shared by the desktop table and mobile cards. */
export function usePeopleLabels() {
  const { t } = useTranslation()

  const roleLabel = useCallback((role: UserRole) => t(`roles.${role}`), [t])
  const statusLabel = useCallback((status: DirectoryStatus) => t(`people.status.${status}`), [t])
  const displayName = useCallback(
    (entry: DirectoryEntry) => entry.name || entry.email || t('people.unnamed'),
    [t],
  )

  const todayText = useCallback(
    (entry: DirectoryEntry, state: TodayState | undefined, source: TodaySource): TodayText => {
      if (entry.status === 'invited') return { primary: t('people.today.awaiting'), secondary: null, tone: 'muted' }
      if (entry.status === 'expired') return { primary: t('people.today.expiredInvite'), secondary: null, tone: 'muted' }
      if (entry.status === 'deactivated') return { primary: t('people.today.none'), secondary: null, tone: 'muted' }
      if (source === 'error') return { primary: t('people.today.unavailable'), secondary: null, tone: 'muted' }
      if (source === 'loading') return { primary: '', secondary: null, tone: 'muted' }
      if (!state || state.kind === 'not_scheduled') {
        return { primary: t('people.today.notScheduled'), secondary: null, tone: 'muted' }
      }
      // Shift times come from the schedule; if a row has none we say the state only - never invent a time.
      const range = formatShiftRange(state.start, state.end)
      if (state.kind === 'clocked_in') {
        return { primary: range ?? t('people.today.clockedIn'), secondary: range ? t('people.today.clockedIn') : null, tone: 'live' }
      }
      if (state.kind === 'finished') {
        return { primary: range ?? t('people.today.finished'), secondary: range ? t('people.today.finished') : null, tone: 'muted' }
      }
      return { primary: range ?? t('people.today.scheduled'), secondary: null, tone: 'normal' }
    },
    [t],
  )

  return { t, roleLabel, statusLabel, displayName, todayText }
}
