'use client'

import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { CheckCircle2, AlertCircle, Upload, X, FileText } from 'lucide-react'
import { format } from 'date-fns'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { Button, IconButton } from '@/components/ui/Button'
import { useModalFocusTrap } from '@/lib/hooks/useModalFocusTrap'

interface ImportResult {
  applied: number
  skipped_active: number
  not_found: number
  total_parsed: number
  warnings: string[]
}

interface Props {
  date?: string
  onClose: () => void
}

export function OccupancyImportModal({ date, onClose }: Props) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const today = date ?? format(new Date(), 'yyyy-MM-dd')

  const [tab, setTab] = useState<'hk-details' | 'task-sheet'>('hk-details')
  const [hkFile, setHkFile] = useState<File | null>(null)
  const [tsFile, setTsFile] = useState<File | null>(null)
  const [hkResult, setHkResult] = useState<ImportResult | null>(null)
  const [tsResult, setTsResult] = useState<ImportResult | null>(null)
  const [hkError, setHkError] = useState<string | null>(null)
  const [tsError, setTsError] = useState<string | null>(null)

  const hkInputRef = useRef<HTMLInputElement>(null)
  const tsInputRef = useRef<HTMLInputElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  useModalFocusTrap(modalRef, true, onClose)

  const hkMutation = useMutation({
    mutationFn: () => housekeepingApi.importHKDetails(hkFile!, today),
    onSuccess: (data: any) => {
      const d = data?.data ?? data
      setHkResult(d)
      setHkError(null)
      queryClient.invalidateQueries({ queryKey: ['housekeeping-board'] })
      queryClient.invalidateQueries({ queryKey: ['room-status'] })
    },
    onError: (err: any) => {
      setHkError(err?.response?.data?.detail ?? err.message ?? t('housekeeping.occupancyImport.importFailed'))
    },
  })

  const tsMutation = useMutation({
    mutationFn: () => housekeepingApi.importTaskSheet(tsFile!, today),
    onSuccess: (data: any) => {
      const d = data?.data ?? data
      setTsResult(d)
      setTsError(null)
      queryClient.invalidateQueries({ queryKey: ['housekeeping-board'] })
      queryClient.invalidateQueries({ queryKey: ['housekeeping-assignments'] })
      queryClient.invalidateQueries({ queryKey: ['room-status'] })
    },
    onError: (err: any) => {
      setTsError(err?.response?.data?.detail ?? err.message ?? t('housekeeping.occupancyImport.importFailed'))
    },
  })

  function handleHkFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) { setHkFile(f); setHkResult(null); setHkError(null) }
  }

  function handleTsFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) { setTsFile(f); setTsResult(null); setTsError(null) }
  }

  return (
    <div className="fixed inset-0 z-drawer flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="opera-import-title" className="bg-surface rounded-2xl shadow-2xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-line">
          <div>
            <h2 id="opera-import-title" className="text-base font-semibold text-ink">{t('housekeeping.occupancyImport.title')}</h2>
            <p className="text-xs text-ink3 mt-0.5">{today}</p>
          </div>
          <IconButton onClick={onClose} aria-label={t('housekeeping.occupancyImport.closeAria')}>
            <X className="w-5 h-5" />
          </IconButton>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-line">
          <button
            onClick={() => setTab('hk-details')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              tab === 'hk-details'
                ? 'text-[var(--caution)] border-b-2 border-[var(--caution)]'
                : 'text-ink3 hover:text-ink2'
            }`}
          >
            {t('housekeeping.occupancyImport.tabs.hkDetails')}
          </button>
          <button
            onClick={() => setTab('task-sheet')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              tab === 'task-sheet'
                ? 'text-[var(--caution)] border-b-2 border-[var(--caution)]'
                : 'text-ink3 hover:text-ink2'
            }`}
          >
            {t('housekeeping.occupancyImport.tabs.taskSheet')}
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {tab === 'hk-details' ? (
            <>
              <p className="text-xs text-ink3 leading-relaxed">
                {t('housekeeping.occupancyImport.uploadPrefix')}{' '}
                <span className="font-medium text-ink2">{t('housekeeping.occupancyImport.hkDetailsLabel')}</span>{' '}
                {t('housekeeping.occupancyImport.hkDetailsDescription')}
              </p>

              <DropZone
                file={hkFile}
                inputRef={hkInputRef}
                onChange={handleHkFile}
                label={t('housekeeping.occupancyImport.hkDropzoneLabel')}
                t={t}
              />

              {hkError && <ErrorBanner message={hkError} />}
              {hkResult && <ResultBanner result={hkResult} t={t} />}

              <Button
                onClick={() => hkMutation.mutate()}
                disabled={!hkFile || hkMutation.isPending}
                className="w-full"
              >
                {hkMutation.isPending ? t('housekeeping.occupancyImport.importing') : t('housekeeping.occupancyImport.applyHkDetails')}
              </Button>
            </>
          ) : (
            <>
              <p className="text-xs text-ink3 leading-relaxed">
                {t('housekeeping.occupancyImport.uploadPrefix')}{' '}
                <span className="font-medium text-ink2">{t('housekeeping.occupancyImport.taskSheetLabel')}</span>{' '}
                {t('housekeeping.occupancyImport.taskSheetDescription')}
              </p>

              <DropZone
                file={tsFile}
                inputRef={tsInputRef}
                onChange={handleTsFile}
                label={t('housekeeping.occupancyImport.taskSheetDropzoneLabel')}
                t={t}
              />

              {tsError && <ErrorBanner message={tsError} />}
              {tsResult && <ResultBanner result={tsResult} t={t} />}

              <Button
                onClick={() => tsMutation.mutate()}
                disabled={!tsFile || tsMutation.isPending}
                className="w-full"
              >
                {tsMutation.isPending ? t('housekeeping.occupancyImport.importing') : t('housekeeping.occupancyImport.applyTaskSheet')}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DropZone({
  file,
  inputRef,
  onChange,
  label,
  t,
}: {
  file: File | null
  inputRef: React.RefObject<HTMLInputElement>
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  label: string
  t: TFunction
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); inputRef.current?.click() } }}
      className="border-2 border-dashed border-line rounded-xl p-6 text-center cursor-pointer hover:border-[var(--caution-line)] hover:bg-[var(--caution-soft)]/30 transition-colors"
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={onChange}
      />
      {file ? (
        <div className="flex items-center justify-center gap-2 text-sm text-ink2">
          <FileText className="w-5 h-5 text-[var(--caution)]" />
          <span className="font-medium">{file.name}</span>
          <span className="text-ink3">{t('housekeeping.occupancyImport.dropzone.sizeKb', { size: (file.size / 1024).toFixed(0) })}</span>
        </div>
      ) : (
        <div className="text-ink3">
          <Upload className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">{label}</p>
          <p className="text-xs mt-1">{t('housekeeping.occupancyImport.dropzone.orClickToBrowse')}</p>
        </div>
      )}
    </div>
  )
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex gap-2 items-start bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-lg p-3">
      <AlertCircle className="w-4 h-4 text-[var(--alert)] mt-0.5 shrink-0" />
      <p className="text-xs text-[var(--alert)]">{message}</p>
    </div>
  )
}

