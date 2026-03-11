import { create } from 'zustand'
import type { WorkOrder, FailurePrediction } from '@/lib/api/engineering'

interface EngineeringStore {
  workOrders: WorkOrder[]
  selectedWO: WorkOrder | null
  predictions: FailurePrediction[]
  statusFilter: 'open' | 'in_progress' | 'on_hold' | 'completed' | 'cancelled'
  categoryFilter: string | null
  priorityFilter: string | null
  isDrawerOpen: boolean

  setWorkOrders: (wos: WorkOrder[]) => void
  setSelectedWO: (wo: WorkOrder | null) => void
  setPredictions: (preds: FailurePrediction[]) => void
  setStatusFilter: (status: EngineeringStore['statusFilter']) => void
  setCategoryFilter: (cat: string | null) => void
  setPriorityFilter: (p: string | null) => void
  openDrawer: (wo: WorkOrder) => void
  closeDrawer: () => void
  updateWorkOrder: (woId: string, updates: Partial<WorkOrder>) => void
}

export const useEngineeringStore = create<EngineeringStore>((set) => ({
  workOrders: [],
  selectedWO: null,
  predictions: [],
  statusFilter: 'open',
  categoryFilter: null,
  priorityFilter: null,
  isDrawerOpen: false,

  setWorkOrders: (workOrders) => set({ workOrders }),
  setSelectedWO: (selectedWO) => set({ selectedWO }),
  setPredictions: (predictions) => set({ predictions }),
  setStatusFilter: (statusFilter) => set({ statusFilter }),
  setCategoryFilter: (categoryFilter) => set({ categoryFilter }),
  setPriorityFilter: (priorityFilter) => set({ priorityFilter }),

  openDrawer: (wo) => set({ selectedWO: wo, isDrawerOpen: true }),
  closeDrawer: () => set({ isDrawerOpen: false }),

  updateWorkOrder: (woId, updates) =>
    set((state) => ({
      workOrders: state.workOrders.map((wo) =>
        wo.id === woId ? { ...wo, ...updates } : wo
      ),
      selectedWO:
        state.selectedWO?.id === woId
          ? { ...state.selectedWO, ...updates }
          : state.selectedWO,
    })),
}))
