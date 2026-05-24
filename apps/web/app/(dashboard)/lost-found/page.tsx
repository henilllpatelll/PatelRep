'use client'

import { useState, useMemo, useRef } from 'react'
import {
  Package,
  Plus,
  Clock,
  X,
  Loader2,
  MapPin,
  User,
  CheckCircle,
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow, format } from 'date-fns'
import {
  lostFoundApi,
  type LostFoundItem,
  type LostFoundStatus,
} from '@/lib/api/lost_found'
import { useRole } from '@/lib/hooks/useRole'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { KebabMenu } from '@/components/shared/KebabMenu'
import { DeleteConfirmDialog } from '@/components/shared/DeleteConfirmDialog'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'

// â”€â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type ActiveTab = 'all' | LostFoundStatus

const TABS: { value: ActiveTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unclaimed', label: 'Unclaimed' },
  { value: 'claimed', label: 'Claimed' },
  { value: 'donated', label: 'Donated' },
  { value: 'discarded', label: 'Discarded' },
]

const STATUS_STYLES: Record<LostFoundStatus, string> = {
  unclaimed: 'bg-[var(--info-soft)] text-[var(--info)]',
  claimed: 'bg-[var(--ready-soft)] text-[var(--ready)]',
  donated: 'bg-[var(--ai-soft)] text-[var(--ai)]',
  discarded: 'bg-gray-100 text-gray-600',
}

const STATUS_LABELS: Record<LostFoundStatus, string> = {
  unclaimed: 'Unclaimed',
  claimed: 'Claimed',
  donated: 'Donated',
  discarded: 'Discarded',
}

const TAB_ACTIVE_STYLES: Record<ActiveTab, string> = {
  all: 'bg-gray-800 text-white border-gray-800',
  unclaimed: 'bg-blue-600 text-white border-blue-600',
  claimed: 'bg-green-600 text-white border-green-600',
  donated: 'bg-purple-600 text-white border-purple-600',
  discarded: 'bg-gray-500 text-white border-gray-500',
}

const TAB_INACTIVE_STYLES: Record<ActiveTab, string> = {
  all: 'bg-surface text-gray-700 border-gray-200 hover:bg-gray-50',
  unclaimed: 'bg-surface text-[var(--info)] border-[var(--info-line)] hover:bg-[var(--info-soft)]',
  claimed: 'bg-surface text-[var(--ready)] border-[var(--ready-line)] hover:bg-[var(--ready-soft)]',
  donated: 'bg-surface text-[var(--ai)] border-[var(--ai-line)] hover:bg-[var(--ai-soft)]',
  discarded: 'bg-surface text-gray-600 border-gray-200 hover:bg-gray-50',
}

// â”€â”€â”€ Status Badge â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function StatusBadge({ status }: { status: LostFoundStatus }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}

// â”€â”€â”€ Skeleton Card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function SkeletonCard() {
  return (
    <div className="bg-surface border border-line shadow-sm rounded-[var(--r-lg)] p-4 animate-pulse">
      <div className="flex items-center justify-between mb-2">
        <div className="h-5 w-20 bg-gray-200 rounded-full" />
        <div className="h-3 w-24 bg-gray-100 rounded" />
      </div>
      <div className="h-4 w-3/4 bg-gray-200 rounded mb-2" />
      <div className="h-3 w-1/2 bg-gray-100 rounded mb-3" />
      <div className="flex gap-2 pt-2 border-t border-gray-100">
        <div className="h-7 w-20 bg-gray-200 rounded-lg" />
        <div className="h-7 w-16 bg-gray-200 rounded-lg" />
        <div className="h-7 w-16 bg-gray-200 rounded-lg" />
      </div>
    </div>
  )
}

// â”€â”€â”€ Item Card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface ItemCardProps {
  item: LostFoundItem
  canAct: boolean
  onMarkClaimed: (item: LostFoundItem) => void
  onQuickUpdate: (id: string, status: LostFoundStatus) => void
  onEdit: (item: LostFoundItem) => void
  onDelete: (item: LostFoundItem) => void
  isUpdating: boolean
  updatingId: string | null
}

