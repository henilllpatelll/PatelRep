'use client'

import { useRef, useState } from 'react'
import { X, Loader2, ImagePlus } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { lostFoundApi } from '@/lib/api/lost_found'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'

export async function uploadItemPhoto(file: File): Promise<string | null> {
  const result = await lostFoundApi.uploadPhoto(file)
  return result?.data?.url ?? null
}

interface Props {
  isOpen: boolean
  roomId?: string
  roomNumber?: string
  compact?: boolean
  onClose: () => void
  onCreate: () => void
}

export function LogFoundItemModal({ isOpen, roomId, roomNumber, compact, onClose, onCreate }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [description, setDescription] = useState('')
  const [locationFound, setLocationFound] = useState(roomNumber ? `Room ${roomNumber}` : '')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    setPhotoFile(file)
    setPhotoPreview(file ? URL.createObjectURL(file) : null)
  }

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      let photoUrl: string | undefined
      if (photoFile) {
        const url = await uploadItemPhoto(photoFile)
        if (!url) throw new Error('Photo upload failed — please try again or remove the photo.')
        photoUrl = url
      }
      return lostFoundApi.createItem({
        description: description.trim(),
        room_id: roomId,
        location_found: locationFound.trim() || undefined,
        photo_url: photoUrl,
      })
    },
    onSuccess: () => {
      reset()
      onCreate()
    },
    onError: (err: Error) => setError(err.message || 'Failed to log item'),
  })

  function reset() {
    setDescription('')
    setLocationFound(roomNumber ? `Room ${roomNumber}` : '')
    setPhotoFile(null)
    setPhotoPreview(null)
    setError(null)
  }

  function handleClose() {
    reset()
    onClose()
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!description.trim()) { setError('Please describe the found item.'); return }
    setError(null)
    mutate()
  }

  useModalFocusTrap(dialogRef, isOpen, handleClose)
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-stone-900/20 backdrop-blur-sm" onClick={handleClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="log-found-item-title"
        tabIndex={-1}
        className="relative bg-surface/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-[var(--r-lg)] shadow-xl w-full max-w-md mx-4 flex flex-col max-h-[90vh]"
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
          <div>
            <h2 id="log-found-item-title" className="text-lg font-semibold text-gray-900">Log Found Item</h2>
            {roomNumber && (
              <p className="text-sm text-gray-500 mt-0.5">Room {roomNumber}</p>
            )}
          </div>
          <button onClick={handleClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-y-auto px-6 pb-6 space-y-4">
          {/* Photo */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Photo <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileChange} className="hidden" />
            {photoPreview ? (
              <div className="relative rounded-xl overflow-hidden border border-line bg-stone-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoPreview} alt="Preview" className="w-full max-h-52 object-contain" />
                <button
                  type="button"
                  onClick={() => { setPhotoFile(null); setPhotoPreview(null) }}
                  className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 bg-white/90 rounded-full text-xs font-medium text-gray-700 hover:bg-white shadow-sm transition-colors border border-gray-200"
                  aria-label="Remove photo"
                >
                  <X className="w-3 h-3" />
                  Remove
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-20 border border-dashed border-gray-300 rounded-lg flex items-center justify-center gap-2 text-sm text-gray-500 hover:bg-gray-50 hover:border-gray-400 transition-colors"
              >
                <ImagePlus className="w-4 h-4" />
                Add photo
              </button>
            )}
          </div>

          {/* Location */}
          {!compact && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Location Found <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={locationFound}
                onChange={(e) => setLocationFound(e.target.value)}
                placeholder="e.g. Room 204, Pool area, Lobby..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
              />
            </div>
          )}

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description <span className="text-[var(--alert)]">*</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Black iPhone 14, gold bracelet, blue umbrella..."
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent resize-none"
              autoFocus
            />
          </div>

          {error && (
            <p className="text-sm text-[var(--alert)] bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex gap-3 pt-1 shrink-0">
            <button type="button" onClick={handleClose} className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || !description.trim()}
              className="flex-1 px-4 py-2 bg-accent text-white rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity flex items-center justify-center gap-2"
            >
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {isPending ? 'Logging…' : 'Log Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
