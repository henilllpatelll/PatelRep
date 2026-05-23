'use client'

import { useEffect, useRef, useState } from 'react'
import { Library, Upload, Trash2, FileText, AlertCircle, Loader2, X } from 'lucide-react'
import { sopApi, SOPDocument } from '@/lib/api/sop'
import { SOPQueryModal } from '@/components/ai/SOPQueryModal'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES = ['All', 'Housekeeping', 'Engineering', 'HR', 'Emergency', 'General'] as const
type FilterCategory = (typeof CATEGORIES)[number]

const UPLOAD_CATEGORIES = ['Housekeeping', 'Engineering', 'HR', 'Emergency', 'General', 'Other'] as const
type UploadCategory = (typeof UPLOAD_CATEGORIES)[number]

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelativeDate(isoString: string): string {
  const now = Date.now()
  const then = new Date(isoString).getTime()
  const diffMs = now - then
  const diffMin = Math.floor(diffMs / 60_000)
  const diffHr = Math.floor(diffMs / 3_600_000)
  const diffDay = Math.floor(diffMs / 86_400_000)

  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`
  if (diffHr < 24) return `${diffHr} hour${diffHr !== 1 ? 's' : ''} ago`
  if (diffDay === 1) return 'Yesterday'
  if (diffDay < 7) return `${diffDay} days ago`
  if (diffDay < 30) return `${Math.floor(diffDay / 7)} week${Math.floor(diffDay / 7) !== 1 ? 's' : ''} ago`
  if (diffDay < 365) return `${Math.floor(diffDay / 30)} month${Math.floor(diffDay / 30) !== 1 ? 's' : ''} ago`
  return `${Math.floor(diffDay / 365)} year${Math.floor(diffDay / 365) !== 1 ? 's' : ''} ago`
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: SOPDocument['indexing_status'] }) {
  const map: Record<
    SOPDocument['indexing_status'],
    { cls: string; label: string; pulse?: boolean }
  > = {
    pending: { cls: 'bg-gray-50 text-gray-500', label: 'Pending' },
    processing: { cls: 'bg-yellow-50 text-yellow-700', label: 'Processing…', pulse: true },
    indexed: { cls: 'bg-green-50 text-green-700', label: 'Indexed' },
    failed: { cls: 'bg-red-50 text-red-700', label: 'Failed' },
  }
  const { cls, label, pulse } = map[status] ?? { cls: 'bg-gray-50 text-gray-500', label: status }
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${cls} ${pulse ? 'animate-pulse' : ''}`}
    >
      {label}
    </span>
  )
}

// ── Category badge ────────────────────────────────────────────────────────────

function CategoryBadge({ category }: { category: string | null }) {
  if (!category) return null
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-100">
      {category}
    </span>
  )
}

