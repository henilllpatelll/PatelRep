'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Send, Clock } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { format } from 'date-fns'
import {
  guestRequestsApi,
  type GuestRequest,
  type GuestMessage,
  type AccessibleRoomFeature,
} from '@/lib/api/guest_requests'
import { Button, IconButton } from '@/components/ui/Button'
import { Pill } from '@/components/ui/primitives'
import { useRole } from '@/lib/hooks/useRole'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'

interface Props {
  request: GuestRequest | null
  isOpen: boolean
  onClose: () => void
  onNoteAdded: () => void
  onAdvance: (id: string, status: Exclude<GuestRequest['status'], 'open'>) => void
  isUpdating: boolean
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

const FEATURE_STATUS_TONE: Record<AccessibleRoomFeature['operational_status'], 'ready' | 'alert' | 'caution'> = {
  operational: 'ready',
  out_of_service: 'alert',
  inspection_due: 'caution',
}

const FEATURE_STATUS_ORDER: Record<AccessibleRoomFeature['operational_status'], number> = {
  operational: 0,
  inspection_due: 1,
  out_of_service: 2,
}

export function GuestRequestDrawer({ request, isOpen, onClose, onNoteAdded, onAdvance, isUpdating }: Props) {
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

  const { data: accessibleFeatures = [], isLoading: featuresLoading } = useQuery({
    queryKey: ['accessible-room-features'],
    queryFn: () => guestRequestsApi.listAccessibleRoomFeatures(),
    enabled: isOpen && request?.category === 'accessibility',
    staleTime: 60_000,
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

  const [score, setScore] = useState<number | null>(null)
  const [scoreError, setScoreError] = useState<string | null>(null)

  useEffect(() => {
    setScore(null)
    setScoreError(null)
  }, [request?.id])

  const satisfactionMutation = useMutation({
    mutationFn: (value: number) => guestRequestsApi.recordSatisfaction(request!.id, { satisfaction_score: value }),
    onSuccess: () => {
      setScore(null)
      setScoreError(null)
      onNoteAdded()
    },
    onError: (err: any) => setScoreError(err?.message || t('satisfaction.saveFailed')),
  })

  const drawerRef = useRef<HTMLDivElement>(null!)
  useModalFocusTrap(drawerRef, isOpen && !!request, onClose)

  if (!isOpen || !request) return null

  const roomNum = request.rooms?.room_number ?? '—'
  const createdAt = request.created_at
    ? format(new Date(request.created_at), 'MMM d, h:mm a')
    : '—'

  const isOptedOut = !!request.contact_opted_out_at
  const hasPhone = !!request.guest_phone
  const replyDisabled = isOptedOut || !hasPhone || replyMutation.isPending

  const isResolved = request.status === 'resolved' || request.status === 'verified'
  const resolvedAtMs = request.resolved_at ? new Date(request.resolved_at).getTime() : 0
  const confirmationSent = messages.some(
    (m: GuestMessage) => m.direction === 'outbound' && new Date(m.created_at).getTime() >= resolvedAtMs,
  )
  const needsConfirmation =
    isResolved && !confirmationSent && canReply && !request.contact_opted_out_at && !!request.guest_phone

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Room ${roomNum} guest request`}
        className="relative z-10 h-full w-[400px] bg-surface border-l border-line shadow-2xl flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink3">Room</p>
            <p className="font-mono text-[26px] font-bold text-ink leading-tight">Room {roomNum}</p>
          </div>
          <IconButton variant="ghost" onClick={onClose} aria-label={t('guestRequests.closeDrawer')}>
            <X size={18} />
          </IconButton>
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

          {request.status !== 'verified' && request.status !== 'cancelled' && (
            <div className="flex gap-1.5">
              {request.status === 'open' && (
                <Button variant="outline" className="flex-1 text-xs py-1.5 min-h-[30px]" disabled={isUpdating} onClick={() => onAdvance(request.id, 'acknowledged')}>
                  Acknowledge
                </Button>
              )}
              {request.status === 'acknowledged' && (
                <Button variant="secondary" className="flex-1 text-xs py-1.5 min-h-[30px]" disabled={isUpdating} onClick={() => onAdvance(request.id, 'dispatched')}>
                  Dispatch
                </Button>
              )}
              {request.status === 'dispatched' && (
                <Button variant="secondary" className="flex-1 text-xs py-1.5 min-h-[30px]" disabled={isUpdating} onClick={() => onAdvance(request.id, 'arrived')}>
                  Arrived
                </Button>
              )}
              {request.status === 'arrived' && (
                <Button variant="secondary" className="flex-1 text-xs py-1.5 min-h-[30px]" disabled={isUpdating} onClick={() => onAdvance(request.id, 'guest_contacted')}>
                  Contacted
                </Button>
              )}
              {request.status === 'guest_contacted' && (
                <Button variant="primary" className="flex-1 text-xs py-1.5 min-h-[30px]" disabled={isUpdating} onClick={() => onAdvance(request.id, 'resolved')}>
                  Resolve
                </Button>
              )}
              {request.status === 'resolved' && (
                <Button variant="primary" className="flex-1 text-xs py-1.5 min-h-[30px]" disabled={isUpdating} onClick={() => onAdvance(request.id, 'verified')}>
                  Verify
                </Button>
              )}
            </div>
          )}

          {/* Accessibility guidance (informational only, no assignment/booking action) */}
          {request?.category === 'accessibility' && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink3 mb-1.5">
                {t('accessibilityGuidance.heading')}
              </p>
              <p className="text-[12px] text-ink3 mb-2">{t('accessibilityGuidance.body')}</p>
              {!featuresLoading && accessibleFeatures.length === 0 ? (
                <p className="text-[14px] text-ink3">{t('accessibilityGuidance.empty')}</p>
              ) : (
                <div className="max-h-[200px] overflow-y-auto space-y-2">
                  {[...accessibleFeatures]
                    .sort((a, b) => FEATURE_STATUS_ORDER[a.operational_status] - FEATURE_STATUS_ORDER[b.operational_status])
                    .map((feature) => (
                      <div
                        key={feature.id}
                        className="flex flex-col gap-0.5 pb-2 border-b border-line last:border-0 last:pb-0"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[14px] text-ink">
                            {feature.rooms?.room_number ?? '—'}
                            {feature.rooms?.floor != null && (
                              <span className="ml-1 font-sans text-[12px] text-ink3">
                                {t('accessibilityGuidance.floorLabel', { floor: feature.rooms.floor })}
                              </span>
                            )}
                          </span>
                          <Pill tone={FEATURE_STATUS_TONE[feature.operational_status]} size="sm">
                            {t(`accessibilityGuidance.featureStatus.${feature.operational_status}`)}
                          </Pill>
                        </div>
                        <p className="text-[14px] text-ink">
                          {feature.feature_code}
                          {feature.description ? ` — ${feature.description}` : ''}
                        </p>
                        {feature.room_status && (
                          <p className="text-[12px] text-ink3">{feature.room_status}</p>
                        )}
                        {feature.guidance && (
                          <p className="text-[12px] text-ink2">{feature.guidance}</p>
                        )}
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

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

            {needsConfirmation && (
              <div className="mt-3 rounded-[var(--r-md)] border border-line bg-surface-2 p-3 space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink3">
                  {t('resolutionConfirmation.heading')}
                </p>
                <p className="text-[12px] text-ink3">{t('resolutionConfirmation.body')}</p>
                <Button
                  variant="secondary"
                  className="text-xs py-1.5"
                  onClick={() => setReply(t('resolutionConfirmation.template', { room: roomNum }))}
                >
                  {t('resolutionConfirmation.useTemplate')}
                </Button>
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

          {isResolved && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink3 mb-2">
                {t('satisfaction.heading')}
              </p>
              {request.satisfaction_score != null ? (
                (() => {
                  const scoreStr = String(request.satisfaction_score)
                  const recordedText = t('satisfaction.recorded', { score: request.satisfaction_score })
                  const scoreIndex = recordedText.indexOf(scoreStr)
                  const before = scoreIndex >= 0 ? recordedText.slice(0, scoreIndex) : recordedText
                  const after = scoreIndex >= 0 ? recordedText.slice(scoreIndex + scoreStr.length) : ''
                  return (
                    <div className="flex items-center gap-2">
                      <p className="text-[14px] text-ink">
                        {before}
                        <span className="font-mono">{scoreStr}</span>
                        {after}
                      </p>
                      <Pill tone="ready" size="sm">{scoreStr}/5</Pill>
                    </div>
                  )
                })()
              ) : canReply ? (
                <div>
                  <p className="text-[14px] text-ink">{t('satisfaction.prompt')}</p>
                  <div className="mt-2 flex gap-2">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        aria-pressed={score === n}
                        onClick={() => setScore(n)}
                        className={`min-h-[44px] min-w-[44px] rounded-[var(--r-md)] border font-mono text-[14px] transition-colors ${
                          score === n ? 'border-accent text-accent' : 'border-line text-ink2'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[12px] text-ink3">{t('satisfaction.hint')}</p>
                  {scoreError && <p className="mt-1 text-[12px] text-[var(--alert)]">{scoreError}</p>}
                  <div className="mt-2 flex justify-end">
                    <Button
                      variant="primary"
                      className="text-xs py-1.5"
                      disabled={score === null || satisfactionMutation.isPending}
                      onClick={() => satisfactionMutation.mutate(score!)}
                    >
                      {satisfactionMutation.isPending ? t('satisfaction.saving') : t('satisfaction.save')}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          )}

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
