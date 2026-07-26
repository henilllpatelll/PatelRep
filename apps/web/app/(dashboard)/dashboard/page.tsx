'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Loader2, LogOut, CheckCircle2 } from 'lucide-react'
import { useRole } from '@/lib/hooks/useRole'
import { ROIMetricsStrip } from '@/components/dashboard/ROIMetricsStrip'
import { AIRiskAlertsPanel } from '@/components/dashboard/AIRiskAlertsPanel'
import { LiveOpsGrid } from '@/components/dashboard/LiveOpsGrid'
import { TrendChartsRow } from '@/components/dashboard/TrendChartsRow'
import { HousekeeperDashboard } from '@/components/dashboard/HousekeeperDashboard'
import { SupervisorDashboard } from '@/components/dashboard/SupervisorDashboard'
import { EngineerDashboard } from '@/components/dashboard/EngineerDashboard'
import { FrontDeskDashboard } from '@/components/dashboard/FrontDeskDashboard'
import { useHotelStore } from '@/stores/hotelStore'
import { useAuthStore } from '@/stores/authStore'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { Pill, SectionLabel, Mono } from '@/components/ui/primitives'
import { DashboardGreeting } from '@/components/dashboard/DashboardGreeting'

function GMDashboard() {
  const { hotel } = useHotelStore()
  const storedFullName = useAuthStore((state) => state.fullName)
  const user = useAuthStore((state) => state.user)
  const queryClient = useQueryClient()

  const firstName = storedFullName
    ? storedFullName.split(' ')[0] || 'there'
    : (user?.user_metadata?.full_name as string | undefined)?.split(' ')[0] || 'there'

  const today = format(new Date(), 'yyyy-MM-dd')

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

  return (
    <div className="space-y-5">
      <DashboardGreeting name={firstName} subtitle={hotel?.name} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-surface rounded-[var(--r-lg)] border border-line p-4">
          <SectionLabel className="mb-3">Departures today ({depRooms.length})</SectionLabel>
          {boardLoading ? (
            <div className="flex items-center gap-2 text-ink3 text-sm py-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading…
            </div>
          ) : depRooms.length === 0 ? (
            <p className="text-sm text-ink3 py-2">No departure rooms pending checkout.</p>
          ) : (
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
                    <button
                      onClick={() => checkoutMutation.mutate(room.room_id)}
                      disabled={checkoutMutation.isPending}
                      className="ml-auto flex items-center gap-1 px-2.5 py-1 text-[11.5px] font-medium bg-[var(--alert-soft)] text-[var(--alert)] border border-[var(--alert-line)] rounded-lg hover:bg-[var(--alert)] hover:text-white transition-colors disabled:opacity-50"
                    >
                      <LogOut className="w-3 h-3" />
                      Mark Departed
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-surface rounded-[var(--r-lg)] border border-line p-4">
          <SectionLabel className="mb-3">Ready for occupancy ({readyRooms.length})</SectionLabel>
          {boardLoading ? (
            <div className="flex items-center gap-2 text-ink3 text-sm py-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading…
            </div>
          ) : readyRooms.length === 0 ? (
            <p className="text-sm text-ink3 py-2">No rooms currently ready for occupancy.</p>
          ) : (
            <div className="space-y-2">
              {readyRooms.map((room: any) => (
                <div key={room.room_id} className="flex items-center gap-3">
                  <Mono className="bg-surface-2 border border-line rounded px-1.5 py-0.5 text-[11px] shrink-0">
                    {room.room_number}
                  </Mono>
                  <Pill tone="ready" size="sm">Inspected</Pill>
                  <button
                    onClick={() => checkinMutation.mutate(room.room_id)}
                    disabled={checkinMutation.isPending}
                    className="ml-auto flex items-center gap-1 px-2.5 py-1 text-[11.5px] font-medium bg-[var(--ready-soft)] text-[var(--ready)] border border-[var(--ready-line)] rounded-lg hover:bg-[var(--ready)] hover:text-white transition-colors disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    Mark Occupied
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ROIMetricsStrip />
      <AIRiskAlertsPanel />
      <LiveOpsGrid />
      <TrendChartsRow />
    </div>
  )
}

export default function DashboardPage() {
  const { role } = useRole()
  const isAuthLoading = useAuthStore((state) => state.isLoading)

  if (isAuthLoading || !role) {
    return (
      <div className="space-y-4">
        <div className="h-9 w-64 rounded-lg bg-surface-3 animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 rounded-[var(--r-lg)] bg-surface-3 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  switch (role) {
    case 'housekeeper':
      return <HousekeeperDashboard />
    case 'housekeeping_supervisor':
      return <SupervisorDashboard />
    case 'engineer':
      return <EngineerDashboard />
    case 'front_desk':
      return <FrontDeskDashboard />
    case 'gm':
      return <GMDashboard />
    default:
      return (
        <div className="flex items-center justify-center h-64">
          <p className="text-sm text-stone-400">No dashboard available for your role.</p>
        </div>
      )
  }
}
