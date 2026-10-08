'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { BarChart3, ChevronDown, Mail, Phone, UserCheck, UserX } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/utils'
import type { StaffEntry, TodayState } from '@/lib/people/peopleDirectory'
import { formatShiftRange } from '@/lib/people/peopleDirectory'
import type { StaffMember } from '@/lib/api/staff'
import {
  accessGuards, activeCoverageToday, coverageRolesFor, coverageStatus, formatCalendarDate, formatDays, safeMailHref,
  safeTelHref, teamReportHref, type DrawerView,
} from '@/lib/people/peopleDrawers'
import { PersonAvatar, StatusBadge } from './PeopleDirectory'
import { Banner, DetailRow, Section } from './PeopleFormFields'
import { useCoverage, usePeopleHotel } from './usePeopleData'
import { usePeopleLabels, type TodaySource } from './usePeopleLabels'

interface Props {
  entry: StaffEntry
  staffList: StaffMember[]
  selfUserId: string | null
  isGM: boolean
  today: TodayState | undefined
  todaySource: TodaySource
  onView: (v: DrawerView) => void
  onDeactivate: (s: StaffMember) => void
  onReactivate: (s: StaffMember) => void
}

const LinkButton = ({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label?: string }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    className="inline-flex min-h-[32px] items-center rounded px-1 text-xs font-semibold text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
  >
    {children}
  </button>
)

const actionLink =
  'inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink ' +
  'transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] sm:min-h-[40px]'

