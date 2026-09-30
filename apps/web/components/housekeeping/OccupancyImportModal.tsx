'use client'

import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertCircle, ArrowLeft, CheckCircle2, FileText, Upload, X } from 'lucide-react'
import { format } from 'date-fns'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { Button, IconButton } from '@/components/ui/Button'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'

type ImportKind = 'hk-details' | 'task-sheet'
const IMPORT_TABS: ImportKind[] = ['hk-details', 'task-sheet']
interface ImportPreview { total_parsed: number; will_update: number; unchanged: number; not_found: number; skipped_active: number; warnings: string[]; changes: Array<{ room_id: string; room_number: string; changes: Array<{ field: string; before: unknown; after: unknown }> }> }
interface ImportResult { applied: number; skipped_active: number; not_found: number; total_parsed: number; warnings: string[] }

export function OccupancyImportModal({ date, onClose }: { date?: string; onClose: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const today = date ?? format(new Date(), 'yyyy-MM-dd')
  const [tab, setTab] = useState<ImportKind>('hk-details')
  const [hkFile, setHkFile] = useState<File | null>(null)
  const [tsFile, setTsFile] = useState<File | null>(null)
  const [hkPreview, setHkPreview] = useState<ImportPreview | null>(null)
  const [tsPreview, setTsPreview] = useState<ImportPreview | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const hkInputRef = useRef<HTMLInputElement>(null)
  const tsInputRef = useRef<HTMLInputElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  useModalFocusTrap(modalRef, true, onClose)
  const activeFile = tab === 'hk-details' ? hkFile : tsFile
  const preview = tab === 'hk-details' ? hkPreview : tsPreview
  const setPreview = (value: ImportPreview | null) => tab === 'hk-details' ? setHkPreview(value) : setTsPreview(value)
  const previewMutation = useMutation({
    mutationFn: () => tab === 'hk-details' ? housekeepingApi.previewHKDetails(activeFile!, today) : housekeepingApi.previewTaskSheet(activeFile!, today),
    onSuccess: (response: any) => { setPreview(response?.data ?? response); setError(null); setResult(null) },
    onError: (err: any) => setError(err?.response?.data?.detail ?? err.message ?? t('housekeeping.occupancyImport.importFailed')),
  })
  const applyMutation = useMutation({
    mutationFn: () => tab === 'hk-details' ? housekeepingApi.importHKDetails(activeFile!, today) : housekeepingApi.importTaskSheet(activeFile!, today),
    onSuccess: (response: any) => { setResult(response?.data ?? response); setError(null); queryClient.invalidateQueries({ queryKey: ['housekeeping-board'] }); queryClient.invalidateQueries({ queryKey: ['room-status'] }); queryClient.invalidateQueries({ queryKey: ['my-rooms'] }); if (tab === 'task-sheet') queryClient.invalidateQueries({ queryKey: ['housekeeping-assignments'] }) },
    onError: (err: any) => setError(err?.response?.data?.detail ?? err.message ?? t('housekeeping.occupancyImport.importFailed')),
  })
  function chooseFile(kind: ImportKind, file?: File) {
    if (!file) return
    if (file.type && file.type !== 'application/pdf') { setError(t('housekeeping.occupancyImport.invalidFile')); return }
    if (file.size > 20 * 1024 * 1024) { setError(t('housekeeping.occupancyImport.fileTooLarge')); return }
    if (kind === 'hk-details') { setHkFile(file); setHkPreview(null) } else { setTsFile(file); setTsPreview(null) }
    setError(null); setResult(null)
  }
  return <div className="fixed inset-0 z-drawer flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"><div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="opera-import-title" className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-surface shadow-2xl">
    <header className="flex items-center justify-between border-b border-line px-6 pb-4 pt-5"><div><h2 id="opera-import-title" className="text-base font-semibold text-ink">{preview ? t('housekeeping.occupancyImport.previewTitle') : t('housekeeping.occupancyImport.title')}</h2><p className="mt-0.5 text-xs text-ink3">{today}</p></div><IconButton onClick={onClose} aria-label={t('housekeeping.occupancyImport.closeAria')}><X className="h-5 w-5" /></IconButton></header>
    {!preview && (
      <nav className="flex border-b border-line" aria-label={t('housekeeping.occupancyImport.title')}>
        {IMPORT_TABS.map((kind) => (
          <button key={kind} type="button" onClick={() => { setTab(kind); setError(null); setResult(null) }} className={tab === kind ? 'flex-1 border-b-2 border-[var(--caution)] py-3 text-sm font-medium text-[var(--caution)]' : 'flex-1 py-3 text-sm font-medium text-ink3 hover:text-ink2'}>
            {t(kind === 'hk-details' ? 'housekeeping.occupancyImport.tabs.hkDetails' : 'housekeeping.occupancyImport.tabs.taskSheet')}
          </button>
        ))}
      </nav>
    )}
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{preview ? <PreviewContent preview={preview} t={t} /> : <UploadContent tab={tab} file={activeFile} inputRef={tab === 'hk-details' ? hkInputRef : tsInputRef} onFile={(file) => chooseFile(tab, file)} t={t} />}{error && <ErrorBanner message={error} />}{result && <ResultBanner result={result} t={t} />}</div>
    <footer className="flex justify-end gap-2 border-t border-line px-6 py-4">{preview ? <><Button variant="ghost" onClick={() => { setPreview(null); setError(null) }} disabled={applyMutation.isPending}><ArrowLeft className="h-4 w-4" />{t('common.back')}</Button><Button variant="primary" loading={applyMutation.isPending} onClick={() => applyMutation.mutate()}>{t('housekeeping.occupancyImport.applyUpdates', { count: preview.will_update })}</Button></> : <Button variant="primary" disabled={!activeFile || previewMutation.isPending} loading={previewMutation.isPending} onClick={() => previewMutation.mutate()}>{t('housekeeping.occupancyImport.previewImport')}</Button>}</footer>
  </div></div>
}

function UploadContent({ tab, file, inputRef, onFile, t }: { tab: ImportKind; file: File | null; inputRef: React.RefObject<HTMLInputElement>; onFile: (file?: File) => void; t: any }) {
  const label = tab === 'hk-details' ? t('housekeeping.occupancyImport.hkDropzoneLabel') : t('housekeeping.occupancyImport.taskSheetDropzoneLabel')
  const description = tab === 'hk-details' ? t('housekeeping.occupancyImport.hkDetailsDescription') : t('housekeeping.occupancyImport.taskSheetDescription')
  const inputId = `opera-${tab}-file`
  return <><p className="mb-4 text-xs leading-relaxed text-ink3">{description}</p><label htmlFor={inputId} className="block cursor-pointer rounded-xl border-2 border-dashed border-line p-6 text-center transition-colors hover:border-[var(--caution-line)] hover:bg-[var(--caution-soft)]/30 focus-within:ring-2 focus-within:ring-[var(--accent)]"><input ref={inputRef} id={inputId} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(event) => onFile(event.target.files?.[0])} />{file ? <div className="flex items-center justify-center gap-2 text-sm text-ink2"><FileText className="h-5 w-5 text-[var(--caution)]" /><span className="font-medium">{file.name}</span><span className="text-ink3">{t('housekeeping.occupancyImport.dropzone.sizeKb', { size: (file.size / 1024).toFixed(0) })}</span></div> : <div className="text-ink3"><Upload className="mx-auto mb-2 h-8 w-8 opacity-50" /><p className="text-sm">{label}</p><p className="mt-1 text-xs">{t('housekeeping.occupancyImport.dropzone.orClickToBrowse')}</p></div>}</label><p className="mt-3 text-xs text-ink3" aria-live="polite">{file ? t('housekeeping.occupancyImport.fileSelected', { name: file.name }) : ''}</p></>
}

