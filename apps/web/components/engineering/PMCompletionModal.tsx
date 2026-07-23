'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  X,
  Loader2,
  CheckCircle,
  AlertTriangle,
  Paperclip,
  Plus,
  Trash2,
} from 'lucide-react'
import {
  programsApi,
  type ProgramTemplate,
  type PMChecklistItemInput,
  type PMPart,
  type PMDefect,
  type PMCompletionPayload,
} from '@/lib/api/programs'
import type { PMSchedule } from '@/lib/api/engineering'
import { staffApi, type StaffMember } from '@/lib/api/staff'
import { useAuth } from '@/lib/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

// ─── Local (form-only) types ────────────────────────────────────────────────
// LocalItem mirrors PMChecklistItemInput but tracks an unset result ('') so the
// technician must actively choose pass/fail/n-a — never silently defaults to passed.

interface LocalItem {
  localId: string
  key?: string
  label: string
  result: 'passed' | 'failed' | 'not_applicable' | ''
  requires_evidence: boolean
  evidence: string[]
  evidenceNames: string[]
  note: string
  uploading: boolean
}

interface EvidenceAttachment {
  id: string
  name: string
}

function genId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function defaultItems(): LocalItem[] {
  return [{
    localId: genId(),
    key: 'general_completion',
    label: 'General completion check',
    result: '',
    requires_evidence: false,
    evidence: [],
    evidenceNames: [],
    note: '',
    uploading: false,
  }]
}

function templateToItems(template: ProgramTemplate): LocalItem[] {
  const checklist = template.items?.checklist ?? []
  if (checklist.length === 0) return defaultItems()
  return checklist.map((entry) => ({
    localId: genId(),
    key: entry.key,
    label: entry.label,
    result: '',
    requires_evidence: entry.requires_evidence,
    evidence: [],
    evidenceNames: [],
    note: '',
    uploading: false,
  }))
}

