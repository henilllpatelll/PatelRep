'use client'

import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/ui/Toast'
import { Button } from '@/components/ui/Button'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'
import { lostFoundApi, type LostFoundItem, type LostFoundVoidReason } from '@/lib/api/lost_found'
import { invalidateLostFound, LOST_FOUND_VOID_REASON_LABEL } from '@/lib/utils/lostFoundInventory'

const REASONS: LostFoundVoidReason[] = ['duplicate_record', 'entered_by_mistake', 'wrong_property_or_item', 'test_record', 'other']

/** D-38/D-40: the safe correction path replacing routine permanent delete. Preserves the
 * record and its custody history; only hides it from active inventory/matching/disposition. */
export function VoidRecordDialog({ item, onClose, onVoided }: { item: LostFoundItem; onClose: () => void; onVoided: (item: LostFoundItem) => void }) {
  const dialogRef = useRef<HTMLDivElement>(null!)
  const queryClient = useQueryClient()
  const toast = useToast()
  const [reason, setReason] = useState<LostFoundVoidReason>('duplicate_record')
  const [notes, setNotes] = useState('')
  useModalFocusTrap(dialogRef, true, onClose)

  const voidItem = useMutation({
    mutationFn: () => lostFoundApi.voidItem(item.id, { reason, notes: notes.trim() }),
    onSuccess: ({ data }) => {
      invalidateLostFound(queryClient)
      toast.success('Record voided')
      onVoided({ ...item, ...data })
    },
    onError: (error: Error) => toast.error(error.message || 'Could not void this record'),
  })

  return createPortal(
    <div className="fixed inset-0 z-modal" role="presentation">
      <div className="absolute inset-0 bg-ink/25 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="void-record-title"
        tabIndex={-1}
        className="absolute left-1/2 top-1/2 w-full max-w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-surface p-5 shadow-2xl outline-none"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">Void Record</p>
        <h2 id="void-record-title" className="mt-1 text-base font-semibold text-ink">{item.description}</h2>
        <p className="mt-1 font-mono text-xs text-ink3">{item.tag_identifier || 'No tag'}</p>
        <p className="mt-4 text-sm leading-relaxed text-ink2">This should only be used when the record itself was created incorrectly. It does not dispose of the physical item.</p>
        <label className="mt-4 block text-sm font-medium text-ink2">
          Reason <span className="text-alert">*</span>
          <select value={reason} onChange={(event) => setReason(event.target.value as LostFoundVoidReason)} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink">
            {REASONS.map((value) => <option key={value} value={value}>{LOST_FOUND_VOID_REASON_LABEL[value]}</option>)}
          </select>
        </label>
        <label className="mt-3 block text-sm font-medium text-ink2">
          Notes <span className="text-alert">*</span>
          <textarea required value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="e.g. Duplicate of LF-1041" className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink" />
        </label>
        <p className="mt-3 text-xs leading-relaxed text-ink3">The record and its audit history will remain.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" disabled={!notes.trim()} loading={voidItem.isPending} onClick={() => voidItem.mutate()}>Void Record</Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
