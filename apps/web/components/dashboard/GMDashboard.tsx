'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { LogOut, CheckCircle2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import { useHotelStore } from '@/stores/hotelStore'
import { useAuthStore } from '@/stores/authStore'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { isSectionRedesigned } from '@/lib/utils/redesignFlag'
import { useArrivalReadiness } from '@/lib/hooks/useArrivalReadiness'
import { Pill, SectionLabel, Mono } from '@/components/ui/primitives'
import { DashboardGreeting } from '@/components/dashboard/DashboardGreeting'
import { ROIMetricsStrip } from '@/components/dashboard/ROIMetricsStrip'
import { AIRiskAlertsPanel } from '@/components/dashboard/AIRiskAlertsPanel'
import { LiveOpsGrid } from '@/components/dashboard/LiveOpsGrid'
import { TrendChartsRow } from '@/components/dashboard/TrendChartsRow'
import { ArrivalReadinessHero } from '@/components/dashboard/ArrivalReadinessHero'
import { RoomBlockersList } from '@/components/dashboard/RoomBlockersList'
import { OnShiftBoard } from '@/components/dashboard/OnShiftBoard'
import { OvernightRecapStrip } from '@/components/dashboard/OvernightRecapStrip'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { StateBlock } from '@/components/ui/StateBlock'

