'use client'

import { useState, useEffect } from 'react'
import {
  BookOpen,
  Plus,
  ChevronLeft,
  ChevronRight,
  X,
  Loader2,
  AlertCircle,
  Sparkles,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { logbookApi, LogbookEntry } from '@/lib/api/logbook'
import { useRole } from '@/lib/hooks/useRole'
import { useAuthStore } from '@/stores/authStore'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().split('T')[0]
}

function prevDay(dateStr: string): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

function nextDay(dateStr: string): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + 1)
  return d.toISOString().split('T')[0]
}

function formatDisplayDate(dateStr: string): string {
  // Parse as local date to avoid timezone shifts (dateStr is YYYY-MM-DD)
  const [year, month, day] = dateStr.split('-').map(Number)
  const d = new Date(year, month - 1, day)
  return format(d, 'MMM d, yyyy')
}

// ── Entry card ────────────────────────────────────────────────────────────────

function EntryCard({ entry }: { entry: LogbookEntry }) {
  const authorName =
    entry.user_profiles?.preferred_name ??
    entry.user_profiles?.full_name ??
    'Unknown'
  const deptName = entry.departments?.name ?? 'General'
  const time = format(new Date(entry.created_at), 'h:mm a')

  return (
    <div className="bg-white/[0.65] border border-white/90 backdrop-blur-md rounded-2xl p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2 text-xs text-gray-500">
            <span className="font-medium text-gray-700">{time}</span>
            <span aria-hidden="true">·</span>
            <span>{authorName}</span>
            <span aria-hidden="true">·</span>
            <span className="px-2 py-0.5 bg-gray-100 rounded text-gray-600">{deptName}</span>
          </div>
          <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
            {entry.content}
          </p>
        </div>
        {entry.is_ai_generated && (
          <span className="text-xs px-2 py-0.5 bg-purple-50 text-purple-600 border border-purple-200 rounded font-medium shrink-0">
            AI
          </span>
        )}
      </div>
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="bg-white/[0.65] border border-white/90 backdrop-blur-md rounded-2xl p-4 animate-pulse">
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

// ── AI Summary Panel ──────────────────────────────────────────────────────────

interface AISummaryPanelProps {
  shiftDate: string
  isSupervisor: boolean
}

function AISummaryPanel({ shiftDate, isSupervisor }: AISummaryPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [summaryText, setSummaryText] = useState<string | null>(null)
  const [stats, setStats] = useState<{ tasks_completed: number; open_work_orders: number } | null>(null)
  const [generateError, setGenerateError] = useState<string | null>(null)

  const generateMutation = useMutation({
    mutationFn: () =>
      logbookApi.generateShiftSummary({
        shift_id: 'today',
        shift_date: shiftDate,
      }),
    onSuccess: (res) => {
      setSummaryText(res.data.summary_text)
      setStats({ tasks_completed: res.data.tasks_completed, open_work_orders: res.data.open_work_orders })
      setGenerateError(null)
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Failed to generate summary.'
      setGenerateError(msg)
    },
  })

  if (!isSupervisor) return null

  return (
    <div className="rounded-xl border border-purple-200 bg-purple-50 overflow-hidden">
      {/* Collapsible header */}
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-purple-100 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <Sparkles size={16} className="text-purple-600 shrink-0" />
          <span className="text-sm font-semibold text-purple-800">Today's AI Shift Summary</span>
          <span className="text-xs px-2 py-0.5 bg-purple-100 text-purple-600 border border-purple-200 rounded font-medium">
            AI
          </span>
        </div>
        {isOpen ? (
          <ChevronUp size={16} className="text-purple-500" />
        ) : (
          <ChevronDown size={16} className="text-purple-500" />
        )}
      </button>

      {/* Expanded content */}
      {isOpen && (
        <div className="px-4 pb-4 border-t border-purple-200">
          {summaryText ? (
            <div className="mt-3 space-y-3">
              {stats && (
                <div className="flex items-center gap-4 text-xs text-purple-700">
                  <span>
                    <span className="font-semibold">{stats.tasks_completed}</span> tasks completed
                  </span>
                  <span>
                    <span className="font-semibold">{stats.open_work_orders}</span> open work orders
                  </span>
                </div>
              )}
              <div className="bg-white rounded-lg border border-purple-200 p-4">
                <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                  {summaryText}
                </p>
              </div>
              <button
                onClick={() => {
                  setSummaryText(null)
                  setStats(null)
                  generateMutation.mutate()
                }}
                disabled={generateMutation.isPending}
                className="flex items-center gap-1.5 text-xs text-purple-600 hover:text-purple-800 font-medium disabled:opacity-50 transition-colors"
              >
                <Sparkles size={12} />
                Regenerate
              </button>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <p className="text-sm text-purple-700">
                Generate an AI-powered shift handoff summary based on today's logbook entries, completed tasks, and open work orders.
              </p>
              {generateError && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
                  <AlertCircle size={14} className="text-red-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-red-700">{generateError}</p>
                </div>
              )}
              <button
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {generateMutation.isPending ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Generating…
                  </>
                ) : (
                  <>
                    <Sparkles size={14} />
                    Generate for today
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Create Entry Modal ────────────────────────────────────────────────────────

interface CreateEntryModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  deptMap: Record<string, string> // id → name
}

function CreateEntryModal({ isOpen, onClose, onSuccess, deptMap }: CreateEntryModalProps) {
  const [deptId, setDeptId] = useState('')
  const [content, setContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const deptEntries = Object.entries(deptMap)

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setDeptId(deptEntries.length > 0 ? deptEntries[0][0] : '')
      setContent('')
      setError(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  const mutation = useMutation({
    mutationFn: () =>
      logbookApi.createEntry({ department_id: deptId, content: content.trim() }),
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
    if (!deptId.trim()) {
      setError('Department is required.')
      return
    }
    if (content.trim().length < 10) {
      setError('Entry must be at least 10 characters.')
      return
    }
    mutation.mutate()
  }

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-stone-900/20 backdrop-blur-sm z-50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Add logbook entry"
          className="bg-white/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-2xl shadow-xl w-full max-w-lg p-6"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center shrink-0">
                <BookOpen size={16} className="text-white" />
              </div>
              <h2 className="text-base font-bold text-gray-900">Add Logbook Entry</h2>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              aria-label="Close modal"
            >
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Department */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Department <span className="text-red-500">*</span>
              </label>
              {deptEntries.length > 0 ? (
                <select
                  value={deptId}
                  onChange={(e) => setDeptId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                  required
                >
                  {deptEntries.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
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

            {/* Content */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Entry <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={5}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Describe what happened during your shift…"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50 resize-none"
                required
                minLength={10}
              />
              <p className="text-xs text-gray-400 mt-1">{content.trim().length} chars (min 10)</p>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
                <AlertCircle size={15} className="text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={onClose}
                disabled={mutation.isPending}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={mutation.isPending || content.trim().length < 10 || !deptId.trim()}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-amber-400 to-amber-500 rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {mutation.isPending ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Plus size={14} />
                    Add Entry
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LogbookPage() {
  const today = todayIso()
  const [selectedDate, setSelectedDate] = useState(today)
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const { isSupervisor } = useRole()

  const session = useAuthStore((s) => s.session)
  const hotelId: string = (() => {
    if (!session?.access_token) return ''
    try {
      return JSON.parse(atob(session.access_token.split('.')[1]))?.hotel_id ?? ''
    } catch {
      return ''
    }
  })()

  const queryClient = useQueryClient()

  // ── Departments query (used for create modal) ──────────────────────────────
  const { data: deptsData } = useQuery({
    queryKey: ['hotel-departments', hotelId],
    queryFn: () => logbookApi.listDepartments(hotelId),
    enabled: !!hotelId,
    staleTime: 5 * 60 * 1000,
    select: (res) => res.data,
  })

  // ── Entries query ──────────────────────────────────────────────────────────
  const {
    data: entries,
    isLoading,
    error: fetchError,
  } = useQuery({
    queryKey: ['logbook-entries', selectedDate, selectedDeptId],
    queryFn: () =>
      logbookApi.listEntries({
        entry_date: selectedDate,
        department_id: selectedDeptId ?? undefined,
      }),
    select: (res) => res.data as LogbookEntry[],
  })

  // ── Build dept map from loaded entries ─────────────────────────────────────
  // Merge entries-sourced depts with API-fetched depts (API is preferred when available)
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

  // Prefer API data; fall back to entries data
  const deptMap: Record<string, string> =
    Object.keys(deptMapFromApi).length > 0
      ? deptMapFromApi
      : deptMapFromEntries

  // Dept tabs for filter: all unique depts visible in current entries
  const deptTabsFromEntries = Object.entries(deptMapFromEntries)

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handlePrevDay() {
    setSelectedDate((d) => prevDay(d))
    setSelectedDeptId(null)
  }

  function handleNextDay() {
    if (selectedDate >= today) return
    setSelectedDate((d) => nextDay(d))
    setSelectedDeptId(null)
  }

  function handleToday() {
    setSelectedDate(today)
    setSelectedDeptId(null)
  }

  function handleEntryCreated() {
    queryClient.invalidateQueries({ queryKey: ['logbook-entries', selectedDate] })
  }

  const isToday = selectedDate === today

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2.5">
            <BookOpen size={22} className="text-amber-600 shrink-0" />
            Shift Logbook
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Record and review shift notes across all departments
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-amber-400 to-amber-500 rounded-lg hover:opacity-90 transition-colors shrink-0"
        >
          <Plus size={15} />
          Add Entry
        </button>
      </div>

      {/* AI Shift Summary — visible to GM/supervisors on today's view */}
      {isToday && (
        <AISummaryPanel shiftDate={selectedDate} isSupervisor={isSupervisor} />
      )}

      {/* Date navigation */}
      <div className="flex items-center gap-2">
        <button
          onClick={handlePrevDay}
          className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
          aria-label="Previous day"
        >
          <ChevronLeft size={16} />
        </button>

        <button
          onClick={handleToday}
          className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
            isToday
              ? 'bg-amber-50 text-amber-700 border-amber-200'
              : 'text-gray-600 border-gray-200 hover:bg-gray-50 hover:text-gray-900'
          }`}
        >
          Today
        </button>

        <span className="px-3 py-1.5 text-sm font-semibold text-gray-900 bg-white border border-gray-200 rounded-lg min-w-[130px] text-center">
          {formatDisplayDate(selectedDate)}
        </span>

        <button
          onClick={handleNextDay}
          disabled={isToday}
          className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Next day"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Department filter tabs */}
      {deptTabsFromEntries.length > 0 && (
        <div className="flex items-center gap-1 border-b border-gray-200 overflow-x-auto -mb-px">
          {/* All tab */}
          <button
            onClick={() => setSelectedDeptId(null)}
            className={`relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              selectedDeptId === null
                ? 'border-amber-200 text-amber-700'
                : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
            }`}
          >
            All
            {entries && (
              <span
                className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                  selectedDeptId === null
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                {entries.length}
              </span>
            )}
          </button>

          {/* Per-dept tabs */}
          {deptTabsFromEntries.map(([id, name]) => {
            const isActive = selectedDeptId === id
            return (
              <button
                key={id}
                onClick={() => setSelectedDeptId(id)}
                className={`relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  isActive
                    ? 'border-amber-200 text-amber-700'
                    : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
                }`}
              >
                {name}
              </button>
            )
          })}
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
      {isLoading ? (
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
            <EntryCard key={entry.id} entry={entry} />
          ))}
        </div>
      ) : (
        /* Empty state */
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
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
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-amber-400 to-amber-500 rounded-lg hover:opacity-90 transition-colors"
            >
              <Plus size={15} />
              Add first entry
            </button>
          )}
        </div>
      )}

      {/* Create entry modal */}
      <CreateEntryModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={handleEntryCreated}
        deptMap={deptMap}
      />
    </div>
  )
}
