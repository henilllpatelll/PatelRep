'use client'

import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useHousekeepingStore } from '@/stores/housekeepingStore'
import { useHotelStore } from '@/stores/hotelStore'
import { isSectionRedesigned } from '@/lib/utils/redesignFlag'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { ApiClientError } from '@/lib/api/client'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'

export function AssignmentSidebar() {
  const { t } = useTranslation()
  const toast = useToast()
  const { selectedDate, selectedShift, rooms, buildingFilter } = useHousekeepingStore()
  const hotel = useHotelStore((s) => s.hotel)
  const v2 = isSectionRedesigned('housekeeping', hotel)
  const [aiLoading, setAiLoading] = useState(false)

  const scopedRooms = buildingFilter != null
    ? rooms.filter((room: any) => room.rooms?.building === buildingFilter)
    : rooms

  const unassignedCount = scopedRooms.filter((room: any) => !room.assigned_to).length
  const dirtyCount = scopedRooms.filter((room: any) => room.status === 'DIRTY' || room.status === 'PICKUP').length

  const handleAiAutoAssign = async () => {
    setAiLoading(true)
    try {
      const result = await housekeepingApi.aiSuggestAssignments(selectedDate, selectedShift ?? undefined)
      const suggestions = (result as any)?.data?.suggestions ?? []
      const roomCount = suggestions.reduce(
        (sum: number, s: any) => sum + (s.room_count ?? s.rooms?.length ?? 0),
        0,
      )

      if (roomCount === 0) {
        toast.info((result as any)?.data?.message || t('housekeeping.assignmentSidebar.noRoomsNeedWork'))
      } else {
        toast.success(
          roomCount === 1
            ? t('housekeeping.assignmentSidebar.successCountOne', { count: roomCount })
            : t('housekeeping.assignmentSidebar.successCountOther', { count: roomCount }),
        )
      }
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : t('housekeeping.assignmentSidebar.failure'))
    } finally {
      setAiLoading(false)
    }
  }

  return (
    <Card className="w-full shrink-0 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--r-md)] bg-[var(--ai-soft)] text-[var(--ai)]">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">{t('housekeeping.assignmentSidebar.title')}</h3>
          <p className="mt-0.5 text-xs text-ink3">
            {t('housekeeping.assignmentSidebar.subtitle')}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-[var(--r-md)] border border-line bg-surface-2 px-3 py-2">
          <p className={v2 ? 'text-xs text-ink3' : 'text-[11px] font-medium text-ink3'}>{t('housekeeping.assignmentSidebar.unassigned')}</p>
          <p className={v2 ? 'mt-1 font-mono text-xl font-semibold text-ink' : 'mt-1 font-mono text-lg font-semibold text-ink'}>{unassignedCount}</p>
        </div>
        <div className="rounded-[var(--r-md)] border border-line bg-surface-2 px-3 py-2">
          <p className={v2 ? 'text-xs text-ink3' : 'text-[11px] font-medium text-ink3'}>{t('housekeeping.assignmentSidebar.needsWork')}</p>
          <p className={v2 ? 'mt-1 font-mono text-xl font-semibold text-ink' : 'mt-1 font-mono text-lg font-semibold text-ink'}>{dirtyCount}</p>
        </div>
      </div>

      <Button
        variant="primary"
        onClick={handleAiAutoAssign}
        disabled={aiLoading || rooms.length === 0}
        className="mt-4 w-full"
      >
        {aiLoading ? (
          <>
            <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
            {t('housekeeping.assignmentSidebar.assigning')}
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            {t('housekeeping.assignmentSidebar.autoAssign')}
          </>
        )}
      </Button>
    </Card>
  )
}
