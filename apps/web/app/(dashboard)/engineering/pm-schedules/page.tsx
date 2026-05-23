'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format, differenceInDays, addDays } from 'date-fns'
import {
  Calendar,
  Plus,
  AlertTriangle,
  Clock,
  CheckCircle,
  X,
  Loader2,
} from 'lucide-react'
import { engineeringApi, PMSchedule } from '@/lib/api/engineering'
import { useRole } from '@/lib/hooks/useRole'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getScheduleStatus(nextDueAt: string): {
  label: string
  cls: string
  badgeCls: string
} {
  const now = new Date()
  const due = new Date(nextDueAt)
  if (due < now) {
    return {
      label: 'Overdue',
      cls: 'text-red-600',
      badgeCls: 'bg-red-50 text-red-700 border border-red-200',
    }
  }
  const daysUntil = differenceInDays(due, now)
  if (daysUntil <= 7) {
    return {
      label: 'Due Soon',
      cls: 'text-orange-600',
      badgeCls: 'bg-amber-50 text-amber-700 border border-amber-200',
    }
  }
  return {
    label: 'Upcoming',
    cls: 'text-green-700',
    badgeCls: 'bg-green-50 text-green-700 border border-green-200',
  }
}

function formatIntervalLabel(
  intervalType: PMSchedule['interval_type'],
  intervalDays?: number,
): string {
  if (intervalType === 'custom') {
    return intervalDays ? `Every ${intervalDays} days` : 'Custom'
  }
  return intervalType.charAt(0).toUpperCase() + intervalType.slice(1)
}

function calcNextDueAt(intervalType: PMSchedule['interval_type'], intervalDays?: number): Date {
  const now = new Date()
  const offsetMap: Record<string, number> = {
    daily: 1,
    weekly: 7,
    monthly: 30,
    quarterly: 90,
    annual: 365,
  }
  if (intervalType === 'custom') {
    return addDays(now, intervalDays ?? 1)
  }
  return addDays(now, offsetMap[intervalType] ?? 30)
}

// ─── Stat card ────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string
  value: number
  sub?: string
  accent?: 'red' | 'orange' | 'default'
  icon: React.ReactNode
}

