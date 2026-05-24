'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
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
import { roomsApi } from '@/lib/api/rooms'
import { staffApi, type StaffMember } from '@/lib/api/staff'
import { useRole } from '@/lib/hooks/useRole'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Pill, Mono, SectionLabel, AILabel } from '@/components/ui/primitives'
import { KebabMenu } from '@/components/shared/KebabMenu'
import { DeleteConfirmDialog } from '@/components/shared/DeleteConfirmDialog'

// ─── Types ────────────────────────────────────────────────────────────────────

type ActiveTab = GuestRequestStatus

// ─── Constants ────────────────────────────────────────────────────────────────

const TABS: { value: ActiveTab; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'escalated', label: 'Escalated' },
  { value: 'resolved', label: 'Resolved' },
]

const STATUS_TONES: Record<GuestRequestStatus, 'alert' | 'caution' | 'ready'> = {
  open: 'alert',
  in_progress: 'caution',
  escalated: 'alert',
  resolved: 'ready',
}

const STATUS_LABELS: Record<GuestRequestStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  escalated: 'Escalated',
  resolved: 'Resolved',
}

// ─── Guest Request Card ───────────────────────────────────────────────────────

interface GuestRequestCardProps {
  request: GuestRequest
  canAct: boolean
  onUpdateStatus: (id: string, status: GuestRequestStatus) => void
  onEdit: (request: GuestRequest) => void
  onDelete: (request: GuestRequest) => void
  isUpdating: boolean
  updatingId: string | null
}

