'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Plus, AlertTriangle, Loader2 } from 'lucide-react'
import { engineeringApi, type PMSchedule } from '@/lib/api/engineering'
import { programsApi, type ProgramTemplate } from '@/lib/api/programs'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { EngineeringDrawer } from '@/components/engineering/EngineeringDrawer'

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
  initialAssetId?: string
}

export function CreatePMScheduleModal({ isOpen, onClose, onSuccess, initialAssetId }: CreatePMScheduleModalProps) {
  const { t } = useTranslation()
  const [fields, setFields] = useState({
    asset_id: '',
    name: '',
    description: '',
    interval_type: 'monthly' as PMSchedule['interval_type'],
    interval_days: '',
    estimated_minutes: '',
    next_due_at: '',
    recurrence_basis: 'scheduled_date' as 'scheduled_date' | 'completion_date',
  })
  const [mode, setMode] = useState<'template' | 'custom'>('template')
  const [templateId, setTemplateId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const assetsQuery = useQuery({ queryKey: ['assets'], queryFn: () => engineeringApi.listAssets(), enabled: isOpen, staleTime: 60_000 })
  const templatesQuery = useQuery({ queryKey: ['program-overview-for-pm-create'], queryFn: programsApi.overview, enabled: isOpen, staleTime: 60_000 })
  const templates = useMemo(() => (templatesQuery.data?.data.templates ?? []).filter((template) => template.program_area === 'engineering'), [templatesQuery.data])

  useEffect(() => {
    if (isOpen) {
      setFields({
        asset_id: initialAssetId ?? '',
        name: '',
        description: '',
        interval_type: 'monthly',
        interval_days: '',
        estimated_minutes: '',
        next_due_at: '',
        recurrence_basis: 'scheduled_date',
      })
      setMode('template')
      setTemplateId('')
      setError(null)
    }
  }, [initialAssetId, isOpen])

  if (!isOpen) return null

  function set<K extends keyof typeof fields>(key: K, value: (typeof fields)[K]) {
    setFields((prev) => ({ ...prev, [key]: value }))
  }

  function selectTemplate(nextTemplateId: string) {
    setTemplateId(nextTemplateId)
    const template = templates.find((candidate) => candidate.id === nextTemplateId) as ProgramTemplate | undefined
    if (template && !fields.name.trim()) set('name', template.name)
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
        recurrence_basis: fields.recurrence_basis,
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
    <EngineeringDrawer open={isOpen} onClose={onClose} closeDisabled={saving} closeLabel={t('programs.pmSchedules.addModal.close')} title={t('programs.pmSchedules.addModal.title')} width="wide" footer={<div className="flex items-center justify-end gap-3"><Button variant="outline" onClick={onClose} disabled={saving}>{t('programs.pmSchedules.cancel')}</Button><Button variant="primary" onClick={handleCreate} disabled={saving || !fields.name.trim() || !fields.asset_id || !fields.next_due_at}>{saving ? <><Loader2 size={13} className="animate-spin" />{t('programs.pmSchedules.addModal.creating')}</> : <><Plus size={14} />{t('programs.pmSchedules.addSchedule')}</>}</Button></div>}>
      <div className="space-y-5">
          <div className="grid grid-cols-2 gap-2" role="group" aria-label={t('programs.pmSchedules.addModal.startFrom')}>
            {(['template', 'custom'] as const).map((value) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)} className={`rounded-[var(--r-sm)] border px-3 py-2 text-sm font-medium transition-colors ${mode === value ? 'border-ink bg-ink text-paper' : 'border-line bg-surface text-ink2 hover:bg-surface-2'}`}>{t(`programs.pmSchedules.addModal.mode${value === 'template' ? 'Template' : 'Custom'}`)}</button>)}
          </div>
          {mode === 'template' && <div><label className="mb-1.5 block text-sm font-medium text-ink2">{t('programs.pmSchedules.addModal.templateLabel')}</label><select value={templateId} onChange={(event) => selectTemplate(event.target.value)} className="w-full rounded-[var(--r-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"><option value="">{t('programs.pmSchedules.addModal.chooseTemplate')}</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select><p className="mt-1 text-xs text-ink3">{t('programs.pmSchedules.addModal.templateHelp')}</p></div>}
            {/* Asset ID */}
            <div>
              <label htmlFor="pm-create-asset-id" className="block text-sm font-medium text-ink2 mb-1.5">{t('programs.pmSchedules.addModal.assetLabel')} <span className="text-[var(--alert)]">*</span></label>
              <select
                id="pm-create-asset-id"
                value={fields.asset_id}
                onChange={(e) => set('asset_id', e.target.value)}
                className="w-full rounded-[var(--r-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
              ><option value="">{t('programs.pmSchedules.addModal.chooseAsset')}</option>{(assetsQuery.data?.data ?? []).map((asset) => <option key={asset.id} value={asset.id}>{asset.name}{asset.asset_tag ? ` · ${asset.asset_tag}` : ''}{asset.rooms?.room_number ? ` · ${t('programs.pmSchedules.addModal.room', { number: asset.rooms.room_number })}` : ''}</option>)}</select>
              <p className="text-xs text-ink3 mt-1">{t('programs.pmSchedules.addModal.assetHelp')}</p>
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

            <div>
              <p className="mb-2 text-sm font-medium text-ink2">{t('programs.pmSchedules.addModal.basedOn')}</p>
              <div className="grid grid-cols-2 gap-2" role="group" aria-label={t('programs.pmSchedules.addModal.basedOn')}>
                {(['scheduled_date', 'completion_date'] as const).map((basis) => <button key={basis} type="button" aria-pressed={fields.recurrence_basis === basis} onClick={() => set('recurrence_basis', basis)} className={`rounded-[var(--r-sm)] border px-3 py-2 text-left text-xs font-medium ${fields.recurrence_basis === basis ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-ink2'}`}><span className="block">{t(`programs.pmSchedules.addModal.${basis}`)}</span><span className="mt-0.5 block font-normal text-ink3">{t(`programs.pmSchedules.addModal.${basis}Help`)}</span></button>)}
              </div>
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
    </EngineeringDrawer>
  )
}
