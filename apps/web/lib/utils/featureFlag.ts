import type { Hotel } from '@/stores/hotelStore'

export function isFeatureEnabled(featureKey: string, hotel: Hotel | null | undefined): boolean {
  return hotel?.enabled_features?.includes(featureKey) ?? false
}