function GuestRequestCard({
  request,
  canAct,
  onUpdateStatus,
  onEdit,
  onDelete,
  isUpdating,
  updatingId,
}: GuestRequestCardProps) {
  const isPending = isUpdating && updatingId === request.id

  return (
    <div className="bg-surface border border-line rounded-[var(--r-lg)] shadow-sm p-4 hover:shadow-md hover:-translate-y-0.5 transition-all">
      {/* Top row: request number + status badge + kebab */}
      <div className="flex items-center justify-between gap-3 mb-2">
        <Mono className="text-[11px] text-ink3">
          GR-{String(request.request_number).padStart(3, '0')}
        </Mono>
        <div className="flex items-center gap-1">
          <Pill tone={STATUS_TONES[request.status]} size="sm">
            {STATUS_LABELS[request.status]}
          </Pill>
          <KebabMenu onEdit={() => onEdit(request)} onDelete={() => onDelete(request)} />
        </div>
      </div>

      {/* Title */}
      <p className="font-semibold text-ink text-sm leading-snug mb-2">
        {request.title}
      </p>

      {/* Description (if any) */}
      {request.description && (
        <p className="text-xs text-ink3 mb-2 line-clamp-2">{request.description}</p>
      )}

      {/* Meta row: guest name, room, time */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink3 mb-3">
        {request.guest_name && (
          <span className="flex items-center gap-1">
            <span className="font-medium text-ink2">{request.guest_name}</span>
          </span>
        )}
        {request.rooms?.room_number && (
          <span className="flex items-center gap-1">
            <span>Room {request.rooms.room_number}</span>
          </span>
        )}
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          <Mono className="text-[11px] text-ink3">
            {formatDistanceToNow(new Date(request.created_at), { addSuffix: true })}
          </Mono>
        </span>
      </div>

      {/* Resolved timestamp */}
      {request.status === 'resolved' && request.resolved_at && (
        <p className="text-xs text-[var(--ready)] mb-3 flex items-center gap-1">
          <CheckCircle className="w-3 h-3" />
          Resolved {format(new Date(request.resolved_at), 'MMM d, h:mm a')}
        </p>
      )}

      {/* Action buttons */}
      {canAct && request.status !== 'resolved' && (
        <div className="flex flex-wrap gap-2 pt-2 border-t border-line-2">
          {isPending ? (
            <span className="flex items-center gap-1.5 text-xs text-ink3">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Updating…
            </span>
          ) : (
            <>
              {/* Open → Start or Escalate */}
              {request.status === 'open' && (
                <>
                  <button
                    disabled={isUpdating}
                    onClick={() => onUpdateStatus(request.id, 'in_progress')}
                    className="px-3 py-1.5 bg-[var(--caution)] text-white rounded-lg text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    Start
                  </button>
                  <button
                    disabled={isUpdating}
                    onClick={() => onUpdateStatus(request.id, 'escalated')}
                    className="px-3 py-1.5 bg-[var(--alert-soft)] text-[var(--alert)] border border-[var(--alert-line)] rounded-lg text-xs font-medium hover:bg-[var(--alert-soft)] transition-colors flex items-center gap-1 disabled:opacity-50"
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
                    disabled={isUpdating}
                    onClick={() => onUpdateStatus(request.id, 'resolved')}
                    className="px-3 py-1.5 bg-[var(--ready)] text-white rounded-lg text-xs font-medium hover:opacity-90 transition-opacity flex items-center gap-1 disabled:opacity-50"
                  >
                    <CheckCircle className="w-3 h-3" />
                    Resolve
                  </button>
                  <button
                    disabled={isUpdating}
                    onClick={() => onUpdateStatus(request.id, 'escalated')}
                    className="px-3 py-1.5 bg-[var(--alert-soft)] text-[var(--alert)] border border-[var(--alert-line)] rounded-lg text-xs font-medium hover:bg-[var(--alert-soft)] transition-colors flex items-center gap-1 disabled:opacity-50"
                  >
                    <AlertTriangle className="w-3 h-3" />
                    Escalate
                  </button>
                </>
              )}

              {/* Escalated → Resolve only */}
              {request.status === 'escalated' && (
                <button
                  disabled={isUpdating}
                  onClick={() => onUpdateStatus(request.id, 'resolved')}
                  className="px-3 py-1.5 bg-[var(--ready)] text-white rounded-lg text-xs font-medium hover:opacity-90 transition-opacity flex items-center gap-1 disabled:opacity-50"
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
    <div className="bg-surface border border-line rounded-[var(--r-lg)] shadow-sm p-4 animate-pulse">
      <div className="flex items-center justify-between mb-2">
        <div className="h-3 w-16 bg-surface-3 rounded" />
        <div className="h-5 w-20 bg-surface-3 rounded-full" />
      </div>
      <div className="h-4 w-3/4 bg-surface-3 rounded mb-2" />
      <div className="h-3 w-1/2 bg-surface-2 rounded mb-3" />
      <div className="flex gap-2 pt-2 border-t border-line-2">
        <div className="h-7 w-16 bg-surface-3 rounded-lg" />
        <div className="h-7 w-20 bg-surface-3 rounded-lg" />
      </div>
    </div>
  )
}

// ─── Edit Request Modal ───────────────────────────────────────────────────────

interface EditRequestModalProps {
  request: GuestRequest | null
  onClose: () => void
  onSaved: () => void
}

function EditRequestModal({ request, onClose, onSaved }: EditRequestModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = modalRef.current
    if (!el) return
    const focusable = el.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]')
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab') return
      if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last?.focus() } }
      else { if (document.activeElement === last) { e.preventDefault(); first?.focus() } }
    }
    document.addEventListener('keydown', onKey)
    first?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  const { role } = useRole()
  const canAssign = role === 'gm' || role === 'housekeeping_supervisor' || role === 'front_desk'

  const { data: housekeepers = [] } = useQuery({
    queryKey: ['staff-list'],
    queryFn: () => staffApi.list(),
    enabled: canAssign,
    select: (res) => (res.data as { staff: StaffMember[] }).staff.filter(
      s => s.role === 'housekeeper' && s.status === 'active'
    ),
  })

  const { data: roomsData } = useQuery({
    queryKey: ['rooms-list'],
    queryFn: () => roomsApi.list(),
    select: (res) => (res as any).data ?? [],
  })
  const rooms: any[] = roomsData ?? []

  const [form, setForm] = useState({
    title: request?.title ?? '',
    description: request?.description ?? '',
    room_number: request?.rooms?.room_number ?? '',
    status: request?.status ?? 'open',
    assigned_to: request?.assigned_to ?? '',
  })
  const [error, setError] = useState<string | null>(null)

  const { mutate, isPending } = useMutation({
    mutationFn: () => {
      const trimmed = form.room_number.trim()
      let room_id: string | undefined = request?.room_id
      if (trimmed) {
        const match = rooms.find((r: any) =>
          (r.rooms?.room_number ?? '').toLowerCase() === trimmed.toLowerCase()
        )
        if (!match) throw new Error(`Room "${trimmed}" not found. Check the room number.`)
        room_id = match.room_id
      } else {
        room_id = undefined
      }
      return guestRequestsApi.updateRequest(request!.id, {
        title: form.title.trim() || undefined,
        description: form.description.trim() || undefined,
        room_id,
        status: form.status as GuestRequestStatus,
        assigned_to: form.assigned_to || undefined,
      })
    },
    onSuccess: () => { setError(null); onSaved() },
    onError: (err: Error) => setError(err.message || 'Failed to save'),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) { setError('Title is required.'); return }
    setError(null)
    mutate()
  }

  if (!request) return null

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="edit-request-title" className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-stone-900/20 backdrop-blur-sm" onClick={onClose} />
      <div ref={modalRef} className="relative bg-surface/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-[var(--r-lg)] shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 id="edit-request-title" className="text-lg font-semibold text-ink">Edit Guest Request</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-2 text-ink3 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="edit-req-title" className="block text-sm font-medium text-ink2 mb-1">Issue / Request <span className="text-[var(--alert)]">*</span></label>
            <input id="edit-req-title" type="text" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 bg-surface text-ink" autoFocus />
          </div>
          <div>
            <label htmlFor="edit-req-room" className="block text-sm font-medium text-ink2 mb-1">Room Number</label>
            <input id="edit-req-room" type="text" value={form.room_number} onChange={(e) => setForm((f) => ({ ...f, room_number: e.target.value }))} placeholder="e.g. 302" className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 bg-surface text-ink" />
          </div>
          <div>
            <label htmlFor="edit-req-status" className="block text-sm font-medium text-ink2 mb-1">Status</label>
            <select id="edit-req-status" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as GuestRequestStatus }))} className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30">
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="escalated">Escalated</option>
              <option value="resolved">Resolved</option>
            </select>
          </div>
          {canAssign && housekeepers.length > 0 && (
            <div>
              <label htmlFor="edit-req-assignee" className="block text-sm font-medium text-ink2 mb-1">Assign to housekeeper</label>
              <select
                id="edit-req-assignee"
                value={form.assigned_to}
                onChange={(e) => setForm((f) => ({ ...f, assigned_to: e.target.value }))}
                className="w-full border border-line rounded-lg px-3 py-2 text-sm bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
              >
                <option value="">Unassigned</option>
                {housekeepers.map(h => (
                  <option key={h.user_id} value={h.user_id}>{h.full_name}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="edit-req-details" className="block text-sm font-medium text-ink2 mb-1">Additional Details</label>
            <textarea id="edit-req-details" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} placeholder="Room number, urgency, or any other context..." className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 bg-surface text-ink resize-none" />
          </div>
          {error && <p className="text-sm text-[var(--alert)] bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-3 pt-1">
            <Button type="button" variant="ghost" onClick={onClose} className="flex-1 justify-center">Cancel</Button>
            <Button type="submit" variant="primary" disabled={isPending || !form.title.trim()} className="flex-1 justify-center">
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {isPending ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </form>
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
  const modalRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!isOpen) return
    const el = modalRef.current
    if (!el) return
    const focusable = el.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]')
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { handleClose(); return }
      if (e.key !== 'Tab') return
      if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last?.focus() } }
      else { if (document.activeElement === last) { e.preventDefault(); first?.focus() } }
    }
    document.addEventListener('keydown', onKey)
    first?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps
  const [title, setTitle] = useState('')
  const [roomNumber, setRoomNumber] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: roomsData } = useQuery({
    queryKey: ['rooms-list'],
    queryFn: () => roomsApi.list(),
    select: (res) => (res as any).data ?? [],
  })
  const rooms: any[] = roomsData ?? []

  const { mutate, isPending } = useMutation({
    mutationFn: (roomId: string | undefined) =>
      guestRequestsApi.createRequest({
        title: title.trim(),
        room_id: roomId,
        description: description.trim() || undefined,
      }),
    onSuccess: () => {
      setTitle('')
      setRoomNumber('')
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
    const trimmed = roomNumber.trim()
    if (trimmed && rooms.length > 0) {
      const match = rooms.find((r: any) =>
        (r.rooms?.room_number ?? '').toLowerCase() === trimmed.toLowerCase()
      )
      if (!match) {
        setError(`Room "${trimmed}" not found. Check the room number.`)
        return
      }
      setError(null)
      mutate(match.room_id)
    } else {
      setError(null)
      mutate(undefined)
    }
  }

  function handleClose() {
    setTitle('')
    setRoomNumber('')
    setDescription('')
    setError(null)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="create-request-title" className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-stone-900/20 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div ref={modalRef} className="relative bg-surface/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-[var(--r-lg)] shadow-xl w-full max-w-md mx-4 p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 id="create-request-title" className="text-lg font-semibold text-ink">New Guest Request</h2>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-surface-2 text-ink3 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div>
            <label htmlFor="create-req-title" className="block text-sm font-medium text-ink2 mb-1">
              Issue or request description <span className="text-[var(--alert)]">*</span>
            </label>
            <input
              id="create-req-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Extra towels needed, AC not cooling..."
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 bg-surface text-ink"
              autoFocus
            />
          </div>

          {/* Room number */}
          <div>
            <label htmlFor="create-req-room" className="block text-sm font-medium text-ink2 mb-1">
              Room number <span className="text-ink4 font-normal">(optional)</span>
            </label>
            <input
              id="create-req-room"
              type="text"
              value={roomNumber}
              onChange={(e) => setRoomNumber(e.target.value)}
              placeholder="e.g. 302"
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 bg-surface text-ink"
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor="create-req-desc" className="block text-sm font-medium text-ink2 mb-1">
              Additional details <span className="text-ink4 font-normal">(optional)</span>
            </label>
            <textarea
              id="create-req-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Room number, urgency, or any other context..."
              rows={3}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 bg-surface text-ink resize-none"
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-sm text-[var(--alert)] bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <Button type="button" variant="ghost" onClick={handleClose} className="flex-1 justify-center">
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isPending || !title.trim()} className="flex-1 justify-center">
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {isPending ? 'Creating…' : 'Create Request'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function GuestRequestsPageContent() {
  const { isGM, role } = useRole()
  const queryClient = useQueryClient()

  const isFrontDesk = role === 'front_desk'
  const isSupervisor = role === 'housekeeping_supervisor'
  const canCreate = isGM || isFrontDesk || isSupervisor
  const canAct = isGM || isFrontDesk || isSupervisor

  const searchParams = useSearchParams()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<ActiveTab>(
    (searchParams.get('tab') as ActiveTab) || 'open'
  )
  const [showCreateModal, setShowCreateModal] = useState(false)

  function handleTabChange(tab: ActiveTab) {
    setActiveTab(tab)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', tab)
    router.replace(`?${params.toString()}`, { scroll: false })
  }
  const [editTarget, setEditTarget] = useState<GuestRequest | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<GuestRequest | null>(null)
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

  // ── Delete mutation (optimistic) ──
  const { mutate: deleteRequest, isPending: deleting } = useMutation({
    mutationFn: (id: string) => guestRequestsApi.deleteRequest(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['guest-requests'] })
      const previous = queryClient.getQueryData(['guest-requests'])
      queryClient.setQueryData(['guest-requests'], (old: any) => {
        if (!old?.data) return old
        return { ...old, data: old.data.filter((r: GuestRequest) => r.id !== id) }
      })
      setDeleteTarget(null)
      return { previous }
    },
    onError: (_err, _id, context: any) => {
      if (context?.previous) {
        queryClient.setQueryData(['guest-requests'], context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['guest-requests'] })
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
  })

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
          <div className="w-10 h-10 rounded-xl bg-[var(--caution-soft)] flex items-center justify-center shrink-0">
            <Bell className="w-5 h-5 text-[var(--caution)]" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">Guest Requests</h1>
            <p className="text-sm text-ink3 mt-0.5">
              Track and resolve guest service requests
            </p>
          </div>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={() => setShowCreateModal(true)} className="shrink-0">
            <Plus className="w-4 h-4" />
            New Request
          </Button>
        )}
      </div>

      {/* ── Stats row ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Open */}
        <Card className="p-4">
          <span className="font-display text-[28px] leading-none text-ink">{counts.open}</span>
          <p className="text-xs text-ink3 mt-0.5 font-medium uppercase tracking-wide">Open</p>
        </Card>
        {/* In Progress */}
        <Card className="p-4">
          <span className="font-display text-[28px] leading-none text-ink">{counts.in_progress}</span>
          <p className="text-xs text-ink3 mt-0.5 font-medium uppercase tracking-wide">In Progress</p>
        </Card>
        {/* Escalated */}
        <Card className="p-4">
          <span className="font-display text-[28px] leading-none text-ink">{counts.escalated}</span>
          <p className="text-xs text-ink3 mt-0.5 font-medium uppercase tracking-wide">Escalated</p>
        </Card>
        {/* Resolved */}
        <Card className="p-4">
          <span className="font-display text-[28px] leading-none text-ink">{counts.resolved}</span>
          <p className="text-xs text-ink3 mt-0.5 font-medium uppercase tracking-wide">Resolved</p>
        </Card>
      </div>

      {/* ── Status tabs ── */}
      <div className="flex gap-1.5 flex-wrap">
        {TABS.map((tab) => {
          const count = counts[tab.value]
          const isActive = activeTab === tab.value
          return (
            <button
              key={tab.value}
              onClick={() => handleTabChange(tab.value)}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                isActive
                  ? 'bg-stone-800 text-white border-stone-800'
                  : 'bg-surface text-ink2 border-line hover:bg-surface-3 hover:border-line'
              }`}
            >
              {tab.label}
              <span
                className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold ${
                  isActive
                    ? 'bg-surface/20 text-white'
                    : 'bg-surface-3 text-ink2'
                }`}
              >
                {count}
              </span>
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
          <div className="w-12 h-12 rounded-full bg-surface-3 flex items-center justify-center mb-3">
            {activeTab === 'resolved' ? (
              <CheckCircle className="w-6 h-6 text-ink3" />
            ) : activeTab === 'escalated' ? (
              <AlertTriangle className="w-6 h-6 text-ink3" />
            ) : (
              <Bell className="w-6 h-6 text-ink3" />
            )}
          </div>
          <p className="text-sm font-medium text-ink2">
            No {STATUS_LABELS[activeTab].toLowerCase()} requests
          </p>
          <p className="text-xs text-ink4 mt-1">
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((request) => (
            <GuestRequestCard
              key={request.id}
              request={request}
              canAct={canAct}
              onUpdateStatus={handleUpdateStatus}
              onEdit={setEditTarget}
              onDelete={setDeleteTarget}
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

      {/* ── Edit Modal ── */}
      <EditRequestModal
        key={editTarget?.id ?? 'none'}
        request={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={() => {
          setEditTarget(null)
          queryClient.invalidateQueries({ queryKey: ['guest-requests'] })
        }}
      />

      {/* ── Delete Confirm ── */}
      <DeleteConfirmDialog
        open={!!deleteTarget}
        title={`Delete GR-${String(deleteTarget?.request_number ?? '').padStart(3, '0')}?`}
        description="This will also delete the linked task."
        onConfirm={() => deleteTarget && deleteRequest(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
      />
    </div>
  )
}

export default function GuestRequestsPage() {
  return (
    <Suspense>
      <GuestRequestsPageContent />
    </Suspense>
  )
}
