'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { X, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { guestRequestsApi } from '@/lib/api/guest_requests'
import { roomsApi, type RoomStatus } from '@/lib/api/rooms'
import { schedulingApi } from '@/lib/api/scheduling'
import { tasksApi, type CreateTaskData, type Priority, type TaskType } from '@/lib/api/tasks'
import type { StaffMember } from '@/lib/api/staff'
import { Button, IconButton } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'
import { useToast } from '@/components/ui/Toast'
import { getPriorityOptions, getTaskTypeOptions, taskTypeIcon } from './taskDisplay'
import { AssigneePicker } from './AssigneePicker'
import { RoomPicker } from './RoomPicker'
import { cn } from '@/lib/utils'
import {
  buildGuestRequestCreatePayload,
  buildTaskScheduleCreatePayload,
  CONTACT_PREFERENCE_VALUES,
  computeInternalDueAt,
  DEFAULT_RECURRENCE_DRAFT,
  endOfShiftDate,
  formatSlaDuration,
  GUEST_IMPACT_VALUES,
  GUEST_REQUEST_CATEGORY_VALUES,
  GUEST_REQUEST_PRIORITY_VALUES,
  guestPriorityForCategory,
  INTERNAL_SLA_MINUTES,
  isFutureDueAt,
  minutesFromNowAt,
  resolveGuestRequestSlaMinutes,
  sortAssigneesForGuestCategory,
  sortAssigneesForInternalType,
  validateRecurrenceDraft,
  type ContactPreference,
  type DueDatePreset,
  type GuestImpact,
  type GuestRequestCategory,
  type GuestRequestPriority,
  type LocationType,
  type RecurrenceDraft,
  type RecurrenceEndType,
  type RecurrenceIntervalType,
} from '@/lib/utils/taskCreation'

type Mode = 'internal' | 'guest'

const DUE_PRESET_ORDER: DueDatePreset[] = ['sla_default', '30m', '1h', '2h', 'end_of_shift', 'custom']
const RECURRENCE_INTERVALS: RecurrenceIntervalType[] = ['daily', 'weekly', 'monthly', 'custom']
const RECURRENCE_END_TYPES: RecurrenceEndType[] = ['never', 'count', 'date']

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

