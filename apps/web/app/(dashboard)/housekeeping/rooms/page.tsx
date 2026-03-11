'use client'

import { useState, useMemo, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload, Plus, X, AlertCircle, CheckCircle2, ChevronDown } from 'lucide-react'
import { roomsApi, type RoomStatus, type ImportRoomPayload } from '@/lib/api/rooms'
import { STATUS_LABELS, STATUS_COLORS } from '@/lib/utils/roomStatus'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colors = STATUS_COLORS[status] ?? {
    badge: 'bg-gray-100 text-gray-600',
  }
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors.badge}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

// ─── Import modal ─────────────────────────────────────────────────────────────

const EMPTY_ROW = (): ImportRoomPayload => ({
  room_number: '',
  floor: 1,
  room_type_code: 'SD',
  room_type_name: '',
  building: '',
})

interface ImportResult {
  imported: number
  skipped: number
}

function ImportModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'csv' | 'manual'>('csv')

  // ── CSV tab state ──
  const [csvText, setCsvText] = useState('')
  const [csvPreview, setCsvPreview] = useState<ImportRoomPayload[] | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Manual tab state ──
  const [manualRows, setManualRows] = useState<ImportRoomPayload[]>(
    Array.from({ length: 10 }, EMPTY_ROW),
  )

  // ── Shared result state ──
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  const csvMutation = useMutation({
    mutationFn: () => roomsApi.importFromCSV(csvText),
    onSuccess: (data: any) => {
      setImportResult({ imported: data?.imported ?? 0, skipped: data?.skipped ?? 0 })
      queryClient.invalidateQueries({ queryKey: ['rooms'] })
    },
    onError: (err: Error) => setImportError(err.message),
  })

  const manualMutation = useMutation({
    mutationFn: (rows: ImportRoomPayload[]) => roomsApi.importRooms(rows),
    onSuccess: (data: any) => {
      setImportResult({ imported: data?.imported ?? 0, skipped: data?.skipped ?? 0 })
      queryClient.invalidateQueries({ queryKey: ['rooms'] })
    },
    onError: (err: Error) => setImportError(err.message),
  })

  // Preview CSV without submitting
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
    reader.onload = (ev) => {
      setCsvText((ev.target?.result as string) ?? '')
      setCsvPreview(null)
    }
    reader.readAsText(file)
  }

  function handleManualRowChange(
    idx: number,
    field: keyof ImportRoomPayload,
    value: string,
  ) {
    setManualRows((prev) => {
      const updated = [...prev]
      updated[idx] = {
        ...updated[idx],
        [field]: field === 'floor' ? parseInt(value || '1', 10) : value,
      }
      return updated
    })
  }

  function handleAddRow() {
    setManualRows((prev) => [...prev, EMPTY_ROW()])
  }

  function handleRemoveRow(idx: number) {
    setManualRows((prev) => prev.filter((_, i) => i !== idx))
  }

  function handleManualSubmit() {
    setImportError(null)
    const validRows = manualRows.filter((r) => r.room_number.trim() !== '')
    if (validRows.length === 0) {
      setImportError('Please enter at least one room number.')
      return
    }
    manualMutation.mutate(validRows)
  }

  const isPending = csvMutation.isPending || manualMutation.isPending

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Import Rooms</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 px-6">
          {(['csv', 'manual'] as const).map((t) => (
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
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'csv' ? 'CSV Upload' : 'Manual Entry'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* Result banner */}
          {importResult && (
            <div className="flex items-start gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle2 size={18} className="text-green-600 mt-0.5 shrink-0" />
              <p className="text-sm text-green-800">
                Imported <span className="font-semibold">{importResult.imported}</span> rooms
                {importResult.skipped > 0 && (
                  <>, <span className="font-semibold">{importResult.skipped}</span> skipped</>
                )}
                .
              </p>
            </div>
          )}

          {/* Error banner */}
          {importError && (
            <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle size={18} className="text-red-600 mt-0.5 shrink-0" />
              <p className="text-sm text-red-800">{importError}</p>
            </div>
          )}

          {/* ── CSV tab ── */}
          {tab === 'csv' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">
                Expected columns:{' '}
                <code className="font-mono text-xs bg-gray-100 px-1 rounded">
                  room_number, floor, room_type_code, room_type_name, building
                </code>
              </p>

              {/* File input */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Upload CSV file
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileChange}
                  className="block w-full text-sm text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-gray-300 file:text-sm file:font-medium file:bg-white file:text-gray-700 hover:file:bg-gray-50"
                />
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center text-xs text-gray-400">
                  <span className="bg-white px-2">or paste CSV</span>
                </div>
              </div>

              <textarea
                value={csvText}
                onChange={(e) => {
                  setCsvText(e.target.value)
                  setCsvPreview(null)
                }}
                placeholder="room_number,floor,room_type_code,room_type_name&#10;101,1,SD,Standard Double&#10;102,1,KS,King Suite"
                rows={6}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y"
              />

              {/* Preview table */}
              {csvPreview && csvPreview.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-700">
                    Preview — {csvPreview.length} room{csvPreview.length !== 1 ? 's' : ''} found
                  </p>
                  <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-200">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          {['Room #', 'Floor', 'Type Code', 'Type Name', 'Building'].map(
                            (h) => (
                              <th
                                key={h}
                                className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide"
                              >
                                {h}
                              </th>
                            ),
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {csvPreview.map((row, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-3 py-1.5 font-mono text-gray-900">{row.room_number}</td>
                            <td className="px-3 py-1.5 text-gray-600">{row.floor}</td>
                            <td className="px-3 py-1.5 font-mono text-gray-600">{row.room_type_code}</td>
                            <td className="px-3 py-1.5 text-gray-600">{row.room_type_name ?? '—'}</td>
                            <td className="px-3 py-1.5 text-gray-600">{row.building ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Manual tab ── */}
          {tab === 'manual' && (
            <div className="space-y-3">
              <p className="text-sm text-gray-500">
                Fill in room details below. Rows with an empty Room # will be ignored.
              </p>
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      {['Room #', 'Floor', 'Type Code', 'Type Name', 'Building', ''].map(
                        (h) => (
                          <th
                            key={h}
                            className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide"
                          >
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {manualRows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-2 py-1">
                          <input
                            type="text"
                            value={row.room_number}
                            onChange={(e) =>
                              handleManualRowChange(idx, 'room_number', e.target.value)
                            }
                            placeholder="101"
                            className="w-20 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="number"
                            value={row.floor}
                            min={1}
                            onChange={(e) =>
                              handleManualRowChange(idx, 'floor', e.target.value)
                            }
                            className="w-16 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="text"
                            value={row.room_type_code}
                            onChange={(e) =>
                              handleManualRowChange(idx, 'room_type_code', e.target.value.toUpperCase())
                            }
                            placeholder="SD"
                            className="w-20 px-2 py-1 border border-gray-300 rounded text-sm font-mono uppercase focus:outline-none focus:ring-1 focus:ring-brand-500"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="text"
                            value={row.room_type_name ?? ''}
                            onChange={(e) =>
                              handleManualRowChange(idx, 'room_type_name', e.target.value)
                            }
                            placeholder="Standard Double"
                            className="w-36 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="text"
                            value={row.building ?? ''}
                            onChange={(e) =>
                              handleManualRowChange(idx, 'building', e.target.value)
                            }
                            placeholder="Main"
                            className="w-24 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <button
                            onClick={() => handleRemoveRow(idx)}
                            className="text-gray-400 hover:text-red-500 transition-colors"
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
                onClick={handleAddRow}
                className="flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-700 font-medium"
              >
                <Plus size={15} />
                Add Row
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            {importResult ? 'Close' : 'Cancel'}
          </button>

          {tab === 'csv' && !csvPreview && (
            <button
              onClick={handlePreview}
              disabled={!csvText.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-gray-700 rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Preview
            </button>
          )}

          {tab === 'csv' && csvPreview && (
            <button
              onClick={() => {
                setImportError(null)
                setImportResult(null)
                csvMutation.mutate()
              }}
              disabled={isPending}
              className="px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isPending ? 'Importing…' : `Import ${csvPreview.length} Rooms`}
            </button>
          )}

          {tab === 'manual' && (
            <button
              onClick={handleManualSubmit}
              disabled={isPending}
              className="px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isPending ? 'Importing…' : 'Import Rooms'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function RoomsPage() {
  const [floorFilter, setFloorFilter] = useState<number | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [showImportModal, setShowImportModal] = useState(false)

  const { data, isLoading, isError, error } = useQuery<{ data: RoomStatus[] }>({
    queryKey: ['rooms'],
    queryFn: () => roomsApi.list(),
  })

  const rooms: RoomStatus[] = data?.data ?? []

  // Extract unique floors for the filter dropdown
  const floors = useMemo(() => {
    const set = new Set<number>()
    rooms.forEach((r) => {
      if (r.rooms?.floor != null) set.add(r.rooms.floor)
    })
    return Array.from(set).sort((a, b) => a - b)
  }, [rooms])

  // Apply filters + search + sort
  const filteredRooms = useMemo(() => {
    return rooms
      .filter((r) => {
        if (floorFilter !== 'all' && r.rooms?.floor !== floorFilter) return false
        if (statusFilter !== 'all' && r.status !== statusFilter) return false
        if (searchQuery) {
          const q = searchQuery.toLowerCase()
          const roomNum = r.rooms?.room_number?.toLowerCase() ?? ''
          if (!roomNum.includes(q)) return false
        }
        return true
      })
      .sort((a, b) => {
        const floorA = a.rooms?.floor ?? 0
        const floorB = b.rooms?.floor ?? 0
        if (floorA !== floorB) return floorA - floorB
        const numA = a.rooms?.room_number ?? ''
        const numB = b.rooms?.room_number ?? ''
        return numA.localeCompare(numB, undefined, { numeric: true })
      })
  }, [rooms, floorFilter, statusFilter, searchQuery])

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">All Rooms</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {rooms.length} total room{rooms.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => setShowImportModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 transition-colors"
        >
          <Upload size={15} />
          Import Rooms
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Floor filter */}
        <div className="relative">
          <select
            value={floorFilter === 'all' ? 'all' : String(floorFilter)}
            onChange={(e) =>
              setFloorFilter(e.target.value === 'all' ? 'all' : parseInt(e.target.value))
            }
            className="appearance-none pl-3 pr-8 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 cursor-pointer"
          >
            <option value="all">All Floors</option>
            {floors.map((f) => (
              <option key={f} value={f}>
                Floor {f}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
          />
        </div>

        {/* Status filter */}
        <div className="relative">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="appearance-none pl-3 pr-8 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 cursor-pointer"
          >
            <option value="all">All Statuses</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
          />
        </div>

        {/* Search */}
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search room..."
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 w-40"
        />

        {/* Active filter count pill */}
        {(floorFilter !== 'all' || statusFilter !== 'all' || searchQuery) && (
          <span className="text-xs text-gray-500">
            {filteredRooms.length} result{filteredRooms.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading && (
          <div className="flex items-center justify-center py-16 text-gray-400 text-sm">
            Loading rooms…
          </div>
        )}

        {isError && (
          <div className="flex items-center justify-center gap-2 py-16 text-red-600 text-sm">
            <AlertCircle size={16} />
            {(error as Error)?.message ?? 'Failed to load rooms'}
          </div>
        )}

        {!isLoading && !isError && filteredRooms.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 text-sm gap-2">
            <p>{rooms.length === 0 ? 'No rooms imported yet.' : 'No rooms match the current filters.'}</p>
            {rooms.length === 0 && (
              <button
                onClick={() => setShowImportModal(true)}
                className="text-brand-600 hover:text-brand-700 font-medium text-sm"
              >
                Import rooms to get started
              </button>
            )}
          </div>
        )}

        {!isLoading && !isError && filteredRooms.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Room
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Type
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Floor
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Assigned To
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredRooms.map((room) => {
                  const assigneeName =
                    room.user_profiles?.preferred_name ||
                    room.user_profiles?.full_name ||
                    null
                  return (
                    <tr key={room.room_id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-semibold text-gray-900">
                        {room.rooms?.room_number ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {room.rooms?.room_types?.name ?? room.rooms?.room_types?.code ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {room.rooms?.floor != null ? room.rooms.floor : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={room.status} />
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {assigneeName ?? (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button className="px-3 py-1 text-xs font-medium text-brand-600 border border-brand-300 rounded-lg hover:bg-brand-50 transition-colors">
                          Edit
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Import modal */}
      {showImportModal && (
        <ImportModal onClose={() => setShowImportModal(false)} />
      )}
    </div>
  )
}
