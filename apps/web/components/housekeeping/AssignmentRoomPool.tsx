'use client'

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useHousekeepingStore } from '@/stores/housekeepingStore'
import { getRoomWorkloadCredits, type HousekeepingOperationalRoom } from '@/lib/housekeeping/roomState'
import { getAssignmentPoolTabCounts, type AssignmentPoolTab } from '@/lib/housekeeping/assignmentView'
import { BoardSearchInput } from '@/components/housekeeping/HousekeepingBoardShell'
import { AssignmentRoomRow } from '@/components/housekeeping/AssignmentRoomRow'
import type { CleanType } from '@/lib/utils/cleanType'
import { EmptyState } from '@/components/ui/EmptyState'

interface Props {
  allOpenRooms: HousekeepingOperationalRoom[]
  visibleRooms: HousekeepingOperationalRoom[]
  nameById: Record<string, string>
  onOpenDetail: (room: HousekeepingOperationalRoom) => void
  onChangeCleanType: (roomId: string, cleanType: CleanType) => void
  onUnassign: (room: HousekeepingOperationalRoom) => void
}

const TABS: AssignmentPoolTab[] = ['all', 'unassigned', 'staged']

export function AssignmentRoomPool({ allOpenRooms, visibleRooms, nameById, onOpenDetail, onChangeCleanType, onUnassign }: Props) {
  const { t } = useTranslation()
  const {
    assignFilter,
    setAssignFilter,
    buildingFilter,
    setBuildingFilter,
    floorFilter,
    setFloorFilter,
    cleanTypeFilter,
    setCleanTypeFilter,
    boardSearch,
    setBoardSearch,
    selectedRoomIds,
    toggleRoomSelection,
    setRoomSelection,
    clearRoomSelection,
    pendingAssignments,
  } = useHousekeepingStore()

  const tabCounts = useMemo(() => getAssignmentPoolTabCounts(allOpenRooms, pendingAssignments), [allOpenRooms, pendingAssignments])

  const buildings = useMemo(() => Array.from(new Set(allOpenRooms.map((r) => r.building).filter((b): b is string => !!b))).sort(), [allOpenRooms])
  const floors = useMemo(() => Array.from(new Set(
    allOpenRooms.filter((r) => !buildingFilter || r.building === buildingFilter).map((r) => r.floor).filter((f): f is number => f !== null),
  )).sort((a, b) => a - b), [allOpenRooms, buildingFilter])

  const byFloor = useMemo(() => {
    const map = new Map<number, HousekeepingOperationalRoom[]>()
    for (const room of visibleRooms) {
      const floor = room.floor ?? 0
      map.set(floor, [...(map.get(floor) ?? []), room])
    }
    return map
  }, [visibleRooms])
  const sortedFloors = Array.from(byFloor.keys()).sort((a, b) => a - b)

  const selectedCount = selectedRoomIds.size
  const selectedCredits = visibleRooms.filter((r) => selectedRoomIds.has(r.roomId)).reduce((sum, r) => sum + getRoomWorkloadCredits(r), 0)
  const allFilteredSelected = visibleRooms.length > 0 && visibleRooms.every((r) => selectedRoomIds.has(r.roomId))

  const tabButtonClass = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${active ? 'border-ink bg-ink text-paper' : 'border-line bg-surface text-ink2 hover:bg-surface-2'}`
  const selectClass = 'h-9 min-w-0 rounded-[var(--r-md)] border border-line bg-surface px-2 text-sm text-ink outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]'

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {TABS.map((tab) => (
          <button key={tab} type="button" aria-pressed={assignFilter === tab} onClick={() => setAssignFilter(tab)} className={tabButtonClass(assignFilter === tab)}>
            {t(`housekeeping.assignWorkspace.pool.tabs.${tab}`)} <span className="font-mono text-[11px] opacity-70">{tabCounts[tab]}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {buildings.length > 1 && (
          <select aria-label={t('housekeeping.boardV2.filters.building')} className={selectClass} value={buildingFilter ?? ''} onChange={(e) => setBuildingFilter(e.target.value || null)}>
            <option value="">{t('housekeeping.boardV2.filters.allBuildings')}</option>
            {buildings.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        )}
        <select aria-label={t('housekeeping.boardV2.filters.floor')} className={selectClass} value={floorFilter ?? ''} onChange={(e) => setFloorFilter(e.target.value ? Number(e.target.value) : null)}>
          <option value="">{t('housekeeping.boardV2.filters.allFloors')}</option>
          {floors.map((f) => <option key={f} value={f}>{t('housekeeping.boardV2.filters.floorOption', { floor: f })}</option>)}
        </select>
        <select
          aria-label={t('housekeeping.boardV2.filters.cleanType')}
          className={selectClass}
          value={cleanTypeFilter[0] ?? ''}
          onChange={(e) => setCleanTypeFilter(e.target.value ? [e.target.value as CleanType] : [])}
        >
          <option value="">{t('housekeeping.boardV2.filters.allCleanTypes')}</option>
          <option value="DEP">{t('housekeeping.roomStatus.filters.departure')}</option>
          <option value="FULL">{t('housekeeping.roomStatus.filters.full')}</option>
          <option value="LIGHT">{t('housekeeping.roomStatus.filters.light')}</option>
        </select>
        <BoardSearchInput value={boardSearch} onChange={setBoardSearch} />
      </div>

      {visibleRooms.length > 0 && (
        <div className="flex items-center gap-3 rounded-[var(--r-md)] border border-line bg-surface-2 px-3 py-1.5 text-xs text-ink2">
          <button
            type="button"
            onClick={() => (allFilteredSelected ? clearRoomSelection() : setRoomSelection(visibleRooms.map((r) => r.roomId)))}
            className="font-medium text-accent hover:underline"
          >
            {allFilteredSelected
              ? t('housekeeping.assignWorkspace.pool.deselectAll')
              : t('housekeeping.assignWorkspace.pool.selectAllFiltered', { count: visibleRooms.length })}
          </button>
          {selectedCount > 0 && (
            <span className="ml-auto font-mono">
              {t('housekeeping.assignWorkspace.pool.selectedSummary', { count: selectedCount, credits: selectedCredits })}
            </span>
          )}
        </div>
      )}

      {visibleRooms.length === 0 ? (
        <EmptyState title={t('housekeeping.assignWorkspace.pool.empty')} />
      ) : (
        <div className="space-y-5">
          {sortedFloors.map((floor) => {
            const floorRooms = byFloor.get(floor) ?? []
            const unassigned = floorRooms.filter((r) => !pendingAssignments[r.roomId] && !r.assignedHousekeeperId)
            const unassignedCredits = unassigned.reduce((sum, r) => sum + getRoomWorkloadCredits(r), 0)
            return (
              <div key={floor}>
                <div className="mb-2 flex items-baseline gap-3 border-b border-dashed border-line-2 pb-1.5">
                  <h3 className="font-mono text-[12px] font-bold uppercase tracking-widest text-ink2">
                    {floor === 0 ? t('housekeeping.roomStatus.floor.ground') : t('housekeeping.roomStatus.floor.numbered', { floor })}
                  </h3>
                  <span className="font-mono text-[11px] text-ink3">
                    {unassigned.length > 0
                      ? t('housekeeping.assignWorkspace.pool.floorUnassigned', { count: unassigned.length, credits: unassignedCredits })
                      : t('housekeeping.roomStatus.floor.roomCountOther', { count: floorRooms.length })}
                  </span>
                  <div className="flex-1" />
                  {unassigned.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setRoomSelection(Array.from(new Set([...selectedRoomIds, ...unassigned.map((r) => r.roomId)])))}
                      className="shrink-0 rounded-[var(--r-sm)] border border-[var(--accent-line)] bg-[var(--accent-soft)] px-2.5 py-1 text-[11.5px] text-accent hover:bg-[var(--accent-line)]/30"
                    >
                      {t('housekeeping.assignWorkspace.pool.selectFloor')}
                    </button>
                  )}
                </div>
                <div className="space-y-1.5">
                  {floorRooms.map((room) => (
                    <AssignmentRoomRow
                      key={room.roomId}
                      room={room}
                      selected={selectedRoomIds.has(room.roomId)}
                      onToggleSelect={toggleRoomSelection}
                      onOpenDetail={onOpenDetail}
                      stagedToName={pendingAssignments[room.roomId] ? (nameById[pendingAssignments[room.roomId]] ?? null) : null}
                      ownerName={room.assignedHousekeeperId ? (nameById[room.assignedHousekeeperId] ?? null) : null}
                      onChangeCleanType={onChangeCleanType}
                      onUnassign={onUnassign}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
