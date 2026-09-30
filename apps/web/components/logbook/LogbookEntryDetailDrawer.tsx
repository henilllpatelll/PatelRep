'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, MoreVertical, X } from 'lucide-react'
import { format } from 'date-fns'
import { useTranslation } from 'react-i18next'
import {
  logbookApi,
  type LogbookCategory,
  type LogbookEntry,
  type LogbookPriority,
} from '@/lib/api/logbook'
import type { Shift } from '@/lib/api/scheduling'
import { roomsApi, type RoomStatus } from '@/lib/api/rooms'
import { staffApi } from '@/lib/api/staff'
import { Button, IconButton } from '@/components/ui/Button'
import { Pill, Avatar } from '@/components/ui/primitives'
import { Skeleton } from '@/components/ui/Skeleton'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'
import { useToast } from '@/components/ui/Toast'
import { AssigneePicker } from '@/components/tasks/AssigneePicker'
import { cn } from '@/lib/utils'
import { RelatedItemPicker } from './RelatedItemPicker'
import { LogbookLinkedItemCard } from './LogbookLinkedItemCard'
import { LogbookCommentsPanel } from './LogbookCommentsPanel'
import { LogbookAttachments } from './LogbookAttachments'
import { categoryIcon, getCategoryOptions, statusLabel, statusTone, type LogbookRelatedItem } from '@/lib/utils/logbookDisplay'
import { canManageLogbookEntry, type LogbookCapabilities } from '@/lib/utils/logbookCapabilities'
import { getNextShift, sortOperationalShifts } from '@/lib/utils/logbookWorkspace'
import { formatHistoryEvent } from '@/lib/utils/logbookHistory'

type DrawerTab = 'details' | 'comments' | 'reads' | 'history'

function titleFromContent(content: string): string {
  const trimmed = content.trim()
  if (trimmed.length <= 60) return trimmed
  return `${trimmed.slice(0, 57).trimEnd()}…`
}

