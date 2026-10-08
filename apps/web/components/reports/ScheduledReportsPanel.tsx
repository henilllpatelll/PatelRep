'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { History, Pause, Pencil, Play, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { Pill } from '@/components/ui/primitives'
import { reportsV2Api } from '@/lib/reports/api'
import { VIEW_LABELS, type ReportView } from '@/lib/reports/filters'
import { formatDateTime, titleCase } from '@/lib/reports/format'
import type { DeliveryRow, ReportSchedule } from '@/lib/reports/types'
import { AvailabilityNotice, EmptyBlock, ErrorBlock, SectionSkeleton } from './ReportPrimitives'
import { ReportModal, primaryButton, secondaryButton } from './ReportModal'
import { ScheduleModal } from './ScheduleModal'
import { useReports } from './ReportsContext'

const DELIVERY_TONE = { sent: 'ready', failed: 'alert', not_configured: 'caution', skipped: 'neutral', queued: 'info', sending: 'info' } as const
const DELIVERY_TEXT: Record<DeliveryRow['status'], string> = {
  sent: 'Accepted by email provider',
  failed: 'Failed',
  not_configured: 'Not sent: delivery not configured',
  skipped: 'Skipped',
  queued: 'Queued',
  sending: 'Sending',
}

function DeliveryHistory({ schedule }: { schedule: ReportSchedule }) {
  const { hotelId } = useReports()
  const queryClient = useQueryClient()
  const history = useQuery({ queryKey: ['reports', hotelId, 'deliveries', schedule.id], queryFn: () => reportsV2Api.deliveries(schedule.id), enabled: !!hotelId })
  const retry = useMutation({
    mutationFn: (deliveryId: string) => reportsV2Api.retryDelivery(schedule.id, deliveryId),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['reports', hotelId, 'deliveries', schedule.id] })
      queryClient.invalidateQueries({ queryKey: ['reports', hotelId, 'schedules'] })
    },
  })
  if (history.isLoading) return <SectionSkeleton height="h-20" />
  if (history.isError) return <ErrorBlock message="Delivery history could not be loaded." onRetry={() => history.refetch()} />
  if (!history.data?.length) return <p className="py-2 text-[12.5px] text-ink3">No deliveries yet. The first one runs at the next scheduled time.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-[12.5px]">
        <caption className="sr-only">Delivery history for {schedule.name}</caption>
        <thead className="text-left text-ink3"><tr><th scope="col" className="py-1 pr-3">Scheduled</th><th scope="col" className="pr-3">Started</th><th scope="col" className="pr-3">Completed</th><th scope="col" className="pr-3">Status</th><th scope="col" className="pr-3">Recipients</th><th scope="col" /></tr></thead>
        <tbody>
          {history.data.map((d) => (
            <tr key={d.id} className="border-t border-line align-top">
              <td className="py-1.5 pr-3">{formatDateTime(d.scheduled_occurrence, schedule.timezone)}</td>
              <td className="pr-3">{formatDateTime(d.started_at, schedule.timezone)}</td>
              <td className="pr-3">{formatDateTime(d.completed_at, schedule.timezone)}</td>
              <td className="pr-3">
                <Pill tone={DELIVERY_TONE[d.status]} size="sm">{DELIVERY_TEXT[d.status]}</Pill>
                {d.error_summary && <span className="mt-0.5 block text-ink3">{d.error_summary}</span>}
                {d.next_retry_at && d.status === 'failed' && <span className="block text-ink3">Retry scheduled {formatDateTime(d.next_retry_at, schedule.timezone)}</span>}
              </td>
              <td className="pr-3">{d.recipient_count}</td>
              <td>
                {(d.status === 'failed' || d.status === 'not_configured') && (
                  <button type="button" disabled={retry.isPending} onClick={() => retry.mutate(d.id)} className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--accent)] hover:underline disabled:opacity-50">
                    <RotateCcw className="h-3 w-3" aria-hidden="true" /> Retry
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {retry.data && <p role="status" className="mt-1 text-[12px] text-ink3">Retry result: {titleCase(retry.data.status)}{retry.data.error_summary ? ` — ${retry.data.error_summary}` : ''}</p>}
    </div>
  )
}

export function ScheduledReportsPanel({ onClose }: { onClose: () => void }) {
  const { hotelId } = useReports()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<ReportSchedule | 'new' | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<ReportSchedule | null>(null)

  const schedules = useQuery({ queryKey: ['reports', hotelId, 'schedules'], queryFn: reportsV2Api.schedules, enabled: !!hotelId, retry: false })
  const status = useQuery({ queryKey: ['reports', hotelId, 'delivery-status'], queryFn: reportsV2Api.deliveryStatus, enabled: !!hotelId, staleTime: 60_000 })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['reports', hotelId, 'schedules'] })
  const toggle = useMutation({ mutationFn: (s: ReportSchedule) => reportsV2Api.updateSchedule(s.id, { enabled: !s.enabled }), onSuccess: refresh })
  const remove = useMutation({ mutationFn: (s: ReportSchedule) => reportsV2Api.deleteSchedule(s.id), onSuccess: () => { setConfirmDelete(null); refresh() } })

  if (editing) {
    return <ScheduleModal schedule={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={refresh} />
  }

  return (
    <>
      <ReportModal
        wide
        title="Scheduled reports"
        description="Reports emailed automatically in the hotel's local time."
        onClose={onClose}
        footer={
          <>
            <button type="button" className={secondaryButton} onClick={onClose}>Close</button>
            <button type="button" className={primaryButton} onClick={() => setEditing('new')}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />New schedule</button>
          </>
        }
      >
        {status.data && !status.data.configured && (
          <AvailabilityNotice availability="not_configured" reason={`Email delivery is not set up${status.data.missing.length ? `: an administrator must set ${status.data.missing.join(' and ')}` : ''}${status.data.blocked_reason ? `. ${status.data.blocked_reason}` : ''}. Schedules are saved, but nothing is emailed until then.`} />
        )}
        {schedules.isLoading ? (
          <SectionSkeleton height="h-40" />
        ) : schedules.isError ? (
          <ErrorBlock message="Scheduled reports could not be loaded." onRetry={() => schedules.refetch()} />
        ) : !schedules.data?.length ? (
          <EmptyBlock title="No scheduled reports yet" body="Create one to receive a report by email on a regular schedule." />
        ) : (
          <ul className="space-y-3">
            {schedules.data.map((s) => (
              <li key={s.id} className="rounded-[var(--r-lg)] border border-line bg-surface p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-ink">{s.name} <Pill tone={s.enabled ? 'ready' : 'neutral'} size="sm">{s.enabled ? 'Active' : 'Paused'}</Pill></p>
                    <p className="text-[12.5px] text-ink3">{VIEW_LABELS[s.report_type as ReportView] ?? titleCase(s.report_type)} · {s.output_format.toUpperCase()} · {s.description}</p>
                    <p className="text-[12.5px] text-ink3">Recipients: {s.recipients.map((r) => r.name).join(', ') || 'none'}</p>
                    <p className="text-[12.5px] text-ink3">
                      Next: {s.enabled ? formatDateTime(s.next_run_at, s.timezone) : 'paused'} · Last: {s.last_delivery ? `${DELIVERY_TEXT[s.last_delivery.status as DeliveryRow['status']] ?? titleCase(s.last_delivery.status)} (${formatDateTime(s.last_delivery.scheduled_occurrence, s.timezone)})` : 'not yet delivered'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button type="button" className={secondaryButton} onClick={() => setEditing(s)} aria-label={`Edit ${s.name}`}><Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Edit</button>
                    <button type="button" className={secondaryButton} disabled={toggle.isPending} onClick={() => toggle.mutate(s)} aria-label={`${s.enabled ? 'Pause' : 'Resume'} ${s.name}`}>
                      {s.enabled ? <Pause className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> : <Play className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}{s.enabled ? 'Pause' : 'Resume'}
                    </button>
                    <button type="button" className={secondaryButton} aria-expanded={expanded === s.id} onClick={() => setExpanded(expanded === s.id ? null : s.id)} aria-label={`Delivery history for ${s.name}`}><History className="mr-1 h-3.5 w-3.5" aria-hidden="true" />History</button>
                    <button type="button" className={secondaryButton} onClick={() => setConfirmDelete(s)} aria-label={`Delete ${s.name}`}><Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Delete</button>
                  </div>
                </div>
                {expanded === s.id && <div className="mt-3 border-t border-line pt-2"><DeliveryHistory schedule={s} /></div>}
              </li>
            ))}
          </ul>
        )}
        {(toggle.isError || remove.isError) && <p role="alert" className="text-[13px] text-[var(--alert)]">That change could not be saved. Please try again.</p>}
      </ReportModal>

      {confirmDelete && (
        <ReportModal
          title="Delete scheduled report?"
          description={`“${confirmDelete.name}” and its delivery history will be permanently removed. This cannot be undone.`}
          onClose={() => setConfirmDelete(null)}
          footer={
            <>
              <button type="button" className={secondaryButton} onClick={() => setConfirmDelete(null)}>Keep schedule</button>
              <button type="button" className="inline-flex min-h-9 items-center rounded-[var(--r-md)] bg-[var(--alert)] px-3.5 py-2 text-[13px] font-medium text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--alert)]/40 disabled:opacity-50" disabled={remove.isPending} onClick={() => remove.mutate(confirmDelete)}>
                {remove.isPending ? 'Deleting…' : 'Delete schedule'}
              </button>
            </>
          }
        >
          <p className="text-[13px] text-ink2">Recipients will stop receiving this report immediately.</p>
        </ReportModal>
      )}
    </>
  )
}
