'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { LogOut, CheckCircle2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import { useHotelStore } from '@/stores/hotelStore'
import { useAuthStore } from '@/stores/authStore'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { hotelsApi } from '@/lib/api/hotels'
import { reportsApi } from '@/lib/api/reports'
import { guestRequestsApi } from '@/lib/api/guest_requests'
import { engineeringApi, type WorkOrder } from '@/lib/api/engineering'
import { isSectionRedesigned } from '@/lib/utils/redesignFlag'
import { Pill, SectionLabel, Mono, Stat } from '@/components/ui/primitives'
import { DashboardGreeting } from '@/components/dashboard/DashboardGreeting'
import { ROIMetricsStrip } from '@/components/dashboard/ROIMetricsStrip'
import { AIRiskAlertsPanel } from '@/components/dashboard/AIRiskAlertsPanel'
import { LiveOpsGrid } from '@/components/dashboard/LiveOpsGrid'
import { TrendChartsRow } from '@/components/dashboard/TrendChartsRow'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { StateBlock } from '@/components/ui/StateBlock'

function getHotelIdFromSession(accessToken: string | undefined): string {
  if (!accessToken) return ''
  try {
    return JSON.parse(atob(accessToken.split('.')[1]))?.hotel_id ?? ''
  } catch {
    return ''
  }
}

function SnapshotSkeleton({ rows = 1 }: { rows?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {[...Array(rows * 2)].map((_, i) => (
        <div key={i} className="h-20 rounded-[var(--r-lg)] bg-surface-3 animate-pulse" />
      ))}
    </div>
  )
}

