'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { format, differenceInDays, addDays } from 'date-fns'
import {
  Calendar,
  Plus,
  AlertTriangle,
  Clock,
  CheckCircle,
  X,
  Loader2,
} from 'lucide-react'
import { engineeringApi, PMSchedule } from '@/lib/api/engineering'
import { useRole } from '@/lib/hooks/useRole'
import { Card } from '@/components/ui/Card'
import { Button, IconButton } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { PageHeader } from '@/components/shared/PageHeader'
import { PMCompletionModal } from '@/components/engineering/PMCompletionModal'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'
import { useHotelStore } from '@/stores/hotelStore'
import { isSectionRedesigned } from '@/lib/utils/redesignFlag'
import { StateBlock } from '@/components/ui/StateBlock'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getScheduleStatus(nextDueAt: string, t: TFunction): {
  kind: 'overdue' | 'due_soon' | 'upcoming'
  label: string
  cls: string
  badgeCls: string
} {
  const now = new Date()
  const due = new Date(nextDueAt)
  if (due < now) {
    return {
      kind: 'overdue',
      label: t('programs.pmSchedules.statusOverdue'),
      cls: 'text-[var(--alert)]',
      badgeCls: 'bg-[var(--alert-soft)] text-red-700 border border-red-200',
    }
  }
  const daysUntil = differenceInDays(due, now)
  if (daysUntil <= 7) {
    return {
      kind: 'due_soon',
      label: t('programs.pmSchedules.statusDueSoon'),
      cls: 'text-orange-600',
      badgeCls: 'bg-[var(--caution-soft)] text-[var(--caution)] border border-[var(--caution-line)]',
    }
  }
  return {
    kind: 'upcoming',
    label: t('programs.pmSchedules.statusUpcoming'),
    cls: 'text-green-700',
    badgeCls: 'bg-[var(--ready-soft)] text-green-700 border border-green-200',
  }
}

const INTERVAL_LABEL_KEYS: Record<string, string> = {
  daily: 'intervalDaily',
  weekly: 'intervalWeekly',
  monthly: 'intervalMonthly',
  quarterly: 'intervalQuarterly',
  annual: 'intervalAnnual',
}

function formatIntervalLabel(
  intervalType: PMSchedule['interval_type'],
  intervalDays: number | undefined,
  t: TFunction,
): string {
  if (intervalType === 'custom') {
    return intervalDays
      ? t('programs.pmSchedules.everyDaysInterval', { count: intervalDays })
      : t('programs.pmSchedules.custom')
  }
  const key = INTERVAL_LABEL_KEYS[intervalType]
  return key ? t(`programs.pmSchedules.${key}`) : intervalType
}

function calcNextDueAt(intervalType: PMSchedule['interval_type'], intervalDays?: number): Date {
  const now = new Date()
  const offsetMap: Record<string, number> = {
    daily: 1,
    weekly: 7,
    monthly: 30,
    quarterly: 90,
    annual: 365,
  }
  if (intervalType === 'custom') {
    return addDays(now, intervalDays ?? 1)
  }
  return addDays(now, offsetMap[intervalType] ?? 30)
}

// ─── Stat card ────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string
  value: number
  sub?: string
  accent?: 'red' | 'orange' | 'default'
  icon: React.ReactNode
}

