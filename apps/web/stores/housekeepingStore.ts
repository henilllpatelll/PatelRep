import { create } from 'zustand'
import { format } from 'date-fns'
import type { CleanType } from '@/lib/utils/cleanType'

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
  activeCleanType: CleanType
  activeAssigneeId: string | null
  activeAssigneeName: string | null
  statusFilter: string | null
  showRiskOnly: boolean
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
  setActiveCleanType: (cleanType: CleanType) => void
  setActiveAssignee: (id: string | null, name: string | null) => void
  setStatusFilter: (status: string | null) => void
  toggleRiskOnly: () => void
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
  activeCleanType: 'DEP',
  activeAssigneeId: null,
  activeAssigneeName: null,
  statusFilter: null,
  showRiskOnly: false,
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
      activeAssigneeId: null,
      activeAssigneeName: null,
    })),

  setPendingAssignment: (roomId, housekeeperId, cleanType) =>
    set((state) => ({
      pendingAssignments: { ...state.pendingAssignments, [roomId]: housekeeperId },
      pendingAssignmentCleanTypes: {
        ...state.pendingAssignmentCleanTypes,
        [roomId]: cleanType ?? state.activeCleanType,
      },
    })),

  removePendingAssignment: (roomId) =>
    set((state) => {
      const next = { ...state.pendingAssignments }
      const nextCleanTypes = { ...state.pendingAssignmentCleanTypes }
      delete next[roomId]
      delete nextCleanTypes[roomId]
      return { pendingAssignments: next, pendingAssignmentCleanTypes: nextCleanTypes }
    }),

  clearPendingAssignments: () => set({ pendingAssignments: {}, pendingAssignmentCleanTypes: {} }),

  setActiveCleanType: (cleanType) => set({ activeCleanType: cleanType }),

  setActiveAssignee: (id, name) => set({ activeAssigneeId: id, activeAssigneeName: name }),

  setStatusFilter: (status) => set({ statusFilter: status }),

  toggleRiskOnly: () => set((state) => ({ showRiskOnly: !state.showRiskOnly })),

  setLastSyncedAt: (date) => set({ lastSyncedAt: date }),

  filteredRooms: () => {
    const { rooms, statusFilter, showRiskOnly, predictions } = get()
    let result = rooms

    if (statusFilter !== null) {
      result = result.filter((room) => room.status === statusFilter)
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
