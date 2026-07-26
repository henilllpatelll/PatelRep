'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { X, Loader2, Sparkles, ClipboardList, ImagePlus } from 'lucide-react'
import { engineeringApi, WorkOrder } from '@/lib/api/engineering'
import { roomsApi } from '@/lib/api/rooms'
import { Button, IconButton } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

interface Props {
  isOpen: boolean
  onClose: () => void
  onCreate: (wo: WorkOrder) => void
}

function getCategories(t: TFunction) {
  return [
    { value: 'plumbing', label: t('engineering.createWorkOrder.categoryPlumbing') },
    { value: 'electrical', label: t('engineering.createWorkOrder.categoryElectrical') },
    { value: 'hvac', label: t('engineering.createWorkOrder.categoryHvac') },
    { value: 'furniture', label: t('engineering.createWorkOrder.categoryFurniture') },
    { value: 'appliance', label: t('engineering.createWorkOrder.categoryAppliance') },
    { value: 'structural', label: t('engineering.createWorkOrder.categoryStructural') },
    { value: 'safety', label: t('engineering.createWorkOrder.categorySafety') },
    { value: 'general', label: t('engineering.createWorkOrder.categoryGeneral') },
  ]
}

function getPriorities(t: TFunction) {
  return [
    { value: 'emergency', label: t('engineering.createWorkOrder.priorityEmergencyLabel'), desc: t('engineering.createWorkOrder.priorityEmergencyDesc') },
    { value: 'urgent', label: t('engineering.createWorkOrder.priorityUrgentLabel'), desc: t('engineering.createWorkOrder.priorityUrgentDesc') },
    { value: 'normal', label: t('engineering.createWorkOrder.priorityNormalLabel'), desc: t('engineering.createWorkOrder.priorityNormalDesc') },
    { value: 'low', label: t('engineering.createWorkOrder.priorityLowLabel'), desc: t('engineering.createWorkOrder.priorityLowDesc') },
  ]
}

