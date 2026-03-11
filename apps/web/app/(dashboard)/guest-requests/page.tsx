'use client'

import { useState } from 'react'
import {
  Bell,
  Plus,
  CheckCircle,
  AlertTriangle,
  Clock,
  X,
  Loader2,
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow, format } from 'date-fns'
import {
  guestRequestsApi,
  type GuestRequest,
  type GuestRequestStatus,
} from '@/lib/api/guest_requests'
import { useRole } from '@/lib/hooks/useRole'

// ─── Types ────────────────────────────────────────────────────────────────────

type ActiveTab = GuestRequestStatus

// ─── Constants ────────────────────────────────────────────────────────────────

const TABS: { value: ActiveTab; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'escalated', label: 'Escalated' },
  { value: 'resolved', label: 'Resolved' },
]

const STATUS_STYLES: Record<GuestRequestStatus, string> = {
  open: 'bg-blue-50 text-blue-700',
  in_progress: 'bg-purple-50 text-purple-700',
  escalated: 'bg-red-50 text-red-700',
  resolved: 'bg-green-50 text-green-700',
}

const STATUS_LABELS: Record<GuestRequestStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  escalated: 'Escalated',
  resolved: 'Resolved',
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: GuestRequestStatus }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}

// ─── Guest Request Card ───────────────────────────────────────────────────────

interface GuestRequestCardProps {
  request: GuestRequest
  canAct: boolean
  onUpdateStatus: (id: string, status: GuestRequestStatus) => void
  isUpdating: boolean
  updatingId: string | null
}

