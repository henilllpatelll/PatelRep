'use client'

import { useState, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  startOfWeek,
  addDays,
  format,
  isSameDay,
  addWeeks,
  subWeeks,
} from 'date-fns'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Clock,
  Users,
  Calendar,
  CheckCircle2,
  AlertCircle,
  X,
  ChevronDown,
  ChevronUp,
  Pencil,
} from 'lucide-react'
import {
  schedulingApi,
  type Shift,
  type ShiftAssignment,
  type CreateAssignmentData,
  type CreateShiftData,
  type UpdateShiftData,
} from '@/lib/api/scheduling'
import { staffApi, type StaffMember } from '@/lib/api/staff'
import { useRole } from '@/lib/hooks/useRole'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

// ─── Constants ────────────────────────────────────────────────────────────────

const DEPARTMENTS = [
  { id: 'all', label: 'All' },
  { id: 'housekeeping', label: 'Housekeeping' },
  { id: 'engineering', label: 'Engineering' },
  { id: 'front_desk', label: 'Front Desk' },
  { id: 'management', label: 'Management' },
]

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getWeekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
}

function formatTimeRange(start: string, end: string): string {
  // "07:00:00" → "7:00"
  const fmt = (t: string) => {
    const [h, m] = t.split(':')
    const hour = parseInt(h, 10)
    return m === '00' ? String(hour) : `${hour}:${m}`
  }
  return `${fmt(start)}–${fmt(end)}`
}

