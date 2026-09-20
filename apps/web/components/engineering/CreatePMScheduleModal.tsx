'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Calendar, Plus, AlertTriangle, X, Loader2 } from 'lucide-react'
import { engineeringApi, type PMSchedule } from '@/lib/api/engineering'
import { Button, IconButton } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'

const INTERVAL_LABEL_KEYS: Record<string, string> = {
  daily: 'intervalDaily',
  weekly: 'intervalWeekly',
  monthly: 'intervalMonthly',
  quarterly: 'intervalQuarterly',
  annual: 'intervalAnnual',
}

export function formatIntervalLabel(
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

const INTERVAL_OPTIONS: PMSchedule['interval_type'][] = [
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'annual',
  'custom',
]

interface CreatePMScheduleModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

export function CreatePMScheduleModal({ isOpen, onClose, onSuccess }: CreatePMScheduleModalProps) {
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
              <h2 className="text-base font-bold text-ink">{t('programs.pmSchedules.addModal.title')}</h2>
            </div>
            {!saving && (
              <IconButton variant="ghost" onClick={onClose} aria-label={t('programs.pmSchedules.addModal.close')}>
                <X size={18} />
              </IconButton>
            )}
          </div>

          <div className="space-y-4">
            {/* Asset ID */}
            <div>
              <label htmlFor="pm-create-asset-id" className="block text-sm font-medium text-ink2 mb-1.5">
                {t('programs.pmSchedules.addModal.assetIdLabel')}{' '}
                <span className="text-ink3 font-normal">{t('programs.pmSchedules.addModal.assetIdUuid')}</span>
              </label>
              <Input
                id="pm-create-asset-id"
                type="text"
                value={fields.asset_id}
                onChange={(e) => set('asset_id', e.target.value)}
                placeholder={t('programs.pmSchedules.addModal.assetIdPlaceholder')}
                className="font-mono"
              />
              <p className="text-xs text-ink3 mt-1">
                {t('programs.pmSchedules.addModal.assetIdHelp')}
              </p>
            </div>

            {/* Schedule name */}
            <div>
              <label htmlFor="pm-create-name" className="block text-sm font-medium text-ink2 mb-1.5">
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
              <label htmlFor="pm-create-description" className="block text-sm font-medium text-ink2 mb-1.5">
                {t('programs.pmSchedules.addModal.descriptionLabel')}{' '}
                <span className="text-ink3 font-normal">{t('programs.pmSchedules.addModal.optionalTag')}</span>
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
                <label htmlFor="pm-create-interval-type" className="block text-sm font-medium text-ink2 mb-1.5">
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
                  <label htmlFor="pm-create-interval-days" className="block text-sm font-medium text-ink2 mb-1.5">
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
                <label htmlFor="pm-create-estimated-minutes" className="block text-sm font-medium text-ink2 mb-1.5">
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
                <label htmlFor="pm-create-next-due" className="block text-sm font-medium text-ink2 mb-1.5">
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
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              {t('programs.pmSchedules.cancel')}
            </Button>
            <Button variant="primary" onClick={handleCreate} disabled={saving || !fields.name.trim() || !fields.next_due_at}>
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
