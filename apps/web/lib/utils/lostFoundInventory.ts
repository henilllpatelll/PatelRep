import type { QueryClient } from '@tanstack/react-query'
import type {
  LostFoundCarrier,
  LostFoundClaimStatus,
  LostFoundDerivedStatus,
  LostFoundItem,
  LostFoundReturnStatus,
  LostFoundStatus,
  LostFoundVoidReason,
} from '@/lib/api/lost_found'

export const LOST_FOUND_STATUS_LABEL: Record<LostFoundStatus, string> = {
  unclaimed: 'Held',
  claimed: 'Returned',
  donated: 'Donated',
  discarded: 'Discarded',
}

export const LOST_FOUND_STATUS_TONE: Record<LostFoundStatus, 'info' | 'ready' | 'ai' | 'neutral'> = {
  unclaimed: 'info',
  claimed: 'ready',
  donated: 'ai',
  discarded: 'neutral',
}

/** D-43/D-44/D-70: the single, centralized presentation layer for the derived lifecycle
 * status the backend computes (see routers/lost_found.py::_derive_item_status). Every
 * surface (Inventory, Returns, Claims, Disposition, drawers) must read labels from here —
 * never reimplement this switch independently. */
export const LOST_FOUND_DERIVED_STATUS_LABEL: Record<LostFoundDerivedStatus, string> = {
  held: 'Held',
  matched: 'Matched',
  return_in_progress: 'Return in Progress',
  returned: 'Returned',
  due_for_disposition: 'Due for Disposition',
  donated: 'Donated',
  discarded: 'Discarded',
  voided: 'Voided',
}

export const LOST_FOUND_DERIVED_STATUS_TONE: Record<LostFoundDerivedStatus, 'info' | 'ready' | 'ai' | 'neutral' | 'caution' | 'alert'> = {
  held: 'info',
  matched: 'ai',
  return_in_progress: 'caution',
  returned: 'ready',
  due_for_disposition: 'caution',
  donated: 'neutral',
  discarded: 'neutral',
  voided: 'alert',
}

export function itemDerivedStatus(item: LostFoundItem): LostFoundDerivedStatus {
  return item.derived_status ?? (item.status === 'unclaimed' ? 'held' : item.status === 'claimed' ? 'returned' : item.status)
}

export const LOST_FOUND_RETURN_STATUS_LABEL: Record<LostFoundReturnStatus, string> = {
  awaiting_details: 'Awaiting Return',
  ready_for_pickup: 'Ready for Pickup',
  shipping_preparation: 'Shipping Preparation',
  shipped: 'Shipped',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export const LOST_FOUND_RETURN_STATUS_TONE: Record<LostFoundReturnStatus, 'info' | 'ready' | 'ai' | 'neutral' | 'caution'> = {
  awaiting_details: 'info',
  ready_for_pickup: 'caution',
  shipping_preparation: 'caution',
  shipped: 'ai',
  completed: 'ready',
  cancelled: 'neutral',
}

export const LOST_FOUND_CLAIM_STATUS_LABEL: Record<LostFoundClaimStatus, string> = {
  open: 'Open',
  matched: 'Matched',
  closed: 'Returned',
  cancelled: 'Cancelled',
}

export const LOST_FOUND_CARRIER_LABEL: Record<LostFoundCarrier, string> = {
  fedex: 'FedEx',
  ups: 'UPS',
  usps: 'USPS',
  dhl: 'DHL',
  local_courier: 'Local Courier',
  other: 'Other',
}

export const LOST_FOUND_VOID_REASON_LABEL: Record<LostFoundVoidReason, string> = {
  duplicate_record: 'Duplicate record',
  entered_by_mistake: 'Entered by mistake',
  wrong_property_or_item: 'Wrong property/item',
  test_record: 'Test record',
  other: 'Other',
}

export function formatCurrencyCents(cents?: number): string {
  if (cents === undefined || cents === null) return 'Not recorded'
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(cents / 100)
}

/** D-54: the property's own operational retention deadline, never framed as a universal
 * legal requirement — hotel retention policies and laws vary. */
export const RETENTION_POLICY_LABEL = 'Property retention deadline'

/** Lost & Found query keys are NOT all nested under a single ['lost-found', ...] array
 * (some are sibling top-level keys like 'lost-found-claims', 'lost-found-returns',
 * 'lost-found-disposition' etc.) so `invalidateQueries({queryKey:['lost-found']})` alone
 * silently misses them — React Query matches by exact key-segment equality, not string
 * prefix. Route every Lost & Found mutation's invalidation through this single predicate
 * instead of hand-picking query keys per call site. */
export function invalidateLostFound(queryClient: QueryClient): void {
  queryClient.invalidateQueries({
    predicate: (query) => typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith('lost-found'),
  })
}

export function itemFinderName(item: LostFoundItem): string {
  return item.user_profiles?.preferred_name || item.user_profiles?.full_name || 'Not recorded'
}

export function itemFoundLocation(item: LostFoundItem): string {
  if (item.rooms?.room_number) return `Room ${item.rooms.room_number}`
  return item.location_found || 'Not recorded'
}

export function formatItemAge(createdAt: string, now: Date = new Date()): string {
  const elapsedMs = Math.max(0, now.getTime() - new Date(createdAt).getTime())
  const hours = Math.floor(elapsedMs / (60 * 60 * 1000))
  if (hours < 24) return `${Math.max(1, hours)}h`
  return `${Math.floor(hours / 24)}d`
}

export function formatLostFoundDate(value?: string): string {
  if (!value) return 'Not recorded'
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
}

export function formatLostFoundDateTime(value?: string): string {
  if (!value) return 'Not recorded'
  const formatted = new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(value))
  return formatted.replace(/,([^,]*)$/, ' ·$1')
}

export function formatTimeUntil(value: string, now: Date = new Date()): string {
  const remainingMs = new Date(value).getTime() - now.getTime()
  if (remainingMs <= 0) return 'Due now'
  const hours = Math.floor(remainingMs / (60 * 60 * 1000))
  if (hours < 24) return `${Math.max(1, hours)}h remaining`
  return `${Math.floor(hours / 24)}d remaining`
}

/** The quick ad-hoc release action is for a walk-in guest with no formal claim on file.
 * Once an item has a confirmed guest claim or an active/completed return, release goes
 * through the Returns workflow (Prepare Return / Open Return) instead — never both. */
export function canReleaseItem(item: LostFoundItem, canManage: boolean): boolean {
  return canManage && item.status === 'unclaimed' && !item.has_confirmed_match && !item.has_active_return
}

export function canDispositionItem(item: LostFoundItem, canApproveDisposition: boolean): boolean {
  return canApproveDisposition && item.status === 'unclaimed' && !item.has_confirmed_match && !item.has_active_return
}

export function canMoveItem(item: LostFoundItem, canManage: boolean): boolean {
  const status = itemDerivedStatus(item)
  return canManage && status !== 'returned' && status !== 'donated' && status !== 'discarded' && status !== 'voided'
}
