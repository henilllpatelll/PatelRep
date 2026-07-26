'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, Eye, FilePlus2, FileText, FileWarning, History, RefreshCw, Save, ShieldCheck, Upload, UserRoundX } from 'lucide-react'
import {
  evidenceApi,
  PROPERTY_APPLICABILITY_OPTIONS,
  type EvidenceException,
  type EvidenceExceptionAction,
  type ControlledDocument,
  type DocumentAcknowledgement,
  type DocumentAcknowledgementInput,
  type ControlledDocumentInput,
  type EvidenceRecord,
  type EvidenceRecordInput,
  type EvidenceType,
  type OperationalAuditEvent,
  type PropertyApplicability,
  type RelatedEvidenceEntityType,
} from '@/lib/api/evidence'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/stores/authStore'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/shared/PageHeader'

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

const EMPTY_EVIDENCE: EvidenceRecordInput = {
  label: '',
  evidence_type: 'file',
}

const EMPTY_ASSIGNMENT: DocumentAcknowledgementInput = {
  assigned_to: '',
  due_date: '',
  competency_required: false,
}

const EVIDENCE_TYPES: EvidenceType[] = ['file', 'photo', 'measurement', 'checklist_result', 'signature', 'attestation', 'external_certificate']
const RELATED_ENTITY_TYPES: RelatedEvidenceEntityType[] = ['staff', 'task', 'asset', 'room', 'inspection', 'incident', 'sop']
const EVIDENCE_CAPTURE_ROLES = ['housekeeper', 'housekeeping_supervisor', 'engineer', 'chief_engineer', 'front_desk', 'gm']
const COMPETENCY_MANAGER_ROLES = ['gm', 'housekeeping_supervisor', 'chief_engineer']
const MAX_EVIDENCE_FILE_BYTES = 10 * 1024 * 1024
const ACCEPTED_EVIDENCE_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

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
  const [documentAssignments, setDocumentAssignments] = useState<DocumentAcknowledgement[]>([])
  const [documentDraft, setDocumentDraft] = useState<ControlledDocumentInput>(EMPTY_DOCUMENT)
  const [assignmentDraft, setAssignmentDraft] = useState<DocumentAcknowledgementInput>(EMPTY_ASSIGNMENT)
  const [myAcknowledgements, setMyAcknowledgements] = useState<DocumentAcknowledgement[]>([])
  const [records, setRecords] = useState<EvidenceRecord[]>([])
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceRecord | null>(null)
  const [evidenceDraft, setEvidenceDraft] = useState<EvidenceRecordInput>(EMPTY_EVIDENCE)
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null)
  const [evidenceSaving, setEvidenceSaving] = useState(false)
  const [documentSaving, setDocumentSaving] = useState(false)
  const [selectedException, setSelectedException] = useState<EvidenceException | null>(null)
  const [exceptionFilter, setExceptionFilter] = useState<'all' | EvidenceException['state']>('all')
  const [exceptionKindFilter, setExceptionKindFilter] = useState<'all' | EvidenceException['kind']>('all')
  const [exceptionAction, setExceptionAction] = useState<EvidenceExceptionAction>('assign')
  const [exceptionOwner, setExceptionOwner] = useState('')
  const [exceptionReasonCode, setExceptionReasonCode] = useState<'safety_risk' | 'vendor_delay' | 'staffing' | 'document_revision' | 'evidence_pending' | 'corrected' | 'other'>('other')
  const [exceptionReasonNote, setExceptionReasonNote] = useState('')
  const [exceptionSaving, setExceptionSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canManageCompetency = COMPETENCY_MANAGER_ROLES.includes(role ?? '')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [queue, property, listedDocuments, listedRecords, acknowledgements] = await Promise.all([
        evidenceApi.listExceptions(),
        evidenceApi.getApplicability(),
        evidenceApi.listDocuments(),
        evidenceApi.listRecords(),
        evidenceApi.listMyAcknowledgements(),
      ])
      const current = { ...EMPTY_APPLICABILITY, ...property.data }
      setExceptions(queue.data)
      setApplicability(current)
      setDraft(current)
      setDocuments(listedDocuments.data)
      setRecords(listedRecords.data)
      setMyAcknowledgements(acknowledgements.data)
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
  const visibleExceptions = useMemo(() => exceptions.filter((item) => (
    (exceptionFilter === 'all' || item.state === exceptionFilter)
    && (exceptionKindFilter === 'all' || item.kind === exceptionKindFilter)
  )), [exceptions, exceptionFilter, exceptionKindFilter])
  const configuredValues = [
    ...applicability.facilities,
    ...applicability.services,
    ...applicability.brand_requirements,
  ]
  const canManageApplicability = role === 'gm'
  const canCaptureEvidence = EVIDENCE_CAPTURE_ROLES.includes(role ?? '')

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
      const [document, history, assignments] = await Promise.all([
        evidenceApi.getDocument(documentId),
        evidenceApi.getDocumentHistory(documentId),
        canManageCompetency ? evidenceApi.listDocumentAssignments(documentId) : Promise.resolve({ data: [] }),
      ])
      setSelectedDocument(document.data)
      setDocumentHistory(history.data)
      setDocumentAssignments(assignments.data)
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

  const acknowledgeAssignment = async (assignmentId: string) => {
    setError(null)
    try {
      await evidenceApi.acknowledgeDocument(assignmentId)
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('evidence.acknowledgementSaveError'))
    }
  }

  const assignDocument = async () => {
    if (!selectedDocument || !assignmentDraft.assigned_to || !assignmentDraft.due_date) return
    setDocumentSaving(true)
    setError(null)
    try {
      await evidenceApi.assignDocument(selectedDocument.id, assignmentDraft)
      setAssignmentDraft(EMPTY_ASSIGNMENT)
      const response = await evidenceApi.listDocumentAssignments(selectedDocument.id)
      setDocumentAssignments(response.data)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('evidence.assignmentSaveError'))
    } finally {
      setDocumentSaving(false)
    }
  }

  const evaluateCompetency = async (assignmentId: string, assessmentMethod: 'observed' | 'quiz', outcome: 'passed' | 'failed') => {
    setError(null)
    try {
      const response = await evidenceApi.evaluateCompetency(assignmentId, { assessment_method: assessmentMethod, outcome })
      setDocumentAssignments((current) => current.map((item) => item.id === assignmentId ? response.data : item))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('evidence.competencySaveError'))
    }
  }

  const captureEvidence = async () => {
    const requiresAttachment = ['file', 'photo', 'external_certificate'].includes(evidenceDraft.evidence_type)
    if (requiresAttachment && !evidenceFile) {
      setError(t('evidence.fileRequired'))
      return
    }
    if (evidenceFile && (!ACCEPTED_EVIDENCE_FILE_TYPES.includes(evidenceFile.type) || evidenceFile.size > MAX_EVIDENCE_FILE_BYTES)) {
      setError(t('evidence.fileValidationError'))
      return
    }
    setEvidenceSaving(true)
    setError(null)
    try {
      const created = await evidenceApi.createRecord({
        ...evidenceDraft,
        document_id: evidenceDraft.document_id || undefined,
        related_entity_type: evidenceDraft.related_entity_type || undefined,
        related_entity_id: evidenceDraft.related_entity_id || undefined,
        measurement_value: evidenceDraft.measurement_value || undefined,
        result: evidenceDraft.result || undefined,
      })
      const captured = evidenceFile
        ? await evidenceApi.uploadRecordFile(created.data.id, evidenceFile)
        : created
      setSelectedEvidence(captured.data)
      setEvidenceDraft(EMPTY_EVIDENCE)
      setEvidenceFile(null)
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('evidence.evidenceSaveError'))
    } finally {
      setEvidenceSaving(false)
    }
  }

  const viewEvidenceAttachment = async (record: EvidenceRecord) => {
    setError(null)
    try {
      const response = await evidenceApi.getRecordFileUrl(record.id)
      window.open(response.data.url, '_blank', 'noopener,noreferrer')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('evidence.evidenceLoadError'))
    }
  }

  const openException = (item: EvidenceException) => {
    setSelectedException(item)
    setExceptionOwner(item.owner_id ?? '')
    setExceptionAction(item.lifecycle_state === 'resolved' ? 'reopen' : 'assign')
    setExceptionReasonCode((item.reason_code as typeof exceptionReasonCode) ?? 'other')
    setExceptionReasonNote(item.reason_note ?? '')
  }

  const saveExceptionAction = async () => {
    if (!selectedException || !exceptionReasonNote || (exceptionAction === 'assign' && !exceptionOwner)) return
    setExceptionSaving(true)
    setError(null)
    try {
      await evidenceApi.actOnException(selectedException.kind, selectedException.reference_id, {
        action: exceptionAction,
        owner_id: exceptionOwner || undefined,
        reason_code: exceptionReasonCode,
        reason_note: exceptionReasonNote,
      })
      setSelectedException(null)
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('evidence.exceptionSaveError'))
    } finally {
      setExceptionSaving(false)
    }
  }

  const downloadInspectorPacket = async () => {
    setError(null)
    try {
      const packet = await evidenceApi.downloadInspectorPacket()
      const url = window.URL.createObjectURL(packet)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'inspector-evidence-packet.csv'
      anchor.click()
      window.URL.revokeObjectURL(url)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('evidence.exportError'))
    }
  }

  return <div className="mx-auto max-w-6xl space-y-6 p-5">
    <PageHeader
      eyebrow={t('evidence.eyebrow')}
      title={t('evidence.title')}
      subtitle={t('evidence.subtitle')}
      actions={
        <Button variant="secondary" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> {t('evidence.refresh')}
        </Button>
      }
    />

    <section className="grid gap-3 sm:grid-cols-3" aria-label={t('evidence.summary')}>
      <SummaryCard icon={<AlertTriangle />} label={t('evidence.critical')} value={summary.critical} tone="alert" />
      <SummaryCard icon={<FileWarning />} label={t('evidence.expired')} value={summary.expired} tone="caution" />
      <SummaryCard icon={<UserRoundX />} label={t('evidence.unacknowledged')} value={summary.acknowledgements} tone="ai" />
    </section>

    <section className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
      <div className="rounded-[var(--r-lg)] border border-line bg-surface p-4" data-testid="my-acknowledgements">
        <div className="mb-3 flex items-center gap-2"><CheckCircle2 size={17} className="text-accent" /><h2 className="font-medium text-ink">{t('evidence.myAcknowledgements')}</h2></div>
        {myAcknowledgements.length ? <ul className="divide-y divide-line">{myAcknowledgements.map((assignment) => <li key={assignment.id} className="min-w-0 space-y-2 py-3 sm:flex sm:items-center sm:justify-between sm:gap-3 sm:space-y-0">
          <div className="min-w-0"><p className="break-words text-sm font-medium text-ink">{assignment.controlled_documents?.title ?? t('evidence.controlledDocument')}</p><p className="text-xs text-ink3">{t('evidence.dueDate')}: {assignment.due_date} · {t(`evidence.assignmentTypes.${assignment.assignment_type}`)} · {t(`evidence.competencyStates.${assignment.competency_status}`)}</p></div>
          {assignment.acknowledged_at ? <span className="text-xs font-medium text-accent">{t('evidence.acknowledged')}</span> : <Button data-testid={`acknowledge-assignment-${assignment.id}`} className="w-full shrink-0 sm:w-auto" onClick={() => void acknowledgeAssignment(assignment.id)}>{t('evidence.acknowledge')}</Button>}
        </li>)}</ul> : <p className="text-sm text-ink3">{t('evidence.noAcknowledgements')}</p>}
      </div>

      {canManageCompetency ? <div className="rounded-[var(--r-lg)] border border-line bg-surface p-4" data-testid="document-competency-controls">
        <div className="mb-3 flex items-center gap-2"><UserRoundX size={17} className="text-accent" /><h2 className="font-medium text-ink">{t('evidence.staffCompetency')}</h2></div>
        {selectedDocument?.approval_state === 'approved' ? <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm text-ink2">{t('evidence.staffUserId')}<input data-testid="document-assignee" value={assignmentDraft.assigned_to} onChange={(event) => setAssignmentDraft((current) => ({ ...current, assigned_to: event.target.value }))} className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 text-ink" /></label><label className="text-sm text-ink2">{t('evidence.dueDate')}<input data-testid="document-assignment-due-date" type="date" value={assignmentDraft.due_date} onChange={(event) => setAssignmentDraft((current) => ({ ...current, due_date: event.target.value }))} className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 text-ink" /></label></div>
          <label className="flex items-center gap-2 text-sm text-ink2"><input type="checkbox" checked={assignmentDraft.competency_required} onChange={(event) => setAssignmentDraft((current) => ({ ...current, competency_required: event.target.checked }))} />{t('evidence.competencyRequired')}</label>
          <Button data-testid="assign-controlled-document" disabled={documentSaving || !assignmentDraft.assigned_to || !assignmentDraft.due_date} onClick={() => void assignDocument()}>{t('evidence.assignDocument')}</Button>
          <ul className="divide-y divide-line">{documentAssignments.length ? documentAssignments.map((assignment) => <li key={assignment.id} className="min-w-0 space-y-2 py-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="break-all text-sm font-medium text-ink">{assignment.assigned_to}</span><span className="text-xs text-ink3">{assignment.due_date} · {t(`evidence.assignmentTypes.${assignment.assignment_type}`)}</span></div><p className="text-xs text-ink2">{assignment.acknowledged_at ? t('evidence.acknowledged') : t('evidence.notAcknowledged')} · {t(`evidence.competencyStates.${assignment.competency_status}`)}</p>{assignment.competency_required ? <div className="flex flex-wrap gap-2"><Button className="px-2.5 py-1.5 text-xs" variant="secondary" onClick={() => void evaluateCompetency(assignment.id, 'observed', 'passed')}>{t('evidence.observedPass')}</Button><Button className="px-2.5 py-1.5 text-xs" variant="secondary" onClick={() => void evaluateCompetency(assignment.id, 'quiz', 'passed')}>{t('evidence.quizPass')}</Button><Button className="px-2.5 py-1.5 text-xs" variant="outline" onClick={() => void evaluateCompetency(assignment.id, 'quiz', 'failed')}>{t('evidence.quizFail')}</Button></div> : null}</li>) : <li className="py-3 text-sm text-ink3">{t('evidence.noAssignments')}</li>}</ul>
        </div> : <p className="text-sm text-ink3">{t('evidence.selectApprovedDocument')}</p>}
      </div> : null}
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

    <section className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
      <div className="rounded-[var(--r-lg)] border border-line bg-surface p-4">
        <div className="mb-3 flex items-center gap-2"><Upload size={17} className="text-accent" /><h2 className="font-medium text-ink">{t('evidence.captureEvidence')}</h2></div>
        {canCaptureEvidence ? <div className="space-y-3">
          <label className="block text-sm text-ink2">{t('evidence.evidenceLabel')}<input data-testid="evidence-label" value={evidenceDraft.label} onChange={(event) => setEvidenceDraft((current) => ({ ...current, label: event.target.value }))} className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 text-ink" /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-ink2">{t('evidence.evidenceType')}<select value={evidenceDraft.evidence_type} onChange={(event) => setEvidenceDraft((current) => ({ ...current, evidence_type: event.target.value as EvidenceType }))} className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 text-ink">{EVIDENCE_TYPES.map((type) => <option key={type} value={type}>{t(`evidence.evidenceTypes.${type}`)}</option>)}</select></label>
            <label className="text-sm text-ink2">{t('evidence.linkedDocument')}<select value={evidenceDraft.document_id ?? ''} onChange={(event) => setEvidenceDraft((current) => ({ ...current, document_id: event.target.value || undefined }))} className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 text-ink"><option value="">{t('evidence.noLinkedDocument')}</option>{documents.map((document) => <option key={document.id} value={document.id}>{document.title}</option>)}</select></label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-ink2">{t('evidence.linkedEntityType')}<select value={evidenceDraft.related_entity_type ?? ''} onChange={(event) => setEvidenceDraft((current) => ({ ...current, related_entity_type: (event.target.value || undefined) as RelatedEvidenceEntityType | undefined }))} className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 text-ink"><option value="">{t('evidence.noLinkedEntity')}</option>{RELATED_ENTITY_TYPES.map((type) => <option key={type} value={type}>{t(`evidence.entityTypes.${type}`)}</option>)}</select></label>
            <label className="text-sm text-ink2">{t('evidence.linkedEntityId')}<input value={evidenceDraft.related_entity_id ?? ''} onChange={(event) => setEvidenceDraft((current) => ({ ...current, related_entity_id: event.target.value || undefined }))} disabled={!evidenceDraft.related_entity_type} className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 text-ink disabled:cursor-not-allowed disabled:opacity-60" /></label>
          </div>
          {evidenceDraft.evidence_type === 'measurement' ? <label className="block text-sm text-ink2">{t('evidence.measurementValue')}<input value={evidenceDraft.measurement_value ?? ''} onChange={(event) => setEvidenceDraft((current) => ({ ...current, measurement_value: event.target.value || undefined }))} className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 text-ink" /></label> : null}
          {['checklist_result', 'attestation'].includes(evidenceDraft.evidence_type) ? <label className="block text-sm text-ink2">{t('evidence.result')}<select value={evidenceDraft.result ?? ''} onChange={(event) => setEvidenceDraft((current) => ({ ...current, result: (event.target.value || undefined) as EvidenceRecordInput['result'] }))} className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 text-ink"><option value="">{t('evidence.noResult')}</option><option value="passed">{t('evidence.results.passed')}</option><option value="failed">{t('evidence.results.failed')}</option><option value="deferred">{t('evidence.results.deferred')}</option></select></label> : null}
          <label className="block text-sm text-ink2">{t('evidence.attachFile')}<input data-testid="evidence-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setEvidenceFile(event.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm text-ink2" /><span className="mt-1 block text-xs text-ink3">{t('evidence.fileHelp')}</span></label>
          <Button data-testid="capture-evidence" disabled={evidenceSaving || !evidenceDraft.label} onClick={() => void captureEvidence()}><Upload size={15} /> {evidenceSaving ? t('evidence.uploading') : t('evidence.captureEvidence')}</Button>
        </div> : <p className="text-sm text-ink3">{t('evidence.captureNotAuthorized')}</p>}
      </div>

      <div className="rounded-[var(--r-lg)] border border-line bg-surface p-4">
        <div className="mb-3 flex items-center gap-2"><FileText size={17} className="text-accent" /><h2 className="font-medium text-ink">{t('evidence.evidenceRecords')}</h2></div>
        {selectedEvidence ? <div className="mb-3 rounded border border-line bg-surface-2 p-3"><p className="font-medium text-ink">{selectedEvidence.label}</p><p className="mt-1 text-xs text-ink3">{t(`evidence.evidenceTypes.${selectedEvidence.evidence_type}`)}</p>{selectedEvidence.file_name ? <Button className="mt-3" variant="secondary" onClick={() => void viewEvidenceAttachment(selectedEvidence)}><Eye size={15} /> {t('evidence.viewSecureFile')}</Button> : <p className="mt-2 text-xs text-ink3">{t('evidence.noAttachment')}</p>}</div> : null}
        <ul className="divide-y divide-line">{records.length ? records.map((record) => <li key={record.id} className="flex items-center justify-between gap-3 py-3"><button type="button" onClick={() => setSelectedEvidence(record)} className="min-w-0 text-left"><span className="block truncate text-sm font-medium text-ink">{record.label}</span><span className="text-xs text-ink3">{t(`evidence.evidenceTypes.${record.evidence_type}`)}</span></button>{record.file_name ? <Button variant="secondary" className="shrink-0" onClick={() => void viewEvidenceAttachment(record)} title={t('evidence.viewSecureFile')}><Eye size={15} /></Button> : null}</li>) : <li className="py-3 text-sm text-ink3">{t('evidence.noEvidenceRecords')}</li>}</ul>
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

    <section className="overflow-hidden rounded-[var(--r-lg)] border border-line bg-surface" data-testid="evidence-exception-queue">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div><h2 className="font-medium text-ink">{t('evidence.exceptionQueue')}</h2><span className="text-xs text-ink3">{visibleExceptions.length} {t('evidence.open')}</span></div>
        {canManageApplicability ? <Button data-testid="export-evidence-packet" variant="secondary" onClick={() => void downloadInspectorPacket()}><Download size={15} /> {t('evidence.exportPacket')}</Button> : null}
      </div>
      {canManageApplicability ? <div className="flex flex-wrap gap-3 border-b border-line bg-surface-2 px-4 py-3">
        <label className="text-xs text-ink2">{t('evidence.filterState')}<select data-testid="exception-state-filter" value={exceptionFilter} onChange={(event) => setExceptionFilter(event.target.value as typeof exceptionFilter)} className="ml-2 rounded border border-line bg-surface px-2 py-1 text-sm text-ink"><option value="all">{t('evidence.allExceptions')}</option>{(['missing', 'overdue', 'expired', 'failed', 'deferred', 'unacknowledged'] as const).map((state) => <option key={state} value={state}>{t(`evidence.states.${state}`)}</option>)}</select></label>
        <label className="text-xs text-ink2">{t('evidence.filterType')}<select data-testid="exception-kind-filter" value={exceptionKindFilter} onChange={(event) => setExceptionKindFilter(event.target.value as typeof exceptionKindFilter)} className="ml-2 rounded border border-line bg-surface px-2 py-1 text-sm text-ink"><option value="all">{t('evidence.allExceptions')}</option>{(['document', 'acknowledgement', 'evidence'] as const).map((kind) => <option key={kind} value={kind}>{t(`evidence.exceptionKinds.${kind}`)}</option>)}</select></label>
      </div> : null}
      {loading ? <p className="p-6 text-sm text-ink3">{t('common.loading')}</p>
        : error ? <p className="p-6 text-sm text-alert">{error}</p>
          : visibleExceptions.length === 0 ? <p className="p-6 text-sm text-ink3">{t('evidence.noExceptions')}</p>
            : <ul className="divide-y divide-line">{visibleExceptions.map((item) => <li key={`${item.kind}-${item.reference_id}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div><p className="text-sm font-medium text-ink">{item.label}</p><p className="text-xs text-ink3">{t(`evidence.exceptionKinds.${item.kind}`)} · {t(`evidence.lifecycleStates.${item.lifecycle_state}`)}{item.owner_id ? ` · ${item.owner_id}` : ''}</p></div>
              <div className="flex items-center gap-2"><span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATE_STYLE[item.state]}`}>{t(`evidence.states.${item.state}`)}</span>{canManageApplicability ? <Button data-testid={`exception-drilldown-${item.reference_id}`} className="px-2.5 py-1.5 text-xs" variant="secondary" onClick={() => openException(item)}>{t('evidence.manageException')}</Button> : null}</div>
            </li>)}</ul>}
      {canManageApplicability && selectedException ? <div className="border-t border-line bg-surface-2 p-4" data-testid="exception-drilldown">
        <div className="mb-3"><p className="font-medium text-ink">{selectedException.label}</p><p className="text-xs text-ink3">{t(`evidence.states.${selectedException.state}`)} · {t(`evidence.exceptionKinds.${selectedException.kind}`)}</p></div>
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm text-ink2">{t('evidence.exceptionAction')}<select value={exceptionAction} onChange={(event) => setExceptionAction(event.target.value as EvidenceExceptionAction)} className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 text-ink">{(['assign', 'defer', 'escalate', 'resolve', 'reopen'] as const).map((action) => <option key={action} value={action}>{t(`evidence.exceptionActions.${action}`)}</option>)}</select></label><label className="text-sm text-ink2">{t('evidence.exceptionOwner')}<input data-testid="exception-owner" value={exceptionOwner} onChange={(event) => setExceptionOwner(event.target.value)} className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 text-ink" /></label><label className="text-sm text-ink2">{t('evidence.reasonCode')}<select value={exceptionReasonCode} onChange={(event) => setExceptionReasonCode(event.target.value as typeof exceptionReasonCode)} className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 text-ink">{(['safety_risk', 'vendor_delay', 'staffing', 'document_revision', 'evidence_pending', 'corrected', 'other'] as const).map((code) => <option key={code} value={code}>{t(`evidence.reasonCodes.${code}`)}</option>)}</select></label><label className="text-sm text-ink2">{t('evidence.reasonNote')}<input data-testid="exception-reason-note" value={exceptionReasonNote} onChange={(event) => setExceptionReasonNote(event.target.value)} className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 text-ink" /></label></div>
        <div className="mt-3 flex gap-2"><Button data-testid="save-exception-action" disabled={exceptionSaving || !exceptionReasonNote || (exceptionAction === 'assign' && !exceptionOwner)} onClick={() => void saveExceptionAction()}>{t('evidence.saveExceptionAction')}</Button><Button variant="secondary" onClick={() => setSelectedException(null)}>{t('common.cancel')}</Button></div>
      </div> : null}
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
