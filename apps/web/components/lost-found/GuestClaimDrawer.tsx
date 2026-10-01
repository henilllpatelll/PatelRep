'use client'

import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { Button, IconButton } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'
import { lostFoundApi, type LostFoundCategory, type LostFoundClaim } from '@/lib/api/lost_found'
import { roomsApi } from '@/lib/api/rooms'

const CATEGORIES: Array<{ value: LostFoundCategory; label: string }> = [
  { value: 'electronics', label: 'Electronics' }, { value: 'clothing', label: 'Clothing' },
  { value: 'jewelry', label: 'Jewelry' }, { value: 'bags_luggage', label: 'Bags & luggage' },
  { value: 'keys', label: 'Keys' }, { value: 'wallets_cards', label: 'Wallets & cards' },
  { value: 'documents', label: 'Documents' }, { value: 'medical', label: 'Medical' },
  { value: 'toiletries', label: 'Toiletries' }, { value: 'accessories', label: 'Accessories' }, { value: 'other', label: 'Other' },
]
type RoomOption = { id: string; room_number: string }

export function GuestClaimDrawer({ isOpen, onClose, onCreated }: { isOpen: boolean; onClose: () => void; onCreated: (claim: LostFoundClaim) => void }) {
  const drawerRef = useRef<HTMLDivElement>(null!)
  const toast = useToast()
  const [guestName, setGuestName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [roomId, setRoomId] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<LostFoundCategory>('other')
  const [details, setDetails] = useState('')
  const [lastSeenAt, setLastSeenAt] = useState('')
  const [stayStart, setStayStart] = useState('')
  const [stayEnd, setStayEnd] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  useModalFocusTrap(drawerRef, isOpen, onClose)
  const roomsQuery = useQuery({ queryKey: ['lost-found-room-options'], queryFn: () => roomsApi.list() as Promise<{ data: RoomOption[] }>, enabled: isOpen, select: (response) => response.data ?? [] })
  const reset = () => { setGuestName(''); setPhone(''); setEmail(''); setRoomId(''); setDescription(''); setCategory('other'); setDetails(''); setLastSeenAt(''); setStayStart(''); setStayEnd(''); setNotes(''); setError('') }
  const create = useMutation({
    mutationFn: () => lostFoundApi.createClaim({ guest_name: guestName.trim(), guest_phone: phone.trim() || undefined, guest_email: email.trim() || undefined, room_id: roomId || undefined, description: description.trim(), category, distinguishing_details: details.trim() || undefined, last_seen_at: lastSeenAt ? new Date(lastSeenAt).toISOString() : undefined, stay_start: stayStart || undefined, stay_end: stayEnd || undefined, notes: notes.trim() || undefined }),
    onSuccess: ({ data }) => { reset(); toast.success('Guest claim created'); onCreated(data) },
    onError: (requestError: Error) => setError(requestError.message || 'Could not create the claim. Your details are still here.'),
  })
  if (!isOpen) return null
  return createPortal(<div className="fixed inset-0 z-drawer" role="presentation"><div className="absolute inset-0 bg-ink/25 backdrop-blur-sm" aria-hidden="true" onClick={onClose} /><div ref={drawerRef} role="dialog" aria-modal="true" aria-labelledby="guest-claim-title" tabIndex={-1} className="absolute inset-y-0 right-0 flex w-full max-w-[560px] flex-col border-l border-line bg-surface shadow-2xl outline-none"><header className="flex items-start justify-between border-b border-line px-5 py-4"><div><h2 id="guest-claim-title" className="text-base font-semibold text-ink">Create guest claim</h2><p className="mt-1 text-sm text-ink3">Record the report now; staff can review found items separately.</p></div><IconButton variant="ghost" size="sm" aria-label="Close guest claim" onClick={onClose}><X size={18} /></IconButton></header><form className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5" onSubmit={(event) => { event.preventDefault(); if (!guestName.trim() || !description.trim()) { setError('Guest name and a description of the missing item are required.'); return } if (stayStart && stayEnd && stayEnd < stayStart) { setError('Check-out date must be on or after check-in date.'); return } setError(''); create.mutate() }}><section className="space-y-3"><h3 className="text-sm font-semibold text-ink">Guest contact</h3><label className="block text-sm font-medium text-ink2">Guest name <span className="text-alert">*</span><input required value={guestName} onChange={(e) => setGuestName(e.target.value)} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40" /></label><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium text-ink2">Phone<input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink" /></label><label className="text-sm font-medium text-ink2">Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink" /></label></div></section><section className="space-y-3 border-t border-line pt-5"><h3 className="text-sm font-semibold text-ink">Stay</h3><label className="block text-sm font-medium text-ink2">Room<select value={roomId} onChange={(e) => setRoomId(e.target.value)} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink"><option value="">Not tied to a room</option>{roomsQuery.data?.map((room) => <option key={room.id} value={room.id}>Room {room.room_number}</option>)}</select></label><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium text-ink2">Check-in<input type="date" value={stayStart} onChange={(e) => setStayStart(e.target.value)} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink" /></label><label className="text-sm font-medium text-ink2">Check-out<input type="date" value={stayEnd} onChange={(e) => setStayEnd(e.target.value)} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink" /></label></div></section><section className="space-y-3 border-t border-line pt-5"><h3 className="text-sm font-semibold text-ink">Missing item</h3><label className="block text-sm font-medium text-ink2">Description <span className="text-alert">*</span><textarea required value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="e.g. Black iPhone 15 Pro" className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink" /></label><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium text-ink2">Category<select value={category} onChange={(e) => setCategory(e.target.value as LostFoundCategory)} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink">{CATEGORIES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className="text-sm font-medium text-ink2">Last seen<input type="datetime-local" value={lastSeenAt} onChange={(e) => setLastSeenAt(e.target.value)} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink" /></label></div><label className="block text-sm font-medium text-ink2">Distinguishing details<textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={2} placeholder="Color, case, damage, initials, or another private detail" className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink" /></label><label className="block text-sm font-medium text-ink2">Internal notes<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink" /></label></section>{error && <p role="alert" className="rounded-lg border border-alert-line bg-alert-soft p-3 text-sm text-alert">{error}</p>}<p className="text-xs leading-relaxed text-ink3">A match never releases an item. Verify a detail the guest has not publicly disclosed before confirming ownership.</p></form><footer className="flex gap-2 border-t border-line px-5 py-3"><Button variant="outline" onClick={onClose}>Cancel</Button><Button className="flex-1" onClick={() => { const form = drawerRef.current?.querySelector('form'); form?.requestSubmit() }} loading={create.isPending}>Create claim</Button></footer></div></div>, document.body)
}
