'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, ExternalLink, Sparkles, X } from 'lucide-react'
import { format } from 'date-fns'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import type { LogbookRelatedType, ShiftHandoffData, ShiftSummary } from '@/lib/api/logbook'
import { Button, IconButton } from '@/components/ui/Button'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'
import { shiftHandoffSourceHref } from '@/lib/utils/logbookHandoff'

type DetailKey = 'tasks_completed' | 'open_work_orders' | 'guest_issues' | 'vip_arrivals' | 'low_stock_parts' | 'sla_breaches' | 'follow_ups'

interface ShiftHandoffDrawerProps {
  isOpen: boolean
  summary?: ShiftSummary
  shiftName: string
  nextShiftName?: string | null
  shiftDate: string
  isHistorical: boolean
  canGenerate: boolean
  canAcknowledge: boolean
  isGenerating: boolean
  isAcknowledging: boolean
  generationError?: Error | null
  onClose: () => void
  onGenerate: (regenerate?: boolean) => void
  onAcknowledge: () => void
  onOpenLogbookEntry: (id: string) => void
}

function displayDate(date: string, locale: string) {
  const [year, month, day] = date.split('-').map(Number)
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(year, month - 1, day))
}

function formatDateTime(value?: string | null) {
  return value ? format(new Date(value), 'MMM d · h:mm a') : null
}

function formatOverdue(minutes?: number | null): string | null {
  if (minutes === undefined || minutes === null) return null
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (hours && remainder) return `${hours}h ${remainder}m`
  return hours ? `${hours}h` : `${remainder}m`
}

function Section({ title, count, sectionKey, children }: { title: string; count?: number; sectionKey?: DetailKey; children: React.ReactNode }) {
  return <section id={sectionKey ? `handoff-${sectionKey}` : undefined} tabIndex={-1} className="scroll-mt-4 border-t border-line pt-5 outline-none">
    <div className="mb-3 flex items-center justify-between gap-3"><h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-ink3">{title}</h3>{typeof count === 'number' && <span className="font-mono text-xs tabular-nums text-ink3">{count}</span>}</div>
    {children}
  </section>
}

function EmptyDetail() {
  const { t } = useTranslation()
  return <p className="text-sm text-ink3">{t('logbook.unavailable')}</p>
}