function ResultBanner({ result, t }: { result: ImportResult; t: TFunction }) {
  return (
    <div className="bg-[var(--ready-soft)] border border-[var(--ready-line)] rounded-lg p-3 space-y-1.5">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-[var(--ready)] shrink-0" />
        <p className="text-sm font-medium text-[var(--ready)]">
          {t('housekeeping.occupancyImport.result.summary', { applied: result.applied, total: result.total_parsed })}
        </p>
      </div>
      <div className="text-xs text-[var(--ready)] space-y-0.5 pl-6">
        {result.skipped_active > 0 && (
          <p>{t(result.skipped_active !== 1 ? 'housekeeping.occupancyImport.result.skippedActiveOther' : 'housekeeping.occupancyImport.result.skippedActiveOne', { count: result.skipped_active })}</p>
        )}
        {result.not_found > 0 && (
          <p>{t(result.not_found !== 1 ? 'housekeeping.occupancyImport.result.notFoundOther' : 'housekeeping.occupancyImport.result.notFoundOne', { count: result.not_found })}</p>
        )}
      </div>
      {result.warnings.length > 0 && (
        <div className="pl-6 space-y-0.5">
          {result.warnings.slice(0, 3).map((w, i) => (
            <p key={i} className="text-xs text-[var(--caution)]">{w}</p>
          ))}
          {result.warnings.length > 3 && (
            <p className="text-xs text-ink3">{t('housekeeping.occupancyImport.result.moreWarnings', { count: result.warnings.length - 3 })}</p>
          )}
        </div>
      )}
    </div>
  )
}
