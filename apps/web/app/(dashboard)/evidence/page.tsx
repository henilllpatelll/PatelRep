'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, FilePlus2, FileWarning, History, RefreshCw, Save, ShieldCheck, UserRoundX } from 'lucide-react'
import {
  evidenceApi,
  PROPERTY_APPLICABILITY_OPTIONS,
  type EvidenceException,
  type ControlledDocument,
  type ControlledDocumentInput,
  type OperationalAuditEvent,
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

const EMPTY_DOCUMENT: ControlledDocumentInput = {
  title: '',
  document_type: 'policy',
  retention_class: 'operational_3_years',
  applicability: [],
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
  const [documents, setDocuments] = useState<ControlledDocument[]>([])
  const [selectedDocument, setSelectedDocument] = useState<ControlledDocument | null>(null)
  const [documentHistory, setDocumentHistory] = useState<OperationalAuditEvent[]>([])
  const [documentDraft, setDocumentDraft] = useState<ControlledDocumentInput>(EMPTY_DOCUMENT)
  const [documentSaving, setDocumentSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [queue, property, listedDocuments] = await Promise.all([
        evidenceApi.listExceptions(),
        evidenceApi.getApplicability(),
        evidenceApi.listDocuments(),
      ])
      const current = { ...EMPTY_APPLICABILITY, ...property.data }
      setExceptions(queue.data)
      setApplicability(current)
      setDraft(current)
      setDocuments(listedDocuments.data)
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

  const toggleDocumentApplicability = (value: string) => {
    setDocumentDraft((current) => {
      const applicability = current.applicability ?? []
      return {
        ...current,
        applicability: applicability.includes(value)
          ? applicability.filter((item) => item !== value)
          : [...applicability, value],
      }
    })
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

  const selectDocument = async (documentId: string) => {
    setError(null)
    try {
      const [document, history] = await Promise.all([
        evidenceApi.getDocument(documentId),
        evidenceApi.getDocumentHistory(documentId),
      ])
      setSelectedDocument(document.data)
      setDocumentHistory(history.data)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('evidence.loadError'))
    }
  }

  const createDocument = async () => {
    setDocumentSaving(true)
    setError(null)
    try {
      const created = await evidenceApi.createDocument({
        ...documentDraft,
        owner_id: documentDraft.owner_id || undefined,
        effective_date: documentDraft.effective_date || undefined,
        review_date: documentDraft.review_date || undefined,
        expiration_date: documentDraft.expiration_date || undefined,
      })
      setDocumentDraft(EMPTY_DOCUMENT)
      await load()
      await selectDocument(created.data.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('evidence.documentSaveError'))
    } finally {
      setDocumentSaving(false)
    }
  }

  const applyLifecycleAction = async (action: 'approve' | 'supersede') => {
    if (!selectedDocument) return
    setDocumentSaving(true)
    setError(null)
    try {
      const response = action === 'approve'
        ? await evidenceApi.approveDocument(selectedDocument.id)
        : await evidenceApi.supersedeDocument(selectedDocument.id)
      await load()
      await selectDocument(response.data.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('evidence.documentSaveError'))
    } finally {
      setDocumentSaving(false)
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

    <section className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
      <div className="rounded-[var(--r-lg)] border border-line bg-surface p-4">
        <div className="mb-3 flex items-center gap-2"><FilePlus2 size={17} className="text-accent" /><h2 className="font-medium text-ink">{t('evidence.controlledDocuments')}</h2></div>
        {canManageApplicability ? <div className="space-y-3">
          <label className="block text-sm text-ink2">{t('evidence.documentTitle')}<input data-testid="controlled-document-title" value={documentDraft.title} onChange={(event) => setDocumentDraft((current) => ({ ...current, title: event.target.value }))} className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 text-ink" /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-ink2">{t('evidence.documentType')}<select value={documentDraft.document_type} onChange={(event) => setDocumentDraft((current) => ({ ...current, document_type: event.target.value as ControlledDocument['document_type'] }))} className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 text-ink">{(['sop', 'policy', 'training', 'safety', 'certificate'] as const).map((type) => <option key={type} value={type}>{t(`evidence.documentTypes.${type}`)}</option>)}</select></label>
            <label className="text-sm text-ink2">{t('evidence.retentionClass')}<select value={documentDraft.retention_class} onChange={(event) => setDocumentDraft((current) => ({ ...current, retention_class: event.target.value as ControlledDocument['retention_class'] }))} className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 text-ink">{(['operational_3_years', 'safety_7_years', 'brand_7_years'] as const).map((retention) => <option key={retention} value={retention}>{t(`evidence.retentionClasses.${retention}`)}</option>)}</select></label>
          </div>
          <label className="block text-sm text-ink2">{t('evidence.documentOwner')}<input value={documentDraft.owner_id ?? ''} onChange={(event) => setDocumentDraft((current) => ({ ...current, owner_id: event.target.value }))} placeholder={t('evidence.ownerHint')} className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 text-ink" /></label>
          <fieldset><legend className="text-sm text-ink2">{t('evidence.documentApplicability')}</legend>{configuredValues.length ? <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2">{configuredValues.map((value) => <label key={value} className="flex items-center gap-2 text-sm text-ink2"><input checked={(documentDraft.applicability ?? []).includes(value)} onChange={() => toggleDocumentApplicability(value)} type="checkbox" />{t(`evidence.applicabilityOptions.${value}`)}</label>)}</div> : <p className="mt-1 text-xs text-ink3">{t('evidence.allProperties')}</p>}</fieldset>
          <div className="grid gap-3 sm:grid-cols-3">{(['effective_date', 'review_date', 'expiration_date'] as const).map((field) => <label key={field} className="text-sm text-ink2">{t(`evidence.${field}`)}<input type="date" value={documentDraft[field] ?? ''} onChange={(event) => setDocumentDraft((current) => ({ ...current, [field]: event.target.value }))} className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 text-ink" /></label>)}</div>
          <Button data-testid="create-controlled-document" disabled={documentSaving || !documentDraft.title} onClick={() => void createDocument()}><Save size={15} /> {documentSaving ? t('evidence.saving') : t('evidence.createDocument')}</Button>
        </div> : null}
        <ul className="mt-4 divide-y divide-line">{documents.length ? documents.map((document) => <li key={document.id}><button type="button" onClick={() => void selectDocument(document.id)} className="flex w-full items-center justify-between gap-3 px-1 py-3 text-left"><span><span className="block text-sm font-medium text-ink">{document.title}</span><span className="text-xs text-ink3">{t('evidence.version', { count: document.version_number })} · {t(`evidence.documentStates.${document.approval_state}`)}</span></span><span className="text-xs text-ink3">{t(`evidence.retentionClasses.${document.retention_class}`)}</span></button></li>) : <li className="py-3 text-sm text-ink3">{t('evidence.noDocuments')}</li>}</ul>
      </div>

      <div className="rounded-[var(--r-lg)] border border-line bg-surface p-4">
        <div className="mb-3 flex items-center gap-2"><History size={17} className="text-accent" /><h2 className="font-medium text-ink">{t('evidence.documentDetail')}</h2></div>
        {selectedDocument ? <div className="space-y-4"><div><p className="font-medium text-ink">{selectedDocument.title}</p><p className="text-sm text-ink2">{t('evidence.version', { count: selectedDocument.version_number })} · {t(`evidence.documentStates.${selectedDocument.approval_state}`)}</p></div><dl className="grid grid-cols-2 gap-3 text-sm"><Detail label={t('evidence.documentOwner')} value={selectedDocument.owner_id ?? t('evidence.notAssigned')} /><Detail label={t('evidence.documentApprover')} value={selectedDocument.approver_id ?? t('evidence.notAssigned')} /><Detail label={t('evidence.review_date')} value={selectedDocument.review_date ?? t('evidence.notScheduled')} /><Detail label={t('evidence.expiration_date')} value={selectedDocument.expiration_date ?? t('evidence.notScheduled')} /><Detail label={t('evidence.retentionClass')} value={t(`evidence.retentionClasses.${selectedDocument.retention_class}`)} /><Detail label={t('evidence.documentApplicability')} value={selectedDocument.applicability.length ? selectedDocument.applicability.map((value) => t(`evidence.applicabilityOptions.${value}`)).join(', ') : t('evidence.allProperties')} /></dl>{canManageApplicability && selectedDocument.approval_state === 'draft' ? <Button disabled={documentSaving} onClick={() => void applyLifecycleAction('approve')}><CheckCircle2 size={15} /> {t('evidence.approveDocument')}</Button> : null}{canManageApplicability && selectedDocument.approval_state === 'approved' ? <Button variant="secondary" disabled={documentSaving} onClick={() => void applyLifecycleAction('supersede')}>{t('evidence.supersedeDocument')}</Button> : null}<div><h3 className="mb-2 text-sm font-medium text-ink">{t('evidence.documentHistory')}</h3>{documentHistory.length ? <ul className="space-y-2">{documentHistory.map((event) => <li key={event.id} className="rounded border border-line bg-surface-2 p-2 text-xs text-ink2"><p className="font-medium text-ink">{event.action}</p><p>{event.reason_code ?? t('evidence.noReason')}</p>{event.reason_note ? <p>{event.reason_note}</p> : null}</li>)}</ul> : <p className="text-sm text-ink3">{t('evidence.noHistory')}</p>}</div></div> : <p className="text-sm text-ink3">{t('evidence.selectDocument')}</p>}
      </div>
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

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-ink3">{label}</dt><dd className="mt-0.5 text-ink">{value}</dd></div>
}

function SummaryCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: 'alert' | 'caution' | 'ai' }) {
  const style = tone === 'alert' ? 'text-alert bg-alert-soft border-alert-line' : tone === 'caution' ? 'text-caution bg-caution-soft border-caution-line' : 'text-ai bg-ai-soft border-ai-line'
  return <div className="rounded-[var(--r-lg)] border border-line bg-surface p-4"><div className={`mb-3 inline-flex rounded-[var(--r-md)] border p-2 ${style}`}>{icon}</div><p className="text-2xl font-semibold text-ink">{value}</p><p className="text-sm text-ink2">{label}</p></div>
}
