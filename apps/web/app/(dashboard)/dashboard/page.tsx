'use client'
import { useRole } from '@/lib/hooks/useRole'
import { HousekeeperDashboard } from '@/components/dashboard/HousekeeperDashboard'
import { SupervisorDashboard } from '@/components/dashboard/SupervisorDashboard'
import { EngineerDashboard } from '@/components/dashboard/EngineerDashboard'
import { FrontDeskDashboard } from '@/components/dashboard/FrontDeskDashboard'
import { ChiefEngineerDashboard } from '@/components/dashboard/ChiefEngineerDashboard'
import { GMDashboard } from '@/components/dashboard/GMDashboard'
import { useAuthStore } from '@/stores/authStore'

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
