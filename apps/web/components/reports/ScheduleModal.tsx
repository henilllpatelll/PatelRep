'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock } from 'lucide-react'
import { reportsV2Api } from '@/lib/reports/api'
import { DEPARTMENT_LABELS, VIEW_LABELS, type ReportView } from '@/lib/reports/filters'
import { titleCase } from '@/lib/reports/format'
import type { ReportSchedule, ScheduleInput } from '@/lib/reports/types'
import { AvailabilityNotice } from './ReportPrimitives'
import { FieldLabel, ReportModal, field, primaryButton, secondaryButton } from './ReportModal'
import { useReports } from './ReportsContext'

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const WINDOWS = [
  ['previous_day', 'Previous completed day'],
  ['previous_7_days', 'Previous completed 7 days'],
  ['previous_month', 'Previous completed calendar month'],
] as const
const DEFAULT_WINDOW = { daily: 'previous_day', weekly: 'previous_7_days', monthly: 'previous_month' } as const

function formatInstant(iso: string, timeZone: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone, timeZoneName: 'short' })
  } catch {
    return iso
  }
}

export function ScheduleModal({ schedule, onClose, onSaved }: { schedule?: ReportSchedule; onClose: () => void; onSaved?: () => void }) {
  const { capabilities, view, hotelId, queryScope } = useReports()
  const queryClient = useQueryClient()
  const editing = !!schedule
  const views = (capabilities?.schedulable_views ?? []) as ReportView[]

  const [name, setName] = useState(schedule?.name ?? '')
  const [reportType, setReportType] = useState<string>(schedule?.report_type ?? view ?? views[0] ?? 'overview')
  const [frequency, setFrequency] = useState<string>(schedule?.frequency ?? 'weekly')
  const [dayOfWeek, setDayOfWeek] = useState<number>(schedule?.day_of_week ?? 0)
  const [dayOfMonth, setDayOfMonth] = useState<number>(schedule?.day_of_month ?? 1)
  const [localTime, setLocalTime] = useState(schedule?.local_time ?? '07:00')
  const [reportingWindow, setReportingWindow] = useState<string>(schedule?.reporting_window ?? DEFAULT_WINDOW.weekly)
  const [format, setFormat] = useState<'pdf' | 'csv'>(schedule?.output_format ?? 'pdf')
  const [recipientIds, setRecipientIds] = useState<string[]>(schedule?.recipients.map((r) => r.user_id) ?? [])
  const [department, setDepartment] = useState<string>(schedule?.department ?? '')
  const [includeDefinitions, setIncludeDefinitions] = useState(schedule?.include_definitions ?? true)
  const [saved, setSaved] = useState<ReportSchedule | null>(null)

  const departmentAware = ['overview', 'guest-experience', 'team'].includes(reportType) && (capabilities?.departments.length ?? 0) > 1
  const effectiveDepartment = departmentAware ? department : ''

  const status = useQuery({ queryKey: ['reports', hotelId, 'delivery-status'], queryFn: reportsV2Api.deliveryStatus, enabled: !!hotelId, staleTime: 60_000 })
  const recipients = useQuery({
    queryKey: [...queryScope, 'schedule-recipients', reportType, effectiveDepartment],
    queryFn: () => reportsV2Api.recipients(reportType, effectiveDepartment || undefined),
    enabled: !!hotelId,
    staleTime: 60_000,
  })

  // Recipients who stop being eligible after a report/department change are removed, never silently kept.
  useEffect(() => {
    if (!recipients.data) return
    const eligible = new Set(recipients.data.map((r) => r.user_id))
    setRecipientIds((ids) => ids.filter((id) => eligible.has(id)))
  }, [recipients.data])

  const body: ScheduleInput = useMemo(
    () => ({
      name: name.trim() || `${VIEW_LABELS[reportType as ReportView] ?? 'Report'} ${titleCase(frequency)}`,
      report_type: reportType,
      frequency,
      day_of_week: frequency === 'weekly' ? dayOfWeek : null,
      day_of_month: frequency === 'monthly' ? dayOfMonth : null,
      local_time: localTime,
      reporting_window: reportingWindow,
      output_format: format,
      recipient_ids: recipientIds,
      department: effectiveDepartment || null,
      include_definitions: includeDefinitions,
    }),
    [name, reportType, frequency, dayOfWeek, dayOfMonth, localTime, reportingWindow, format, recipientIds, effectiveDepartment, includeDefinitions],
  )

  const preview = useQuery({
    queryKey: ['reports', hotelId, 'schedule-preview', body],
    queryFn: () => reportsV2Api.previewSchedule(body),
    enabled: !!hotelId && /^([01]\d|2[0-3]):[0-5]\d$/.test(localTime) && !!reportType,
    staleTime: 30_000,
    retry: false,
  })

  const save = useMutation({
    mutationFn: () => (editing ? reportsV2Api.updateSchedule(schedule!.id, { ...body, enabled: schedule!.enabled }) : reportsV2Api.createSchedule(body)),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['reports', hotelId, 'schedules'] })
      setSaved(result)
      onSaved?.()
    },
  })

  const valid = recipientIds.length > 0 && /^([01]\d|2[0-3]):[0-5]\d$/.test(localTime)
  const deliveryOff = status.data && !status.data.configured

  if (saved?.id) {
    return (
      <ReportModal title={editing ? 'Schedule updated' : 'Schedule created'} onClose={onClose} footer={<button type="button" className={primaryButton} onClick={onClose}>Done</button>}>
        <p role="status" className="text-[13.5px] text-ink">
          “{saved.name}” was saved. {saved.description}. Next delivery: {saved.next_run_at ? formatInstant(saved.next_run_at, saved.timezone) : 'none (paused)'}.
        </p>
        {deliveryOff && <AvailabilityNotice availability="not_configured" reason="Email delivery is not configured for this environment, so nothing will be emailed until an administrator sets it up." />}
      </ReportModal>
    )
  }

  return (
    <ReportModal
      title={editing ? 'Edit Schedule' : 'Schedule Report'}
      description="Email a report automatically. Reports always cover the most recent completed period."
      onClose={onClose}
      footer={
        <>
          <button type="button" className={secondaryButton} onClick={onClose}>Cancel</button>
          <button type="button" className={primaryButton} disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            <CalendarClock className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create schedule'}
          </button>
        </>
      }
    >
      {deliveryOff && (
        <AvailabilityNotice
          availability="not_configured"
          reason={`Email delivery is not configured${status.data?.missing.length ? ` (missing ${status.data.missing.join(', ')})` : ''}${status.data?.blocked_reason ? `: ${status.data.blocked_reason}` : ''}. You can save the schedule, but nothing is emailed until it is.`}
        />
      )}
      <FieldLabel label="Name"><input className={field} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="e.g. Weekly maintenance review" /></FieldLabel>
      <div className="grid gap-3 sm:grid-cols-2">
        <FieldLabel label="Report type">
          <select className={field} value={reportType} disabled={editing} onChange={(e) => setReportType(e.target.value)}>
            {views.map((v) => <option key={v} value={v}>{VIEW_LABELS[v]}</option>)}
          </select>
        </FieldLabel>
        <FieldLabel label="Output format">
          <select className={field} value={format} onChange={(e) => setFormat(e.target.value as 'pdf' | 'csv')}>
            <option value="pdf">PDF</option>
            <option value="csv">CSV</option>
          </select>
        </FieldLabel>
        <FieldLabel label="Frequency">
          <select className={field} value={frequency} onChange={(e) => { setFrequency(e.target.value); setReportingWindow(DEFAULT_WINDOW[e.target.value as keyof typeof DEFAULT_WINDOW]) }}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </FieldLabel>
        {frequency === 'weekly' && (
          <FieldLabel label="Day of week">
            <select className={field} value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))}>{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
          </FieldLabel>
        )}
        {frequency === 'monthly' && (
          <FieldLabel label="Day of month" hint="1–28, so every month has the day.">
            <input type="number" min={1} max={28} className={field} value={dayOfMonth} onChange={(e) => setDayOfMonth(Math.min(28, Math.max(1, Number(e.target.value) || 1)))} />
          </FieldLabel>
        )}
        <FieldLabel label={`Delivery time (${preview.data?.timezone ?? 'hotel local time'})`}>
          <input type="time" className={field} value={localTime} onChange={(e) => setLocalTime(e.target.value)} />
        </FieldLabel>
        <FieldLabel label="Reporting window">
          <select className={field} value={reportingWindow} onChange={(e) => setReportingWindow(e.target.value)}>{WINDOWS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
        </FieldLabel>
        {departmentAware && (
          <FieldLabel label="Department">
            <select className={field} value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">All departments</option>
              {capabilities!.departments.map((d) => <option key={d} value={d}>{DEPARTMENT_LABELS[d] ?? titleCase(d)}</option>)}
            </select>
          </FieldLabel>
        )}
      </div>

      <fieldset>
        <legend className="text-[12.5px] font-medium text-ink2">Recipients</legend>
        <p className="mb-1 text-[12px] text-ink3">Only staff who are allowed to see this report can receive it. Eligibility is checked again at every delivery.</p>
        {recipients.isLoading ? (
          <p className="text-[13px] text-ink3">Loading staff…</p>
        ) : recipients.data?.length ? (
          <ul className="max-h-40 space-y-1 overflow-y-auto rounded-[var(--r-md)] border border-line p-2">
            {recipients.data.map((r) => (
              <li key={r.user_id}>
                <label className="flex items-center gap-2 text-[13px] text-ink2">
                  <input type="checkbox" className="accent-[var(--accent)]" checked={recipientIds.includes(r.user_id)} onChange={(e) => setRecipientIds((ids) => (e.target.checked ? [...ids, r.user_id] : ids.filter((id) => id !== r.user_id)))} />
                  {r.name} <span className="text-ink3">· {titleCase(r.role)}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-ink3">No eligible staff for this report.</p>
        )}
      </fieldset>

      <label className="flex items-center gap-2 text-[13px] text-ink2">
        <input type="checkbox" className="accent-[var(--accent)]" checked={includeDefinitions} onChange={(e) => setIncludeDefinitions(e.target.checked)} /> Include metric definitions
      </label>

      <section aria-label="Schedule preview" aria-live="polite" className="rounded-[var(--r-md)] border border-line bg-surface-2 p-3 text-[12.5px] text-ink2">
        <p className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-ink3">Preview</p>
        {preview.data ? (
          <ul className="space-y-0.5">
            <li><strong className="text-ink">{body.name}</strong> · {VIEW_LABELS[reportType as ReportView]} · {format.toUpperCase()}</li>
            <li>{preview.data.description}</li>
            <li>Next delivery: {formatInstant(preview.data.next_delivery, preview.data.timezone)}, then {formatInstant(preview.data.following_delivery, preview.data.timezone)}</li>
            <li>Covers {preview.data.reporting_window.start} to {preview.data.reporting_window.end} for the next delivery</li>
            <li>Recipients: {recipientIds.length ? `${recipientIds.length} selected` : 'none selected'}</li>
          </ul>
        ) : preview.isError ? (
          <p>The preview is unavailable for these settings.</p>
        ) : (
          <p>Calculating…</p>
        )}
      </section>
      {save.isError && <p role="alert" className="rounded-[var(--r-md)] border border-[var(--alert-line)] bg-[var(--alert-soft)] px-3 py-2 text-[13px] text-ink">{(save.error as Error)?.message || 'The schedule could not be saved.'}</p>}
    </ReportModal>
  )
}
