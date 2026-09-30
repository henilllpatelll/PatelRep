'use client'

import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export type LogbookStatusFilterValue = 'all' | 'needs_follow_up' | 'important' | 'resolved'

const OPTIONS: LogbookStatusFilterValue[] = ['all', 'needs_follow_up', 'important', 'resolved']

interface LogbookStatusFilterProps {
  value: LogbookStatusFilterValue
  onChange: (value: LogbookStatusFilterValue) => void
}

export function LogbookStatusFilter({ value, onChange }: LogbookStatusFilterProps) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('logbook.activity')}>
      {OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={value === option}
          className={cn(
            'rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors',
            value === option ? 'bg-accent text-white border-accent' : 'bg-surface border-line text-ink2 hover:bg-surface-2',
          )}
        >
          {t(`logbook.filters.${option}`)}
        </button>
      ))}
    </div>
  )
}
