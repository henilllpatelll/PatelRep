'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Upload, Trash2, FileText, AlertCircle, Loader2, X, Search, MessageSquare, Plus,
} from 'lucide-react'
import { sopApi, SOPDocument } from '@/lib/api/sop'
import { SOPQueryModal } from '@/components/ai/SOPQueryModal'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { AILabel, Mono, Pill } from '@/components/ui/primitives'

const CATEGORIES = ['All', 'Housekeeping', 'Engineering', 'HR', 'Emergency', 'General'] as const
type FilterCategory = (typeof CATEGORIES)[number]
const UPLOAD_CATEGORIES = ['Housekeeping', 'Engineering', 'HR', 'Emergency', 'General', 'Other'] as const
type UploadCategory = (typeof UPLOAD_CATEGORIES)[number]

function SparkIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 0l3 9 9 3-9 3-3 9-3-9-9-3 9-3z"/>
    </svg>
  )
}

function formatRelativeDate(isoString: string): string {
  const now = Date.now()
  const then = new Date(isoString).getTime()
  const diffMs = now - then
  const diffMin = Math.floor(diffMs / 60_000)
  const diffHr = Math.floor(diffMs / 3_600_000)
  const diffDay = Math.floor(diffMs / 86_400_000)
  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDay === 1) return 'Yesterday'
  if (diffDay < 7) return `${diffDay}d ago`
  if (diffDay < 30) return `${Math.floor(diffDay / 7)}w ago`
  if (diffDay < 365) return `${Math.floor(diffDay / 30)}mo ago`
  return `${Math.floor(diffDay / 365)}y ago`
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function StatusBadge({ status }: { status: SOPDocument['indexing_status'] }) {
  const map: Record<SOPDocument['indexing_status'], { tone: 'ready' | 'caution' | 'alert' | 'neutral'; label: string; pulse?: boolean }> = {
    pending:    { tone: 'neutral', label: 'Pending' },
    processing: { tone: 'caution', label: 'Processing…', pulse: true },
    indexed:    { tone: 'ready', label: 'Indexed' },
    failed:     { tone: 'alert', label: 'Failed' },
  }
  const { tone, label, pulse } = map[status] ?? { tone: 'neutral' as const, label: status }
  return <Pill tone={tone} size="sm" className={pulse ? 'animate-pulse' : ''}>{label}</Pill>
}

function SkeletonCard() {
  return (
    <div className="bg-surface border border-line rounded-[var(--r-lg)] p-4 animate-pulse">
      <div className="h-4 bg-surface-3 rounded w-3/4 mb-3" />
      <div className="h-3 bg-surface-3 rounded w-1/3 mb-4" />
      <div className="h-3 bg-surface-3 rounded w-full mb-2" />
      <div className="flex items-center justify-between">
        <div className="h-5 bg-surface-3 rounded w-16" />
        <div className="h-3 bg-surface-3 rounded w-20" />
      </div>
    </div>
  )
}

function EmptyState({ onUpload }: { onUpload: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <div className="w-16 h-16 rounded-[var(--r-lg)] bg-surface-3 flex items-center justify-center mb-4">
        <FileText size={28} className="text-ink4" />
      </div>
      <p className="text-base font-semibold text-ink mb-1">No SOPs uploaded yet</p>
      <p className="text-sm text-ink3 mb-5 max-w-xs">
        Upload your hotel's standard operating procedures to make them searchable with AI.
      </p>
      <button onClick={onUpload}
        className="flex min-h-[44px] items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-accent rounded-[var(--r-md)] hover:opacity-90 transition-opacity">
        <Upload size={15} /> Upload your first SOP
      </button>
      <div className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-3 text-left sm:grid-cols-3">
        {['Room turns', 'Emergency calls', 'PM checklists'].map((item) => (
          <div key={item} className="rounded-[var(--r-lg)] border border-line bg-surface-2 px-4 py-3">
            <p className="text-sm font-semibold text-ink">{item}</p>
            <p className="mt-1 text-xs text-ink3">Good first upload</p>
          </div>
        ))}
      </div>
    </div>
  )
}

