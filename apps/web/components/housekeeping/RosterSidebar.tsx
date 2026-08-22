'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useHousekeepingStore } from '@/stores/housekeepingStore'
import { staffApi } from '@/lib/api/staff'
import { getInitials, getDisplayName } from '@/lib/utils/avatar'
import { CLEAN_TYPE_CREDITS, getCleanTypeCredits, isOpenHousekeepingRoom } from '@/lib/utils/cleanType'
import { Skeleton } from '@/components/ui/Skeleton'
import { StateBlock } from '@/components/ui/StateBlock'
import { Button } from '@/components/ui/Button'

/** Static default — no per-hotel setting exists for this yet (see credit weights note). */
const DEFAULT_TARGET_CREDITS = 16

interface HkLoad {
  id: string
  name: string
  rooms: number
  credits: number
  stagedRooms: number
  stagedCredits: number
  savedCredits: number
}

export function RosterSidebar({ v2 }: { v2: boolean }) {
  const { t } = useTranslation()
  const {
    rooms,
    buildingFilter,
    activeAssigneeId,
    setActiveAssignee,
    pendingAssignments,
    pendingAssignmentCleanTypes,
    assignFilter,
    setAssignFilter,
  } = useHousekeepingStore()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['staff-list'],
    queryFn: () => staffApi.list(),
  })

  const housekeepers: { id: string; name: string }[] = (data?.data?.staff ?? [])
    .filter((s: any) => s.role === 'housekeeper' || s.role === 'housekeeping_supervisor')
    .map((s: any) => ({ id: s.user_id, name: getDisplayName(s.full_name) }))

  const scopedRooms = buildingFilter != null
    ? rooms.filter((room: any) => room.rooms?.building === buildingFilter)
    : rooms
  const openRooms = scopedRooms.filter(isOpenHousekeepingRoom)

  const cleanTypeOf = (room: any) => pendingAssignmentCleanTypes[room.room_id] ?? room.clean_type
  const ownerOf = (room: any) => pendingAssignments[room.room_id] ?? room.assigned_to ?? null

  const load = useMemo(() => {
    const byId: Record<string, HkLoad> = {}
    for (const hk of housekeepers) {
      byId[hk.id] = { id: hk.id, name: hk.name, rooms: 0, credits: 0, stagedRooms: 0, stagedCredits: 0, savedCredits: 0 }
    }
    let unassignedRooms = 0
    let unassignedCredits = 0
    for (const room of openRooms) {
      const owner = ownerOf(room)
      const credits = getCleanTypeCredits(cleanTypeOf(room))
      if (!owner) {
        unassignedRooms++
        unassignedCredits += credits
        continue
      }
      const entry = byId[owner]
      if (!entry) continue
      entry.rooms++
      entry.credits += credits
      if (pendingAssignments[room.room_id]) {
        entry.stagedRooms++
        entry.stagedCredits += credits
      } else {
        entry.savedCredits += credits
      }
    }
    return { byId, unassignedRooms, unassignedCredits }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [housekeepers, openRooms, pendingAssignments, pendingAssignmentCleanTypes])

  return (
    <div data-testid="hk-bar" className="rounded-[var(--r-lg)] bg-surface border border-line shadow-sm overflow-hidden">
      <div className="flex items-baseline gap-2 px-3.5 pt-3 pb-2.5 border-b border-line-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink4">
          {t('housekeeping.rosterSidebar.title')}
        </p>
        <div className="flex-1" />
        <span className="font-mono text-[11px] text-ink3">
          {t('housekeeping.rosterSidebar.target', { count: DEFAULT_TARGET_CREDITS })}
        </span>
      </div>

      <div className="p-1.5">
        {isLoading ? (
          <div className="space-y-2 p-1.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : v2 && isError ? (
          <StateBlock
            status="error"
            error={{ message: t('housekeeping.page.assignBar.loadError'), onRetry: refetch }}
          />
        ) : housekeepers.length === 0 ? (
          <p className="p-2.5 text-xs text-ink3">
            {t('housekeeping.page.assignBar.noStaff')}{' '}
            <Link href="/staff" prefetch={false} className="text-accent underline">{t('housekeeping.page.assignBar.addStaff')}</Link>
          </p>
        ) : (
          housekeepers.map((hk) => {
            const entry = load.byId[hk.id]
            const isActive = activeAssigneeId === hk.id
            const over = entry.credits - DEFAULT_TARGET_CREDITS
            const deltaLabel = over > 2
              ? t('housekeeping.rosterSidebar.overTarget', { count: over })
              : over < -2
                ? t('housekeeping.rosterSidebar.underTarget', { count: Math.abs(over) })
                : t('housekeeping.rosterSidebar.onTarget')
            const deltaClass = over > 2
              ? 'bg-[var(--caution-soft)] text-[var(--caution)] border-[var(--caution-line)]'
              : over < -2
                ? 'bg-surface-3 text-ink3 border-line'
                : 'bg-[var(--ready-soft)] text-[var(--ready)] border-[var(--ready-line)]'
            const savedPct = Math.min(100, (entry.savedCredits / DEFAULT_TARGET_CREDITS) * 100)
            const stagedPct = Math.min(100, (entry.stagedCredits / DEFAULT_TARGET_CREDITS) * 100)

            return (
              <button
                key={hk.id}
                type="button"
                onClick={() => setActiveAssignee(isActive ? null : hk.id, isActive ? null : hk.name)}
                className={`block w-full text-left rounded-[var(--r-md)] mb-0.5 px-2.5 py-2.5 border transition-colors ${
                  isActive ? 'bg-[var(--accent-soft)] border-[var(--accent-line)]' : 'bg-transparent border-transparent hover:bg-surface-2'
                }`}
              >
                <span className="flex items-center gap-2.5 w-full">
                  <span
                    className={`inline-flex items-center justify-center w-7 h-7 rounded-full font-mono text-[11px] font-semibold shrink-0 ${
                      isActive ? 'bg-accent text-white' : 'bg-surface-3 text-ink2 border border-line'
                    }`}
                  >
                    {getInitials(hk.name)}
                  </span>
                  <span className="flex-1 min-w-0 text-left">
                    <span className="block text-[13px] font-medium text-ink leading-tight truncate">{hk.name}</span>
                    <span className="block font-mono text-[10.5px] text-ink3 mt-0.5">
                      {entry.rooms === 1
                        ? t('housekeeping.rosterSidebar.roomsOne', { count: entry.rooms })
                        : t('housekeeping.rosterSidebar.roomsOther', { count: entry.rooms })}
                      {' · '}{t('housekeeping.rosterSidebar.creditWeights.unit', { count: entry.credits })}
                      {entry.stagedRooms > 0 && t('housekeeping.rosterSidebar.stagedSuffix', { count: entry.stagedRooms })}
                    </span>
                  </span>
                  <span className={`shrink-0 text-[10.5px] font-medium px-[7px] py-[3px] rounded-full border ${deltaClass}`}>
                    {deltaLabel}
                  </span>
                </span>
                <span className="relative block w-full h-[5px] rounded-[3px] bg-surface-3 mt-2 overflow-hidden">
                  <span
                    className="absolute inset-y-0 left-0"
                    style={{ width: `${savedPct}%`, background: over > 2 ? 'var(--caution)' : 'var(--ready)' }}
                  />
                  {entry.stagedCredits > 0 && (
                    <span
                      className="absolute inset-y-0"
                      style={{
                        left: `${savedPct}%`,
                        width: `${stagedPct}%`,
                        background: 'repeating-linear-gradient(135deg, var(--accent) 0 3px, rgba(184,67,28,.45) 3px 6px)',
                      }}
                    />
                  )}
                </span>
              </button>
            )
          })
        )}
      </div>

      <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-t border-line-2 bg-surface-2">
        <span className="w-[26px] h-[26px] rounded-full border border-dashed border-[var(--alert-line)] bg-[var(--alert-soft)] text-[var(--alert)] flex items-center justify-center shrink-0 text-[11px] font-bold">
          ?
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[13px] font-medium text-ink">{t('housekeeping.assignmentSidebar.unassigned')}</span>
          <span className="block font-mono text-[10.5px] text-ink3 mt-0.5">
            {t('housekeeping.rosterSidebar.unassignedMeta', { rooms: load.unassignedRooms, credits: load.unassignedCredits })}
          </span>
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAssignFilter(assignFilter === 'unassigned' ? 'all' : 'unassigned')}
          aria-pressed={assignFilter === 'unassigned'}
        >
          {t('housekeeping.rosterSidebar.showOnly')}
        </Button>
      </div>
    </div>
  )
}

export function CreditWeightsCard() {
  const { t } = useTranslation()
  const rows: Array<{ key: keyof typeof CLEAN_TYPE_CREDITS; label: string; tone: string }> = [
    { key: 'DEP', label: t('housekeeping.rosterSidebar.creditWeights.departure'), tone: 'var(--alert)' },
    { key: 'FULL', label: t('housekeeping.rosterSidebar.creditWeights.fullClean'), tone: 'var(--caution)' },
    { key: 'LIGHT', label: t('housekeeping.rosterSidebar.creditWeights.lightPickup'), tone: 'var(--info)' },
  ]
  return (
    <div className="rounded-[var(--r-lg)] bg-surface border border-line p-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink4 mb-2.5">
        {t('housekeeping.rosterSidebar.creditWeights.title')}
      </p>
      <div className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center gap-2 text-xs text-ink2">
            <span className="w-[7px] h-[7px] rounded-[2px] shrink-0" style={{ background: row.tone }} />
            <span>{row.label}</span>
            <span className="flex-1" />
            <span className="font-mono text-ink3">
              {t('housekeeping.rosterSidebar.creditWeights.unit', { count: CLEAN_TYPE_CREDITS[row.key] })}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