function PreviewContent({ preview, t }: { preview: ImportPreview; t: any }) { return <div className="space-y-5"><div><p className="text-2xl font-semibold text-ink">{t('housekeeping.occupancyImport.roomsParsed', { count: preview.total_parsed })}</p><div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4"><Metric label={t('housekeeping.occupancyImport.willUpdate')} value={preview.will_update} /><Metric label={t('housekeeping.occupancyImport.unchanged')} value={preview.unchanged} /><Metric label={t('housekeeping.occupancyImport.notMatched')} value={preview.not_found} /><Metric label={t('housekeeping.occupancyImport.skippedActive')} value={preview.skipped_active} /></div></div>{preview.warnings.length > 0 && <section><h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink3">{t('housekeeping.occupancyImport.warnings')}</h3><ul className="mt-2 space-y-1 rounded-lg border border-[var(--caution-line)] bg-[var(--caution-soft)]/30 p-3 text-sm text-ink2">{preview.warnings.slice(0, 12).map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></section>}{preview.changes.length > 0 && <section><h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink3">{t('housekeeping.occupancyImport.changes')}</h3><div className="mt-2 divide-y divide-line rounded-lg border border-line">{preview.changes.slice(0, 20).map((room) => <div key={room.room_id} className="p-3"><p className="font-mono text-sm font-semibold text-ink">{room.room_number}</p>{room.changes.map((change) => <p key={change.field} className="mt-1 text-xs text-ink2">{t(`housekeeping.occupancyImport.fields.${change.field}`)}: <span className="text-ink3">{display(change.before, t)}</span> → {display(change.after, t)}</p>)}</div>)}</div>{preview.changes.length > 20 && <p className="mt-2 text-xs text-ink3">{t('housekeeping.occupancyImport.moreChanges', { count: preview.changes.length - 20 })}</p>}</section>}</div> }
function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-lg bg-surface-2 p-2.5"><p className="font-mono text-lg font-semibold text-ink">{value}</p><p className="text-xs text-ink3">{label}</p></div> }
function display(value: unknown, t: any) { return value == null || value === '' ? t('housekeeping.occupancyImport.emptyValue') : String(value).replaceAll('_', ' ') }
function ErrorBanner({ message }: { message: string }) { return <div role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-[var(--alert-line)] bg-[var(--alert-soft)] p-3"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--alert)]" /><p className="text-xs text-[var(--alert)]">{message}</p></div> }
function ResultBanner({ result, t }: { result: ImportResult; t: any }) { return <div role="status" className="mt-4 rounded-lg border border-[var(--ready-line)] bg-[var(--ready-soft)] p-3"><div className="flex gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--ready)]" /><p className="text-sm font-medium text-[var(--ready)]">{t('housekeeping.occupancyImport.result.summary', { applied: result.applied, total: result.total_parsed })}</p></div>{(result.skipped_active > 0 || result.not_found > 0) && <p className="mt-1 pl-6 text-xs text-ink2">{t('housekeeping.occupancyImport.result.details', { skipped: result.skipped_active, notFound: result.not_found })}</p>}</div> }
