'use client'
import { useRole } from '@/lib/hooks/useRole'
import { ROIMetricsStrip } from '@/components/dashboard/ROIMetricsStrip'
import { AIRiskAlertsPanel } from '@/components/dashboard/AIRiskAlertsPanel'
import { LiveOpsGrid } from '@/components/dashboard/LiveOpsGrid'
import { TrendChartsRow } from '@/components/dashboard/TrendChartsRow'
import { HousekeeperDashboard } from '@/components/dashboard/HousekeeperDashboard'
import { SupervisorDashboard } from '@/components/dashboard/SupervisorDashboard'
import { EngineerDashboard } from '@/components/dashboard/EngineerDashboard'
import { ChiefEngineerDashboard } from '@/components/dashboard/ChiefEngineerDashboard'
import { FrontDeskDashboard } from '@/components/dashboard/FrontDeskDashboard'
import { useHotelStore } from '@/stores/hotelStore'

function GMDashboard() {
  const { hotel } = useHotelStore()
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[28px] font-bold text-[#1C1208] tracking-[-0.02em] leading-tight">
          Good morning{hotel ? `, ${hotel.name}` : ''}!
        </h1>
        <p className="text-xs font-semibold text-amber-500 mt-1.5 uppercase tracking-[0.12em]">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
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

  switch (role) {
    case 'housekeeper':
      return <HousekeeperDashboard />
    case 'housekeeping_supervisor':
      return <SupervisorDashboard />
    case 'engineer':
      return <EngineerDashboard />
    case 'chief_engineer':
      return <ChiefEngineerDashboard />
    case 'front_desk':
      return <FrontDeskDashboard />
    case 'gm':
    default:
      return <GMDashboard />
  }
}
