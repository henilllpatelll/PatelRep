'use client'

import { useState, useMemo } from 'react'
import { X } from 'lucide-react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { guestRequestsApi } from '@/lib/api/guest_requests'
import { roomsApi } from '@/lib/api/rooms'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { cn } from '@/lib/utils'

interface Props {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

export function NewRequestModal({ isOpen, onClose, onSuccess }: Props) {
  const [roomSearch, setRoomSearch] = useState('')
  const [selectedRoom, setSelectedRoom] = useState<{ id: string; number: string } | null>(null)
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<'normal' | 'urgent'>('normal')
  const [showDropdown, setShowDropdown] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: roomsData } = useQuery({
    queryKey: ['rooms-list-simple'],
    queryFn: () => roomsApi.list(),
    enabled: isOpen,
    staleTime: 60_000,
  })

  const allRooms: any[] = useMemo(() => {
    const raw = (roomsData as any)?.data ?? []
    return raw.sort((a: any, b: any) => {
      const na = a.rooms?.room_number ?? ''
      const nb = b.rooms?.room_number ?? ''
      return na.localeCompare(nb, undefined, { numeric: true })
    })
  }, [roomsData])

  const filteredRooms = useMemo(() => {
    if (!roomSearch.trim()) return allRooms.slice(0, 10)
    const q = roomSearch.toLowerCase()
    return allRooms
      .filter((r: any) => (r.rooms?.room_number ?? '').toLowerCase().includes(q))
      .slice(0, 10)
  }, [allRooms, roomSearch])

  const createMutation = useMutation({
    mutationFn: () =>
      guestRequestsApi.createRequest({
        title: description.trim().slice(0, 120),
        description: description.trim(),
        room_id: selectedRoom?.id,
        priority,
      }),
    onSuccess: () => {
      onSuccess()
      handleClose()
    },
    onError: (err: any) => setError(err.message || 'Failed to create request'),
  })

  const handleClose = () => {
    setRoomSearch('')
    setSelectedRoom(null)
    setDescription('')
    setPriority('normal')
    setShowDropdown(false)
    setError(null)
    onClose()
  }

  if (!isOpen) return null

  const canSubmit = !!selectedRoom && description.trim().length >= 3 && !createMutation.isPending

  return (
    // Single fixed container — backdrop is inside, modal card is on top via relative z-10
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={handleClose} />

      {/* Modal card — relative z-10 so it sits above the backdrop sibling */}
      <div className="relative z-10 w-full max-w-md bg-surface rounded-[var(--r-xl)] border border-line shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="text-[15px] font-semibold text-ink">New Guest Request</h2>
          <button
            onClick={handleClose}
            className="p-1.5 rounded text-ink3 hover:text-ink hover:bg-surface-2 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          {/* Room number */}
          <div>
            <label className="block text-[12px] font-semibold text-ink2 mb-1.5">
              Room Number <span className="text-[var(--alert)]">*</span>
            </label>
            <div className="relative">
              <Input
                value={selectedRoom ? `Room ${selectedRoom.number}` : roomSearch}
                onChange={e => {
                  if (selectedRoom) setSelectedRoom(null)
                  setRoomSearch(e.target.value)
                  setShowDropdown(true)
                }}
                onFocus={() => setShowDropdown(true)}
                onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                placeholder="Type or select room..."
                autoComplete="off"
              />
              {selectedRoom && (
                <button
                  onClick={() => { setSelectedRoom(null); setRoomSearch('') }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink3 hover:text-ink"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            {showDropdown && !selectedRoom && filteredRooms.length > 0 && (
              <div className="border border-line rounded-[var(--r-md)] bg-surface shadow-md overflow-hidden mt-1 max-h-[200px] overflow-y-auto">
                {filteredRooms.map((r: any) => (
                  <button
                    key={r.room_id}
                    onMouseDown={() => {
                      setSelectedRoom({ id: r.room_id, number: r.rooms?.room_number ?? '' })
                      setRoomSearch('')
                      setShowDropdown(false)
                    }}
                    className="w-full text-left px-3 py-2 text-[13px] text-ink hover:bg-surface-2 transition-colors"
                  >
                    Room {r.rooms?.room_number}
                    {r.rooms?.floor ? ` — Floor ${r.rooms.floor}` : ''}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="block text-[12px] font-semibold text-ink2 mb-1.5">
              Description <span className="text-[var(--alert)]">*</span>
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What does the guest need?"
              rows={3}
              className="w-full bg-surface border border-line rounded-[var(--r-md)] px-3 py-2.5 text-sm text-ink placeholder:text-ink4 focus:border-accent focus:ring-2 focus:ring-[var(--accent-soft)] focus:outline-none resize-none"
            />
          </div>

          {/* Priority */}
          <div>
            <label className="block text-[12px] font-semibold text-ink2 mb-1.5">Priority</label>
            <div className="flex gap-2">
              {(['normal', 'urgent'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setPriority(p)}
                  className={cn(
                    'flex-1 py-2 rounded-[var(--r-md)] text-[13px] font-medium border transition-colors',
                    priority === p
                      ? p === 'urgent'
                        ? 'bg-[var(--alert-soft)] border-[var(--alert-line)] text-[var(--alert)]'
                        : 'bg-[var(--accent-soft)] border-[var(--accent-line)] text-accent'
                      : 'border-line text-ink3 hover:bg-surface-2'
                  )}
                >
                  {p === 'normal' ? 'Normal' : 'Urgent'}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-[12px] text-[var(--alert)]">{error}</p>}
        </div>

        <div className="flex justify-end gap-2.5 px-5 pb-5">
          <Button variant="ghost" onClick={handleClose}>Cancel</Button>
          <Button variant="primary" disabled={!canSubmit} onClick={() => createMutation.mutate()}>
            {createMutation.isPending ? 'Creating...' : 'Create Request'}
          </Button>
        </div>
      </div>
    </div>
  )
}
