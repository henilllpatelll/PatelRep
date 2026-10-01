'use client'
/* eslint-disable @next/next/no-img-element -- local previews and storage URLs */

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Camera, ImageIcon, X } from 'lucide-react'
import { Button, IconButton } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'
import {
  lostFoundApi,
  type LostFoundCategory,
  type LostFoundClassification,
  type LostFoundItem,
} from '@/lib/api/lost_found'
import { roomsApi } from '@/lib/api/rooms'

const CATEGORIES: Array<{ value: LostFoundCategory; label: string }> = [
  { value: 'electronics', label: 'Electronics' }, { value: 'clothing', label: 'Clothing' },
  { value: 'jewelry', label: 'Jewelry' }, { value: 'bags_luggage', label: 'Bags & luggage' },
  { value: 'keys', label: 'Keys' }, { value: 'wallets_cards', label: 'Wallets & cards' },
  { value: 'documents', label: 'Documents' }, { value: 'medical', label: 'Medical' },
  { value: 'toiletries', label: 'Toiletries' }, { value: 'accessories', label: 'Accessories' },
  { value: 'other', label: 'Other' },
]

const FOUND_AREAS = ['Guest Room', 'Lobby', 'Restaurant / Bar', 'Pool', 'Fitness Center', 'Meeting / Event Space', 'Hallway', 'Parking', 'Public Restroom', 'Front Desk', 'Other'] as const
const STORAGE_AREAS = ['Lost & Found Room', 'Front Desk', 'Front Desk — Temporary', 'Manager Office', 'Security', 'Safe', 'Housekeeping Office', 'Other'] as const

type RoomOption = { id: string; room_number: string }

function localDateTimeValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function storageValue(area: string, shelf: string) {
  return shelf.trim() ? `${area} · ${shelf.trim()}` : area
}

interface LogFoundItemDrawerProps {
  isOpen: boolean
  onClose: () => void
  onCreated: (item: LostFoundItem) => void
}

