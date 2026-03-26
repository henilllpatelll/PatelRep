'use client'
import { ROIMetricsStrip } from '@/components/dashboard/ROIMetricsStrip'
import { AIRiskAlertsPanel } from '@/components/dashboard/AIRiskAlertsPanel'
import { LiveOpsGrid } from '@/components/dashboard/LiveOpsGrid'
import { TrendChartsRow } from '@/components/dashboard/TrendChartsRow'
import { useHotelStore } from '@/stores/hotelStore'

export default function DashboardPage() {
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