function StatCard({ label, value, sub, accent = 'default', icon }: StatCardProps) {
  const valueColor =
    accent === 'red'
      ? 'text-[var(--alert)]'
      : accent === 'orange'
        ? 'text-orange-600'
        : 'text-gray-900'
  return (
    <Card className={`px-5 py-4${accent === 'red' ? ' border-red-200 bg-[var(--alert-soft)]' : ''}`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
        <div className="text-gray-400">{icon}</div>
      </div>
      <p className={`text-2xl font-bold ${valueColor}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </Card>
  )
}

// ─── Skeleton row ─────────────────────────────────────────────────────────────

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
          <p className="text-base font-semibold text-gray-900">
            {schedule.assets?.name ?? t('programs.pmSchedules.unknownAsset')}
          </p>
          <p className="mt-0.5 text-sm text-gray-600">{schedule.name}</p>
        </div>
        <span className={`inline-flex min-h-[32px] items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${status.badgeCls}`}>
          {status.label}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t('programs.pmSchedules.colNextDue')}</dt>
          <dd className={isOverdue ? 'mt-1 font-medium text-[var(--alert)]' : 'mt-1 text-gray-700'}>
            {format(new Date(schedule.next_due_at), 'MMM d, yyyy')}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t('programs.pmSchedules.colEstTime')}</dt>
          <dd className="mt-1 text-gray-700">{schedule.estimated_minutes ?? '-'} {t('programs.pmSchedules.minutesSuffix')}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t('programs.pmSchedules.colInterval')}</dt>
          <dd className="mt-1 text-gray-700">
            {formatIntervalLabel(schedule.interval_type, schedule.interval_days, t)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t('programs.pmSchedules.colLastDone')}</dt>
          <dd className="mt-1 text-gray-700">
            {schedule.last_completed_at ? format(new Date(schedule.last_completed_at), 'MMM d, yyyy') : t('programs.pmSchedules.never')}
          </dd>
        </div>
      </dl>
      <div className="mt-4 grid grid-cols-1 gap-2">
        {schedule.is_active && (
          <Button
            variant="outline"
            onClick={onComplete}
            className="border-[var(--ready-line)] text-[var(--ready)] hover:bg-[var(--ready-soft)]"
          >
            {t('programs.pmSchedules.complete')}
          </Button>
        )}
        {canEdit && schedule.is_active && (
          confirmingDeactivate ? (
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={onConfirmDeactivate}
                className="border-[var(--alert-line)] text-[var(--alert)]"
              >
                {t('programs.pmSchedules.confirm')}
              </Button>
              <Button variant="outline" onClick={onCancelDeactivate}>
                {t('programs.pmSchedules.cancel')}
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              onClick={onAskDeactivate}
              className="border-[var(--alert-line)] text-[var(--alert)] hover:bg-[var(--alert-soft)]"
            >
              {t('programs.pmSchedules.deactivate')}
            </Button>
          )
        )}
        {canEdit && isOverdue && (
          <Button
            variant="outline"
            onClick={onCreateWO}
            className="border-[var(--info-line)] text-[var(--info)] hover:bg-[var(--info-soft)]"
          >
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
      <td className="px-4 py-3"><div className="h-4 bg-gray-100 rounded w-3/4" /></td>
      <td className="px-4 py-3"><div className="h-4 bg-gray-100 rounded w-1/2" /></td>
      <td className="px-4 py-3"><div className="h-4 bg-gray-100 rounded w-20" /></td>
      <td className="px-4 py-3"><div className="h-4 bg-gray-100 rounded w-24" /></td>
      <td className="px-4 py-3"><div className="h-4 bg-gray-100 rounded w-16" /></td>
      <td className="px-4 py-3"><div className="h-4 bg-gray-100 rounded w-24" /></td>
      <td className="px-4 py-3"><div className="h-5 bg-gray-100 rounded w-16" /></td>
      <td className="px-4 py-3"><div className="h-5 bg-gray-100 rounded w-28" /></td>
    </tr>
  )
}

// ─── Create PM Schedule Modal ─────────────────────────────────────────────────

interface CreatePMScheduleModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

const INTERVAL_OPTIONS: PMSchedule['interval_type'][] = [
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'annual',
  'custom',
]

function CreatePMScheduleModal({ isOpen, onClose, onSuccess }: CreatePMScheduleModalProps) {
  const { t } = useTranslation()
  const [fields, setFields] = useState({
    asset_id: '',
    name: '',
    description: '',
    interval_type: 'monthly' as PMSchedule['interval_type'],
    interval_days: '',
    estimated_minutes: '',
    next_due_at: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const modalRef = useRef<HTMLDivElement>(null!)
  useModalFocusTrap(modalRef, isOpen, () => { if (!saving) onClose() })

  useEffect(() => {
    if (isOpen) {
      setFields({
        asset_id: '',
        name: '',
        description: '',
        interval_type: 'monthly',
        interval_days: '',
        estimated_minutes: '',
        next_due_at: '',
      })
      setError(null)
    }
  }, [isOpen])

  if (!isOpen) return null

  function set<K extends keyof typeof fields>(key: K, value: (typeof fields)[K]) {
    setFields((prev) => ({ ...prev, [key]: value }))
  }

  async function handleCreate() {
    if (!fields.name.trim()) {
      setError(t('programs.pmSchedules.addModal.nameRequired'))
      return
    }
    if (!fields.next_due_at) {
      setError(t('programs.pmSchedules.addModal.dateRequired'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      await engineeringApi.createPMSchedule({
        asset_id: fields.asset_id.trim(),
        name: fields.name.trim(),
        description: fields.description.trim() || undefined,
        interval_type: fields.interval_type,
        interval_days:
          fields.interval_type === 'custom' && fields.interval_days
            ? Number(fields.interval_days)
            : undefined,
        estimated_minutes: fields.estimated_minutes ? Number(fields.estimated_minutes) : undefined,
        next_due_at: fields.next_due_at,
      })
      onSuccess()
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('programs.pmSchedules.addModal.createFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 bg-stone-900/20 backdrop-blur-sm z-50"
        onClick={!saving ? onClose : undefined}
        aria-hidden="true"
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-label={t('programs.pmSchedules.addModal.title')}
          className="bg-surface/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-[var(--r-lg)] shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[var(--caution)] flex items-center justify-center shrink-0">
                <Calendar size={16} className="text-white" />
              </div>
              <h2 className="text-base font-bold text-gray-900">{t('programs.pmSchedules.addModal.title')}</h2>
            </div>
            {!saving && (
              <IconButton
                variant="ghost"
                onClick={onClose}
                aria-label={t('programs.pmSchedules.addModal.close')}
              >
                <X size={18} />
              </IconButton>
            )}
          </div>

          <div className="space-y-4">
            {/* Asset ID */}
            <div>
              <label htmlFor="pm-create-asset-id" className="block text-sm font-medium text-gray-700 mb-1.5">
                {t('programs.pmSchedules.addModal.assetIdLabel')}{' '}
                <span className="text-gray-400 font-normal">{t('programs.pmSchedules.addModal.assetIdUuid')}</span>
              </label>
              <Input
                id="pm-create-asset-id"
                type="text"
                value={fields.asset_id}
                onChange={(e) => set('asset_id', e.target.value)}
                placeholder={t('programs.pmSchedules.addModal.assetIdPlaceholder')}
                className="font-mono"
              />
              <p className="text-xs text-gray-400 mt-1">
                {t('programs.pmSchedules.addModal.assetIdHelp')}
              </p>
            </div>

            {/* Schedule name */}
            <div>
              <label htmlFor="pm-create-name" className="block text-sm font-medium text-gray-700 mb-1.5">
                {t('programs.pmSchedules.addModal.scheduleNameLabel')} <span className="text-[var(--alert)]">*</span>
              </label>
              <Input
                id="pm-create-name"
                type="text"
                value={fields.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder={t('programs.pmSchedules.addModal.scheduleNamePlaceholder')}
              />
            </div>

            {/* Description */}
            <div>
              <label htmlFor="pm-create-description" className="block text-sm font-medium text-gray-700 mb-1.5">
                {t('programs.pmSchedules.addModal.descriptionLabel')}{' '}
                <span className="text-gray-400 font-normal">{t('programs.pmSchedules.addModal.optionalTag')}</span>
              </label>
              <textarea
                id="pm-create-description"
                rows={2}
                value={fields.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder={t('programs.pmSchedules.addModal.descriptionPlaceholder')}
                className="w-full border border-[var(--caution-line)]/40 rounded-lg px-3 py-2 text-sm bg-surface/70 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-[var(--caution-line)] transition-colors resize-none"
              />
            </div>

            {/* Interval type + days */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="pm-create-interval-type" className="block text-sm font-medium text-gray-700 mb-1.5">
                  {t('programs.pmSchedules.addModal.intervalTypeLabel')}
                </label>
                <select
                  id="pm-create-interval-type"
                  value={fields.interval_type}
                  onChange={(e) =>
                    set('interval_type', e.target.value as PMSchedule['interval_type'])
                  }
                  className="w-full border border-[var(--caution-line)]/40 rounded-lg px-3 py-2 text-sm bg-surface/70 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-[var(--caution-line)] transition-colors"
                >
                  {INTERVAL_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {formatIntervalLabel(opt, undefined, t)}
                    </option>
                  ))}
                </select>
              </div>
              {fields.interval_type === 'custom' && (
                <div>
                  <label htmlFor="pm-create-interval-days" className="block text-sm font-medium text-gray-700 mb-1.5">
                    {t('programs.pmSchedules.addModal.intervalDaysLabel')}
                  </label>
                  <Input
                    id="pm-create-interval-days"
                    type="number"
                    min={1}
                    value={fields.interval_days}
                    onChange={(e) => set('interval_days', e.target.value)}
                    placeholder={t('programs.pmSchedules.addModal.intervalDaysPlaceholder')}
                  />
                </div>
              )}
            </div>

            {/* Estimated minutes + next due */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="pm-create-estimated-minutes" className="block text-sm font-medium text-gray-700 mb-1.5">
                  {t('programs.pmSchedules.addModal.estTimeLabel')}
                </label>
                <Input
                  id="pm-create-estimated-minutes"
                  type="number"
                  min={1}
                  value={fields.estimated_minutes}
                  onChange={(e) => set('estimated_minutes', e.target.value)}
                  placeholder={t('programs.pmSchedules.addModal.estTimePlaceholder')}
                />
              </div>
              <div>
                <label htmlFor="pm-create-next-due" className="block text-sm font-medium text-gray-700 mb-1.5">
                  {t('programs.pmSchedules.addModal.nextDueDateLabel')} <span className="text-[var(--alert)]">*</span>
                </label>
                <Input
                  id="pm-create-next-due"
                  type="date"
                  value={fields.next_due_at}
                  onChange={(e) => set('next_due_at', e.target.value)}
                />
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-[var(--alert-soft)] border border-red-200 text-sm text-red-700">
                <AlertTriangle size={14} className="shrink-0" />
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 mt-5 pt-4 border-t border-white/60">
            <Button
              variant="ghost"
              onClick={onClose}
              disabled={saving}
            >
              {t('programs.pmSchedules.cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={handleCreate}
              disabled={saving || !fields.name.trim() || !fields.next_due_at}
            >
              {saving ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  {t('programs.pmSchedules.addModal.creating')}
                </>
              ) : (
                <>
                  <Plus size={14} />
                  {t('programs.pmSchedules.addSchedule')}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PMSchedulesPage() {
  const { t } = useTranslation()
  const { isGM, role } = useRole()
  const canEdit = isGM || role === 'engineer' || role === 'chief_engineer'
  const queryClient = useQueryClient()
  const hotel = useHotelStore((s) => s.hotel)
  const v2 = isSectionRedesigned('engineering', hotel)

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [completingSchedule, setCompletingSchedule] = useState<PMSchedule | null>(null)
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const { data: schedulesData, isLoading, isError } = useQuery({
    queryKey: ['pm-schedules'],
    queryFn: () => engineeringApi.listPMSchedules(),
    select: (res) => res.data as PMSchedule[],
  })

  const schedules = schedulesData ?? []

  // ── Stats ──────────────────────────────────────────────────────────────────

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
      t('programs.pmSchedules.completeSuccessMessage', {
        name: scheduleName,
        date: format(nextDueAt, 'MMM d, yyyy'),
      }),
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
    <div className="space-y-6 max-w-7xl">
      <PageHeader
        eyebrow="Engineering"
        title={t('programs.pmSchedules.title')}
        subtitle={t('programs.pmSchedules.subtitle')}
        dataI18nSkip={v2}
        actions={canEdit && (
          <Button
            variant="primary"
            onClick={() => setShowCreateModal(true)}
            className="shrink-0"
          >
            <Plus size={15} />
            {t('programs.pmSchedules.addSchedule')}
          </Button>
        )}
      />

      {/* ── Success banner ─────────────────────────────────────────────────── */}
      {successMessage && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-[var(--ready-soft)] border border-green-200 text-green-700 text-sm">
          <CheckCircle size={15} />
          {successMessage}
        </div>
      )}

      {/* ── Stats row ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label={t('programs.pmSchedules.totalSchedules')}
          value={activeSchedules.length}
          sub={t('programs.pmSchedules.activeSchedulesSub')}
          icon={<Calendar size={16} />}
        />
        <StatCard
          label={t('programs.pmSchedules.dueThisWeek')}
          value={dueThisWeekCount}
          sub={t('programs.pmSchedules.within7Days')}
          accent={dueThisWeekCount > 0 ? 'orange' : 'default'}
          icon={<Clock size={16} />}
        />
        <StatCard
          label={t('programs.pmSchedules.overdueStat')}
          value={overdueCount}
          sub={t('programs.pmSchedules.pastDueDateSub')}
          accent={overdueCount > 0 ? 'red' : 'default'}
          icon={<AlertTriangle size={16} />}
        />
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <Card className="p-0 overflow-hidden">
        {isError ? (
          v2 ? (
            <StateBlock
              status="error"
              error={{
                message: t('programs.pmSchedules.failedToLoad'),
                onRetry: () => queryClient.invalidateQueries({ queryKey: ['pm-schedules'] }),
              }}
            />
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center p-6">
              <AlertTriangle size={28} className="text-red-400 mb-3" />
              <p className="text-sm font-medium text-gray-700 mb-1">{t('programs.pmSchedules.failedToLoad')}</p>
              <Button
                variant="primary"
                onClick={() => queryClient.invalidateQueries({ queryKey: ['pm-schedules'] })}
                className="mt-2"
              >
                {t('programs.pmSchedules.retry')}
              </Button>
            </div>
          )
        ) : (
          <>
          <div className="md:hidden">
            {isLoading ? (
              v2 ? (
                <div className="p-4 space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} variant="card" className="h-32" />
                  ))}
                </div>
              ) : (
                <div className="p-4 space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-32 animate-pulse rounded-xl bg-gray-100" />
                  ))}
                </div>
              )
            ) : schedules.length === 0 ? (
              v2 ? (
                <EmptyState
                  icon={<Calendar size={22} />}
                  title={t('programs.pmSchedules.noSchedules')}
                  body={t('programs.pmSchedules.noSchedulesHelp')}
                  action={canEdit ? (
                    <Button variant="primary" onClick={() => setShowCreateModal(true)}>
                      <Plus size={14} />
                      {t('programs.pmSchedules.createSchedule')}
                    </Button>
                  ) : undefined}
                />
              ) : (
                <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
                  <div className="w-12 h-12 rounded-[var(--r-lg)] bg-gray-100 flex items-center justify-center">
                    <Calendar size={22} className="text-gray-300" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-600">{t('programs.pmSchedules.noSchedules')}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {t('programs.pmSchedules.noSchedulesHelp')}
                    </p>
                  </div>
                  {canEdit && (
                    <Button variant="primary" onClick={() => setShowCreateModal(true)}>
                      <Plus size={14} />
                      {t('programs.pmSchedules.createSchedule')}
                    </Button>
                  )}
                </div>
              )
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
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {t('programs.pmSchedules.colAsset')}
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {t('programs.pmSchedules.colScheduleName')}
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {t('programs.pmSchedules.colInterval')}
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {t('programs.pmSchedules.colNextDue')}
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {t('programs.pmSchedules.colEstTime')}
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {t('programs.pmSchedules.colLastDone')}
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {t('programs.pmSchedules.colStatus')}
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {t('programs.pmSchedules.colActions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
                ) : schedules.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-14">
                      {v2 ? (
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
                                <Button
                                  variant="primary"
                                  onClick={() => setShowCreateModal(true)}
                                >
                                  <Plus size={14} />
                                  {t('programs.pmSchedules.createSchedule')}
                                </Button>
                              )}
                            </div>
                          }
                        />
                      ) : (
                        <div className="flex flex-col items-center gap-3">
                          <div className="w-12 h-12 rounded-[var(--r-lg)] bg-gray-100 flex items-center justify-center">
                            <Calendar size={22} className="text-gray-300" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-600">{t('programs.pmSchedules.noSchedules')}</p>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {t('programs.pmSchedules.noSchedulesHelp')}
                            </p>
                          </div>
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
                            <Button
                              variant="primary"
                              onClick={() => setShowCreateModal(true)}
                            >
                              <Plus size={14} />
                              {t('programs.pmSchedules.createSchedule')}
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ) : (
                  schedules.map((schedule) => {
                    const status = getScheduleStatus(schedule.next_due_at, t)
                    const dueDate = new Date(schedule.next_due_at)
                    const isOverdue = dueDate < now
                    return (
                      <tr
                        key={schedule.id}
                        className="border-b border-[var(--caution-line)] hover:bg-[var(--caution-soft)]/40 transition-colors"
                      >
                        {/* Asset */}
                        <td className="px-4 py-3" data-i18n-skip="true">
                          <p className="font-medium text-gray-900 leading-tight">
                            {schedule.assets?.name ?? (
                              <span className="text-gray-400 font-normal italic">{t('programs.pmSchedules.unknownAsset')}</span>
                            )}
                          </p>
                        </td>

                        {/* Schedule name */}
                        <td className="px-4 py-3 text-gray-700" data-i18n-skip="true">{schedule.name}</td>

                        {/* Interval */}
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-50 text-slate-600 border border-slate-200">
                            {formatIntervalLabel(schedule.interval_type, schedule.interval_days, t)}
                          </span>
                        </td>

                        {/* Next due */}
                        <td
                          className={`px-4 py-3 text-sm font-medium ${
                            isOverdue ? 'text-[var(--alert)]' : 'text-gray-700'
                          }`}
                        >
                          {format(dueDate, 'MMM d, yyyy')}
                        </td>

                        {/* Estimated time */}
                        <td className="px-4 py-3 text-gray-600">
                          {schedule.estimated_minutes} {t('programs.pmSchedules.minutesSuffix')}
                        </td>

                        {/* Last done */}
                        <td className="px-4 py-3 text-gray-500 text-xs">
                          {schedule.last_completed_at ? (
                            format(new Date(schedule.last_completed_at), 'MMM d, yyyy')
                          ) : (
                            <span className="italic text-gray-300">{t('programs.pmSchedules.never')}</span>
                          )}
                        </td>

                        {/* Status badge */}
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${status.badgeCls}`}
                          >
                            {status.kind === 'overdue' && <AlertTriangle size={11} />}
                            {status.kind === 'due_soon' && <Clock size={11} />}
                            {status.kind === 'upcoming' && <CheckCircle size={11} />}
                            {status.label}
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {/* Complete — visible to engineer, chief, GM for active non-cancelled schedules */}
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

                            {/* Deactivate + Create WO — chief/GM only */}
                            {canEdit && schedule.is_active && (
                              confirmDeactivateId === schedule.id ? (
                                <span className="flex items-center gap-1">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleDeactivate(schedule.id)}
                                    className="text-[var(--alert)] hover:underline"
                                  >
                                    {t('programs.pmSchedules.confirm')}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setConfirmDeactivateId(null)}
                                    className="text-gray-500 hover:underline"
                                  >
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

                            {/* Create WO — chief/GM only, overdue schedules */}
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

        {/* Footer count */}
        {!isLoading && !isError && schedules.length > 0 && (
          <div className="px-4 py-2.5 border-t border-[var(--caution-line)] bg-[var(--caution-soft)]/40 flex items-center justify-between">
            <p className="text-xs text-gray-400">
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

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      <CreatePMScheduleModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={handleCreateSuccess}
      />

      <PMCompletionModal
        isOpen={completingSchedule !== null}
        onClose={() => setCompletingSchedule(null)}
        schedule={completingSchedule}
        onSuccess={() => {
          if (completingSchedule) {
            const nextDue = calcNextDueAt(
              completingSchedule.interval_type,
              completingSchedule.interval_days,
            )
            handleCompleteSuccess(completingSchedule.name, nextDue)
          }
          setCompletingSchedule(null)
        }}
      />
    </div>
  )
}
