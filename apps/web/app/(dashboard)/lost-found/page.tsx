'use client'

import { useState, useMemo } from 'react'
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

// ─── Constants ────────────────────────────────────────────────────────────────

type ActiveTab = 'all' | LostFoundStatus

const TABS: { value: ActiveTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'found', label: 'Found' },
  { value: 'claimed', label: 'Claimed' },
  { value: 'donated', label: 'Donated' },
  { value: 'discarded', label: 'Discarded' },
]

const STATUS_STYLES: Record<LostFoundStatus, string> = {
  found: 'bg-blue-50 text-blue-700',
  claimed: 'bg-green-50 text-green-700',
  donated: 'bg-purple-50 text-purple-700',
  discarded: 'bg-gray-100 text-gray-600',
}

const STATUS_LABELS: Record<LostFoundStatus, string> = {
  found: 'Found',
  claimed: 'Claimed',
  donated: 'Donated',
  discarded: 'Discarded',
}

const TAB_ACTIVE_STYLES: Record<ActiveTab, string> = {
  all: 'bg-gray-800 text-white border-gray-800',
  found: 'bg-blue-600 text-white border-blue-600',
  claimed: 'bg-green-600 text-white border-green-600',
  donated: 'bg-purple-600 text-white border-purple-600',
  discarded: 'bg-gray-500 text-white border-gray-500',
}

const TAB_INACTIVE_STYLES: Record<ActiveTab, string> = {
  all: 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50',
  found: 'bg-white text-blue-700 border-blue-200 hover:bg-blue-50',
  claimed: 'bg-white text-green-700 border-green-200 hover:bg-green-50',
  donated: 'bg-white text-purple-700 border-purple-200 hover:bg-purple-50',
  discarded: 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50',
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: LostFoundStatus }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}

// ─── Skeleton Card ────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 animate-pulse">
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

// ─── Item Card ────────────────────────────────────────────────────────────────

interface ItemCardProps {
  item: LostFoundItem
  canAct: boolean
  onMarkClaimed: (item: LostFoundItem) => void
  onQuickUpdate: (id: string, status: LostFoundStatus) => void
  isUpdating: boolean
  updatingId: string | null
}

