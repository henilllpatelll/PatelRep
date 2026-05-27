'use client'

import { useQuery } from '@tanstack/react-query'
import { useHotelStore } from '@/stores/hotelStore'
import { staffApi } from '@/lib/api/staff'
import type { UserRole } from '@/stores/authStore'
import { Card } from '@/components/ui/Card'

// ─── Constants ────────────────────────────────────────────────────────────────

interface DepartmentConfig {
  name: string
  color: string
  description: string
  roles: UserRole[]
}

const DEPARTMENTS: DepartmentConfig[] = [
  {
    name: 'Housekeeping',
    color: 'bg-teal-500',
    description: 'Room cleaning and laundry',
    roles: ['housekeeper', 'housekeeping_supervisor'],
  },
  {
    name: 'Engineering',
    color: 'bg-sky-500',
    description: 'Maintenance and repairs',
    roles: ['engineer', 'chief_engineer'],
  },
  {
    name: 'Front Desk',
    color: 'bg-amber-400',
    description: 'Guest services and check-in',
    roles: ['front_desk'],
  },
  {
    name: 'Management',
    color: 'bg-violet-500',
    description: 'Hotel operations and oversight',
    roles: ['gm'],
  },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DepartmentsSettingsPage() {
  const { hotel } = useHotelStore()

  const { data: staff, isLoading } = useQuery({
    queryKey: ['staff'],
    queryFn: () => staffApi.list(),
    enabled: !!hotel?.id,
    select: res => res.data.staff,
  })

  function countForDept(roles: UserRole[]): number {
    if (!staff) return 0
    return staff.filter(s => roles.includes(s.role as UserRole)).length
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h2 className="text-base font-semibold text-stone-900">Departments</h2>
        <p className="text-sm text-stone-500 mt-1">
          Staff are organized into departments based on their role.
        </p>
      </div>

      <Card className="overflow-hidden p-0 divide-y divide-stone-100">
        {DEPARTMENTS.map(dept => {
          const count = countForDept(dept.roles)
          return (
            <div
              key={dept.name}
              className="flex items-center gap-4 px-6 py-4 hover:bg-[var(--caution-soft)]/30 transition-colors"
            >
              <div className={`w-3 h-3 rounded-full ${dept.color} shrink-0`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-stone-900">{dept.name}</p>
                <p className="text-xs text-stone-500 mt-0.5">{dept.description}</p>
              </div>
              {isLoading ? (
                <div className="h-5 w-14 rounded-full bg-stone-100 animate-pulse" />
              ) : (
                <span className="text-xs text-stone-500 bg-stone-100 px-2.5 py-1 rounded-full shrink-0">
                  {count} staff
                </span>
              )}
            </div>
          )
        })}
      </Card>

      <p className="text-xs text-stone-400 px-1">
        Department customization is available on request. Contact support to add or rename departments.
      </p>
    </div>
  )
}
