import { create } from 'zustand'
import { format } from 'date-fns'
import type { CleanType } from '@/lib/utils/cleanType'
import type { HousekeepingAttentionCode } from '@/lib/housekeeping/roomState'

export interface RoomPrediction {
  room_id: string
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH'
  predicted_ready_at: string | null
  checkin_time: string | null
  delay_minutes: number | null
  risk_factors: string[]
}

export interface HousekeepingStore {
  rooms: any[]
  predictions: Record<string, RoomPrediction>
  selectedDate: string
  selectedShift: string | null
  assignmentMode: boolean
  pendingAssignments: Record<string, string>
  pendingAssignmentCleanTypes: Record<string, CleanType>
  activeAssigneeId: string | null
  activeAssigneeName: string | null
  statusFilter: string | null
  cleanTypeFilter: CleanType[]
  /** Assign-mode-only supplemental filter — layered on top of cleanTypeFilter. */
  assignFilter: 'all' | 'unassigned' | 'staged'
  /** Free multi-select in the Assign Rooms pool — independent of activeAssigneeId's tap-to-assign flow. */
  selectedRoomIds: Set<string>
  showRiskOnly: boolean
  buildingFilter: string | null
  floorFilter: number | null
  assigneeFilter: string | null
  boardSearch: string
  attentionFilter: HousekeepingAttentionCode | 'service_issue' | null
  unassignedOnly: boolean
  lastSyncedAt: Date | null

  // Actions
  setRooms: (rooms: any[]) => void
  setPredictions: (preds: RoomPrediction[]) => void
  setSelectedDate: (date: string) => void
  setSelectedShift: (shiftId: string | null) => void
  toggleAssignmentMode: () => void
  setPendingAssignment: (roomId: string, housekeeperId: string, cleanType?: CleanType) => void
  removePendingAssignment: (roomId: string) => void
  clearPendingAssignments: () => void
  setActiveAssignee: (id: string | null, name: string | null) => void
  setStatusFilter: (status: string | null) => void
  setCleanTypeFilter: (cleanTypes: CleanType[]) => void
  setAssignFilter: (filter: 'all' | 'unassigned' | 'staged') => void
  toggleRoomSelection: (roomId: string) => void
  setRoomSelection: (roomIds: string[]) => void
  clearRoomSelection: () => void
  toggleRiskOnly: () => void
  setBuildingFilter: (building: string | null) => void
  setFloorFilter: (floor: number | null) => void
  setAssigneeFilter: (assigneeId: string | null) => void
  setBoardSearch: (value: string) => void
  setAttentionFilter: (attention: HousekeepingAttentionCode | 'service_issue' | null) => void
  setUnassignedOnly: (value: boolean) => void
  setLastSyncedAt: (date: Date) => void

  // Derived
  filteredRooms: () => any[]
}

function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

