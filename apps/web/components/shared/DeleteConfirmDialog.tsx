'use client'

import { Loader2 } from 'lucide-react'

interface DeleteConfirmDialogProps {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
  loading?: boolean
}

export function DeleteConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
  loading,
}: DeleteConfirmDialogProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-stone-900/30 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-surface rounded-[var(--r-lg)] shadow-xl border border-line w-full max-w-sm mx-4 p-6">
        <h2 className="font-semibold text-ink text-base mb-1">{title}</h2>
        {description ? (
          <p className="text-sm text-ink3 mb-5">{description}</p>
        ) : (
          <p className="text-sm text-ink3 mb-5">This action cannot be undone.</p>
        )}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 px-4 py-2 border border-line rounded-lg text-sm font-medium text-ink2 hover:bg-surface-2 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 px-4 py-2 bg-[var(--alert)] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center justify-center gap-2"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
