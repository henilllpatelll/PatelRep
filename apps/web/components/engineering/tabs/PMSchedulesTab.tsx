'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { format, differenceInDays, addDays } from 'date-fns'
import { Calendar, Plus, AlertTriangle, Clock, CheckCircle } from 'lucide-react'
import { engineeringApi, type PMSchedule } from '@/lib/api/engineering'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PMCompletionModal } from '@/components/engineering/PMCompletionModal'
import { CreatePMScheduleModal, formatIntervalLabel } from '@/components/engineering/CreatePMScheduleModal'
import { StateBlock } from '@/components/ui/StateBlock'
import { EmptyState } from '@/components/ui/EmptyState'
import { Pill, Stat } from '@/components/ui/primitives'

type ScheduleTone = 'alert' | 'caution' | 'ready'

function getScheduleStatus(nextDueAt: string, t: TFunction): {
  kind: 'overdue' | 'due_soon' | 'upcoming'
  label: string
  tone: ScheduleTone
} {
  const now = new Date()
  const due = new Date(nextDueAt)
  if (due < now) {
    return { kind: 'overdue', label: t('programs.pmSchedules.statusOverdue'), tone: 'alert' }
  }
  const daysUntil = differenceInDays(due, now)
  if (daysUntil <= 7) {
    return { kind: 'due_soon', label: t('programs.pmSchedules.statusDueSoon'), tone: 'caution' }
  }
  return { kind: 'upcoming', label: t('programs.pmSchedules.statusUpcoming'), tone: 'ready' }
}

function calcNextDueAt(intervalType: PMSchedule['interval_type'], intervalDays?: number): Date {
  const now = new Date()
  const offsetMap: Record<string, number> = { daily: 1, weekly: 7, monthly: 30, quarterly: 90, annual: 365 }
  if (intervalType === 'custom') {
    return addDays(now, intervalDays ?? 1)
  }
  return addDays(now, offsetMap[intervalType] ?? 30)
}

