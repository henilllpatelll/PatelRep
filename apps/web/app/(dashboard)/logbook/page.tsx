'use client'

import { useMemo, useState, useEffect, useRef, Suspense } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  BookOpen,
  Plus,
  ChevronLeft,
  ChevronRight,
  X,
  AlertCircle,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Clock,
  Check,
  Search,
} from 'lucide-react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, formatDistanceToNow } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { logbookApi, LogbookEntry } from '@/lib/api/logbook'
import { staffApi } from '@/lib/api/staff'
import { useRole } from '@/lib/hooks/useRole'
import { schedulingApi } from '@/lib/api/scheduling'
import { useAuthStore } from '@/stores/authStore'
import { useHotelStore } from '@/stores/hotelStore'
import { isSectionRedesigned } from '@/lib/utils/redesignFlag'
import { KebabMenu } from '@/components/shared/KebabMenu'
import { DeleteConfirmDialog } from '@/components/shared/DeleteConfirmDialog'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'
import { Pill, Mono, SectionLabel, AILabel } from '@/components/ui/primitives'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button, IconButton } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { StateBlock } from '@/components/ui/StateBlock'
import { Skeleton } from '@/components/ui/Skeleton'
import { getLogbookCapabilities } from '@/lib/utils/logbookCapabilities'
import { getNextShift, getRelevantShift, sortOperationalShifts } from '@/lib/utils/logbookWorkspace'
import { LogbookDateShiftBar } from '@/components/logbook/LogbookDateShiftBar'
import { LogbookFilters } from '@/components/logbook/LogbookFilters'
import { LogbookHandoffCard } from '@/components/logbook/LogbookHandoffCard'
import { LogbookActivityFeed } from '@/components/logbook/LogbookActivityFeed'
import { AddHandoffDrawer } from '@/components/logbook/AddHandoffDrawer'
import { NeedsNextShift } from '@/components/logbook/NeedsNextShift'
import { LogbookEntryDetailDrawer } from '@/components/logbook/LogbookEntryDetailDrawer'
import { LogbookStatusFilter, type LogbookStatusFilterValue } from '@/components/logbook/LogbookStatusFilter'
import { ShiftHandoffDrawer } from '@/components/logbook/ShiftHandoffDrawer'
import { LogbookSearchWorkspace } from '@/components/logbook/LogbookSearchWorkspace'
import { hasLogbookSearchState, logbookSearchParams, parseLogbookSearchParams, type LogbookSearchFilters } from '@/lib/utils/logbookSearch'

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function hotelLocalDateParts(timeZone?: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date()).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  )
}

function todayIso(timeZone?: string): string {
  const parts = hotelLocalDateParts(timeZone)
  return `${parts.year}-${parts.month}-${parts.day}`
}

function hotelClock(timeZone?: string): Date {
  const parts = hotelLocalDateParts(timeZone)
  return new Date(2000, 0, 1, Number(parts.hour), Number(parts.minute))
}

function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function prevDay(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  const d = new Date(year, month - 1, day)
  d.setDate(d.getDate() - 1)
  return formatLocalDate(d)
}

function nextDay(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  const d = new Date(year, month - 1, day)
  d.setDate(d.getDate() + 1)
  return formatLocalDate(d)
}

function formatDisplayDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  const d = new Date(year, month - 1, day)
  return format(d, 'MMM d, yyyy')
}

function formatDateControlLabel(dateStr: string, today: string, locale: string, todayLabel: string): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (dateStr === today) {
    const shortDate = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date).toUpperCase()
    return `${todayLabel.toUpperCase()} · ${shortDate}`
  }
  return new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric' }).format(date).toUpperCase()
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && /404|not found/i.test(error.message)
}

// â”€â”€ Expiry Picker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface ExpiryPickerProps {
  value: number  // total hours; 0 = no expiry
  onChange: (hours: number) => void
}

function ExpiryPicker({ value, onChange }: ExpiryPickerProps) {
  const isCustom = value > 0
  // Derive unit + amount from stored hours
  const [unit, setUnit] = useState<'hours' | 'days'>(value > 0 && value % 24 === 0 ? 'days' : 'hours')
  const [amount, setAmount] = useState(
    value > 0 ? (value % 24 === 0 ? value / 24 : value) : 1
  )

  function handleModeChange(custom: boolean) {
    if (!custom) { onChange(0); return }
    onChange(unit === 'hours' ? amount : amount * 24)
  }

  function handleAmountChange(n: number) {
    const safe = Math.max(1, n)
    setAmount(safe)
    onChange(unit === 'hours' ? safe : safe * 24)
  }

  function handleUnitChange(u: 'hours' | 'days') {
    setUnit(u)
    onChange(u === 'hours' ? amount : amount * 24)
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => handleModeChange(false)}
          className={`flex-1 py-1.5 text-sm rounded-lg border font-medium transition-colors ${
            !isCustom
              ? 'bg-gray-800 text-white border-gray-800'
              : 'bg-surface text-gray-600 border-gray-200 hover:bg-gray-50'
          }`}
        >
          No expiry
        </button>
        <button
          type="button"
          onClick={() => handleModeChange(true)}
          className={`flex-1 py-1.5 text-sm rounded-lg border font-medium transition-colors ${
            isCustom
              ? 'bg-[var(--caution)] text-white border-amber-500'
              : 'bg-surface text-gray-600 border-gray-200 hover:bg-gray-50'
          }`}
        >
          Custom
        </button>
      </div>
      {isCustom && (
        <div className="flex gap-2">
          <input
            type="number"
            min={1}
            value={amount}
            onChange={(e) => handleAmountChange(Number(e.target.value))}
            className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50"
          />
          <select
            value={unit}
            onChange={(e) => handleUnitChange(e.target.value as 'hours' | 'days')}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-amber-400/50"
          >
            <option value="hours">hours</option>
            <option value="days">days</option>
          </select>
        </div>
      )}
    </div>
  )
}