// ── Skeleton card ─────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 animate-pulse">
      <div className="h-4 bg-gray-100 rounded w-3/4 mb-3" />
      <div className="h-3 bg-gray-100 rounded w-1/3 mb-4" />
      <div className="h-3 bg-gray-100 rounded w-full mb-2" />
      <div className="h-3 bg-gray-100 rounded w-2/3 mb-4" />
      <div className="flex items-center justify-between">
        <div className="h-5 bg-gray-100 rounded w-16" />
        <div className="h-3 bg-gray-100 rounded w-20" />
      </div>
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ onUpload }: { onUpload: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
        <FileText size={28} className="text-gray-300" />
      </div>
      <p className="text-base font-semibold text-gray-700 mb-1">No SOPs uploaded yet</p>
      <p className="text-sm text-gray-400 mb-5 max-w-xs">
        Upload your hotel's standard operating procedures to make them searchable with AI.
      </p>
      <button
        onClick={onUpload}
        className="flex min-h-[44px] items-center gap-2 px-4 py-2 text-sm font-medium text-black bg-amber-400 rounded-lg hover:bg-amber-500 transition-colors"
      >
        <Upload size={15} />
        Upload your first SOP
      </button>
      <div className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-3 text-left sm:grid-cols-3">
        {['Room turns', 'Emergency calls', 'PM checklists'].map((item) => (
          <div key={item} className="rounded-xl border border-amber-100 bg-amber-50/50 px-4 py-3">
            <p className="text-sm font-semibold text-stone-800">{item}</p>
            <p className="mt-1 text-xs text-stone-500">Good first upload</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Document card ─────────────────────────────────────────────────────────────

interface DocumentCardProps {
  doc: SOPDocument
  onDeleteRequest: (doc: SOPDocument) => void
  onOpen: (doc: SOPDocument) => void
  deleting: boolean
}

function DocumentCard({ doc, onDeleteRequest, onOpen, deleting }: DocumentCardProps) {
  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    onDeleteRequest(doc)
  }

  return (
    <div
      onClick={() => onOpen(doc)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(doc)
        }
      }}
      role="button"
      tabIndex={0}
      className="cursor-pointer group focus:outline-none focus:ring-2 focus:ring-amber-400 rounded-2xl"
    >
    <Card
      className="hover:shadow-md transition-shadow h-full"
    >
      {/* Title row */}
      <div className="flex items-start gap-2.5 mb-2">
        <div className="shrink-0 mt-0.5 w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
          <FileText size={16} className="text-amber-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900 leading-tight truncate group-hover:text-amber-700 transition-colors">
            {doc.title}
          </p>
          {doc.category && (
            <div className="mt-1">
              <CategoryBadge category={doc.category} />
            </div>
          )}
        </div>
      </div>

      {/* Description or filename */}
      <p className="text-xs text-gray-500 line-clamp-2 mb-3 min-h-[2rem]">
        {doc.description || doc.storage_path.split('/').pop() || '—'}
      </p>

      {/* Footer row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <StatusBadge status={doc.indexing_status} />
          {doc.page_count !== null && (
            <span className="text-xs text-gray-400">{doc.page_count} pg</span>
          )}
          <span className="text-xs text-gray-400 hidden sm:inline">
            {formatFileSize(doc.file_size_bytes)}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-gray-400">{formatRelativeDate(doc.created_at)}</span>
          <button
            onClick={handleDelete}
            disabled={deleting}
            aria-label={`Delete ${doc.title}`}
            title="Delete document"
            className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
          >
            {deleting ? (
              <Loader2 size={14} className="animate-spin text-gray-400" />
            ) : (
              <Trash2 size={14} />
            )}
          </button>
        </div>
      </div>
    </Card>
    </div>
  )
}

function ConfirmDeleteDialog({
  doc,
  loading,
  onCancel,
  onConfirm,
}: {
  doc: SOPDocument
  loading: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [loading, onCancel])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-stone-900/20 backdrop-blur-sm" onClick={!loading ? onCancel : undefined} />
      <div role="dialog" aria-modal="true" aria-labelledby="delete-sop-title" className="relative w-full max-w-md rounded-2xl border border-white/[0.95] bg-white/[0.9] p-6 shadow-xl backdrop-blur-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="delete-sop-title" className="text-base font-semibold text-stone-900">Delete SOP?</h2>
            <p className="mt-2 text-sm text-stone-600">
              Delete "{doc.title}" from the library. This cannot be undone.
            </p>
          </div>
          <button type="button" onClick={onCancel} disabled={loading} aria-label="Close" className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600 disabled:opacity-50">
            <X size={18} />
          </button>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={loading}>Cancel</Button>
          <Button type="button" variant="secondary" onClick={onConfirm} disabled={loading} className="border-red-200 bg-red-50 text-red-700 hover:bg-red-100">
            {loading && <Loader2 size={13} className="animate-spin" />}
            Delete
          </Button>
        </div>
      </div>
    </div>
  )
}

function NoticeDialog({ title, message, onClose }: { title: string; message: string; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-stone-900/20 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="sop-notice-title" className="relative w-full max-w-sm rounded-2xl border border-white/[0.95] bg-white/[0.9] p-6 shadow-xl backdrop-blur-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="sop-notice-title" className="text-base font-semibold text-stone-900">{title}</h2>
            <p className="mt-2 text-sm text-stone-600">{message}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600">
            <X size={18} />
          </button>
        </div>
        <Button type="button" variant="primary" onClick={onClose} className="mt-6 w-full justify-center">OK</Button>
      </div>
    </div>
  )
}

// ── Upload modal ──────────────────────────────────────────────────────────────

interface UploadModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (doc: SOPDocument) => void
}

function UploadModal({ isOpen, onClose, onSuccess }: UploadModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<UploadCategory>('General')
  const [description, setDescription] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !uploading) onClose()
    }
    if (isOpen) document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, uploading, onClose])

  // Reset when modal opens
  useEffect(() => {
    if (isOpen) {
      setFile(null)
      setTitle('')
      setCategory('General')
      setDescription('')
      setUploading(false)
      setUploadError(null)
      setSuccessMessage(null)
    }
  }, [isOpen])

  if (!isOpen) return null

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    setFile(f)
    if (f && !title) {
      // Pre-fill title from filename (strip extension)
      setTitle(f.name.replace(/\.pdf$/i, '').replace(/[-_]/g, ' '))
    }
  }

  async function handleUpload() {
    if (!file) return
    const cleanTitle = title.trim()
    if (!cleanTitle) {
      setUploadError('Title is required.')
      return
    }

    setUploading(true)
    setUploadError(null)
    setSuccessMessage(null)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('title', cleanTitle)
    formData.append('category', category)
    if (description.trim()) {
      formData.append('description', description.trim())
    }

    try {
      const res = await sopApi.uploadDocument(formData)
      setSuccessMessage('Uploaded! Indexing in background — status will update automatically.')
      onSuccess(res.data)
      // Auto-close after a brief delay so user can read the message
      setTimeout(() => onClose(), 1800)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload failed. Please try again.'
      setUploadError(msg)
    } finally {
      setUploading(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-stone-900/20 backdrop-blur-sm z-50"
        onClick={!uploading ? onClose : undefined}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Upload SOP document"
          className="bg-white/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-2xl shadow-xl w-full max-w-lg p-6"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center shrink-0">
                <Upload size={16} className="text-white" />
              </div>
              <h2 className="text-base font-bold text-gray-900">Upload SOP Document</h2>
            </div>
            {!uploading && (
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100/60 transition-colors"
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            )}
          </div>

          <div className="space-y-4">
            {/* File picker */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                PDF File <span className="text-red-500">*</span>
              </label>
              <div
                className="flex items-center gap-3 px-4 py-3 border-2 border-dashed border-amber-200/50 rounded-xl hover:border-amber-200 hover:bg-amber-50/30 transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <FileText size={18} className="text-gray-400 shrink-0" />
                <span className="text-sm text-gray-500 truncate">
                  {file ? file.name : 'Click to choose a PDF file'}
                </span>
                {file && (
                  <span className="ml-auto text-xs text-gray-400 shrink-0">
                    {formatFileSize(file.size)}
                  </span>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>

            {/* Title */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Checkout Cleaning Procedure"
                className="w-full bg-white/70 border border-amber-200/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-200"
              />
            </div>

            {/* Category */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as UploadCategory)}
                className="w-full bg-white/70 border border-amber-200/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-200"
              >
                {UPLOAD_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Description{' '}
                <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of what this SOP covers…"
                className="w-full bg-white/70 border border-amber-200/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-200 resize-none"
              />
            </div>

            {/* Success message */}
            {successMessage && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-green-50 border border-green-200">
                <span className="text-green-600 mt-0.5 shrink-0">✓</span>
                <p className="text-sm text-green-700">{successMessage}</p>
              </div>
            )}

            {/* Error message */}
            {uploadError && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
                <AlertCircle size={15} className="text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-700">{uploadError}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 mt-5 pt-4 border-t border-white/60">
            <Button variant="ghost" onClick={onClose} disabled={uploading}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleUpload}
              disabled={uploading || !file || !title.trim()}
            >
              {uploading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Uploading…
                </>
              ) : (
                <>
                  <Upload size={14} />
                  Upload SOP
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SOPLibraryPage() {
  const [documents, setDocuments] = useState<SOPDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [activeCategory, setActiveCategory] = useState<FilterCategory>('All')
  const [showQueryModal, setShowQueryModal] = useState(false)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SOPDocument | null>(null)
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Data fetching ──────────────────────────────────────────────────────────

  async function fetchDocuments(silent = false) {
    if (!silent) setLoading(true)
    setFetchError(null)
    try {
      const res = await sopApi.listDocuments()
      setDocuments(res.data ?? [])
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load SOP library.'
      if (!silent) setFetchError(msg)
    } finally {
      if (!silent) setLoading(false)
    }
  }

  // Initial load
  useEffect(() => {
    fetchDocuments()
  }, [])

  // Polling: re-fetch every 15s while any doc is pending/processing
  useEffect(() => {
    function maybeStartPolling() {
      const hasInProgress = documents.some(
        (d) => d.indexing_status === 'pending' || d.indexing_status === 'processing',
      )

      if (hasInProgress) {
        if (!pollingRef.current) {
          pollingRef.current = setInterval(() => {
            fetchDocuments(true)
          }, 15_000)
        }
      } else {
        if (pollingRef.current) {
          clearInterval(pollingRef.current)
          pollingRef.current = null
        }
      }
    }

    maybeStartPolling()
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [documents])

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      await sopApi.deleteDocument(id)
      setDocuments((prev) => prev.filter((d) => d.id !== id))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete document.'
      setNotice({ title: 'Delete failed', message: msg })
    } finally {
      setDeletingId(null)
      setDeleteTarget(null)
    }
  }

  function handleUploadSuccess(doc: SOPDocument) {
    setDocuments((prev) => [doc, ...prev])
  }

  // ── Filtering ─────────────────────────────────────────────────────────────

  const filteredDocuments =
    activeCategory === 'All'
      ? documents
      : documents.filter(
          (d) => (d.category ?? '').toLowerCase() === activeCategory.toLowerCase(),
        )

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2.5">
            <Library size={22} className="text-amber-600 shrink-0" />
            SOP Library
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Upload and search your hotel's standard operating procedures
          </p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <Button variant="secondary" onClick={() => setShowQueryModal(true)}>
            <span className="text-base leading-none">✦</span>
            Ask AI
          </Button>
          <Button variant="primary" onClick={() => setShowUploadModal(true)}>
            <Upload size={15} />
            Upload SOP
          </Button>
        </div>
      </div>

      {/* Category filter tabs */}
      <div className="flex items-center gap-1 border-b border-gray-200 overflow-x-auto pb-0 -mb-px">
        {CATEGORIES.map((cat) => {
          const isActive = activeCategory === cat
          const count =
            cat === 'All'
              ? documents.length
              : documents.filter(
                  (d) => (d.category ?? '').toLowerCase() === cat.toLowerCase(),
                ).length
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              aria-pressed={isActive}
              className={`relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                isActive
                  ? 'border-amber-200 text-amber-700'
                  : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
              }`}
            >
              {cat}
              {count > 0 && (
                <span
                  className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                    isActive ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Content area */}
      {loading ? (
        /* Skeleton grid */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : fetchError ? (
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <AlertCircle size={32} className="text-red-400 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-700 mb-1">Failed to load SOP library</p>
            <p className="text-xs text-gray-400 mb-4">{fetchError}</p>
            <Button variant="primary" onClick={() => fetchDocuments()}>
              Retry
            </Button>
          </div>
        </div>
      ) : filteredDocuments.length === 0 && documents.length === 0 ? (
        <EmptyState onUpload={() => setShowUploadModal(true)} />
      ) : filteredDocuments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <FileText size={28} className="text-gray-300 mb-3" />
          <p className="text-sm font-medium text-gray-500">
            No SOPs in the "{activeCategory}" category
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Try a different category or upload a new document.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDocuments.map((doc) => (
            <DocumentCard
              key={doc.id}
              doc={doc}
              onDeleteRequest={setDeleteTarget}
              onOpen={(target) =>
                setNotice({
                  title: target.title,
                  message: 'Full document viewer coming soon.',
                })
              }
              deleting={deletingId === doc.id}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      <SOPQueryModal isOpen={showQueryModal} onClose={() => setShowQueryModal(false)} />
      {deleteTarget && (
        <ConfirmDeleteDialog
          doc={deleteTarget}
          loading={deletingId === deleteTarget.id}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => handleDelete(deleteTarget.id)}
        />
      )}
      {notice && (
        <NoticeDialog
          title={notice.title}
          message={notice.message}
          onClose={() => setNotice(null)}
        />
      )}
      <UploadModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        onSuccess={handleUploadSuccess}
      />
    </div>
  )
}