export function PersonProfileView({ entry, staffList, selfUserId, isGM, today, todaySource, onView, onDeactivate, onReactivate }: Props) {
  const { t, roleLabel } = usePeopleLabels()
  const { i18n } = useTranslation()
  const locale = i18n.language
  const { today: todayDate } = usePeopleHotel()
  const s = entry.staff
  const key = entry.key
  const [moreOpen, setMoreOpen] = useState(false)
  const coverage = useCoverage(s.user_id, s.status === 'active' && coverageRolesFor(s.role).length > 0)

  const mail = safeMailHref(s.email)
  const tel = safeTelHref(s.phone)
  const report = teamReportHref(s.user_id)
  const guards = accessGuards(staffList, s, selfUserId)
  const canDeactivate = s.status === 'active' && s.user_id !== selfUserId && guards.reason !== 'lastGm'
  const active = s.status === 'active'
  const dash = <span className="text-ink-3">{t('people.profile.notProvided')}</span>

  const range = today && today.kind !== 'not_scheduled' ? formatShiftRange(today.start, today.end) : null

  return (
    <div>
      <div className="flex items-center gap-4">
        <PersonAvatar entry={entry} name={entry.name || entry.email} size={56} />
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold text-ink">{s.full_name || entry.name || s.email}</p>
          <p className="truncate text-sm text-ink-2">
            {[entry.departmentName ?? t('people.filters.unassigned'), roleLabel(s.role)].join(' · ')}
          </p>
          <div className="mt-1"><StatusBadge status={entry.status} /></div>
        </div>
      </div>

      {(mail || tel) && (
        <div className="mt-4 flex gap-3">
          {mail && <a href={mail} className={actionLink}><Mail size={16} aria-hidden="true" />{t('people.profile.email')}</a>}
          {tel && <a href={tel} className={actionLink}><Phone size={16} aria-hidden="true" />{t('people.profile.call')}</a>}
        </div>
      )}

      {!active && (
        <div className="mt-4"><Banner tone="info">{t('people.profile.deactivatedNotice')}</Banner></div>
      )}

      <div className="mt-6">
        <Section
          title={t('people.profile.contact')}
          action={<LinkButton onClick={() => onView({ view: 'edit', key })} label={t('people.profile.editContact')}>{t('people.profile.edit')}</LinkButton>}
        >
          <dl>
            <DetailRow label={t('people.form.fullName')}>{s.full_name || dash}</DetailRow>
            <DetailRow label={t('people.form.preferredName')}>{s.preferred_name || dash}</DetailRow>
            <DetailRow label={t('people.form.email')}>{s.email || dash}</DetailRow>
            <DetailRow label={t('people.form.phone')}>{s.phone || dash}</DetailRow>
          </dl>
        </Section>

        <Section
          title={t('people.profile.team')}
          action={<LinkButton onClick={() => onView({ view: 'edit', key })} label={t('people.profile.editTeam')}>{t('people.profile.edit')}</LinkButton>}
        >
          <dl>
            <DetailRow label={t('people.form.department')}>{entry.departmentName ?? t('people.filters.unassigned')}</DetailRow>
            <DetailRow label={t('people.form.role')}>{roleLabel(s.role)}</DetailRow>
            {entry.customRoleName && <DetailRow label={t('people.profile.customRole')}>{entry.customRoleName}</DetailRow>}
          </dl>
        </Section>

        {active && (
          <Section title={t('people.profile.todayHeading')}>
            {todaySource === 'loading' ? (
              <Skeleton className="h-10 w-40" />
            ) : todaySource === 'error' ? (
              <p className="text-sm text-ink-3">{t('people.today.unavailable')}</p>
            ) : !today || today.kind === 'not_scheduled' ? (
              <p className="text-sm text-ink-3">{t('people.profile.notScheduledToday')}</p>
            ) : (
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-ink">{today.shiftName ?? t('people.today.scheduled')}</p>
                {range && <p className="text-sm text-ink-2">{range}</p>}
                {today.kind === 'clocked_in' && (
                  <p className="flex items-center gap-1.5 text-sm font-medium text-[var(--ready)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--ready)]" aria-hidden="true" />{t('people.today.clockedIn')}
                  </p>
                )}
                {today.kind === 'finished' && <p className="text-sm text-ink-3">{t('people.today.finished')}</p>}
              </div>
            )}
            <Link href="/scheduling" className="mt-2 inline-flex min-h-[32px] items-center text-xs font-semibold text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
              {t('people.profile.viewSchedule')} →
            </Link>
          </Section>
        )}

        <Section
          title={t('people.profile.access')}
          action={active ? <LinkButton onClick={() => onView({ view: 'access', key })} label={t('people.profile.manageAccess')}>{t('people.profile.manage')}</LinkButton> : undefined}
        >
          <dl>
            <DetailRow label={t('people.profile.baseRole')}>{roleLabel(s.role)}</DetailRow>
            <DetailRow label={t('people.profile.customAccess')}>{entry.customRoleName ?? t('people.profile.standard')}</DetailRow>
            {active && coverageRolesFor(s.role).length > 0 && (
              <DetailRow label={t('people.profile.coverage')}>
                {coverage.isLoading ? (
                  <Skeleton className="ml-auto h-4 w-28" />
                ) : coverage.isError ? (
                  <button type="button" onClick={() => coverage.refetch()} className="text-xs font-semibold text-[var(--alert)] underline">
                    {t('people.profile.coverageError')}
                  </button>
                ) : (() => {
                  const list = coverage.data ?? []
                  const now = activeCoverageToday(list, todayDate)
                  const upcoming = list.find((c) => coverageStatus(c, todayDate) === 'upcoming')
                  const current = list.find((c) => coverageStatus(c, todayDate) === 'current')
                  const shown = now ?? current ?? upcoming
                  if (!shown) return <span className="text-ink-3">{t('people.profile.coverageNone')}</span>
                  const until = formatCalendarDate(shown.end_date, locale)
                  return (
                    <span>
                      {roleLabel(shown.override_role)}
                      <span className="block text-xs text-ink-3">
                        {formatDays(shown.days_of_week, locale)}
                        {coverageStatus(shown, todayDate) === 'upcoming'
                          ? ` · ${t('people.coverage.status.upcoming')}`
                          : until ? ` · ${t('people.coverage.until', { date: until })}` : ''}
                      </span>
                    </span>
                  )
                })()}
              </DetailRow>
            )}
          </dl>
          {active && coverageRolesFor(s.role).length > 0 && (
            <div className="mt-1"><LinkButton onClick={() => onView({ view: 'coverage', key })}>{t('people.profile.manageCoverage')}</LinkButton></div>
          )}
        </Section>

        {isGM && 'hourly_rate' in s && (
          <Section title={t('people.profile.costing')}>
            <dl>
              <DetailRow label={t('people.profile.laborRate')}>
                {s.hourly_rate != null ? t('people.profile.perHour', { rate: s.hourly_rate.toFixed(2) }) : <span className="text-ink-3">{t('people.profile.rateNotSet')}</span>}
              </DetailRow>
            </dl>
            <p className="mt-1 text-xs text-ink-3">{t('people.profile.costingHint')}</p>
          </Section>
        )}

        <div className="mt-6 flex flex-col gap-1">
          {report && (
            <Link href={report} className="inline-flex min-h-[44px] items-center gap-2 rounded-lg text-sm font-medium text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] sm:min-h-[36px]">
              <BarChart3 size={16} aria-hidden="true" />{t('people.profile.teamReport')} →
            </Link>
          )}
        </div>

        <div className="mt-6 border-t border-line pt-3">
          <button
            type="button"
            aria-expanded={moreOpen}
            aria-controls="people-more-actions"
            onClick={() => setMoreOpen((o) => !o)}
            className="flex min-h-[44px] w-full items-center justify-between rounded-lg px-1 text-sm font-medium text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] sm:min-h-[36px]"
          >
            {t('people.profile.more')}
            <ChevronDown size={16} aria-hidden="true" className={cn('transition-transform motion-reduce:transition-none', moreOpen && 'rotate-180')} />
          </button>
          {moreOpen && (
            <div id="people-more-actions" className="mt-1 space-y-2">
              {active ? (
                canDeactivate ? (
                  <Button variant="outline" onClick={() => onDeactivate(s)} className="w-full justify-center text-[var(--alert)]">
                    <UserX size={16} aria-hidden="true" />{t('people.actions.deactivate')}
                  </Button>
                ) : (
                  <p className="text-xs text-ink-3">
                    {s.user_id === selfUserId ? t('people.profile.cannotDeactivateSelf') : t('people.profile.cannotDeactivateLastGm')}
                  </p>
                )
              ) : (
                <Button variant="outline" onClick={() => onReactivate(s)} className="w-full justify-center">
                  <UserCheck size={16} aria-hidden="true" />{t('people.actions.reactivate')}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
