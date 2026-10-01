import { apiClient } from '@/lib/api/client'

export type LostFoundStatus = 'unclaimed' | 'claimed' | 'donated' | 'discarded'
export type LostFoundCategory = 'electronics' | 'clothing' | 'jewelry' | 'bags_luggage' | 'keys' | 'wallets_cards' | 'documents' | 'medical' | 'toiletries' | 'accessories' | 'other'
export type LostFoundClassification = 'standard' | 'high_value' | 'sensitive'
export type LostFoundClaimStatus = 'open' | 'matched' | 'closed' | 'cancelled'

/** D-44: the single, centrally-derived, business-facing lifecycle status. Never
 * recompute this client-side from raw fields — always read it off the API response. */
export type LostFoundDerivedStatus =
  | 'held' | 'matched' | 'return_in_progress' | 'returned'
  | 'due_for_disposition' | 'donated' | 'discarded' | 'voided'

export type LostFoundReturnMethod = 'pickup' | 'shipping' | 'other'
export type LostFoundReturnStatus =
  | 'awaiting_details' | 'ready_for_pickup' | 'shipping_preparation' | 'shipped' | 'completed' | 'cancelled'
export type LostFoundCarrier = 'fedex' | 'ups' | 'usps' | 'dhl' | 'local_courier' | 'other'
export type LostFoundShippingPaidBy = 'hotel' | 'guest' | 'other'
export type LostFoundDispositionOutcome = 'donated' | 'discarded'
export type LostFoundVoidReason = 'duplicate_record' | 'entered_by_mistake' | 'wrong_property_or_item' | 'test_record' | 'other'

export interface LostFoundClaimCapabilities {
  canViewInventory?: boolean
  canLogFoundItem?: boolean
  canEditFoundItem?: boolean
  canMoveFoundItem?: boolean
  canViewClaims: boolean
  canCreateClaim: boolean
  canEditClaim: boolean
  canManageClaims?: boolean
  canReviewMatch: boolean
  canConfirmMatch: boolean
  canCancelClaim: boolean
  canPrepareReturn?: boolean
  canReleaseItem?: boolean
  canShipItem?: boolean
  canApproveDisposition?: boolean
  canVoidRecord?: boolean
}

export interface LostFoundReturn {
  id: string
  item_id: string
  claim_id: string
  method: LostFoundReturnMethod
  status: LostFoundReturnStatus
  recipient_name?: string
  pickup_location?: string
  pickup_notes?: string
  pickup_verification_method_required?: string
  pickup_ready_at?: string
  picked_up_at?: string
  shipping_name?: string
  shipping_address_line1?: string
  shipping_address_line2?: string
  shipping_city?: string
  shipping_region?: string
  shipping_postal_code?: string
  shipping_country?: string
  carrier?: LostFoundCarrier
  tracking_number?: string
  shipping_paid_by?: LostFoundShippingPaidBy
  shipping_cost_cents?: number
  shipped_at?: string
  verification_method?: string
  verification_notes?: string
  created_by?: string
  completed_by?: string
  created_at: string
  updated_at?: string
  completed_at?: string
  // Joined (list view only)
  lost_found_items?: { description: string; tag_identifier?: string }
  lost_found_claims?: { claim_number?: number; guest_name: string }
}

export interface LostFoundReturnEvent {
  id: string
  return_id: string
  event_type: 'started' | 'method_changed' | 'pickup_details_set' | 'ready_for_pickup' | 'shipping_details_set' | 'shipped' | 'completed' | 'cancelled'
  actor_id?: string
  note?: string
  created_at: string
}

export interface LostFoundClaim {
  id: string
  claim_code: string
  claim_number?: number
  guest_name: string
  guest_phone?: string
  guest_email?: string
  room_id?: string
  room_number?: string
  stay_start?: string
  stay_end?: string
  description: string
  category: LostFoundCategory
  distinguishing_details?: string
  last_seen_at?: string
  notes?: string
  status: LostFoundClaimStatus
  matched_item_id?: string
  matched_at?: string
  matched_by?: string
  verification_notes?: string
  cancelled_at?: string
  cancellation_reason?: string
  created_at: string
  rooms?: { room_number: string }
}

