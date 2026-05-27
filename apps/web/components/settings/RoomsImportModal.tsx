'use client'

import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, AlertCircle, X, Plus } from 'lucide-react'
import { roomsApi, type ImportRoomPayload } from '@/lib/api/rooms'
import { Button } from '@/components/ui/Button'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RoomsImportResult {
  imported: number
  skipped: number
}

const EMPTY_IMPORT_ROW = (): ImportRoomPayload => ({
  room_number: '',
  floor: 1,
  room_type_code: 'SD',
  room_type_name: '',
  building: '',
})

// ─── Component ────────────────────────────────────────────────────────────────

export function RoomsImportModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'csv' | 'manual'>('csv')
  const [csvText, setCsvText] = useState('')
  const [csvPreview, setCsvPreview] = useState<ImportRoomPayload[] | null>(null)
  const [manualRows, setManualRows] = useState<ImportRoomPayload[]>(
    Array.from({ length: 8 }, EMPTY_IMPORT_ROW),
  )
  const [importResult, setImportResult] = useState<RoomsImportResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const csvMutation = useMutation({
    mutationFn: () => roomsApi.importFromCSV(csvText),
    onSuccess: (data: any) => {
      const d = data?.data ?? data
      setImportResult({
        imported: d?.imported_count ?? d?.imported ?? 0,
        skipped: d?.skipped_count ?? d?.skipped ?? 0,
      })
      queryClient.invalidateQueries({ queryKey: ['rooms'] })
    },
    onError: (err: Error) => setImportError(err.message),
  })

  const manualMutation = useMutation({
    mutationFn: (rows: ImportRoomPayload[]) => roomsApi.importRooms(rows),
    onSuccess: (data: any) => {
      const d = data?.data ?? data
      setImportResult({
        imported: d?.imported_count ?? d?.imported ?? 0,
        skipped: d?.skipped_count ?? d?.skipped ?? 0,
      })
      queryClient.invalidateQueries({ queryKey: ['rooms'] })
    },
    onError: (err: Error) => setImportError(err.message),
  })

  function handlePreview() {
    setImportError(null)
    const parsed = roomsApi.parseCSVPreview(csvText)
    if (parsed.length === 0) {
      setImportError('No valid rows found. Check that your CSV has a header row and room_number column.')
      return
    }
    setCsvPreview(parsed)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      setCsvText((ev.target?.result as string) ?? '')
      setCsvPreview(null)
    }
    reader.readAsText(file)
  }

  function updateRow(idx: number, field: keyof ImportRoomPayload, value: string) {
    setManualRows(prev => {
      const r = [...prev]
      r[idx] = {
        ...r[idx],
        [field]: field === 'floor' ? parseInt(value || '1', 10) : value,
      }
      return r
    })
  }

  const isPending = csvMutation.isPending || manualMutation.isPending

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/20 backdrop-blur-sm">
      <div className="bg-surface/[0.88] backdrop-blur-2xl border border-white/[0.95] rounded-[var(--r-lg)] shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/60">
          <h2 className="text-lg font-semibold text-stone-900">Import Rooms</h2>
          <button
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-stone-600 rounded transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/60 px-6">
          {(['csv', 'manual'] as const).map(t => (
            <button
              key={t}
              onClick={() => {
                setTab(t)
                setImportResult(null)
                setImportError(null)
                setCsvPreview(null)
              }}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-transparent text-stone-500 hover:text-stone-700'
              }`}
            >
              {t === 'csv' ? 'CSV Upload' : 'Manual Entry'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {importResult && (
            <div className="flex items-start gap-3 p-3 bg-[var(--ready-soft)] border border-[var(--ready-line)] rounded-lg">
              <CheckCircle2 size={18} className="text-[var(--ready)] mt-0.5 shrink-0" />
              <p className="text-sm text-green-800">
                Imported <span className="font-semibold">{importResult.imported}</span> rooms
                {importResult.skipped > 0 && (
                  <>, <span className="font-semibold">{importResult.skipped}</span> skipped</>
                )}.
              </p>
            </div>
          )}
          {importError && (
            <div className="flex items-start gap-3 p-3 bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-lg">
              <AlertCircle size={18} className="text-[var(--alert)] mt-0.5 shrink-0" />
              <p className="text-sm text-red-800">{importError}</p>
            </div>
          )}

          {tab === 'csv' && (
            <div className="space-y-4">
              <p className="text-sm text-stone-500">
                Expected columns:{' '}
                <code className="font-mono text-xs bg-stone-100 px-1 rounded">
                  room_number, floor, room_type_code, room_type_name, building
                </code>
              </p>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">
                  Upload CSV file
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileChange}
                  className="block w-full text-sm text-stone-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-white/90 file:text-sm file:font-medium file:bg-surface/70 file:text-stone-700 hover:file:bg-surface/90"
                />
              </div>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/60" />
                </div>
                <div className="relative flex justify-center text-xs text-stone-400">
                  <span className="bg-surface/60 px-2">or paste CSV</span>
                </div>
              </div>
              <textarea
                value={csvText}
                onChange={e => { setCsvText(e.target.value); setCsvPreview(null) }}
                placeholder={"room_number,floor,room_type_code,room_type_name\n101,1,SD,Standard Double"}
                rows={5}
                className="w-full px-3 py-2 border border-[var(--caution-line)]/40 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-400/50 resize-y bg-surface/50 backdrop-blur-sm"
              />
              {csvPreview && csvPreview.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-stone-700">
                    Preview — {csvPreview.length} room{csvPreview.length !== 1 ? 's' : ''} found
                  </p>
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-white/60">
                    <table className="min-w-full text-sm">
                      <thead className="bg-[var(--caution-soft)]/60 sticky top-0">
                        <tr>
                          {['Room #', 'Floor', 'Type Code', 'Type Name', 'Building'].map(h => (
                            <th
                              key={h}
                              className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase tracking-wide"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/40">
                        {csvPreview.map((row, i) => (
                          <tr key={i} className="hover:bg-[var(--caution-soft)]/30">
                            <td className="px-3 py-1.5 font-mono text-stone-900">{row.room_number}</td>
                            <td className="px-3 py-1.5 text-stone-600">{row.floor}</td>
                            <td className="px-3 py-1.5 font-mono text-stone-600">{row.room_type_code}</td>
                            <td className="px-3 py-1.5 text-stone-600">{row.room_type_name ?? '—'}</td>
                            <td className="px-3 py-1.5 text-stone-600">{row.building ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'manual' && (
            <div className="space-y-3">
              <p className="text-sm text-stone-500">
                Fill in room details below. Rows with an empty Room # will be ignored.
              </p>
              <div className="overflow-x-auto rounded-lg border border-white/60">
                <table className="min-w-full text-sm">
                  <thead className="bg-[var(--caution-soft)]/60">
                    <tr>
                      {['Room #', 'Floor', 'Type Code', 'Type Name', 'Building', ''].map(h => (
                        <th
                          key={h}
                          className="px-3 py-2 text-left text-xs font-medium text-stone-500 uppercase tracking-wide"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/40">
                    {manualRows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-[var(--caution-soft)]/30">
                        <td className="px-2 py-1">
                          <input
                            type="text"
                            value={row.room_number}
                            onChange={e => updateRow(idx, 'room_number', e.target.value)}
                            placeholder="101"
                            className="w-20 py-1 text-sm px-2 border border-[var(--caution-line)]/40 rounded-lg bg-surface/70 focus:outline-none focus:ring-1 focus:ring-amber-400/50"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="number"
                            value={row.floor}
                            min={1}
                            onChange={e => updateRow(idx, 'floor', e.target.value)}
                            className="w-16 py-1 text-sm px-2 border border-[var(--caution-line)]/40 rounded-lg bg-surface/70 focus:outline-none focus:ring-1 focus:ring-amber-400/50"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="text"
                            value={row.room_type_code}
                            onChange={e => updateRow(idx, 'room_type_code', e.target.value.toUpperCase())}
                            placeholder="SD"
                            className="w-20 py-1 text-sm px-2 border border-[var(--caution-line)]/40 rounded-lg bg-surface/70 focus:outline-none focus:ring-1 focus:ring-amber-400/50 font-mono uppercase"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="text"
                            value={row.room_type_name ?? ''}
                            onChange={e => updateRow(idx, 'room_type_name', e.target.value)}
                            placeholder="Standard Double"
                            className="w-36 py-1 text-sm px-2 border border-[var(--caution-line)]/40 rounded-lg bg-surface/70 focus:outline-none focus:ring-1 focus:ring-amber-400/50"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="text"
                            value={row.building ?? ''}
                            onChange={e => updateRow(idx, 'building', e.target.value)}
                            placeholder="Main"
                            className="w-24 py-1 text-sm px-2 border border-[var(--caution-line)]/40 rounded-lg bg-surface/70 focus:outline-none focus:ring-1 focus:ring-amber-400/50"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <button
                            onClick={() => setManualRows(prev => prev.filter((_, i) => i !== idx))}
                            className="text-stone-400 hover:text-[var(--alert)] transition-colors"
                          >
                            <X size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                onClick={() => setManualRows(prev => [...prev, EMPTY_IMPORT_ROW()])}
                className="flex items-center gap-1.5 text-sm text-[var(--accent)] font-medium"
              >
                <Plus size={15} />
                Add Row
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/60">
          <Button variant="ghost" onClick={onClose}>
            {importResult ? 'Close' : 'Cancel'}
          </Button>
          {tab === 'csv' && !csvPreview && (
            <Button variant="secondary" onClick={handlePreview} disabled={!csvText.trim()}>
              Preview
            </Button>
          )}
          {tab === 'csv' && csvPreview && (
            <Button
              variant="primary"
              onClick={() => {
                setImportError(null)
                setImportResult(null)
                csvMutation.mutate()
              }}
              disabled={isPending}
            >
              {isPending ? 'Importing…' : `Import ${csvPreview.length} Rooms`}
            </Button>
          )}
          {tab === 'manual' && (
            <Button
              variant="primary"
              onClick={() => {
                setImportError(null)
                const valid = manualRows.filter(r => r.room_number.trim())
                if (!valid.length) {
                  setImportError('Please enter at least one room number.')
                  return
                }
                manualMutation.mutate(valid)
              }}
              disabled={isPending}
            >
              {isPending ? 'Importing…' : 'Import Rooms'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