function StatCard({ label, value, sub, accent = 'default', icon }: StatCardProps) {
  const valueColor =
    accent === 'red'
      ? 'text-red-600'
      : accent === 'orange'
        ? 'text-orange-600'
        : 'text-gray-900'
  return (
    <Card className={`px-5 py-4${accent === 'red' ? ' border-red-200 bg-red-50' : ''}`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
        <div className="text-gray-400">{icon}</div>
      </div>
      <p className={`text-2xl font-bold ${valueColor}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </Card>
  )
}

// ─── Skeleton row ─────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="animate-pulse border-b border-amber-200">
      <td className="px-4 py-3"><div className="h-4 bg-gray-100 rounded w-3/4" /></td>
      <td className="px-4 py-3"><div className="h-4 bg-gray-100 rounded w-1/2" /></td>
      <td className="px-4 py-3"><div className="h-4 bg-gray-100 rounded w-20" /></td>
      <td className="px-4 py-3"><div className="h-4 bg-gray-100 rounded w-24" /></td>
      <td className="px-4 py-3"><div className="h-4 bg-gray-100 rounded w-16" /></td>
      <td className="px-4 py-3"><div className="h-4 bg-gray-100 rounded w-24" /></td>
      <td className="px-4 py-3"><div className="h-5 bg-gray-100 rounded w-16" /></td>
      <td className="px-4 py-3"><div className="h-5 bg-gray-100 rounded w-28" /></td>
    </tr>
  )
}

// ─── Complete PM Modal ────────────────────────────────────────────────────────

interface CompletePMModalProps {
  isOpen: boolean
  onClose: () => void
  schedule: PMSchedule | null
  onSuccess: () => void
}

function CompletePMModal({ isOpen, onClose, schedule, onSuccess }: CompletePMModalProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) onClose()
    }
    if (isOpen) document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, saving, onClose])

  useEffect(() => {
    if (isOpen) setError(null)
  }, [isOpen])

  if (!isOpen || !schedule) return null

  const nextDue = calcNextDueAt(schedule.interval_type, schedule.interval_days)

  async function handleConfirm() {
    if (!schedule) return
    setSaving(true)
    setError(null)
    try {
      await engineeringApi.completePMSchedule(schedule.id)
      onSuccess()
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to mark PM as complete.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 bg-stone-900/20 backdrop-blur-sm z-50"
        onClick={!saving ? onClose : undefined}
        aria-hidden="true"
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Complete PM Schedule"
          className="bg-white/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-2xl shadow-xl w-full max-w-md p-6"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-green-600 flex items-center justify-center shrink-0">
                <CheckCircle size={16} className="text-white" />
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-900">Mark PM Complete</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {schedule.assets?.name ?? 'Unknown asset'} — {schedule.name}
                </p>
              </div>
            </div>
            {!saving && (
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            )}
          </div>

          {/* Body */}
          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              Mark this PM as complete? The next due date will be automatically set to:
            </p>
            <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-green-50 border border-green-200">
              <Calendar size={15} className="text-green-600 shrink-0" />
              <span className="text-sm font-semibold text-green-800">
                {format(nextDue, 'MMMM d, yyyy')}
              </span>
              <span className="text-xs text-green-600 ml-1">
                ({formatIntervalLabel(schedule.interval_type, schedule.interval_days)} from today)
              </span>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                <AlertTriangle size={14} className="shrink-0" />
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 mt-5 pt-4 border-t border-white/60">
            <Button
              variant="ghost"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={handleConfirm}
              disabled={saving}
              className="border-green-200 text-green-700 bg-green-50 hover:bg-green-100"
            >
              {saving ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  Completing…
                </>
              ) : (
                <>
                  <CheckCircle size={14} />
                  Confirm Complete
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Create PM Schedule Modal ─────────────────────────────────────────────────

interface CreatePMScheduleModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

const INTERVAL_OPTIONS: PMSchedule['interval_type'][] = [
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'annual',
  'custom',
]

function CreatePMScheduleModal({ isOpen, onClose, onSuccess }: CreatePMScheduleModalProps) {
  const [fields, setFields] = useState({
    asset_id: '',
    name: '',
    description: '',
    interval_type: 'monthly' as PMSchedule['interval_type'],
    interval_days: '',
    estimated_minutes: '',
    next_due_at: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) onClose()
    }
    if (isOpen) document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, saving, onClose])

  useEffect(() => {
    if (isOpen) {
      setFields({
        asset_id: '',
        name: '',
        description: '',
        interval_type: 'monthly',
        interval_days: '',
        estimated_minutes: '',
        next_due_at: '',
      })
      setError(null)
    }
  }, [isOpen])

  if (!isOpen) return null

  function set<K extends keyof typeof fields>(key: K, value: (typeof fields)[K]) {
    setFields((prev) => ({ ...prev, [key]: value }))
  }

  async function handleCreate() {
    if (!fields.name.trim()) {
      setError('Schedule name is required.')
      return
    }
    if (!fields.next_due_at) {
      setError('Next due date is required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await engineeringApi.createPMSchedule({
        asset_id: fields.asset_id.trim(),
        name: fields.name.trim(),
        description: fields.description.trim() || undefined,
        interval_type: fields.interval_type,
        interval_days:
          fields.interval_type === 'custom' && fields.interval_days
            ? Number(fields.interval_days)
            : undefined,
        estimated_minutes: fields.estimated_minutes ? Number(fields.estimated_minutes) : undefined,
        next_due_at: fields.next_due_at,
      })
      onSuccess()
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create PM schedule.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 bg-stone-900/20 backdrop-blur-sm z-50"
        onClick={!saving ? onClose : undefined}
        aria-hidden="true"
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Add PM Schedule"
          className="bg-white/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center shrink-0">
                <Calendar size={16} className="text-white" />
              </div>
              <h2 className="text-base font-bold text-gray-900">Add PM Schedule</h2>
            </div>
            {!saving && (
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            )}
          </div>

          <div className="space-y-4">
            {/* Asset ID */}
            <div>
              <label htmlFor="pm-create-asset-id" className="block text-sm font-medium text-gray-700 mb-1.5">
                Asset ID{' '}
                <span className="text-gray-400 font-normal">(UUID)</span>
              </label>
              <Input
                id="pm-create-asset-id"
                type="text"
                value={fields.asset_id}
                onChange={(e) => set('asset_id', e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="font-mono"
              />
              <p className="text-xs text-gray-400 mt-1">
                Find the asset ID on the Asset Register page.
              </p>
            </div>

            {/* Schedule name */}
            <div>
              <label htmlFor="pm-create-name" className="block text-sm font-medium text-gray-700 mb-1.5">
                Schedule Name <span className="text-red-500">*</span>
              </label>
              <Input
                id="pm-create-name"
                type="text"
                value={fields.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="e.g. Monthly HVAC Filter Replacement"
              />
            </div>

            {/* Description */}
            <div>
              <label htmlFor="pm-create-description" className="block text-sm font-medium text-gray-700 mb-1.5">
                Description{' '}
                <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <textarea
                id="pm-create-description"
                rows={2}
                value={fields.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="Describe what maintenance tasks need to be performed…"
                className="w-full border border-amber-200/40 rounded-lg px-3 py-2 text-sm bg-white/70 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-200 transition-colors resize-none"
              />
            </div>

            {/* Interval type + days */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="pm-create-interval-type" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Interval Type
                </label>
                <select
                  id="pm-create-interval-type"
                  value={fields.interval_type}
                  onChange={(e) =>
                    set('interval_type', e.target.value as PMSchedule['interval_type'])
                  }
                  className="w-full border border-amber-200/40 rounded-lg px-3 py-2 text-sm bg-white/70 backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-200 transition-colors"
                >
                  {INTERVAL_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt.charAt(0).toUpperCase() + opt.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              {fields.interval_type === 'custom' && (
                <div>
                  <label htmlFor="pm-create-interval-days" className="block text-sm font-medium text-gray-700 mb-1.5">
                    Interval (days)
                  </label>
                  <Input
                    id="pm-create-interval-days"
                    type="number"
                    min={1}
                    value={fields.interval_days}
                    onChange={(e) => set('interval_days', e.target.value)}
                    placeholder="e.g. 45"
                  />
                </div>
              )}
            </div>

            {/* Estimated minutes + next due */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="pm-create-estimated-minutes" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Est. Time (minutes)
                </label>
                <Input
                  id="pm-create-estimated-minutes"
                  type="number"
                  min={1}
                  value={fields.estimated_minutes}
                  onChange={(e) => set('estimated_minutes', e.target.value)}
                  placeholder="e.g. 60"
                />
              </div>
              <div>
                <label htmlFor="pm-create-next-due" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Next Due Date <span className="text-red-500">*</span>
                </label>
                <Input
                  id="pm-create-next-due"
                  type="date"
                  value={fields.next_due_at}
                  onChange={(e) => set('next_due_at', e.target.value)}
                />
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                <AlertTriangle size={14} className="shrink-0" />
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 mt-5 pt-4 border-t border-white/60">
            <Button
              variant="ghost"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleCreate}
              disabled={saving || !fields.name.trim() || !fields.next_due_at}
            >
              {saving ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  Creating…
                </>
              ) : (
                <>
                  <Plus size={14} />
                  Add Schedule
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PMSchedulesPage() {
  const { isGM, role } = useRole()
  const canEdit = isGM || role === 'chief_engineer'
  const queryClient = useQueryClient()

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [completingSchedule, setCompletingSchedule] = useState<PMSchedule | null>(null)
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const { data: schedulesData, isLoading, isError } = useQuery({
    queryKey: ['pm-schedules'],
    queryFn: () => engineeringApi.listPMSchedules(),
    select: (res) => res.data as PMSchedule[],
  })

  const schedules = schedulesData ?? []

  // ── Stats ──────────────────────────────────────────────────────────────────

  const now = new Date()
  const activeSchedules = schedules.filter((s) => s.is_active)
  const overdueCount = schedules.filter((s) => new Date(s.next_due_at) < now).length
  const dueThisWeekCount = schedules.filter((s) => {
    const due = new Date(s.next_due_at)
    const days = differenceInDays(due, now)
    return days >= 0 && days <= 7
  }).length

  function handleCreateSuccess() {
    queryClient.invalidateQueries({ queryKey: ['pm-schedules'] })
  }

  function handleCompleteSuccess(scheduleName: string, nextDueAt: Date) {
    queryClient.invalidateQueries({ queryKey: ['pm-schedules'] })
    setSuccessMessage(
      `PM "${scheduleName}" marked complete. Next due: ${format(nextDueAt, 'MMM d, yyyy')}.`,
    )
    setTimeout(() => setSuccessMessage(null), 4000)
  }

  async function handleDeactivate(scheduleId: string) {
    try {
      await engineeringApi.deactivatePMSchedule(scheduleId)
      queryClient.invalidateQueries({ queryKey: ['pm-schedules'] })
      setConfirmDeactivateId(null)
    } catch {
      // deactivation failed — user can retry
    }
  }

  async function handleCreateWOFromPM(schedule: PMSchedule) {
    try {
      await engineeringApi.createWorkOrder({
        title: `PM Due: ${schedule.name}`,
        description: schedule.description,
        category: 'general',
        priority: 'normal',
        asset_id: schedule.asset_id,
      })
      setSuccessMessage(`Work order created for "${schedule.name}"`)
      setTimeout(() => setSuccessMessage(null), 4000)
    } catch {
      // work order creation failed — user can retry
    }
  }

  return (
    <div className="space-y-6 max-w-7xl">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2.5">
            <Calendar size={22} className="text-amber-600 shrink-0" />
            PM Schedules
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Preventive maintenance schedules for all hotel assets
          </p>
        </div>
        {canEdit && (
          <Button
            variant="primary"
            onClick={() => setShowCreateModal(true)}
            className="shrink-0"
          >
            <Plus size={15} />
            Add Schedule
          </Button>
        )}
      </div>

      {/* ── Success banner ─────────────────────────────────────────────────── */}
      {successMessage && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
          <CheckCircle size={15} />
          {successMessage}
        </div>
      )}

      {/* ── Stats row ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Total Schedules"
          value={activeSchedules.length}
          sub="active schedules"
          icon={<Calendar size={16} />}
        />
        <StatCard
          label="Due This Week"
          value={dueThisWeekCount}
          sub="within 7 days"
          accent={dueThisWeekCount > 0 ? 'orange' : 'default'}
          icon={<Clock size={16} />}
        />
        <StatCard
          label="Overdue"
          value={overdueCount}
          sub="past due date"
          accent={overdueCount > 0 ? 'red' : 'default'}
          icon={<AlertTriangle size={16} />}
        />
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <Card className="p-0 overflow-hidden">
        {isError ? (
          <div className="flex flex-col items-center justify-center py-16 text-center p-6">
            <AlertTriangle size={28} className="text-red-400 mb-3" />
            <p className="text-sm font-medium text-gray-700 mb-1">Failed to load PM schedules</p>
            <Button
              variant="primary"
              onClick={() => queryClient.invalidateQueries({ queryKey: ['pm-schedules'] })}
              className="mt-2"
            >
              Retry
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-amber-100 bg-amber-50/60">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Asset
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Schedule Name
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Interval
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Next Due
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Est. Time
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Last Done
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
                ) : schedules.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-14">
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center">
                          <Calendar size={22} className="text-gray-300" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-600">No PM schedules yet</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            Add a schedule to start tracking preventive maintenance.
                          </p>
                        </div>
                        {canEdit && (
                          <Button
                            variant="primary"
                            onClick={() => setShowCreateModal(true)}
                          >
                            <Plus size={14} />
                            Add Schedule
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  schedules.map((schedule) => {
                    const status = getScheduleStatus(schedule.next_due_at)
                    const dueDate = new Date(schedule.next_due_at)
                    const isOverdue = dueDate < now
                    return (
                      <tr
                        key={schedule.id}
                        className="border-b border-amber-200 hover:bg-amber-50/40 transition-colors"
                      >
                        {/* Asset */}
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900 leading-tight">
                            {schedule.assets?.name ?? (
                              <span className="text-gray-400 font-normal italic">Unknown asset</span>
                            )}
                          </p>
                        </td>

                        {/* Schedule name */}
                        <td className="px-4 py-3 text-gray-700">{schedule.name}</td>

                        {/* Interval */}
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-50 text-slate-600 border border-slate-200">
                            {formatIntervalLabel(schedule.interval_type, schedule.interval_days)}
                          </span>
                        </td>

                        {/* Next due */}
                        <td
                          className={`px-4 py-3 text-sm font-medium ${
                            isOverdue ? 'text-red-600' : 'text-gray-700'
                          }`}
                        >
                          {format(dueDate, 'MMM d, yyyy')}
                        </td>

                        {/* Estimated time */}
                        <td className="px-4 py-3 text-gray-600">
                          {schedule.estimated_minutes} min
                        </td>

                        {/* Last done */}
                        <td className="px-4 py-3 text-gray-500 text-xs">
                          {schedule.last_completed_at ? (
                            format(new Date(schedule.last_completed_at), 'MMM d, yyyy')
                          ) : (
                            <span className="italic text-gray-300">Never</span>
                          )}
                        </td>

                        {/* Status badge */}
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${status.badgeCls}`}
                          >
                            {status.label === 'Overdue' && <AlertTriangle size={11} />}
                            {status.label === 'Due Soon' && <Clock size={11} />}
                            {status.label === 'Upcoming' && <CheckCircle size={11} />}
                            {status.label}
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {/* Complete — visible to engineer, chief, GM for active non-cancelled schedules */}
                            {schedule.is_active && (
                              <button
                                onClick={() => setCompletingSchedule(schedule)}
                                className="text-xs px-3 py-2 min-h-[44px] rounded border border-green-300 text-green-700 hover:bg-green-50 transition-colors"
                              >
                                Complete
                              </button>
                            )}

                            {/* Deactivate + Create WO — chief/GM only */}
                            {canEdit && schedule.is_active && (
                              confirmDeactivateId === schedule.id ? (
                                <span className="flex items-center gap-1 text-xs">
                                  <button
                                    onClick={() => handleDeactivate(schedule.id)}
                                    className="min-h-[44px] px-3 py-2 text-red-600 font-medium hover:underline"
                                  >
                                    Confirm
                                  </button>
                                  <button
                                    onClick={() => setConfirmDeactivateId(null)}
                                    className="min-h-[44px] px-3 py-2 text-gray-500 hover:underline"
                                  >
                                    Cancel
                                  </button>
                                </span>
                              ) : (
                                <button
                                  onClick={() => setConfirmDeactivateId(schedule.id)}
                                  className="text-xs px-3 py-2 min-h-[44px] rounded border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
                                >
                                  Deactivate
                                </button>
                              )
                            )}

                            {/* Create WO — chief/GM only, overdue schedules */}
                            {canEdit && isOverdue && (
                              <button
                                onClick={() => handleCreateWOFromPM(schedule)}
                                className="text-xs px-3 py-2 min-h-[44px] rounded border border-blue-200 text-blue-600 hover:bg-blue-50 transition-colors"
                              >
                                Create WO
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer count */}
        {!isLoading && !isError && schedules.length > 0 && (
          <div className="px-4 py-2.5 border-t border-amber-200 bg-amber-50/40 flex items-center justify-between">
            <p className="text-xs text-gray-400">
              {schedules.length} schedule{schedules.length !== 1 ? 's' : ''}
            </p>
            {overdueCount > 0 && (
              <p className="text-xs font-medium text-red-600">
                {overdueCount} overdue
              </p>
            )}
          </div>
        )}
      </Card>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      <CreatePMScheduleModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={handleCreateSuccess}
      />

      <CompletePMModal
        isOpen={completingSchedule !== null}
        onClose={() => setCompletingSchedule(null)}
        schedule={completingSchedule}
        onSuccess={() => {
          if (completingSchedule) {
            const nextDue = calcNextDueAt(
              completingSchedule.interval_type,
              completingSchedule.interval_days,
            )
            handleCompleteSuccess(completingSchedule.name, nextDue)
          }
          setCompletingSchedule(null)
        }}
      />
    </div>
  )
}