export function CreateWorkOrderModal({ isOpen, onClose, onCreate }: Props) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
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
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)

  const { data: roomsData } = useQuery({
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
      setPhotoFile(null)
      setPhotoPreview(null)
    }
  }, [isOpen])

  // Escape key
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  const mutation = useMutation({
    mutationFn: async () => {
      const selectedRoom = roomsList.find((r: any) => r.room_id === selectedRoomId)
      const roomNumber = selectedRoom?.rooms?.room_number
      const payload: Parameters<typeof engineeringApi.createWorkOrder>[0] = {
        category,
        priority,
        room_id: selectedRoomId || undefined,
        location_text: selectedRoomId
          ? (locationText.trim() || (roomNumber ? `Room ${roomNumber}` : undefined))
          : locationText.trim() || undefined,
        guest_reported: guestReported,
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
      return res
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['work-orders'] })
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
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-stone-900/20 backdrop-blur-sm z-50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('engineering.createWorkOrder.ariaLabel')}
          className="bg-surface/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-[var(--r-lg)] shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/60 shrink-0">
            <div className="flex items-center gap-2.5">
              <ClipboardList className="w-5 h-5 text-[var(--caution)] shrink-0" />
              <h2 className="text-base font-bold text-ink">{t('engineering.createWorkOrder.title')}</h2>
            </div>
            <IconButton
              onClick={onClose}
              aria-label={t('engineering.createWorkOrder.closeModal')}
            >
              <X className="w-5 h-5" />
            </IconButton>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">

            {/* AI toggle */}
            <div className="flex items-center justify-between p-3 bg-[var(--ai-soft)] border border-[var(--ai-line)] rounded-xl">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[var(--ai)] shrink-0" />
                <div>
                  <p className="text-sm font-medium text-ink">{t('engineering.createWorkOrder.aiToggleTitle')}</p>
                  <p className="text-xs text-ink2">{t('engineering.createWorkOrder.aiToggleDesc')}</p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={useAI}
                onClick={() => setUseAI((v) => !v)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  useAI ? 'bg-[var(--ai)]' : 'bg-surface-3'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-surface shadow transition-transform ${
                    useAI ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Location — room picker + optional free-text */}
            <div className="space-y-2">
              <div>
                <label className="block text-sm font-medium text-ink2 mb-1">
                  {t('engineering.workOrderCard.room')} <span className="text-[var(--alert)]">*</span>
                </label>
                <select
                  value={selectedRoomId}
                  onChange={(e) => setSelectedRoomId(e.target.value)}
                  className="w-full border border-line rounded-[var(--r-md)] px-3 py-2 text-sm bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 transition-colors"
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
              </div>
              <div>
                <label className="block text-sm font-medium text-ink2 mb-1">
                  {selectedRoomId ? t('engineering.createWorkOrder.locationDetailLabel') : t('engineering.createWorkOrder.otherLocationLabel')}{' '}
                  {!selectedRoomId && <span className="text-[var(--alert)]">*</span>}
                  {selectedRoomId && <span className="text-ink4 font-normal">{t('programs.pmCompletion.optionalTag')}</span>}
                </label>
                <Input
                  type="text"
                  value={locationText}
                  onChange={(e) => setLocationText(e.target.value)}
                  placeholder={selectedRoomId ? t('engineering.createWorkOrder.locationDetailPlaceholder') : t('engineering.createWorkOrder.otherLocationPlaceholder')}
                />
              </div>
            </div>

            {/* Title (only when AI is off) */}
            {!useAI && (
              <div>
                <label className="block text-sm font-medium text-ink2 mb-1">
                  {t('engineering.createWorkOrder.titleLabel')} <span className="text-[var(--alert)]">*</span>
                </label>
                <Input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t('engineering.createWorkOrder.titlePlaceholder')}
                />
              </div>
            )}

            {/* NL Input (only when AI is on) */}
            {useAI && (
              <div>
                <label className="block text-sm font-medium text-ink2 mb-1">
                  {t('engineering.createWorkOrder.describeIssueLabel')} <span className="text-[var(--alert)]">*</span>
                </label>
                <textarea
                  value={nlInput}
                  onChange={(e) => setNlInput(e.target.value)}
                  rows={3}
                  placeholder={t('engineering.createWorkOrder.describeIssuePlaceholder')}
                  className="w-full border border-line rounded-[var(--r-md)] px-3 py-2 text-sm bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 transition-colors resize-none"
                />
                <p className="text-xs text-ink4 mt-1">
                  {t('engineering.createWorkOrder.aiHint')}
                </p>
              </div>
            )}

            {/* Category */}
            <div>
              <label className="block text-sm font-medium text-ink2 mb-1">{t('engineering.createWorkOrder.categoryLabel')}</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full border border-line rounded-[var(--r-md)] px-3 py-2 text-sm bg-surface text-ink focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 transition-colors"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Priority */}
            <div>
              <label className="block text-sm font-medium text-ink2 mb-2">{t('engineering.workOrderDetail.priorityLabel')}</label>
              <div className="space-y-2">
                {PRIORITIES.map((p) => (
                  <label
                    key={p.value}
                    className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                      priority === p.value
                        ? p.value === 'emergency'
                          ? 'border-red-300 bg-red-50'
                          : p.value === 'urgent'
                          ? 'border-[var(--alert-line)] bg-[var(--alert-soft)]'
                          : p.value === 'normal'
                          ? 'border-[var(--info-line)] bg-[var(--info-soft)]'
                          : 'border-slate-300 bg-slate-50'
                        : 'border-line hover:border-line-2'
                    }`}
                  >
                    <input
                      type="radio"
                      name="priority"
                      value={p.value}
                      checked={priority === p.value}
                      onChange={() => setPriority(p.value)}
                      className="mt-0.5 accent-amber-500"
                    />
                    <div>
                      <p className="text-sm font-medium text-ink capitalize">{p.label}</p>
                      <p className="text-xs text-ink3">{p.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Guest reported */}
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <span className="text-sm font-medium text-ink2">{t('engineering.createWorkOrder.guestReportedLabel')}</span>
              <button
                type="button"
                role="switch"
                aria-checked={guestReported}
                onClick={() => setGuestReported((v) => !v)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  guestReported ? 'bg-[var(--accent)]' : 'bg-surface-3'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-surface shadow transition-transform ${
                    guestReported ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </label>

            {/* Photo */}
            <div>
              <label className="block text-sm font-medium text-ink2 mb-1">
                {t('engineering.createWorkOrder.photoLabel')} <span className="text-ink4 font-normal">{t('programs.pmCompletion.optionalTag')}</span>
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFileChange}
                className="hidden"
              />
              {photoPreview ? (
                <div className="relative rounded-xl overflow-hidden border border-line bg-surface-3">
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
              <p className="text-sm text-[var(--alert)] bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-lg px-3 py-2">
                {validationError}
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-white/60 shrink-0">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleSubmit}
              disabled={mutation.isPending}
            >
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
