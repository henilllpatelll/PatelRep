'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AlertCircle, ChevronDown, Paperclip, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { logbookApi, type Department, type LogbookCategory, type LogbookPriority } from '@/lib/api/logbook'
import { roomsApi, type RoomStatus } from '@/lib/api/rooms'
import { staffApi } from '@/lib/api/staff'
import { evidenceApi } from '@/lib/api/evidence'
import { Button, IconButton } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'
import { useToast } from '@/components/ui/Toast'
import { AssigneePicker } from '@/components/tasks/AssigneePicker'
import { endOfShiftDate } from '@/lib/utils/taskCreation'
import { cn } from '@/lib/utils'
import { RelatedItemPicker } from './RelatedItemPicker'
import { categoryIcon, getCategoryOptions, type LogbookRelatedItem } from '@/lib/utils/logbookDisplay'
import {
  buildAddHandoffPayload,
  computeFollowUpDueAt,
  temporaryNoteHours,
  type FollowUpDuePreset,
  type TemporaryNotePreset,
} from '@/lib/utils/logbookHandoff'

const DUE_PRESETS: FollowUpDuePreset[] = ['end_of_shift', '1h', '2h', 'tomorrow', 'custom']
const TEMP_NOTE_PRESETS: TemporaryNotePreset[] = ['1h', '4h', '8h', 'custom']

function todayDateInput(d = new Date()): string {
  return d.toISOString().slice(0, 10)
}
function nowTimeInput(d = new Date()): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function Field({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-ink">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-ink3">{hint}</p>}
    </div>
  )
}

interface AddHandoffDrawerProps {
  isOpen: boolean
  onClose: () => void
  onCreated: () => void
  departments: Department[]
  defaultDepartmentId: string
  shiftContextLabel?: string
  /** The currently selected shift's end_time ("HH:MM:SS"), if one is known — powers
   * the "End of shift" due preset. Never fabricated when no real shift is selected. */
  activeShiftEndTime?: string | null
  isHistoricalDate: boolean
  onGoToToday: () => void
}

/** Desktop drawer replacing the old Add Entry modal (spec: Logbook Phase 3).
 * Portal-free by design — matches this app's verified z-drawer convention used by
 * CreateTaskDrawer/CreateWorkOrderDrawer/RoomDetailDrawer rather than createPortal. */