export function GMDashboard() {
  const { t } = useTranslation()
  const hotel = useHotelStore((s) => s.hotel)
  const v2 = isSectionRedesigned('dashboard', hotel)
  const storedFullName = useAuthStore((state) => state.fullName)
  const user = useAuthStore((state) => state.user)
  const session = useAuthStore((state) => state.session)
  const queryClient = useQueryClient()
  const hotelId = getHotelIdFromSession(session?.access_token)

  const firstName = storedFullName
    ? storedFullName.split(' ')[0] || 'there'
    : (user?.user_metadata?.full_name as string | undefined)?.split(' ')[0] || 'there'

  const today = format(new Date(), 'yyyy-MM-dd')

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

  // v2 portfolio-snapshot data — always called (rules of hooks), only rendered when v2
  const {
    data: statsData,
    isLoading: statsLoading,
    isError: statsError,
    refetch: refetchStats,
  } = useQuery({
    queryKey: ['hotel-stats', hotelId],
    queryFn: () => hotelsApi.getStats(hotelId),
    enabled: !!hotelId,
    refetchInterval: 120_000,
  })

  const {
    data: summaryData,
    isLoading: summaryLoading,
    isError: summaryError,
    refetch: refetchSummary,
  } = useQuery({
    queryKey: ['daily-summary', hotelId],
    queryFn: () => reportsApi.getDailySummary(),
    enabled: !!hotelId,
    refetchInterval: 120_000,
  })

  const {
    data: guestRequestsData,
    isLoading: guestRequestsLoading,
    isError: guestRequestsError,
    refetch: refetchGuestRequests,
  } = useQuery({
    queryKey: ['gm-open-guest-requests'],
    queryFn: () => guestRequestsApi.listRequests({ status: 'open' }),
    refetchInterval: 120_000,
  })

  const {
    data: workOrdersData,
    isLoading: workOrdersLoading,
    isError: workOrdersError,
    refetch: refetchWorkOrders,
  } = useQuery({
    queryKey: ['gm-all-work-orders'],
    queryFn: () => engineeringApi.listWorkOrders({ per_page: 100 }),
    refetchInterval: 120_000,
  })

  const {
    data: aiUsageData,
    isLoading: aiUsageLoading,
    isError: aiUsageError,
    refetch: refetchAiUsage,
  } = useQuery({
    queryKey: ['gm-ai-usage'],
    queryFn: () => reportsApi.getAIUsage(),
    refetchInterval: 300_000,
  })

  const stats = statsData?.data
  const breakdown = summaryData?.data?.room_status_breakdown ?? {}
  const roomsReady = breakdown.CLEAN ?? 0
  const roomsDirty = breakdown.DIRTY ?? 0
  const roomsPickup = breakdown.PICKUP ?? 0
  const roomsInspected = breakdown.INSPECTED ?? 0

  const allWorkOrders: WorkOrder[] = workOrdersData?.data ?? []
  const openWorkOrdersList = allWorkOrders.filter((wo) => wo.status === 'open' || wo.status === 'in_progress')
  const urgentWorkOrders = openWorkOrdersList.filter((wo) => wo.priority === 'urgent')
  const openWorkOrdersCount = summaryData?.data?.open_work_orders ?? stats?.open_work_orders ?? openWorkOrdersList.length

  const activeGuestRequests = guestRequestsData?.data?.length ?? 0
  const staffOnShift = stats?.active_staff ?? 0
  const openTasks = stats?.open_tasks ?? 0
  const aiUsage = aiUsageData?.data

  const roomsCardState = summaryLoading ? 'loading' : summaryError ? 'error' : !summaryData?.data ? 'empty' : null
  const workOrdersCardState = workOrdersLoading ? 'loading' : workOrdersError ? 'error' : null
  const guestRequestsCardState = guestRequestsLoading ? 'loading' : guestRequestsError ? 'error' : null
  const staffCardState = statsLoading ? 'loading' : statsError ? 'error' : !stats ? 'empty' : null
  const creditCardState = aiUsageLoading ? 'loading' : aiUsageError ? 'error' : !aiUsage ? 'empty' : null

  if (v2) {
    return (
      <div className="space-y-5">
        <DashboardGreeting name={firstName} subtitle={hotel?.name} />

        <div data-i18n-skip="true">
          <SectionLabel>{t('dashboard.gm.snapshotTitle')}</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {/* Housekeeping */}
            <Card hover={false} className="p-4">
              <SectionLabel className="mb-3">{t('nav.housekeeping')}</SectionLabel>
              {roomsCardState === 'loading' ? (
                <SnapshotSkeleton rows={2} />
              ) : roomsCardState === 'error' ? (
                <StateBlock status="error" error={{ message: t('common.error'), onRetry: () => refetchSummary() }} />
              ) : roomsCardState === 'empty' ? (
                <StateBlock status="empty" empty={{ title: t('dashboard.empty.gmNoData') }} />
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <Stat label={t('dashboard.gm.roomsReady')} value={roomsReady} deltaTone="info" />
                  <Stat label={t('dashboard.gm.roomsDirty')} value={roomsDirty} deltaTone={roomsDirty > 0 ? 'alert' : 'ready'} />
                  <Stat label={t('dashboard.gm.roomsPickup')} value={roomsPickup} deltaTone={roomsPickup > 0 ? 'caution' : 'ready'} />
                  <Stat label={t('dashboard.gm.roomsInspected')} value={roomsInspected} deltaTone="ready" />
                </div>
              )}
            </Card>

            {/* Engineering */}
            <Card hover={false} className="p-4">
              <SectionLabel className="mb-3">{t('nav.engineering')}</SectionLabel>
              {workOrdersCardState === 'loading' ? (
                <SnapshotSkeleton rows={1} />
              ) : workOrdersCardState === 'error' ? (
                <StateBlock status="error" error={{ message: t('common.error'), onRetry: () => refetchWorkOrders() }} />
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <Stat label={t('dashboard.gm.openWorkOrders')} value={openWorkOrdersCount} />
                  <Stat
                    label={t('dashboard.gm.urgentWorkOrders')}
                    value={urgentWorkOrders.length}
                    deltaTone={urgentWorkOrders.length > 0 ? 'alert' : 'ready'}
                  />
                </div>
              )}
              <Link
                href="/engineering/work-orders"
                className="mt-3 inline-block text-[11px] font-medium text-ink3 hover:text-brand transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] rounded-sm"
              >
                {t('dashboard.gm.viewAllWorkOrders')}
              </Link>
            </Card>

            {/* Guest requests */}
            <Card hover={false} className="p-4">
              <SectionLabel className="mb-3">{t('nav.guestRequests')}</SectionLabel>
              {guestRequestsCardState === 'loading' ? (
                <SnapshotSkeleton rows={1} />
              ) : guestRequestsCardState === 'error' ? (
                <StateBlock status="error" error={{ message: t('common.error'), onRetry: () => refetchGuestRequests() }} />
              ) : (
                <Stat
                  label={t('dashboard.gm.activeGuestRequests')}
                  value={activeGuestRequests}
                  deltaTone={activeGuestRequests > 0 ? 'caution' : 'ready'}
                />
              )}
              <Link
                href="/guest-requests"
                className="mt-3 inline-block text-[11px] font-medium text-ink3 hover:text-brand transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] rounded-sm"
              >
                {t('dashboard.gm.viewGuestRequests')}
              </Link>
            </Card>

            {/* Staffing */}
            <Card hover={false} className="p-4">
              <SectionLabel className="mb-3">{t('nav.staff')}</SectionLabel>
              {staffCardState === 'loading' ? (
                <SnapshotSkeleton rows={1} />
              ) : staffCardState === 'error' ? (
                <StateBlock status="error" error={{ message: t('common.error'), onRetry: () => refetchStats() }} />
              ) : staffCardState === 'empty' ? (
                <StateBlock status="empty" empty={{ title: t('dashboard.empty.gmNoData') }} />
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <Stat label={t('dashboard.gm.staffOnShift')} value={staffOnShift} />
                  <Stat label={t('dashboard.gm.openTasks')} value={openTasks} />
                </div>
              )}
            </Card>
          </div>
        </div>

        <div>
          <div data-i18n-skip="true">
            <SectionLabel>{t('dashboard.gm.alertsTitle')}</SectionLabel>
          </div>
          <AIRiskAlertsPanel />
        </div>

        <Card hover={false} className="p-4 max-w-md" data-i18n-skip="true">
          <SectionLabel className="mb-3">{t('dashboard.gm.creditUsageTitle')}</SectionLabel>
          {creditCardState === 'loading' ? (
            <SnapshotSkeleton rows={1} />
          ) : creditCardState === 'error' ? (
            <StateBlock status="error" error={{ message: t('common.error'), onRetry: () => refetchAiUsage() }} />
          ) : creditCardState === 'empty' ? (
            <StateBlock status="empty" empty={{ title: t('dashboard.empty.gmNoData') }} />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Stat label={t('dashboard.gm.creditsUsed')} value={aiUsage!.total_credits_used} />
              <Stat label={t('dashboard.gm.interactions')} value={aiUsage!.total_interactions} />
            </div>
          )}
          <div className="mt-3 flex items-center gap-3">
            <Link
              href="/settings/billing"
              className="text-[11px] font-medium text-ink3 hover:text-brand transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] rounded-sm"
            >
              {t('dashboard.gm.viewBilling')}
            </Link>
            <Link
              href="/management-roi"
              className="text-[11px] font-medium text-ink3 hover:text-brand transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] rounded-sm"
            >
              {t('dashboard.gm.viewManagementRoi')}
            </Link>
          </div>
        </Card>
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
