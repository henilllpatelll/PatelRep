'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowUpRight, Clock3, Search, Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { hotelsApi } from '@/lib/api/hotels'
import { roomUnavailabilityApi, type RoomUnavailabilityPeriod } from '@/lib/api/rooms'
import { staffApi } from '@/lib/api/staff'
import { CreateWorkOrderDrawer } from '@/components/engineering/CreateWorkOrderDrawer'
import { EngineeringDrawer } from '@/components/engineering/EngineeringDrawer'
import { RoomDownActionDrawer } from '@/components/engineering/RoomDownActionDrawer'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { StateBlock } from '@/components/ui/StateBlock'
import { formatDowntime, formatMinutesAsDowntime, orderRoomDownPeriods, totalDowntimeMinutes } from '@/lib/utils/roomDownQueue'

type Mode = 'active' | 'returned'
type Filter = 'all' | 'past-eta' | 'emergency' | 'unassigned' | 'waiting'

interface RoomsDownTabProps {
  hotelId: string
  canManage: boolean
  initialRoomId: string | null
  onOpenWorkOrder: (workOrderId: string) => void
  onRequestPlaceRoomDown: () => void
}

function formatTime(value: string | null | undefined, language: string, includeDate = false): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat(language, includeDate ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

function ownerName(period: RoomUnavailabilityPeriod, staffNames: Map<string, string>): string | undefined {
  const id = period.owner_id ?? period.work_orders?.assigned_to
  return id ? staffNames.get(id) : undefined
}

function isUnassigned(period: RoomUnavailabilityPeriod): boolean {
  return !period.owner_id && !period.work_orders?.assigned_to
}

function isToday(value: string | null | undefined): boolean {
  if (!value) return false
  const now = new Date(); const date = new Date(value)
  return now.getFullYear() === date.getFullYear() && now.getMonth() === date.getMonth() && now.getDate() === date.getDate()
}

function QueueRow({ period, selected, staffNames, language, onSelect }: { period: RoomUnavailabilityPeriod; selected: boolean; staffNames: Map<string, string>; language: string; onSelect: () => void }) {
  const { t } = useTranslation()
  const downFor = formatDowntime(period.started_at)
  const owner = ownerName(period, staffNames)
  const workOrder = period.work_orders
  const status = period.status === 'RELEASED'
    ? t('engineering.roomsDown.returnedToService')
    : period.is_past_eta
      ? t('engineering.roomsDown.pastEtaBy', { duration: formatDowntime(period.expected_return_at ?? period.started_at) })
      : period.expected_return_at
        ? t('engineering.roomsDown.expectedReturn')
        : t('engineering.roomsDown.noEstimate')
  return <button type="button" onClick={onSelect} className={`w-full border-b border-line px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 ${selected ? 'bg-[var(--accent-soft)]' : 'bg-surface hover:bg-surface-2'}`}>
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-mono text-sm font-semibold text-ink">{t('engineering.roomsDown.room')} {period.rooms?.room_number ?? '—'}</p><p className="mt-0.5 truncate text-sm text-ink2">{period.reason_label}</p></div><span className={`shrink-0 rounded-[var(--r-sm)] border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${period.is_past_eta ? 'border-[var(--alert-line)] bg-[var(--alert-soft)] text-[var(--alert)]' : 'border-line bg-surface-2 text-ink3'}`}>{period.type === 'OUT_OF_ORDER' ? t('engineering.roomsDown.outOfOrder') : t('engineering.roomsDown.outOfService')}</span></div>
    <div className={`mt-2 text-xs font-medium ${period.is_past_eta ? 'text-[var(--alert)]' : 'text-ink3'}`}>{status}{period.status === 'ACTIVE' && period.expected_return_at && !period.is_past_eta && <span> · {formatTime(period.expected_return_at, language)}</span>}{period.status === 'RELEASED' && <span> · {formatTime(period.actual_return_at, language)}</span>}</div>
    <p className="mt-1 truncate text-xs text-ink3">{period.status === 'RELEASED' ? `${t('engineering.roomsDown.downFor', { duration: downFor })}` : `${owner ?? t('engineering.roomsDown.ownerUnassigned')}${workOrder ? ` · WO-${workOrder.work_order_number}` : ''}`}</p>
  </button>
}

function RoomDownDetail({ period, history, historyLoading, canManage, staffNames, language, onOpenWorkOrder, onCreateWorkOrder, onAction }: { period: RoomUnavailabilityPeriod; history: RoomUnavailabilityPeriod[]; historyLoading: boolean; canManage: boolean; staffNames: Map<string, string>; language: string; onOpenWorkOrder: (id: string) => void; onCreateWorkOrder: () => void; onAction: (action: 'eta' | 'release') => void }) {
  const { t } = useTranslation()
  const active = period.status === 'ACTIVE'
  const duration = formatDowntime(period.started_at)
  const expected = formatTime(period.expected_return_at, language, true)
  const actual = formatTime(period.actual_return_at, language, true)
  const workOrder = period.work_orders
  const repairOwner = ownerName(period, staffNames)
  const varianceMinutes = period.expected_return_at && period.actual_return_at ? Math.round((new Date(period.actual_return_at).getTime() - new Date(period.expected_return_at).getTime()) / 60_000) : null
  const context = [period.rooms?.floor != null ? t('engineering.roomsDown.floor', { floor: period.rooms.floor }) : null, period.rooms?.room_types?.name].filter(Boolean).join(' · ')

  return <article className="flex min-h-[32rem] flex-col bg-surface" aria-live="polite">
    <div className="border-b border-line px-5 py-5 sm:px-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-xs font-semibold uppercase tracking-[0.08em] text-ink3">{t('engineering.roomsDown.room')} {period.rooms?.room_number ?? '—'}</p><h2 className="mt-1 font-display text-3xl leading-none text-ink">{active ? (period.type === 'OUT_OF_ORDER' ? t('engineering.roomsDown.outOfOrder') : t('engineering.roomsDown.outOfService')) : t('engineering.roomsDown.returnedToService')}</h2><p className="mt-3 text-sm text-ink2">{period.reason_label}</p></div><p className="font-mono text-sm font-semibold text-ink2">{t('engineering.roomsDown.downFor', { duration })}</p></div></div>
    <div className="flex-1 space-y-6 px-5 py-5 sm:px-6">
      <section className={`rounded-[var(--r-md)] border p-4 ${period.is_past_eta ? 'border-[var(--alert-line)] bg-[var(--alert-soft)]' : 'border-line bg-surface-2'}`}><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink3">{t('engineering.roomsDown.expectedReturn')}</p><p className={`mt-1 text-lg font-semibold ${period.is_past_eta ? 'text-[var(--alert)]' : 'text-ink'}`}>{period.expected_return_at ? expected : t('engineering.roomsDown.noEstimate')}</p>{period.is_past_eta && <p className="mt-1 text-xs font-medium text-[var(--alert)]"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />{t('engineering.roomsDown.pastEtaBy', { duration: formatDowntime(period.expected_return_at ?? period.started_at) })}</p>}{active && canManage && <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => onAction('eta')}><Clock3 className="h-3.5 w-3.5" />{period.expected_return_at ? t('engineering.roomsDown.changeEta') : t('engineering.roomsDown.setEta')}</Button>}</section>
      <section><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink3">{t('engineering.roomsDown.primaryWorkOrder')}</p>{workOrder ? <div className="mt-2 rounded-[var(--r-md)] border border-line bg-surface-2 p-3"><div className="flex items-start justify-between gap-3"><div><p className="font-mono text-xs font-semibold text-ink">WO-{workOrder.work_order_number}</p><p className="mt-1 text-sm font-medium text-ink">{workOrder.title}</p><p className="mt-1 text-xs text-ink3">{workOrder.priority} · {workOrder.status}{repairOwner ? ` · ${repairOwner}` : ''}</p></div><Button type="button" size="sm" variant="ghost" aria-label={t('engineering.roomsDown.openWorkOrder')} onClick={() => onOpenWorkOrder(workOrder.id)}><ArrowUpRight className="h-4 w-4" /></Button></div></div> : <div className="mt-2 rounded-[var(--r-md)] border border-dashed border-line bg-surface-2 p-3"><p className="text-sm text-ink2">{t('engineering.roomsDown.noLinkedWorkOrder')}</p>{active && canManage && <Button type="button" size="sm" variant="outline" className="mt-3" onClick={onCreateWorkOrder}><Wrench className="h-3.5 w-3.5" />{t('engineering.roomsDown.createWorkOrder')}</Button>}</div>}</section>
      <section><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink3">{t('engineering.roomsDown.roomDowntime')}</p><dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm"><dt className="text-ink3">{t('engineering.roomsDown.started')}</dt><dd className="text-ink">{formatTime(period.started_at, language, true)}</dd><dt className="text-ink3">{t('engineering.roomsDown.downFor')}</dt><dd className="text-ink">{duration}</dd><dt className="text-ink3">{t('engineering.roomsDown.targetReturn')}</dt><dd className="text-ink">{expected}</dd>{!active && <><dt className="text-ink3">{t('engineering.roomsDown.actualReturn')}</dt><dd className="text-ink">{actual}</dd>{varianceMinutes != null && <><dt className="text-ink3">{t('engineering.roomsDown.expectedReturn')}</dt><dd className="text-ink">{varianceMinutes <= 0 ? t('engineering.roomsDown.targetVarianceEarly', { duration: formatMinutesAsDowntime(Math.abs(varianceMinutes)) }) : t('engineering.roomsDown.targetVarianceLate', { duration: formatMinutesAsDowntime(varianceMinutes) })}</dd></>}</>}</dl></section>
      <section><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink3">{t('engineering.roomsDown.reason')}</p><p className="mt-2 text-sm font-medium text-ink">{period.reason_label}</p>{period.details && <><p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink3">{t('engineering.roomsDown.details')}</p><p className="mt-1 text-sm leading-relaxed text-ink2">{period.details}</p></>}</section>
      {(context || repairOwner) && <section><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink3">{t('engineering.roomsDown.roomContext')}</p><p className="mt-2 text-sm text-ink">{[context, repairOwner ? `${t('engineering.roomsDown.repairOwner')}: ${repairOwner}` : null].filter(Boolean).join(' · ')}</p></section>}
      <section><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink3">{t('engineering.roomsDown.history')}</p>{historyLoading ? <p className="mt-2 text-sm text-ink3">{t('common.loading')}</p> : history.length ? <div className="mt-2 divide-y divide-line rounded-[var(--r-md)] border border-line">{history.slice(0, 5).map((event) => <div key={event.id} className="px-3 py-2.5 text-sm"><p className="font-medium text-ink">{formatTime(event.started_at, language, true)} · {event.reason_label}</p><p className="mt-0.5 text-xs text-ink3">{formatDowntime(event.started_at, new Date(event.actual_return_at ?? event.started_at))}{event.work_orders ? ` · WO-${event.work_orders.work_order_number}` : ''}</p></div>)}</div> : <p className="mt-2 text-sm text-ink3">{t('engineering.roomsDown.historyEmpty')}</p>}</section>
      {!active && period.release_notes && <section><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink3">{t('engineering.roomsDown.releaseNoteLabel')}</p><p className="mt-2 text-sm text-ink2">{period.release_notes}</p></section>}
    </div>
    {active && canManage && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-4 sm:px-6">{workOrder && <Button type="button" variant="outline" onClick={() => onOpenWorkOrder(workOrder.id)}>{t('engineering.roomsDown.openWorkOrder')}</Button>}<Button type="button" variant="primary" onClick={() => onAction('release')}>{t('engineering.roomsDown.returnToService')}</Button></footer>}
  </article>
}

export function RoomsDownTab({ hotelId, canManage, initialRoomId, onOpenWorkOrder, onRequestPlaceRoomDown }: RoomsDownTabProps) {
  const { t, i18n } = useTranslation()
  const [mode, setMode] = useState<Mode>('active')
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const [action, setAction] = useState<'eta' | 'release' | null>(null)
  const [showCreateWorkOrder, setShowCreateWorkOrder] = useState(false)
  const activeQ = useQuery({ queryKey: ['room-unavailability-active-list'], queryFn: () => roomUnavailabilityApi.list('ACTIVE'), refetchInterval: 60_000, staleTime: 30_000, enabled: !!hotelId })
  const returnedQ = useQuery({ queryKey: ['room-unavailability-returned-today'], queryFn: () => roomUnavailabilityApi.list('RELEASED', { returned_today: true }), refetchInterval: 60_000, staleTime: 30_000, enabled: !!hotelId })
  const staffQ = useQuery({ queryKey: ['staff-picker'], queryFn: () => staffApi.list(), staleTime: 300_000, enabled: !!hotelId })
  const hotelQ = useQuery({ queryKey: ['hotel', hotelId], queryFn: () => hotelsApi.get(hotelId), select: (response) => response.data, staleTime: 300_000, enabled: !!hotelId })
  const staffNames = useMemo(() => new Map((staffQ.data?.data.staff ?? []).map((staff) => [staff.user_id, staff.full_name])), [staffQ.data])
  const activePeriods = useMemo(() => orderRoomDownPeriods(activeQ.data?.data ?? []), [activeQ.data])
  const returnedPeriods = useMemo(() => [...(returnedQ.data?.data ?? [])].sort((a, b) => new Date(b.actual_return_at ?? b.started_at).getTime() - new Date(a.actual_return_at ?? a.started_at).getTime()), [returnedQ.data])
  const sourcePeriods = mode === 'active' ? activePeriods : returnedPeriods
  const visiblePeriods = useMemo(() => sourcePeriods.filter((period) => {
    const needle = search.trim().toLowerCase()
    if (needle && ![period.rooms?.room_number, period.reason_label, period.work_orders?.title, period.work_orders?.work_order_number].some((value) => String(value ?? '').toLowerCase().includes(needle))) return false
    if (filter === 'past-eta') return period.is_past_eta
    if (filter === 'emergency') return period.work_orders?.priority === 'emergency'
    if (filter === 'unassigned') return isUnassigned(period)
    if (filter === 'waiting') return period.work_orders?.status === 'on_hold'
    return true
  }), [filter, search, sourcePeriods])
  const selected = sourcePeriods.find((period) => period.id === selectedId) ?? null
  const historyQ = useQuery({ queryKey: ['room-unavailability-history', selected?.room_id], queryFn: () => roomUnavailabilityApi.list('RELEASED', { room_id: selected!.room_id }), enabled: !!selected?.room_id, staleTime: 60_000 })
  const downtimeMinutes = totalDowntimeMinutes(activePeriods)
  const adr = hotelQ.data?.average_daily_rate_cents
  const revenueCents = adr != null ? Math.round((downtimeMinutes / 60) * (adr / 24)) : null

  useEffect(() => { if (initialRoomId) { const match = activePeriods.find((period) => period.room_id === initialRoomId || period.id === initialRoomId); if (match) setSelectedId(match.id) } }, [activePeriods, initialRoomId])
  useEffect(() => { if (!selectedId || !sourcePeriods.some((period) => period.id === selectedId)) setSelectedId(sourcePeriods[0]?.id ?? null) }, [selectedId, sourcePeriods])
  useEffect(() => { const media = window.matchMedia('(max-width: 1023px)'); const sync = () => setMobileDetailOpen(false); media.addEventListener('change', sync); return () => media.removeEventListener('change', sync) }, [])

  const filters: { key: Filter; label: string }[] = [{ key: 'all', label: t('engineering.roomsDown.all') }, { key: 'past-eta', label: t('engineering.roomsDown.pastEta') }, { key: 'emergency', label: t('engineering.roomsDown.emergency') }, { key: 'unassigned', label: t('engineering.roomsDown.unassigned') }, { key: 'waiting', label: t('engineering.roomsDown.waiting') }]
  const choose = (period: RoomUnavailabilityPeriod) => { setSelectedId(period.id); if (window.matchMedia('(max-width: 1023px)').matches) setMobileDetailOpen(true) }
  const detailProps = selected ? { period: selected, history: (historyQ.data?.data ?? []).filter((event) => event.id !== selected.id), historyLoading: historyQ.isLoading, canManage, staffNames, language: i18n.language, onOpenWorkOrder, onCreateWorkOrder: () => setShowCreateWorkOrder(true), onAction: setAction } : null

  if (activeQ.isLoading && mode === 'active') return <StateBlock status="loading" />
  if (activeQ.isError || returnedQ.isError) return <StateBlock status="error" error={{ message: t('engineering.roomsDown.actionError'), onRetry: () => { activeQ.refetch(); returnedQ.refetch() } }} />

  return <div className="space-y-3">
    <div className="grid grid-cols-2 divide-x divide-y divide-line overflow-hidden rounded-[var(--r-md)] border border-line bg-surface sm:grid-cols-4 sm:divide-y-0">{[[activePeriods.length, t('engineering.roomsDown.roomsDownMetric'), 'text-ink'], [activePeriods.filter((period) => period.is_past_eta).length, t('engineering.roomsDown.pastEtaMetric'), activePeriods.some((period) => period.is_past_eta) ? 'text-[var(--alert)]' : 'text-ink'], [formatMinutesAsDowntime(downtimeMinutes), t('engineering.roomsDown.totalDowntime'), 'text-ink'], [revenueCents == null ? '—' : `~$${(revenueCents / 100).toLocaleString()}`, t('engineering.roomsDown.revenueImpact'), 'text-ink']].map(([value, label, tone]) => <div key={String(label)} className="flex items-baseline gap-1.5 px-3 py-2.5"><span className={`font-mono text-[15px] font-semibold ${tone}`}>{value}</span><span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-ink3">{label}</span></div>)}</div>
    <div className="flex flex-wrap items-center gap-2" aria-label={t('engineering.roomsDown.queueControls')}><div className="flex rounded-[var(--r-md)] border border-line bg-surface p-0.5"><button type="button" aria-pressed={mode === 'active'} onClick={() => { setMode('active'); setFilter('all') }} className={`min-h-8 rounded px-2.5 text-xs font-medium ${mode === 'active' ? 'bg-surface-3 text-ink' : 'text-ink3'}`}>{t('engineering.roomsDown.active')} {activePeriods.length}</button><button type="button" aria-pressed={mode === 'returned'} onClick={() => { setMode('returned'); setFilter('all') }} className={`min-h-8 rounded px-2.5 text-xs font-medium ${mode === 'returned' ? 'bg-surface-3 text-ink' : 'text-ink3'}`}>{t('engineering.roomsDown.returnedToday')} {returnedPeriods.length}</button></div><div className="order-3 flex w-full gap-1 overflow-x-auto pb-0.5 lg:order-none lg:w-auto">{filters.map((item) => <button key={item.key} type="button" aria-pressed={filter === item.key} onClick={() => setFilter(item.key)} className={`min-h-8 shrink-0 rounded-[var(--r-sm)] border px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${filter === item.key ? 'border-accent bg-[var(--accent-soft)] text-accent' : 'border-line bg-surface text-ink2 hover:bg-surface-2'}`}>{item.label}</button>)}</div><label className="relative min-w-[13rem] flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink3" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('engineering.roomsDown.search')} className="min-h-9 w-full rounded-[var(--r-md)] border border-line bg-surface px-3 pl-9 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40" /></label></div>
    {visiblePeriods.length === 0 ? <EmptyState icon={<Wrench className="h-5 w-5" />} title={mode === 'active' ? t('engineering.roomsDown.emptyTitle') : t('engineering.roomsDown.returnedEmptyTitle')} body={mode === 'active' ? t('engineering.roomsDown.emptyBody') : t('engineering.roomsDown.returnedEmptyBody')} action={mode === 'active' && canManage ? <Button type="button" variant="outline" onClick={onRequestPlaceRoomDown}>{t('engineering.roomsDown.placeRoomDown')}</Button> : undefined} /> : <div className="overflow-hidden rounded-[var(--r-lg)] border border-line bg-surface lg:grid lg:grid-cols-[minmax(19rem,38%)_1fr] lg:divide-x lg:divide-line"><aside className="max-h-[calc(100dvh-19rem)] overflow-y-auto" aria-label={t('engineering.roomsDown.roomsDown')}>{visiblePeriods.map((period) => <QueueRow key={period.id} period={period} selected={period.id === selected?.id} staffNames={staffNames} language={i18n.language} onSelect={() => choose(period)} />)}</aside><div className="hidden lg:block">{detailProps ? <RoomDownDetail {...detailProps} /> : <EmptyState title={t('engineering.roomsDown.selectRoom')} body={t('engineering.roomsDown.selectRoomHint')} />}</div></div>}
    {detailProps && <EngineeringDrawer open={mobileDetailOpen} title={`${t('engineering.roomsDown.room')} ${selected?.rooms?.room_number ?? '—'}`} label={`${t('engineering.roomsDown.room')} ${selected?.rooms?.room_number ?? '—'}`} closeLabel={t('engineering.roomsDown.closeDrawer')} onClose={() => setMobileDetailOpen(false)} width="wide"><div className="-mx-5 -my-5 sm:-mx-6"><RoomDownDetail {...detailProps} /></div></EngineeringDrawer>}
    <RoomDownActionDrawer action={action} period={selected} onClose={() => setAction(null)} />
    <CreateWorkOrderDrawer isOpen={showCreateWorkOrder} initialRoomId={selected?.room_id} onClose={() => setShowCreateWorkOrder(false)} onCreate={() => setShowCreateWorkOrder(false)} />
  </div>
}
