'use client'

import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, X } from 'lucide-react'
import { Button, IconButton } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'
import { lostFoundApi, type LostFoundDispositionOutcome, type LostFoundItem } from '@/lib/api/lost_found'
import { formatLostFoundDate, invalidateLostFound, itemFoundLocation } from '@/lib/utils/lostFoundInventory'

interface DispositionReviewDrawerProps {
  item: LostFoundItem
  onClose: () => void
  onApproved: (item: LostFoundItem) => void
}

/** D-32/D-70: shared review state used from both the Disposition workspace and the
 * Item Detail Drawer, so eligibility, the required reason, and the outcome enum are
 * defined exactly once. */
export function DispositionReviewDrawer({ item, onClose, onApproved }: DispositionReviewDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null!)
  const queryClient = useQueryClient()
  const toast = useToast()
  const [outcome, setOutcome] = useState<LostFoundDispositionOutcome>('donated')
  const [reason, setReason] = useState('')
  useModalFocusTrap(drawerRef, true, onClose)

  const approve = useMutation({
    mutationFn: () => lostFoundApi.approveDisposition(item.id, { outcome, reason: reason.trim() }),
    onSuccess: ({ data }) => {
      invalidateLostFound(queryClient)
      toast.success(outcome === 'donated' ? 'Item marked donated' : 'Item marked discarded')
      onApproved({ ...item, ...data })
    },
    onError: (error: Error) => toast.error(error.message || 'Could not approve disposition'),
  })

  const isOverdue = item.derived_status === 'due_for_disposition'

  return createPortal(
    <div className="fixed inset-0 z-drawer" role="presentation">
      <div className="absolute inset-0 bg-ink/25 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="disposition-review-title"
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-full max-w-[480px] flex-col border-l border-line bg-surface shadow-2xl outline-none"
      >
        <header className="flex items-start justify-between border-b border-line px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">Disposition Review</p>
            <h2 id="disposition-review-title" className="mt-1 text-base font-semibold text-ink">{item.description}</h2>
            <p className="mt-1 font-mono text-xs text-ink3">{item.tag_identifier || 'No tag'}</p>
          </div>
          <IconButton variant="ghost" size="sm" aria-label="Close disposition review" onClick={onClose}><X size={18} /></IconButton>
        </header>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          {isOverdue && <p className="flex items-center gap-1.5 rounded-lg border border-caution-line bg-caution-soft px-3 py-2 text-sm font-medium text-caution"><AlertTriangle size={14} /> Retention exceeded</p>}
          <section className="rounded-xl border border-line bg-surface-2 px-4">
            <Row label="Item">{item.description}</Row>
            <Row label="Category">{(item.category ?? 'other').replace('_', ' ')}</Row>
            <Row label="Found">{itemFoundLocation(item)} · {formatLostFoundDate(item.found_at ?? item.created_at)}</Row>
            <Row label="Storage">{item.storage_location || 'Not recorded'}</Row>
            <Row label="Retention">{item.retention_due_at ? formatLostFoundDate(item.retention_due_at) : 'Not set'}</Row>
          </section>
          <section className="rounded-xl border border-ready-line bg-ready-soft px-4">
            <Row label="Guest claims">No active claims</Row>
            <Row label="Return">No active return</Row>
          </section>
          <section>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">Disposition</p>
            <div className="flex gap-3">
              <label className="flex items-center gap-1.5 text-sm text-ink2"><input type="radio" name="disposition-outcome" checked={outcome === 'donated'} onChange={() => setOutcome('donated')} /> Donate</label>
              <label className="flex items-center gap-1.5 text-sm text-ink2"><input type="radio" name="disposition-outcome" checked={outcome === 'discarded'} onChange={() => setOutcome('discarded')} /> Discard</label>
            </div>
          </section>
          <label className="block text-sm font-medium text-ink2">
            Reason / Note <span className="text-alert">*</span>
            <textarea
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              placeholder="e.g. Retention period expired"
              className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            />
          </label>
          <p className="text-xs leading-relaxed text-ink3">This action will become part of the permanent custody record.</p>
        </div>
        <footer className="flex shrink-0 gap-2 border-t border-line px-5 py-3">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" disabled={!reason.trim()} loading={approve.isPending} onClick={() => approve.mutate()}>Approve Disposition</Button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-4 border-b border-line py-2.5 last:border-0"><span className="text-xs text-ink3">{label}</span><span className="max-w-[65%] text-right text-sm text-ink">{children}</span></div>
}