function getShiftColor(name: string): {
  bg: string
  text: string
  dot: string
} {
  const lower = name.toLowerCase()
  if (lower.includes('morning')) {
    return { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-400' }
  }
  if (lower.includes('evening')) {
    return { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-400' }
  }
  if (lower.includes('night')) {
    return { bg: 'bg-indigo-50', text: 'text-indigo-700', dot: 'bg-indigo-400' }
  }
  return { bg: 'bg-gray-50', text: 'text-gray-700', dot: 'bg-gray-400' }
}

function relativeHoursAgo(isoString: string | null): string | null {
  if (!isoString) return null
  const diff = Date.now() - new Date(isoString).getTime()
  const minutes = Math.floor(diff / 60_000)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  return 'just now'
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('')
}

// ─── TodayRoster ──────────────────────────────────────────────────────────────

function TodayRoster() {
  const [collapsed, setCollapsed] = useState(false)

  const rosterQuery = useQuery({
    queryKey: ['schedules-today-roster'],
    queryFn: () => schedulingApi.todayRoster(),
    select: (res) => res.data.roster,
    staleTime: 60_000,
  })

  const roster = rosterQuery.data ?? []

  return (
    <Card className="overflow-hidden p-0">
      {/* Header */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-indigo-400/10 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <Users size={16} className="text-indigo-600 shrink-0" />
          <span className="text-sm font-semibold text-slate-800">
            Today&apos;s Roster
          </span>
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-xs font-semibold">
            {roster.length}
          </span>
        </div>
        {collapsed ? (
          <ChevronDown size={16} className="text-slate-400" />
        ) : (
          <ChevronUp size={16} className="text-slate-400" />
        )}
      </button>

      {!collapsed && (
        <div className="border-t border-indigo-300/20">
          {rosterQuery.isLoading ? (
            <div className="px-5 py-4 space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 animate-pulse">
                  <div className="w-8 h-8 rounded-full bg-indigo-200/40 shrink-0" />
                  <div className="space-y-1.5 flex-1">
                    <div className="h-3 bg-indigo-200/40 rounded w-36" />
                    <div className="h-3 bg-indigo-200/40 rounded w-24" />
                  </div>
                </div>
              ))}
            </div>
          ) : rosterQuery.isError ? (
            <div className="px-5 py-4 flex items-center gap-2 text-sm text-red-600">
              <AlertCircle size={15} />
              Failed to load roster.
              <button
                onClick={() => rosterQuery.refetch()}
                className="underline hover:no-underline"
              >
                Retry
              </button>
            </div>
          ) : roster.length === 0 ? (
            <div className="px-5 py-4 text-sm text-slate-500">
              No staff scheduled for today yet.
            </div>
          ) : (
            <div className="px-5 py-3 flex flex-wrap gap-3">
              {roster.map((entry) => {
                const color = getShiftColor(entry.shift.name)
                const clockedInAgo = relativeHoursAgo(entry.clocked_in_at)
                const initials = getInitials(entry.full_name)
                return (
                  <div
                    key={entry.user_id}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-indigo-200/30 bg-white/40 min-w-0"
                  >
                    {/* Avatar */}
                    <div className="relative shrink-0">
                      <div className="w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center text-white text-xs font-semibold">
                        {initials}
                      </div>
                      {/* Online dot */}
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${
                          entry.clocked_in_at ? 'bg-green-500' : 'bg-gray-300'
                        }`}
                      />
                    </div>
                    {/* Info */}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate leading-tight">
                        {entry.full_name}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${color.bg} ${color.text}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${color.dot}`} />
                          {entry.shift.name}
                        </span>
                        {entry.clocked_in_at && clockedInAgo ? (
                          <span className="flex items-center gap-1 text-xs text-green-600">
                            <Clock size={11} />
                            {clockedInAgo}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">not clocked in</span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

// ─── AssignShiftModal ─────────────────────────────────────────────────────────

interface AssignShiftModalProps {
  initialDate?: Date
  shifts: Shift[]
  staff: StaffMember[]
  onClose: () => void
  onSuccess: () => void
}

function AssignShiftModal({
  initialDate,
  shifts,
  staff,
  onClose,
  onSuccess,
}: AssignShiftModalProps) {
  const queryClient = useQueryClient()
  const [userId, setUserId] = useState('')
  const [shiftId, setShiftId] = useState('')
  const [workDate, setWorkDate] = useState(
    initialDate ? format(initialDate, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'),
  )
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const assignMutation = useMutation({
    mutationFn: (data: CreateAssignmentData) => schedulingApi.createAssignment(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules-assignments'] })
      queryClient.invalidateQueries({ queryKey: ['schedules-today-roster'] })
      onSuccess()
    },
    onError: (err: any) => {
      setErrorMsg(err.message || 'Failed to assign shift. Please try again.')
    },
  })

  const handleSave = () => {
    setErrorMsg(null)
    if (!userId) {
      setErrorMsg('Please select a staff member.')
      return
    }
    if (!shiftId) {
      setErrorMsg('Please select a shift.')
      return
    }
    if (!workDate) {
      setErrorMsg('Please select a date.')
      return
    }
    assignMutation.mutate({ user_id: userId, shift_id: shiftId, work_date: workDate })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-indigo-950/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-2xl shadow-xl w-full max-w-sm">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/60">
          <h2 className="text-base font-semibold text-gray-900">Assign Shift</h2>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-white/60 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {errorMsg && (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle size={14} className="shrink-0" />
              {errorMsg}
            </div>
          )}

          {/* Staff */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">Staff Member</label>
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-indigo-200/40 rounded-lg bg-white/70 hover:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-400 transition-colors"
            >
              <option value="">Select staff member…</option>
              {staff.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name}
                </option>
              ))}
            </select>
          </div>

          {/* Shift */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">Shift</label>
            <select
              value={shiftId}
              onChange={(e) => setShiftId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-indigo-200/40 rounded-lg bg-white/70 hover:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-400 transition-colors"
            >
              <option value="">Select shift…</option>
              {shifts
                .filter((s) => s.is_active)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({formatTimeRange(s.start_time, s.end_time)})
                  </option>
                ))}
            </select>
          </div>

          {/* Date */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">Date</label>
            <input
              type="date"
              value={workDate}
              onChange={(e) => setWorkDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-indigo-200/40 rounded-lg bg-white/70 hover:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-400 transition-colors"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 pb-5">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={assignMutation.isPending}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={assignMutation.isPending}
            className="flex-1"
          >
            <Calendar size={14} />
            {assignMutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── CreateShiftModal ─────────────────────────────────────────────────────────

interface CreateShiftModalProps {
  existingShift?: Shift | null
  onClose: () => void
  onSuccess: () => void
}

function CreateShiftModal({ existingShift, onClose, onSuccess }: CreateShiftModalProps) {
  const queryClient = useQueryClient()
  const isEdit = !!existingShift

  const [name, setName] = useState(existingShift?.name ?? '')
  const [departmentId, setDepartmentId] = useState(existingShift?.department_id ?? '')
  const [startTime, setStartTime] = useState(
    existingShift ? existingShift.start_time.slice(0, 5) : '07:00',
  )
  const [endTime, setEndTime] = useState(
    existingShift ? existingShift.end_time.slice(0, 5) : '15:00',
  )
  const [isActive, setIsActive] = useState(existingShift?.is_active ?? true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const createMutation = useMutation({
    mutationFn: (data: CreateShiftData) => schedulingApi.createShift(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules-shifts'] })
      onSuccess()
    },
    onError: (err: any) => {
      setErrorMsg(err.message || 'Failed to create shift.')
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateShiftData }) =>
      schedulingApi.updateShift(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules-shifts'] })
      onSuccess()
    },
    onError: (err: any) => {
      setErrorMsg(err.message || 'Failed to update shift.')
    },
  })

  const isPending = createMutation.isPending || updateMutation.isPending

  const handleSave = () => {
    setErrorMsg(null)
    if (!name.trim()) {
      setErrorMsg('Shift name is required.')
      return
    }
    if (!departmentId.trim()) {
      setErrorMsg('Department is required.')
      return
    }
    if (isEdit && existingShift) {
      updateMutation.mutate({
        id: existingShift.id,
        data: {
          name: name.trim(),
          start_time: startTime + ':00',
          end_time: endTime + ':00',
          is_active: isActive,
        },
      })
    } else {
      createMutation.mutate({
        name: name.trim(),
        department_id: departmentId.trim(),
        start_time: startTime + ':00',
        end_time: endTime + ':00',
      })
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-indigo-950/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-2xl shadow-xl w-full max-w-sm">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/60">
          <h2 className="text-base font-semibold text-gray-900">
            {isEdit ? 'Edit Shift' : 'Create Shift'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-white/60 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {errorMsg && (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle size={14} className="shrink-0" />
              {errorMsg}
            </div>
          )}

          {/* Name */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">Shift Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Morning"
              className="w-full px-3 py-2 text-sm border border-indigo-200/40 rounded-lg bg-white/70 hover:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-400 transition-colors"
            />
          </div>

          {/* Department */}
          {!isEdit && (
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">Department</label>
              <select
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-indigo-200/40 rounded-lg bg-white/70 hover:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-400 transition-colors"
              >
                <option value="">Select department…</option>
                {DEPARTMENTS.filter((d) => d.id !== 'all').map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Time range */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">Start Time</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-indigo-200/40 rounded-lg bg-white/70 hover:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-400 transition-colors"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">End Time</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-indigo-200/40 rounded-lg bg-white/70 hover:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-400 transition-colors"
              />
            </div>
          </div>

          {/* Active toggle (edit only) */}
          {isEdit && (
            <div className="flex items-center justify-between py-1">
              <span className="text-sm font-medium text-gray-700">Active</span>
              <button
                type="button"
                onClick={() => setIsActive((a) => !a)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:ring-offset-2 ${
                  isActive ? 'bg-indigo-500' : 'bg-gray-200'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    isActive ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 pb-5">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={isPending}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={isPending}
            className="flex-1"
          >
            {isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Shift'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── ShiftManagement ─────────────────────────────────────────────────────────

interface ShiftManagementProps {
  shifts: Shift[]
  isLoading: boolean
}

function ShiftManagement({ shifts, isLoading }: ShiftManagementProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editShift, setEditShift] = useState<Shift | null>(null)

  return (
    <Card className="overflow-hidden p-0">
      {/* Header */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-indigo-50/40 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <Clock size={16} className="text-indigo-600 shrink-0" />
          <span className="text-sm font-semibold text-slate-800">Manage Shifts</span>
        </div>
        {collapsed ? (
          <ChevronDown size={16} className="text-gray-400" />
        ) : (
          <ChevronUp size={16} className="text-gray-400" />
        )}
      </button>

      {!collapsed && (
        <div className="border-t border-white/40">
          {isLoading ? (
            <div className="px-5 py-4 space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 animate-pulse">
                  <div className="h-4 bg-indigo-100/60 rounded w-32" />
                  <div className="h-4 bg-indigo-100/60 rounded w-20" />
                  <div className="h-4 bg-indigo-100/60 rounded w-24" />
                </div>
              ))}
            </div>
          ) : (
            <>
              {shifts.length === 0 ? (
                <div className="px-5 py-4 text-sm text-slate-400">
                  No shifts defined yet. Create your first shift below.
                </div>
              ) : (
                <div className="divide-y divide-white/30">
                  {shifts.map((shift) => {
                    const color = getShiftColor(shift.name)
                    return (
                      <div
                        key={shift.id}
                        className="flex items-center justify-between px-5 py-3 group hover:bg-indigo-50/30 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold ${color.bg} ${color.text}`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${color.dot}`} />
                            {shift.name}
                          </span>
                          <span className="text-xs text-gray-500">
                            {formatTimeRange(shift.start_time, shift.end_time)}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 text-xs font-medium ${
                              shift.is_active ? 'text-green-600' : 'text-gray-400'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                shift.is_active ? 'bg-green-500' : 'bg-gray-300'
                              }`}
                            />
                            {shift.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <button
                          onClick={() => setEditShift(shift)}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <Pencil size={11} />
                          Edit
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Create shift button */}
              <div className="px-5 py-3 border-t border-white/40">
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-700 transition-colors"
                >
                  <Plus size={15} />
                  Create Shift
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Create modal */}
      {showCreateModal && (
        <CreateShiftModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => setShowCreateModal(false)}
        />
      )}

      {/* Edit modal */}
      {editShift && (
        <CreateShiftModal
          existingShift={editShift}
          onClose={() => setEditShift(null)}
          onSuccess={() => setEditShift(null)}
        />
      )}
    </Card>
  )
}

// ─── WeekCalendar ─────────────────────────────────────────────────────────────

interface WeekCalendarProps {
  weekStart: Date
  departmentFilter: string
  shifts: Shift[]
  staff: StaffMember[]
  assignments: ShiftAssignment[]
  isLoading: boolean
  isError: boolean
  onRefetch: () => void
  onCellClick: (staffMember: StaffMember, day: Date) => void
}

function WeekCalendar({
  weekStart,
  departmentFilter,
  shifts,
  staff,
  assignments,
  isLoading,
  isError,
  onRefetch,
  onCellClick,
}: WeekCalendarProps) {
  const [viewMode, setViewMode] = useState<'by-staff' | 'by-shift'>('by-staff')
  const weekDays = getWeekDays(weekStart)

  // Build lookup: user_id → work_date → assignment
  const assignmentMap = useMemo(() => {
    const map: Record<string, Record<string, ShiftAssignment>> = {}
    for (const a of assignments) {
      if (!map[a.user_id]) map[a.user_id] = {}
      map[a.user_id][a.work_date] = a
    }
    return map
  }, [assignments])

  // Build shift lookup: id → Shift
  const shiftMap = useMemo(() => {
    const map: Record<string, Shift> = {}
    for (const s of shifts) map[s.id] = s
    return map
  }, [shifts])

  // Filter staff by department
  const filteredStaff = useMemo(() => {
    if (departmentFilter === 'all') return staff
    return staff.filter((m) => {
      if (!m.department_id) return false
      return m.department_id.toLowerCase().includes(departmentFilter.toLowerCase()) ||
        (m.role.toLowerCase().includes(departmentFilter.toLowerCase()))
    })
  }, [staff, departmentFilter])

  // ── By Shift view: group assignments by shift → day
  const byShiftRows = useMemo(() => {
    if (viewMode !== 'by-shift') return []
    const rows: {
      shift: Shift
      days: Record<string, ShiftAssignment[]>
    }[] = shifts
      .filter((s) => s.is_active)
      .map((s) => ({
        shift: s,
        days: Object.fromEntries(weekDays.map((d) => [format(d, 'yyyy-MM-dd'), []])),
      }))
    for (const a of assignments) {
      const row = rows.find((r) => r.shift.id === a.shift_id)
      if (row && row.days[a.work_date] !== undefined) {
        row.days[a.work_date].push(a)
      }
    }
    return rows
  }, [viewMode, shifts, assignments, weekDays])

  const weekLabel = `${format(weekDays[0], 'MMM d')} – ${format(weekDays[6], 'MMM d, yyyy')}`

  return (
    <Card className="overflow-hidden p-0">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-5 py-4 border-b border-white/60">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-800">Week of {weekLabel}</span>
        </div>
        {/* View toggle */}
        <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden text-sm">
          <button
            onClick={() => setViewMode('by-staff')}
            className={`px-3 py-1.5 font-medium transition-colors ${
              viewMode === 'by-staff'
                ? 'bg-brand-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            By Staff
          </button>
          <button
            onClick={() => setViewMode('by-shift')}
            className={`px-3 py-1.5 font-medium transition-colors ${
              viewMode === 'by-shift'
                ? 'bg-brand-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            By Shift
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        {isLoading ? (
          <div className="p-5 space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex gap-3 animate-pulse">
                <div className="h-9 bg-gray-200 rounded w-36 shrink-0" />
                {weekDays.map((d) => (
                  <div key={d.toISOString()} className="h-9 bg-gray-100 rounded flex-1 min-w-[80px]" />
                ))}
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-red-600 font-medium">Failed to load schedule.</p>
            <button
              onClick={onRefetch}
              className="mt-2 text-sm text-brand-600 hover:underline"
            >
              Try again
            </button>
          </div>
        ) : viewMode === 'by-staff' ? (
          <table className="w-full min-w-[700px]">
            <thead>
              <tr className="border-b border-white/60 bg-indigo-50/60">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3 w-40 shrink-0">
                  Staff
                </th>
                {weekDays.map((day, i) => {
                  const isToday = isSameDay(day, new Date())
                  return (
                    <th
                      key={day.toISOString()}
                      className={`text-center text-xs font-semibold uppercase tracking-wider px-2 py-3 min-w-[90px] ${
                        isToday ? 'text-brand-700' : 'text-gray-500'
                      }`}
                    >
                      <span>{DAY_LABELS[i]}</span>
                      <span
                        className={`ml-1 ${isToday ? 'text-brand-700 font-bold' : 'text-gray-400'}`}
                      >
                        {format(day, 'd')}
                      </span>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredStaff.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-5 py-10 text-center text-sm text-gray-400"
                  >
                    No staff found for the selected department.
                  </td>
                </tr>
              ) : (
                filteredStaff.map((member) => {
                  const memberAssignments = assignmentMap[member.id] ?? {}
                  return (
                    <tr key={member.id} className="hover:bg-gray-50 transition-colors group">
                      {/* Staff name cell */}
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 text-xs font-semibold shrink-0">
                            {getInitials(member.full_name)}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate leading-tight">
                              {member.full_name.split(' ')[0]}
                            </p>
                            <p className="text-xs text-gray-400 truncate leading-tight capitalize">
                              {member.role.replace(/_/g, ' ')}
                            </p>
                          </div>
                        </div>
                      </td>
                      {/* Day cells */}
                      {weekDays.map((day) => {
                        const dateKey = format(day, 'yyyy-MM-dd')
                        const assignment = memberAssignments[dateKey]
                        const shift = assignment ? shiftMap[assignment.shift_id] : null
                        const isToday = isSameDay(day, new Date())
                        const isClockedIn = !!(assignment?.clocked_in_at)
                        const isClockedOut = !!(assignment?.clocked_out_at)

                        return (
                          <td
                            key={dateKey}
                            className={`px-2 py-3 text-center ${
                              isToday ? 'bg-indigo-400/[0.12] border-indigo-300/[0.30]' : ''
                            }`}
                          >
                            {shift ? (
                              <button
                                onClick={() => onCellClick(member, day)}
                                className={`inline-flex items-center justify-center gap-1.5 w-full px-2 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer hover:opacity-80 ${
                                  isClockedOut
                                    ? 'bg-gray-100 text-gray-400 line-through'
                                    : getShiftColor(shift.name).bg +
                                      ' ' +
                                      getShiftColor(shift.name).text
                                }`}
                              >
                                {isClockedIn && !isClockedOut && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                                )}
                                {isClockedOut && (
                                  <CheckCircle2 size={10} className="shrink-0" />
                                )}
                                <span className="truncate">
                                  {shift.name} {formatTimeRange(shift.start_time, shift.end_time)}
                                </span>
                              </button>
                            ) : (
                              <button
                                onClick={() => onCellClick(member, day)}
                                className="inline-flex items-center justify-center w-full px-2 py-1.5 rounded-lg text-xs text-gray-300 hover:bg-gray-100 hover:text-gray-500 transition-colors"
                                title={`Assign shift to ${member.full_name} on ${format(day, 'MMM d')}`}
                              >
                                —
                              </button>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        ) : (
          /* By Shift view */
          <table className="w-full min-w-[700px]">
            <thead>
              <tr className="border-b border-white/60 bg-indigo-50/60">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3 w-44 shrink-0">
                  Shift
                </th>
                {weekDays.map((day, i) => {
                  const isToday = isSameDay(day, new Date())
                  return (
                    <th
                      key={day.toISOString()}
                      className={`text-center text-xs font-semibold uppercase tracking-wider px-2 py-3 min-w-[90px] ${
                        isToday ? 'text-brand-700' : 'text-gray-500'
                      }`}
                    >
                      {DAY_LABELS[i]}{' '}
                      <span className={isToday ? 'font-bold' : 'text-gray-400'}>
                        {format(day, 'd')}
                      </span>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {byShiftRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-sm text-gray-400">
                    No active shifts found.
                  </td>
                </tr>
              ) : (
                byShiftRows.map(({ shift, days }) => {
                  const color = getShiftColor(shift.name)
                  return (
                    <tr key={shift.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold ${color.bg} ${color.text}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${color.dot}`} />
                          {shift.name}
                        </span>
                        <p className="text-xs text-gray-400 mt-0.5 pl-0.5">
                          {formatTimeRange(shift.start_time, shift.end_time)}
                        </p>
                      </td>
                      {weekDays.map((day) => {
                        const dateKey = format(day, 'yyyy-MM-dd')
                        const dayAssignments = days[dateKey] ?? []
                        const isToday = isSameDay(day, new Date())
                        return (
                          <td
                            key={dateKey}
                            className={`px-2 py-3 text-center ${
                              isToday ? 'bg-indigo-400/[0.12] border-indigo-300/[0.30]' : ''
                            }`}
                          >
                            {dayAssignments.length === 0 ? (
                              <span className="text-xs text-gray-300">—</span>
                            ) : (
                              <div className="flex flex-wrap justify-center gap-1">
                                {dayAssignments.map((a) => {
                                  const memberName =
                                    a.user_profiles?.preferred_name ||
                                    a.user_profiles?.full_name ||
                                    '?'
                                  return (
                                    <span
                                      key={a.id}
                                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${
                                        a.clocked_out_at
                                          ? 'bg-gray-100 text-gray-400'
                                          : a.clocked_in_at
                                          ? 'bg-green-50 text-green-700'
                                          : 'bg-gray-50 text-gray-600'
                                      }`}
                                      title={`${memberName}${a.clocked_in_at ? ' (clocked in)' : ''}`}
                                    >
                                      {a.clocked_in_at && !a.clocked_out_at && (
                                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                                      )}
                                      {a.clocked_out_at && (
                                        <CheckCircle2 size={9} className="shrink-0" />
                                      )}
                                      {getInitials(memberName)}
                                    </span>
                                  )
                                })}
                              </div>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  )
}

// ─── SchedulingPage ───────────────────────────────────────────────────────────

export default function SchedulingPage() {
  const { isSupervisor, canManageStaff } = useRole()
  const queryClient = useQueryClient()

  // ── Local state
  const [weekStart, setWeekStart] = useState<Date>(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 }),
  )
  const [departmentFilter, setDepartmentFilter] = useState('all')
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [assignModalDate, setAssignModalDate] = useState<Date | undefined>(undefined)

  // ── Week navigation
  const prevWeek = useCallback(() => setWeekStart((w) => subWeeks(w, 1)), [])
  const nextWeek = useCallback(() => setWeekStart((w) => addWeeks(w, 1)), [])

  const weekDays = getWeekDays(weekStart)
  const dateFrom = format(weekDays[0], 'yyyy-MM-dd')
  const dateTo = format(weekDays[6], 'yyyy-MM-dd')

  // ── Queries

  const shiftsQuery = useQuery({
    queryKey: ['schedules-shifts'],
    queryFn: () => schedulingApi.listShifts({ is_active: undefined }),
    select: (res) => res.data.shifts,
    staleTime: 5 * 60_000,
  })

  const staffQuery = useQuery({
    queryKey: ['staff'],
    queryFn: () => staffApi.list(),
    select: (res) => res.data.staff,
    staleTime: 5 * 60_000,
  })

  const assignmentsQuery = useQuery({
    queryKey: ['schedules-assignments', dateFrom, dateTo],
    queryFn: async () => {
      // Fetch all 7 days — we pass no date filter (the API gets filtered by work_date)
      // We fetch once per day for the week, or use a range if the API supports it
      // Since the API takes a single work_date, we request each day or rely on all-assignments
      const res = await schedulingApi.listAssignments({})
      return res
    },
    select: (res) => {
      // Filter client-side to the visible week
      return res.data.assignments.filter(
        (a) => a.work_date >= dateFrom && a.work_date <= dateTo,
      )
    },
    staleTime: 60_000,
  })

  const shifts = shiftsQuery.data ?? []
  const staff = staffQuery.data ?? []
  const assignments = assignmentsQuery.data ?? []

  // ── Cell click → open assign modal
  const handleCellClick = useCallback((member: StaffMember, day: Date) => {
    if (!isSupervisor) return
    setAssignModalDate(day)
    setShowAssignModal(true)
  }, [isSupervisor])

  // ── Week label
  const weekLabel = `${format(weekDays[0], 'MMM d')} – ${format(weekDays[6], 'MMM d, yyyy')}`

  return (
    <div className="space-y-5">
      {/* ── Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">Staff Scheduling</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Manage shift assignments and view weekly coverage
          </p>
        </div>
        {isSupervisor && (
          <Button
            variant="primary"
            onClick={() => {
              setAssignModalDate(undefined)
              setShowAssignModal(true)
            }}
          >
            <Plus size={15} />
            Assign Staff
          </Button>
        )}
      </div>

      {/* ── Today's Roster */}
      <TodayRoster />

      {/* ── Department filter tabs */}
      <div className="flex items-center gap-1 flex-wrap">
        {DEPARTMENTS.map((dept) => (
          <button
            key={dept.id}
            onClick={() => setDepartmentFilter(dept.id)}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              departmentFilter === dept.id
                ? 'bg-brand-600 text-white'
                : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            {dept.label}
          </button>
        ))}
      </div>

      {/* ── Week navigation */}
      <div className="flex items-center gap-3">
        <button
          onClick={prevWeek}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <ChevronLeft size={15} />
          Prev
        </button>
        <span className="text-sm font-semibold text-gray-800 min-w-[200px] text-center">
          Week of {weekLabel}
        </span>
        <button
          onClick={nextWeek}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          Next
          <ChevronRight size={15} />
        </button>
      </div>

      {/* ── Weekly Calendar */}
      <WeekCalendar
        weekStart={weekStart}
        departmentFilter={departmentFilter}
        shifts={shifts}
        staff={staff}
        assignments={assignments}
        isLoading={assignmentsQuery.isLoading || staffQuery.isLoading}
        isError={assignmentsQuery.isError}
        onRefetch={() => {
          assignmentsQuery.refetch()
          staffQuery.refetch()
        }}
        onCellClick={handleCellClick}
      />

      {/* ── Shift Management (GM / supervisor only) */}
      {isSupervisor && (
        <ShiftManagement shifts={shifts} isLoading={shiftsQuery.isLoading} />
      )}

      {/* ── Assign Shift Modal */}
      {showAssignModal && (
        <AssignShiftModal
          initialDate={assignModalDate}
          shifts={shifts}
          staff={staff}
          onClose={() => setShowAssignModal(false)}
          onSuccess={() => {
            setShowAssignModal(false)
            queryClient.invalidateQueries({ queryKey: ['schedules-assignments'] })
          }}
        />
      )}
    </div>
  )
}
