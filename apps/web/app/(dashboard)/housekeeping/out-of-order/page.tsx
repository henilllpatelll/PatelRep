'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock3, Plus, Search } from 'lucide-react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { format, formatDistanceToNowStrict } from 'date-fns'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { StateBlock } from '@/components/ui/StateBlock'
import { useToast } from '@/components/ui/Toast'
import { roomsApi, roomUnavailabilityApi, type RoomUnavailabilityPeriod } from '@/lib/api/rooms'
import { useRole } from '@/lib/hooks/useRole'

function etaCopy(period: RoomUnavailabilityPeriod, t: ReturnType<typeof useTranslation>['t']) {
  if (!period.expected_return_at) return t('roomUnavailability.noEstimate')
  const eta = new Date(period.expected_return_at)
  if (period.is_past_eta) return t('roomUnavailability.pastEta', { duration: formatDistanceToNowStrict(eta) })
  return t('roomUnavailability.backAt', { time: format(eta, 'p') })
}

export default function OutOfOrderPage() {
  const { t } = useTranslation()
  const { role } = useRole()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'ACTIVE' | 'RELEASED'>('ACTIVE')
  const [query, setQuery] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [selected, setSelected] = useState<RoomUnavailabilityPeriod | null>(null)
  const [etaValue, setEtaValue] = useState('')
  const [etaNote, setEtaNote] = useState('')
  const [releaseNote, setReleaseNote] = useState('')
  const canManage = ['gm', 'housekeeping_supervisor', 'engineer'].includes(role ?? '')

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setShowCreate(false)
      setSelected(null)
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [])

  const periods = useQuery({ queryKey: ['room-unavailability', tab], queryFn: () => roomUnavailabilityApi.list(tab) })
  const summary = useQuery({ queryKey: ['room-unavailability-summary'], queryFn: roomUnavailabilityApi.summary })
  const rows = useMemo(() => (periods.data?.data ?? []).filter((period) => {
    const needle = query.trim().toLowerCase()
    return !needle || [period.rooms?.room_number, period.reason_label, period.work_orders?.title].some((value) => value?.toLowerCase().includes(needle))
  }), [periods.data, query])
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['room-unavailability'] })

  const etaMutation = useMutation({
    mutationFn: () => roomUnavailabilityApi.updateEta(selected!.id, new Date(etaValue).toISOString(), etaNote || undefined),
    onSuccess: () => { toast.success(t('roomUnavailability.etaUpdated')); setEtaValue(''); setEtaNote(''); refresh() },
    onError: () => toast.error(t('roomUnavailability.updateFailed')),
  })
  const releaseMutation = useMutation({
    mutationFn: () => roomUnavailabilityApi.release(selected!.id, releaseNote || undefined),
    onSuccess: () => { toast.success(t('roomUnavailability.released')); setReleaseNote(''); setSelected(null); refresh() },
    onError: () => toast.error(t('roomUnavailability.updateFailed')),
  })

  return <div className="space-y-5">
    <PageHeader title={t('roomUnavailability.title')} subtitle={t('roomUnavailability.subtitle')} dataI18nSkip actions={canManage ? <Button variant="primary" onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" />{t('roomUnavailability.place')}</Button> : undefined} />
    <div className="flex flex-wrap items-center gap-3 rounded-[var(--r-lg)] border border-line bg-surface px-4 py-3">
      <span className="text-sm text-ink2">{t('roomUnavailability.activeCount', { count: summary.data?.data.active ?? 0 })}</span>
      {(summary.data?.data.past_eta ?? 0) > 0 && <span className="inline-flex items-center gap-1 text-sm font-medium text-[var(--alert)]"><AlertTriangle className="h-4 w-4" />{t('roomUnavailability.pastEtaCount', { count: summary.data?.data.past_eta ?? 0 })}</span>}
      <Link href="/housekeeping" className="ml-auto inline-flex items-center gap-1 text-sm text-ink3 hover:text-ink"><ArrowLeft className="h-4 w-4" />{t('roomUnavailability.roomBoard')}</Link>
    </div>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex border-b border-line"><button className={`px-3 py-2 text-sm ${tab === 'ACTIVE' ? 'border-b-2 border-accent text-ink font-semibold' : 'text-ink3'}`} onClick={() => setTab('ACTIVE')}>{t('roomUnavailability.active')}</button><button className={`px-3 py-2 text-sm ${tab === 'RELEASED' ? 'border-b-2 border-accent text-ink font-semibold' : 'text-ink3'}`} onClick={() => setTab('RELEASED')}>{t('roomUnavailability.history')}</button></div>
      <label className="relative sm:ml-auto"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink3" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('roomUnavailability.search')} className="pl-9 sm:w-72" /></label>
    </div>
    {periods.isLoading ? <div className="space-y-2">{[1, 2, 3].map((id) => <Skeleton key={id} className="h-16" />)}</div> : periods.isError ? <StateBlock status="error" error={{ message: t('roomUnavailability.loadFailed'), onRetry: periods.refetch }} /> : rows.length === 0 ? <StateBlock status="empty" empty={{ title: t('roomUnavailability.empty') }} /> : <div className="overflow-hidden rounded-[var(--r-lg)] border border-line bg-surface">
      {rows.map((period) => <button key={period.id} onClick={() => setSelected(period)} className="grid w-full grid-cols-[minmax(4rem,.65fr)_minmax(7rem,1.2fr)_minmax(7rem,1fr)_minmax(8rem,1.2fr)] items-center gap-3 border-b border-line px-4 py-3 text-left last:border-0 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400">
        <span className="font-semibold text-ink">{period.rooms?.room_number ?? t('roomUnavailability.roomUnknown')}</span><span><span className="block text-sm text-ink">{period.reason_label}</span><span className="block truncate text-xs text-ink3">{period.work_orders?.title}</span></span><span className="text-xs text-ink3">{t('roomUnavailability.since', { duration: formatDistanceToNowStrict(new Date(period.started_at)) })}</span><span className={`text-sm ${period.is_past_eta ? 'text-[var(--alert)] font-medium' : 'text-ink2'}`}>{etaCopy(period, t)}</span>
      </button>)}
    </div>}
    {showCreate && <CreatePanel onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); refresh() }} />}
    {selected && <aside className="fixed inset-y-0 right-0 z-50 w-full max-w-lg overflow-y-auto border-l border-line bg-surface p-6 shadow-pop" aria-label={t('roomUnavailability.detailTitle')}>
      <div className="flex items-start justify-between gap-4"><div><p className="text-sm text-ink3">{t('roomUnavailability.outOfOrder')}</p><h2 className="font-display text-3xl text-ink">{t('roomUnavailability.roomNumber', { room: selected.rooms?.room_number ?? '—' })}</h2><p className="mt-2 text-sm text-ink2">{selected.reason_label}</p></div><Button variant="ghost" onClick={() => setSelected(null)}>{t('roomUnavailability.close')}</Button></div>
      <div className="mt-6 space-y-4 text-sm"><div><p className="text-ink3">{t('roomUnavailability.expectedReturn')}</p><p className={selected.is_past_eta ? 'font-medium text-[var(--alert)]' : 'text-ink'}>{etaCopy(selected, t)}</p></div><div><p className="text-ink3">{t('roomUnavailability.duration')}</p><p className="text-ink">{formatDistanceToNowStrict(new Date(selected.started_at))}</p></div>{selected.details && <div><p className="text-ink3">{t('roomUnavailability.details')}</p><p className="text-ink">{selected.details}</p></div>}</div>
      {canManage && selected.status === 'ACTIVE' && <div className="mt-8 space-y-5 border-t border-line pt-5"><div><label className="text-sm font-medium text-ink">{t('roomUnavailability.updateEta')}</label><Input type="datetime-local" value={etaValue} onChange={(event) => setEtaValue(event.target.value)} className="mt-2" /><Input value={etaNote} onChange={(event) => setEtaNote(event.target.value)} placeholder={t('roomUnavailability.etaReason')} className="mt-2" /><Button variant="outline" className="mt-2" disabled={!etaValue || etaMutation.isPending} onClick={() => etaMutation.mutate()}><Clock3 className="h-4 w-4" />{t('roomUnavailability.saveEta')}</Button></div><div><label className="text-sm font-medium text-ink">{t('roomUnavailability.returnToService')}</label><p className="mt-1 text-xs text-ink3">{t('roomUnavailability.returnHint')}</p><Input value={releaseNote} onChange={(event) => setReleaseNote(event.target.value)} placeholder={t('roomUnavailability.releaseNote')} className="mt-2" /><Button variant="primary" className="mt-2" disabled={releaseMutation.isPending} onClick={() => releaseMutation.mutate()}><CheckCircle2 className="h-4 w-4" />{t('roomUnavailability.returnToService')}</Button></div></div>}
    </aside>}
  </div>
}