export interface LostFoundClaimEvent {
  id: string
  claim_id: string
  item_id?: string
  event_type: 'created' | 'updated' | 'possible_match_reviewed' | 'match_confirmed' | 'match_removed' | 'cancelled'
  actor_id?: string
  note?: string
  created_at: string
}

export interface LostFoundMatchSignal {
  key: 'category' | 'room' | 'date' | 'description' | 'details'
  label: string
  detail: string
  points: number
}

export interface LostFoundMatchCandidate {
  item: LostFoundItem
  score: number
  signals: LostFoundMatchSignal[]
}

export interface LostFoundItemMatchCandidate {
  claim: LostFoundClaim
  score: number
  signals: LostFoundMatchSignal[]
}

export interface LostFoundItem {
  id: string
  description: string
  location_found?: string
  notes?: string
  photo_url?: string
  tag_identifier?: string
  storage_location?: string
  category?: LostFoundCategory
  classification?: LostFoundClassification
  distinguishing_details?: string
  found_at?: string
  retention_due_at?: string
  room_id?: string
  status: LostFoundStatus
  found_by: string
  claimed_by_name?: string
  claimed_by_contact?: string
  claimed_at?: string
  disposition_flagged_at?: string
  disposition_approved_by?: string
  release_verified_at?: string
  release_verification_method?: string
  created_at: string
  updated_at?: string
  has_confirmed_match?: boolean
  has_active_return?: boolean
  derived_status?: LostFoundDerivedStatus
  voided_at?: string
  voided_by?: string
  void_reason?: string
  disposed_at?: string
  // Joined
  rooms?: { room_number: string }
  user_profiles?: { preferred_name?: string; full_name?: string }
}