function ChipGroup<T extends string>({ options, value, onChange, disabled }: { options: Array<{ value: T; label: React.ReactNode }>; value: T; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium border transition-colors disabled:opacity-40',
            value === option.value ? 'bg-accent text-white border-accent' : 'bg-surface border-line text-ink2 hover:bg-surface-2',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function CreateTaskDrawer({
  isOpen, onClose, onCreateTask, onCreated, staff, canAssign, creating, initialMode, initialRoomId,
}: {
  isOpen: boolean
  onClose: () => void
  onCreateTask: (payload: CreateTaskData) => Promise<void>
  onCreated: () => void
  staff: StaffMember[]
  canAssign: boolean
  creating: boolean
  initialMode?: Mode
  initialRoomId?: string
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const ref = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [mode, setMode] = useState<Mode>(initialMode ?? 'internal')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)

  // Internal Task fields
  const [internalType, setInternalType] = useState<Exclude<TaskType, 'guest_request'>>('general')
  const [internalPriority, setInternalPriority] = useState<Priority>('normal')
  const [locationType, setLocationType] = useState<LocationType>('other')
  const [roomId, setRoomId] = useState('')
  const [locationText, setLocationText] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [duePreset, setDuePreset] = useState<DueDatePreset>('sla_default')
  const [customDueDate, setCustomDueDate] = useState(() => todayDateInput())
  const [customDueTime, setCustomDueTime] = useState(() => nowTimeInput())
  const [recurrence, setRecurrence] = useState<RecurrenceDraft>(DEFAULT_RECURRENCE_DRAFT)
  const [recurrenceStartDate, setRecurrenceStartDate] = useState(() => todayDateInput())

  // Guest Request fields
  const [guestRoomId, setGuestRoomId] = useState('')
  const [guestName, setGuestName] = useState('')
  const [guestNameTouched, setGuestNameTouched] = useState(false)
  const [guestCategory, setGuestCategory] = useState<GuestRequestCategory>('service')
  const [guestPriority, setGuestPriority] = useState<GuestRequestPriority>('normal')
  const [guestImpact, setGuestImpact] = useState<GuestImpact>('standard')
  const [contactPreference, setContactPreference] = useState<ContactPreference>('none')
  const [contactConsent, setContactConsent] = useState(false)
  const [guestAssignedTo, setGuestAssignedTo] = useState('')
  const [showGuestMore, setShowGuestMore] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())
  useModalFocusTrap(ref, isOpen, onClose)

  // Reset (and apply any prefill) every time the drawer opens — never leaks
  // stale values from a previous open, and never re-derives context from the DOM.
  // Also the one place "now" is captured (React purity: never call new Date() in render).
  useEffect(() => {
    if (!isOpen) return
    setNow(new Date())
    setMode(initialMode ?? 'internal')
    setTitle(''); setDescription(''); setTitleTouched(false)
    setInternalType('general'); setInternalPriority('normal')
    setLocationType(initialRoomId ? 'room' : 'other')
    setRoomId(initialRoomId ?? ''); setLocationText(''); setAssignedTo('')
    setDuePreset('sla_default'); setCustomDueDate(todayDateInput()); setCustomDueTime(nowTimeInput())
    setRecurrence(DEFAULT_RECURRENCE_DRAFT); setRecurrenceStartDate(todayDateInput())
    setGuestRoomId(initialRoomId ?? ''); setGuestName(''); setGuestNameTouched(false)
    setGuestCategory('service'); setGuestPriority('normal'); setGuestImpact('standard')
    setContactPreference('none'); setContactConsent(false); setGuestAssignedTo(''); setShowGuestMore(false)
    setError(null)
  }, [isOpen, initialMode, initialRoomId])

  const roomsQuery = useQuery({ queryKey: ['rooms-list-simple'], queryFn: () => roomsApi.list(), enabled: isOpen, staleTime: 60_000 })
  const rooms = useMemo(() => ((roomsQuery.data as { data?: RoomStatus[] } | undefined)?.data ?? []), [roomsQuery.data])

  const slaPoliciesQuery = useQuery({
    queryKey: ['guest-request-sla-policies'],
    queryFn: () => guestRequestsApi.listSlaPolicies(),
    enabled: isOpen && mode === 'guest',
    staleTime: 60_000,
  })
  const slaPolicies = slaPoliciesQuery.data?.data ?? []

  const today = todayDateInput()
  const myScheduleQuery = useQuery({
    queryKey: ['my-schedule-today', today],
    queryFn: () => schedulingApi.mySchedule({ date_from: today, date_to: today }),
    enabled: isOpen && mode === 'internal',
    staleTime: 5 * 60_000,
  })
  const todaysShiftEnd = myScheduleQuery.data?.data.find((a) => a.is_on_shift && a.shifts?.end_time)?.shifts?.end_time
  const endOfShiftAt = todaysShiftEnd ? endOfShiftDate(todaysShiftEnd, now) : null

  // Guest name suggestion from the selected room's current occupancy — only
  // while the user hasn't typed their own value.
  useEffect(() => {
    if (guestNameTouched || !guestRoomId) return
    const room = rooms.find((r) => r.room_id === guestRoomId)
    if (room?.guest_name) setGuestName(room.guest_name)
  }, [guestRoomId, rooms, guestNameTouched])

  // Accessibility requests must be urgent — the backend rejects anything else.
  useEffect(() => {
    setGuestPriority((p) => guestPriorityForCategory(guestCategory, p))
  }, [guestCategory])

  const staffForInternal = useMemo(() => sortAssigneesForInternalType(staff, internalType), [staff, internalType])
  const staffForGuest = useMemo(() => sortAssigneesForGuestCategory(staff, guestCategory), [staff, guestCategory])

  const internalSlaMinutes = INTERNAL_SLA_MINUTES[internalPriority]
  const availableDuePresets = DUE_PRESET_ORDER.filter((preset) => preset !== 'end_of_shift' || !!endOfShiftAt)
  const computedDueAt = computeInternalDueAt(duePreset, {
    now,
    endOfShiftAt,
    customIso: duePreset === 'custom' && customDueDate && customDueTime ? new Date(`${customDueDate}T${customDueTime}:00`).toISOString() : undefined,
  })
  const duePreviewDate = duePreset === 'sla_default'
    ? minutesFromNowAt(internalSlaMinutes, now)
    : computedDueAt ? new Date(computedDueAt) : null

  function formatDueSummary(date: Date): string {
    const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    const isToday = date.toDateString() === now.toDateString()
    return isToday
      ? t('tasks.createModal.dueTodayAt', { time })
      : t('tasks.createModal.dueOnAt', { date: date.toLocaleDateString([], { month: 'short', day: 'numeric' }), time })
  }

  const guestSlaMinutes = resolveGuestRequestSlaMinutes(slaPolicies, { category: guestCategory, priority: guestPriority, guestImpact })
  const guestDueAt = minutesFromNowAt(guestSlaMinutes, now)

  const createGuest = useMutation({
    mutationFn: () => guestRequestsApi.createRequest(buildGuestRequestCreatePayload({
      title, description, roomId: guestRoomId, guestName, priority: guestPriority, category: guestCategory,
      guestImpact, contactPreference, contactConsent, assignedTo: guestAssignedTo,
    })),
    onSuccess: () => { onCreated(); toast.success(t('tasks.toast.guestRequestCreated')); onClose() },
    onError: () => setError(t('tasks.workspace.createError')),
  })

  const createSchedule = useMutation({
    mutationFn: () => tasksApi.createSchedule(buildTaskScheduleCreatePayload(recurrence, {
      title, description, taskType: internalType, priority: internalPriority,
      roomId: locationType === 'room' ? roomId : '', locationText: locationType === 'other' ? locationText : '',
      assignedTo, startDate: recurrenceStartDate,
    })),
    onSuccess: () => { onCreated(); toast.success(t('tasks.toast.recurringScheduled')); onClose() },
    onError: () => setError(t('tasks.workspace.createError')),
  })

  const submitting = creating || createGuest.isPending || createSchedule.isPending

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setTitleTouched(true)
    if (!title.trim()) return
    setError(null)

    if (mode === 'guest') {
      createGuest.mutate()
      return
    }

    if (recurrence.enabled) {
      const recurrenceError = validateRecurrenceDraft(recurrence, recurrenceStartDate)
      if (recurrenceError) { setError(t(recurrenceError)); return }
      createSchedule.mutate()
      return
    }

    if (duePreset === 'custom' && computedDueAt && !isFutureDueAt(computedDueAt)) {
      setError(t('tasks.createModal.customDuePastError'))
      return
    }

    try {
      await onCreateTask({
        title: title.trim(),
        description: description.trim() || undefined,
        task_type: internalType,
        priority: internalPriority,
        room_id: locationType === 'room' ? (roomId || undefined) : undefined,
        location_text: locationType === 'other' ? (locationText.trim() || undefined) : undefined,
        assigned_to: assignedTo || undefined,
        due_at: computedDueAt,
      })
      onCreated()
      toast.success(t('tasks.toast.created'))
      onClose()
    } catch {
      setError(t('tasks.workspace.createError'))
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-drawer flex justify-end">
      <button aria-label={t('tasks.createModal.closeAria')} className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="task-create-title" className="relative flex h-full w-full max-w-[540px] flex-col border-l border-line bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.12em] text-ink3">{t('tasks.unified.eyebrow')}</p>
            <h2 id="task-create-title" className="text-lg font-semibold text-ink">{t('tasks.workspace.createTitle')}</h2>
          </div>
          <IconButton variant="ghost" size="sm" onClick={onClose} aria-label={t('tasks.createModal.closeAria')}><X size={18} /></IconButton>
        </div>

        <form ref={formRef} onSubmit={submit} className="flex-1 overflow-y-auto p-5 space-y-5">
          <div className="grid grid-cols-2 rounded-[var(--r-md)] bg-surface-2 p-1" role="group" aria-label={t('tasks.workspace.createTitle')}>
            <button type="button" onClick={() => setMode('internal')} aria-pressed={mode === 'internal'} className={cn('rounded px-3 py-2 text-sm font-medium transition-colors', mode === 'internal' ? 'bg-surface text-ink shadow-sm' : 'text-ink3')}>{t('tasks.unified.chooserInternalTitle')}</button>
            <button type="button" onClick={() => setMode('guest')} aria-pressed={mode === 'guest'} className={cn('rounded px-3 py-2 text-sm font-medium transition-colors', mode === 'guest' ? 'bg-surface text-ink shadow-sm' : 'text-ink3')}>{t('tasks.unified.chooserGuestTitle')}</button>
          </div>

          <Field label={t('tasks.workspace.whatLabel')} htmlFor="task-create-what">
            <Input id="task-create-what" autoFocus required value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => setTitleTouched(true)} placeholder={t('tasks.workspace.whatPlaceholder')} aria-invalid={titleTouched && !title.trim()} />
            {titleTouched && !title.trim() && <p className="mt-1 text-xs text-[var(--alert)]">{t('tasks.createModal.titleRequiredError')}</p>}
          </Field>

          {mode === 'internal' ? (
            <>
              <Field label={t('tasks.createModal.notesLabel')} htmlFor="task-create-description">
                <textarea id="task-create-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full resize-none rounded-[var(--r-md)] border border-line bg-surface px-3 py-2.5 text-sm text-ink" />
              </Field>

              <Field label={t('tasks.createModal.locationTypeLabel')}>
                <ChipGroup
                  options={[{ value: 'room' as LocationType, label: t('tasks.detail.room') }, { value: 'other' as LocationType, label: t('tasks.createModal.locationTypeOther') }]}
                  value={locationType}
                  onChange={setLocationType}
                />
              </Field>
              {locationType === 'room' ? (
                <RoomPicker id="task-create-room" rooms={rooms} value={roomId} onChange={setRoomId} noRoomLabel={t('tasks.workspace.noRoom')} />
              ) : (
                <Input id="task-create-location" value={locationText} onChange={(e) => setLocationText(e.target.value)} placeholder={t('tasks.createModal.locationPlaceholder')} aria-label={t('tasks.createModal.locationTypeOther')} />
              )}

              <Field label={t('tasks.createModal.typeLabel')}>
                <ChipGroup options={getTaskTypeOptions(t).map((o) => ({ value: o.value as Exclude<TaskType, 'guest_request'>, label: <>{taskTypeIcon(o.value)}{o.label}</> }))} value={internalType} onChange={setInternalType} />
              </Field>

              <Field label={t('tasks.createModal.priorityLabel')}>
                <div className="flex gap-2">
                  {getPriorityOptions(t).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setInternalPriority(option.value)}
                      aria-pressed={internalPriority === option.value}
                      className={cn(
                        'flex-1 rounded-[var(--r-md)] border py-2 text-[13px] font-semibold transition-colors',
                        internalPriority === option.value
                          ? option.value === 'urgent' ? 'bg-[var(--alert-soft)] border-[var(--alert)] text-[var(--alert)]' : 'bg-surface-3 border-ink3 text-ink'
                          : 'bg-surface border-line text-ink2 hover:bg-surface-2',
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label={t('tasks.createModal.dueLabel')}>
                <ChipGroup
                  options={availableDuePresets.map((preset) => ({ value: preset, label: t(`tasks.createModal.duePresets.${preset}`) }))}
                  value={duePreset}
                  onChange={setDuePreset}
                  disabled={recurrence.enabled}
                />
                {duePreset === 'custom' && !recurrence.enabled && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Input type="date" aria-label={t('tasks.createModal.customDueDateLabel')} value={customDueDate} onChange={(e) => setCustomDueDate(e.target.value)} min={todayDateInput()} />
                    <Input type="time" aria-label={t('tasks.createModal.customDueTimeLabel')} value={customDueTime} onChange={(e) => setCustomDueTime(e.target.value)} />
                  </div>
                )}
                <p className="mt-1.5 rounded-[var(--r-md)] bg-surface-2 px-3 py-2 text-xs text-ink3">
                  {t('tasks.createModal.slaHint', { duration: formatSlaDuration(internalSlaMinutes) })}
                  {!recurrence.enabled && duePreviewDate && <> · {t('tasks.createModal.dueSummary', { when: formatDueSummary(duePreviewDate) })}</>}
                  {recurrence.enabled && <> · {t('tasks.createModal.recurrence.dueNote')}</>}
                </p>
              </Field>

              {canAssign && (
                <Field label={t('tasks.workspace.assignLabel')} htmlFor="task-create-assign">
                  <AssigneePicker id="task-create-assign" staff={staffForInternal} value={assignedTo} onChange={setAssignedTo} unassignedLabel={internalType === 'housekeeping' ? t('tasks.createModal.unassignedHousekeeping') : t('tasks.createModal.unassigned')} />
                </Field>
              )}

              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-ink">
                  <input type="checkbox" checked={recurrence.enabled} onChange={(e) => setRecurrence((r) => ({ ...r, enabled: e.target.checked }))} className="h-4 w-4 rounded border-line" />
                  {t('tasks.createModal.recurrence.checkboxLabel')}
                </label>
                {recurrence.enabled && (
                  <div className="mt-3 space-y-3 rounded-[var(--r-md)] border border-line bg-surface-2 p-3">
                    <div className="grid grid-cols-2 gap-2">
                      <Field label={t('tasks.createModal.recurrence.repeatLabel')} htmlFor="task-create-recur-interval">
                        <div className="relative">
                          <select id="task-create-recur-interval" value={recurrence.intervalType} onChange={(e) => setRecurrence((r) => ({ ...r, intervalType: e.target.value as RecurrenceIntervalType }))} className="w-full appearance-none rounded-[var(--r-md)] border border-line bg-surface px-3 py-2 pr-8 text-sm text-ink">
                            {RECURRENCE_INTERVALS.map((interval) => <option key={interval} value={interval}>{t(`tasks.createModal.recurrence.intervals.${interval}`)}</option>)}
                          </select>
                          <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink4" />
                        </div>
                      </Field>
                      {recurrence.intervalType === 'custom' && (
                        <Field label={t('tasks.createModal.recurrence.intervalDaysLabel')} htmlFor="task-create-recur-days">
                          <Input id="task-create-recur-days" type="number" min={1} value={recurrence.intervalDays} onChange={(e) => setRecurrence((r) => ({ ...r, intervalDays: e.target.value }))} />
                        </Field>
                      )}
                    </div>
                    <Field label={t('tasks.createModal.recurrence.startLabel')} htmlFor="task-create-recur-start">
                      <Input id="task-create-recur-start" type="date" value={recurrenceStartDate} min={todayDateInput()} onChange={(e) => setRecurrenceStartDate(e.target.value)} />
                    </Field>
                    <div>
                      <p className="mb-1.5 text-sm font-medium text-ink">{t('tasks.createModal.recurrence.endLabel')}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {RECURRENCE_END_TYPES.map((endType) => (
                          <button key={endType} type="button" aria-pressed={recurrence.endType === endType} onClick={() => setRecurrence((r) => ({ ...r, endType }))} className={cn('rounded-full border px-3 py-1.5 text-[12.5px] font-medium', recurrence.endType === endType ? 'bg-accent text-white border-accent' : 'bg-surface border-line text-ink2')}>
                            {t(`tasks.createModal.recurrence.endTypes.${endType}`)}
                          </button>
                        ))}
                      </div>
                      {recurrence.endType === 'count' && (
                        <Input type="number" min={1} className="mt-2" aria-label={t('tasks.createModal.recurrence.endCountLabel')} value={recurrence.endCount} onChange={(e) => setRecurrence((r) => ({ ...r, endCount: e.target.value }))} />
                      )}
                      {recurrence.endType === 'date' && (
                        <Input type="date" className="mt-2" aria-label={t('tasks.createModal.recurrence.endDateLabel')} value={recurrence.endDate} min={recurrenceStartDate} onChange={(e) => setRecurrence((r) => ({ ...r, endDate: e.target.value }))} />
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <Field label={t('tasks.detail.room')} htmlFor="task-create-guest-room" hint={t('tasks.createModal.roomRequiredHint')}>
                <RoomPicker id="task-create-guest-room" rooms={rooms} value={guestRoomId} onChange={setGuestRoomId} noRoomLabel={t('tasks.workspace.noRoom')} />
              </Field>

              <Field label={t('tasks.workspace.categoryLabel')}>
                <ChipGroup
                  options={GUEST_REQUEST_CATEGORY_VALUES.map((category) => ({ value: category, label: <>{taskTypeIcon(category === 'maintenance' ? 'engineering' : category === 'other' ? 'general' : category)}{t(`tasks.guestCategories.${category}`)}</> }))}
                  value={guestCategory}
                  onChange={setGuestCategory}
                />
              </Field>

              <Field label={t('tasks.createModal.priorityLabel')}>
                <div className="flex gap-2">
                  {GUEST_REQUEST_PRIORITY_VALUES.map((priority) => (
                    <button
                      key={priority}
                      type="button"
                      disabled={guestCategory === 'accessibility'}
                      onClick={() => setGuestPriority(priority)}
                      aria-pressed={guestPriority === priority}
                      className={cn(
                        'flex-1 rounded-[var(--r-md)] border py-2 text-[13px] font-semibold transition-colors disabled:opacity-40',
                        guestPriority === priority
                          ? priority === 'urgent' ? 'bg-[var(--alert-soft)] border-[var(--alert)] text-[var(--alert)]' : 'bg-surface-3 border-ink3 text-ink'
                          : 'bg-surface border-line text-ink2 hover:bg-surface-2',
                      )}
                    >
                      {t(`tasks.priorities.${priority}`)}
                    </button>
                  ))}
                </div>
                {guestCategory === 'accessibility' && <p className="mt-1 text-xs text-ink3">{t('tasks.createModal.accessibilityForcesUrgent')}</p>}
              </Field>

              <Field label={t('tasks.createModal.guestFields.guestImpactLabel')}>
                <ChipGroup options={GUEST_IMPACT_VALUES.map((impact) => ({ value: impact, label: t(`tasks.createModal.guestImpact.${impact}`) }))} value={guestImpact} onChange={setGuestImpact} />
              </Field>

              <p className="rounded-[var(--r-md)] bg-surface-2 px-3 py-2 text-xs text-ink3">
                {t('tasks.createModal.guestFields.slaTargetLabel')}: {formatSlaDuration(guestSlaMinutes)} · {t('tasks.createModal.dueSummary', { when: formatDueSummary(guestDueAt) })}
              </p>

              <Field label={t('tasks.createModal.notesLabel')} htmlFor="task-create-guest-description">
                <textarea id="task-create-guest-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full resize-none rounded-[var(--r-md)] border border-line bg-surface px-3 py-2.5 text-sm text-ink" />
              </Field>

              {!showGuestMore ? (
                <button type="button" onClick={() => setShowGuestMore(true)} className="text-sm font-medium text-accent">{t('tasks.createModal.showMoreOptions')}</button>
              ) : (
                <div className="space-y-4 rounded-[var(--r-md)] border border-line bg-surface-2 p-3">
                  <button type="button" onClick={() => setShowGuestMore(false)} className="text-xs font-medium text-accent">{t('tasks.createModal.hideMoreOptions')}</button>

                  <Field label={t('tasks.createModal.guestFields.guestNameLabel')} htmlFor="task-create-guest-name">
                    <Input id="task-create-guest-name" value={guestName} onChange={(e) => { setGuestName(e.target.value); setGuestNameTouched(true) }} placeholder={t('tasks.createModal.guestFields.guestNamePlaceholder')} />
                  </Field>

                  <Field label={t('tasks.createModal.guestFields.contactPreferenceLabel')}>
                    <ChipGroup options={CONTACT_PREFERENCE_VALUES.map((pref) => ({ value: pref, label: t(`tasks.createModal.contactPreferences.${pref}`) }))} value={contactPreference} onChange={setContactPreference} />
                  </Field>
                  {contactPreference !== 'none' && (
                    <label className="flex items-center gap-2 text-sm text-ink2">
                      <input type="checkbox" checked={contactConsent} onChange={(e) => setContactConsent(e.target.checked)} className="h-4 w-4 rounded border-line" />
                      {t('tasks.createModal.guestFields.contactConsentLabel')}
                    </label>
                  )}

                  {canAssign && (
                    <Field label={t('tasks.workspace.assignLabel')} htmlFor="task-create-guest-assign">
                      <AssigneePicker id="task-create-guest-assign" staff={staffForGuest} value={guestAssignedTo} onChange={setGuestAssignedTo} unassignedLabel={t('tasks.createModal.unassigned')} />
                    </Field>
                  )}
                </div>
              )}
            </>
          )}

          {error && <p role="alert" className="text-sm text-[var(--alert)]">{error}</p>}
        </form>

        <div className="flex gap-3 border-t border-line p-4">
          <Button variant="outline" onClick={onClose} className="flex-1">{t('common.cancel')}</Button>
          <Button variant="primary" loading={submitting} disabled={!title.trim()} onClick={() => formRef.current?.requestSubmit()} className="flex-1">
            {mode === 'guest' ? t('tasks.createModal.createGuestRequest') : recurrence.enabled ? t('tasks.createModal.createRecurring') : t('tasks.createModal.create')}
          </Button>
        </div>
      </div>
    </div>
  )
}
