'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Search } from 'lucide-react'
import type { RoomStatus } from '@/lib/api/rooms'
import { cn } from '@/lib/utils'

interface RoomPickerProps {
  id?: string
  rooms: RoomStatus[]
  value: string
  onChange: (roomId: string) => void
  noRoomLabel?: string
  disabled?: boolean
}

/** Searchable, floor-grouped room combobox — replaces a raw <select> that would
 * dump every room into one uncontrolled dropdown. Shared by Guest Request room
 * selection and Internal Task's "Room" location type. */
export function RoomPicker({ id, rooms, value, onChange, noRoomLabel, disabled }: RoomPickerProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const selected = rooms.find((room) => room.room_id === value)
  const noRoomText = noRoomLabel ?? t('tasks.workspace.noRoom')

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = q ? rooms.filter((room) => room.rooms?.room_number?.toLowerCase().includes(q)) : rooms
    const byFloor = new Map<number, RoomStatus[]>()
    for (const room of matches) {
      const floor = room.rooms?.floor ?? 0
      if (!byFloor.has(floor)) byFloor.set(floor, [])
      byFloor.get(floor)!.push(room)
    }
    return [...byFloor.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([floor, items]) => ({
        floor,
        items: [...items].sort((a, b) => (a.rooms?.room_number ?? '').localeCompare(b.rooms?.room_number ?? '', undefined, { numeric: true })),
      }))
  }, [rooms, query])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  function close() {
    setOpen(false)
    setQuery('')
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  function select(roomId: string) {
    onChange(roomId)
    close()
  }

  return (
    <div className="relative" onKeyDown={(event) => { if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close() } }}>
      <button
        id={id}
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-[var(--r-md)] border border-line bg-surface px-3 py-2.5 text-sm disabled:opacity-50"
      >
        <span className={selected ? 'text-ink' : 'text-ink4'}>
          {selected ? t('tasks.createModal.roomNumber', { number: selected.rooms?.room_number }) : noRoomText}
        </span>
        <ChevronDown size={15} className="shrink-0 text-ink4" />
      </button>
      {open && (
        <div ref={menuRef} role="listbox" aria-label={t('tasks.detail.room')} className="absolute left-0 right-0 z-30 mt-1.5 rounded-[var(--r-md)] border border-line bg-surface p-2 shadow-pop">
          <div className="relative mb-2">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink4" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('tasks.createModal.roomSearchPlaceholder')}
              aria-label={t('tasks.createModal.roomSearchPlaceholder')}
              className="w-full rounded border border-line bg-surface-2 py-1.5 pl-7 pr-2 text-xs text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            <button
              type="button"
              role="option"
              aria-selected={!value}
              onClick={() => select('')}
              className={cn('mb-1 block w-full rounded px-2 py-1.5 text-left text-sm text-ink2 hover:bg-surface-2', !value && 'bg-[var(--accent-soft)] text-accent')}
            >
              {noRoomText}
            </button>
            {groups.length === 0 ? (
              <p className="px-2 py-2 text-xs text-ink3">{t('tasks.createModal.noRoomsFound')}</p>
            ) : groups.map(({ floor, items }) => (
              <div key={floor} className="mb-1">
                <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink4">{t('tasks.createModal.floorLabel', { floor })}</p>
                {items.map((room) => (
                  <button
                    key={room.room_id}
                    type="button"
                    role="option"
                    aria-selected={value === room.room_id}
                    onClick={() => select(room.room_id)}
                    className={cn('block w-full rounded px-2 py-1.5 text-left text-sm text-ink2 hover:bg-surface-2', value === room.room_id && 'bg-[var(--accent-soft)] text-accent')}
                  >
                    {room.rooms?.room_number}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
