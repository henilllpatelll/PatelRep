'use client'

import { useState, useEffect, useRef } from 'react'
import { MoreVertical, Pencil, Trash2 } from 'lucide-react'

interface KebabMenuProps {
  onEdit: () => void
  onDelete: () => void
}

export function KebabMenu({ onEdit, onDelete }: KebabMenuProps) {
  const [open, setOpen] = useState(false)
  const [openAbove, setOpenAbove] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [open])

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!open && ref.current) {
      const rect = ref.current.getBoundingClientRect()
      setOpenAbove(window.innerHeight - rect.bottom < 90)
    }
    setOpen((v) => !v)
  }

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={handleToggle}
        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        aria-label="More options"
      >
        <MoreVertical size={15} />
      </button>

      {open && (
        <div className={`absolute right-0 z-50 w-32 bg-white border border-gray-200 rounded-xl shadow-lg py-1 text-sm ${openAbove ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
          <button
            onClick={(e) => { e.stopPropagation(); setOpen(false); onEdit() }}
            className="w-full flex items-center gap-2 px-3 py-2 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <Pencil size={13} />
            Edit
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setOpen(false); onDelete() }}
            className="w-full flex items-center gap-2 px-3 py-2 text-red-600 hover:bg-red-50 transition-colors"
          >
            <Trash2 size={13} />
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