function ItemCard({
  item,
  canAct,
  onMarkClaimed,
  onQuickUpdate,
  isUpdating,
  updatingId,
}: ItemCardProps) {
  const isPending = isUpdating && updatingId === item.id
  const staffName =
    item.user_profiles?.preferred_name ||
    item.user_profiles?.full_name ||
    'Unknown'

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
      {/* Top row: status badge + time */}
      <div className="flex items-center justify-between gap-3 mb-2">
        <StatusBadge status={item.status} />
        <span className="text-xs text-gray-400 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
        </span>
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
      {item.status !== 'found' && item.claimed_at && (
        <p className="text-xs text-gray-500 mb-3 flex items-center gap-1">
          <CheckCircle className="w-3 h-3 text-green-500" />
          {item.status === 'claimed'
            ? `Claimed by ${item.claimed_by_name || 'guest'} — ${format(new Date(item.claimed_at), 'MMM d, h:mm a')}`
            : `${STATUS_LABELS[item.status]} — ${format(new Date(item.claimed_at), 'MMM d, h:mm a')}`}
        </p>
      )}

      {/* Action buttons — only for "found" status */}
      {canAct && item.status === 'found' && (
        <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
          {isPending ? (
            <span className="flex items-center gap-1.5 text-xs text-gray-500">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Updating…
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
                className="px-3 py-1.5 bg-purple-50 text-purple-700 border border-purple-200 rounded-lg text-xs font-medium hover:bg-purple-100 transition-colors"
              >
                Donate
              </button>
              <button
                onClick={() => onQuickUpdate(item.id, 'discarded')}
                className="px-3 py-1.5 bg-gray-100 text-gray-600 border border-gray-200 rounded-lg text-xs font-medium hover:bg-gray-200 transition-colors"
              >
                Discard
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Log Found Item Modal ─────────────────────────────────────────────────────

interface LogItemModalProps {
  isOpen: boolean
  onClose: () => void
  onCreate: () => void
}

function LogItemModal({ isOpen, onClose, onCreate }: LogItemModalProps) {
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

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={handleClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">Log Found Item</h2>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description <span className="text-red-500">*</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Black iPhone 14, gold bracelet, blue umbrella..."
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-none"
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
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
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
              disabled={isPending || !description.trim()}
              className="flex-1 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {isPending ? 'Logging…' : 'Log Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Mark Claimed Modal ───────────────────────────────────────────────────────

interface ClaimModalProps {
  item: LostFoundItem | null
  onClose: () => void
  onSuccess: () => void
}

function ClaimModal({ item, onClose, onSuccess }: ClaimModalProps) {
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

  if (!item) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={handleClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">Mark as Claimed</h2>
          <button
            onClick={handleClose}
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
              Claimant Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={claimedByName}
              onChange={(e) => setClaimedByName(e.target.value)}
              placeholder="e.g. John Smith"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
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
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
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
              disabled={isPending || !claimedByName.trim()}
              className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {isPending ? 'Saving…' : 'Confirm Claim'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

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
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  // ── Fetch all items ──
  const { data: items, isLoading } = useQuery({
    queryKey: ['lost-found'],
    queryFn: () => lostFoundApi.listItems({ per_page: 100 }),
    select: (res) => res.data as LostFoundItem[],
    refetchInterval: 60_000,
  })

  // ── Counts ──
  const counts = {
    found: items?.filter((i) => i.status === 'found').length ?? 0,
    claimed: items?.filter((i) => i.status === 'claimed').length ?? 0,
    donated: items?.filter((i) => i.status === 'donated').length ?? 0,
    discarded: items?.filter((i) => i.status === 'discarded').length ?? 0,
  }

  // ── Client-side filter ──
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

  // ── Quick status update mutation ──
  const { mutate: quickUpdate, isPending: isUpdating } = useMutation({
    mutationFn: ({ id, status }: { id: string; status: LostFoundStatus }) =>
      lostFoundApi.updateItem(id, { status }),
    onMutate: ({ id }) => setUpdatingId(id),
    onSettled: () => setUpdatingId(null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lost-found'] })
    },
  })

  function handleQuickUpdate(id: string, status: LostFoundStatus) {
    quickUpdate({ id, status })
  }

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
            <Package className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Lost &amp; Found</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Track and manage found items
            </p>
          </div>
        </div>
        {canCreate && (
          <button
            onClick={() => setShowLogModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" />
            Log Found Item
          </button>
        )}
      </div>

      {/* ── Stats row ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <p className="text-2xl font-bold text-blue-600">{counts.found}</p>
          <p className="text-xs text-gray-500 mt-0.5 font-medium uppercase tracking-wide">
            Found
          </p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <p className="text-2xl font-bold text-green-600">{counts.claimed}</p>
          <p className="text-xs text-gray-500 mt-0.5 font-medium uppercase tracking-wide">
            Claimed
          </p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <p className="text-2xl font-bold text-purple-600">{counts.donated}</p>
          <p className="text-xs text-gray-500 mt-0.5 font-medium uppercase tracking-wide">
            Donated
          </p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <p className="text-2xl font-bold text-gray-500">{counts.discarded}</p>
          <p className="text-xs text-gray-500 mt-0.5 font-medium uppercase tracking-wide">
            Discarded
          </p>
        </div>
      </div>

      {/* ── Filter bar ── */}
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
                      isActive ? 'bg-white/25 text-white' : 'bg-gray-100 text-gray-600'
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
            placeholder="Search by description…"
            className="w-full sm:w-64 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* ── Items grid ── */}
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
              isUpdating={isUpdating}
              updatingId={updatingId}
            />
          ))}
        </div>
      )}

      {/* ── Log Item Modal ── */}
      <LogItemModal
        isOpen={showLogModal}
        onClose={() => setShowLogModal(false)}
        onCreate={() => {
          setShowLogModal(false)
          queryClient.invalidateQueries({ queryKey: ['lost-found'] })
        }}
      />

      {/* ── Claim Modal ── */}
      <ClaimModal
        item={claimTarget}
        onClose={() => setClaimTarget(null)}
        onSuccess={() => {
          setClaimTarget(null)
          queryClient.invalidateQueries({ queryKey: ['lost-found'] })
        }}
      />
    </div>
  )
}
