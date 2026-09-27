'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { RoomUnavailabilityPeriod } from '@/lib/api/rooms'
import { roomUnavailabilityApi } from '@/lib/api/rooms'
import { Button } from '@/components/ui/Button'
import { EngineeringDrawer } from './EngineeringDrawer'

type RoomDownAction = 'eta' | 'release'

interface RoomDownActionDrawerProps {
  action: RoomDownAction | null
  period: RoomUnavailabilityPeriod | null
  onClose: () => void
  onComplete?: () => void
}

/** Shared Engineering drawer for the existing ETA and return-to-service APIs. */
export function RoomDownActionDrawer({ action, period, onClose, onComplete }: RoomDownActionDrawerProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [eta, setEta] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!action) return
    setEta(period?.expected_return_at ? new Date(period.expected_return_at).toISOString().slice(0, 16) : '')
    setNote('')
  }, [action, period?.expected_return_at])

  const mutation = useMutation({
    mutationFn: async () => {
      if (!period || !action) throw new Error('No room-down record selected')
      if (action === 'eta') return roomUnavailabilityApi.updateEta(period.id, new Date(eta).toISOString(), note.trim() || undefined)
      return roomUnavailabilityApi.release(period.id, note.trim() || undefined)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['room-unavailability'] })
      queryClient.invalidateQueries({ queryKey: ['rooms'] })
      onComplete?.()
      onClose()
    },
  })

  const isEta = action === 'eta'
  const room = period?.rooms?.room_number ?? '—'
  return (
    <EngineeringDrawer
      open={!!action && !!period}
      title={isEta ? t('engineering.roomsDown.updateEtaTitle', { room }) : t('engineering.roomsDown.returnTitle', { room })}
      label={isEta ? t('engineering.roomsDown.updateEtaTitle', { room }) : t('engineering.roomsDown.returnTitle', { room })}
      closeLabel={t('engineering.roomsDown.closeDrawer')}
      onClose={onClose}
      footer={<div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>{t('common.cancel')}</Button><Button type="button" variant="primary" loading={mutation.isPending} disabled={isEta && !eta} onClick={() => mutation.mutate()}>{isEta ? t('engineering.roomsDown.saveEta') : t('engineering.roomsDown.returnToService')}</Button></div>}
    >
      <div className="space-y-5">
        {isEta ? <>
          <p className="text-sm leading-relaxed text-ink2">{t('engineering.roomsDown.updateEtaHint')}</p>
          <label className="block text-sm font-medium text-ink">{t('engineering.roomsDown.expectedReturn')}<input type="datetime-local" value={eta} onChange={(event) => setEta(event.target.value)} className="mt-2 min-h-10 w-full rounded-[var(--r-md)] border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40" /></label>
          <label className="block text-sm font-medium text-ink">{t('engineering.roomsDown.etaNote')}<textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} className="mt-2 w-full resize-none rounded-[var(--r-md)] border border-line bg-surface px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40" /></label>
        </> : <>
          <p className="text-sm leading-relaxed text-ink2">{t('engineering.roomsDown.returnHint')}</p>
          <label className="block text-sm font-medium text-ink">{t('engineering.roomsDown.releaseNote')}<textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} className="mt-2 w-full resize-none rounded-[var(--r-md)] border border-line bg-surface px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40" /></label>
        </>}
        {mutation.isError && <p className="rounded-[var(--r-md)] border border-[var(--alert-line)] bg-[var(--alert-soft)] px-3 py-2 text-sm text-[var(--alert)]">{t('engineering.roomsDown.actionError')}</p>}
      </div>
    </EngineeringDrawer>
  )
}
