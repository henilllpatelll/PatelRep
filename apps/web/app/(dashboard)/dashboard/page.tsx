'use client'
import { useRole } from '@/lib/hooks/useRole'
import { SimplifiedDashboard } from '@/components/dashboard/SimplifiedDashboard'
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

  return <SimplifiedDashboard />
}
