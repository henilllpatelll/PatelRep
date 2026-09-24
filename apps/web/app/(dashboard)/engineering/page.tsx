'use client'

export const dynamic = 'force-dynamic'

import { Suspense, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { Plus, Archive } from 'lucide-react'
import { engineeringApi, type Asset, type PMSchedule, type FailurePrediction, type WorkOrderStats } from '@/lib/api/engineering'
import { useRole } from '@/lib/hooks/useRole'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/Button'
import { Stat } from '@/components/ui/primitives'
import { PageHeader } from '@/components/shared/PageHeader'
import { WorkOrdersTab } from '@/components/engineering/tabs/WorkOrdersTab'
import { AssetsTab } from '@/components/engineering/tabs/AssetsTab'
import { PMSchedulesTab } from '@/components/engineering/tabs/PMSchedulesTab'
import { PredictionsTab } from '@/components/engineering/tabs/PredictionsTab'
import { PartsPanel } from '@/components/engineering/PartsPanel'
import { ArchivedWorkOrdersPanel } from '@/components/engineering/ArchivedWorkOrdersPanel'
import { FailurePredictionSidebar } from '@/components/engineering/FailurePredictionSidebar'
import { RecurringIssuesSidebar } from '@/components/engineering/RecurringIssuesSidebar'

const VALID_TABS = ['work-orders', 'assets', 'pm-schedules', 'reliability', 'parts', 'archived'] as const
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

  const [activeTab, setActiveTab] = useState<EngineeringTab>(() => {
    const requested = searchParams.get('tab')
    if (requested === 'predictions') return 'reliability'
    return (VALID_TABS as readonly string[]).includes(requested ?? '') ? (requested as EngineeringTab) : 'work-orders'
  })
  const focusId = searchParams.get('focus')
  const highlightAssetId = searchParams.get('asset')

  const [showCreateWO, setShowCreateWO] = useState(false)
  const [showArchiveWO, setShowArchiveWO] = useState(false)
  const [showCreateAsset, setShowCreateAsset] = useState(false)
  const [showCreatePM, setShowCreatePM] = useState(false)

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
  const predictionsQ = useQuery({
    queryKey: ['failure-predictions-history'],
    queryFn: () => engineeringApi.getFailurePredictionHistory(),
    select: (res) => res.data as FailurePrediction[],
    enabled: !!hotelId,
  })

  const openCount = statsQ.data?.open ?? 0
  const escalatedCount = statsQ.data?.escalated ?? 0
  const overdueWOCount = statsQ.data?.overdue ?? 0
  const highRiskAssetsCount = (assetsQ.data ?? []).filter((a) => a.failure_risk_score >= 70).length
  const pmOverdueCount = (pmQ.data ?? []).filter((s) => new Date(s.next_due_at) < new Date()).length
  const activePredictionsCount = (predictionsQ.data ?? []).filter((p) => !p.is_acknowledged).length

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Engineering"
        title={t('engineering.workOrdersPage.heading')}
        subtitle={t('engineering.workOrdersPage.subtitleUnified')}
        dataI18nSkip
        tabs={[
          {
            label: t('engineering.workOrdersPage.tabWorkOrders'),
            active: activeTab === 'work-orders',
            onClick: () => setActiveTab('work-orders'),
            count: openCount + escalatedCount > 0 ? openCount + escalatedCount : undefined,
          },
          {
            label: t('engineering.workOrdersPage.tabAssets'),
            active: activeTab === 'assets',
            onClick: () => setActiveTab('assets'),
            count: highRiskAssetsCount > 0 ? highRiskAssetsCount : undefined,
          },
          {
            label: t('engineering.workOrdersPage.tabPreventive'),
            active: activeTab === 'pm-schedules',
            onClick: () => setActiveTab('pm-schedules'),
            count: pmOverdueCount > 0 ? pmOverdueCount : undefined,
          },
          {
            label: t('engineering.workOrdersPage.tabReliability'),
            active: activeTab === 'reliability',
            onClick: () => setActiveTab('reliability'),
            count: activePredictionsCount > 0 ? activePredictionsCount : undefined,
          },
        ]}
        actions={
          <>
            {activeTab === 'work-orders' && (
              <>
                {canManageWO && (
                  <Button variant="outline" onClick={() => setShowArchiveWO(true)} className="shrink-0">
                    <Archive className="w-4 h-4" />
                    {t('engineering.workOrdersPage.archiveAction')}
                  </Button>
                )}
                {canManageWO && (
                  <Button variant="primary" onClick={() => setShowCreateWO(true)} className="shrink-0">
                    <Plus className="w-4 h-4" />
                    {t('engineering.workOrdersPage.newWorkOrder')}
                  </Button>
                )}
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
                {t('programs.pmSchedules.addSchedule')}
              </Button>
            )}
          </>
        }
      />

      {/* Quiet operational summary — work flows stay in the queue below. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label={t('engineering.commandBar.statOpen')} value={openCount} />
        <Stat label={t('engineering.commandBar.statOverdue')} value={<span className={overdueWOCount > 0 ? 'text-[var(--alert)]' : undefined}>{overdueWOCount}</span>} />
        <Stat label={t('engineering.commandBar.statUnassigned')} value={<span className={statsQ.data?.unassigned ? 'text-[var(--alert)]' : undefined}>{statsQ.data?.unassigned ?? 0}</span>} />
        <Stat label={t('engineering.commandBar.statWaiting')} value={<span className={statsQ.data?.on_hold ? 'text-[var(--caution)]' : undefined}>{statsQ.data?.on_hold ?? 0}</span>} />
      </div>

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
            />
      ) : activeTab === 'assets' ? (
        <AssetsTab
          canEdit={canEditAssets}
          showCreateModal={showCreateAsset}
          onCloseCreateModal={() => setShowCreateAsset(false)}
          onRequestCreate={() => setShowCreateAsset(true)}
        />
      ) : activeTab === 'pm-schedules' ? (
        <PMSchedulesTab
          canEdit={canEditPM}
          showCreateModal={showCreatePM}
          onCloseCreateModal={() => setShowCreatePM(false)}
          onRequestCreate={() => setShowCreatePM(true)}
        />
      ) : activeTab === 'reliability' ? (
        <div className="space-y-6"><PredictionsTab canManage={canManagePredictions} canAuthorize={canAuthorizePredictions} highlightAssetId={highlightAssetId} /><div className="grid gap-6 xl:grid-cols-2"><FailurePredictionSidebar /><RecurringIssuesSidebar /></div></div>
      ) : activeTab === 'parts' ? (
        <PartsPanel redesigned />
      ) : (
        <ArchivedWorkOrdersPanel redesigned />
      )}
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
