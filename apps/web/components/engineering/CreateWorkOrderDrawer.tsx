'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { X, Loader2, Sparkles, ImagePlus, UserRound, ChevronDown } from 'lucide-react'
import { engineeringApi, WorkOrder } from '@/lib/api/engineering'
import { roomsApi } from '@/lib/api/rooms'
import { staffApi } from '@/lib/api/staff'
import { Button, IconButton } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { StateBlock } from '@/components/ui/StateBlock'
import { useToast } from '@/components/ui/Toast'

interface Props {
  isOpen: boolean
  onClose: () => void
  onCreate: (wo: WorkOrder) => void
}

export function getCategories(t: TFunction) {
  return [
    { value: 'plumbing', label: t('engineering.createWorkOrder.categoryPlumbing') },
    { value: 'electrical', label: t('engineering.createWorkOrder.categoryElectrical') },
    { value: 'hvac', label: t('engineering.createWorkOrder.categoryHvac') },
    { value: 'furniture', label: t('engineering.createWorkOrder.categoryFurniture') },
    { value: 'appliance', label: t('engineering.createWorkOrder.categoryAppliance') },
    { value: 'structural', label: t('engineering.createWorkOrder.categoryStructural') },
    { value: 'safety', label: t('engineering.createWorkOrder.categorySafety') },
    { value: 'doors_locks', label: t('engineering.createWorkOrder.categoryDoorsLocks') },
    { value: 'painting', label: t('engineering.createWorkOrder.categoryPainting') },
    { value: 'general', label: t('engineering.createWorkOrder.categoryGeneral') },
  ]
}

function getPriorities(t: TFunction) {
  return [
    { value: 'low', label: t('engineering.createWorkOrder.priorityLowLabel'), desc: t('engineering.createWorkOrder.priorityLowDesc') },
    { value: 'normal', label: t('engineering.createWorkOrder.priorityNormalLabel'), desc: t('engineering.createWorkOrder.priorityNormalDesc') },
    { value: 'urgent', label: t('engineering.createWorkOrder.priorityUrgentLabel'), desc: t('engineering.createWorkOrder.priorityUrgentDesc') },
    { value: 'emergency', label: t('engineering.createWorkOrder.priorityEmergencyLabel'), desc: t('engineering.createWorkOrder.priorityEmergencyDesc') },
  ]
}

