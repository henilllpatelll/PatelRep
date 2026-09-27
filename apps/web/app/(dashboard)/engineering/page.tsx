'use client'

export const dynamic = 'force-dynamic'

import { Suspense, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { engineeringApi, type Asset, type PMSchedule, type WorkOrderStats } from '@/lib/api/engineering'
import { roomUnavailabilityApi } from '@/lib/api/rooms'
import { useRole } from '@/lib/hooks/useRole'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/shared/PageHeader'
import { WorkOrdersTab } from '@/components/engineering/tabs/WorkOrdersTab'
import { AssetsTab } from '@/components/engineering/tabs/AssetsTab'
import { PMSchedulesTab } from '@/components/engineering/tabs/PMSchedulesTab'
import { PredictionsTab } from '@/components/engineering/tabs/PredictionsTab'
import { PartsPanel } from '@/components/engineering/PartsPanel'
import { ArchivedWorkOrdersPanel } from '@/components/engineering/ArchivedWorkOrdersPanel'
import { PlaceRoomDownDrawer } from '@/components/engineering/PlaceRoomDownDrawer'
import { RoomsDownTab } from '@/components/engineering/tabs/RoomsDownTab'

const VALID_TABS = ['work-orders', 'rooms-down', 'assets', 'pm-schedules', 'reliability', 'parts', 'archived'] as const
type EngineeringTab = (typeof VALID_TABS)[number]

function getHotelIdFromToken(token: string | undefined): string {
  try { return JSON.parse(atob(token!.split('.')[1]))?.hotel_id ?? '' } catch { return '' }
}

function EngineeringPageContent() {
  const { t } = useTranslation()
  const { role, isGM } = useRole()
  const user = useAuthStore((s) => s.user)
  const session = useAuthStore((s) => s.session)
  const hotelId = getHotelIdFromToken(session?.access_token)
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  const router = useRouter()

  const [activeTab, setActiveTab] = useState<EngineeringTab>(() => {
    const requested = searchParams.get('tab')
    if (requested === 'predictions') return 'reliability'
    return (VALID_TABS as readonly string[]).includes(requested ?? '') ? (requested as EngineeringTab) : 'work-orders'
  })
  const focusId = searchParams.get('focus')
  const roomId = searchParams.get('room')
  const highlightAssetId = searchParams.get('asset')

  const [showCreateWO, setShowCreateWO] = useState(false)
  const [showArchiveWO, setShowArchiveWO] = useState(false)
  const [showCreateAsset, setShowCreateAsset] = useState(false)
  const [showCreatePM, setShowCreatePM] = useState(false)
  const [showPlaceRoomDown, setShowPlaceRoomDown] = useState(false)

  const isEngineer = role === 'engineer'
  const canManageWO = role === 'engineer' || role === 'gm'
  const canEditAssets = isGM || role === 'engineer'
  const canEditPM = isGM || role === 'engineer' || role === 'chief_engineer'
  const canManagePredictions = isGM || role === 'engineer'
  const canAuthorizePredictions = isGM || role === 'chief_engineer'

  // ── KPI strip — cheap, hotel-scoped lists; shared React Query cache keys
  // with the tab components below, so opening a tab never double-fetches.

  const statsQ = useQuery({
    queryKey: ['work-order-stats'],
    queryFn: () => engineeringApi.getWorkOrderStats(),
    select: (res) => res.data as WorkOrderStats,
    refetchInterval: 60_000,
    enabled: !!hotelId,
  })
  const assetsQ = useQuery({
    queryKey: ['assets'],
    queryFn: () => engineeringApi.listAssets(),
    select: (res) => res.data as Asset[],
    enabled: !!hotelId,
  })
  const pmQ = useQuery({
    queryKey: ['pm-schedules'],
    queryFn: () => engineeringApi.listPMSchedules(),
    select: (res) => res.data as PMSchedule[],
    enabled: !!hotelId,
  })
  const roomsDownQ = useQuery({
    queryKey: ['room-unavailability-summary'],
    queryFn: () => roomUnavailabilityApi.summary(),
    select: (res) => res.data,
    enabled: !!hotelId,
  })

  const openCount = statsQ.data?.open ?? 0
  const escalatedCount = statsQ.data?.escalated ?? 0
  const overdueWOCount = statsQ.data?.overdue ?? 0
  const highRiskAssetsCount = (assetsQ.data ?? []).filter((a) => a.failure_risk_score >= 70).length
  const pmOverdueCount = (pmQ.data ?? []).filter((s) => new Date(s.next_due_at) < new Date()).length
  const roomsDownCount = roomsDownQ.data?.active ?? 0
  const setEngineeringTab = (tab: EngineeringTab) => {
    setActiveTab(tab)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', tab)
    if (tab !== 'rooms-down') params.delete('room')
    if (tab !== 'work-orders') params.delete('focus')
    router.replace(`/engineering?${params.toString()}`)
  }
  const openWorkOrder = (workOrderId: string) => {
    setActiveTab('work-orders')
    router.replace(`/engineering?tab=work-orders&focus=${encodeURIComponent(workOrderId)}`)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('engineering.workOrdersPage.heading')}
        dataI18nSkip
        tabs={[
          {
            label: t('engineering.workOrdersPage.tabWorkOrders'),
            active: activeTab === 'work-orders',
            onClick: () => setEngineeringTab('work-orders'),
            count: openCount + escalatedCount > 0 ? openCount + escalatedCount : undefined,
          },
          {
            label: t('engineering.workOrdersPage.tabRoomsDown'),
            active: activeTab === 'rooms-down',
            onClick: () => setEngineeringTab('rooms-down'),
            count: roomsDownCount > 0 ? roomsDownCount : undefined,
          },
          {
            label: t('engineering.workOrdersPage.tabPreventive'),
            active: activeTab === 'pm-schedules',
            onClick: () => setEngineeringTab('pm-schedules'),
            count: pmOverdueCount > 0 ? pmOverdueCount : undefined,
          },
          {
            label: t('engineering.workOrdersPage.tabAssets'),
            active: activeTab === 'assets',
            onClick: () => setEngineeringTab('assets'),
            count: highRiskAssetsCount > 0 ? highRiskAssetsCount : undefined,
          },
        ]}
        actions={
          <>
            <div className="flex items-center gap-1 border-r border-line pr-2">
              <Button variant="ghost" size="sm" onClick={() => router.push('/engineering/vendors')}>{t('vendors.title')}</Button>
              {(isGM || role === 'chief_engineer') && <Button variant="ghost" size="sm" onClick={() => router.push('/engineering/insights?range=30d')}>{t('engineeringInsights.title')}</Button>}
            </div>
            {activeTab === 'work-orders' && (
              <>
                {canManageWO && (
                  <Button variant="primary" onClick={() => setShowCreateWO(true)} className="shrink-0">
                    <Plus className="w-4 h-4" />
                    {t('engineering.workOrdersPage.newWorkOrder')}
                  </Button>
                )}
              </>
            )}
            {activeTab === 'rooms-down' && canManageWO && (
              <>
                <Button variant="outline" onClick={() => setShowPlaceRoomDown(true)} className="shrink-0"><Plus className="w-4 h-4" />{t('engineering.roomsDown.placeRoomDown')}</Button>
                <Button variant="primary" onClick={() => setShowCreateWO(true)} className="shrink-0"><Plus className="w-4 h-4" />{t('engineering.workOrdersPage.newWorkOrder')}</Button>
              </>
            )}
            {activeTab === 'assets' && canEditAssets && (
              <Button variant="primary" onClick={() => setShowCreateAsset(true)} className="shrink-0">
                <Plus size={15} />
                {t('engineering.assetsPage.addAsset')}
              </Button>
            )}
            {activeTab === 'pm-schedules' && canEditPM && (
              <Button variant="primary" onClick={() => setShowCreatePM(true)} className="shrink-0">
                <Plus size={15} />
                {t('programs.pmSchedules.addPm')}
              </Button>
            )}
          </>
        }
      />

      {/* Tab content */}
      {activeTab === 'work-orders' ? (
            <WorkOrdersTab
              hotelId={hotelId}
              isEngineer={isEngineer}
              userId={user?.id}
              canManage={canManageWO}
              focusId={focusId}
              showCreateModal={showCreateWO}
              onCloseCreateModal={() => setShowCreateWO(false)}
              onRequestCreate={() => setShowCreateWO(true)}
              showArchiveModal={showArchiveWO}
              onCloseArchiveModal={() => setShowArchiveWO(false)}
              onRequestArchive={() => setShowArchiveWO(true)}
              onRequestReliability={() => setActiveTab('reliability')}
            />
      ) : activeTab === 'rooms-down' ? (
        <RoomsDownTab hotelId={hotelId} canManage={canManageWO} initialRoomId={roomId} onOpenWorkOrder={openWorkOrder} onRequestPlaceRoomDown={() => setShowPlaceRoomDown(true)} />
      ) : activeTab === 'assets' ? (
        <AssetsTab
          canEdit={canEditAssets}
          showCreateModal={showCreateAsset}
          onCloseCreateModal={() => setShowCreateAsset(false)}
          onRequestCreate={() => setShowCreateAsset(true)}
          initialAssetId={highlightAssetId}
        />
      ) : activeTab === 'pm-schedules' ? (
        <PMSchedulesTab
          canEdit={canEditPM}
          showCreateModal={showCreatePM}
          onCloseCreateModal={() => setShowCreatePM(false)}
          onRequestCreate={() => setShowCreatePM(true)}
        />
      ) : activeTab === 'reliability' ? (
        <PredictionsTab canManage={canManagePredictions} canAuthorize={canAuthorizePredictions} highlightAssetId={highlightAssetId} />
      ) : activeTab === 'parts' ? (
        <PartsPanel redesigned />
      ) : (
        <ArchivedWorkOrdersPanel redesigned />
      )}
      <PlaceRoomDownDrawer open={showPlaceRoomDown} onClose={() => setShowPlaceRoomDown(false)} />
    </div>
  )
}

export default function EngineeringPage() {
  return (
    <Suspense>
      <EngineeringPageContent />
    </Suspense>
  )
}
