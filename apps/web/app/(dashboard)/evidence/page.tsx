'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, FileWarning, RefreshCw, Save, ShieldCheck, UserRoundX } from 'lucide-react'
import {
  evidenceApi,
  PROPERTY_APPLICABILITY_OPTIONS,
  type EvidenceException,
  type PropertyApplicability,
} from '@/lib/api/evidence'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/stores/authStore'
import { useTranslation } from 'react-i18next'

const EMPTY_APPLICABILITY: PropertyApplicability = {
  facilities: [],
  services: [],
  brand_requirements: [],
}

const STATE_STYLE: Record<EvidenceException['state'], string> = {
  missing: 'bg-alert-soft text-alert border-alert-line',
  overdue: 'bg-alert-soft text-alert border-alert-line',
  expired: 'bg-caution-soft text-caution border-caution-line',
  failed: 'bg-alert-soft text-alert border-alert-line',
  deferred: 'bg-surface-2 text-ink2 border-line',
  unacknowledged: 'bg-ai-soft text-ai border-ai-line',
}

export default function EvidenceDashboardPage() {
  const { t } = useTranslation()
  const role = useAuthStore((state) => state.role)
  const [exceptions, setExceptions] = useState<EvidenceException[]>([])
  const [applicability, setApplicability] = useState<PropertyApplicability>(EMPTY_APPLICABILITY)
  const [draft, setDraft] = useState<PropertyApplicability>(EMPTY_APPLICABILITY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [queue, property] = await Promise.all([
        evidenceApi.listExceptions(),
        evidenceApi.getApplicability(),
      ])
      const current = { ...EMPTY_APPLICABILITY, ...property.data }
      setExceptions(queue.data)
      setApplicability(current)
      setDraft(current)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('evidence.loadError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { void load() }, [load])

  const summary = useMemo(() => ({
    critical: exceptions.filter((item) => ['missing', 'overdue', 'failed'].includes(item.state)).length,
    expired: exceptions.filter((item) => item.state === 'expired').length,
    acknowledgements: exceptions.filter((item) => item.kind === 'acknowledgement').length,
  }), [exceptions])
  const configuredValues = [
    ...applicability.facilities,
    ...applicability.services,
    ...applicability.brand_requirements,
  ]
  const canManageApplicability = role === 'gm'

  const toggleApplicability = (category: keyof PropertyApplicability, value: string) => {
    setDraft((current) => ({
      ...current,
      [category]: current[category].includes(value)
        ? current[category].filter((item) => item !== value)
        : [...current[category], value],
    }))
  }

  const saveApplicability = async () => {
    setSaving(true)
    setError(null)
    try {
      const response = await evidenceApi.updateApplicability(draft)
      const saved = { ...EMPTY_APPLICABILITY, ...response.data }
      setApplicability(saved)
      setDraft(saved)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('evidence.saveError'))
    } finally {
      setSaving(false)
    }
  }

  return <div className="mx-auto max-w-6xl space-y-6 p-5">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">{t('evidence.eyebrow')}</p>
        <h1 className="font-display text-[28px] text-ink">{t('evidence.title')}</h1>
        <p className="mt-1 text-sm text-ink2">{t('evidence.subtitle')}</p>
      </div>
      <Button variant="secondary" onClick={() => void load()} disabled={loading}>
        <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> {t('evidence.refresh')}
      </Button>
    </header>

    <section className="grid gap-3 sm:grid-cols-3" aria-label={t('evidence.summary')}>
      <SummaryCard icon={<AlertTriangle />} label={t('evidence.critical')} value={summary.critical} tone="alert" />
      <SummaryCard icon={<FileWarning />} label={t('evidence.expired')} value={summary.expired} tone="caution" />
      <SummaryCard icon={<UserRoundX />} label={t('evidence.unacknowledged')} value={summary.acknowledgements} tone="ai" />
    </section>

    <section className="rounded-[var(--r-lg)] border border-line bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck size={17} className="text-accent" />
        <h2 className="font-medium text-ink">{t('evidence.applicability')}</h2>
      </div>
      {canManageApplicability ? <div className="space-y-4">
        {(Object.keys(PROPERTY_APPLICABILITY_OPTIONS) as Array<keyof PropertyApplicability>).map((category) => <fieldset key={category} disabled={saving}>
          <legend className="mb-2 text-sm font-medium text-ink2">{t(`evidence.applicabilityCategories.${category}`)}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {PROPERTY_APPLICABILITY_OPTIONS[category].map((value) => <label key={value} className="flex cursor-pointer items-center gap-2 text-sm text-ink2">
              <input
                checked={draft[category].includes(value)}
                className="h-4 w-4 accent-[var(--accent)]"
                data-testid={`applicability-${category}-${value}`}
                onChange={() => toggleApplicability(category, value)}
                type="checkbox"
              />
              {t(`evidence.applicabilityOptions.${value}`)}
            </label>)}
          </div>
        </fieldset>)}
        <Button data-testid="save-applicability" disabled={saving} onClick={() => void saveApplicability()}>
          <Save size={15} /> {saving ? t('evidence.saving') : t('evidence.saveApplicability')}
        </Button>
      </div> : configuredValues.length ? <div className="flex flex-wrap gap-2">
        {configuredValues.map((item) => <span key={item} className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink2">{t(`evidence.applicabilityOptions.${item}`)}</span>)}
      </div> : <p className="text-sm text-ink3">{t('evidence.noApplicability')}</p>}
    </section>

    <section className="overflow-hidden rounded-[var(--r-lg)] border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="font-medium text-ink">{t('evidence.exceptionQueue')}</h2>
        <span className="text-xs text-ink3">{exceptions.length} {t('evidence.open')}</span>
      </div>
      {loading ? <p className="p-6 text-sm text-ink3">{t('common.loading')}</p>
        : error ? <p className="p-6 text-sm text-alert">{error}</p>
          : exceptions.length === 0 ? <p className="p-6 text-sm text-ink3">{t('evidence.noExceptions')}</p>
            : <ul className="divide-y divide-line">{exceptions.map((item) => <li key={`${item.kind}-${item.reference_id}`} className="flex items-center justify-between gap-3 px-4 py-3">
              <div><p className="text-sm font-medium text-ink">{item.label}</p><p className="text-xs capitalize text-ink3">{item.kind}</p></div>
              <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATE_STYLE[item.state]}`}>{t(`evidence.states.${item.state}`)}</span>
            </li>)}</ul>}
    </section>
  </div>
}

function SummaryCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: 'alert' | 'caution' | 'ai' }) {
  const style = tone === 'alert' ? 'text-alert bg-alert-soft border-alert-line' : tone === 'caution' ? 'text-caution bg-caution-soft border-caution-line' : 'text-ai bg-ai-soft border-ai-line'
  return <div className="rounded-[var(--r-lg)] border border-line bg-surface p-4"><div className={`mb-3 inline-flex rounded-[var(--r-md)] border p-2 ${style}`}>{icon}</div><p className="text-2xl font-semibold text-ink">{value}</p><p className="text-sm text-ink2">{label}</p></div>
}