const PRIORITY_TONE: Record<string, string> = {
  low: 'border-line text-ink2 data-[selected=true]:border-ink data-[selected=true]:bg-surface-3 data-[selected=true]:text-ink data-[selected=true]:font-semibold',
  normal: 'border-line text-ink2 data-[selected=true]:border-ink data-[selected=true]:bg-surface-3 data-[selected=true]:text-ink data-[selected=true]:font-semibold',
  urgent: 'border-line text-ink2 data-[selected=true]:border-caution-line data-[selected=true]:bg-caution-soft data-[selected=true]:text-caution data-[selected=true]:font-semibold',
  emergency: 'border-line text-ink2 data-[selected=true]:border-alert-line data-[selected=true]:bg-alert-soft data-[selected=true]:text-alert data-[selected=true]:font-semibold',
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        checked ? 'bg-accent' : 'bg-surface-3'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-surface shadow transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

export function CreateWorkOrderDrawer({ isOpen, onClose, onCreate }: Props) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const toast = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const drawerRef = useRef<HTMLDivElement>(null)
  const CATEGORIES = useMemo(() => getCategories(t), [t])
  const PRIORITIES = useMemo(() => getPriorities(t), [t])

  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<string>('general')
  const [priority, setPriority] = useState<string>('normal')
  const [selectedRoomId, setSelectedRoomId] = useState('')
  const [locationText, setLocationText] = useState('')
  const [useAI, setUseAI] = useState(false)
  const [nlInput, setNlInput] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [guestReported, setGuestReported] = useState(false)
  const [markRoomOutOfOrder, setMarkRoomOutOfOrder] = useState(false)
  const [assignedTo, setAssignedTo] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)

  const { data: roomsData, isLoading: roomsLoading, isError: roomsError, refetch: refetchRooms } = useQuery({
    queryKey: ['rooms-picker'],
    queryFn: () => roomsApi.list(),
    staleTime: 300_000,
    enabled: isOpen,
  })
  const roomsList: any[] = ((roomsData as any)?.data ?? []).sort((a: any, b: any) => {
    const fa = a.rooms?.floor ?? 0, fb = b.rooms?.floor ?? 0
    if (fa !== fb) return fa - fb
    return parseInt(a.rooms?.room_number ?? '0', 10) - parseInt(b.rooms?.room_number ?? '0', 10)
  })
  const selectedRoom = roomsList.find((r: any) => r.room_id === selectedRoomId)

  const { data: staffData } = useQuery({
    queryKey: ['staff-picker'],
    queryFn: () => staffApi.list(),
    staleTime: 300_000,
    enabled: isOpen,
  })
  const assignableStaff = (staffData?.data.staff ?? []).filter(
    (s) => s.status === 'active' && (s.role === 'engineer' || s.role === 'chief_engineer')
  )

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    setPhotoFile(file)
    setPhotoPreview(file ? URL.createObjectURL(file) : null)
  }

  // Reset form on open/close
  useEffect(() => {
    if (isOpen) {
      setTitle('')
      setCategory('general')
      setPriority('normal')
      setSelectedRoomId('')
      setLocationText('')
      setUseAI(false)
      setNlInput('')
      setValidationError(null)
      setGuestReported(false)
      setMarkRoomOutOfOrder(false)
      setAssignedTo('')
      setPhotoFile(null)
      setPhotoPreview(null)
    }
  }, [isOpen])

  // Room out-of-order only makes sense against a specific room — clear it if the room is cleared.
  useEffect(() => {
    if (!selectedRoomId && markRoomOutOfOrder) setMarkRoomOutOfOrder(false)
  }, [selectedRoomId, markRoomOutOfOrder])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  useEffect(() => {
    if (isOpen && drawerRef.current) drawerRef.current.focus()
  }, [isOpen])

  const mutation = useMutation({
    mutationFn: async () => {
      const roomNumber = selectedRoom?.rooms?.room_number
      const payload: Parameters<typeof engineeringApi.createWorkOrder>[0] = {
        category,
        priority,
        room_id: selectedRoomId || undefined,
        location_text: selectedRoomId
          ? (locationText.trim() || (roomNumber ? `Room ${roomNumber}` : undefined))
          : locationText.trim() || undefined,
        assigned_to: assignedTo || undefined,
        guest_reported: guestReported,
        mark_room_out_of_order: markRoomOutOfOrder && !!selectedRoomId,
      }
      if (useAI) {
        payload.nl_input = nlInput.trim()
      } else {
        payload.title = title.trim()
      }
      const res = await engineeringApi.createWorkOrder(payload)
      if (photoFile) {
        await engineeringApi.uploadWorkOrderPhoto(res.data.id, photoFile, 'before')
      }
      return { ...res, roomNumber }
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['work-orders'] })
      queryClient.invalidateQueries({ queryKey: ['work-order-stats'] })
      if (res.room_marked_out_of_order) {
        queryClient.invalidateQueries({ queryKey: ['room-unavailability'] })
        toast.success(t('engineering.createWorkOrder.roomOutOfOrderToast', { number: res.roomNumber ?? res.data.location_text }))
      }
      onCreate(res.data)
    },
    onError: () => {
      setValidationError(t('engineering.createWorkOrder.createError'))
    },
  })

  function handleSubmit() {
    setValidationError(null)

    if (!useAI && !title.trim()) {
      setValidationError(t('engineering.createWorkOrder.titleRequired'))
      return
    }
    if (useAI && !nlInput.trim()) {
      setValidationError(t('engineering.createWorkOrder.describeRequired'))
      return
    }
    if (!selectedRoomId && !locationText.trim()) {
      setValidationError(t('engineering.createWorkOrder.locationRequired'))
      return
    }

    mutation.mutate()
  }

  if (!isOpen) return null

  return (
    <>
      {/* Scrim — solid, no blur, matches WorkOrderDetailDrawer */}
      <div className="fixed inset-0 bg-[rgba(26,24,21,0.28)] z-drawer transition-opacity" onClick={onClose} aria-hidden="true" />

      {/* Drawer */}
      <div
        ref={drawerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t('engineering.createWorkOrder.ariaLabel')}
        className="fixed right-0 top-0 h-full w-[560px] max-w-full border-l border-line bg-paper shadow-[var(--shadow-pop)] z-drawer flex flex-col outline-none"
        style={{ transform: isOpen ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 220ms cubic-bezier(.2,.7,.3,1)' }}
      >
        {/* Header */}
        <div className="shrink-0 px-6 py-5 border-b border-line bg-surface flex items-start justify-between">
          <h2 className="font-display italic text-[26px] leading-tight text-ink">{t('engineering.createWorkOrder.title')}</h2>
          <IconButton onClick={onClose} aria-label={t('engineering.createWorkOrder.closeModal')}>
            <X className="w-4 h-4" />
          </IconButton>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {/* AI toggle */}
          <div className="flex items-center justify-between p-3 bg-ai-soft border border-ai-line rounded-[var(--r-md)]">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-ai shrink-0" />
              <div>
                <p className="text-sm font-medium text-ink">{t('engineering.createWorkOrder.aiToggleTitle')}</p>
                <p className="text-xs text-ink2">{t('engineering.createWorkOrder.aiToggleDesc')}</p>
              </div>
            </div>
            <Toggle checked={useAI} onChange={() => setUseAI((v) => !v)} />
          </div>

          {/* Where */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink4 mb-2.5">{t('engineering.createWorkOrder.whereLabel')}</p>
            <div className="space-y-2">
              <div>
                <label className="block text-xs font-medium text-ink2 mb-1">
                  {t('engineering.workOrderCard.room')} <span className="text-alert">*</span>
                </label>
                {roomsLoading ? (
                  <Skeleton variant="text" className="h-9 w-full" />
                ) : roomsError ? (
                  <StateBlock status="error" error={{ onRetry: () => refetchRooms() }} className="py-3" />
                ) : (
                  <select
                    value={selectedRoomId}
                    onChange={(e) => setSelectedRoomId(e.target.value)}
                    className="w-full border border-line rounded-[var(--r-md)] px-3 py-2 text-sm bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-accent/30 transition-colors"
                  >
                    <option value="">{t('engineering.createWorkOrder.noSpecificRoom')}</option>
                    {roomsList.map((r: any) => (
                      <option key={r.room_id} value={r.room_id}>
                        {r.rooms?.floor != null
                          ? t('engineering.createWorkOrder.roomOptionFloor', { number: r.rooms?.room_number, floor: r.rooms.floor })
                          : t('engineering.createWorkOrder.roomOption', { number: r.rooms?.room_number })}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-ink2 mb-1">
                  {selectedRoomId ? t('engineering.createWorkOrder.locationDetailLabel') : t('engineering.createWorkOrder.otherLocationLabel')}{' '}
                  {!selectedRoomId && <span className="text-alert">*</span>}
                </label>
                <Input
                  type="text"
                  value={locationText}
                  onChange={(e) => setLocationText(e.target.value)}
                  placeholder={selectedRoomId ? t('engineering.createWorkOrder.locationDetailPlaceholder') : t('engineering.createWorkOrder.otherLocationPlaceholder')}
                />
              </div>
            </div>
          </div>

          {/* What's wrong */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink4 mb-2.5">{t('engineering.createWorkOrder.whatsWrongLabel')}</p>

            {!useAI ? (
              <Input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('engineering.createWorkOrder.titlePlaceholder')}
                className="mb-3"
              />
            ) : (
              <div className="mb-3">
                <textarea
                  value={nlInput}
                  onChange={(e) => setNlInput(e.target.value)}
                  rows={3}
                  placeholder={t('engineering.createWorkOrder.describeIssuePlaceholder')}
                  className="w-full border border-line rounded-[var(--r-md)] px-3 py-2 text-sm bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-accent/30 transition-colors resize-none"
                />
                <p className="text-xs text-ink4 mt-1">{t('engineering.createWorkOrder.aiHint')}</p>
              </div>
            )}

            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  aria-pressed={category === c.value}
                  onClick={() => setCategory(c.value)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    category === c.value
                      ? 'bg-accent-soft border-accent text-accent font-semibold'
                      : 'bg-surface border-line text-ink2 hover:border-line-2'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* How urgent */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink4 mb-2.5">{t('engineering.createWorkOrder.urgencyLabel')}</p>
            <div className="flex gap-1.5">
              {PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  aria-pressed={priority === p.value}
                  data-selected={priority === p.value}
                  title={p.desc}
                  onClick={() => setPriority(p.value)}
                  className={`flex-1 text-center py-2 rounded-[var(--r-md)] text-xs border transition-colors bg-surface ${PRIORITY_TONE[p.value]}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Impact toggles */}
          <div className="bg-surface border border-line rounded-[var(--r-md)] divide-y divide-line-2">
            <div className="p-3.5 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-ink">{t('engineering.createWorkOrder.roomOutOfOrderLabel')}</p>
                <p className="text-xs text-ink3 mt-0.5">
                  {selectedRoomId ? t('engineering.createWorkOrder.roomOutOfOrderDesc') : t('engineering.createWorkOrder.roomOutOfOrderNeedsRoom')}
                </p>
              </div>
              <Toggle
                checked={markRoomOutOfOrder}
                onChange={() => setMarkRoomOutOfOrder((v) => !v)}
                disabled={!selectedRoomId}
              />
            </div>
            <div className="p-3.5 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-ink">{t('engineering.createWorkOrder.guestReportedLabel')}</p>
                <p className="text-xs text-ink3 mt-0.5">{t('engineering.createWorkOrder.guestReportedDesc')}</p>
              </div>
              <Toggle checked={guestReported} onChange={() => setGuestReported((v) => !v)} />
            </div>
          </div>

          {/* Assign */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink4 mb-2.5">
              {t('engineering.createWorkOrder.assignLabel')}{' '}
              <span className="normal-case font-normal text-ink4">({t('engineering.createWorkOrder.assignOptionalTag')})</span>
            </p>
            <div className="relative">
              <UserRound className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink4 pointer-events-none" />
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="w-full appearance-none border border-line rounded-[var(--r-md)] pl-9 pr-8 py-2 text-sm bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-accent/30 transition-colors"
              >
                <option value="">{t('engineering.createWorkOrder.assignUnassigned')}</option>
                {assignableStaff.map((s) => (
                  <option key={s.user_id} value={s.user_id}>{s.full_name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink4 pointer-events-none" />
            </div>
          </div>

          {/* Photo */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink4 mb-2.5">{t('engineering.createWorkOrder.photoLabel')}</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              className="hidden"
            />
            {photoPreview ? (
              <div className="relative rounded-[var(--r-md)] overflow-hidden border border-line bg-surface-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoPreview} alt={t('engineering.workOrderDetail.previewAlt')} className="w-full max-h-48 object-contain" />
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => { setPhotoFile(null); setPhotoPreview(null) }}
                  className="absolute top-2 right-2 rounded-full bg-surface/90 shadow-sm"
                  aria-label={t('engineering.createWorkOrder.removePhotoAriaLabel')}
                >
                  <X className="w-3 h-3" />
                  {t('engineering.createWorkOrder.remove')}
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-20 border border-dashed border-line rounded-[var(--r-md)] flex items-center justify-center gap-2 text-sm text-ink3 hover:bg-surface-2 hover:border-line-2 transition-colors"
              >
                <ImagePlus className="w-4 h-4" />
                {t('engineering.workOrderDetail.addPhoto')}
              </button>
            )}
          </div>

          {/* Validation / API error */}
          {validationError && (
            <p className="text-sm text-alert bg-alert-soft border border-alert-line rounded-[var(--r-md)] px-3 py-2">
              {validationError}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-6 py-4 border-t border-line bg-surface flex items-center justify-between gap-3">
          <p className="text-[11px] text-ink4 max-w-[220px] leading-snug">{t('engineering.createWorkOrder.emergencyHint')}</p>
          <div className="flex items-center gap-2.5 shrink-0">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="button" variant="primary" onClick={handleSubmit} disabled={mutation.isPending}>
              {mutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {useAI ? t('engineering.createWorkOrder.processing') : t('engineering.createWorkOrder.creating')}
                </>
              ) : (
                useAI ? t('engineering.createWorkOrder.createWithAi') : t('engineering.createWorkOrder.createButton')
              )}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
