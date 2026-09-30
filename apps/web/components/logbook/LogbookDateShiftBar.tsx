'use client'

import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Shift } from '@/lib/api/scheduling'
import { Button, IconButton } from '@/components/ui/Button'
import { formatShiftTime } from '@/lib/utils/logbookWorkspace'

interface LogbookDateShiftBarProps {
  dateLabel: string
  isToday: boolean
  onPreviousDay: () => void
  onNextDay: () => void
  onToday: () => void
  selectedDate: string
  onDateChange: (date: string) => void
  shifts: Shift[]
  selectedShiftId: string | null
  onShiftChange: (shiftId: string | null) => void
  isLoadingShifts: boolean
  isShiftListUnavailable: boolean
}

export function LogbookDateShiftBar({
  dateLabel,
  isToday,
  onPreviousDay,
  onNextDay,
  onToday,
  selectedDate,
  onDateChange,
  shifts,
  selectedShiftId,
  onShiftChange,
  isLoadingShifts,
  isShiftListUnavailable,
}: LogbookDateShiftBarProps) {
  const { t, i18n } = useTranslation()
  const selectedShift = shifts.find((shift) => shift.id === selectedShiftId)

  return (
    <section aria-label={t('logbook.dateAndShift')} className="rounded-[var(--r-lg)] border border-line bg-surface p-3 sm:p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-1.5">
          <IconButton variant="outline" size="sm" onClick={onPreviousDay} aria-label={t('logbook.previousDay')}>
            <ChevronLeft className="size-4" />
          </IconButton>
          <Button variant="ghost" size="sm" onClick={onToday} aria-pressed={isToday} className="font-mono text-[11px] uppercase tracking-[0.08em]">
            {dateLabel}
          </Button>
          <label className="relative inline-flex cursor-pointer items-center" title={t('logbook.chooseDate')}>
            <span className="sr-only">{t('logbook.chooseDate')}</span>
            <CalendarDays className="pointer-events-none absolute left-2 size-4 text-ink3" aria-hidden="true" />
            <input type="date" value={selectedDate} max={new Date().toISOString().slice(0, 10)} onChange={(event) => onDateChange(event.target.value)} aria-label={t('logbook.chooseDate')} className="h-8 w-9 cursor-pointer rounded border border-line bg-surface pl-8 opacity-0 focus:opacity-100 focus:ring-2 focus:ring-[var(--focus-ring)]" />
          </label>
          <IconButton variant="outline" size="sm" onClick={onNextDay} disabled={isToday} aria-label={t('logbook.nextDay')}>
            <ChevronRight className="size-4" />
          </IconButton>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
          <label className="sr-only" htmlFor="logbook-shift-select">{t('logbook.shift')}</label>
          <div className="relative min-w-[190px]">
            <select
              id="logbook-shift-select"
              value={selectedShiftId ?? 'all'}
              onChange={(event) => onShiftChange(event.target.value === 'all' ? null : event.target.value)}
              disabled={isLoadingShifts || isShiftListUnavailable}
              className="min-h-9 w-full appearance-none rounded-[var(--r-md)] border border-line bg-surface py-2 pl-3 pr-9 text-sm font-medium text-ink outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="all">{t('logbook.allShifts')}</option>
              {shifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.name}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink3" aria-hidden="true" />
          </div>
          {selectedShift && (
            <span className="font-mono text-xs tabular-nums text-ink3">
              {formatShiftTime(selectedShift.start_time, i18n.language)} – {formatShiftTime(selectedShift.end_time, i18n.language)}
            </span>
          )}
        </div>
      </div>
    </section>
  )
}
