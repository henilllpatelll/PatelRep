'use client'

import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Department } from '@/lib/api/logbook'

interface LogbookFiltersProps {
  departments: Department[]
  selectedDepartmentId: string | null
  onDepartmentChange: (departmentId: string | null) => void
  isUnavailable: boolean
}

export function LogbookFilters({ departments, selectedDepartmentId, onDepartmentChange, isUnavailable }: LogbookFiltersProps) {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="logbook-department-select" className="text-xs font-medium text-ink3">{t('logbook.department')}</label>
      <div className="relative min-w-[210px]">
        <select
          id="logbook-department-select"
          value={selectedDepartmentId ?? 'all'}
          onChange={(event) => onDepartmentChange(event.target.value === 'all' ? null : event.target.value)}
          disabled={isUnavailable}
          className="min-h-9 w-full appearance-none rounded-[var(--r-md)] border border-line bg-surface py-2 pl-3 pr-9 text-sm text-ink outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <option value="all">{t('logbook.allDepartments')}</option>
          {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink3" aria-hidden="true" />
      </div>
    </div>
  )
}
