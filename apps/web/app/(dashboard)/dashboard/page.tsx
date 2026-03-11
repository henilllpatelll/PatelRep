'use client'
import { useEffect, useState } from 'react'
import { ROIMetricsStrip } from '@/components/dashboard/ROIMetricsStrip'
import { AIRiskAlertsPanel } from '@/components/dashboard/AIRiskAlertsPanel'
import { LiveOpsGrid } from '@/components/dashboard/LiveOpsGrid'
import { TrendChartsRow } from '@/components/dashboard/TrendChartsRow'
import { useHotelStore } from '@/stores/hotelStore'

export default function DashboardPage() {
  const { hotel } = useHotelStore()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Good morning{hotel ? `, ${hotel.name}` : ''}!
        </h1>
        <p className="text-gray-500 text-sm mt-1">
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