export const lostFoundApi = {
  getCapabilities: () =>
    apiClient.get('/lost-found/capabilities') as Promise<{ data: LostFoundClaimCapabilities }>,

  listItems: (params?: {
    status?: LostFoundStatus
    date_from?: string
    date_to?: string
    search?: string
    category?: LostFoundCategory
    storage?: string
    disposition_due?: boolean
    page?: number
    per_page?: number
  }) =>
    apiClient.get('/lost-found', { params }) as Promise<{
      data: LostFoundItem[]
      meta: { page: number; per_page: number }
    }>,

  getItem: (id: string) =>
    apiClient.get(`/lost-found/${id}`) as Promise<{ data: LostFoundItem }>,

  createItem: (payload: {
    description: string
    room_id?: string
    location_found?: string
    notes?: string
    photo_url?: string
    tag_identifier?: string
    storage_location?: string
    category?: LostFoundCategory
    classification?: LostFoundClassification
    distinguishing_details?: string
    found_at?: string
  }) =>
    apiClient.post('/lost-found', payload) as Promise<{ data: LostFoundItem }>,

  updateItem: (
    id: string,
    payload: {
      description?: string
      location_found?: string
      room_id?: string
      notes?: string
      status?: LostFoundStatus
      claimed_by_name?: string
      claimed_by_contact?: string
      claimed_at?: string
      tag_identifier?: string
      category?: LostFoundCategory
      classification?: LostFoundClassification
      distinguishing_details?: string
      found_at?: string
    },
  ) =>
    apiClient.patch(`/lost-found/${id}`, payload) as Promise<{ data: LostFoundItem }>,

  deleteItem: (id: string) =>
    apiClient.delete(`/lost-found/${id}`),

  suggestTag: () =>
    apiClient.get('/lost-found/tag-suggestion') as Promise<{ data: { tag_identifier: string } }>,

  uploadPhoto: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return apiClient.post('/lost-found/upload-photo', form) as Promise<{ data: { url: string } }>
  },

  listCustodyEvents: (id: string) =>
    apiClient.get(`/lost-found/${id}/custody-events`) as Promise<{ data: LostFoundCustodyEvent[] }>,

  recordCustodyEvent: (
    id: string,
    payload: {
      event_type: LostFoundCustodyEvent['event_type']
      storage_location?: string
      recipient_name?: string
      verification_method?: string
      disposition?: 'claimed' | 'donated' | 'discarded'
      note?: string
    },
  ) =>
    apiClient.post(`/lost-found/${id}/custody-events`, payload) as
      Promise<{ data: LostFoundCustodyEvent }>,

  listClaims: (params?: {
    status?: LostFoundClaimStatus
    category?: LostFoundCategory
    search?: string
    page?: number
    per_page?: number
  }) => apiClient.get('/lost-found/claims', { params }) as Promise<{
    data: LostFoundClaim[]
    meta: { page: number; per_page: number }
  }>,

  claimSummary: () => apiClient.get('/lost-found/claims/summary') as Promise<{
    data: { open: number; matched: number; possible_matches: number }
  }>,

  getClaim: (id: string) =>
    apiClient.get(`/lost-found/claims/${id}`) as Promise<{ data: LostFoundClaim }>,

  createClaim: (payload: {
    guest_name: string
    guest_phone?: string
    guest_email?: string
    room_id?: string
    room_number?: string
    stay_start?: string
    stay_end?: string
    description: string
    category: LostFoundCategory
    distinguishing_details?: string
    last_seen_at?: string
    notes?: string
  }) => apiClient.post('/lost-found/claims', payload) as Promise<{ data: LostFoundClaim }>,

  updateClaim: (id: string, payload: Partial<Omit<LostFoundClaim, 'id' | 'claim_code' | 'status' | 'created_at'>>) =>
    apiClient.patch(`/lost-found/claims/${id}`, payload) as Promise<{ data: LostFoundClaim }>,

  listClaimEvents: (id: string) =>
    apiClient.get(`/lost-found/claims/${id}/events`) as Promise<{ data: LostFoundClaimEvent[] }>,

  listClaimMatches: (id: string) =>
    apiClient.get(`/lost-found/claims/${id}/matches`) as Promise<{ data: LostFoundMatchCandidate[] }>,

  rejectClaimMatch: (id: string, payload: { item_id: string; reason?: string }) =>
    apiClient.post(`/lost-found/claims/${id}/reject-match`, payload) as Promise<{ data: { rejected: boolean } }>,

  confirmClaimMatch: (id: string, payload: { item_id: string; verification_notes: string }) =>
    apiClient.post(`/lost-found/claims/${id}/match`, payload) as Promise<{ data: LostFoundClaim }>,

  removeClaimMatch: (id: string, payload: { reason: string }) =>
    apiClient.post(`/lost-found/claims/${id}/remove-match`, payload) as Promise<{ data: LostFoundClaim }>,

  cancelClaim: (id: string, payload: { reason: string }) =>
    apiClient.post(`/lost-found/claims/${id}/cancel`, payload) as Promise<{ data: LostFoundClaim }>,

  listItemMatches: (id: string) =>
    apiClient.get(`/lost-found/${id}/matches`) as Promise<{ data: {
      confirmed_claim: LostFoundClaim | null
      possible_claims: LostFoundItemMatchCandidate[]
    } }>,

  // --- Returns (Phase 4) ---
  returnsSummary: () => apiClient.get('/lost-found/returns/summary') as Promise<{ data: {
    awaiting_return: number; ready_for_pickup: number; shipping: number; completed_this_month: number
  } }>,

  listReturns: (params?: { status?: LostFoundReturnStatus; method?: LostFoundReturnMethod; item_id?: string; search?: string; page?: number; per_page?: number }) =>
    apiClient.get('/lost-found/returns', { params }) as Promise<{ data: LostFoundReturn[]; meta: { page: number; per_page: number } }>,

  getReturn: (id: string) => apiClient.get(`/lost-found/returns/${id}`) as Promise<{ data: LostFoundReturn }>,

  listReturnEvents: (id: string) => apiClient.get(`/lost-found/returns/${id}/events`) as Promise<{ data: LostFoundReturnEvent[] }>,

  prepareReturn: (itemId: string, payload?: { method?: LostFoundReturnMethod }) =>
    apiClient.post(`/lost-found/${itemId}/returns`, payload ?? {}) as Promise<{ data: LostFoundReturn }>,

  updateReturnMethod: (returnId: string, payload: { method: LostFoundReturnMethod }) =>
    apiClient.patch(`/lost-found/returns/${returnId}/method`, payload) as Promise<{ data: LostFoundReturn }>,

  setPickupDetails: (returnId: string, payload: { recipient_name: string; pickup_location: string; pickup_notes?: string; verification_method_required: string }) =>
    apiClient.post(`/lost-found/returns/${returnId}/pickup-details`, payload) as Promise<{ data: LostFoundReturn }>,

  markPickupReady: (returnId: string) =>
    apiClient.post(`/lost-found/returns/${returnId}/pickup-ready`, {}) as Promise<{ data: LostFoundReturn }>,

  completePickup: (returnId: string, payload: { recipient_name: string; verification_method: string; verification_notes: string; verified: boolean }) =>
    apiClient.post(`/lost-found/returns/${returnId}/pickup-complete`, payload) as Promise<{ data: LostFoundReturn }>,

  setShippingDetails: (returnId: string, payload: { recipient_name: string; address_line1: string; address_line2?: string; city: string; region: string; postal_code: string; country: string; shipping_paid_by: LostFoundShippingPaidBy }) =>
    apiClient.post(`/lost-found/returns/${returnId}/shipping-details`, payload) as Promise<{ data: LostFoundReturn }>,

  markShipped: (returnId: string, payload: { carrier: LostFoundCarrier; tracking_number?: string; shipping_cost_cents?: number }) =>
    apiClient.post(`/lost-found/returns/${returnId}/ship`, payload) as Promise<{ data: LostFoundReturn }>,

  completeShipment: (returnId: string) =>
    apiClient.post(`/lost-found/returns/${returnId}/complete-shipment`, {}) as Promise<{ data: LostFoundReturn }>,

  // --- Disposition (Phase 4) ---
  dispositionSummary: () => apiClient.get('/lost-found/disposition/summary') as Promise<{ data: {
    due_now: number; due_soon: number; completed: number
  } }>,

  listDisposition: (params?: { bucket?: 'due_now' | 'due_soon' | 'completed'; search?: string; page?: number; per_page?: number }) =>
    apiClient.get('/lost-found/disposition', { params }) as Promise<{ data: LostFoundItem[]; meta: { page: number; per_page: number } }>,

  approveDisposition: (itemId: string, payload: { outcome: LostFoundDispositionOutcome; reason: string }) =>
    apiClient.post(`/lost-found/${itemId}/disposition`, payload) as Promise<{ data: LostFoundItem }>,

  // --- Void Record (Phase 4) ---
  voidItem: (itemId: string, payload: { reason: LostFoundVoidReason; notes: string }) =>
    apiClient.post(`/lost-found/${itemId}/void`, payload) as Promise<{ data: LostFoundItem }>,
}

export interface LostFoundCustodyEvent {
  id: string
  event_type: 'intake' | 'moved' | 'released' | 'disposition'
  storage_location?: string
  previous_storage_location?: string
  recipient_name?: string
  verification_method?: string
  disposition?: 'claimed' | 'donated' | 'discarded'
  note?: string
  created_at: string
}

/** D-10: shared "is this item due for a disposition decision" predicate — status still unclaimed
 * (the API's `disposition_due` filter is equivalent) but past its retention date. */
export function isDispositionDue(item: LostFoundItem, now: Date = new Date()): boolean {
  if (item.status !== 'unclaimed' || !item.retention_due_at) return false
  return new Date(item.retention_due_at).getTime() < now.getTime()
}
