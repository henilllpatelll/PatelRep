'use client'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { Coffee } from 'lucide-react'
import { staffApi } from '@/lib/api/staff'
import { getInitials } from '@/lib/utils/avatar'
import { cn } from '@/lib/utils'
import { type AssignmentStaffLoad, sortAssignmentStaff } from '@/lib/housekeeping/assignmentView'
import { Skeleton } from '@/components/ui/Skeleton'
import { StateBlock } from '@/components/ui/StateBlock'
import { Button } from '@/components/ui/Button'

const CAPACITY_TONE: Record<AssignmentStaffLoad['capacityState'], string> = {
  under: 'text-ink3',
  on: 'text-[var(--ready)]',
  at: 'text-[var(--caution)]',
  over: 'text-[var(--alert)]',
}

function AvailabilityBadge({ load }: { load: AssignmentStaffLoad }) {
  const { t } = useTranslation()
  if (load.availability === 'working' && load.currentRoomNumber) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-ink2">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--progress)]" aria-hidden="true" />
        {t('housekeeping.assignWorkspace.team.cleaningRoom', { room: load.currentRoomNumber })}
      </span>
    )
  }
  if (load.availability === 'on_break') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-ink2">
        <Coffee className="h-3 w-3" aria-hidden="true" />
        {t('housekeeping.assignWorkspace.team.availability.on_break')}
      </span>
    )
  }
  const dotClass = load.availability === 'working' ? 'bg-[var(--progress)]' : load.availability === 'available' ? 'bg-[var(--ready)]' : 'bg-ink4'
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink2">
      <span className={cn('h-1.5 w-1.5 rounded-full', dotClass)} aria-hidden="true" />
      {t(`housekeeping.assignWorkspace.team.availability.${load.availability}`)}
    </span>
  )
}