function GuestRequestCard({
  request,
  canAct,
  onUpdateStatus,
  isUpdating,
  updatingId,
}: GuestRequestCardProps) {
  const isPending = isUpdating && updatingId === request.id

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
      {/* Top row: request number + status badge */}
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="font-mono text-xs text-gray-400 tracking-wider">
          GR-{String(request.request_number).padStart(3, '0')}
        </span>
        <StatusBadge status={request.status} />
      </div>

      {/* Title */}
      <p className="font-semibold text-gray-900 text-sm leading-snug mb-2">
        {request.title}
      </p>

      {/* Description (if any) */}
      {request.description && (
        <p className="text-xs text-gray-500 mb-2 line-clamp-2">{request.description}</p>
      )}

      {/* Meta row: guest name, room, time */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 mb-3">
        {request.guest_name && (
          <span className="flex items-center gap-1">
            <span className="font-medium text-gray-700">{request.guest_name}</span>
          </span>
        )}
        {request.rooms?.room_number && (
          <span className="flex items-center gap-1">
            <span>Room {request.rooms.room_number}</span>
          </span>
        )}
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formatDistanceToNow(new Date(request.created_at), { addSuffix: true })}
        </span>
      </div>

      {/* Resolved timestamp */}
      {request.status === 'resolved' && request.resolved_at && (
        <p className="text-xs text-green-600 mb-3 flex items-center gap-1">
          <CheckCircle className="w-3 h-3" />
          Resolved {format(new Date(request.resolved_at), 'MMM d, h:mm a')}
        </p>
      )}

      {/* Action buttons */}
      {canAct && request.status !== 'resolved' && (
        <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
          {isPending ? (
            <span className="flex items-center gap-1.5 text-xs text-gray-500">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Updating…
            </span>
          ) : (
            <>
              {/* Open → Start or Escalate */}
              {request.status === 'open' && (
                <>
                  <button
                    onClick={() => onUpdateStatus(request.id, 'in_progress')}
                    className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-medium hover:bg-purple-700 transition-colors"
                  >
                    Start
                  </button>
                  <button
                    onClick={() => onUpdateStatus(request.id, 'escalated')}
                    className="px-3 py-1.5 bg-red-50 text-red-700 border border-red-200 rounded-lg text-xs font-medium hover:bg-red-100 transition-colors flex items-center gap-1"
                  >
                    <AlertTriangle className="w-3 h-3" />
                    Escalate
                  </button>
                </>
              )}

              {/* In Progress → Resolve or Escalate */}
              {request.status === 'in_progress' && (
                <>
                  <button
                    onClick={() => onUpdateStatus(request.id, 'resolved')}
                    className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 transition-colors flex items-center gap-1"
                  >
                    <CheckCircle className="w-3 h-3" />
                    Resolve
                  </button>
                  <button
                    onClick={() => onUpdateStatus(request.id, 'escalated')}
                    className="px-3 py-1.5 bg-red-50 text-red-700 border border-red-200 rounded-lg text-xs font-medium hover:bg-red-100 transition-colors flex items-center gap-1"
                  >
                    <AlertTriangle className="w-3 h-3" />
                    Escalate
                  </button>
                </>
              )}

              {/* Escalated → Resolve only */}
              {request.status === 'escalated' && (
                <button
                  onClick={() => onUpdateStatus(request.id, 'resolved')}
                  className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 transition-colors flex items-center gap-1"
                >
                  <CheckCircle className="w-3 h-3" />
                  Resolve
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Skeleton Card ────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 animate-pulse">
      <div className="flex items-center justify-between mb-2">
        <div className="h-3 w-16 bg-gray-200 rounded" />
        <div className="h-5 w-20 bg-gray-200 rounded-full" />
      </div>
      <div className="h-4 w-3/4 bg-gray-200 rounded mb-2" />
      <div className="h-3 w-1/2 bg-gray-100 rounded mb-3" />
      <div className="flex gap-2 pt-2 border-t border-gray-100">
        <div className="h-7 w-16 bg-gray-200 rounded-lg" />
        <div className="h-7 w-20 bg-gray-200 rounded-lg" />
      </div>
    </div>
  )
}

// ─── Create Request Modal ─────────────────────────────────────────────────────

interface CreateRequestModalProps {
  isOpen: boolean
  onClose: () => void
  onCreate: () => void
}

function CreateRequestModal({ isOpen, onClose, onCreate }: CreateRequestModalProps) {
  const [title, setTitle] = useState('')
  const [guestName, setGuestName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      guestRequestsApi.createRequest({
        title: title.trim(),
        guest_name: guestName.trim() || undefined,
        description: description.trim() || undefined,
      }),
    onSuccess: () => {
      setTitle('')
      setGuestName('')
      setDescription('')
      setError(null)
      onCreate()
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to create request')
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) {
      setError('Please enter a title for the request.')
      return
    }
    setError(null)
    mutate()
  }

  function handleClose() {
    setTitle('')
    setGuestName('')
    setDescription('')
    setError(null)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">New Guest Request</h2>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Issue or request description <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Extra towels needed, AC not cooling..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              autoFocus
            />
          </div>

          {/* Guest name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Guest name <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="e.g. John Smith"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Additional details <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Room number, urgency, or any other context..."
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-none"
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || !title.trim()}
              className="flex-1 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {isPending ? 'Creating…' : 'Create Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function GuestRequestsPage() {
  const { isGM, role } = useRole()
  const queryClient = useQueryClient()

  const isFrontDesk = role === 'front_desk'
  const isSupervisor = role === 'housekeeping_supervisor'
  const canCreate = isGM || isFrontDesk || isSupervisor
  const canAct = isGM || isFrontDesk || isSupervisor

  const [activeTab, setActiveTab] = useState<ActiveTab>('open')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  // ── Fetch all requests, filter client-side ──
  const { data: requests, isLoading } = useQuery({
    queryKey: ['guest-requests'],
    queryFn: () => guestRequestsApi.listRequests({ per_page: 100 }),
    select: (res) => res.data as GuestRequest[],
    refetchInterval: 60_000,
  })

  // ── Computed counts ──
  const counts = {
    open: requests?.filter((r) => r.status === 'open').length ?? 0,
    in_progress: requests?.filter((r) => r.status === 'in_progress').length ?? 0,
    escalated: requests?.filter((r) => r.status === 'escalated').length ?? 0,
    resolved: requests?.filter((r) => r.status === 'resolved').length ?? 0,
  }

  const filtered = (requests ?? []).filter((r) => r.status === activeTab)

  // ── Status update mutation ──
  const { mutate: updateStatus, isPending: isUpdating } = useMutation({
    mutationFn: ({ id, status }: { id: string; status: GuestRequestStatus }) =>
      guestRequestsApi.updateRequest(id, { status }),
    onMutate: ({ id }) => setUpdatingId(id),
    onSettled: () => setUpdatingId(null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['guest-requests'] })
    },
  })

  function handleUpdateStatus(id: string, status: GuestRequestStatus) {
    updateStatus({ id, status })
  }

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
            <Bell className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Guest Requests</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Track and resolve guest service requests
            </p>
          </div>
        </div>
        {canCreate && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" />
            New Request
          </button>
        )}
      </div>

      {/* ── Stats row ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Open */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <p className="text-2xl font-bold text-blue-600">{counts.open}</p>
          <p className="text-xs text-gray-500 mt-0.5 font-medium uppercase tracking-wide">
            Open
          </p>
        </div>
        {/* In Progress */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <p className="text-2xl font-bold text-purple-600">{counts.in_progress}</p>
          <p className="text-xs text-gray-500 mt-0.5 font-medium uppercase tracking-wide">
            In Progress
          </p>
        </div>
        {/* Escalated */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <p className="text-2xl font-bold text-red-600">{counts.escalated}</p>
          <p className="text-xs text-gray-500 mt-0.5 font-medium uppercase tracking-wide">
            Escalated
          </p>
        </div>
        {/* Resolved */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <p className="text-2xl font-bold text-green-600">{counts.resolved}</p>
          <p className="text-xs text-gray-500 mt-0.5 font-medium uppercase tracking-wide">
            Resolved
          </p>
        </div>
      </div>

      {/* ── Status tabs ── */}
      <div className="flex gap-1.5 flex-wrap">
        {TABS.map((tab) => {
          const count = counts[tab.value]
          const isActive = activeTab === tab.value
          return (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                isActive
                  ? tab.value === 'open'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : tab.value === 'in_progress'
                    ? 'bg-purple-600 text-white border-purple-600'
                    : tab.value === 'escalated'
                    ? 'bg-red-600 text-white border-red-600'
                    : 'bg-green-600 text-white border-green-600'
                  : tab.value === 'open'
                  ? 'bg-white text-blue-700 border-blue-200 hover:bg-blue-50'
                  : tab.value === 'in_progress'
                  ? 'bg-white text-purple-700 border-purple-200 hover:bg-purple-50'
                  : tab.value === 'escalated'
                  ? 'bg-white text-red-700 border-red-200 hover:bg-red-50'
                  : 'bg-white text-green-700 border-green-200 hover:bg-green-50'
              }`}
            >
              {tab.label}
              {count > 0 && (
                <span
                  className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold ${
                    isActive
                      ? 'bg-white/25 text-white'
                      : tab.value === 'open'
                      ? 'bg-blue-100 text-blue-700'
                      : tab.value === 'in_progress'
                      ? 'bg-purple-100 text-purple-700'
                      : tab.value === 'escalated'
                      ? 'bg-red-100 text-red-700'
                      : 'bg-green-100 text-green-700'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── Request list ── */}
      {isLoading ? (
        <div className="space-y-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
            {activeTab === 'resolved' ? (
              <CheckCircle className="w-6 h-6 text-gray-400" />
            ) : activeTab === 'escalated' ? (
              <AlertTriangle className="w-6 h-6 text-gray-400" />
            ) : (
              <Bell className="w-6 h-6 text-gray-400" />
            )}
          </div>
          <p className="text-sm font-medium text-gray-700">
            No {STATUS_LABELS[activeTab].toLowerCase()} requests
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {activeTab === 'open'
              ? 'All caught up! No open guest requests right now.'
              : activeTab === 'in_progress'
              ? 'No requests are currently being worked on.'
              : activeTab === 'escalated'
              ? 'No escalated requests — great job!'
              : 'No resolved requests yet for today.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((request) => (
            <GuestRequestCard
              key={request.id}
              request={request}
              canAct={canAct}
              onUpdateStatus={handleUpdateStatus}
              isUpdating={isUpdating}
              updatingId={updatingId}
            />
          ))}
        </div>
      )}

      {/* ── Create Request Modal ── */}
      <CreateRequestModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreate={() => {
          setShowCreateModal(false)
          queryClient.invalidateQueries({ queryKey: ['guest-requests'] })
        }}
      />
    </div>
  )
}