function rowsToObject(rows: { key: string; value: string }[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const row of rows) {
    if (row.key.trim()) out[row.key.trim()] = row.value
  }
  return out
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface PMCompletionModalProps {
  isOpen: boolean
  onClose: () => void
  schedule: PMSchedule | null
  onSuccess: () => void
}

export function PMCompletionModal({ isOpen, onClose, schedule, onSuccess }: PMCompletionModalProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const [templateId, setTemplateId] = useState<string>('')
  const [items, setItems] = useState<LocalItem[]>(defaultItems())
  const [verifierId, setVerifierId] = useState('')
  const [measurementRows, setMeasurementRows] = useState<{ localId: string; key: string; value: string }[]>([])
  const [meterRows, setMeterRows] = useState<{ localId: string; key: string; value: string }[]>([])
  const [laborMinutes, setLaborMinutes] = useState('')
  const [parts, setParts] = useState<(PMPart & { localId: string })[]>([])
  const [defects, setDefects] = useState<(PMDefect & { localId: string })[]>([])
  const [vendorName, setVendorName] = useState('')
  const [certificates, setCertificates] = useState<EvidenceAttachment[]>([])
  const [photos, setPhotos] = useState<EvidenceAttachment[]>([])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadingGeneral, setUploadingGeneral] = useState<'photo' | 'certificate' | null>(null)

  const { data: overviewData } = useQuery({
    queryKey: ['program-overview-for-pm-completion'],
    queryFn: () => programsApi.overview(),
    enabled: isOpen,
    staleTime: 60_000,
  })
  const templates = useMemo(
    () => (overviewData?.data.templates ?? []).filter((t) => t.program_area === 'engineering'),
    [overviewData],
  )

  const { data: staffData } = useQuery({
    queryKey: ['staff-for-pm-verifier'],
    queryFn: () => staffApi.list(),
    enabled: isOpen,
    staleTime: 60_000,
  })
  const verifierOptions: StaffMember[] = (staffData?.data.staff ?? []).filter(
    (member) => member.status === 'active' && member.user_id !== user?.id,
  )

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setTemplateId('')
      setItems(defaultItems())
      setVerifierId('')
      setMeasurementRows([])
      setMeterRows([])
      setLaborMinutes('')
      setParts([])
      setDefects([])
      setVendorName('')
      setCertificates([])
      setPhotos([])
      setNotes('')
      setError(null)
      setSaving(false)
    }
  }, [isOpen])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) onClose()
    }
    if (isOpen) document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, saving, onClose])

  if (!isOpen || !schedule) return null

  const selectedTemplate = templates.find((t) => t.id === templateId) ?? null

  function handleTemplateChange(nextId: string) {
    setTemplateId(nextId)
    const template = templates.find((t) => t.id === nextId)
    setItems(template ? templateToItems(template) : defaultItems())
  }

  function updateItem(localId: string, patch: Partial<LocalItem>) {
    setItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, ...patch } : it)))
  }

  async function uploadItemEvidence(localId: string, file: File | null) {
    if (!file || !schedule) return
    updateItem(localId, { uploading: true })
    try {
      const item = items.find((it) => it.localId === localId)
      const evidenceId = await programsApi.uploadEvidence(file, {
        related_entity_type: 'asset',
        related_entity_id: schedule.asset_id,
        evidence_type: 'photo',
        label: `PM evidence — ${item?.label ?? schedule.name}`,
      })
      setItems((prev) => prev.map((it) => (it.localId === localId
        ? { ...it, uploading: false, evidence: [...it.evidence, evidenceId], evidenceNames: [...it.evidenceNames, file.name] }
        : it)))
    } catch (err) {
      updateItem(localId, { uploading: false })
      setError(err instanceof Error ? err.message : 'Failed to upload evidence photo.')
    }
  }

  async function uploadGeneral(kind: 'photo' | 'certificate', file: File | null) {
    if (!file || !schedule) return
    setUploadingGeneral(kind)
    try {
      const evidenceId = await programsApi.uploadEvidence(file, {
        related_entity_type: 'asset',
        related_entity_id: schedule.asset_id,
        evidence_type: kind === 'photo' ? 'photo' : 'external_certificate',
        label: kind === 'photo' ? `PM photo — ${schedule.name}` : `PM vendor certificate — ${schedule.name}`,
      })
      const attachment = { id: evidenceId, name: file.name }
      if (kind === 'photo') setPhotos((prev) => [...prev, attachment])
      else setCertificates((prev) => [...prev, attachment])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload attachment.')
    } finally {
      setUploadingGeneral(null)
    }
  }

  function addRow(setter: typeof setMeasurementRows) {
    setter((prev) => [...prev, { localId: genId(), key: '', value: '' }])
  }
  function removeRow(setter: typeof setMeasurementRows, localId: string) {
    setter((prev) => prev.filter((r) => r.localId !== localId))
  }

  function addPart() {
    setParts((prev) => [...prev, { localId: genId(), name: '', qty: undefined, cost: undefined }])
  }
  function addDefect() {
    setDefects((prev) => [...prev, { localId: genId(), description: '', severity: undefined }])
  }

  async function handleSubmit() {
    if (!schedule) return
    setError(null)

    for (const item of items) {
      if (!item.result) {
        setError(`Select a result (Passed/Failed/N-A) for "${item.label}".`)
        return
      }
      if (item.requires_evidence && item.result !== 'not_applicable' && item.evidence.length === 0) {
        setError(`Evidence is required for "${item.label}" before this can be submitted.`)
        return
      }
    }
    if (verifierId && verifierId === user?.id) {
      setError('The verifier must be someone other than the technician submitting this completion.')
      return
    }

    setSaving(true)
    try {
      const payload: PMCompletionPayload = {
        checklist_template_id: selectedTemplate?.id,
        checklist_version: selectedTemplate?.version,
        verifier_id: verifierId || undefined,
        measurements: rowsToObject(measurementRows),
        meter_readings: rowsToObject(meterRows),
        photos: photos.map((p) => p.id),
        labor_minutes: laborMinutes ? Number(laborMinutes) : 0,
        parts_used: parts
          .filter((p) => p.name.trim())
          .map(({ localId: _localId, ...rest }) => rest),
        defects: defects
          .filter((d) => d.description.trim())
          .map(({ localId: _localId, ...rest }) => rest),
        vendor_name: vendorName.trim() || undefined,
        certificate_attachments: certificates.map((c) => c.id),
        notes: notes.trim() || undefined,
        items: items.map((it): PMChecklistItemInput => ({
          key: it.key,
          label: it.label,
          result: it.result as 'passed' | 'failed' | 'not_applicable',
          requires_evidence: it.requires_evidence,
          evidence: it.evidence,
          note: it.note.trim() || undefined,
        })),
      }
      await programsApi.completePM(schedule.id, payload)
      queryClient.invalidateQueries({ queryKey: ['pm-schedules'] })
      onSuccess()
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to complete PM schedule.')
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
          role="dialog"
          aria-modal="true"
          aria-label="Complete PM Schedule"
          className="bg-surface/[0.92] backdrop-blur-2xl border border-white/[0.95] rounded-[var(--r-lg)] shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/60 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-green-600 flex items-center justify-center shrink-0">
                <CheckCircle size={16} className="text-white" />
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-900">Complete PM Schedule</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {schedule.assets?.name ?? 'Unknown asset'} — {schedule.name}
                </p>
              </div>
            </div>
            {!saving && (
              <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" aria-label="Close">
                <X size={18} />
              </button>
            )}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
            {/* Template selector */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Checklist template <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <select
                value={templateId}
                onChange={(e) => handleTemplateChange(e.target.value)}
                className="w-full border border-[var(--caution-line)]/40 rounded-lg px-3 py-2 text-sm bg-surface/70 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-[var(--caution-line)] transition-colors"
              >
                <option value="">General completion (no template)</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>

            {/* Checklist items */}
            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-700">Checklist results</p>
              {items.map((item) => (
                <div key={item.localId} className="rounded-lg border border-[var(--caution-line)]/50 p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-gray-800">{item.label}</p>
                    {item.requires_evidence && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 shrink-0">
                        Evidence required
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    {(['passed', 'failed', 'not_applicable'] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => updateItem(item.localId, { result: r })}
                        className={`min-h-[36px] px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors ${
                          item.result === r
                            ? r === 'passed'
                              ? 'bg-[var(--ready-soft)] border-green-300 text-green-700'
                              : r === 'failed'
                                ? 'bg-[var(--alert-soft)] border-red-300 text-[var(--alert)]'
                                : 'bg-slate-100 border-slate-300 text-slate-600'
                            : 'bg-transparent border-gray-200 text-gray-500 hover:bg-gray-50'
                        }`}
                      >
                        {r === 'passed' ? 'Passed' : r === 'failed' ? 'Failed' : 'N/A'}
                      </button>
                    ))}
                  </div>
                  {item.result === 'failed' && (
                    <p className="text-xs text-[var(--alert)] bg-[var(--alert-soft)] border border-red-200 rounded px-2 py-1.5">
                      A corrective work order will automatically be created for this item.
                    </p>
                  )}
                  <textarea
                    value={item.note}
                    onChange={(e) => updateItem(item.localId, { note: e.target.value })}
                    placeholder="Note (optional)"
                    rows={1}
                    className="w-full border border-gray-200 rounded-md px-2.5 py-1.5 text-xs bg-white/70 focus:outline-none focus:ring-2 focus:ring-amber-400/40 resize-none"
                  />
                  {item.requires_evidence && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <label className="inline-flex items-center gap-1.5 min-h-[32px] px-2.5 py-1 rounded-md border border-dashed border-gray-300 text-xs text-gray-600 hover:bg-gray-50 cursor-pointer">
                        <Paperclip size={12} />
                        {item.uploading ? 'Uploading…' : 'Attach photo'}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="hidden"
                          disabled={item.uploading}
                          onChange={(e) => uploadItemEvidence(item.localId, e.target.files?.[0] ?? null)}
                        />
                      </label>
                      {item.evidenceNames.map((name, i) => (
                        <span key={i} className="text-xs text-gray-500 bg-gray-100 rounded px-2 py-1">{name}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Verifier */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Verifier <span className="text-gray-400 font-normal">(distinct from you, optional)</span>
              </label>
              <select
                value={verifierId}
                onChange={(e) => setVerifierId(e.target.value)}
                className="w-full border border-[var(--caution-line)]/40 rounded-lg px-3 py-2 text-sm bg-surface/70 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-[var(--caution-line)] transition-colors"
              >
                <option value="">No verifier</option>
                {verifierOptions.map((m) => (
                  <option key={m.user_id} value={m.user_id}>{m.full_name} ({m.role})</option>
                ))}
              </select>
            </div>

            {/* Measurements + meter readings */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <KeyValueEditor
                title="Measurements"
                rows={measurementRows}
                onAdd={() => addRow(setMeasurementRows)}
                onRemove={(id) => removeRow(setMeasurementRows, id)}
                onChange={(id, field, value) => setMeasurementRows((prev) => prev.map((r) => (r.localId === id ? { ...r, [field]: value } : r)))}
              />
              <KeyValueEditor
                title="Meter readings"
                rows={meterRows}
                onAdd={() => addRow(setMeterRows)}
                onRemove={(id) => removeRow(setMeterRows, id)}
                onChange={(id, field, value) => setMeterRows((prev) => prev.map((r) => (r.localId === id ? { ...r, [field]: value } : r)))}
              />
            </div>

            {/* Labor minutes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Labor minutes</label>
              <Input
                type="number"
                min={0}
                max={1440}
                value={laborMinutes}
                onChange={(e) => setLaborMinutes(e.target.value)}
                placeholder="e.g. 45"
              />
            </div>

            {/* Parts */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-700">Parts used</p>
                <button type="button" onClick={addPart} className="text-xs font-medium text-blue-600 hover:underline flex items-center gap-1">
                  <Plus size={12} /> Add part
                </button>
              </div>
              {parts.map((part) => (
                <div key={part.localId} className="grid grid-cols-[1fr_80px_90px_28px] gap-2 items-center">
                  <Input placeholder="Part name" value={part.name} onChange={(e) => setParts((prev) => prev.map((p) => (p.localId === part.localId ? { ...p, name: e.target.value } : p)))} />
                  <Input type="number" placeholder="Qty" value={part.qty ?? ''} onChange={(e) => setParts((prev) => prev.map((p) => (p.localId === part.localId ? { ...p, qty: e.target.value ? Number(e.target.value) : undefined } : p)))} />
                  <Input type="number" placeholder="Cost" value={part.cost ?? ''} onChange={(e) => setParts((prev) => prev.map((p) => (p.localId === part.localId ? { ...p, cost: e.target.value ? Number(e.target.value) : undefined } : p)))} />
                  <button type="button" onClick={() => setParts((prev) => prev.filter((p) => p.localId !== part.localId))} className="text-gray-400 hover:text-[var(--alert)]" aria-label="Remove part">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>

            {/* Defects */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-700">Defects found</p>
                <button type="button" onClick={addDefect} className="text-xs font-medium text-blue-600 hover:underline flex items-center gap-1">
                  <Plus size={12} /> Add defect
                </button>
              </div>
              {defects.map((defect) => (
                <div key={defect.localId} className="grid grid-cols-[1fr_120px_28px] gap-2 items-center">
                  <Input placeholder="Description" value={defect.description} onChange={(e) => setDefects((prev) => prev.map((d) => (d.localId === defect.localId ? { ...d, description: e.target.value } : d)))} />
                  <select
                    value={defect.severity ?? ''}
                    onChange={(e) => setDefects((prev) => prev.map((d) => (d.localId === defect.localId ? { ...d, severity: e.target.value || undefined } : d)))}
                    className="border border-gray-200 rounded-md px-2 py-2 text-xs bg-white/70"
                  >
                    <option value="">Severity</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                  <button type="button" onClick={() => setDefects((prev) => prev.filter((d) => d.localId !== defect.localId))} className="text-gray-400 hover:text-[var(--alert)]" aria-label="Remove defect">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>

            {/* Vendor + certificate */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Vendor name <span className="text-gray-400 font-normal">(optional)</span></label>
              <Input value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder="e.g. ACME Elevator Service" />
              <div className="flex items-center gap-2 flex-wrap mt-2">
                <label className="inline-flex items-center gap-1.5 min-h-[32px] px-2.5 py-1 rounded-md border border-dashed border-gray-300 text-xs text-gray-600 hover:bg-gray-50 cursor-pointer">
                  <Paperclip size={12} />
                  {uploadingGeneral === 'certificate' ? 'Uploading…' : 'Attach vendor certificate'}
                  <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" disabled={uploadingGeneral !== null} onChange={(e) => uploadGeneral('certificate', e.target.files?.[0] ?? null)} />
                </label>
                {certificates.map((c) => <span key={c.id} className="text-xs text-gray-500 bg-gray-100 rounded px-2 py-1">{c.name}</span>)}
              </div>
            </div>

            {/* General photos */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Additional photos <span className="text-gray-400 font-normal">(optional)</span></label>
              <div className="flex items-center gap-2 flex-wrap">
                <label className="inline-flex items-center gap-1.5 min-h-[32px] px-2.5 py-1 rounded-md border border-dashed border-gray-300 text-xs text-gray-600 hover:bg-gray-50 cursor-pointer">
                  <Paperclip size={12} />
                  {uploadingGeneral === 'photo' ? 'Uploading…' : 'Attach photo'}
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploadingGeneral !== null} onChange={(e) => uploadGeneral('photo', e.target.files?.[0] ?? null)} />
                </label>
                {photos.map((p) => <span key={p.id} className="text-xs text-gray-500 bg-gray-100 rounded px-2 py-1">{p.name}</span>)}
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full border border-[var(--caution-line)]/40 rounded-lg px-3 py-2 text-sm bg-surface/70 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50 transition-colors resize-none"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-[var(--alert-soft)] border border-red-200 text-sm text-red-700">
                <AlertTriangle size={14} className="shrink-0" />
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-white/60 shrink-0">
            <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button
              variant="secondary"
              onClick={handleSubmit}
              disabled={saving}
              className="border-green-200 text-green-700 bg-[var(--ready-soft)] hover:bg-green-100"
            >
              {saving ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  Completing…
                </>
              ) : (
                <>
                  <CheckCircle size={14} />
                  Confirm Complete
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Key/value row editor (measurements + meter readings) ──────────────────

function KeyValueEditor({
  title,
  rows,
  onAdd,
  onRemove,
  onChange,
}: {
  title: string
  rows: { localId: string; key: string; value: string }[]
  onAdd: () => void
  onRemove: (localId: string) => void
  onChange: (localId: string, field: 'key' | 'value', value: string) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-700">{title}</p>
        <button type="button" onClick={onAdd} className="text-xs font-medium text-blue-600 hover:underline flex items-center gap-1">
          <Plus size={12} /> Add
        </button>
      </div>
      {rows.map((row) => (
        <div key={row.localId} className="grid grid-cols-[1fr_1fr_24px] gap-1.5 items-center">
          <Input placeholder="Key" value={row.key} onChange={(e) => onChange(row.localId, 'key', e.target.value)} className="text-xs" />
          <Input placeholder="Value" value={row.value} onChange={(e) => onChange(row.localId, 'value', e.target.value)} className="text-xs" />
          <button type="button" onClick={() => onRemove(row.localId)} className="text-gray-400 hover:text-[var(--alert)]" aria-label={`Remove ${title} row`}>
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