function AssignmentStaffCard({
  load,
  selectedCount,
  selectedCredits,
  onAssignSelected,
}: {
  load: AssignmentStaffLoad
  selectedCount: number
  selectedCredits: number
  onAssignSelected: (staffId: string) => void
}) {
  const { t } = useTranslation()
  const [confirmingOverCapacity, setConfirmingOverCapacity] = useState(false)
  const projectedIfAssigned = load.projectedCredits + selectedCredits
  const wouldExceed = selectedCount > 0 && projectedIfAssigned - load.target > 2
  const isOnBreak = load.availability === 'on_break'
  const barPct = Math.min(100, (load.projectedCredits / Math.max(load.target, 1)) * 100)
  const inactive = load.availability === 'off_shift' || load.availability === 'unavailable'

  const handleAssignClick = () => {
    if ((wouldExceed || isOnBreak) && !confirmingOverCapacity) {
      setConfirmingOverCapacity(true)
      return
    }
    setConfirmingOverCapacity(false)
    onAssignSelected(load.id)
  }

  return (
    <div className={cn('rounded-[var(--r-md)] border border-line bg-surface p-3', inactive && 'opacity-70')}>
      <div className="flex items-start gap-2.5">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-surface-3 font-mono text-[11px] font-semibold text-ink2">
          {getInitials(load.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{load.name}</p>
          <AvailabilityBadge load={load} />
        </div>
      </div>

      <div className="mt-2.5">
        <p className={cn('font-mono text-[13px] font-semibold', CAPACITY_TONE[load.capacityState])}>
          {t('housekeeping.assignWorkspace.team.creditsOf', { current: load.projectedCredits, target: load.target })}
          {' · '}
          {t(`housekeeping.assignWorkspace.team.capacity.${load.capacityState}`)}
        </p>
        <div className="relative mt-1.5 h-[5px] w-full overflow-hidden rounded-[3px] bg-surface-3">
          <span
            className="absolute inset-y-0 left-0"
            style={{ width: `${barPct}%`, background: load.capacityState === 'over' ? 'var(--alert)' : load.capacityState === 'at' ? 'var(--caution)' : 'var(--ready)' }}
          />
        </div>
        <p className="mt-1 text-[11px] text-ink3">
          {load.savedRooms + load.stagedRooms === 1
            ? t('housekeeping.rosterSidebar.roomsOne', { count: load.savedRooms + load.stagedRooms })
            : t('housekeeping.rosterSidebar.roomsOther', { count: load.savedRooms + load.stagedRooms })}
          {load.floors.length > 0 && ` · ${t('housekeeping.assignWorkspace.team.floors', { list: load.floors.join('–') })}`}
        </p>
      </div>

      {selectedCount > 0 && (
        <div className="mt-2.5 rounded-[var(--r-sm)] border border-line-2 bg-surface-2 px-2.5 py-1.5 text-[11px] text-ink2">
          <p>{t('housekeeping.assignWorkspace.team.projected.current', { count: load.projectedCredits })}</p>
          <p>{t('housekeeping.assignWorkspace.team.projected.staged', { count: selectedCredits })}</p>
          <p className={wouldExceed ? 'font-semibold text-[var(--alert)]' : 'font-semibold text-ink'}>
            {t('housekeeping.assignWorkspace.team.projected.result', { current: projectedIfAssigned, target: load.target })}
          </p>
        </div>
      )}

      {confirmingOverCapacity ? (
        <div className="mt-2.5 space-y-1.5">
          <p className="text-[11px] text-[var(--alert)]">
            {isOnBreak ? t('housekeeping.assignWorkspace.team.onBreakWarning') : t('housekeeping.assignWorkspace.team.overCapacityWarning', { current: projectedIfAssigned, target: load.target })}
          </p>
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" className="flex-1" onClick={() => setConfirmingOverCapacity(false)}>
              {t('housekeeping.assignWorkspace.team.cancel')}
            </Button>
            <Button variant="primary" size="sm" className="flex-1" onClick={handleAssignClick}>
              {t('housekeeping.assignWorkspace.team.assignAnyway')}
            </Button>
          </div>
        </div>
      ) : (
        selectedCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="mt-2.5 w-full"
            onClick={handleAssignClick}
            disabled={inactive}
          >
            {t('housekeeping.assignWorkspace.team.assignSelected', { count: selectedCount })}
          </Button>
        )
      )}
    </div>
  )
}

export function AssignmentTeamPanel({
  loads,
  selectedCount,
  selectedCredits,
  onAssignSelected,
}: {
  loads: AssignmentStaffLoad[]
  selectedCount: number
  selectedCredits: number
  onAssignSelected: (staffId: string) => void
}) {
  const { t } = useTranslation()
  const { isLoading, isError, refetch } = useQuery({ queryKey: ['staff-list'], queryFn: () => staffApi.list() })
  const sorted = sortAssignmentStaff(loads)
  const active = sorted.filter((l) => l.availability !== 'off_shift' && l.availability !== 'unavailable')
  const inactive = sorted.filter((l) => l.availability === 'off_shift' || l.availability === 'unavailable')

  return (
    <div data-testid="hk-bar" className="flex w-full flex-col gap-2 lg:w-[300px] lg:shrink-0">
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink4">{t('housekeeping.assignWorkspace.team.title')}</p>
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : isError ? (
        <StateBlock status="error" error={{ message: t('housekeeping.page.assignBar.loadError'), onRetry: refetch }} />
      ) : sorted.length === 0 ? (
        <p className="rounded-[var(--r-md)] border border-line bg-surface p-3 text-xs text-ink3">
          {t('housekeeping.page.assignBar.noStaff')}{' '}
          <Link href="/staff" prefetch={false} className="text-accent underline">{t('housekeeping.page.assignBar.addStaff')}</Link>
        </p>
      ) : (
        <>
          <div className="space-y-2">
            {active.map((load) => (
              <AssignmentStaffCard key={load.id} load={load} selectedCount={selectedCount} selectedCredits={selectedCredits} onAssignSelected={onAssignSelected} />
            ))}
          </div>
          {inactive.length > 0 && (
            <div className="mt-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink4">{t('housekeeping.assignWorkspace.team.unavailableSection')}</p>
              <div className="mt-1.5 space-y-2">
                {inactive.map((load) => (
                  <AssignmentStaffCard key={load.id} load={load} selectedCount={selectedCount} selectedCredits={selectedCredits} onAssignSelected={onAssignSelected} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
