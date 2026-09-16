import { apiClient } from '@/lib/api/client'

// Mirrors apps/api/routers/inventory.py / models/requests.py (migration 102).
// Engineering spare-parts only — housekeeping's linen/chemical/amenity par
// levels live in lib/api/programs.ts (SupplyPar), a separate system.

export interface EngineeringPartLocation {
  id: string
  parent_id: string | null
  name: string
  is_structural: boolean
  created_at: string
}

export interface EngineeringPart {
  id: string
  name: string
  sku: string | null
  category: string | null
  unit: string
  minimum_stock: number
  maximum_stock: number | null
  default_location_id: string | null
  unit_cost?: number
  is_active: boolean
  created_at: string
  updated_at: string
  total_on_hand?: number
  low_stock?: boolean
}

export interface EngineeringPartStockRow {
  id: string
  part_id: string
  location_id: string
  quantity: number
  updated_at: string
  engineering_part_locations?: { name: string } | null
}

export interface EngineeringPartTransaction {
  id: string
  part_id: string
  location_id: string
  transaction_type: 'add' | 'remove' | 'count' | 'transfer'
  quantity_delta: number
  resulting_quantity: number
  transfer_group_id: string | null
  work_order_id: string | null
  user_id: string
  note: string | null
  created_at: string
}

export interface EngineeringPartDetail extends EngineeringPart {
  stock_by_location: EngineeringPartStockRow[]
  recent_transactions: EngineeringPartTransaction[]
}

export interface CreatePartLocationPayload {
  name: string
  parent_id?: string
  is_structural?: boolean
}

export interface CreatePartPayload {
  name: string
  sku?: string
  category?: string
  unit?: string
  minimum_stock?: number
  maximum_stock?: number
  default_location_id?: string
  unit_cost?: number
}

export interface CreatePartTransactionPayload {
  transaction_type: 'add' | 'remove' | 'count' | 'transfer'
  location_id: string
  quantity: number
  destination_location_id?: string
  work_order_id?: string
  note?: string
}

export const inventoryApi = {
  listLocations: () =>
    apiClient.get('/inventory/locations') as Promise<{ data: EngineeringPartLocation[] }>,

  createLocation: (payload: CreatePartLocationPayload) =>
    apiClient.post('/inventory/locations', payload) as Promise<{ data: EngineeringPartLocation }>,

  listParts: (lowStockOnly = false) =>
    apiClient.get('/inventory/parts', { params: { low_stock_only: lowStockOnly } }) as Promise<{ data: EngineeringPart[] }>,

  getPart: (partId: string) =>
    apiClient.get(`/inventory/parts/${partId}`) as Promise<{ data: EngineeringPartDetail }>,

  createPart: (payload: CreatePartPayload) =>
    apiClient.post('/inventory/parts', payload) as Promise<{ data: EngineeringPart }>,

  updatePart: (partId: string, payload: Partial<CreatePartPayload> & { is_active?: boolean }) =>
    apiClient.patch(`/inventory/parts/${partId}`, payload) as Promise<{ data: EngineeringPart }>,

  createTransaction: (partId: string, payload: CreatePartTransactionPayload) =>
    apiClient.post(`/inventory/parts/${partId}/transactions`, payload) as Promise<{
      data: EngineeringPartTransaction | EngineeringPartTransaction[]
    }>,
}