export function GMDashboard() {
  const { t } = useTranslation()
  const hotel = useHotelStore((s) => s.hotel)
  const v2 = isSectionRedesigned('dashboard', hotel)
  const storedFullName = useAuthStore((state) => state.fullName)
  const user = useAuthStore((state) => state.user)
  const queryClient = useQueryClient()
  const hotelId = hotel?.id ?? ''

  const firstName = storedFullName
    ? storedFullName.split(' ')[0] || 'there'
    : (user?.user_metadata?.full_name as string | undefined)?.split(' ')[0] || 'there'

  const today = format(new Date(), 'yyyy-MM-dd')

  // v2 arrival-readiness data — always called (rules of hooks), only rendered when v2
  const { hero, pace, blockers, shift, overnight, lastUpdatedAt } = useArrivalReadiness(hotelId)

  // Legacy board data + mutations — always called (rules of hooks), only rendered when !v2
  const { data: boardData, isLoading: boardLoading } = useQuery({
    queryKey: ['housekeeping-board-gm', today],
    queryFn: () => housekeepingApi.getBoard(today, undefined, false),
    staleTime: 60_000,
  })

  const rooms: any[] = boardData?.data?.rooms ?? []
  const depRooms = rooms.filter(
    (r) => r.clean_type === 'DEP' && ['OCCUPIED', 'IN_PROGRESS', 'DIRTY'].includes(r.status),
  )
  const readyRooms = rooms.filter((r) => r.status === 'INSPECTED')

  const checkoutMutation = useMutation({
    mutationFn: (roomId: string) => housekeepingApi.markCheckedOut(roomId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['housekeeping-board-gm'] }),
  })

  const checkinMutation = useMutation({
    mutationFn: (roomId: string) => housekeepingApi.markCheckIn(roomId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['housekeeping-board-gm'] }),
  })

  if (v2) {
    return (
      <div className="flex flex-col gap-5 max-w-[1240px]">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-6">
          <DashboardGreeting
            name={firstName}
            subtitle={
              hotel ? t('dashboard.gm.greetingSubtitle', { hotelName: hotel.name, count: hero.arrivalsCount }) : undefined
            }
          />
          <div className="flex items-center gap-2.5 shrink-0 sm:pt-1">
            <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--ready)] bg-[var(--ready-soft)] border border-[var(--ready-line)] rounded-full px-2.5 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--ready)] shrink-0 animate-pulse" />
              {t('dashboard.gm.live')}
            </span>
            {lastUpdatedAt && (
              <Mono className="text-[12px] text-ink3">
                {t('dashboard.gm.updatedAt', { time: format(lastUpdatedAt, 'h:mm a') })}
              </Mono>
            )}
          </div>
        </div>

        <ArrivalReadinessHero
          arrivalsCount={hero.arrivalsCount}
          readyForArrivals={hero.readyForArrivals}
          awaitingInspection={hero.awaitingInspection}
          beingCleaned={hero.beingCleaned}
          notStarted={hero.notStarted}
          departureRoomsInPlay={hero.departureRoomsInPlay}
          blockedCount={hero.blockedCount}
          paceProjection={pace.projection}
          isLoading={hero.isLoading}
          isError={hero.isError}
          onRetry={hero.refetch}
        />

        <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_1fr] gap-5 items-start">
          <RoomBlockersList
            rows={blockers.rows}
            isLoading={blockers.isLoading}
            isError={blockers.isError}
            onRetry={blockers.refetch}
          />
          <OnShiftBoard
            tiles={shift.tiles}
            totalOnShift={shift.totalOnShift}
            behindCount={shift.behindCount}
            otherDeptCount={shift.otherDeptCount}
            isLoading={shift.isLoading}
            isError={shift.isError}
            onRetry={shift.refetch}
          />
        </div>

        <OvernightRecapStrip summary={overnight.summary} isLoading={overnight.isLoading} />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <DashboardGreeting name={firstName} subtitle={hotel?.name} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card hover={false} className="p-4">
          <SectionLabel className="mb-3">Departures today ({depRooms.length})</SectionLabel>
          <StateBlock
            status={boardLoading ? 'loading' : depRooms.length === 0 ? 'empty' : null}
            empty={{ title: 'No departure rooms pending checkout.' }}
          >
            <div className="space-y-2">
              {depRooms.map((room: any) => (
                <div key={room.room_id} className="flex items-center gap-3">
                  <Mono className="bg-surface-2 border border-line rounded px-1.5 py-0.5 text-[11px] shrink-0">
                    {room.room_number}
                  </Mono>
                  <Pill tone={room.status === 'IN_PROGRESS' ? 'progress' : 'dirty'} size="sm">
                    {room.status === 'IN_PROGRESS' ? 'Cleaning' : room.status === 'OCCUPIED' ? 'Occupied' : 'Vacant Dirty'}
                  </Pill>
                  {(room.status === 'OCCUPIED' || room.fo_status === 'OCC') && (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={checkoutMutation.isPending}
                      onClick={() => checkoutMutation.mutate(room.room_id)}
                      className="ml-auto gap-1 border-[var(--alert-line)] bg-[var(--alert-soft)] text-[var(--alert)] hover:bg-[var(--alert)] hover:text-white"
                    >
                      <LogOut className="w-3 h-3" />
                      Mark Departed
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </StateBlock>
        </Card>

        <Card hover={false} className="p-4">
          <SectionLabel className="mb-3">Ready for occupancy ({readyRooms.length})</SectionLabel>
          <StateBlock
            status={boardLoading ? 'loading' : readyRooms.length === 0 ? 'empty' : null}
            empty={{ title: 'No rooms currently ready for occupancy.' }}
          >
            <div className="space-y-2">
              {readyRooms.map((room: any) => (
                <div key={room.room_id} className="flex items-center gap-3">
                  <Mono className="bg-surface-2 border border-line rounded px-1.5 py-0.5 text-[11px] shrink-0">
                    {room.room_number}
                  </Mono>
                  <Pill tone="ready" size="sm">Inspected</Pill>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={checkinMutation.isPending}
                    onClick={() => checkinMutation.mutate(room.room_id)}
                    className="ml-auto gap-1 border-[var(--ready-line)] bg-[var(--ready-soft)] text-[var(--ready)] hover:bg-[var(--ready)] hover:text-white"
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    Mark Occupied
                  </Button>
                </div>
              ))}
            </div>
          </StateBlock>
        </Card>
      </div>

      <ROIMetricsStrip />
      <AIRiskAlertsPanel />
      <LiveOpsGrid />
      <TrendChartsRow />
    </div>
  )
}
