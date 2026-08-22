'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { useHousekeepingStore } from '@/stores/housekeepingStore'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { getDisplayName } from '@/lib/utils/avatar'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'

export function AssignSaveBar() {
  const { t } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const {
    selectedDate,
    selectedShift,
    pendingAssignments,
    pendingAssignmentCleanTypes,
    clearPendingAssignments,
    setPendingAssignment,
  } = useHousekeepingStore()

  const stagedEntries = Object.entries(pendingAssignments).filter(([roomId, hkId]) => !!roomId && !!hkId)
  const stagedCount = stagedEntries.length
  if (stagedCount === 0) return null

  const staffCache: any = queryClient.getQueryData(['staff-list'])
  const nameById: Record<string, string> = (staffCache?.data?.staff ?? []).reduce(
    (acc: Record<string, string>, s: any) => { acc[s.user_id] = getDisplayName(s.full_name); return acc },
    {},
  )
  const distinctIds = Array.from(new Set(stagedEntries.map(([, hkId]) => hkId)))
  const summary =
    (stagedCount === 1
      ? t('housekeeping.page.saveBar.roomOne', { count: stagedCount })
      : t('housekeeping.page.saveBar.roomOther', { count: stagedCount }))
    + (distinctIds.length === 1
        ? t('housekeeping.page.saveBar.forName', { name: nameById[distinctIds[0]] ?? t('housekeeping.roomStatus.unknownHousekeeper') })
        : t('housekeeping.page.saveBar.acrossCount', { count: distinctIds.length }))
    + t('housekeeping.page.saveBar.nothingSaved')

  const handleDiscard = () => clearPendingAssignments()

  const handleSave = () => {
    const pendingSnapshot = { ...pendingAssignments }
    const cleanTypeSnapshot = { ...pendingAssignmentCleanTypes }
    const assignmentsPayload = stagedEntries.map(([roomId, housekeeperId]) => ({
      room_id: roomId,
      housekeeper_id: housekeeperId,
      ...(pendingAssignmentCleanTypes[roomId] ? { clean_type: pendingAssignmentCleanTypes[roomId] } : {}),
    }))

    const boardKey = ['housekeeping-board', selectedDate, selectedShift]
    const prevBoardData = queryClient.getQueryData(boardKey)
    queryClient.setQueryData(boardKey, (old: any) => {
      if (!old?.data) return old
      return {
        ...old,
        data: old.data.map((room: any) => {
          const housekeeperId = pendingSnapshot[room.room_id]
          if (!housekeeperId) return room
          return { ...room, assigned_to: housekeeperId, assignment_id: `optimistic-${room.room_id}` }
        }),
      }
    })

    clearPendingAssignments()

    housekeepingApi.saveAssignments({
      date: selectedDate,
      shift_id: null,
      assignments: assignmentsPayload,
      is_ai_suggested: false,
    }).then(() => {
      toast.success(t('housekeeping.page.assignBar.saved'))
      queryClient.invalidateQueries({ queryKey: ['housekeeping-board', selectedDate, selectedShift] })
      queryClient.invalidateQueries({ queryKey: ['housekeeping-assignments', selectedDate] })
      queryClient.invalidateQueries({ queryKey: ['staff-list'] })
    }).catch((err: any) => {
      queryClient.setQueryData(boardKey, prevBoardData)
      Object.entries(pendingSnapshot).forEach(([roomId, housekeeperId]) => {
        setPendingAssignment(roomId, housekeeperId, cleanTypeSnapshot[roomId as keyof typeof cleanTypeSnapshot])
      })
      toast.error(err?.message || t('housekeeping.page.assignBar.saveError'))
    })
  }

  return (
    <div
      data-testid="assign-save-bar"
      className="sticky bottom-4 z-20 mx-auto flex max-w-3xl items-center gap-3 rounded-[var(--r-lg)] bg-ink px-4 py-3 shadow-lg"
    >
      <span className="inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[8px] bg-white/10 text-white">
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <span className="text-[13.5px] text-paper">{summary}</span>
      <div className="flex-1" />
      <Button variant="ghost" size="sm" onClick={handleDiscard} className="text-paper hover:bg-white/10 hover:text-paper">
        {t('housekeeping.page.saveBar.discard')}
      </Button>
      <Button variant="primary" size="sm" onClick={handleSave} className="gap-2">
        {t('housekeeping.page.saveBar.save')}
        <span className="inline-flex items-center justify-center rounded-full bg-white/20 px-[6px] py-[1px] text-[11px] font-mono">
          {stagedCount}
        </span>
      </Button>
    </div>
  )
}