function ItemCard({
  item,
  canAct,
  onMarkClaimed,
  onQuickUpdate,
  onEdit,
  onDelete,
  isUpdating,
  updatingId,
}: ItemCardProps) {
  const isPending = isUpdating && updatingId === item.id
  const staffName =
    item.user_profiles?.preferred_name ||
    item.user_profiles?.full_name ||
    'Unknown'

  return (
    <div className="bg-surface border border-line shadow-sm rounded-[var(--r-lg)] p-4 hover:shadow-md transition-shadow">
      {/* Top row: status badge + time + kebab */}
      <div className="flex items-center justify-between gap-3 mb-2">
        <StatusBadge status={item.status} />
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-400 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
          </span>
          <KebabMenu onEdit={() => onEdit(item)} onDelete={() => onDelete(item)} />
        </div>
      </div>

      {/* Description */}
      <p className="font-semibold text-gray-900 text-sm leading-snug mb-2">
        {item.description}
      </p>

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 mb-3">
        {item.location_found && (
          <span className="flex items-center gap-1">
            <MapPin className="w-3 h-3" />
            {item.location_found}
          </span>
        )}
        {item.rooms?.room_number && (
          <span className="flex items-center gap-1">
            Room {item.rooms.room_number}
          </span>
        )}
        <span className="flex items-center gap-1">
          <User className="w-3 h-3" />
          {staffName}
        </span>
      </div>

      {/* Notes */}
      {item.notes && (
        <p className="text-xs text-gray-500 italic mb-3 line-clamp-2">{item.notes}</p>
      )}

      {/* Claimed info */}
      {item.status !== 'unclaimed' && item.claimed_at && (
        <p className="text-xs text-gray-500 mb-3 flex items-center gap-1">
          <CheckCircle className="w-3 h-3 text-green-500" />
          {item.status === 'claimed'
            ? `Claimed by ${item.claimed_by_name || 'guest'} â€” ${format(new Date(item.claimed_at), 'MMM d, h:mm a')}`
            : `${STATUS_LABELS[item.status]} â€” ${format(new Date(item.claimed_at), 'MMM d, h:mm a')}`}
        </p>
      )}

      {/* Action buttons â€” only for "unclaimed" status */}
      {canAct && item.status === 'unclaimed' && (
        <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
          {isPending ? (
            <span className="flex items-center gap-1.5 text-xs text-gray-500">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Updatingâ€¦
            </span>
          ) : (
            <>
              <button
                onClick={() => onMarkClaimed(item)}
                className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 transition-colors flex items-center gap-1"
              >
                <CheckCircle className="w-3 h-3" />
                Mark Claimed
              </button>
              <button
                onClick={() => onQuickUpdate(item.id, 'donated')}
                className="px-3 py-1.5 border border-line text-ink2 rounded-lg text-xs font-medium hover:bg-surface-3 transition-colors"
              >
                Donate
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// â”€â”€â”€ Edit Item Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface EditItemModalProps {
  item: LostFoundItem | null
  onClose: () => void
  onSaved: () => void
}

function EditItemModal({ item, onClose, onSaved }: EditItemModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [form, setForm] = useState({
    description: item?.description ?? '',
    location_found: item?.location_found ?? '',
    notes: item?.notes ?? '',
    status: item?.status ?? 'unclaimed',
    claimed_by_name: item?.claimed_by_name ?? '',
    claimed_by_contact: item?.claimed_by_contact ?? '',
  })
  const [error, setError] = useState<string | null>(null)

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      lostFoundApi.updateItem(item!.id, {
        description: form.description.trim() || undefined,
        location_found: form.location_found.trim() || undefined,
        notes: form.notes.trim() || undefined,
        status: form.status as LostFoundStatus,
        claimed_by_name: form.claimed_by_name.trim() || undefined,
        claimed_by_contact: form.claimed_by_contact.trim() || undefined,
      }),
    onSuccess: () => { setError(null); onSaved() },
    onError: (err: Error) => setError(err.message || 'Failed to save'),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.description.trim()) { setError('Description is required.'); return }
    setError(null)
    mutate()
  }

  useModalFocusTrap(dialogRef, !!item, onClose)
  if (!item) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-stone-900/20 backdrop-blur-sm" onClick={onClose} />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="edit-lost-found-title" tabIndex={-1} className="relative bg-surface/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-[var(--r-lg)] shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 id="edit-lost-found-title" className="text-lg font-semibold text-gray-900">Edit Found Item</h2>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description <span className="text-[var(--alert)]">*</span></label>
            <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Location Found</label>
            <input type="text" value={form.location_found} onChange={(e) => setForm((f) => ({ ...f, location_found: e.target.value }))} placeholder="e.g. Room 204, Pool area" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as LostFoundStatus }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-amber-400">
              <option value="unclaimed">Unclaimed</option>
              <option value="claimed">Claimed</option>
              <option value="donated">Donated</option>
              <option value="discarded">Discarded</option>
            </select>
          </div>
          {form.status === 'claimed' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Claimed By Name</label>
                <input type="text" value={form.claimed_by_name} onChange={(e) => setForm((f) => ({ ...f, claimed_by_name: e.target.value }))} placeholder="e.g. John Smith" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contact Info</label>
                <input type="text" value={form.claimed_by_contact} onChange={(e) => setForm((f) => ({ ...f, claimed_by_contact: e.target.value }))} placeholder="Phone or email" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
            </>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Any additional details..." className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none" />
          </div>
          {error && <p className="text-sm text-[var(--alert)] bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">Cancel</button>
            <button type="submit" disabled={isPending || !form.description.trim()} className="flex-1 px-4 py-2 bg-accent text-white rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity flex items-center justify-center gap-2">
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {isPending ? 'Savingâ€¦' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// â”€â”€â”€ Log Found Item Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface LogItemModalProps {
  isOpen: boolean
  onClose: () => void
  onCreate: () => void
}

function LogItemModal({ isOpen, onClose, onCreate }: LogItemModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [description, setDescription] = useState('')
  const [locationFound, setLocationFound] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      lostFoundApi.createItem({
        description: description.trim(),
        location_found: locationFound.trim() || undefined,
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      setDescription('')
      setLocationFound('')
      setNotes('')
      setError(null)
      onCreate()
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to log item')
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!description.trim()) {
      setError('Please describe the found item.')
      return
    }
    setError(null)
    mutate()
  }

  function handleClose() {
    setDescription('')
    setLocationFound('')
    setNotes('')
    setError(null)
    onClose()
  }

  useModalFocusTrap(dialogRef, isOpen, handleClose)
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-stone-900/20 backdrop-blur-sm" onClick={handleClose} />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="log-lost-found-title" tabIndex={-1} className="relative bg-surface/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-[var(--r-lg)] shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 id="log-lost-found-title" className="text-lg font-semibold text-gray-900">Log Found Item</h2>
          <button
            onClick={handleClose}
            aria-label="Close"
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description <span className="text-[var(--alert)]">*</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Black iPhone 14, gold bracelet, blue umbrella..."
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent resize-none"
              autoFocus
            />
          </div>

          {/* Location Found */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Location Found <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={locationFound}
              onChange={(e) => setLocationFound(e.target.value)}
              placeholder="e.g. Room 204, Pool area, Lobby..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional details..."
              rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent resize-none"
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
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || !description.trim()}
              className="flex-1 px-4 py-2 bg-accent text-white rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity flex items-center justify-center gap-2"
            >
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {isPending ? 'Loggingâ€¦' : 'Log Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// â”€â”€â”€ Mark Claimed Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface ClaimModalProps {
  item: LostFoundItem | null
  onClose: () => void
  onSuccess: () => void
}

function ClaimModal({ item, onClose, onSuccess }: ClaimModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [claimedByName, setClaimedByName] = useState('')
  const [claimedByContact, setClaimedByContact] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      lostFoundApi.updateItem(item!.id, {
        status: 'claimed',
        claimed_by_name: claimedByName.trim() || undefined,
        claimed_by_contact: claimedByContact.trim() || undefined,
      }),
    onSuccess: () => {
      setClaimedByName('')
      setClaimedByContact('')
      setError(null)
      onSuccess()
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to update item')
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!claimedByName.trim()) {
      setError('Please enter the claimant name.')
      return
    }
    setError(null)
    mutate()
  }

  function handleClose() {
    setClaimedByName('')
    setClaimedByContact('')
    setError(null)
    onClose()
  }

  useModalFocusTrap(dialogRef, !!item, handleClose)
  if (!item) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-stone-900/20 backdrop-blur-sm" onClick={handleClose} />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="claim-lost-found-title" tabIndex={-1} className="relative bg-surface/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-[var(--r-lg)] shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 id="claim-lost-found-title" className="text-lg font-semibold text-gray-900">Mark as Claimed</h2>
          <button
            onClick={handleClose}
            aria-label="Close"
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-sm text-gray-600 mb-4 bg-gray-50 rounded-lg px-3 py-2">
          {item.description}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Claimant name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Claimant Name <span className="text-[var(--alert)]">*</span>
            </label>
            <input
              type="text"
              value={claimedByName}
              onChange={(e) => setClaimedByName(e.target.value)}
              placeholder="e.g. John Smith"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
              autoFocus
            />
          </div>

          {/* Contact info */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Contact Info <span className="text-gray-400 font-normal">(phone or email)</span>
            </label>
            <input
              type="text"
              value={claimedByContact}
              onChange={(e) => setClaimedByContact(e.target.value)}
              placeholder="e.g. 555-1234 or guest@email.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
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
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || !claimedByName.trim()}
              className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {isPending ? 'Savingâ€¦' : 'Confirm Claim'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// â”€â”€â”€ Main Page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function LostFoundPage() {
  const { isGM, role } = useRole()
  const queryClient = useQueryClient()

  const isFrontDesk = role === 'front_desk'
  const isSupervisor = role === 'housekeeping_supervisor'
  const canCreate = isGM || isFrontDesk || isSupervisor
  const canAct = isGM || isFrontDesk || isSupervisor

  const [activeTab, setActiveTab] = useState<ActiveTab>('all')
  const [search, setSearch] = useState('')
  const [showLogModal, setShowLogModal] = useState(false)
  const [claimTarget, setClaimTarget] = useState<LostFoundItem | null>(null)
  const [editTarget, setEditTarget] = useState<LostFoundItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<LostFoundItem | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  // â”€â”€ Fetch all items â”€â”€
  const { data: items, isLoading } = useQuery({
    queryKey: ['lost-found'],
    queryFn: () => lostFoundApi.listItems({ per_page: 100 }),
    select: (res) => res.data as LostFoundItem[],
    refetchInterval: 60_000,
  })

  // â”€â”€ Counts â”€â”€
  const counts = {
    unclaimed: items?.filter((i) => i.status === 'unclaimed').length ?? 0,
    claimed: items?.filter((i) => i.status === 'claimed').length ?? 0,
    donated: items?.filter((i) => i.status === 'donated').length ?? 0,
    discarded: items?.filter((i) => i.status === 'discarded').length ?? 0,
  }

  // â”€â”€ Client-side filter â”€â”€
  const filtered = useMemo(() => {
    let list = items ?? []
    if (activeTab !== 'all') {
      list = list.filter((i) => i.status === activeTab)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((i) => i.description.toLowerCase().includes(q))
    }
    return list
  }, [items, activeTab, search])

  // â”€â”€ Quick status update mutation â”€â”€
  const { mutate: quickUpdate, isPending: isUpdating } = useMutation({
    mutationFn: ({ id, status }: { id: string; status: LostFoundStatus }) =>
      lostFoundApi.updateItem(id, { status }),
    onMutate: ({ id }) => setUpdatingId(id),
    onSettled: () => setUpdatingId(null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lost-found'] })
    },
  })

  // â”€â”€ Delete mutation â”€â”€
  const { mutate: deleteItem, isPending: deleting } = useMutation({
    mutationFn: (id: string) => lostFoundApi.deleteItem(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['lost-found'] })
      const previous = queryClient.getQueryData(['lost-found'])
      queryClient.setQueryData(['lost-found'], (old: any) => {
        if (!old?.data) return old
        return { ...old, data: old.data.filter((i: LostFoundItem) => i.id !== id) }
      })
      setDeleteTarget(null)
      return { previous }
    },
    onError: (_err, _id, context: any) => {
      if (context?.previous) queryClient.setQueryData(['lost-found'], context.previous)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['lost-found'] })
    },
  })

  function handleQuickUpdate(id: string, status: LostFoundStatus) {
    quickUpdate({ id, status })
  }

  return (
    <div className="space-y-6">
      {/* â”€â”€ Header â”€â”€ */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--caution-soft)] flex items-center justify-center shrink-0">
            <Package className="w-5 h-5 text-[var(--caution)]" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">Lost &amp; Found</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Track and manage found items
            </p>
          </div>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={() => setShowLogModal(true)} className="shrink-0">
            <Plus className="w-4 h-4" />
            Log Found Item
          </Button>
        )}
      </div>

      {/* â”€â”€ Stats row â”€â”€ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-4">
          <p className="text-2xl font-bold text-[var(--info)]">{counts.unclaimed}</p>
          <p className="text-xs text-gray-500 mt-0.5 font-medium uppercase tracking-wide">Unclaimed</p>
        </Card>
        <Card className="p-4">
          <p className="text-2xl font-bold text-[var(--ready)]">{counts.claimed}</p>
          <p className="text-xs text-gray-500 mt-0.5 font-medium uppercase tracking-wide">Claimed</p>
        </Card>
        <Card className="p-4">
          <p className="text-2xl font-bold text-[var(--ai)]">{counts.donated}</p>
          <p className="text-xs text-gray-500 mt-0.5 font-medium uppercase tracking-wide">Donated</p>
        </Card>
        <Card className="p-4">
          <p className="text-2xl font-bold text-gray-500">{counts.discarded}</p>
          <p className="text-xs text-gray-500 mt-0.5 font-medium uppercase tracking-wide">Discarded</p>
        </Card>
      </div>

      {/* â”€â”€ Filter bar â”€â”€ */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Status tabs */}
        <div className="flex gap-1.5 flex-wrap">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.value
            const count =
              tab.value === 'all'
                ? (items?.length ?? 0)
                : counts[tab.value as LostFoundStatus]
            return (
              <button
                key={tab.value}
                onClick={() => setActiveTab(tab.value)}
                aria-pressed={isActive}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  isActive
                    ? TAB_ACTIVE_STYLES[tab.value]
                    : TAB_INACTIVE_STYLES[tab.value]
                }`}
              >
                {tab.label}
                {count > 0 && (
                  <span
                    className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold ${
                      isActive ? 'bg-surface/25 text-white' : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Search input */}
        <div className="sm:ml-auto">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search lost and found items"
            placeholder="Search by descriptionâ€¦"
            className="w-full sm:w-64 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
          />
        </div>
      </div>

      {/* â”€â”€ Items grid â”€â”€ */}
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
            <Package className="w-6 h-6 text-gray-400" />
          </div>
          <p className="text-sm font-medium text-gray-700">No items found</p>
          <p className="text-xs text-gray-400 mt-1">
            {search
              ? `No items match "${search}"`
              : activeTab === 'all'
              ? 'No lost & found items logged yet.'
              : `No ${STATUS_LABELS[activeTab as LostFoundStatus].toLowerCase()} items.`}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              canAct={canAct}
              onMarkClaimed={(i) => setClaimTarget(i)}
              onQuickUpdate={handleQuickUpdate}
              onEdit={setEditTarget}
              onDelete={setDeleteTarget}
              isUpdating={isUpdating}
              updatingId={updatingId}
            />
          ))}
        </div>
      )}

      {/* â”€â”€ Log Item Modal â”€â”€ */}
      <LogItemModal
        isOpen={showLogModal}
        onClose={() => setShowLogModal(false)}
        onCreate={() => {
          setShowLogModal(false)
          queryClient.invalidateQueries({ queryKey: ['lost-found'] })
        }}
      />

      {/* â”€â”€ Claim Modal â”€â”€ */}
      <ClaimModal
        item={claimTarget}
        onClose={() => setClaimTarget(null)}
        onSuccess={() => {
          setClaimTarget(null)
          queryClient.invalidateQueries({ queryKey: ['lost-found'] })
        }}
      />

      {/* â”€â”€ Edit Modal â”€â”€ */}
      <EditItemModal
        key={editTarget?.id ?? ''}
        item={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={() => {
          setEditTarget(null)
          queryClient.invalidateQueries({ queryKey: ['lost-found'] })
        }}
      />

      {/* â”€â”€ Delete Confirm â”€â”€ */}
      <DeleteConfirmDialog
        open={!!deleteTarget}
        title={`Delete "${deleteTarget?.description ?? 'item'}"`}
        onConfirm={() => deleteTarget && deleteItem(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
      />
    </div>
  )
}
