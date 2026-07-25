'use client'

import { useState } from 'react'
import { X, Send, Clock } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { format } from 'date-fns'
import { guestRequestsApi, type GuestRequest, type GuestMessage } from '@/lib/api/guest_requests'
import { Button } from '@/components/ui/Button'
import { Pill } from '@/components/ui/primitives'
import { useRole } from '@/lib/hooks/useRole'

interface Props {
  request: GuestRequest | null
  isOpen: boolean
  onClose: () => void
  onNoteAdded: () => void
}

const MESSAGE_ROLES = ['front_desk', 'housekeeping_supervisor', 'engineer', 'gm'] as const

const DELIVERY_TONE: Record<GuestMessage['effective_delivery_status'], 'ready' | 'info' | 'caution' | 'alert' | 'blocked'> = {
  delivered: 'ready',
  received: 'ready',
  sent: 'info',
  queued: 'caution',
  undelivered: 'alert',
  failed: 'alert',
  opted_out: 'blocked',
}

export function GuestRequestDrawer({ request, isOpen, onClose, onNoteAdded }: Props) {
  const { t } = useTranslation()
  const { role } = useRole()
  const queryClient = useQueryClient()
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [replyError, setReplyError] = useState<string | null>(null)

  const canReply = MESSAGE_ROLES.includes((role ?? '') as (typeof MESSAGE_ROLES)[number])

  const noteMutation = useMutation({
    mutationFn: (notes: string) => guestRequestsApi.updateRequest(request!.id, { notes }),
    onSuccess: () => {
      setNote('')
      setError(null)
      onNoteAdded()
    },
    onError: (err: any) => setError(err.message || 'Failed to save note'),
  })

  const { data: messages = [], isLoading: messagesLoading, isError: messagesError } = useQuery({
    queryKey: ['guest-messages', request?.id],
    queryFn: () => guestRequestsApi.listMessages(request!.id),
    enabled: isOpen && !!request?.id,
    select: (res) => res.data ?? [],
  })

  const replyMutation = useMutation({
    mutationFn: (body: string) => guestRequestsApi.sendMessage(request!.id, { body, channel: 'sms' }),
    onSuccess: () => {
      setReply('')
      setReplyError(null)
      queryClient.invalidateQueries({ queryKey: ['guest-messages', request!.id] })
      onNoteAdded()
    },
    onError: (err: any) => setReplyError(err?.message || t('guestMessages.sendFailed')),
  })

  if (!isOpen || !request) return null

  const roomNum = request.rooms?.room_number ?? '—'
  const createdAt = request.created_at
    ? format(new Date(request.created_at), 'MMM d, h:mm a')
    : '—'

  const isOptedOut = !!request.contact_opted_out_at
  const hasPhone = !!request.guest_phone
  const replyDisabled = isOptedOut || !hasPhone || replyMutation.isPending

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

          {/* Message thread + reply */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink3 mb-2">{t('guestMessages.heading')}</p>

            {messagesError ? (
              <p className="text-[14px] text-ink3">{t('guestMessages.loadFailed')}</p>
            ) : !messagesLoading && messages.length === 0 ? (
              <div>
                <p className="text-[14px] font-semibold text-ink">{t('guestMessages.emptyHeading')}</p>
                <p className="mt-1 text-[14px] text-ink3">{t('guestMessages.emptyBody')}</p>
              </div>
            ) : (
              <div className="max-h-[280px] overflow-y-auto space-y-2">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex flex-col gap-1 max-w-[85%] rounded-[var(--r-md)] px-3 py-2 ${
                      m.direction === 'outbound' ? 'ml-auto bg-[var(--accent-soft)]' : 'bg-surface-2'
                    }`}
                  >
                    <p className="text-[14px] text-ink leading-relaxed whitespace-pre-wrap">{m.body}</p>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-ink3">
                        {format(new Date(m.created_at), 'MMM d, h:mm a')}
                      </span>
                      {m.direction === 'outbound' && (
                        <Pill tone={DELIVERY_TONE[m.effective_delivery_status]} size="sm">
                          {t(`guestMessages.status.${m.effective_delivery_status}`)}
                        </Pill>
                      )}
                    </div>
                    {m.failure_reason && (
                      <p className="text-[12px] text-[var(--alert)]">{m.failure_reason}</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {canReply && (
              <div className="mt-3">
                <textarea
                  value={reply}
                  onChange={e => setReply(e.target.value)}
                  placeholder={t('guestMessages.placeholder')}
                  rows={3}
                  disabled={replyDisabled}
                  className="w-full bg-surface border border-line rounded-[var(--r-md)] px-3 py-2.5 text-sm text-ink placeholder:text-ink4 focus:border-accent focus:ring-2 focus:ring-[var(--accent-soft)] focus:outline-none resize-none disabled:opacity-60"
                />
                {isOptedOut ? (
                  <p className="mt-1 text-[12px] text-[var(--alert)]">{t('guestMessages.optedOut')}</p>
                ) : !hasPhone ? (
                  <p className="mt-1 text-[12px] text-[var(--alert)]">{t('guestMessages.noPhone')}</p>
                ) : replyError ? (
                  <p className="mt-1 text-[12px] text-[var(--alert)]">{replyError}</p>
                ) : null}
                <div className="mt-2 flex justify-end">
                  <Button
                    variant="primary"
                    className="text-xs py-1.5"
                    disabled={!reply.trim() || replyDisabled}
                    onClick={() => replyMutation.mutate(reply.trim())}
                  >
                    <Send size={13} />
                    {replyMutation.isPending ? t('guestMessages.sending') : t('guestMessages.sendReply')}
                  </Button>
                </div>
              </div>
            )}
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