export const useHousekeepingStore = create<HousekeepingStore>((set, get) => ({
  rooms: [],
  predictions: {},
  selectedDate: todayISO(),
  selectedShift: null,
  assignmentMode: false,
  pendingAssignments: {},
  pendingAssignmentCleanTypes: {},
  activeAssigneeId: null,
  activeAssigneeName: null,
  statusFilter: null,
  cleanTypeFilter: [],
  assignFilter: 'all',
  selectedRoomIds: new Set<string>(),
  showRiskOnly: false,
  buildingFilter: null,
  floorFilter: null,
  assigneeFilter: null,
  boardSearch: '',
  attentionFilter: null,
  unassignedOnly: false,
  lastSyncedAt: null,

  setRooms: (rooms) => set({ rooms }),

  setPredictions: (preds) => {
    const predictions: Record<string, RoomPrediction> = {}
    for (const p of preds) {
      predictions[p.room_id] = p
    }
    set({ predictions })
  },

  setSelectedDate: (date) => set({ selectedDate: date }),

  setSelectedShift: (shiftId) => set({ selectedShift: shiftId }),

  toggleAssignmentMode: () =>
    set((state) => ({
      assignmentMode: !state.assignmentMode,
      pendingAssignments: state.assignmentMode ? {} : state.pendingAssignments,
      pendingAssignmentCleanTypes: state.assignmentMode ? {} : state.pendingAssignmentCleanTypes,
      selectedRoomIds: new Set<string>(),
      activeAssigneeId: null,
      activeAssigneeName: null,
      // clear filters when switching modes so rooms aren't inadvertently hidden
      statusFilter: !state.assignmentMode ? null : state.statusFilter,
      cleanTypeFilter: state.assignmentMode ? [] : state.cleanTypeFilter,
      assignFilter: 'all',
      floorFilter: !state.assignmentMode ? null : state.floorFilter,
      assigneeFilter: !state.assignmentMode ? null : state.assigneeFilter,
      boardSearch: !state.assignmentMode ? '' : state.boardSearch,
      attentionFilter: !state.assignmentMode ? null : state.attentionFilter,
      unassignedOnly: !state.assignmentMode ? false : state.unassignedOnly,
    })),

  setPendingAssignment: (roomId, housekeeperId, cleanType) =>
    set((state) => {
      const nextCleanTypes = { ...state.pendingAssignmentCleanTypes }
      if (cleanType) nextCleanTypes[roomId] = cleanType
      else delete nextCleanTypes[roomId]
      return {
        pendingAssignments: { ...state.pendingAssignments, [roomId]: housekeeperId },
        pendingAssignmentCleanTypes: nextCleanTypes,
      }
    }),

  removePendingAssignment: (roomId) =>
    set((state) => {
      const next = { ...state.pendingAssignments }
      const nextCleanTypes = { ...state.pendingAssignmentCleanTypes }
      delete next[roomId]
      delete nextCleanTypes[roomId]
      return { pendingAssignments: next, pendingAssignmentCleanTypes: nextCleanTypes }
    }),

  clearPendingAssignments: () => set({ pendingAssignments: {}, pendingAssignmentCleanTypes: {} }),

  setActiveAssignee: (id, name) => set({ activeAssigneeId: id, activeAssigneeName: name }),

  setStatusFilter: (status) => set({ statusFilter: status }),

  setCleanTypeFilter: (cleanTypes) => set({ cleanTypeFilter: cleanTypes }),

  setAssignFilter: (filter) => set({ assignFilter: filter }),

  toggleRoomSelection: (roomId) =>
    set((state) => {
      const next = new Set(state.selectedRoomIds)
      if (next.has(roomId)) next.delete(roomId)
      else next.add(roomId)
      return { selectedRoomIds: next }
    }),

  setRoomSelection: (roomIds) => set({ selectedRoomIds: new Set(roomIds) }),

  clearRoomSelection: () => set({ selectedRoomIds: new Set() }),

  toggleRiskOnly: () => set((state) => ({ showRiskOnly: !state.showRiskOnly })),

  setBuildingFilter: (building) => set({ buildingFilter: building }),

  setFloorFilter: (floor) => set({ floorFilter: floor }),

  setAssigneeFilter: (assigneeId) => set({ assigneeFilter: assigneeId }),

  setBoardSearch: (boardSearch) => set({ boardSearch }),

  setAttentionFilter: (attentionFilter) => set({ attentionFilter }),

  setUnassignedOnly: (unassignedOnly) => set({ unassignedOnly }),

  setLastSyncedAt: (date) => set({ lastSyncedAt: date }),

  filteredRooms: () => {
    const { rooms, statusFilter, cleanTypeFilter, showRiskOnly, predictions, buildingFilter } = get()
    let result = rooms

    if (buildingFilter != null) {
      result = result.filter((room) => (room.rooms as any)?.building === buildingFilter)
    }

    if (statusFilter !== null) {
      result = result.filter((room) => room.status === statusFilter)
    }

    if (cleanTypeFilter.length > 0) {
      result = result.filter((room) => cleanTypeFilter.includes(room.clean_type))
    }

    if (showRiskOnly) {
      result = result.filter((room) => {
        const pred = predictions[room.room_id] ?? room.prediction
        return pred?.risk_level === 'HIGH' || pred?.risk_level === 'MEDIUM'
      })
    }

    return result
  },
}))
