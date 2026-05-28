'use client'

import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, AlertCircle, Upload, X, FileText } from 'lucide-react'
import { format } from 'date-fns'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { Button } from '@/components/ui/Button'

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
      setHkError(err?.response?.data?.detail ?? err.message ?? 'Import failed')
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
      setTsError(err?.response?.data?.detail ?? err.message ?? 'Import failed')
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-stone-100">
          <div>
            <h2 className="text-base font-semibold text-stone-800">Import from Opera</h2>
            <p className="text-xs text-stone-500 mt-0.5">{today}</p>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-stone-100">
          <button
            onClick={() => setTab('hk-details')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              tab === 'hk-details'
                ? 'text-amber-700 border-b-2 border-amber-500'
                : 'text-stone-500 hover:text-stone-700'
            }`}
          >
            1. HK Details
          </button>
          <button
            onClick={() => setTab('task-sheet')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              tab === 'task-sheet'
                ? 'text-amber-700 border-b-2 border-amber-500'
                : 'text-stone-500 hover:text-stone-700'
            }`}
          >
            2. Task Sheet
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {tab === 'hk-details' ? (
            <>
              <p className="text-xs text-stone-500 leading-relaxed">
                Upload the <span className="font-medium text-stone-700">Opera HK Details</span> report to reset
                today&apos;s room status — sets Clean rooms to OOO, Dirty Occupied to Dirty, Departure rooms to Dirty,
                and preserves any rooms currently in progress.
              </p>

              <DropZone
                file={hkFile}
                inputRef={hkInputRef}
                onChange={handleHkFile}
                label="Drop HK Details PDF here"
              />

              {hkError && <ErrorBanner message={hkError} />}
              {hkResult && <ResultBanner result={hkResult} />}

              <Button
                onClick={() => hkMutation.mutate()}
                disabled={!hkFile || hkMutation.isPending}
                className="w-full"
              >
                {hkMutation.isPending ? 'Importing…' : 'Apply HK Details'}
              </Button>
            </>
          ) : (
            <>
              <p className="text-xs text-stone-500 leading-relaxed">
                Upload the <span className="font-medium text-stone-700">Opera Task Sheet</span> to assign clean types —
                Full/Light service stayover rooms become Pickup, Departure rooms stay Dirty with DEP clean type.
                Import HK Details first before running this step.
              </p>

              <DropZone
                file={tsFile}
                inputRef={tsInputRef}
                onChange={handleTsFile}
                label="Drop Task Sheet PDF here"
              />

              {tsError && <ErrorBanner message={tsError} />}
              {tsResult && <ResultBanner result={tsResult} />}

              <Button
                onClick={() => tsMutation.mutate()}
                disabled={!tsFile || tsMutation.isPending}
                className="w-full"
              >
                {tsMutation.isPending ? 'Importing…' : 'Apply Task Sheet'}
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
}: {
  file: File | null
  inputRef: React.RefObject<HTMLInputElement>
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  label: string
}) {
  return (
    <div
      onClick={() => inputRef.current?.click()}
      className="border-2 border-dashed border-stone-200 rounded-xl p-6 text-center cursor-pointer hover:border-amber-400 hover:bg-amber-50/30 transition-colors"
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={onChange}
      />
      {file ? (
        <div className="flex items-center justify-center gap-2 text-sm text-stone-700">
          <FileText className="w-5 h-5 text-amber-600" />
          <span className="font-medium">{file.name}</span>
          <span className="text-stone-400">({(file.size / 1024).toFixed(0)} KB)</span>
        </div>
      ) : (
        <div className="text-stone-400">
          <Upload className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">{label}</p>
          <p className="text-xs mt-1">or click to browse</p>
        </div>
      )}
    </div>
  )
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex gap-2 items-start bg-red-50 border border-red-200 rounded-lg p-3">
      <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
      <p className="text-xs text-red-700">{message}</p>
    </div>
  )
}

function ResultBanner({ result }: { result: ImportResult }) {
  return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 space-y-1.5">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
        <p className="text-sm font-medium text-emerald-800">
          {result.applied} of {result.total_parsed} rooms updated
        </p>
      </div>
      <div className="text-xs text-emerald-700 space-y-0.5 pl-6">
        {result.skipped_active > 0 && (
          <p>{result.skipped_active} room{result.skipped_active !== 1 ? 's' : ''} skipped (in progress)</p>
        )}
        {result.not_found > 0 && (
          <p>{result.not_found} room number{result.not_found !== 1 ? 's' : ''} not found in system</p>
        )}
      </div>
      {result.warnings.length > 0 && (
        <div className="pl-6 space-y-0.5">
          {result.warnings.slice(0, 3).map((w, i) => (
            <p key={i} className="text-xs text-amber-700">{w}</p>
          ))}
          {result.warnings.length > 3 && (
            <p className="text-xs text-stone-500">+{result.warnings.length - 3} more warnings</p>
          )}
        </div>
      )}
    </div>
  )
}