export function ShiftHandoffDrawer({ isOpen, summary, shiftName, nextShiftName, shiftDate, isHistorical, canGenerate, canAcknowledge, isGenerating, isAcknowledging, generationError, onClose, onGenerate, onAcknowledge, onOpenLogbookEntry }: ShiftHandoffDrawerProps) {
  const { t, i18n } = useTranslation()
  const router = useRouter()
  const dialogRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [confirmRegenerate, setConfirmRegenerate] = useState(false)
  const [showAllTasks, setShowAllTasks] = useState(false)
  useModalFocusTrap(dialogRef, isOpen, onClose)

  useEffect(() => {
    if (!isGenerating) setConfirmRegenerate(false)
  }, [isGenerating])

  const data = (summary?.handoff_data ?? {}) as ShiftHandoffData
  const hasSnapshot = Object.keys(data).length > 0
  const stats = summary?.stats
  const metrics = useMemo(() => [
    { key: 'tasks_completed' as const, value: stats?.tasks_completed ?? 0, label: t('logbook.tasksCompleted') },
    { key: 'open_work_orders' as const, value: stats?.open_work_orders ?? 0, label: t('logbook.openWorkOrders') },
    { key: 'guest_issues' as const, value: stats?.pending_guest_issues_count ?? 0, label: t('logbook.pendingGuestIssues') },
    { key: 'vip_arrivals' as const, value: stats?.vip_arrivals_count ?? 0, label: t('logbook.vipArrivals') },
    { key: 'low_stock_parts' as const, value: stats?.low_stock_parts_count ?? 0, label: t('logbook.lowStockParts') },
    { key: 'sla_breaches' as const, value: stats?.sla_breaches_count ?? 0, label: t('logbook.slaBreaches') },
  ], [stats, t])

  if (!isOpen || typeof document === 'undefined') return null

  function focusSection(key: DetailKey) {
    const target = document.getElementById(`handoff-${key}`)
    if (!target || !scrollRef.current) return
    scrollRef.current.scrollTo({ top: Math.max(0, target.offsetTop - 18), behavior: 'smooth' })
    target.focus({ preventScroll: true })
  }

  function openSource(type: LogbookRelatedType | 'part', id: string) {
    onClose()
    router.push(shiftHandoffSourceHref(type, id))
  }

  const generatedAt = formatDateTime(summary?.generated_at)
  const canRegenerate = canGenerate && !isHistorical && !!summary
  const disabled = isGenerating || isAcknowledging

  return createPortal(
    <div className="fixed inset-0 z-[80] flex justify-end" aria-hidden={false}>
      <button type="button" aria-label={t('common.close')} className="absolute inset-0 bg-ink/35" onClick={onClose} />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="shift-handoff-title" className="relative flex h-full w-full max-w-[680px] flex-col bg-surface shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-5 sm:px-7">
          <div>
            <div className="flex items-center gap-2"><Sparkles className="size-4 text-ai" aria-hidden="true" /><h2 id="shift-handoff-title" className="text-lg font-semibold text-ink">{shiftName}{nextShiftName ? ` → ${nextShiftName}` : ''} {t('logbook.shiftHandoff')}</h2></div>
            <p className="mt-1.5 text-sm text-ink2">{displayDate(shiftDate, i18n.language)} · {shiftName}</p>
            {generatedAt && <p className="mt-1 text-xs text-ink3">{t('logbook.generated')} {generatedAt}</p>}
          </div>
          <IconButton variant="ghost" aria-label={t('common.close')} onClick={onClose}><X size={18} /></IconButton>
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-7">
          {generationError && <div role="alert" className="mb-5 rounded-[var(--r-md)] border border-alert-line bg-alert-soft p-3 text-sm text-alert">{t('logbook.unableToGenerateHandoff')} <Button variant="ghost" size="sm" onClick={() => onGenerate(false)} className="ml-1 px-1 text-alert">{t('logbook.tryAgain')}</Button></div>}
          {!summary ? (
            <div className="rounded-[var(--r-lg)] border border-ai-line bg-ai-soft/40 p-5">
              <Sparkles className="size-5 text-ai" aria-hidden="true" />
              <h3 className="mt-3 font-medium text-ink">{t('logbook.noHandoffGenerated')}</h3>
              <p className="mt-2 text-sm leading-6 text-ink2">{t('logbook.handoffGenerationDescription')}</p>
              {canGenerate ? <Button variant="ai" loading={isGenerating} onClick={() => onGenerate(false)} className="mt-4"><Sparkles className="size-4" />{t('logbook.generateHandoff')}</Button> : <p className="mt-4 text-sm text-ink3">{t('logbook.handoffNotAvailable')}</p>}
            </div>
          ) : (
            <div className="space-y-6">
              {isGenerating && <p role="status" className="rounded-[var(--r-md)] bg-ai-soft px-3 py-2 text-sm text-ai">{confirmRegenerate ? t('logbook.updatingHandoff') : t('logbook.generatingHandoff')}</p>}
              <Section title={t('logbook.shiftAtAGlance')}>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {metrics.map((metric) => {
                    const details = data[metric.key]
                    const interactive = Array.isArray(details) && details.length > 0
                    return <button key={metric.key} type="button" disabled={!interactive} onClick={() => focusSection(metric.key)} className="rounded-[var(--r-md)] border border-line bg-surface-2 px-3 py-3 text-left transition-colors enabled:hover:bg-ai-soft disabled:cursor-default disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ai/40">
                      <span className="block font-mono text-lg font-semibold tabular-nums text-ink">{metric.value}</span><span className="mt-0.5 block text-[11px] font-medium leading-4 text-ink3">{metric.label}</span>
                    </button>
                  })}
                </div>
              </Section>

              <Section title={t('logbook.aiHandoff')}><div className="space-y-3 text-sm leading-6 text-ink2">{summary.summary_text.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div></Section>

              <Section title={t('logbook.needsNextShift')} count={data.follow_ups?.length} sectionKey="follow_ups">
                {data.follow_ups?.length ? <div className="space-y-2">{data.follow_ups.map((item) => <div key={item.logbook_entry_id} className="rounded-[var(--r-md)] border border-line bg-surface-2 p-3"><p className="text-sm font-medium text-ink">{item.content}</p><p className="mt-1 text-xs text-ink3">{item.priority === 'important' ? t('logbook.priorities.important') : t('logbook.priorities.normal')}{item.follow_up_at ? ` · ${t('logbook.dueAt', { time: formatDateTime(item.follow_up_at) })}` : ''}</p><div className="mt-2 flex flex-wrap gap-3"><button type="button" onClick={() => { onClose(); onOpenLogbookEntry(item.logbook_entry_id) }} className="text-xs font-medium text-ai hover:underline">{t('logbook.open')}</button>{item.related_id && item.related_type && <button type="button" onClick={() => openSource(item.related_type as LogbookRelatedType, item.related_id!)} className="text-xs font-medium text-ai hover:underline">{t('logbook.openLinked', { label: t(`logbook.linkTypes.${item.related_type}`) })}</button>}</div></div>)}</div> : <EmptyDetail />}
              </Section>

              <Section title={t('logbook.openWorkOrders')} count={data.open_work_orders?.length} sectionKey="open_work_orders">{data.open_work_orders?.length ? <div className="space-y-2">{data.open_work_orders.map((item) => <div key={item.id} className="rounded-[var(--r-md)] border border-line p-3"><p className="text-sm font-medium text-ink">{item.title}</p><p className="mt-1 text-xs text-ink3">{item.room_number ? `${t('logbook.roomLinkTitle', { number: item.room_number })} · ` : ''}{item.status ?? t('logbook.unavailable')} · {item.priority ?? t('logbook.priorities.normal')}</p><button type="button" onClick={() => openSource('work_order', item.id)} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-ai hover:underline">{t('logbook.openWorkOrder')}<ExternalLink className="size-3" /></button></div>)}</div> : <EmptyDetail />}</Section>
              <Section title={t('logbook.pendingGuestIssues')} count={data.guest_issues?.length} sectionKey="guest_issues">{data.guest_issues?.length ? <div className="space-y-2">{data.guest_issues.map((item) => <div key={item.id} className="rounded-[var(--r-md)] border border-line p-3"><p className="text-sm font-medium text-ink">{item.room_number ? `${t('logbook.roomLinkTitle', { number: item.room_number })} · ` : ''}{item.title}</p><p className="mt-1 text-xs text-ink3">{item.status ?? t('logbook.unavailable')}</p><button type="button" onClick={() => openSource('guest_request', item.id)} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-ai hover:underline">{t('logbook.openGuestRequest')}<ExternalLink className="size-3" /></button></div>)}</div> : <EmptyDetail />}</Section>
              <Section title={t('logbook.slaBreaches')} count={data.sla_breaches?.length} sectionKey="sla_breaches">{data.sla_breaches?.length ? <div className="space-y-2">{data.sla_breaches.map((item) => <div key={`${item.type}-${item.id}`} className="rounded-[var(--r-md)] border border-alert-line bg-alert-soft/40 p-3"><p className="text-sm font-medium text-ink">{item.title}</p><p className="mt-1 text-xs text-ink3">{formatOverdue(item.overdue_minutes) ? t('logbook.overdueBy', { duration: formatOverdue(item.overdue_minutes) }) : t('logbook.overdue')}</p><button type="button" onClick={() => openSource(item.type, item.id)} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-alert hover:underline">{t('logbook.open')}<ExternalLink className="size-3" /></button></div>)}</div> : <EmptyDetail />}</Section>
              <Section title={t('logbook.vipArrivals')} count={data.vip_arrivals?.length} sectionKey="vip_arrivals">{data.vip_arrivals?.length ? <div className="space-y-2">{data.vip_arrivals.map((item) => <div key={item.room_id} className="flex items-center justify-between gap-3 rounded-[var(--r-md)] border border-line p-3"><div><p className="text-sm font-medium text-ink">{t('logbook.roomLinkTitle', { number: item.room_number })}</p><p className="mt-1 text-xs text-ink3">{t('logbook.vipPreparation')}</p></div><button type="button" onClick={() => openSource('room', item.room_id)} className="text-xs font-medium text-ai hover:underline">{t('logbook.openRoom')}</button></div>)}</div> : <EmptyDetail />}</Section>
              <Section title={t('logbook.lowStockParts')} count={data.low_stock_parts?.length} sectionKey="low_stock_parts">{data.low_stock_parts?.length ? <div className="space-y-2">{data.low_stock_parts.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-[var(--r-md)] border border-line p-3"><div><p className="text-sm font-medium text-ink">{item.name}</p><p className="mt-1 text-xs text-ink3">{item.quantity_on_hand} {t('logbook.onHand')} · {t('logbook.minimum')} {item.minimum_stock}</p></div><button type="button" onClick={() => openSource('part', item.id)} className="text-xs font-medium text-ai hover:underline">{t('logbook.openInventory')}</button></div>)}</div> : <EmptyDetail />}</Section>
              <Section title={t('logbook.tasksCompleted')} count={data.tasks_completed?.length} sectionKey="tasks_completed">{data.tasks_completed?.length ? <><div className="space-y-2">{(showAllTasks ? data.tasks_completed : data.tasks_completed.slice(0, 4)).map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-[var(--r-md)] border border-line p-3"><div><p className="text-sm font-medium text-ink">{item.title}</p><p className="mt-1 text-xs text-ink3">{item.task_type ?? t('logbook.general')}{item.completed_at ? ` · ${formatDateTime(item.completed_at)}` : ''}</p></div><button type="button" onClick={() => openSource('task', item.id)} className="text-xs font-medium text-ai hover:underline">{t('logbook.open')}</button></div>)}</div>{data.tasks_completed.length > 4 && <Button variant="ghost" size="sm" onClick={() => setShowAllTasks((value) => !value)} className="mt-2 px-0 text-ai">{showAllTasks ? t('logbook.showFewer') : t('logbook.viewAll', { count: data.tasks_completed.length })}<ChevronDown className="size-3.5" /></Button>}</> : <EmptyDetail />}</Section>
              {!hasSnapshot && <p className="text-xs text-ink3">{t('logbook.olderHandoffDetailUnavailable')}</p>}
              <p className="text-xs leading-5 text-ink3">{t('logbook.basedOn')} {t('logbook.entryCount_other', { count: stats?.logbook_entries_count ?? 0 })} · {stats?.tasks_completed ?? 0} {t('logbook.tasksCompleted')} · {stats?.open_work_orders ?? 0} {t('logbook.openWorkOrders')}</p>
            </div>
          )}
        </div>

        {summary && <footer className="border-t border-line bg-surface px-5 py-4 sm:px-7">
          {confirmRegenerate ? <div className="space-y-3"><p className="text-sm font-medium text-ink">{t('logbook.regenerateConfirmTitle')}</p><p className="text-sm text-ink2">{t('logbook.regenerateConfirmBody')}</p><div className="flex justify-end gap-2"><Button variant="ghost" size="sm" disabled={isGenerating} onClick={() => setConfirmRegenerate(false)}>{t('common.cancel')}</Button><Button variant="ai" size="sm" loading={isGenerating} onClick={() => onGenerate(true)}>{t('logbook.regenerate')}</Button></div></div> : <div className="flex flex-wrap items-center justify-between gap-3">{canRegenerate ? <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setConfirmRegenerate(true)}>{t('logbook.regenerate')}</Button> : <span />}{summary.acknowledged_at ? <span className="inline-flex items-center gap-1.5 text-sm text-ink3"><Check className="size-4 text-ready" aria-hidden="true" />{t('logbook.acknowledgedBy', { name: summary.acknowledged_by_name ?? t('logbook.acknowledgedFallback'), time: formatDateTime(summary.acknowledged_at) })}</span> : canAcknowledge ? <Button variant="outline" size="sm" disabled={disabled} loading={isAcknowledging} onClick={onAcknowledge}><Check className="size-4" />{t('logbook.acknowledgeHandoff')}</Button> : <span className="text-sm text-ink3">{t('logbook.notYetAcknowledged')}</span>}</div>}
        </footer>}
      </div>
    </div>,
    document.body,
  )
}