interface DocumentCardProps {
  doc: SOPDocument
  onDeleteRequest: (doc: SOPDocument) => void
  onOpen: (doc: SOPDocument) => void
  deleting: boolean
  isSelected: boolean
  referenceTime: number | null
}

function DocumentCard({ doc, onDeleteRequest, onOpen, deleting, isSelected, referenceTime }: DocumentCardProps) {
  const isStale = doc.indexing_status === 'indexed' && referenceTime != null && (() => {
    const diffDay = Math.floor((referenceTime - new Date(doc.updated_at ?? doc.created_at).getTime()) / 86_400_000)
    return diffDay > 90
  })()

  return (
    <div
      onClick={() => onOpen(doc)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(doc) } }}
      role="button"
      tabIndex={0}
      className={`cursor-pointer group focus:outline-none focus:ring-2 focus:ring-accent rounded-[var(--r-lg)] ${isSelected ? 'ring-2 ring-accent' : ''}`}
    >
      <div className={`border rounded-[var(--r-lg)] p-4 transition-shadow hover:shadow-sm ${isSelected ? 'bg-accent-soft border-accent-line' : 'bg-surface border-line'}`}>
        <div className="flex items-start gap-2.5 mb-2">
          <div className="shrink-0 mt-0.5 w-8 h-8 rounded-[var(--r-md)] bg-surface-2 border border-line flex items-center justify-center">
            <FileText size={15} className="text-ink3" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-medium text-ink leading-tight truncate">{doc.title}</p>
            {doc.category && (
              <div className="mt-1">
                <Pill tone="neutral" size="sm">{doc.category}</Pill>
              </div>
            )}
          </div>
        </div>

        {isStale && (
          <div className="flex items-center gap-1.5 text-[11px] text-ai bg-ai-soft border border-ai-line px-2 py-1 rounded mb-2 w-fit">
            <SparkIcon size={9} /> AI suggests refresh
          </div>
        )}

        <div className="flex items-center justify-between gap-2 mt-2">
          <div className="flex items-center gap-2 min-w-0">
            <StatusBadge status={doc.indexing_status} />
            {doc.page_count !== null && (
              <span className="text-[11px] text-ink3">{doc.page_count}p</span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[11px] text-ink3 font-mono">{formatRelativeDate(doc.created_at)}</span>
            <button
              onClick={(e) => { e.stopPropagation(); onDeleteRequest(doc) }}
              disabled={deleting}
              aria-label={`Delete ${doc.title}`}
              className="p-1 rounded text-ink4 hover:text-alert hover:bg-alert-soft transition-colors disabled:opacity-50"
            >
              {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ConfirmDeleteDialog({ doc, loading, onCancel, onConfirm }: {
  doc: SOPDocument; loading: boolean; onCancel: () => void; onConfirm: () => void
}) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape' && !loading) onCancel() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [loading, onCancel])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/20 backdrop-blur-sm" onClick={!loading ? onCancel : undefined} />
      <div role="dialog" aria-modal="true" aria-labelledby="delete-sop-title" className="relative w-full max-w-md rounded-[var(--r-lg)] border border-line bg-surface/90 p-6 shadow-[var(--shadow-pop)] backdrop-blur-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="delete-sop-title" className="text-base font-semibold text-ink">Delete SOP?</h2>
            <p className="mt-2 text-sm text-ink2">Delete "{doc.title}" from the library. This cannot be undone.</p>
          </div>
          <button type="button" onClick={onCancel} disabled={loading} aria-label="Close" className="rounded-[var(--r-md)] p-1.5 text-ink3 hover:bg-surface-3 hover:text-ink2 transition-colors disabled:opacity-50">
            <X size={18} />
          </button>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={loading}>Cancel</Button>
          <Button type="button" variant="secondary" onClick={onConfirm} disabled={loading} className="border-[var(--alert-line)] bg-[var(--alert-soft)] text-[var(--alert)] hover:bg-[var(--alert-soft)]">
            {loading && <Loader2 size={13} className="animate-spin" />} Delete
          </Button>
        </div>
      </div>
    </div>
  )
}

function NoticeDialog({ title, message, onClose }: { title: string; message: string; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/20 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="sop-notice-title" className="relative w-full max-w-sm rounded-[var(--r-lg)] border border-line bg-surface/90 p-6 shadow-[var(--shadow-pop)] backdrop-blur-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="sop-notice-title" className="text-base font-semibold text-ink">{title}</h2>
            <p className="mt-2 text-sm text-ink2">{message}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-[var(--r-md)] p-1.5 text-ink3 hover:bg-surface-3 hover:text-ink2 transition-colors">
            <X size={18} />
          </button>
        </div>
        <Button type="button" variant="primary" onClick={onClose} className="mt-6 w-full justify-center">OK</Button>
      </div>
    </div>
  )
}

interface UploadModalProps { isOpen: boolean; onClose: () => void; onSuccess: (doc: SOPDocument) => void }

function UploadModal({ isOpen, onClose, onSuccess }: UploadModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<UploadCategory>('General')
  const [description, setDescription] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) { if (e.key === 'Escape' && !uploading) onClose() }
    if (isOpen) document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, uploading, onClose])

  useEffect(() => {
    if (isOpen) { setFile(null); setTitle(''); setCategory('General'); setDescription(''); setUploading(false); setUploadError(null); setSuccessMessage(null) }
  }, [isOpen])

  if (!isOpen) return null

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    setFile(f)
    if (f && !title) setTitle(f.name.replace(/\.pdf$/i, '').replace(/[-_]/g, ' '))
  }

  async function handleUpload() {
    if (!file) return
    const cleanTitle = title.trim()
    if (!cleanTitle) { setUploadError('Title is required.'); return }
    setUploading(true); setUploadError(null); setSuccessMessage(null)
    const formData = new FormData()
    formData.append('file', file); formData.append('title', cleanTitle); formData.append('category', category)
    if (description.trim()) formData.append('description', description.trim())
    try {
      const res = await sopApi.uploadDocument(formData)
      setSuccessMessage('Uploaded! Indexing in background.')
      onSuccess(res.data)
      setTimeout(() => onClose(), 1800)
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-ink/20 backdrop-blur-sm z-50" onClick={!uploading ? onClose : undefined} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div role="dialog" aria-modal="true" aria-label="Upload SOP document"
          className="bg-surface/90 backdrop-blur-2xl border border-line rounded-[var(--r-lg)] shadow-[var(--shadow-pop)] w-full max-w-lg p-6"
          onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base font-semibold text-ink">Upload SOP Document</h2>
            {!uploading && (
              <button onClick={onClose} className="p-1.5 rounded-[var(--r-md)] text-ink3 hover:text-ink hover:bg-surface-3 transition-colors" aria-label="Close modal">
                <X size={18} />
              </button>
            )}
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-ink2 mb-1.5">PDF File <span className="text-alert">*</span></label>
              <div onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-3 px-4 py-3 border border-dashed border-line rounded-[var(--r-md)] hover:border-accent hover:bg-accent-soft/30 transition-colors cursor-pointer">
                <FileText size={17} className="text-ink3 shrink-0" />
                <span className="text-sm text-ink3 truncate">{file ? file.name : 'Click to choose a PDF file'}</span>
                {file && <span className="ml-auto text-xs text-ink3 shrink-0">{formatFileSize(file.size)}</span>}
              </div>
              <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={handleFileChange} />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink2 mb-1.5">Title <span className="text-alert">*</span></label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Checkout Cleaning Procedure"
                className="w-full bg-surface border border-line rounded-[var(--r-md)] px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent" />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink2 mb-1.5">Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value as UploadCategory)}
                className="w-full bg-surface border border-line rounded-[var(--r-md)] px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent">
                {UPLOAD_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-ink2 mb-1.5">Description <span className="text-ink3 font-normal">(optional)</span></label>
              <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of what this SOP covers…"
                className="w-full bg-surface border border-line rounded-[var(--r-md)] px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent resize-none" />
            </div>
            {successMessage && (
              <div className="flex items-start gap-2 p-3 rounded-[var(--r-md)] bg-[var(--ready-soft)] border border-[var(--ready-line)]">
                <p className="text-sm text-[var(--ready)]">{successMessage}</p>
              </div>
            )}
            {uploadError && (
              <div className="flex items-start gap-2 p-3 rounded-[var(--r-md)] bg-[var(--alert-soft)] border border-[var(--alert-line)]">
                <AlertCircle size={15} className="text-alert mt-0.5 shrink-0" />
                <p className="text-sm text-alert">{uploadError}</p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 mt-5 pt-4 border-t border-line">
            <Button variant="ghost" onClick={onClose} disabled={uploading}>Cancel</Button>
            <Button variant="primary" onClick={handleUpload} disabled={uploading || !file || !title.trim()}>
              {uploading ? <><Loader2 size={14} className="animate-spin" /> Uploading&hellip;</> : <><Upload size={14} /> Upload SOP</>}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}

export default function SOPLibraryPage() {
  const [documents, setDocuments] = useState<SOPDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [activeCategory, setActiveCategory] = useState<FilterCategory>('All')
  const [search, setSearch] = useState('')
  const [selectedDoc, setSelectedDoc] = useState<SOPDocument | null>(null)
  const [showQueryModal, setShowQueryModal] = useState(false)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SOPDocument | null>(null)
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null)
  const [referenceTime, setReferenceTime] = useState<number | null>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

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

  useEffect(() => { fetchDocuments() }, [])
  useEffect(() => { setReferenceTime(Date.now()) }, [])

  useEffect(() => {
    const hasInProgress = documents.some((d) => d.indexing_status === 'pending' || d.indexing_status === 'processing')
    if (hasInProgress) {
      if (!pollingRef.current) pollingRef.current = setInterval(() => fetchDocuments(true), 15_000)
    } else {
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null }
    }
    return () => { if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null } }
  }, [documents])

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      await sopApi.deleteDocument(id)
      setDocuments((prev) => prev.filter((d) => d.id !== id))
      if (selectedDoc?.id === id) setSelectedDoc(null)
    } catch (err: unknown) {
      setNotice({ title: 'Delete failed', message: err instanceof Error ? err.message : 'Failed to delete document.' })
    } finally {
      setDeletingId(null)
      setDeleteTarget(null)
    }
  }

  function handleUploadSuccess(doc: SOPDocument) {
    setDocuments((prev) => [doc, ...prev])
  }

  const filteredDocuments = documents
    .filter((d) => activeCategory === 'All' || (d.category ?? '').toLowerCase() === activeCategory.toLowerCase())
    .filter((d) => !search.trim() || d.title.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between px-5 py-4 border-b border-line shrink-0">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">Intelligence</p>
            <h1 className="font-display text-[24px] leading-none text-ink font-normal tracking-[-0.2px]">SOP Library</h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowQueryModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-ai-soft text-ai border border-ai-line text-[12.5px] font-medium rounded-[var(--r-md)] hover:opacity-80 transition-opacity">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 0l3 9 9 3-9 3-3 9-3-9-9-3 9-3z"/></svg>
              Ask AI
            </button>
            <button onClick={() => setShowUploadModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-[12.5px] font-medium rounded-[var(--r-md)] hover:opacity-90 transition-opacity">
              <Plus size={13} /> New SOP
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1 px-5 border-b border-line overflow-x-auto shrink-0">
          {CATEGORIES.map((cat) => {
            const isActive = activeCategory === cat
            const count = cat === 'All' ? documents.length : documents.filter((d) => (d.category ?? '').toLowerCase() === cat.toLowerCase()).length
            return (
              <button key={cat} onClick={() => setActiveCategory(cat)} aria-pressed={isActive}
                className={`relative flex items-center gap-1.5 px-3.5 py-2.5 text-[12.5px] font-medium whitespace-nowrap border-b-2 transition-colors ${isActive ? 'border-accent text-accent' : 'border-transparent text-ink3 hover:text-ink hover:border-line'}`}>
                {cat}
                {count > 0 && (
                  <span className={`text-[11px] px-1.5 py-px rounded-full font-medium ${isActive ? 'bg-accent-soft text-accent' : 'bg-surface-3 text-ink3'}`}>{count}</span>
                )}
              </button>
            )
          })}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="flex items-center gap-2 border border-line rounded-[var(--r-md)] px-3 py-2 mb-4 bg-surface">
            <Search size={13} className="text-ink3 shrink-0" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title, category, or keyword…"
              className="flex-1 bg-transparent border-none outline-none text-[13px] text-ink placeholder:text-ink3" />
            <Mono className="text-[10px] text-ink3 bg-surface-2 px-1.5 py-px rounded border border-line">⌘K</Mono>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : fetchError ? (
            <div className="flex items-center justify-center py-16 text-center">
              <div>
                <AlertCircle size={32} className="text-alert mx-auto mb-3" />
                <p className="text-sm font-medium text-ink mb-1">Failed to load SOP library</p>
                <p className="text-xs text-ink3 mb-4">{fetchError}</p>
                <Button variant="primary" onClick={() => fetchDocuments()}>Retry</Button>
              </div>
            </div>
          ) : filteredDocuments.length === 0 && documents.length === 0 ? (
            <EmptyState onUpload={() => setShowUploadModal(true)} />
          ) : filteredDocuments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <FileText size={28} className="text-ink4 mb-3" />
              <p className="text-sm font-medium text-ink3">No SOPs match your search</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filteredDocuments.map((doc) => (
                <DocumentCard key={doc.id} doc={doc}
                  onDeleteRequest={setDeleteTarget}
                  onOpen={(target) => setSelectedDoc(prev => prev?.id === target.id ? null : target)}
                  deleting={deletingId === doc.id}
                  isSelected={selectedDoc?.id === doc.id}
                  referenceTime={referenceTime}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedDoc && (
        <div className="w-[340px] shrink-0 border-l border-line flex flex-col overflow-hidden">
          <div className="px-4 py-3.5 border-b border-line">
            <div className="flex items-center gap-2 mb-2">
              <StatusBadge status={selectedDoc.indexing_status} />
              <Mono className="text-[11px] text-ink3">{formatRelativeDate(selectedDoc.created_at)}</Mono>
            </div>
            <h2 className="font-display text-[20px] leading-tight text-ink font-normal">{selectedDoc.title}</h2>
            <div className="flex gap-2 mt-1 text-[12px] text-ink3">
              {selectedDoc.category && <span>{selectedDoc.category}</span>}
              {selectedDoc.page_count !== null && <span>·{selectedDoc.page_count} pages</span>}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {selectedDoc.description && (
              <p className="text-[13px] text-ink2 leading-relaxed">{selectedDoc.description}</p>
            )}

            <div className="bg-ai-soft border border-ai-line rounded-[var(--r-md)] p-3.5">
              <AILabel className="mb-1.5">AI insight</AILabel>
              <p className="font-display italic text-[14px] leading-[1.4] text-ink mt-1.5">
                This SOP is indexed and available for AI-grounded answers. Ask the copilot any procedural question and get the right answer with a citation.
              </p>
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={() => setShowQueryModal(true)}
                className="flex items-center gap-1.5 px-3 py-2 border border-line text-[12.5px] text-ink2 rounded-[var(--r-md)] hover:bg-surface-2 transition-colors">
                <MessageSquare size={13} /> Ask AI about this SOP
              </button>
            </div>
          </div>
        </div>
      )}

      <SOPQueryModal isOpen={showQueryModal} onClose={() => setShowQueryModal(false)} />
      {deleteTarget && (
        <ConfirmDeleteDialog doc={deleteTarget} loading={deletingId === deleteTarget.id}
          onCancel={() => setDeleteTarget(null)} onConfirm={() => handleDelete(deleteTarget.id)} />
      )}
      {notice && <NoticeDialog title={notice.title} message={notice.message} onClose={() => setNotice(null)} />}
      <UploadModal isOpen={showUploadModal} onClose={() => setShowUploadModal(false)} onSuccess={handleUploadSuccess} />
    </div>
  )
}