function CreatePanel({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation(); const toast = useToast(); const queryClient = useQueryClient()
  const [roomId, setRoomId] = useState(''); const [reasonCode, setReasonCode] = useState(''); const [eta, setEta] = useState(''); const [details, setDetails] = useState('')
  const rooms = useQuery({ queryKey: ['rooms-picker'], queryFn: () => roomsApi.list() }); const reasons = useQuery({ queryKey: ['room-unavailability-reasons'], queryFn: roomUnavailabilityApi.reasons })
  const create = useMutation({ mutationFn: () => { const reason = reasons.data?.data.find((item) => item.code === reasonCode); return roomUnavailabilityApi.create({ room_id: roomId, reason_code: reasonCode, reason_label: reason?.label ?? reasonCode, expected_return_at: new Date(eta).toISOString(), details: details || undefined }) }, onSuccess: () => { toast.success(t('roomUnavailability.placed')); queryClient.invalidateQueries({ queryKey: ['room-unavailability'] }); onCreated() }, onError: () => toast.error(t('roomUnavailability.updateFailed')) })
  const submit = (event: FormEvent) => { event.preventDefault(); if (!roomId || !reasonCode || !eta) return; create.mutate() }
  return <div className="fixed inset-0 z-50 flex items-end bg-stone-900/30 p-4 sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-label={t('roomUnavailability.place')}><form onSubmit={submit} className="w-full max-w-xl rounded-[var(--r-lg)] bg-surface p-6 shadow-pop"><h2 className="font-display text-2xl text-ink">{t('roomUnavailability.place')}</h2><p className="mt-1 text-sm text-ink2">{t('roomUnavailability.placeHint')}</p><label className="mt-5 block text-sm font-medium text-ink">{t('roomUnavailability.room')}<select value={roomId} onChange={(event) => setRoomId(event.target.value)} className="mt-1 w-full rounded-[var(--r-md)] border border-line bg-surface p-2 text-ink"><option value="">{t('roomUnavailability.chooseRoom')}</option>{((rooms.data as any)?.data ?? []).map((room: any) => <option value={room.room_id} key={room.room_id}>{room.rooms?.room_number}</option>)}</select></label><label className="mt-4 block text-sm font-medium text-ink">{t('roomUnavailability.reason')}<select value={reasonCode} onChange={(event) => setReasonCode(event.target.value)} className="mt-1 w-full rounded-[var(--r-md)] border border-line bg-surface p-2 text-ink"><option value="">{t('roomUnavailability.chooseReason')}</option>{(reasons.data?.data ?? []).map((reason) => <option value={reason.code} key={reason.id}>{reason.label}</option>)}</select></label><label className="mt-4 block text-sm font-medium text-ink">{t('roomUnavailability.expectedReturn')}<Input required type="datetime-local" value={eta} onChange={(event) => setEta(event.target.value)} className="mt-1" /></label><label className="mt-4 block text-sm font-medium text-ink">{t('roomUnavailability.details')}<Input value={details} onChange={(event) => setDetails(event.target.value)} className="mt-1" /></label><p className="mt-4 text-xs text-ink3">{t('roomUnavailability.returnDirty')}</p><div className="mt-5 flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>{t('roomUnavailability.cancel')}</Button><Button type="submit" variant="primary" disabled={create.isPending}>{t('roomUnavailability.place')}</Button></div></form></div>
}