// â”€â”€ Entry card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface EntryCardProps {
  entry: LogbookEntry
  canEdit: boolean
  onEdit: (entry: LogbookEntry) => void
  onDelete: (entry: LogbookEntry) => void
}

function EntryCard({ entry, canEdit, onEdit, onDelete }: EntryCardProps) {
  const authorName =
    entry.user_profiles?.preferred_name ??
    entry.user_profiles?.full_name ??
    'Unknown'
  const deptName = entry.departments?.name ?? 'General'
  const time = format(new Date(entry.created_at), 'h:mm a')

  return (
    <div className="bg-surface border border-line shadow-sm rounded-[var(--r-lg)] p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2 text-xs text-gray-500">
            <Mono className="text-[11px] text-ink3">{time}</Mono>
            <span aria-hidden="true">·</span>
            <span>{authorName}</span>
            <span aria-hidden="true">·</span>
            <Pill tone="neutral">{deptName}</Pill>
            {entry.expires_at && (
              <>
                <span aria-hidden="true">·</span>
                <span className="flex items-center gap-1 text-[var(--caution)]">
                  <Clock className="w-3 h-3" />
                  expires {formatDistanceToNow(new Date(entry.expires_at), { addSuffix: true })}
                </span>
              </>
            )}
          </div>
          <p className={`text-sm leading-relaxed whitespace-pre-wrap ${entry.is_ai_generated ? "font-display italic text-[15px] leading-[1.4] text-gray-800" : "text-sm text-gray-800 leading-relaxed whitespace-pre-wrap"}`}>
            {entry.content}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {entry.is_ai_generated && (
            <AILabel />
          )}
          {canEdit && (
            <KebabMenu onEdit={() => onEdit(entry)} onDelete={() => onDelete(entry)} />
          )}
        </div>
      </div>
    </div>
  )
}

// â”€â”€ Skeleton â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function SkeletonCard() {
  return (
    <div className="bg-surface border border-line shadow-sm rounded-[var(--r-lg)] p-4 animate-pulse">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-3 bg-gray-100 rounded w-16" />
        <div className="h-3 bg-gray-100 rounded w-1 mx-1" />
        <div className="h-3 bg-gray-100 rounded w-24" />
        <div className="h-3 bg-gray-100 rounded w-1 mx-1" />
        <div className="h-5 bg-gray-100 rounded w-20" />
      </div>
      <div className="space-y-2">
        <div className="h-3 bg-gray-100 rounded w-full" />
        <div className="h-3 bg-gray-100 rounded w-5/6" />
        <div className="h-3 bg-gray-100 rounded w-3/4" />
      </div>
    </div>
  )
}

function SkeletonCardV2() {
  return (
    <div className="bg-surface border border-line rounded-[var(--r-lg)] p-4">
      <div className="flex items-center gap-2 mb-3">
        <Skeleton variant="text" className="h-3 w-16" />
        <Skeleton variant="text" className="h-3 w-24" />
        <Skeleton variant="text" className="h-5 w-20" />
      </div>
      <div className="space-y-2">
        <Skeleton variant="text" className="w-full" />
        <Skeleton variant="text" className="w-5/6" />
        <Skeleton variant="text" className="w-3/4" />
      </div>
    </div>
  )
}

// â”€â”€ AI Summary Panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface AISummaryPanelProps {
  shiftDate: string
  isSupervisor: boolean
}

