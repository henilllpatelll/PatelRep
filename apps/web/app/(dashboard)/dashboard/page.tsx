'use client'
import { useState, useEffect } from 'react'
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
import { useAuthStore } from '@/stores/authStore'

function GMDashboard() {
  const { hotel } = useHotelStore()
  const [greeting, setGreeting] = useState('Good morning')
  useEffect(() => {
    const h = new Date().getHours()
    if (h < 12) setGreeting('Good morning')
    else if (h < 18) setGreeting('Good afternoon')
    else setGreeting('Good evening')
  }, [])
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[28px] font-bold text-[#1C1208] tracking-[-0.02em] leading-tight">
          {greeting}{hotel ? `, ${hotel.name}` : ''}!
        </h1>
        <p className="text-xs font-semibold text-amber-500 mt-1.5 uppercase tracking-[0.12em]" suppressHydrationWarning>
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
  const isAuthLoading = useAuthStore((state) => state.isLoading)

  if (isAuthLoading || !role) {
    return (
      <div className="space-y-4">
        <div className="h-9 w-64 rounded-lg bg-stone-100 animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 rounded-2xl bg-stone-100 animate-pulse" />
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
    case 'chief_engineer':
      return <ChiefEngineerDashboard />
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
