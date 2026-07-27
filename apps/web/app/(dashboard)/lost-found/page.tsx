'use client'

import { useState, useMemo, useRef } from 'react'
import {
  Package,
  Plus,
  Clock,
  X,
  MapPin,
  User,
  CheckCircle,
} from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import {
  lostFoundApi,
  isDispositionDue,
  type LostFoundItem,
  type LostFoundStatus,
  type LostFoundCustodyEvent,
} from '@/lib/api/lost_found'
import { useRole } from '@/lib/hooks/useRole'
import { LogFoundItemModal } from '@/components/shared/LogFoundItemModal'
import { Button, IconButton } from '@/components/ui/Button'
import { PageHeader } from '@/components/shared/PageHeader'
import { Pill, SectionLabel } from '@/components/ui/primitives'
import { KebabMenu } from '@/components/shared/KebabMenu'
import { DeleteConfirmDialog } from '@/components/shared/DeleteConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'
import { cn } from '@/lib/utils'

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

// -- Custody History -----------------------------------------------------------

const CUSTODY_EVENT_LABELS: Record<LostFoundCustodyEvent['event_type'], string> = {
  intake: 'Logged',
  moved: 'Moved',
  released: 'Released',
  disposition: 'Disposition approved',
}

function CustodyHistory({ itemId }: { itemId: string }) {
  const [expanded, setExpanded] = useState(false)

  const { data: events, isLoading } = useQuery({
    queryKey: ['lost-found-custody', itemId],
    queryFn: () => lostFoundApi.listCustodyEvents(itemId),
    select: (res) => res.data,
    enabled: expanded,
  })

  return (
    <div className="mt-2 pt-2 border-t border-gray-100">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3 hover:text-ink2 transition-colors"
      >
        Custody history {expanded ? '▲' : '▼'}
      </button>
      {expanded && (
        <div className="mt-2 space-y-2">
          {isLoading ? (
            <p className="text-[12px] text-ink3">Loading...</p>
          ) : events && events.length > 0 ? (
            events.map((event) => (
              <div key={event.id} className="text-[12px] text-ink3">
                <span className="font-medium text-ink2">
                  {CUSTODY_EVENT_LABELS[event.event_type]}
                </span>
                {' · '}
                {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
                {event.storage_location && <div>Storage: {event.storage_location}</div>}
                {event.recipient_name && <div>Recipient: {event.recipient_name}</div>}
                {event.verification_method && <div>Verified via: {event.verification_method}</div>}
                {event.disposition && <div>Disposition: {event.disposition}</div>}
                {event.note && <div className="italic">{event.note}</div>}
              </div>
            ))
          ) : (
            <p className="text-[12px] text-ink3">No custody events recorded.</p>
          )}
        </div>
      )}
    </div>
  )
}

// -- Item Card ---------------------------------------------------------------

interface ItemCardProps {
  item: LostFoundItem
  canAct: boolean
  canApproveDisposition: boolean
  onMarkClaimed: (item: LostFoundItem) => void
  onEdit: (item: LostFoundItem) => void
  onDelete: (item: LostFoundItem) => void
  onApproveDisposition: (item: LostFoundItem) => void
}

function ItemCard({
  item,
  canAct,
  canApproveDisposition,
  onMarkClaimed,
  onEdit,
  onDelete,
  onApproveDisposition,
}: ItemCardProps) {
  const staffName =
    item.user_profiles?.preferred_name ||
    item.user_profiles?.full_name ||
    'Unknown'

  const dispositionDue = isDispositionDue(item)

  return (
    <div className="bg-surface border border-line shadow-sm rounded-[var(--r-lg)] p-4 hover:shadow-md transition-shadow">
      {/* Top row: status badge + disposition-due flag + time + kebab */}
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-1.5">
          <Pill tone={STATUS_TONE[item.status]}>{STATUS_LABELS[item.status]}</Pill>
          {dispositionDue && <Pill tone="caution">Due for disposition</Pill>}
        </div>
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

        {item.tag_identifier && (
          <span className="font-mono">{item.tag_identifier}</span>
        )}
      </div>

      {/* Retention line (D-10) */}
      {item.status === 'unclaimed' && item.retention_due_at && !dispositionDue && (
        <p className="flex items-center gap-1 text-[12px] text-ink3 mb-3">
          <Clock className="w-3 h-3" />
          Retention ends {formatDistanceToNow(new Date(item.retention_due_at), { addSuffix: true })}
        </p>
      )}

      {/* Notes */}
      {item.notes && (
        <p className="text-xs text-gray-500 italic mb-3 line-clamp-2">{item.notes}</p>
      )}

      {/* Mark Claimed button */}
      {canAct && (
        <div className="pt-2 border-t border-gray-100">
          <Button
            variant="primary"
            size="sm"
            onClick={() => onMarkClaimed(item)}
            className="w-full gap-1 bg-[var(--ready)]"
          >
            <CheckCircle className="w-3 h-3" />
            Release Item
          </Button>
        </div>
      )}

      {/* Approve Disposition button (D-11, D-12) */}
      {canApproveDisposition && item.status === 'unclaimed' && (
        <div className={cn('pt-2', !canAct && 'border-t border-gray-100')}>
          <Button
            variant={dispositionDue ? 'primary' : 'outline'}
            size="sm"
            onClick={() => onApproveDisposition(item)}
            className={cn('w-full', dispositionDue && 'bg-[var(--caution)]')}
          >
            Approve Disposition
          </Button>
        </div>
      )}

      <CustodyHistory itemId={item.id} />
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
          <IconButton variant="ghost" onClick={onClose} aria-label="Close">
            <X className="w-4 h-4" />
          </IconButton>
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
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button type="submit" variant="primary" loading={isPending} disabled={!form.description.trim()} className="flex-1">
              {isPending ? 'Saving...' : 'Save Changes'}
            </Button>
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
  // D-12: front_desk is included deliberately — the user explicitly rejected narrowing this to supervisor+.
  const canApproveDisposition = isGM || role === 'housekeeping_supervisor' || role === 'front_desk'

  const [search, setSearch] = useState('')
  const [showLogModal, setShowLogModal] = useState(false)
  const [claimTarget, setClaimTarget] = useState<LostFoundItem | null>(null)
  const [releaseRecipient, setReleaseRecipient] = useState('')
  const [verificationMethod, setVerificationMethod] = useState('')
  const [editTarget, setEditTarget] = useState<LostFoundItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<LostFoundItem | null>(null)
  const [dispositionDueOnly, setDispositionDueOnly] = useState(false)
  const [dispositionTarget, setDispositionTarget] = useState<LostFoundItem | null>(null)
  const [dispositionChoice, setDispositionChoice] = useState<'donated' | 'discarded'>('donated')
  const [dispositionNote, setDispositionNote] = useState('')
  const [dispositionError, setDispositionError] = useState<string | null>(null)
  const dispositionDialogRef = useRef<HTMLFormElement>(null)

  const { data: items, isLoading } = useQuery({
    queryKey: ['lost-found', dispositionDueOnly],
    queryFn: () =>
      lostFoundApi.listItems({ per_page: 100, disposition_due: dispositionDueOnly }),
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

  const { mutate: releaseItem, isPending: releasing } = useMutation({
    mutationFn: (item: LostFoundItem) =>
      lostFoundApi.recordCustodyEvent(item.id, {
        event_type: 'released',
        recipient_name: releaseRecipient.trim(),
        verification_method: verificationMethod.trim(),
      }),
    onSuccess: () => {
      setClaimTarget(null)
      setReleaseRecipient('')
      setVerificationMethod('')
      queryClient.invalidateQueries({ queryKey: ['lost-found'] })
    },
  })

  const { mutate: approveDisposition, isPending: approvingDisposition } = useMutation({
    mutationFn: (item: LostFoundItem) =>
      lostFoundApi.recordCustodyEvent(item.id, {
        event_type: 'disposition',
        disposition: dispositionChoice,
        note: dispositionNote.trim() || undefined,
      }),
    onSuccess: () => {
      setDispositionTarget(null)
      setDispositionNote('')
      setDispositionError(null)
      queryClient.invalidateQueries({ queryKey: ['lost-found'] })
      queryClient.invalidateQueries({ queryKey: ['lost-found-custody'] })
    },
    onError: (err: any) => setDispositionError(err?.message || 'Failed to approve disposition'),
  })

  useModalFocusTrap(dispositionDialogRef, !!dispositionTarget, () => setDispositionTarget(null))

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Lost & Found"
        subtitle={items ? `${items.length} item${items.length !== 1 ? 's' : ''}` : 'Track and manage found items'}
        actions={canCreate && (
          <Button variant="primary" onClick={() => setShowLogModal(true)} className="shrink-0">
            <Plus className="w-4 h-4" />
            Log Found Item
          </Button>
        )}
      />

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search lost and found items"
          placeholder="Search by description..."
          className="w-full sm:w-72 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
        />
        <button
          type="button"
          onClick={() => setDispositionDueOnly((v) => !v)}
          aria-pressed={dispositionDueOnly}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors',
            dispositionDueOnly
              ? 'bg-[var(--caution-soft)] text-[var(--caution)] border-[var(--caution-line)]'
              : 'bg-surface text-gray-500 border-gray-300 hover:bg-surface-2'
          )}
        >
          Due for disposition
        </button>
      </div>

      {/* Items grid */}
      <SectionLabel>Items</SectionLabel>
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Package className="w-5 h-5" />}
          title={dispositionDueOnly ? 'Nothing due for disposition' : 'No items found'}
          body={
            dispositionDueOnly
              ? 'Items flagged after their 90-day retention period passes will show up here for manager review.'
              : search
              ? `No items match "${search}"`
              : 'No lost & found items logged yet.'
          }
          className="py-16"
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              canAct={canAct}
              canApproveDisposition={canApproveDisposition}
              onMarkClaimed={setClaimTarget}
              onEdit={setEditTarget}
              onDelete={setDeleteTarget}
              onApproveDisposition={(target) => {
                setDispositionTarget(target)
                setDispositionChoice('donated')
                setDispositionNote('')
                setDispositionError(null)
              }}
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

      {claimTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => setClaimTarget(null)} />
          <form
            className="relative z-10 w-full max-w-md rounded-[var(--r-lg)] border border-line bg-surface p-5 shadow-xl"
            onSubmit={(event) => { event.preventDefault(); releaseItem(claimTarget) }}
          >
            <h2 className="text-lg font-semibold text-ink">Release found item</h2>
            <p className="mt-1 text-sm text-ink3">Record who received this item and how their identity was verified.</p>
            <label className="mt-4 block text-sm font-medium text-ink2">
              Recipient name
              <input required value={releaseRecipient} onChange={(event) => setReleaseRecipient(event.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
            </label>
            <label className="mt-3 block text-sm font-medium text-ink2">
              Verification method
              <input required value={verificationMethod} onChange={(event) => setVerificationMethod(event.target.value)} placeholder="Photo ID, matching description, signature" className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setClaimTarget(null)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={releasing || !releaseRecipient.trim() || !verificationMethod.trim()}>
                {releasing ? 'Recording...' : 'Record Release'}
              </Button>
            </div>
          </form>
        </div>
      )}

      {dispositionTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => setDispositionTarget(null)} />
          <form
            ref={dispositionDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="approve-disposition-title"
            tabIndex={-1}
            className="relative z-10 w-full max-w-md rounded-[var(--r-lg)] border border-line bg-surface p-5 shadow-xl"
            onSubmit={(event) => { event.preventDefault(); approveDisposition(dispositionTarget) }}
          >
            <h2 id="approve-disposition-title" className="text-[20px] font-semibold text-ink">
              Approve disposition: mark as {dispositionChoice}
            </h2>
            <p className="mt-1 text-sm text-ink3">
              This creates a permanent, append-only record and cannot be undone.
            </p>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setDispositionChoice('donated')}
                className={cn(
                  'flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                  dispositionChoice === 'donated'
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                    : 'border-line text-ink2 hover:bg-surface-2'
                )}
              >
                Donated
              </button>
              <button
                type="button"
                onClick={() => setDispositionChoice('discarded')}
                className={cn(
                  'flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                  dispositionChoice === 'discarded'
                    ? 'border-[var(--alert)] bg-[var(--alert-soft)] text-[var(--alert)]'
                    : 'border-line text-ink2 hover:bg-surface-2'
                )}
              >
                Discarded
              </button>
            </div>

            <label className="mt-3 block text-sm font-medium text-ink2">
              Note (optional)
              <textarea
                value={dispositionNote}
                onChange={(event) => setDispositionNote(event.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm resize-none"
              />
            </label>

            {dispositionError && (
              <p className="mt-3 text-[12px] text-[var(--alert)]">{dispositionError}</p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDispositionTarget(null)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={approvingDisposition}>
                {approvingDisposition ? 'Approving...' : 'Approve Disposition'}
              </Button>
            </div>
          </form>
        </div>
      )}

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