export function LogFoundItemDrawer({ isOpen, onClose, onCreated }: LogFoundItemDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null!)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const descriptionRef = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const errorId = useId()
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<LostFoundCategory>('other')
  const [classification, setClassification] = useState<LostFoundClassification>('standard')
  const [details, setDetails] = useState('')
  const [foundArea, setFoundArea] = useState<(typeof FOUND_AREAS)[number]>('Guest Room')
  const [roomId, setRoomId] = useState('')
  const [otherLocation, setOtherLocation] = useState('')
  const [foundAt, setFoundAt] = useState(localDateTimeValue())
  const [storageArea, setStorageArea] = useState<(typeof STORAGE_AREAS)[number] | ''>('')
  const [shelfBin, setShelfBin] = useState('')
  const [tag, setTag] = useState('')
  const [notes, setNotes] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [formError, setFormError] = useState('')

  useModalFocusTrap(drawerRef, isOpen, onClose)

  const roomsQuery = useQuery({
    queryKey: ['lost-found-room-options'],
    queryFn: () => roomsApi.list() as Promise<{ data: RoomOption[] }>,
    enabled: isOpen,
    select: (response) => response.data ?? [],
  })
  const tagQuery = useQuery({
    queryKey: ['lost-found-tag-suggestion'], queryFn: lostFoundApi.suggestTag, enabled: isOpen,
  })

  useEffect(() => {
    if (isOpen && !tag && tagQuery.data?.data.tag_identifier) setTag(tagQuery.data.data.tag_identifier)
  }, [isOpen, tag, tagQuery.data])

  useEffect(() => () => { if (photoPreview) URL.revokeObjectURL(photoPreview) }, [photoPreview])

  const reset = () => {
    setDescription(''); setCategory('other'); setClassification('standard'); setDetails(''); setFoundArea('Guest Room')
    setRoomId(''); setOtherLocation(''); setFoundAt(localDateTimeValue()); setStorageArea(''); setShelfBin(''); setTag('')
    setNotes(''); setPhoto(null); setPhotoPreview(null); setFormError('')
  }
  const close = () => { if (!createMutation.isPending) { reset(); onClose() } }

  const createMutation = useMutation({
    mutationFn: async () => {
      const selectedRoom = roomsQuery.data?.find((room) => room.id === roomId)
      const photoUrl = photo ? (await lostFoundApi.uploadPhoto(photo)).data.url : undefined
      return lostFoundApi.createItem({
        description: description.trim(), category, classification,
        distinguishing_details: details.trim() || undefined,
        room_id: foundArea === 'Guest Room' ? roomId : undefined,
        location_found: foundArea === 'Guest Room' ? (selectedRoom ? `Room ${selectedRoom.room_number}` : undefined) : (foundArea === 'Other' ? otherLocation.trim() : foundArea),
        found_at: new Date(foundAt).toISOString(), storage_location: storageValue(storageArea, shelfBin),
        tag_identifier: tag.trim() || undefined, notes: notes.trim() || undefined, photo_url: photoUrl,
      })
    },
    onSuccess: (response) => { toast.success('Item logged'); reset(); onCreated(response.data) },
    onError: (error: Error) => setFormError(error.message || 'Could not log this item. Your details are still here.'),
  })

  const choosePhoto = (file?: File) => {
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setFormError('Photo must be JPG, PNG or WebP and under 5 MB.')
      return
    }
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhoto(file); setPhotoPreview(URL.createObjectURL(file)); setFormError('')
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!description.trim()) { setFormError('Add a short description so staff can identify the item.'); descriptionRef.current?.focus(); return }
    if (foundArea === 'Guest Room' && !roomId) { setFormError('Choose the room where the item was found.'); return }
    if (foundArea === 'Other' && !otherLocation.trim()) { setFormError('Enter where the item was found.'); return }
    if (!storageArea) { setFormError('Choose where this item is being stored.'); return }
    createMutation.mutate()
  }

  if (!isOpen) return null
  return createPortal(
    <div className="fixed inset-0 z-drawer" role="presentation">
      <div className="absolute inset-0 bg-ink/25 backdrop-blur-sm" onClick={close} aria-hidden="true" />
      <div ref={drawerRef} role="dialog" aria-modal="true" aria-labelledby="log-found-title" tabIndex={-1} className="absolute inset-y-0 right-0 flex w-full max-w-[560px] flex-col border-l border-line bg-surface shadow-2xl outline-none">
        <header className="flex items-start justify-between border-b border-line px-5 py-4">
          <div><h2 id="log-found-title" className="text-lg font-semibold text-ink">Log found item</h2><p className="mt-1 text-sm text-ink3">Record it once, with the physical location clear.</p></div>
          <IconButton variant="ghost" size="sm" aria-label="Close log found item" onClick={close} disabled={createMutation.isPending}><X size={18} /></IconButton>
        </header>
        <form onSubmit={submit} className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div role="status" aria-live="polite" id={errorId} className="mb-4 min-h-5 text-sm text-alert">{formError}</div>
          <div className="space-y-5">
            <section className="space-y-3"><h3 className="text-sm font-semibold text-ink">Item</h3>
              <label className="block text-sm font-medium text-ink2" htmlFor="lost-found-description">Description <span className="text-alert">*</span><input ref={descriptionRef} id="lost-found-description" required value={description} onChange={(e) => setDescription(e.target.value)} aria-describedby={formError ? errorId : undefined} placeholder="e.g. Black iPhone 15 Pro" className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40" /></label>
              <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium text-ink2" htmlFor="lost-found-category">Category<select id="lost-found-category" value={category} onChange={(e) => setCategory(e.target.value as LostFoundCategory)} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40">{CATEGORIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className="text-sm font-medium text-ink2" htmlFor="lost-found-classification">Handling<select id="lost-found-classification" value={classification} onChange={(e) => setClassification(e.target.value as LostFoundClassification)} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><option value="standard">Standard</option><option value="high_value">High value</option><option value="sensitive">Sensitive</option></select></label></div>
              <label className="block text-sm font-medium text-ink2" htmlFor="lost-found-details">Distinguishing details<textarea id="lost-found-details" value={details} onChange={(e) => setDetails(e.target.value)} rows={2} placeholder="Case, color, damage, initials, or other identifying detail" className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40" /></label>
            </section>
            <section className="space-y-3 border-t border-line pt-5"><h3 className="text-sm font-semibold text-ink">Found</h3><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium text-ink2" htmlFor="lost-found-area">Area<select id="lost-found-area" value={foundArea} onChange={(e) => setFoundArea(e.target.value as typeof foundArea)} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40">{FOUND_AREAS.map((area) => <option key={area}>{area}</option>)}</select></label><label className="text-sm font-medium text-ink2" htmlFor="lost-found-found-at">Found at<input id="lost-found-found-at" type="datetime-local" value={foundAt} onChange={(e) => setFoundAt(e.target.value)} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40" /></label></div>
              {foundArea === 'Guest Room' && <label className="block text-sm font-medium text-ink2" htmlFor="lost-found-room">Room <span className="text-alert">*</span><select id="lost-found-room" required value={roomId} onChange={(e) => setRoomId(e.target.value)} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><option value="">{roomsQuery.isLoading ? 'Loading rooms…' : 'Choose room'}</option>{roomsQuery.data?.map((room) => <option key={room.id} value={room.id}>Room {room.room_number}</option>)}</select></label>}
              {foundArea === 'Other' && <label className="block text-sm font-medium text-ink2" htmlFor="lost-found-other-location">Location <span className="text-alert">*</span><input id="lost-found-other-location" required value={otherLocation} onChange={(e) => setOtherLocation(e.target.value)} placeholder="e.g. East courtyard" className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40" /></label>}
            </section>
            <section className="space-y-3 border-t border-line pt-5"><h3 className="text-sm font-semibold text-ink">Storage</h3><p className="text-sm text-ink3">Required so the next staff member can find it.</p><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium text-ink2" htmlFor="lost-found-storage-area">Storage area <span className="text-alert">*</span><select id="lost-found-storage-area" required value={storageArea} onChange={(e) => setStorageArea(e.target.value as typeof storageArea)} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><option value="">Choose storage</option>{STORAGE_AREAS.map((area) => <option key={area}>{area}</option>)}</select></label><label className="text-sm font-medium text-ink2" htmlFor="lost-found-shelf">Shelf / bin<input id="lost-found-shelf" value={shelfBin} onChange={(e) => setShelfBin(e.target.value)} placeholder="e.g. A-12" className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40" /></label></div></section>
            <section className="space-y-3 border-t border-line pt-5"><h3 className="text-sm font-semibold text-ink">Tag & photo</h3><label className="block text-sm font-medium text-ink2" htmlFor="lost-found-tag">Tag identifier<input id="lost-found-tag" value={tag} onChange={(e) => setTag(e.target.value.toUpperCase())} placeholder="LF-1042" className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 font-mono text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40" /></label>
              <input ref={fileInputRef} id="lost-found-photo" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => choosePhoto(e.target.files?.[0])} />
              {photoPreview ? <div className="relative overflow-hidden rounded-lg border border-line"><img src={photoPreview} alt="Selected item photo preview" className="h-44 w-full object-cover" /><div className="absolute right-2 top-2 flex gap-1"><Button type="button" size="sm" variant="secondary" onClick={() => fileInputRef.current?.click()}>Replace</Button><IconButton type="button" variant="secondary" size="sm" aria-label="Remove selected photo" onClick={() => { if (photoPreview) URL.revokeObjectURL(photoPreview); setPhoto(null); setPhotoPreview(null) }}><X size={15} /></IconButton></div></div> : <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}><Camera size={16} /> Add photo</Button>}
              <p className="text-xs text-ink3">Recommended, not required. JPG, PNG or WebP up to 5 MB.</p>
            </section>
            <section className="border-t border-line pt-5"><label className="block text-sm font-medium text-ink2" htmlFor="lost-found-notes">Notes<textarea id="lost-found-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Optional handling note" className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40" /></label></section>
          </div>
        </form>
        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-surface px-5 py-4"><Button type="button" variant="outline" onClick={close} disabled={createMutation.isPending}>Cancel</Button><Button type="submit" onClick={submit} loading={createMutation.isPending}><ImageIcon size={16} /> Log item</Button></footer>
      </div>
    </div>, document.body,
  )
}
