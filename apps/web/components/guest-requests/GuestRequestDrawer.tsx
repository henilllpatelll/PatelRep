'use client'

import { useState } from 'react'
import { X, Send, Clock } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { format } from 'date-fns'
import { guestRequestsApi, type GuestRequest } from '@/lib/api/guest_requests'
import { Button } from '@/components/ui/Button'

interface Props {
  request: GuestRequest | null
  isOpen: boolean
  onClose: () => void
  onNoteAdded: () => void
}

export function GuestRequestDrawer({ request, isOpen, onClose, onNoteAdded }: Props) {
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const noteMutation = useMutation({
    mutationFn: (notes: string) => guestRequestsApi.updateRequest(request!.id, { notes }),
    onSuccess: () => {
      setNote('')
      setError(null)
      onNoteAdded()
    },
    onError: (err: any) => setError(err.message || 'Failed to save note'),
  })

  if (!isOpen || !request) return null

  const roomNum = request.rooms?.room_number ?? '—'
  const createdAt = request.created_at
    ? format(new Date(request.created_at), 'MMM d, h:mm a')
    : '—'

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative z-10 h-full w-[400px] bg-surface border-l border-line shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink3">Room</p>
            <p className="font-mono text-[26px] font-bold text-ink leading-tight">Room {roomNum}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-[var(--r-sm)] text-ink3 hover:text-ink hover:bg-surface-2 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink3 mb-1.5">Request</p>
            <p className="text-[14px] text-ink leading-relaxed">{request.title}</p>
            {request.description && request.description !== request.title && (
              <p className="mt-1.5 text-[13px] text-ink2 leading-relaxed">{request.description}</p>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-[12px] text-ink3">
            <Clock size={12} />
            <span>Logged {createdAt}</span>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink3 mb-2">Add Note</p>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Add an internal note..."
              rows={3}
              className="w-full bg-surface border border-line rounded-[var(--r-md)] px-3 py-2.5 text-sm text-ink placeholder:text-ink4 focus:border-accent focus:ring-2 focus:ring-[var(--accent-soft)] focus:outline-none resize-none"
            />
            {error && <p className="mt-1 text-[12px] text-[var(--alert)]">{error}</p>}
            <div className="mt-2 flex justify-end">
              <Button
                variant="primary"
                className="text-xs py-1.5"
                disabled={!note.trim() || noteMutation.isPending}
                onClick={() => noteMutation.mutate(note.trim())}
              >
                <Send size={13} />
                {noteMutation.isPending ? 'Saving...' : 'Save Note'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
