'use client'

import { useCallback, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { Upload, ChevronDown, Trash2, Loader2, Plus, Pencil } from 'lucide-react'
import { useHotelStore } from '@/stores/hotelStore'
import { useRole } from '@/lib/hooks/useRole'
import { roomsApi, type RoomStatus } from '@/lib/api/rooms'
import { guestRequestsApi, type AccessibleRoomFeature } from '@/lib/api/guest_requests'
import { STATUS_LABELS, STATUS_COLORS } from '@/lib/utils/roomStatus'
import { RoomsImportModal } from '@/components/settings/RoomsImportModal'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Pill } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const GM_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'DIRTY',       label: 'Vacant Dirty' },
  { value: 'OCCUPIED',    label: 'Occupied' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'PICKUP',      label: 'Pickup' },
  { value: 'CLEAN',       label: 'Clean' },
  { value: 'INSPECTED',   label: 'Inspected Vacant' },
  { value: 'OOO',         label: 'Out of Order / Out of Service' },
]

function RoomsStatusBadge({ status }: { status: string }) {
  const colors = (STATUS_COLORS as Record<string, { badge: string }>)[status] ?? {
    badge: 'bg-stone-100 text-stone-600',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors.badge}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

const OPERATIONAL_STATUS_OPTIONS: { value: AccessibleRoomFeature['operational_status']; label: string }[] = [
  { value: 'operational', label: 'Operational' },
  { value: 'out_of_service', label: 'Out of Service' },
  { value: 'inspection_due', label: 'Inspection Due' },
]

const OPERATIONAL_STATUS_PILL_TONE: Record<AccessibleRoomFeature['operational_status'], 'ready' | 'alert' | 'caution'> = {
  operational: 'ready',
  out_of_service: 'alert',
  inspection_due: 'caution',
}

interface FeatureFormValues {
  room_id: string
  feature_code: string
  description: string
  operational_status: AccessibleRoomFeature['operational_status']
  guidance: string
}

const EMPTY_FEATURE_FORM: FeatureFormValues = {
  room_id: '',
  feature_code: '',
  description: '',
  operational_status: 'operational',
  guidance: '',
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RoomsSettingsPage() {
  const { hotel } = useHotelStore()
  const { isGM, role } = useRole()
  const queryClient = useQueryClient()

  const [activeTab, setActiveTab] = useState<'rooms' | 'accessibility'>('rooms')

  const [showRoomImportModal, setShowRoomImportModal] = useState(false)
  const [confirmDeleteRoomId, setConfirmDeleteRoomId] = useState<string | null>(null)
  const [changingStatusRoomId, setChangingStatusRoomId] = useState<string | null>(null)
  const [roomFloorFilter, setRoomFloorFilter] = useState<number | 'all'>('all')
  const [roomStatusFilter, setRoomStatusFilter] = useState('all')
  const [roomSearchQuery, setRoomSearchQuery] = useState('')

  const canManageAccessibility = isGM || role === 'housekeeping_supervisor' || role === 'engineer'

  const [addFeatureOpen, setAddFeatureOpen] = useState(false)
  const [featureForm, setFeatureForm] = useState<FeatureFormValues>(EMPTY_FEATURE_FORM)
  const [featureSaving, setFeatureSaving] = useState(false)
  const [featureError, setFeatureError] = useState<string | null>(null)

  const { data: roomsData, isLoading: roomsLoading } = useQuery<{ data: RoomStatus[] }>({
    queryKey: ['rooms'],
    queryFn: () => roomsApi.list(),
    enabled: !!hotel?.id && isGM,
  })

  const allRooms = useMemo(() => roomsData?.data ?? [], [roomsData])

  const roomFloors = useMemo(() => {
    const s = new Set<number>()
    allRooms.forEach(r => { if (r.rooms?.floor != null) s.add(r.rooms.floor) })
    return Array.from(s).sort((a, b) => a - b)
  }, [allRooms])

  const filteredRooms = useMemo(
    () =>
      allRooms
        .filter(r => {
          if (roomFloorFilter !== 'all' && r.rooms?.floor !== roomFloorFilter) return false
          if (roomStatusFilter !== 'all' && r.status !== roomStatusFilter) return false
          if (
            roomSearchQuery &&
            !r.rooms?.room_number?.toLowerCase().includes(roomSearchQuery.toLowerCase())
          )
            return false
          return true
        })
        .sort((a, b) => {
          const fa = a.rooms?.floor ?? 0
          const fb = b.rooms?.floor ?? 0
          if (fa !== fb) return fa - fb
          return (a.rooms?.room_number ?? '').localeCompare(b.rooms?.room_number ?? '', undefined, {
            numeric: true,
          })
        }),
    [allRooms, roomFloorFilter, roomStatusFilter, roomSearchQuery],
  )

  const deleteRoomMutation = useMutation({
    mutationFn: (roomId: string) => roomsApi.deleteRoom(roomId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rooms'] })
      setConfirmDeleteRoomId(null)
    },
  })

  const changeStatusMutation = useMutation({
    mutationFn: ({ roomId, status }: { roomId: string; status: string }) =>
      roomsApi.updateStatus(roomId, status, undefined, true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rooms'] })
      setChangingStatusRoomId(null)
    },
  })

  const { data: accessibleFeatures = [], isLoading: featuresLoading } = useQuery({
    queryKey: ['accessible-room-features', hotel?.id],
    queryFn: () => guestRequestsApi.listAccessibleRoomFeatures(),
    enabled: !!hotel?.id && activeTab === 'accessibility',
    select: (res: any) => (res.data ?? []) as AccessibleRoomFeature[],
  })

  const saveFeature = useCallback(async () => {
    if (!hotel?.id || !featureForm.room_id || !featureForm.feature_code.trim()) return
    setFeatureSaving(true)
    setFeatureError(null)
    try {
      await guestRequestsApi.upsertAccessibleRoomFeature({
        room_id: featureForm.room_id,
        feature_code: featureForm.feature_code.trim(),
        description: featureForm.description.trim() || undefined,
        operational_status: featureForm.operational_status,
        guidance: featureForm.guidance.trim() || undefined,
      })
      setAddFeatureOpen(false)
      setFeatureForm({ ...EMPTY_FEATURE_FORM })
      queryClient.invalidateQueries({ queryKey: ['accessible-room-features'] })
    } catch (err: any) {
      setFeatureError(err?.message || 'Failed to save accessible-room feature.')
    } finally {
      setFeatureSaving(false)
    }
  }, [hotel, featureForm, queryClient])

  const editFeature = useCallback((feature: AccessibleRoomFeature) => {
    setFeatureForm({
      room_id: feature.room_id,
      feature_code: feature.feature_code,
      description: feature.description ?? '',
      operational_status: feature.operational_status,
      guidance: feature.guidance ?? '',
    })
    setFeatureError(null)
    setAddFeatureOpen(true)
  }, [])

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex border-b border-line">
        {(['rooms', 'accessibility'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'px-4 py-3 text-[14px] font-medium border-b-2 -mb-px transition-colors',
              activeTab === tab ? 'border-accent text-accent' : 'border-transparent text-ink3 hover:text-ink',
            )}
          >
            {tab === 'rooms' ? 'Rooms' : 'Accessibility Features'}
          </button>
        ))}
      </div>

      {activeTab === 'rooms' && (
        <>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-stone-900">Rooms</h2>
              <p className="text-sm text-stone-500 mt-1">
                Manage your hotel rooms — import, edit, and delete rooms. Room type and floor can be set on import.
              </p>
              {!roomsLoading && (
                <p className="text-xs text-stone-400 mt-0.5">
                  {allRooms.length} total room{allRooms.length !== 1 ? 's' : ''}
                </p>
              )}
            </div>
            <Button type="button" variant="primary" onClick={() => setShowRoomImportModal(true)}>
              <Upload size={14} className="inline mr-1.5 -mt-0.5" />
              Import Rooms
            </Button>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <select
                value={roomFloorFilter === 'all' ? 'all' : String(roomFloorFilter)}
                onChange={e =>
                  setRoomFloorFilter(e.target.value === 'all' ? 'all' : parseInt(e.target.value))
                }
                className="appearance-none pl-3 pr-8 py-2 border border-[var(--caution-line)]/40 rounded-lg text-sm text-stone-700 bg-surface/70 focus:outline-none focus:ring-2 focus:ring-amber-400/50 cursor-pointer"
              >
                <option value="all">All Floors</option>
                {roomFloors.map(f => (
                  <option key={f} value={f}>
                    Floor {f}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none"
              />
            </div>
            <div className="relative">
              <select
                value={roomStatusFilter}
                onChange={e => setRoomStatusFilter(e.target.value)}
                className="appearance-none pl-3 pr-8 py-2 border border-[var(--caution-line)]/40 rounded-lg text-sm text-stone-700 bg-surface/70 focus:outline-none focus:ring-2 focus:ring-amber-400/50 cursor-pointer"
              >
                <option value="all">All Statuses</option>
                {Object.entries(STATUS_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none"
              />
            </div>
            <input
              type="text"
              value={roomSearchQuery}
              onChange={e => setRoomSearchQuery(e.target.value)}
              placeholder="Search room…"
              className="w-36 px-3 py-2 text-sm border border-[var(--caution-line)]/40 rounded-lg bg-surface/70 focus:outline-none focus:ring-2 focus:ring-amber-400/50"
            />
          </div>

          <Card className="overflow-hidden p-0">
            {roomsLoading && (
              <div className="flex items-center justify-center py-12 text-stone-400 text-sm">
                Loading rooms…
              </div>
            )}
            {!roomsLoading && filteredRooms.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-stone-400 text-sm gap-2">
                <p>
                  {allRooms.length === 0
                    ? 'No rooms imported yet.'
                    : 'No rooms match the current filters.'}
                </p>
                {allRooms.length === 0 && (
                  <button
                    onClick={() => setShowRoomImportModal(true)}
                    className="text-[var(--accent)] font-medium text-sm"
                  >
                    Import rooms to get started
                  </button>
                )}
              </div>
            )}
            {!roomsLoading && filteredRooms.length > 0 && (
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="bg-[var(--caution-soft)]/60 border-b border-white/60">
                      {['Room', 'Type', 'Floor', 'Status', 'Assigned To', ''].map(h => (
                        <th
                          key={h}
                          className={`px-4 py-3 text-left text-xs font-medium text-stone-500 uppercase tracking-wide ${
                            h === '' ? 'text-right' : ''
                          }`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/40">
                    {filteredRooms.map(room => {
                      const assignee =
                        room.user_profiles?.preferred_name ||
                        room.user_profiles?.full_name ||
                        null
                      return (
                        <tr
                          key={room.room_id}
                          className="hover:bg-[var(--caution-soft)]/40 transition-colors"
                        >
                          <td className="px-4 py-3 font-semibold text-stone-900">
                            {room.rooms?.room_number ?? '—'}
                          </td>
                          <td className="px-4 py-3 text-sm text-stone-600">
                            {room.rooms?.room_types?.code ?? '—'}
                          </td>
                          <td className="px-4 py-3 text-sm text-stone-600">
                            {room.rooms?.floor ?? '—'}
                          </td>
                          <td className="px-4 py-3">
                            {changingStatusRoomId === room.room_id ? (
                              <div className="flex items-center gap-1.5">
                                <div className="relative">
                                  <select
                                    defaultValue={room.status}
                                    disabled={changeStatusMutation.isPending}
                                    onChange={e =>
                                      changeStatusMutation.mutate({
                                        roomId: room.room_id,
                                        status: e.target.value,
                                      })
                                    }
                                    className="appearance-none pl-2 pr-7 py-1 border border-amber-400/60 rounded-md text-xs text-stone-700 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400/50 cursor-pointer disabled:opacity-50"
                                  >
                                    {GM_STATUS_OPTIONS.map(({ value, label }) => (
                                      <option key={value} value={value}>{label}</option>
                                    ))}
                                  </select>
                                  <ChevronDown
                                    size={11}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none"
                                  />
                                </div>
                                {changeStatusMutation.isPending ? (
                                  <Loader2 size={12} className="animate-spin text-stone-400" />
                                ) : (
                                  <button
                                    onClick={() => setChangingStatusRoomId(null)}
                                    className="text-xs text-stone-400 hover:text-stone-600"
                                  >
                                    Cancel
                                  </button>
                                )}
                              </div>
                            ) : (
                              <button
                                onClick={() => setChangingStatusRoomId(room.room_id)}
                                className="group flex items-center gap-1.5"
                                title="Click to change status"
                              >
                                <RoomsStatusBadge status={room.status} />
                                <ChevronDown
                                  size={11}
                                  className="text-stone-300 group-hover:text-stone-500 transition-colors"
                                />
                              </button>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-stone-600">
                            {assignee ?? <span className="text-stone-400">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {confirmDeleteRoomId !== room.room_id ? (
                                <button
                                  onClick={() => setConfirmDeleteRoomId(room.room_id)}
                                  className="p-1.5 text-stone-400 hover:text-[var(--alert)] transition-colors rounded"
                                  title="Delete room"
                                >
                                  <Trash2 size={14} />
                                </button>
                              ) : (
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={() => deleteRoomMutation.mutate(room.room_id)}
                                    disabled={deleteRoomMutation.isPending}
                                    className="px-2 py-1 rounded text-xs font-medium bg-[var(--alert)] text-white hover:bg-red-600 disabled:opacity-50"
                                  >
                                    Confirm
                                  </button>
                                  <button
                                    onClick={() => setConfirmDeleteRoomId(null)}
                                    className="px-2 py-1 rounded text-xs font-medium border border-stone-200 text-stone-600 hover:bg-stone-50"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {showRoomImportModal && (
            <RoomsImportModal onClose={() => setShowRoomImportModal(false)} />
          )}
        </>
      )}

      {activeTab === 'accessibility' && (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[14px] text-ink3">
                Record which rooms have accessible features and whether each feature is currently usable. This information appears on accessibility guest requests to help staff match a suitable room.
              </p>
            </div>
            {canManageAccessibility && !addFeatureOpen && (
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  setFeatureForm({ ...EMPTY_FEATURE_FORM })
                  setFeatureError(null)
                  setAddFeatureOpen(true)
                }}
              >
                <Plus size={14} className="inline mr-1.5 -mt-0.5" />
                Add Feature
              </Button>
            )}
          </div>

          {featureError && (
            <p className="text-[12px] text-[var(--alert)]">{featureError}</p>
          )}

          {addFeatureOpen && (
            <Card className="p-5 space-y-4 border-teal-200/60 bg-teal-50/20">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">
                    Room
                  </label>
                  <select
                    value={featureForm.room_id}
                    onChange={e => setFeatureForm({ ...featureForm, room_id: e.target.value })}
                    className="w-full px-3 py-2 text-[14px] border border-teal-200/40 rounded-lg bg-surface/70 focus:outline-none focus:ring-2 focus:ring-teal-400/50 focus:border-teal-200 transition-colors min-h-[44px] sm:min-h-0"
                  >
                    <option value="">Select a room…</option>
                    {allRooms.map(r => (
                      <option key={r.room_id} value={r.room_id}>
                        {r.rooms?.room_number ?? r.room_id}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">
                    Feature Code
                  </label>
                  <input
                    value={featureForm.feature_code}
                    onChange={e => setFeatureForm({ ...featureForm, feature_code: e.target.value })}
                    placeholder="e.g. roll_in_shower"
                    className="w-full px-3 py-2 text-[14px] border border-teal-200/40 rounded-lg bg-surface/70 focus:outline-none focus:ring-2 focus:ring-teal-400/50 focus:border-teal-200 transition-colors min-h-[44px] sm:min-h-0"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">
                  Description (optional)
                </label>
                <input
                  value={featureForm.description}
                  onChange={e => setFeatureForm({ ...featureForm, description: e.target.value })}
                  placeholder="e.g. Roll-in shower with grab bars"
                  className="w-full px-3 py-2 text-[14px] border border-teal-200/40 rounded-lg bg-surface/70 focus:outline-none focus:ring-2 focus:ring-teal-400/50 focus:border-teal-200 transition-colors min-h-[44px] sm:min-h-0"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">
                  Operational Status
                </label>
                <select
                  value={featureForm.operational_status}
                  onChange={e => setFeatureForm({
                    ...featureForm,
                    operational_status: e.target.value as AccessibleRoomFeature['operational_status'],
                  })}
                  className="w-full sm:w-64 px-3 py-2 text-[14px] border border-teal-200/40 rounded-lg bg-surface/70 focus:outline-none focus:ring-2 focus:ring-teal-400/50 focus:border-teal-200 transition-colors min-h-[44px] sm:min-h-0"
                >
                  {OPERATIONAL_STATUS_OPTIONS.map(({ value, label }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">
                  Guidance (optional)
                </label>
                <textarea
                  value={featureForm.guidance}
                  onChange={e => setFeatureForm({ ...featureForm, guidance: e.target.value })}
                  placeholder="Notes staff should know when directing a guest to this room"
                  rows={2}
                  className="w-full px-3 py-2 text-[14px] border border-teal-200/40 rounded-lg bg-surface/70 focus:outline-none focus:ring-2 focus:ring-teal-400/50 focus:border-teal-200 transition-colors"
                />
              </div>

              <p className="text-[11px] text-ink3">
                Saving an existing room and feature code updates that record.
              </p>

              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => { setAddFeatureOpen(false); setFeatureError(null) }}
                  disabled={featureSaving}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={saveFeature}
                  disabled={featureSaving || !featureForm.room_id || !featureForm.feature_code.trim()}
                >
                  {featureSaving ? 'Saving…' : 'Save Feature'}
                </Button>
              </div>
            </Card>
          )}

          <Card className="overflow-hidden p-0">
            {featuresLoading && (
              <div className="flex items-center justify-center py-12 text-stone-400 text-sm">
                Loading accessible-room features…
              </div>
            )}
            {!featuresLoading && accessibleFeatures.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-stone-400 text-sm gap-2">
                <p>No accessible room features recorded yet.</p>
                {canManageAccessibility && (
                  <button
                    onClick={() => { setFeatureForm({ ...EMPTY_FEATURE_FORM }); setAddFeatureOpen(true) }}
                    className="text-[var(--accent)] font-medium text-sm"
                  >
                    Add the first feature
                  </button>
                )}
              </div>
            )}
            {!featuresLoading && accessibleFeatures.length > 0 && (
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="bg-[var(--caution-soft)]/60 border-b border-white/60">
                      {['Room', 'Feature', 'Description', 'Status', 'Last Verified', ''].map(h => (
                        <th
                          key={h}
                          className={`px-4 py-3 text-left text-xs font-medium text-stone-500 uppercase tracking-wide ${
                            h === '' ? 'text-right' : ''
                          }`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/40">
                    {accessibleFeatures.map(feature => (
                      <tr key={feature.id} className="hover:bg-[var(--caution-soft)]/40 transition-colors">
                        <td className="px-4 py-3 font-mono text-sm font-semibold text-stone-900">
                          {feature.rooms?.room_number ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-stone-700">{feature.feature_code}</td>
                        <td className="px-4 py-3 text-sm text-stone-600">
                          {feature.description ?? <span className="text-stone-400">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <Pill tone={OPERATIONAL_STATUS_PILL_TONE[feature.operational_status]}>
                            {OPERATIONAL_STATUS_OPTIONS.find(o => o.value === feature.operational_status)?.label
                              ?? feature.operational_status}
                          </Pill>
                        </td>
                        <td className="px-4 py-3 text-sm text-stone-600">
                          {feature.last_verified_at
                            ? formatDistanceToNow(new Date(feature.last_verified_at), { addSuffix: true })
                            : <span className="text-stone-400">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {canManageAccessibility && (
                            <button
                              onClick={() => editFeature(feature)}
                              className="p-1.5 text-stone-400 hover:text-[var(--caution)] hover:bg-[var(--caution-soft)] rounded-lg transition-colors"
                              aria-label="Edit accessible-room feature"
                            >
                              <Pencil size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
