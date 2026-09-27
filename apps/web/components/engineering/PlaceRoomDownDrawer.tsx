'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { roomUnavailabilityApi, roomsApi } from '@/lib/api/rooms'
import { Button } from '@/components/ui/Button'
import { EngineeringDrawer } from './EngineeringDrawer'

interface PlaceRoomDownDrawerProps { open: boolean; onClose: () => void }

/** Dedicated availability action; it deliberately does not create a work order. */
export function PlaceRoomDownDrawer({ open, onClose }: PlaceRoomDownDrawerProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [roomId, setRoomId] = useState('')
  const [type, setType] = useState<'OUT_OF_ORDER' | 'OUT_OF_SERVICE'>('OUT_OF_ORDER')
  const [reasonCode, setReasonCode] = useState('')
  const [eta, setEta] = useState('')
  const [details, setDetails] = useState('')
  const [validation, setValidation] = useState<string | null>(null)
  const rooms = useQuery({ queryKey: ['rooms-picker'], queryFn: () => roomsApi.list(), enabled: open, staleTime: 300_000 })
  const reasons = useQuery({ queryKey: ['room-unavailability-reasons'], queryFn: roomUnavailabilityApi.reasons, enabled: open, staleTime: 300_000 })

  useEffect(() => {
    if (!open) return
    setRoomId(''); setType('OUT_OF_ORDER'); setReasonCode(''); setEta(''); setDetails(''); setValidation(null)
  }, [open])

  const mutation = useMutation({
    mutationFn: () => {
      const reason = reasons.data?.data.find((item) => item.code === reasonCode)
      if (!reason) throw new Error('Choose a reason')
      return roomUnavailabilityApi.create({ room_id: roomId, type, reason_code: reason.code, reason_label: reason.label, expected_return_at: new Date(eta).toISOString(), details: details.trim() || undefined })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['room-unavailability'] })
      queryClient.invalidateQueries({ queryKey: ['rooms'] })
      onClose()
    },
  })

  const submit = () => {
    if (!roomId || !reasonCode || !eta) { setValidation(t('engineering.roomsDown.placeValidation')); return }
    setValidation(null); mutation.mutate()
  }
  const roomRows = (rooms.data as { data?: { room_id: string; rooms?: { room_number?: string; floor?: number } }[] } | undefined)?.data ?? []

  return <EngineeringDrawer open={open} title={t('engineering.roomsDown.placeRoomDown')} label={t('engineering.roomsDown.placeRoomDown')} closeLabel={t('engineering.roomsDown.closeDrawer')} onClose={onClose} footer={<div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>{t('common.cancel')}</Button><Button type="button" variant="primary" loading={mutation.isPending} onClick={submit}>{t('engineering.roomsDown.placeRoomDown')}</Button></div>}>
    <div className="space-y-4">
      <p className="text-sm text-ink2">{t('engineering.roomsDown.placeHint')}</p>
      <label className="block text-sm font-medium text-ink">{t('engineering.roomsDown.room')}<select value={roomId} onChange={(event) => setRoomId(event.target.value)} className="mt-2 min-h-10 w-full rounded-[var(--r-md)] border border-line bg-surface px-3 text-sm text-ink"><option value="">{t('engineering.roomsDown.chooseRoom')}</option>{roomRows.map((room) => <option key={room.room_id} value={room.room_id}>{room.rooms?.room_number}{room.rooms?.floor != null ? ` · ${t('engineering.roomsDown.floor', { floor: room.rooms.floor })}` : ''}</option>)}</select></label>
      <fieldset><legend className="text-sm font-medium text-ink">{t('engineering.roomsDown.availabilityType')}</legend><div className="mt-2 grid grid-cols-2 gap-2">{(['OUT_OF_ORDER', 'OUT_OF_SERVICE'] as const).map((value) => <button key={value} type="button" aria-pressed={type === value} onClick={() => setType(value)} className={`min-h-10 rounded-[var(--r-md)] border px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${type === value ? 'border-ink bg-ink text-paper' : 'border-line bg-surface text-ink2'}`}>{value === 'OUT_OF_ORDER' ? t('engineering.roomsDown.outOfOrder') : t('engineering.roomsDown.outOfService')}</button>)}</div></fieldset>
      <label className="block text-sm font-medium text-ink">{t('engineering.roomsDown.reason')}<select value={reasonCode} onChange={(event) => setReasonCode(event.target.value)} className="mt-2 min-h-10 w-full rounded-[var(--r-md)] border border-line bg-surface px-3 text-sm text-ink"><option value="">{t('engineering.roomsDown.chooseReason')}</option>{(reasons.data?.data ?? []).map((reason) => <option key={reason.id} value={reason.code}>{reason.label}</option>)}</select></label>
      <label className="block text-sm font-medium text-ink">{t('engineering.roomsDown.expectedReturn')}<input type="datetime-local" value={eta} onChange={(event) => setEta(event.target.value)} className="mt-2 min-h-10 w-full rounded-[var(--r-md)] border border-line bg-surface px-3 text-sm text-ink" /></label>
      <label className="block text-sm font-medium text-ink">{t('engineering.roomsDown.details')}<textarea value={details} onChange={(event) => setDetails(event.target.value)} rows={3} className="mt-2 w-full resize-none rounded-[var(--r-md)] border border-line bg-surface px-3 py-2 text-sm text-ink" /></label>
      {(validation || mutation.isError) && <p className="rounded-[var(--r-md)] border border-[var(--alert-line)] bg-[var(--alert-soft)] px-3 py-2 text-sm text-[var(--alert)]">{validation ?? t('engineering.roomsDown.actionError')}</p>}
    </div>
  </EngineeringDrawer>
}