function MoreMenu({
  canManage, canDeletePermanently, isResolved, isArchived, onEdit, onToggleImportant, isImportant, onArchive, onDelete,
}: {
  canManage: boolean
  canDeletePermanently: boolean
  isResolved: boolean
  isArchived: boolean
  onEdit: () => void
  onToggleImportant: () => void
  isImportant: boolean
  onArchive: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  if (!canManage) return null

  return (
    <div className="relative">
      <IconButton ref={triggerRef} variant="ghost" size="sm" aria-label={t('logbook.moreActionsAria')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="text-ink3 hover:text-ink2">
        <MoreVertical size={16} />
      </IconButton>
      {open && (
        <div ref={menuRef} role="menu" className="absolute right-0 z-30 mt-1.5 w-52 rounded-[var(--r-md)] border border-line bg-surface p-1.5 shadow-pop">
          {!isResolved && (
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onEdit() }} className="block w-full rounded px-2.5 py-2 text-left text-sm text-ink2 hover:bg-surface-2">
              {t('logbook.editHandoff')}
            </button>
          )}
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onToggleImportant() }} className="block w-full rounded px-2.5 py-2 text-left text-sm text-ink2 hover:bg-surface-2">
            {isImportant ? t('logbook.removeImportant') : t('logbook.markImportant')}
          </button>
          {!isArchived && (
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onArchive() }} className="block w-full rounded px-2.5 py-2 text-left text-sm text-ink2 hover:bg-surface-2">
              {t('logbook.archiveHandoff')}
            </button>
          )}
          {canDeletePermanently && (
            <>
              <div className="my-1 h-px bg-line" />
              <button type="button" role="menuitem" onClick={() => { setOpen(false); onDelete() }} className="block w-full rounded px-2.5 py-2 text-left text-sm text-[var(--alert)] hover:bg-[var(--alert-soft)]">
                {t('logbook.deletePermanently')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

interface LogbookEntryDetailDrawerProps {
  entry: LogbookEntry | null
  onClose: () => void
  onChanged: () => void
  onDelete: (entry: LogbookEntry) => void
  shifts: Shift[]
  currentUserId: string
  capabilities: LogbookCapabilities
  startInEditMode?: boolean
}

export function LogbookEntryDetailDrawer({ entry, onClose, onChanged, onDelete, shifts, currentUserId, capabilities, startInEditMode }: LogbookEntryDetailDrawerProps) {
  const { t, i18n } = useTranslation()
  const toast = useToast()
  const queryClient = useQueryClient()
  const ref = useRef<HTMLDivElement>(null!)
  useModalFocusTrap(ref, !!entry, onClose)

  const [activeEntryId, setActiveEntryId] = useState<string | null>(entry?.id ?? null)
  const [tab, setTab] = useState<DrawerTab>('details')
  const [isEditing, setIsEditing] = useState(false)
  const [showResolveConfirm, setShowResolveConfirm] = useState(false)
  const [resolutionNote, setResolutionNote] = useState('')
  const [showCarryForwardConfirm, setShowCarryForwardConfirm] = useState(false)
  const [carryForwardOwner, setCarryForwardOwner] = useState('')
  const [autoEditedEntryId, setAutoEditedEntryId] = useState<string | null>(null)
  const [translatedContent, setTranslatedContent] = useState<string | null>(null)

  useEffect(() => {
    setActiveEntryId(entry?.id ?? null)
    setTab('details')
    setIsEditing(false)
    setShowResolveConfirm(false)
    setShowCarryForwardConfirm(false)
    setResolutionNote('')
    setAutoEditedEntryId(null)
    setTranslatedContent(null)
  }, [entry?.id])

  const entryQuery = useQuery({
    queryKey: ['logbook-entry', activeEntryId],
    queryFn: () => logbookApi.getEntry(activeEntryId as string),
    enabled: !!activeEntryId,
    initialData: activeEntryId && entry && activeEntryId === entry.id ? { data: entry } : undefined,
    select: (res) => res.data,
  })
  const active = entryQuery.data ?? null

  const continuityQuery = useQuery({
    queryKey: ['logbook-entry-continuity', activeEntryId],
    queryFn: () => logbookApi.getContinuity(activeEntryId as string),
    enabled: !!activeEntryId,
    select: (res) => res.data,
  })
  const chain = continuityQuery.data ?? []
  const chainIndex = active ? chain.findIndex((link) => link.id === active.id) : -1
  const successor = chainIndex >= 0 && chainIndex < chain.length - 1 ? chain[chainIndex + 1] : null

  const eventsQuery = useQuery({
    queryKey: ['logbook-entry-events', activeEntryId],
    queryFn: () => logbookApi.getEvents(activeEntryId as string),
    enabled: !!activeEntryId && tab === 'history',
    select: (res) => res.data,
  })

  const staffQuery = useQuery({ queryKey: ['staff-picker'], queryFn: () => staffApi.list(), enabled: isEditing || showCarryForwardConfirm || tab === 'comments', staleTime: 60_000 })
  const staff = useMemo(() => (staffQuery.data?.data.staff ?? []).filter((member) => member.status === 'active'), [staffQuery.data])
  const roomsQuery = useQuery({ queryKey: ['rooms-list-simple'], queryFn: () => roomsApi.list(), enabled: isEditing, staleTime: 60_000 })
  const rooms = useMemo(() => ((roomsQuery.data as { data?: RoomStatus[] } | undefined)?.data ?? []), [roomsQuery.data])
  const readsQuery = useQuery({ queryKey: ['logbook-entry-reads', activeEntryId], queryFn: () => logbookApi.listEntryReads(activeEntryId as string), enabled: !!activeEntryId && tab === 'reads', select: (res) => res.data })

  const shiftNameById = useMemo(() => Object.fromEntries(shifts.map((shift) => [shift.id, shift.name])), [shifts])
  const deptShifts = useMemo(() => (active ? sortOperationalShifts(shifts.filter((shift) => shift.department_id === active.department_id)) : []), [shifts, active])
  const nextShift = active ? getNextShift(deptShifts, active.shift_id ?? null) : null

  // ── Edit form state ──────────────────────────────────────────────────────
  const [editContent, setEditContent] = useState('')
  const [editCategory, setEditCategory] = useState<LogbookCategory>('general')
  const [editPriority, setEditPriority] = useState<LogbookPriority>('normal')
  const [editNeedsFollowUp, setEditNeedsFollowUp] = useState(false)
  const [editAssignedTo, setEditAssignedTo] = useState('')
  const [editFollowUpAt, setEditFollowUpAt] = useState('')
  const [editRelatedItem, setEditRelatedItem] = useState<LogbookRelatedItem | null>(null)
  const [editError, setEditError] = useState<string | null>(null)

  function startEditing() {
    if (!active) return
    setEditContent(active.content)
    setEditCategory(active.category)
    setEditPriority(active.priority)
    setEditNeedsFollowUp(active.status === 'follow_up')
    setEditAssignedTo(active.assigned_to ?? '')
    setEditFollowUpAt(active.follow_up_at ? active.follow_up_at.slice(0, 16) : '')
    setEditRelatedItem(
      active.related_type && active.related_id ? { type: active.related_type, id: active.related_id, title: t(`logbook.linkTypes.${active.related_type}`) } : null,
    )
    setEditError(null)
    setTab('details')
    setIsEditing(true)
  }

  useEffect(() => {
    if (!startInEditMode || !active || active.status === 'resolved' || autoEditedEntryId === active.id) return
    setAutoEditedEntryId(active.id)
    startEditing()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startInEditMode, active, autoEditedEntryId])

  function invalidateAfterChange(id: string) {
    onChanged()
    queryClient.invalidateQueries({ queryKey: ['logbook-entry', id] })
    queryClient.invalidateQueries({ queryKey: ['logbook-entry-continuity'] })
    queryClient.invalidateQueries({ queryKey: ['logbook-entry-events', id] })
  }

  const saveMutation = useMutation({
    mutationFn: () => logbookApi.updateEntry(active!.id, {
      content: editContent.trim(),
      category: editCategory,
      priority: editPriority,
      status: editNeedsFollowUp ? 'follow_up' : 'informational',
      follow_up_at: editNeedsFollowUp && editFollowUpAt ? new Date(editFollowUpAt).toISOString() : null,
      assigned_to: editNeedsFollowUp ? (editAssignedTo || null) : null,
      related_type: editRelatedItem?.type ?? null,
      related_id: editRelatedItem ? editRelatedItem.id : null,
    }),
    onSuccess: () => { setIsEditing(false); invalidateAfterChange(active!.id) },
    onError: (err: unknown) => setEditError(err instanceof Error ? err.message : t('logbook.unableToAddHandoff')),
  })

  const toggleImportantMutation = useMutation({
    mutationFn: () => logbookApi.updateEntry(active!.id, { priority: active!.priority === 'important' ? 'normal' : 'important' }),
    onSuccess: () => invalidateAfterChange(active!.id),
  })

  const resolveMutation = useMutation({
    mutationFn: () => logbookApi.resolveEntry(active!.id, { resolution_note: resolutionNote.trim() || undefined }),
    onSuccess: () => { setShowResolveConfirm(false); toast.success(t('logbook.markResolved')); invalidateAfterChange(active!.id) },
  })

  const archiveMutation = useMutation({
    mutationFn: () => logbookApi.archiveEntry(active!.id),
    onSuccess: () => { toast.success(t('logbook.archiveHandoff')); onChanged(); onClose() },
  })

  const carryForwardMutation = useMutation({
    mutationFn: () => logbookApi.carryForwardEntry(active!.id, { assigned_to: carryForwardOwner || undefined }),
    onSuccess: () => {
      setShowCarryForwardConfirm(false)
      toast.success(t('logbook.carryForwardSuccess', { shift: nextShift?.name ?? t('logbook.shift') }))
      invalidateAfterChange(active!.id)
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : t('logbook.carryForwardBlocked')),
  })
  const acknowledgeMutation = useMutation({ mutationFn: () => logbookApi.acknowledgeEntry(active!.id), onSuccess: () => invalidateAfterChange(active!.id) })
  const reminderMutation = useMutation({ mutationFn: () => logbookApi.remindAcknowledgmentTargets(active!.id), onSuccess: (response) => toast.success(response.data.rate_limited ? t('logbook.reminderSentRecently') : t('logbook.reminderSent', { count: response.data.sent })) })
  const translateMutation = useMutation({
    mutationFn: () => logbookApi.translateEntry(active!.id, { target_language: i18n.language.startsWith('es') ? 'es' : 'en' }),
    onSuccess: ({ data }) => setTranslatedContent(data.translated_text),
    onError: () => toast.error(t('logbook.translationFailed')),
  })

  useEffect(() => {
    if (activeEntryId && entryQuery.isSuccess) void logbookApi.markEntryRead(activeEntryId).then(() => invalidateAfterChange(activeEntryId))
    // Mark only after the entry has loaded, never from the activity list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEntryId, entryQuery.isSuccess])

  if (!entry || !active) return null

  const authorName = active.user_profiles?.preferred_name || active.user_profiles?.full_name || t('logbook.teamMember')
  const ownerName = active.assigned_user_profiles?.preferred_name || active.assigned_user_profiles?.full_name
  const canManage = canManageLogbookEntry(capabilities, active.author_id, currentUserId)
  const isResolved = active.status === 'resolved'
  const isFollowUp = active.status === 'follow_up'
  const resolvedByName = active.resolved_by_profile?.preferred_name || active.resolved_by_profile?.full_name || null

  return (
    <>
      <div className="fixed inset-0 z-drawer bg-stone-900/10 backdrop-blur-sm" onClick={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={t('logbook.detailAria')} className="fixed right-0 top-0 bottom-0 z-drawer flex h-full w-full max-w-[620px] flex-col border-l border-line bg-surface shadow-2xl">
        <div className="shrink-0 border-b border-line px-5 py-4">
          <div className="flex items-start justify-between gap-2">
            <h2 className="min-w-0 flex-1 text-base font-semibold leading-snug text-ink">{titleFromContent(active.content) || t('logbook.entryTitleFallback')}</h2>
            <div className="flex shrink-0 items-center gap-0.5">
              <MoreMenu
                canManage={canManage}
                canDeletePermanently={capabilities.canDeletePermanently}
                isResolved={isResolved}
                isArchived={!!active.archived_at}
                isImportant={active.priority === 'important'}
                onEdit={startEditing}
                onToggleImportant={() => toggleImportantMutation.mutate()}
                onArchive={() => archiveMutation.mutate()}
                onDelete={() => onDelete(active)}
              />
              <IconButton variant="ghost" size="sm" onClick={onClose} aria-label={t('common.close')} className="text-ink3 hover:text-ink2"><X size={18} /></IconButton>
            </div>
          </div>
          <p className="mt-1 text-xs text-ink3">{active.departments?.name || t('logbook.general')}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {active.status !== 'informational' && <Pill tone={statusTone(active.status)} size="sm">{statusLabel(t, active.status)}</Pill>}
            {active.priority === 'important' && <Pill tone="alert" size="sm">{t('logbook.priorities.important')}</Pill>}
            <Pill tone="neutral" size="sm">{categoryIcon(active.category, 11)}{t(`logbook.categories.${active.category}`)}</Pill>
          </div>
        </div>

        <div role="tablist" aria-label={t('logbook.detailAria')} className="shrink-0 flex gap-1 border-b border-line px-3 pt-1">
          {(['details', 'comments', 'reads', 'history'] as DrawerTab[]).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn('rounded-t-md px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]', tab === key ? 'text-ink border-b-2 border-accent' : 'text-ink3 hover:text-ink2')}
            >
              {key === 'comments' ? `${t('logbook.comments')}${active.comment_count ? ` ${active.comment_count}` : ''}` : key === 'reads' ? `${t('logbook.readBy')}${active.read_count ? ` ${active.read_count}` : ''}` : t(`logbook.${key}`)}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === 'details' && !isEditing && (
            <div className="space-y-5 p-5">
              <section>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-[.08em] text-ink3">{t('logbook.handoffSectionLabel')}</p>
                <p className="whitespace-pre-wrap text-sm leading-6 text-ink">{translatedContent ?? active.content}</p>
                <div className="mt-2">
                  {translatedContent ? (
                    <button type="button" onClick={() => setTranslatedContent(null)} className="text-xs font-medium text-accent hover:underline">{t('logbook.showOriginal')}</button>
                  ) : (
                    <button type="button" onClick={() => translateMutation.mutate()} disabled={translateMutation.isPending} className="text-xs font-medium text-accent hover:underline disabled:opacity-60">
                      {translateMutation.isPending ? t('logbook.translating') : t('logbook.translateToCurrentLanguage')}
                    </button>
                  )}
                </div>
                <div className="mt-2 flex items-center gap-2 text-xs text-ink3">
                  <Avatar name={authorName} size={20} />
                  <span>{authorName}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">{format(new Date(active.created_at), 'MMM d · h:mm a')}</span>
                  {active.edited_at && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{t('logbook.editedAt', { time: format(new Date(active.edited_at), 'h:mm a') })}</span>
                    </>
                  )}
                </div>
              </section>

              {(isFollowUp || isResolved) && (
                <section className="border-t border-line pt-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[.08em] text-ink3">{t('logbook.followUpSectionLabel')}</p>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between gap-3"><span className="text-ink3">{t('logbook.statusFieldLabel')}</span><span className="font-medium text-ink">{statusLabel(t, active.status)}</span></div>
                    {isFollowUp && (
                      <>
                        <div className="flex justify-between gap-3"><span className="text-ink3">{t('logbook.owner')}</span><span className="font-medium text-ink">{ownerName ?? t('logbook.unassigned')}</span></div>
                        {active.follow_up_at && <div className="flex justify-between gap-3"><span className="text-ink3">{t('logbook.due')}</span><span className="font-medium text-ink">{format(new Date(active.follow_up_at), 'MMM d · h:mm a')}</span></div>}
                      </>
                    )}
                  </div>
                </section>
              )}

              {isResolved && (
                <section className="rounded-[var(--r-md)] border border-[var(--ready-line)] bg-[var(--ready-soft)] p-3.5">
                  <p className="text-sm font-medium text-[var(--ready)]">
                    {t('logbook.resolvedBanner', { name: resolvedByName ?? t('logbook.acknowledgedFallback'), time: active.resolved_at ? format(new Date(active.resolved_at), 'MMM d · h:mm a') : '' })}
                  </p>
                  {active.resolution_note && <p className="mt-1.5 text-sm text-ink2">{active.resolution_note}</p>}
                </section>
              )}

              {active.related_type && active.related_id && (
                <div className="border-t border-line pt-4">
                  <LogbookLinkedItemCard relatedType={active.related_type} relatedId={active.related_id} />
                </div>
              )}

              <div className="border-t border-line pt-4">
                <LogbookAttachments entryId={active.id} canRemove={canManage} />
              </div>

              <section className="border-t border-line pt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[.08em] text-ink3">{t('logbook.shiftContinuity')}</p>
                {continuityQuery.isError ? (
                  <p className="text-sm text-ink3">{t('logbook.unableToLoadContinuity')}</p>
                ) : continuityQuery.isLoading ? (
                  <Skeleton className="h-10 w-full" />
                ) : chain.length < 2 ? (
                  <p className="text-sm text-ink3">{t('logbook.originallyReported')} · {format(new Date(active.created_at), 'MMM d')}</p>
                ) : (
                  <ol className="space-y-1.5">
                    {chain.map((link, index) => (
                      <li key={link.id}>
                        <button
                          type="button"
                          onClick={() => link.id !== active.id && setActiveEntryId(link.id)}
                          className={cn('flex w-full items-center justify-between gap-2 rounded-[var(--r-sm)] px-2 py-1.5 text-left text-sm', link.id === active.id ? 'bg-surface-3 font-medium text-ink' : 'text-ink2 hover:bg-surface-2')}
                        >
                          <span>
                            {index === 0 ? t('logbook.originallyReported') : t('logbook.carriedTo', { shift: link.shift_name ?? t('logbook.shift') })}
                            {' · '}{link.shift_name ?? t('logbook.shift')} · {format(new Date(link.entry_date), 'MMM d')}
                          </span>
                          {link.id === active.id && <Pill tone="neutral" size="sm">{t('logbook.currentShiftBadge')}</Pill>}
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
          )}

          {tab === 'comments' && <LogbookCommentsPanel entryId={active.id} staff={staff} currentUserId={currentUserId} canDeleteAny={capabilities.canDeleteAnyComment} onChanged={() => invalidateAfterChange(active.id)} />}

          {tab === 'reads' && <div className="space-y-5 p-5">
            {active.acknowledgment?.required && <section className="rounded-[var(--r-md)] border border-line bg-surface-2 p-4"><p className="text-xs font-semibold uppercase tracking-[.08em] text-ink3">{t('logbook.acknowledgment')}</p><p className="mt-2 text-sm text-ink">{t('logbook.acknowledgmentProgress', { acknowledged: active.acknowledgment.acknowledged_count, total: active.acknowledgment.total_required })}</p>{active.acknowledgment.current_user_required && !active.acknowledgment.current_user_acknowledged && <Button className="mt-3" size="sm" variant="primary" loading={acknowledgeMutation.isPending} onClick={() => acknowledgeMutation.mutate()}>{t('logbook.acknowledgeHandoff')}</Button>}{capabilities.canSendAcknowledgmentReminder && active.acknowledgment.acknowledged_count < active.acknowledgment.total_required && <Button className="mt-3" size="sm" variant="outline" loading={reminderMutation.isPending} onClick={() => reminderMutation.mutate()}>{t('logbook.sendReminder')}</Button>}</section>}
            <section><p className="text-xs font-semibold uppercase tracking-[.08em] text-ink3">{t('logbook.readReceipts')}</p><p className="mt-1 text-sm text-ink3">{t('logbook.seenBy', { count: active.read_count ?? 0 })}</p>{readsQuery.isLoading ? <Skeleton className="mt-3 h-10 w-full" /> : <ul className="mt-3 space-y-2">{(readsQuery.data ?? []).map((read) => <li key={read.user_id} className="flex justify-between gap-3 text-sm"><span className="text-ink">✓ {read.name}</span><time className="font-mono text-xs text-ink3">{format(new Date(read.last_read_at), 'h:mm a')}</time></li>)}</ul>}</section>
          </div>}

          {tab === 'details' && isEditing && (
            <form onSubmit={(event) => { event.preventDefault(); if (editContent.trim()) saveMutation.mutate() }} className="space-y-5 p-5">
              <p className="text-xs font-semibold uppercase tracking-[.08em] text-ink3">{t('logbook.editHandoff')}</p>

              <div>
                <label htmlFor="edit-handoff-content" className="mb-1.5 block text-sm font-medium text-ink">{t('logbook.contentLabel')}</label>
                <textarea id="edit-handoff-content" rows={4} value={editContent} onChange={(e) => setEditContent(e.target.value)} className="w-full resize-none rounded-[var(--r-md)] border border-line bg-surface px-3 py-2.5 text-sm text-ink" />
              </div>

              <div>
                <p className="mb-1.5 text-sm font-medium text-ink">{t('logbook.category')}</p>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('logbook.category')}>
                  {getCategoryOptions(t).map((option) => (
                    <button key={option.value} type="button" onClick={() => setEditCategory(option.value)} aria-pressed={editCategory === option.value} className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium', editCategory === option.value ? 'bg-accent text-white border-accent' : 'bg-surface border-line text-ink2 hover:bg-surface-2')}>
                      {categoryIcon(option.value)}{option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-sm font-medium text-ink">{t('logbook.importance')}</p>
                <div className="flex gap-2" role="group" aria-label={t('logbook.importance')}>
                  {(['normal', 'important'] as LogbookPriority[]).map((value) => (
                    <button key={value} type="button" onClick={() => setEditPriority(value)} aria-pressed={editPriority === value} className={cn('flex-1 rounded-[var(--r-md)] border py-2 text-[13px] font-semibold', editPriority === value ? (value === 'important' ? 'bg-[var(--alert-soft)] border-[var(--alert)] text-[var(--alert)]' : 'bg-surface-3 border-ink3 text-ink') : 'bg-surface border-line text-ink2 hover:bg-surface-2')}>
                      {t(`logbook.priorities.${value}`)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-t border-line pt-4">
                <label className="flex items-center gap-2 text-sm font-medium text-ink">
                  <input type="checkbox" checked={editNeedsFollowUp} onChange={(e) => setEditNeedsFollowUp(e.target.checked)} className="h-4 w-4 rounded border-line" />
                  {t('logbook.needsFollowUp')}
                </label>
                {editNeedsFollowUp && (
                  <div className="mt-3 space-y-3 rounded-[var(--r-md)] border border-line bg-surface-2 p-3">
                    <div>
                      <label htmlFor="edit-handoff-owner" className="mb-1.5 block text-sm font-medium text-ink">{t('logbook.owner')}</label>
                      <AssigneePicker id="edit-handoff-owner" staff={staff} value={editAssignedTo} onChange={setEditAssignedTo} unassignedLabel={t('logbook.unassigned')} />
                    </div>
                    <div>
                      <label htmlFor="edit-handoff-due" className="mb-1.5 block text-sm font-medium text-ink">{t('logbook.due')}</label>
                      <input id="edit-handoff-due" type="datetime-local" value={editFollowUpAt} onChange={(e) => setEditFollowUpAt(e.target.value)} className="w-full rounded-[var(--r-md)] border border-line bg-surface px-3 py-2 text-sm text-ink" />
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t border-line pt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[.08em] text-ink3">{t('logbook.linkTo')}</p>
                <RelatedItemPicker value={editRelatedItem} onChange={setEditRelatedItem} rooms={rooms} />
              </div>

              {editError && (
                <div className="flex items-start gap-2 rounded-[var(--r-md)] border border-[var(--alert-line)] bg-[var(--alert-soft)] px-3 py-2.5">
                  <AlertCircle size={14} className="mt-0.5 shrink-0 text-[var(--alert)]" aria-hidden="true" />
                  <p role="alert" className="text-sm text-[var(--alert)]">{editError}</p>
                </div>
              )}

              <div className="flex gap-2">
                <Button type="submit" variant="primary" loading={saveMutation.isPending} disabled={!editContent.trim()} className="flex-1">{t('logbook.saveChanges')}</Button>
                <Button type="button" variant="outline" onClick={() => setIsEditing(false)}>{t('common.cancel')}</Button>
              </div>
            </form>
          )}

          {tab === 'history' && (
            <div className="p-5">
              {eventsQuery.isError ? (
                <p className="text-sm text-ink3">{t('logbook.unableToLoadHistory')}</p>
              ) : eventsQuery.isLoading ? (
                <div className="space-y-3"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-4/5" /><Skeleton className="h-4 w-3/5" /></div>
              ) : (eventsQuery.data ?? []).length === 0 ? (
                <p className="text-sm text-ink3">{t('logbook.historyEvents.createdFallback')} · {authorName} · {format(new Date(active.created_at), 'MMM d · h:mm a')}</p>
              ) : (
                <ol className="space-y-4">
                  {(eventsQuery.data ?? []).map((event) => (
                    <li key={event.id}>
                      <p className="text-sm text-ink">{formatHistoryEvent(t, event, shiftNameById)}</p>
                      <p className="mt-0.5 font-mono text-xs text-ink3">{format(new Date(event.created_at), 'MMM d · h:mm a')}</p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>

        {!isEditing && canManage && isFollowUp && (
          <div className="shrink-0 border-t border-line p-4">
            {showResolveConfirm ? (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-ink">{t('logbook.resolveConfirmTitle')}</p>
                <div>
                  <label htmlFor="resolution-note" className="mb-1 block text-xs font-medium text-ink3">{t('logbook.resolutionNoteLabel')}</label>
                  <textarea id="resolution-note" rows={2} value={resolutionNote} onChange={(e) => setResolutionNote(e.target.value)} placeholder={t('logbook.resolutionNotePlaceholder')} className="w-full resize-none rounded-[var(--r-md)] border border-line bg-surface px-3 py-2 text-sm text-ink" />
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setShowResolveConfirm(false)} className="flex-1">{t('common.cancel')}</Button>
                  <Button variant="primary" loading={resolveMutation.isPending} onClick={() => resolveMutation.mutate()} className="flex-1">{t('logbook.markResolved')}</Button>
                </div>
              </div>
            ) : showCarryForwardConfirm ? (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-ink">{t('logbook.carryForwardConfirmTitle', { shift: nextShift?.name ?? t('logbook.shift') })}</p>
                <p className="text-xs text-ink3">{t('logbook.carryForwardConfirmBody')}</p>
                <div className="rounded-[var(--r-md)] border border-line bg-surface-2 px-3 py-2 text-sm">
                  <span className="text-ink3">{t('logbook.destination')}: </span><span className="font-medium text-ink">{nextShift?.name ?? '—'}</span>
                </div>
                <div>
                  <label htmlFor="carry-forward-owner" className="mb-1 block text-xs font-medium text-ink3">{t('logbook.owner')}</label>
                  <AssigneePicker id="carry-forward-owner" staff={staff} value={carryForwardOwner || active.assigned_to || ''} onChange={setCarryForwardOwner} unassignedLabel={t('logbook.unassigned')} />
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setShowCarryForwardConfirm(false)} className="flex-1">{t('common.cancel')}</Button>
                  <Button variant="primary" loading={carryForwardMutation.isPending} disabled={!nextShift} onClick={() => carryForwardMutation.mutate()} className="flex-1">{t('logbook.carryForward')}</Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-3">
                {successor ? (
                  <Button variant="outline" onClick={() => setActiveEntryId(successor.id)} className="flex-1">
                    {t('logbook.carriedToShiftLink', { shift: successor.shift_name ?? t('logbook.shift') })}
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => { setCarryForwardOwner(active.assigned_to ?? ''); setShowCarryForwardConfirm(true) }} disabled={!nextShift} className="flex-1">
                    {t('logbook.carryForward')}
                  </Button>
                )}
                <Button variant="primary" onClick={() => setShowResolveConfirm(true)} className="flex-1">{t('logbook.markResolved')}</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
