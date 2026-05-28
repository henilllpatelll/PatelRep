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
import { formatDistanceToNow } from 'date-fns'
import {
  lostFoundApi,
  type LostFoundItem,
  type LostFoundStatus,
} from '@/lib/api/lost_found'
import { useRole } from '@/lib/hooks/useRole'
import { LogFoundItemModal } from '@/components/shared/LogFoundItemModal'
import { Button } from '@/components/ui/Button'
import { Pill, SectionLabel } from '@/components/ui/primitives'
import { KebabMenu } from '@/components/shared/KebabMenu'
import { DeleteConfirmDialog } from '@/components/shared/DeleteConfirmDialog'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'

const STATUS_TONE: Record<LostFoundStatus, 'info' | 'ready' | 'ai' | 'neutral'> = {
  unclaimed: 'info',
  claimed: 'ready',
  donated: 'ai',
  discarded: 'neutral',
}

const STATUS_LABELS: Record<LostFoundStatus, string> = {
  unclaimed: 'Unclaimed',
  claimed: 'Claimed',
  donated: 'Donated',
  discarded: 'Discarded',
}

// -- Skeleton Card -----------------------------------------------------------

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
        <div className="h-7 w-24 bg-gray-200 rounded-lg" />
      </div>
    </div>
  )
}

// -- Item Card ---------------------------------------------------------------

interface ItemCardProps {
  item: LostFoundItem
  canAct: boolean
  onMarkClaimed: (item: LostFoundItem) => void
  onEdit: (item: LostFoundItem) => void
  onDelete: (item: LostFoundItem) => void
}

function ItemCard({ item, canAct, onMarkClaimed, onEdit, onDelete }: ItemCardProps) {
  const staffName =
    item.user_profiles?.preferred_name ||
    item.user_profiles?.full_name ||
    'Unknown'

  return (
    <div className="bg-surface border border-line shadow-sm rounded-[var(--r-lg)] p-4 hover:shadow-md transition-shadow">
      {/* Top row: status badge + time + kebab */}
      <div className="flex items-center justify-between gap-3 mb-2">
        <Pill tone={STATUS_TONE[item.status]}>{STATUS_LABELS[item.status]}</Pill>
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-400 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
          </span>
          <KebabMenu onEdit={() => onEdit(item)} onDelete={() => onDelete(item)} />
        </div>
      </div>

      {/* Photo */}
      {item.photo_url && (
        <a href={item.photo_url} target="_blank" rel="noopener noreferrer" className="block mb-2 rounded-lg overflow-hidden border border-line">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.photo_url} alt="Found item" className="w-full h-52 object-cover hover:opacity-90 transition-opacity" />
        </a>
      )}

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

        <span className="flex items-center gap-1">
          <User className="w-3 h-3" />
          {staffName}
        </span>
      </div>

      {/* Notes */}
      {item.notes && (
        <p className="text-xs text-gray-500 italic mb-3 line-clamp-2">{item.notes}</p>
      )}

      {/* Mark Claimed button */}
      {canAct && (
        <div className="pt-2 border-t border-gray-100">
          <button
            onClick={() => onMarkClaimed(item)}
            className="w-full px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 transition-colors flex items-center justify-center gap-1"
          >
            <CheckCircle className="w-3 h-3" />
            Mark Claimed
          </button>
        </div>
      )}
    </div>
  )
}

// -- Edit Item Modal ---------------------------------------------------------

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
  })
  const [error, setError] = useState<string | null>(null)

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      lostFoundApi.updateItem(item!.id, {
        description: form.description.trim() || undefined,
        location_found: form.location_found.trim() || undefined,
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
            <label className="block text-sm font-medium text-gray-700 mb-1">Location Found</label>
            <input type="text" value={form.location_found} onChange={(e) => setForm((f) => ({ ...f, location_found: e.target.value }))} placeholder="e.g. Room 204, Pool area" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description <span className="text-[var(--alert)]">*</span></label>
            <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none" />
          </div>
          {error && <p className="text-sm text-[var(--alert)] bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">Cancel</button>
            <button type="submit" disabled={isPending || !form.description.trim()} className="flex-1 px-4 py-2 bg-accent text-white rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity flex items-center justify-center gap-2">
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {isPending ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// -- Main Page ---------------------------------------------------------------

export default function LostFoundPage() {
  const { isGM, role } = useRole()
  const queryClient = useQueryClient()

  const isFrontDesk = role === 'front_desk'
  const isSupervisor = role === 'housekeeping_supervisor'
  const canCreate = isGM || isFrontDesk || isSupervisor
  const canAct = isGM || isFrontDesk || isSupervisor

  const [search, setSearch] = useState('')
  const [showLogModal, setShowLogModal] = useState(false)
  const [claimTarget, setClaimTarget] = useState<LostFoundItem | null>(null)
  const [editTarget, setEditTarget] = useState<LostFoundItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<LostFoundItem | null>(null)

  const { data: items, isLoading } = useQuery({
    queryKey: ['lost-found'],
    queryFn: () => lostFoundApi.listItems({ per_page: 100 }),
    select: (res) => res.data as LostFoundItem[],
    refetchInterval: 60_000,
  })

  const filtered = useMemo(() => {
    if (!search.trim()) return items ?? []
    const q = search.toLowerCase()
    return (items ?? []).filter((i) => i.description.toLowerCase().includes(q))
  }, [items, search])

  const { mutate: deleteItem, isPending: deleting } = useMutation({
    mutationFn: (id: string) => lostFoundApi.deleteItem(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['lost-found'] })
      const previous = queryClient.getQueryData(['lost-found'])
      queryClient.setQueryData(['lost-found'], (old: any) => {
        if (!old?.data) return old
        return { ...old, data: old.data.filter((i: LostFoundItem) => i.id !== id) }
      })
      setClaimTarget(null)
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--caution-soft)] flex items-center justify-center shrink-0">
            <Package className="w-5 h-5 text-[var(--caution)]" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">Lost &amp; Found</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {items ? `${items.length} item${items.length !== 1 ? 's' : ''}` : 'Track and manage found items'}
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

      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search lost and found items"
        placeholder="Search by description..."
        className="w-full sm:w-72 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
      />

      {/* Items grid */}
      <SectionLabel>Items</SectionLabel>
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
            {search ? `No items match "${search}"` : 'No lost & found items logged yet.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              canAct={canAct}
              onMarkClaimed={setClaimTarget}
              onEdit={setEditTarget}
              onDelete={setDeleteTarget}
            />
          ))}
        </div>
      )}

      {/* Log Item Modal */}
      <LogFoundItemModal
        isOpen={showLogModal}
        onClose={() => setShowLogModal(false)}
        onCreate={() => {
          setShowLogModal(false)
          queryClient.invalidateQueries({ queryKey: ['lost-found'] })
        }}
      />

      {/* Edit Modal */}
      <EditItemModal
        key={editTarget?.id ?? ''}
        item={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={() => {
          setEditTarget(null)
          queryClient.invalidateQueries({ queryKey: ['lost-found'] })
        }}
      />

      {/* Mark Claimed confirm */}
      <DeleteConfirmDialog
        open={!!claimTarget}
        title="Mark as Claimed"
        description={`Mark "${claimTarget?.description ?? 'this item'}" as claimed and remove it from the list?`}
        confirmLabel="Mark Claimed"
        onConfirm={() => claimTarget && deleteItem(claimTarget.id)}
        onCancel={() => setClaimTarget(null)}
        loading={deleting}
      />

      {/* Delete confirm */}
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