function PMScheduleMobileCard({
  schedule,
  canEdit,
  isOverdue,
  status,
  onComplete,
  onCreateWO,
  onAskDeactivate,
  onConfirmDeactivate,
  onCancelDeactivate,
  confirmingDeactivate,
}: {
  schedule: PMSchedule
  canEdit: boolean
  isOverdue: boolean
  status: ReturnType<typeof getScheduleStatus>
  onComplete: () => void
  onCreateWO: () => void
  onAskDeactivate: () => void
  onConfirmDeactivate: () => void
  onCancelDeactivate: () => void
  confirmingDeactivate: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className="border-b border-amber-100 px-4 py-4 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0" data-i18n-skip="true">
          <p className="text-base font-semibold text-ink">
            {schedule.assets?.name ?? t('programs.pmSchedules.unknownAsset')}
          </p>
          <p className="mt-0.5 text-sm text-ink2">{schedule.name}</p>
        </div>
        <Pill tone={status.tone} size="md">{status.label}</Pill>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink3">{t('programs.pmSchedules.colNextDue')}</dt>
          <dd className={isOverdue ? 'mt-1 font-medium text-[var(--alert)]' : 'mt-1 text-ink2'}>
            {format(new Date(schedule.next_due_at), 'MMM d, yyyy')}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink3">{t('programs.pmSchedules.colEstTime')}</dt>
          <dd className="mt-1 text-ink2">{schedule.estimated_minutes ?? '-'} {t('programs.pmSchedules.minutesSuffix')}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink3">{t('programs.pmSchedules.colInterval')}</dt>
          <dd className="mt-1 text-ink2">
            {formatIntervalLabel(schedule.interval_type, schedule.interval_days, t)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink3">{t('programs.pmSchedules.colLastDone')}</dt>
          <dd className="mt-1 text-ink2">
            {schedule.last_completed_at ? format(new Date(schedule.last_completed_at), 'MMM d, yyyy') : t('programs.pmSchedules.never')}
          </dd>
        </div>
      </dl>
      <div className="mt-4 grid grid-cols-1 gap-2">
        {schedule.is_active && (
          <Button variant="outline" onClick={onComplete} className="border-[var(--ready-line)] text-[var(--ready)] hover:bg-[var(--ready-soft)]">
            {t('programs.pmSchedules.complete')}
          </Button>
        )}
        {canEdit && schedule.is_active && (
          confirmingDeactivate ? (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={onConfirmDeactivate} className="border-[var(--alert-line)] text-[var(--alert)]">
                {t('programs.pmSchedules.confirm')}
              </Button>
              <Button variant="outline" onClick={onCancelDeactivate}>
                {t('programs.pmSchedules.cancel')}
              </Button>
            </div>
          ) : (
            <Button variant="outline" onClick={onAskDeactivate} className="border-[var(--alert-line)] text-[var(--alert)] hover:bg-[var(--alert-soft)]">
              {t('programs.pmSchedules.deactivate')}
            </Button>
          )
        )}
        {canEdit && isOverdue && (
          <Button variant="outline" onClick={onCreateWO} className="border-[var(--info-line)] text-[var(--info)] hover:bg-[var(--info-soft)]">
            {t('programs.pmSchedules.createWorkOrderFull')}
          </Button>
        )}
      </div>
    </div>
  )
}

function SkeletonRow() {
  return (
    <tr className="animate-pulse border-b border-[var(--caution-line)]">
      <td className="px-4 py-3"><div className="h-4 bg-surface-3 rounded w-3/4" /></td>
      <td className="px-4 py-3"><div className="h-4 bg-surface-3 rounded w-1/2" /></td>
      <td className="px-4 py-3"><div className="h-4 bg-surface-3 rounded w-20" /></td>
      <td className="px-4 py-3"><div className="h-4 bg-surface-3 rounded w-24" /></td>
      <td className="px-4 py-3"><div className="h-4 bg-surface-3 rounded w-16" /></td>
      <td className="px-4 py-3"><div className="h-4 bg-surface-3 rounded w-24" /></td>
      <td className="px-4 py-3"><div className="h-5 bg-surface-3 rounded w-16" /></td>
      <td className="px-4 py-3"><div className="h-5 bg-surface-3 rounded w-28" /></td>
    </tr>
  )
}

interface PMSchedulesTabProps {
  canEdit: boolean
  showCreateModal: boolean
  onCloseCreateModal: () => void
  onRequestCreate: () => void
}

export function PMSchedulesTab({ canEdit, showCreateModal, onCloseCreateModal, onRequestCreate }: PMSchedulesTabProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [completingSchedule, setCompletingSchedule] = useState<PMSchedule | null>(null)
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const { data: schedulesData, isLoading, isError } = useQuery({
    queryKey: ['pm-schedules'],
    queryFn: () => engineeringApi.listPMSchedules(),
    select: (res) => res.data as PMSchedule[],
  })

  const schedules = schedulesData ?? []

  const now = new Date()
  const activeSchedules = schedules.filter((s) => s.is_active)
  const overdueCount = schedules.filter((s) => new Date(s.next_due_at) < now).length
  const dueThisWeekCount = schedules.filter((s) => {
    const due = new Date(s.next_due_at)
    const days = differenceInDays(due, now)
    return days >= 0 && days <= 7
  }).length

  function handleCreateSuccess() {
    queryClient.invalidateQueries({ queryKey: ['pm-schedules'] })
  }

  function handleCompleteSuccess(scheduleName: string, nextDueAt: Date) {
    queryClient.invalidateQueries({ queryKey: ['pm-schedules'] })
    setSuccessMessage(
      t('programs.pmSchedules.completeSuccessMessage', { name: scheduleName, date: format(nextDueAt, 'MMM d, yyyy') }),
    )
    setTimeout(() => setSuccessMessage(null), 4000)
  }

  async function handleDeactivate(scheduleId: string) {
    try {
      await engineeringApi.deactivatePMSchedule(scheduleId)
      queryClient.invalidateQueries({ queryKey: ['pm-schedules'] })
      setConfirmDeactivateId(null)
    } catch {
      // deactivation failed — user can retry
    }
  }

  async function handleCreateWOFromPM(schedule: PMSchedule) {
    try {
      await engineeringApi.createWorkOrder({
        title: `PM Due: ${schedule.name}`,
        description: schedule.description,
        category: 'general',
        priority: 'normal',
        asset_id: schedule.asset_id,
      })
      setSuccessMessage(t('programs.pmSchedules.woCreatedMessage', { name: schedule.name }))
      setTimeout(() => setSuccessMessage(null), 4000)
    } catch {
      // work order creation failed — user can retry
    }
  }

  return (
    <div className="space-y-5">
      {successMessage && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-[var(--ready-soft)] border border-green-200 text-[var(--ready)] text-sm">
          <CheckCircle size={15} />
          {successMessage}
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat label={t('programs.pmSchedules.totalSchedules')} value={activeSchedules.length} hint={t('programs.pmSchedules.activeSchedulesSub')} icon={<Calendar size={16} />} />
        <Stat
          label={t('programs.pmSchedules.dueThisWeek')}
          value={<span className={dueThisWeekCount > 0 ? 'text-[var(--caution)]' : undefined}>{dueThisWeekCount}</span>}
          hint={t('programs.pmSchedules.within7Days')}
          icon={<Clock size={16} />}
        />
        <Stat
          label={t('programs.pmSchedules.overdueStat')}
          value={<span className={overdueCount > 0 ? 'text-[var(--alert)]' : undefined}>{overdueCount}</span>}
          hint={t('programs.pmSchedules.pastDueDateSub')}
          icon={<AlertTriangle size={16} />}
        />
      </div>

      {/* Table */}
      <Card className="p-0 overflow-hidden">
        {isError ? (
          <StateBlock
            status="error"
            error={{ message: t('programs.pmSchedules.failedToLoad'), onRetry: () => queryClient.invalidateQueries({ queryKey: ['pm-schedules'] }) }}
          />
        ) : (
          <>
          <div className="md:hidden">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-32 animate-pulse rounded-xl bg-surface-3" />
                ))}
              </div>
            ) : schedules.length === 0 ? (
              <EmptyState
                icon={<Calendar size={22} />}
                title={t('programs.pmSchedules.noSchedules')}
                body={t('programs.pmSchedules.noSchedulesHelp')}
                action={canEdit ? (
                  <Button variant="primary" onClick={onRequestCreate}>
                    <Plus size={14} />
                    {t('programs.pmSchedules.createSchedule')}
                  </Button>
                ) : undefined}
              />
            ) : (
              schedules.map((schedule) => {
                const status = getScheduleStatus(schedule.next_due_at, t)
                const dueDate = new Date(schedule.next_due_at)
                const isOverdue = dueDate < now
                return (
                  <PMScheduleMobileCard
                    key={schedule.id}
                    schedule={schedule}
                    canEdit={canEdit}
                    isOverdue={isOverdue}
                    status={status}
                    onComplete={() => setCompletingSchedule(schedule)}
                    onCreateWO={() => handleCreateWOFromPM(schedule)}
                    onAskDeactivate={() => setConfirmDeactivateId(schedule.id)}
                    onConfirmDeactivate={() => handleDeactivate(schedule.id)}
                    onCancelDeactivate={() => setConfirmDeactivateId(null)}
                    confirmingDeactivate={confirmDeactivateId === schedule.id}
                  />
                )
              })
            )}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-amber-100 bg-[var(--caution-soft)]/60">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">{t('programs.pmSchedules.colAsset')}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">{t('programs.pmSchedules.colScheduleName')}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">{t('programs.pmSchedules.colInterval')}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">{t('programs.pmSchedules.colNextDue')}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">{t('programs.pmSchedules.colEstTime')}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">{t('programs.pmSchedules.colLastDone')}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">{t('programs.pmSchedules.colStatus')}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">{t('programs.pmSchedules.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
                ) : schedules.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-14">
                      <EmptyState
                        icon={<Calendar size={22} />}
                        title={t('programs.pmSchedules.noSchedules')}
                        body={t('programs.pmSchedules.noSchedulesHelp')}
                        action={
                          <div className="flex flex-col items-center gap-3">
                            <div className="grid w-full max-w-2xl grid-cols-1 gap-3 text-left sm:grid-cols-3">
                              {[
                                t('programs.pmSchedules.exampleHvac'),
                                t('programs.pmSchedules.examplePool'),
                                t('programs.pmSchedules.exampleElevator'),
                              ].map((item) => (
                                <div key={item} className="rounded-xl border border-amber-100 bg-[var(--caution-soft)]/50 px-4 py-3">
                                  <p className="text-sm font-semibold text-ink">{item}</p>
                                  <p className="mt-1 text-xs text-ink3">{t('programs.pmSchedules.commonPMSchedule')}</p>
                                </div>
                              ))}
                            </div>
                            {canEdit && (
                              <Button variant="primary" onClick={onRequestCreate}>
                                <Plus size={14} />
                                {t('programs.pmSchedules.createSchedule')}
                              </Button>
                            )}
                          </div>
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  schedules.map((schedule) => {
                    const status = getScheduleStatus(schedule.next_due_at, t)
                    const dueDate = new Date(schedule.next_due_at)
                    const isOverdue = dueDate < now
                    return (
                      <tr key={schedule.id} className="border-b border-[var(--caution-line)] hover:bg-[var(--caution-soft)]/40 transition-colors">
                        <td className="px-4 py-3" data-i18n-skip="true">
                          <p className="font-medium text-ink leading-tight">
                            {schedule.assets?.name ?? (
                              <span className="text-ink3 font-normal italic">{t('programs.pmSchedules.unknownAsset')}</span>
                            )}
                          </p>
                        </td>

                        <td className="px-4 py-3 text-ink2" data-i18n-skip="true">{schedule.name}</td>

                        <td className="px-4 py-3">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-surface-2 text-ink2 border border-line-2">
                            {formatIntervalLabel(schedule.interval_type, schedule.interval_days, t)}
                          </span>
                        </td>

                        <td className={`px-4 py-3 text-sm font-medium ${isOverdue ? 'text-[var(--alert)]' : 'text-ink2'}`}>
                          {format(dueDate, 'MMM d, yyyy')}
                        </td>

                        <td className="px-4 py-3 text-ink2">
                          {schedule.estimated_minutes} {t('programs.pmSchedules.minutesSuffix')}
                        </td>

                        <td className="px-4 py-3 text-ink3 text-xs">
                          {schedule.last_completed_at ? (
                            format(new Date(schedule.last_completed_at), 'MMM d, yyyy')
                          ) : (
                            <span className="italic text-ink4">{t('programs.pmSchedules.never')}</span>
                          )}
                        </td>

                        <td className="px-4 py-3">
                          <Pill tone={status.tone} size="sm">
                            {status.kind === 'overdue' && <AlertTriangle size={11} />}
                            {status.kind === 'due_soon' && <Clock size={11} />}
                            {status.kind === 'upcoming' && <CheckCircle size={11} />}
                            {status.label}
                          </Pill>
                        </td>

                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {schedule.is_active && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setCompletingSchedule(schedule)}
                                className="border-[var(--ready-line)] text-[var(--ready)] hover:bg-[var(--ready-soft)]"
                              >
                                {t('programs.pmSchedules.complete')}
                              </Button>
                            )}

                            {canEdit && schedule.is_active && (
                              confirmDeactivateId === schedule.id ? (
                                <span className="flex items-center gap-1">
                                  <Button variant="ghost" size="sm" onClick={() => handleDeactivate(schedule.id)} className="text-[var(--alert)] hover:underline">
                                    {t('programs.pmSchedules.confirm')}
                                  </Button>
                                  <Button variant="ghost" size="sm" onClick={() => setConfirmDeactivateId(null)} className="text-ink3 hover:underline">
                                    {t('programs.pmSchedules.cancel')}
                                  </Button>
                                </span>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setConfirmDeactivateId(schedule.id)}
                                  className="border-[var(--alert-line)] text-[var(--alert)] hover:bg-[var(--alert-soft)]"
                                >
                                  {t('programs.pmSchedules.deactivate')}
                                </Button>
                              )
                            )}

                            {canEdit && isOverdue && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleCreateWOFromPM(schedule)}
                                className="border-[var(--info-line)] text-[var(--info)] hover:bg-[var(--info-soft)]"
                              >
                                {t('programs.pmSchedules.createWO')}
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
          </>
        )}

        {!isLoading && !isError && schedules.length > 0 && (
          <div className="px-4 py-2.5 border-t border-[var(--caution-line)] bg-[var(--caution-soft)]/40 flex items-center justify-between">
            <p className="text-xs text-ink3">
              {schedules.length === 1
                ? t('programs.pmSchedules.scheduleCountOne', { count: schedules.length })
                : t('programs.pmSchedules.scheduleCountOther', { count: schedules.length })}
            </p>
            {overdueCount > 0 && (
              <p className="text-xs font-medium text-[var(--alert)]">
                {t('programs.pmSchedules.overdueCount', { count: overdueCount })}
              </p>
            )}
          </div>
        )}
      </Card>

      {/* Modals */}
      <CreatePMScheduleModal isOpen={showCreateModal} onClose={onCloseCreateModal} onSuccess={handleCreateSuccess} />

      <PMCompletionModal
        isOpen={completingSchedule !== null}
        onClose={() => setCompletingSchedule(null)}
        schedule={completingSchedule}
        onSuccess={() => {
          if (completingSchedule) {
            const nextDue = calcNextDueAt(completingSchedule.interval_type, completingSchedule.interval_days)
            handleCompleteSuccess(completingSchedule.name, nextDue)
          }
          setCompletingSchedule(null)
        }}
      />
    </div>
  )
}