function AISummaryPanel({ shiftDate, isSupervisor }: AISummaryPanelProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [isOpen, setIsOpen] = useState(false)
  const [summaryText, setSummaryText] = useState<string | null>(null)
  const [stats, setStats] = useState<{ tasks_completed: number; open_work_orders: number } | null>(null)
  const [generateError, setGenerateError] = useState<string | null>(null)

  const generateMutation = useMutation({
    mutationFn: () => logbookApi.generateShiftSummary({ shift_date: shiftDate }),
    onSuccess: (res) => {
      setSummaryText(res.data.summary_text)
      setStats({ tasks_completed: res.data.tasks_completed ?? res.data.stats.tasks_completed, open_work_orders: res.data.open_work_orders ?? res.data.stats.open_work_orders })
      setGenerateError(null)
      queryClient.invalidateQueries({ queryKey: ['shift-summary-ack', shiftDate] })
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Failed to generate summary.'
      setGenerateError(msg)
    },
  })

  // Look this date's summary up as soon as the panel opens — not gated on a fresh
  // in-session generate — so an already-generated summary (cron, or an earlier
  // click before a reload) shows immediately instead of prompting a redundant
  // regenerate. A 404 (no stored row yet) resolves fast to "no summary" — retry:false.
  const ackQuery = useQuery({
    queryKey: ['shift-summary-ack', shiftDate],
    queryFn: () => logbookApi.getCurrentShiftSummary(shiftDate),
    enabled: isOpen,
    retry: false,
    select: (res) => res.data,
  })

  useEffect(() => {
    if (ackQuery.data?.summary_text) {
      setSummaryText(ackQuery.data.summary_text)
      setStats({
        tasks_completed: ackQuery.data.stats?.tasks_completed ?? 0,
        open_work_orders: ackQuery.data.stats?.open_work_orders ?? 0,
      })
    }
  }, [ackQuery.data])

  const ackId = ackQuery.data?.id
  const acknowledgedAt = ackQuery.data?.acknowledged_at ?? null
  const acknowledgedByName = ackQuery.data?.acknowledged_by_name ?? null

  const acknowledgeMutation = useMutation({
    mutationFn: (id: string) => logbookApi.acknowledgeShiftSummary(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shift-summary-ack', shiftDate] })
    },
  })

  if (!isSupervisor) return null

  return (
    <div className="rounded-xl border border-[var(--caution-line)] bg-[var(--caution-soft)] overflow-hidden">
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--caution-soft)] transition-colors"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <Sparkles size={16} className="text-[var(--caution)] shrink-0" />
          <span className="text-sm font-semibold text-amber-800">Today's AI Shift Summary</span>
          <AILabel />
          {!isOpen && (
            summaryText ? (
              <span className="text-xs text-ink3 truncate hidden sm:inline">
                {summaryText.slice(0, 80)}{summaryText.length > 80 ? '…' : ''}
              </span>
            ) : (
              <span className="text-xs text-ink3 hidden sm:inline">
                Generates at shift end (7 AM · 3 PM · 11 PM)
              </span>
            )
          )}
        </div>
        {isOpen ? (
          <ChevronUp size={16} className="text-[var(--caution)] shrink-0" />
        ) : (
          <ChevronDown size={16} className="text-[var(--caution)] shrink-0" />
        )}
      </button>

      {isOpen && (
        <div className="px-4 pb-4 border-t border-[var(--caution-line)]">
          {summaryText ? (
            <div className="mt-3 space-y-3">
              {stats && (
                <div className="flex items-center gap-4 text-xs text-[var(--caution)]">
                  <span>
                    <span className="font-semibold">{stats.tasks_completed}</span> tasks completed
                  </span>
                  <span>
                    <span className="font-semibold">{stats.open_work_orders}</span> open work orders
                  </span>
                </div>
              )}
              <Card hover={false} className="border-[var(--caution-line)] p-4">
                <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                  {summaryText}
                </p>
              </Card>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  loading={generateMutation.isPending}
                  onClick={() => {
                    setSummaryText(null)
                    setStats(null)
                    generateMutation.mutate()
                  }}
                  className="gap-1.5 text-[var(--caution)] hover:text-amber-800"
                >
                  <Sparkles size={12} />
                  Regenerate
                </Button>
                {ackId && (
                  acknowledgedAt ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-ink3">
                      <Check size={13} className="text-[var(--ready)]" />
                      {t('logbook.acknowledgedBy', {
                        name: acknowledgedByName ?? t('logbook.acknowledgedFallback'),
                        time: formatDistanceToNow(new Date(acknowledgedAt), { addSuffix: true }),
                      })}
                    </span>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      loading={acknowledgeMutation.isPending}
                      onClick={() => acknowledgeMutation.mutate(ackId)}
                      className="gap-1.5"
                    >
                      <Check size={13} />
                      {t('logbook.acknowledge')}
                    </Button>
                  )
                )}
              </div>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <p className="text-sm text-[var(--caution)]">
                Generate an AI-powered shift handoff summary based on today's logbook entries, completed tasks, and open work orders.
              </p>
              {generateError && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-[var(--alert-soft)] border border-[var(--alert-line)]">
                  <AlertCircle size={14} className="text-[var(--alert)] mt-0.5 shrink-0" />
                  <p className="text-xs text-[var(--alert)]">{generateError}</p>
                </div>
              )}
              <Button
                variant="primary"
                loading={generateMutation.isPending}
                onClick={() => generateMutation.mutate()}
                className="gap-2 bg-[var(--caution)] hover:bg-amber-600"
              >
                <Sparkles size={14} />
                Generate for today
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// â”€â”€ Create Entry Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface CreateEntryModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  deptMap: Record<string, string>
}

function CreateEntryModal({ isOpen, onClose, onSuccess, deptMap }: CreateEntryModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [deptId, setDeptId] = useState('')
  const [content, setContent] = useState('')
  const [expiresHours, setExpiresHours] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const deptEntries = useMemo(() => Object.entries(deptMap), [deptMap])
  const firstDeptId = deptEntries[0]?.[0] ?? ''

  useEffect(() => {
    if (isOpen) {
      setDeptId(firstDeptId)
      setContent('')
      setExpiresHours(0)
      setError(null)
    }
  }, [firstDeptId, isOpen])

  // When departments load while modal is already open, set the first dept
  useEffect(() => {
    if (isOpen && !deptId && firstDeptId) {
      setDeptId(firstDeptId)
    }
  }, [deptId, firstDeptId, isOpen])

  useModalFocusTrap(dialogRef, isOpen, onClose)

  const mutation = useMutation({
    mutationFn: () =>
      logbookApi.createEntry({
        department_id: deptId,
        content: content.trim(),
        expires_hours: expiresHours > 0 ? expiresHours : undefined,
      }),
    onSuccess: () => {
      onSuccess()
      onClose()
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Failed to create entry.'
      setError(msg)
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!deptId.trim()) { setError('Department is required.'); return }
    mutation.mutate()
  }

  if (!isOpen) return null

  return (
    <>
      <div className="fixed inset-0 bg-stone-900/20 backdrop-blur-sm z-50" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Add logbook entry"
          tabIndex={-1}
          className="bg-surface/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-[var(--r-lg)] shadow-xl w-full max-w-lg p-6"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[var(--caution)] flex items-center justify-center shrink-0">
                <BookOpen size={16} className="text-white" />
              </div>
              <h2 className="text-base font-bold text-gray-900">Add Logbook Entry</h2>
            </div>
            <IconButton variant="ghost" size="sm" onClick={onClose} aria-label="Close modal" className="text-gray-400 hover:text-gray-600">
              <X size={18} />
            </IconButton>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Department <span className="text-[var(--alert)]">*</span>
              </label>
              {deptEntries.length > 0 ? (
                <select
                  value={deptId}
                  onChange={(e) => setDeptId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                  required
                >
                  {deptEntries.map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={deptId}
                  onChange={(e) => setDeptId(e.target.value)}
                  placeholder="Department UUID"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                  required
                />
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Entry <span className="text-[var(--alert)]">*</span>
              </label>
              <textarea
                rows={5}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Describe what happened during your shift…"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50 resize-none"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-1.5">
                <Clock size={13} className="text-gray-400" />
                Auto-delete after
              </label>
              <ExpiryPicker value={expiresHours} onChange={setExpiresHours} />
            </div>

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-[var(--alert-soft)] border border-[var(--alert-line)]">
                <AlertCircle size={15} className="text-[var(--alert)] mt-0.5 shrink-0" />
                <p className="text-sm text-[var(--alert)]">{error}</p>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
              <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                loading={mutation.isPending}
                disabled={!content.trim() || !deptId.trim()}
                className="gap-2"
              >
                <Plus size={14} />Add Entry
              </Button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}

// â”€â”€ Edit Entry Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface EditEntryModalProps {
  entry: LogbookEntry | null
  onClose: () => void
  onSaved: () => void
}

function EditEntryModal({ entry, onClose, onSaved }: EditEntryModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [initialNow] = useState(() => Date.now())
  const currentExpiresHours = (() => {
    if (!entry?.expires_at) return 0
    const remaining = Math.ceil((new Date(entry.expires_at).getTime() - initialNow) / 3_600_000)
    // Snap to nearest option or default to 24
    if (remaining <= 8) return 8
    if (remaining <= 24) return 24
    if (remaining <= 48) return 48
    return 168
  })()

  const [content, setContent] = useState(entry?.content ?? '')
  const [expiresHours, setExpiresHours] = useState(currentExpiresHours)
  const [error, setError] = useState<string | null>(null)

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      logbookApi.updateEntry(entry!.id, {
        content: content.trim(),
        expires_hours: expiresHours,
      }),
    onSuccess: () => { setError(null); onSaved() },
    onError: (err: Error) => setError(err.message || 'Failed to save'),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    mutate()
  }

  useModalFocusTrap(dialogRef, !!entry, onClose)
  if (!entry) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-stone-900/20 backdrop-blur-sm" onClick={onClose} />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="edit-entry-title" tabIndex={-1} className="relative bg-surface/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-[var(--r-lg)] shadow-xl w-full max-w-lg mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 id="edit-entry-title" className="text-base font-bold text-gray-900">Edit Entry</h2>
          <IconButton variant="ghost" size="sm" onClick={onClose} aria-label="Close" className="text-gray-500 hover:bg-gray-100">
            <X className="w-4 h-4" />
          </IconButton>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Entry <span className="text-[var(--alert)]">*</span>
            </label>
            <textarea
              rows={5}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50 resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-1.5">
              <Clock size={13} className="text-gray-400" />
              Auto-delete after
            </label>
            <ExpiryPicker value={expiresHours} onChange={setExpiresHours} />
          </div>

          {error && <p className="text-sm text-[var(--alert)] bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-3 pt-1 border-t border-gray-100">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={isPending}
              disabled={!content.trim()}
              className="flex-1"
            >
              Save Changes
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// â”€â”€ Page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function LogbookPageContent() {
  const { t, i18n } = useTranslation()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const hotel = useHotelStore((s) => s.hotel)
  const v2 = isSectionRedesigned('logbook', hotel)
  const [today, setToday] = useState('')
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null)
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editTarget, setEditTarget] = useState<LogbookEntry | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<LogbookEntry | null>(null)
  const [detailEntry, setDetailEntry] = useState<LogbookEntry | null>(null)
  const [detailStartInEdit, setDetailStartInEdit] = useState(false)
  const [showShiftHandoff, setShowShiftHandoff] = useState(false)
  const [statusFilter, setStatusFilter] = useState<LogbookStatusFilterValue>('all')
  const [searchRequested, setSearchRequested] = useState(false)
  const [mounted, setMounted] = useState(false)
  const { isSupervisor, isGM, role } = useRole()
  const capabilities = getLogbookCapabilities(role)
  const searchFilters = useMemo(() => parseLogbookSearchParams(new URLSearchParams(searchParams.toString())), [searchParams])
  const searchMode = v2 && (searchRequested || hasLogbookSearchState(searchFilters))

  useEffect(() => {
    const entryId = searchParams.get('entry')
    if (!entryId || detailEntry?.id === entryId) return
    void logbookApi.getEntry(entryId).then((response) => openEntryDetail(response.data)).catch(() => undefined)
  }, [searchParams, detailEntry?.id])

  useEffect(() => {
    const onPopState = () => {
      if (!hasLogbookSearchState(parseLogbookSearchParams(new URLSearchParams(window.location.search)))) setSearchRequested(false)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    // Wait for the property timezone before initializing the workspace date.
    // Otherwise a UTC browser can pin the feed to a different hotel-local day.
    if (!hotel?.timezone) return
    const currentDate = todayIso(hotel?.timezone)
    setToday(currentDate)
    setSelectedDate((prev) => prev || currentDate)
    setMounted(true)
  }, [hotel?.timezone])

  const session = useAuthStore((s) => s.session)
  const currentUserId: string = session?.user?.id ?? ''
  const hotelId: string = (() => {
    if (!session?.access_token) return hotel?.id ?? ''
    try {
      return JSON.parse(atob(session.access_token.split('.')[1]))?.hotel_id ?? hotel?.id ?? ''
    } catch {
      return hotel?.id ?? ''
    }
  })()

  const queryClient = useQueryClient()

  const departmentsQuery = useQuery({
    queryKey: ['hotel-departments', hotelId],
    queryFn: () => logbookApi.listDepartments(hotelId),
    enabled: !!hotelId,
    staleTime: 5 * 60 * 1000,
    select: (res) => res.data,
  })
  const deptsData = departmentsQuery.data

  const shiftsQuery = useQuery({
    queryKey: ['logbook-shifts'],
    queryFn: () => schedulingApi.listShifts({ is_active: true }),
    select: (res) => sortOperationalShifts(res.data),
    staleTime: 5 * 60 * 1000,
  })
  const shifts = useMemo(() => shiftsQuery.data ?? [], [shiftsQuery.data])

  const staffQuery = useQuery({
    queryKey: ['logbook-search-staff'],
    queryFn: () => staffApi.list(),
    enabled: v2 && searchMode,
    staleTime: 5 * 60 * 1000,
    select: (response) => response.data.staff,
  })

  useEffect(() => {
    if (!selectedDate || !shifts.length || selectedShiftId) return
    const defaultShift = selectedDate === today ? getRelevantShift(shifts, hotelClock(hotel?.timezone)) : shifts[0]
    setSelectedShiftId(defaultShift?.id ?? null)
  }, [hotel?.timezone, selectedDate, selectedShiftId, shifts, today])

  const {
    data: entries,
    isLoading,
    isError,
    error: fetchError,
    refetch,
  } = useQuery({
    queryKey: ['logbook-entries', selectedDate, selectedDeptId],
    queryFn: () =>
      logbookApi.listEntries({
        entry_date: selectedDate,
        department_id: selectedDeptId ?? undefined,
      }),
    enabled: !!selectedDate,
    select: (res) => res.data as LogbookEntry[],
  })

  const statusFilterParams =
    statusFilter === 'needs_follow_up' ? { status: 'follow_up' as const }
    : statusFilter === 'important' ? { priority: 'important' as const }
    : statusFilter === 'resolved' ? { status: 'resolved' as const }
    : {}

  const workspaceEntriesQuery = useInfiniteQuery({
    queryKey: ['logbook-workspace-entries', selectedDate, selectedDeptId, selectedShiftId, statusFilter],
    queryFn: ({ pageParam }) => logbookApi.listEntries({
      entry_date: selectedDate,
      department_id: selectedDeptId ?? undefined,
      shift_id: selectedShiftId ?? undefined,
      page: pageParam,
      ...statusFilterParams,
    }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.meta.has_more ? lastPage.meta.page + 1 : undefined,
    enabled: v2 && !!selectedDate,
  })
  const workspaceEntries = useMemo(
    () => workspaceEntriesQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [workspaceEntriesQuery.data],
  )

  const searchEntriesQuery = useInfiniteQuery({
    queryKey: ['logbook-search-entries', searchFilters],
    queryFn: ({ pageParam }) => logbookApi.listEntries({
      ...searchFilters,
      page: pageParam,
      per_page: 20,
    }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.meta.has_more ? lastPage.meta.page + 1 : undefined,
    // One-character phrases stay local to the input. Filter-only discovery
    // remains valid and server-side.
    enabled: v2 && searchMode && hasLogbookSearchState(searchFilters) && (!searchFilters.q || searchFilters.q.length >= 2),
  })
  const searchEntries = useMemo(
    () => searchEntriesQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [searchEntriesQuery.data],
  )
  const searchMeta = searchEntriesQuery.data?.pages.at(-1)?.meta

  const needsNextShiftQuery = useQuery({
    queryKey: ['logbook-needs-next-shift', selectedDate, selectedDeptId, selectedShiftId],
    queryFn: () => logbookApi.listEntries({
      entry_date: selectedDate,
      department_id: selectedDeptId ?? undefined,
      shift_id: selectedShiftId ?? undefined,
      status: 'follow_up',
      per_page: 100,
    }),
    enabled: v2 && !!selectedDate,
    select: (res) => res.data,
  })

  const summaryQuery = useQuery({
    queryKey: ['logbook-shift-summary', selectedDate, selectedShiftId],
    queryFn: () => logbookApi.getShiftSummary(selectedShiftId as string, selectedDate),
    enabled: v2 && !!selectedShiftId,
    retry: false,
    select: (res) => res.data,
  })
  const summaryError = summaryQuery.isError && !isNotFoundError(summaryQuery.error)
    ? (summaryQuery.error instanceof Error ? summaryQuery.error : new Error('Unable to load summary'))
    : null
  const selectedShift = shifts.find((shift) => shift.id === selectedShiftId) ?? null
  const nextShift = getNextShift(shifts, selectedShiftId)
  const handoffTitle = selectedShift && nextShift
    ? `${selectedShift.name} → ${nextShift.name} ${t('logbook.shiftHandoff')}`
    : t('logbook.shiftHandoff')

  const generateSummary = useMutation({
    mutationFn: (regenerate: boolean = false) => logbookApi.generateShiftSummary({ shift_id: selectedShiftId as string, shift_date: selectedDate, regenerate }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['logbook-shift-summary', selectedDate] }),
  })
  const acknowledgeSummary = useMutation({
    mutationFn: (summaryId: string) => logbookApi.acknowledgeShiftSummary(summaryId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['logbook-shift-summary', selectedDate] }),
  })

  const deptMapFromEntries: Record<string, string> = {}
  ;(entries ?? []).forEach((e) => {
    if (e.departments?.name && e.department_id) {
      deptMapFromEntries[e.department_id] = e.departments.name
    }
  })

  const deptMapFromApi: Record<string, string> = {}
  ;(deptsData ?? []).forEach((d) => {
    deptMapFromApi[d.id] = d.name
  })

  const deptMap: Record<string, string> =
    Object.keys(deptMapFromApi).length > 0 ? deptMapFromApi : deptMapFromEntries
  const deptTabsFromEntries = Object.entries(deptMapFromEntries)

  // â”€â”€ Delete mutation (optimistic) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const { mutate: deleteEntry, isPending: deleting } = useMutation({
    mutationFn: (id: string) => logbookApi.deleteEntry(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['logbook-entries', selectedDate, selectedDeptId] })
      const previous = queryClient.getQueryData(['logbook-entries', selectedDate, selectedDeptId])
      queryClient.setQueryData(['logbook-entries', selectedDate, selectedDeptId], (old: any) => {
        if (!old?.data) return old
        return { ...old, data: old.data.filter((e: LogbookEntry) => e.id !== id) }
      })
      setDeleteTarget(null)
      return { previous }
    },
    onError: (_err, _id, context: any) => {
      if (context?.previous) {
        queryClient.setQueryData(['logbook-entries', selectedDate, selectedDeptId], context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['logbook-entries', selectedDate] })
      queryClient.invalidateQueries({ queryKey: ['logbook-workspace-entries', selectedDate] })
    },
  })

  function handlePrevDay() {
    if (!selectedDate) return
    setSelectedDate((d) => prevDay(d))
    setSelectedDeptId(null)
    setSelectedShiftId(null)
  }

  function handleNextDay() {
    if (!selectedDate || !today || selectedDate >= today) return
    setSelectedDate((d) => nextDay(d))
    setSelectedDeptId(null)
    setSelectedShiftId(null)
  }

  function handleToday() {
    if (!today) return
    setSelectedDate(today)
    setSelectedDeptId(null)
    setSelectedShiftId(null)
  }

  function setSearchFilters(next: LogbookSearchFilters) {
    const params = logbookSearchParams(next)
    router.push(params.size ? `${pathname}?${params.toString()}` : pathname, { scroll: false })
  }

  function beginSearch() {
    setSearchRequested(true)
    if (!isToday) {
      setSearchFilters({ date_from: selectedDate, date_to: selectedDate, shift_id: selectedShiftId ?? undefined, department_id: selectedDeptId ?? undefined })
    } else if (selectedDeptId) {
      setSearchFilters({ department_id: selectedDeptId })
    }
  }

  function exitSearch() {
    setSearchRequested(false)
    router.push(pathname, { scroll: false })
  }

  function handleEntryCreated() {
    // Keep legacy/list consumers invalidated, but explicitly refetch the active
    // V2 infinite-query feed. A prefix invalidation alone has proven flaky in
    // deployed staging and can leave a successfully created handoff invisible.
    void queryClient.invalidateQueries({ queryKey: ['logbook-entries', selectedDate] })
    void workspaceEntriesQuery.refetch()
    void queryClient.invalidateQueries({ queryKey: ['logbook-needs-next-shift', selectedDate] })
  }

  function openEntryDetail(entry: LogbookEntry) {
    setDetailStartInEdit(false)
    setDetailEntry(entry)
  }

  function openEntryEdit(entry: LogbookEntry) {
    setDetailStartInEdit(true)
    setDetailEntry(entry)
  }

  const isToday = !!today && selectedDate === today
  const dateControlLabel = selectedDate
    ? formatDateControlLabel(selectedDate, today, i18n.language, t('logbook.today'))
    : ''

  if (!mounted || !today || !selectedDate) {
    return (
      <div className="max-w-[1400px] space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="h-7 w-48 rounded-lg bg-gray-100 animate-pulse" />
            <div className="h-4 w-80 max-w-full rounded bg-gray-100 animate-pulse mt-2" />
          </div>
          <div className="h-9 w-28 rounded-lg bg-gray-100 animate-pulse" />
        </div>
        <div className="h-16 w-full max-w-3xl rounded-[var(--r-lg)] bg-gray-100 animate-pulse" />
        <div className="space-y-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    )
  }

  if (v2) {
    return (
      <div className="max-w-[1400px] space-y-6">
        <PageHeader
          title={t('logbook.pageTitle')}
          subtitle={t('logbook.pageSubtitle')}
          dataI18nSkip
          actions={<><Button variant="ghost" onClick={beginSearch} className="gap-2 shrink-0"><Search size={15} />{t('logbook.search')}</Button>{capabilities.canCreateEntry ? <Button variant="primary" onClick={() => setShowCreateModal(true)} className="gap-2 shrink-0"><Plus size={15} />{t('logbook.addHandoff')}</Button> : null}</>}
        />

        {searchMode ? <LogbookSearchWorkspace
          filters={searchFilters}
          today={today}
          departments={deptsData ?? []}
          shifts={shifts}
          staff={staffQuery.data ?? []}
          entries={searchEntries}
          meta={searchMeta}
          isLoading={searchEntriesQuery.isLoading}
          isFetching={searchEntriesQuery.isFetching}
          isError={searchEntriesQuery.isError}
          onRetry={() => searchEntriesQuery.refetch()}
          onFiltersChange={setSearchFilters}
          onClearFilters={() => setSearchFilters({ q: searchFilters.q })}
          onExit={exitSearch}
          onOpen={openEntryDetail}
          onLoadMore={() => searchEntriesQuery.fetchNextPage()}
        /> : <>
        <LogbookDateShiftBar
          dateLabel={dateControlLabel}
          isToday={isToday}
          onPreviousDay={handlePrevDay}
          onNextDay={handleNextDay}
          onToday={handleToday}
          selectedDate={selectedDate}
          onDateChange={(value) => { if (value && value <= today) { setSelectedDate(value); setSelectedShiftId(null) } }}
          shifts={shifts}
          selectedShiftId={selectedShiftId}
          onShiftChange={setSelectedShiftId}
          isLoadingShifts={shiftsQuery.isLoading}
          isShiftListUnavailable={shiftsQuery.isError}
        />

        <LogbookHandoffCard
          summary={summaryQuery.data}
          title={handoffTitle}
          isHistorical={!isToday}
          isLoading={!!selectedShiftId && summaryQuery.isLoading}
          error={summaryError}
          canGenerate={capabilities.canGenerateShiftSummary && isToday}
          canAcknowledge={capabilities.canAcknowledgeShiftSummary}
          isGenerating={generateSummary.isPending}
          isAcknowledging={acknowledgeSummary.isPending}
          onGenerate={() => generateSummary.mutate(false)}
          onAcknowledge={() => {
            if (summaryQuery.data?.id) acknowledgeSummary.mutate(summaryQuery.data.id)
          }}
          onRetry={() => summaryQuery.refetch()}
          onViewFull={() => setShowShiftHandoff(true)}
        />

        <NeedsNextShift
          entries={needsNextShiftQuery.data ?? []}
          isLoading={needsNextShiftQuery.isLoading}
          isError={needsNextShiftQuery.isError}
          onRetry={() => needsNextShiftQuery.refetch()}
          onOpen={openEntryDetail}
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <LogbookFilters
            departments={deptsData ?? []}
            selectedDepartmentId={selectedDeptId}
            onDepartmentChange={setSelectedDeptId}
            isUnavailable={departmentsQuery.isError}
          />
          <LogbookStatusFilter value={statusFilter} onChange={setStatusFilter} />
        </div>

        <LogbookActivityFeed
          entries={workspaceEntries}
          isLoading={workspaceEntriesQuery.isLoading}
          isError={workspaceEntriesQuery.isError}
          onRetry={() => workspaceEntriesQuery.refetch()}
          hasMore={workspaceEntriesQuery.hasNextPage}
          isLoadingMore={workspaceEntriesQuery.isFetchingNextPage}
          onLoadMore={() => workspaceEntriesQuery.fetchNextPage()}
          isToday={isToday}
          canCreate={capabilities.canCreateEntry}
          currentUserId={currentUserId}
          canManageAny={capabilities.canEditAnyEntry}
          onCreate={() => setShowCreateModal(true)}
          onSearch={beginSearch}
          onOpen={openEntryDetail}
          onEdit={openEntryEdit}
          onDelete={setDeleteTarget}
        />
        </>}

        <AddHandoffDrawer
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onCreated={handleEntryCreated}
          departments={deptsData ?? []}
          defaultDepartmentId={selectedDeptId ?? deptsData?.[0]?.id ?? ''}
          shiftContextLabel={selectedShift ? `${selectedShift.name} · ${isToday ? t('logbook.today') : formatDisplayDate(selectedDate)}` : undefined}
          activeShiftId={selectedShiftId}
          activeShiftEndTime={selectedShift?.end_time ?? null}
          isHistoricalDate={!isToday}
          onGoToToday={handleToday}
        />
        <LogbookEntryDetailDrawer
          entry={detailEntry}
          onClose={() => setDetailEntry(null)}
          onChanged={handleEntryCreated}
          onDelete={(target) => { setDetailEntry(null); setDeleteTarget(target) }}
          shifts={shifts}
          currentUserId={currentUserId}
          capabilities={capabilities}
          startInEditMode={detailStartInEdit}
        />
        <ShiftHandoffDrawer
          isOpen={showShiftHandoff}
          summary={summaryQuery.data}
          shiftName={selectedShift?.name ?? t('logbook.shift')}
          nextShiftName={nextShift?.name}
          shiftDate={selectedDate}
          isHistorical={!isToday}
          canGenerate={capabilities.canGenerateShiftSummary && isToday}
          canAcknowledge={capabilities.canAcknowledgeShiftSummary}
          isGenerating={generateSummary.isPending}
          isAcknowledging={acknowledgeSummary.isPending}
          generationError={generateSummary.error instanceof Error ? generateSummary.error : null}
          onClose={() => setShowShiftHandoff(false)}
          onGenerate={(regenerate) => generateSummary.mutate(regenerate ?? false)}
          onAcknowledge={() => { if (summaryQuery.data?.id) acknowledgeSummary.mutate(summaryQuery.data.id) }}
          onOpenLogbookEntry={(id) => {
            const entry = workspaceEntries.find((item) => item.id === id) ?? needsNextShiftQuery.data?.find((item) => item.id === id)
            setShowShiftHandoff(false)
            if (entry) {
              openEntryDetail(entry)
              return
            }
            void logbookApi.getEntry(id).then((response) => openEntryDetail(response.data))
          }}
        />
        <DeleteConfirmDialog open={!!deleteTarget} title="Delete this entry?" onConfirm={() => deleteTarget && deleteEntry(deleteTarget.id)} onCancel={() => setDeleteTarget(null)} loading={deleting} />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        eyebrow="Organization"
        title={v2 ? t('logbook.pageTitle') : 'Shift Logbook'}
        subtitle={v2 ? t('logbook.pageSubtitle') : 'Record and review shift notes across all departments'}
        dataI18nSkip={v2}
        actions={
          <Button variant="primary" onClick={() => setShowCreateModal(true)} className="gap-2 shrink-0">
            <Plus size={15} />
            Add Entry
          </Button>
        }
      />

      {/* AI Shift Summary */}
      {mounted && isToday && (
        <AISummaryPanel shiftDate={selectedDate} isSupervisor={isSupervisor} />
      )}

      {/* Date navigation */}
      <div className="flex items-center gap-2">
        <IconButton variant="outline" onClick={handlePrevDay} aria-label="Previous day">
          <ChevronLeft size={16} />
        </IconButton>
        <Button
          variant="outline"
          size="sm"
          onClick={handleToday}
          className={isToday ? 'bg-[var(--caution-soft)] text-[var(--caution)] border-[var(--caution-line)]' : ''}
        >
          Today
        </Button>
        <span className="px-3 py-1.5 text-sm font-semibold text-gray-900 bg-surface border border-gray-200 rounded-lg min-w-[130px] text-center">
          {formatDisplayDate(selectedDate)}
        </span>
        <IconButton variant="outline" onClick={handleNextDay} disabled={isToday} aria-label="Next day">
          <ChevronRight size={16} />
        </IconButton>
      </div>

      {/* Department filter tabs */}
      {deptTabsFromEntries.length > 0 && (
        <div className="flex items-center gap-1 border-b border-gray-200 overflow-x-auto -mb-px">
          <button
            onClick={() => setSelectedDeptId(null)}
            aria-pressed={selectedDeptId === null}
            className={`relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              selectedDeptId === null
                ? 'border-[var(--caution-line)] text-[var(--caution)]'
                : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
            }`}
          >
            All
            {entries && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${selectedDeptId === null ? 'bg-[var(--caution-soft)] text-[var(--caution)]' : 'bg-gray-100 text-gray-500'}`}>
                {entries.length}
              </span>
            )}
          </button>
          {deptTabsFromEntries.map(([id, name]) => (
            <button
              key={id}
              onClick={() => setSelectedDeptId(id)}
              aria-pressed={selectedDeptId === id}
              className={`relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                selectedDeptId === id
                  ? 'border-[var(--caution-line)] text-[var(--caution)]'
                  : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {/* Stats bar */}
      {!isLoading && entries && entries.length > 0 && (
        <p className="text-sm text-gray-500">
          <span className="font-medium text-gray-700">{entries.length}</span>{' '}
          {entries.length === 1 ? 'entry' : 'entries'} for {formatDisplayDate(selectedDate)}
        </p>
      )}

      {/* Content area */}
      {v2 ? (
        isLoading ? (
          <div className="space-y-3">
            <SkeletonCardV2 />
            <SkeletonCardV2 />
            <SkeletonCardV2 />
          </div>
        ) : (
          <StateBlock
            status={isError ? 'error' : !entries || entries.length === 0 ? 'empty' : null}
            error={{ message: t('logbook.loadError'), onRetry: () => refetch() }}
            empty={{ title: t('logbook.empty.title', { date: formatDisplayDate(selectedDate) }), body: t('logbook.empty.body') }}
          >
            <div className="space-y-3">
              {(entries ?? []).map((entry) => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  canEdit={isGM || isSupervisor || entry.author_id === currentUserId}
                  onEdit={setEditTarget}
                  onDelete={setDeleteTarget}
                />
              ))}
            </div>
          </StateBlock>
        )
      ) : isLoading ? (
        <div className="space-y-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : fetchError ? (
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <AlertCircle size={32} className="text-red-400 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-700 mb-1">Failed to load logbook</p>
            <p className="text-xs text-gray-400">
              {fetchError instanceof Error ? fetchError.message : 'An error occurred'}
            </p>
          </div>
        </div>
      ) : entries && entries.length > 0 ? (
        <div className="space-y-3">
          {entries.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              canEdit={isGM || isSupervisor || entry.author_id === currentUserId}
              onEdit={setEditTarget}
              onDelete={setDeleteTarget}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-14 text-center">
          <div className="w-16 h-16 rounded-[var(--r-lg)] bg-gray-100 flex items-center justify-center mb-4">
            <BookOpen size={28} className="text-gray-300" />
          </div>
          <p className="text-base font-semibold text-gray-700 mb-1">
            No entries for {formatDisplayDate(selectedDate)}
          </p>
          {isToday && (
            <p className="text-sm text-gray-400 mb-5 max-w-xs">
              Add the first entry for today to keep your team informed.
            </p>
          )}
          {isToday && (
            <Button variant="primary" onClick={() => setShowCreateModal(true)} className="gap-2">
              <Plus size={15} />
              Add first entry
            </Button>
          )}
          <div className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-3 text-left sm:grid-cols-3">
            {['Guest handoff', 'Maintenance note', 'Shift concern'].map((item) => (
              <div key={item} className="rounded-xl border border-amber-100 bg-[var(--caution-soft)] px-4 py-3">
                <p className="text-sm font-semibold text-ink">{item}</p>
                <p className="mt-1 text-xs text-ink3">Useful log item</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create entry modal */}
      <CreateEntryModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={handleEntryCreated}
        deptMap={deptMap}
      />

      {/* Edit entry modal */}
      <EditEntryModal
        key={editTarget?.id ?? ''}
        entry={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={() => {
          setEditTarget(null)
          queryClient.invalidateQueries({ queryKey: ['logbook-entries', selectedDate] })
        }}
      />

      {/* Delete confirm */}
      <DeleteConfirmDialog
        open={!!deleteTarget}
        title={`Delete this entry?`}
        onConfirm={() => deleteTarget && deleteEntry(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
      />
    </div>
  )
}

export default function LogbookPage() {
  return (
    <Suspense>
      <LogbookPageContent />
    </Suspense>
  )
}