export function AddHandoffDrawer({
  isOpen, onClose, onCreated, departments, defaultDepartmentId, shiftContextLabel, activeShiftEndTime, isHistoricalDate, onGoToToday,
}: AddHandoffDrawerProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const ref = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const wasOpen = useRef(false)
  useModalFocusTrap(ref, isOpen, onClose)

  const [content, setContent] = useState('')
  const [contentTouched, setContentTouched] = useState(false)
  const [category, setCategory] = useState<LogbookCategory>('general')
  const [priority, setPriority] = useState<LogbookPriority>('normal')
  const [needsFollowUp, setNeedsFollowUp] = useState(false)
  const [assignedTo, setAssignedTo] = useState('')
  const [duePreset, setDuePreset] = useState<FollowUpDuePreset>('end_of_shift')
  const [customDueDate, setCustomDueDate] = useState(() => todayDateInput())
  const [customDueTime, setCustomDueTime] = useState(() => nowTimeInput())
  const [relatedItem, setRelatedItem] = useState<LogbookRelatedItem | null>(null)
  const [showMoreOptions, setShowMoreOptions] = useState(false)
  const [departmentId, setDepartmentId] = useState(defaultDepartmentId)
  const [temporaryNoteEnabled, setTemporaryNoteEnabled] = useState(false)
  const [temporaryNotePreset, setTemporaryNotePreset] = useState<TemporaryNotePreset>('4h')
  const [customHours, setCustomHours] = useState(4)
  const [requiresAcknowledgment, setRequiresAcknowledgment] = useState(false)
  const [acknowledgmentTargetIds, setAcknowledgmentTargetIds] = useState<string[]>([])
  const [attachments, setAttachments] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())

  // Reset every time the drawer opens — never leaks stale values from a previous
  // submission (spec #38). A late department fetch must not erase entered text.
  useEffect(() => {
    const justOpened = isOpen && !wasOpen.current
    wasOpen.current = isOpen
    if (!justOpened) return
    setNow(new Date())
    setContent('')
    setContentTouched(false)
    setCategory('general')
    setPriority('normal')
    setNeedsFollowUp(false)
    setAssignedTo('')
    setDuePreset('end_of_shift')
    setCustomDueDate(todayDateInput())
    setCustomDueTime(nowTimeInput())
    setRelatedItem(null)
    setShowMoreOptions(false)
    setDepartmentId(defaultDepartmentId)
    setTemporaryNoteEnabled(false)
    setTemporaryNotePreset('4h')
    setCustomHours(4)
    setRequiresAcknowledgment(false)
    setAcknowledgmentTargetIds([])
    setAttachments([])
    setError(null)
  }, [defaultDepartmentId, isOpen])

  useEffect(() => {
    if (isOpen && !departmentId && defaultDepartmentId) setDepartmentId(defaultDepartmentId)
  }, [defaultDepartmentId, departmentId, isOpen])

  const staffQuery = useQuery({ queryKey: ['staff-picker'], queryFn: () => staffApi.list(), enabled: isOpen, staleTime: 60_000 })
  const staff = useMemo(() => (staffQuery.data?.data.staff ?? []).filter((member) => member.status === 'active'), [staffQuery.data])

  const roomsQuery = useQuery({ queryKey: ['rooms-list-simple'], queryFn: () => roomsApi.list(), enabled: isOpen, staleTime: 60_000 })
  const rooms = useMemo(() => ((roomsQuery.data as { data?: RoomStatus[] } | undefined)?.data ?? []), [roomsQuery.data])

  const endOfShiftAt = activeShiftEndTime ? endOfShiftDate(activeShiftEndTime, now) : null
  const availableDuePresets = DUE_PRESETS.filter((preset) => preset !== 'end_of_shift' || !!endOfShiftAt)
  const followUpAt = computeFollowUpDueAt(duePreset, {
    now,
    endOfShiftAt,
    customIso: duePreset === 'custom' && customDueDate && customDueTime ? new Date(`${customDueDate}T${customDueTime}:00`).toISOString() : undefined,
  })

  const mutation = useMutation({
    mutationFn: () => logbookApi.createEntry(buildAddHandoffPayload({
      departmentId,
      content,
      category,
      priority,
      needsFollowUp,
      followUpAt,
      assignedTo: assignedTo || undefined,
      relatedType: relatedItem?.type,
      relatedId: relatedItem?.id,
      temporaryNoteEnabled,
      expiresHours: temporaryNoteEnabled ? temporaryNoteHours(temporaryNotePreset, customHours) : undefined,
      requiresAcknowledgment,
      acknowledgmentTargetIds,
    })),
    onSuccess: async ({ data: entry }) => {
      const uploadFailures: string[] = []
      for (const file of attachments) {
        let recordId: string | null = null
        try {
          const { data: record } = await evidenceApi.createRecord({
            label: file.name,
            evidence_type: file.type.startsWith('image/') ? 'photo' : 'file',
            related_entity_type: 'logbook_entry',
            related_entity_id: entry.id,
          })
          recordId = record.id
          await evidenceApi.uploadRecordFile(record.id, file)
        } catch {
          if (recordId) await evidenceApi.deleteRecord(recordId).catch(() => undefined)
          uploadFailures.push(file.name)
        }
      }
      onCreated()
      if (uploadFailures.length) toast.error(t('logbook.attachmentUploadPartial'))
      else toast.success(t('logbook.handoffAdded'))
      onClose()
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : t('logbook.unableToAddHandoff'))
    },
  })

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setContentTouched(true)
    if (!content.trim() || !departmentId || (requiresAcknowledgment && (priority !== 'important' || !acknowledgmentTargetIds.length))) return
    setError(null)
    mutation.mutate()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-drawer flex justify-end">
      <button aria-label={t('common.close')} className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="add-handoff-title" className="relative flex h-full w-full max-w-[580px] flex-col border-l border-line bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 id="add-handoff-title" className="text-lg font-semibold text-ink">{t('logbook.addHandoff')}</h2>
            {shiftContextLabel && <p className="mt-0.5 text-xs text-ink3">{shiftContextLabel}</p>}
          </div>
          <IconButton variant="ghost" size="sm" onClick={onClose} aria-label={t('common.close')}><X size={18} /></IconButton>
        </div>

        <form ref={formRef} onSubmit={submit} className="flex-1 overflow-y-auto p-5 space-y-5">
          {isHistoricalDate && (
            <div className="flex items-start justify-between gap-3 rounded-[var(--r-md)] border border-[var(--caution-line)] bg-[var(--caution-soft)] px-3 py-2.5">
              <p className="text-xs text-[var(--caution)]">{t('logbook.historicalCreateNotice')}</p>
              <Button type="button" variant="ghost" size="sm" onClick={onGoToToday} className="shrink-0 text-[var(--caution)]">{t('logbook.goToToday')}</Button>
            </div>
          )}

          <Field label={t('logbook.contentLabel')} htmlFor="handoff-content">
            <textarea
              id="handoff-content"
              autoFocus
              rows={4}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onBlur={() => setContentTouched(true)}
              placeholder={t('logbook.contentPlaceholder')}
              aria-invalid={contentTouched && !content.trim()}
              className="w-full resize-none rounded-[var(--r-md)] border border-line bg-surface px-3 py-2.5 text-sm text-ink"
            />
            {contentTouched && !content.trim() && <p className="mt-1 text-xs text-[var(--alert)]">{t('logbook.contentRequiredError')}</p>}
          </Field>

          <Field label={t('logbook.category')}>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('logbook.category')}>
              {getCategoryOptions(t).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setCategory(option.value)}
                  aria-pressed={category === option.value}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors',
                    category === option.value ? 'bg-accent text-white border-accent' : 'bg-surface border-line text-ink2 hover:bg-surface-2',
                  )}
                >
                  {categoryIcon(option.value)}
                  {option.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label={t('logbook.importance')}>
            <div className="flex gap-2" role="group" aria-label={t('logbook.importance')}>
              {(['normal', 'important'] as LogbookPriority[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPriority(value)}
                  aria-pressed={priority === value}
                  className={cn(
                    'flex-1 rounded-[var(--r-md)] border py-2 text-[13px] font-semibold transition-colors',
                    priority === value
                      ? value === 'important' ? 'bg-[var(--alert-soft)] border-[var(--alert)] text-[var(--alert)]' : 'bg-surface-3 border-ink3 text-ink'
                      : 'bg-surface border-line text-ink2 hover:bg-surface-2',
                  )}
                >
                  {t(`logbook.priorities.${value}`)}
                </button>
              ))}
            </div>
          </Field>

          <div className="border-t border-line pt-4">
            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              <input type="checkbox" checked={needsFollowUp} onChange={(e) => setNeedsFollowUp(e.target.checked)} className="h-4 w-4 rounded border-line" />
              {t('logbook.needsFollowUp')}
            </label>
            {needsFollowUp && (
              <div className="mt-3 space-y-3 rounded-[var(--r-md)] border border-line bg-surface-2 p-3">
                <Field label={t('logbook.owner')} htmlFor="handoff-owner">
                  <AssigneePicker id="handoff-owner" staff={staff} value={assignedTo} onChange={setAssignedTo} unassignedLabel={t('logbook.unassigned')} />
                </Field>
                <Field label={t('logbook.due')}>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('logbook.due')}>
                    {availableDuePresets.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setDuePreset(preset)}
                        aria-pressed={duePreset === preset}
                        className={cn('rounded-full border px-3 py-1.5 text-[12.5px] font-medium', duePreset === preset ? 'bg-accent text-white border-accent' : 'bg-surface border-line text-ink2')}
                      >
                        {t(`logbook.duePresets.${preset}`)}
                      </button>
                    ))}
                  </div>
                  {duePreset === 'custom' && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <Input type="date" aria-label={t('logbook.customDueDateLabel')} value={customDueDate} onChange={(e) => setCustomDueDate(e.target.value)} min={todayDateInput()} />
                      <Input type="time" aria-label={t('logbook.customDueTimeLabel')} value={customDueTime} onChange={(e) => setCustomDueTime(e.target.value)} />
                    </div>
                  )}
                </Field>
              </div>
            )}
          </div>

          <div className="border-t border-line pt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[.08em] text-ink3">{t('logbook.linkTo')}</p>
            <RelatedItemPicker value={relatedItem} onChange={setRelatedItem} rooms={rooms} />
          </div>

          <div className="border-t border-line pt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[.08em] text-ink3">{t('logbook.attachments')}</p>
            <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-[var(--r-md)] border border-dashed border-line px-3 py-2 text-sm font-medium text-accent hover:bg-surface-2">
              <Paperclip size={15} aria-hidden="true" />
              {t('logbook.addAttachment')}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                multiple
                className="sr-only"
                onChange={(event) => {
                  const selected = Array.from(event.target.files ?? [])
                  const valid = selected.filter((file) => file.size <= 10 * 1024 * 1024)
                  if (valid.length !== selected.length || attachments.length + valid.length > 5) {
                    setError(t('logbook.attachmentValidationError'))
                    return
                  }
                  setAttachments((current) => [...current, ...valid])
                  event.currentTarget.value = ''
                }}
              />
            </label>
            {attachments.length > 0 && <ul className="mt-2 space-y-1.5">{attachments.map((file, index) => <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-2 rounded-[var(--r-sm)] bg-surface-2 px-2.5 py-2 text-sm text-ink"><span className="truncate">{file.name}</span><button type="button" onClick={() => setAttachments((current) => current.filter((_, fileIndex) => fileIndex !== index))} className="shrink-0 text-xs font-medium text-accent hover:underline">{t('common.remove')}</button></li>)}</ul>}
          </div>

          <div className="border-t border-line pt-4">
            {!showMoreOptions ? (
              <button type="button" onClick={() => setShowMoreOptions(true)} className="flex items-center gap-1 text-sm font-medium text-accent">
                {t('logbook.moreOptions')} <ChevronDown size={14} aria-hidden="true" />
              </button>
            ) : (
              <div className="space-y-4">
                <button type="button" onClick={() => setShowMoreOptions(false)} className="text-xs font-medium text-accent">{t('logbook.hideMoreOptions')}</button>

                <Field label={t('logbook.department')} htmlFor="handoff-department">
                  <div className="relative">
                    <select
                      id="handoff-department"
                      value={departmentId}
                      onChange={(e) => setDepartmentId(e.target.value)}
                      className="w-full appearance-none rounded-[var(--r-md)] border border-line bg-surface px-3 py-2 pr-8 text-sm text-ink"
                    >
                      {departments.map((dept) => <option key={dept.id} value={dept.id}>{dept.name}</option>)}
                    </select>
                    <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink4" aria-hidden="true" />
                  </div>
                </Field>

                <div>
                  <label className="flex items-center justify-between gap-2 text-sm font-medium text-ink">
                    {t('logbook.temporaryNote')}
                    <input type="checkbox" checked={temporaryNoteEnabled} onChange={(e) => setTemporaryNoteEnabled(e.target.checked)} className="h-4 w-4 rounded border-line" />
                  </label>
                  {temporaryNoteEnabled && (
                    <div className="mt-2 space-y-2">
                      <p className="text-xs text-ink3">{t('logbook.hideAfter')}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {TEMP_NOTE_PRESETS.map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setTemporaryNotePreset(preset)}
                            aria-pressed={temporaryNotePreset === preset}
                            className={cn('rounded-full border px-3 py-1.5 text-[12.5px] font-medium', temporaryNotePreset === preset ? 'bg-accent text-white border-accent' : 'bg-surface border-line text-ink2')}
                          >
                            {t(`logbook.temporaryPresets.${preset}`)}
                          </button>
                        ))}
                      </div>
                      {temporaryNotePreset === 'custom' && (
                        <Input
                          type="number"
                          min={1}
                          value={customHours}
                          onChange={(e) => setCustomHours(Number(e.target.value))}
                          aria-label={t('logbook.customHoursLabel')}
                          className="w-28"
                        />
                      )}
                    </div>
                  )}
                </div>
                <div className="border-t border-line pt-3">
                  <label className="flex items-center justify-between gap-2 text-sm font-medium text-ink">
                    {t('logbook.requiresAcknowledgment')}
                    <input type="checkbox" checked={requiresAcknowledgment} disabled={priority !== 'important'} onChange={(e) => setRequiresAcknowledgment(e.target.checked)} className="h-4 w-4 rounded border-line" />
                  </label>
                  {priority !== 'important' && <p className="mt-1 text-xs text-ink3">{t('logbook.acknowledgmentImportantOnly')}</p>}
                  {requiresAcknowledgment && <Field label={t('logbook.whoMustAcknowledge')} hint={t('logbook.acknowledgmentStaffHint')}><select multiple value={acknowledgmentTargetIds} onChange={(event) => setAcknowledgmentTargetIds(Array.from(event.target.selectedOptions, (option) => option.value))} className="min-h-28 w-full rounded-[var(--r-md)] border border-line bg-surface px-3 py-2 text-sm text-ink">{staff.map((member) => <option key={member.user_id} value={member.user_id}>{member.full_name} · {member.role.replace('_', ' ')}</option>)}</select></Field>}
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-[var(--r-md)] border border-[var(--alert-line)] bg-[var(--alert-soft)] px-3 py-2.5">
              <AlertCircle size={14} className="mt-0.5 shrink-0 text-[var(--alert)]" aria-hidden="true" />
              <p role="alert" className="text-sm text-[var(--alert)]">{error}</p>
            </div>
          )}
        </form>

        <div className="flex gap-3 border-t border-line p-4">
          <Button type="button" variant="outline" onClick={onClose} className="flex-1">{t('common.cancel')}</Button>
          <Button variant="primary" loading={mutation.isPending} disabled={!content.trim()} onClick={() => formRef.current?.requestSubmit()} className="flex-1">
            {t('logbook.addHandoffSubmit')}
          </Button>
        </div>
      </div>
    </div>
  )
}
