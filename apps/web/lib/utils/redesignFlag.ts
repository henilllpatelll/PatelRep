import type { Hotel } from '@/stores/hotelStore'

export function isSectionRedesigned(sectionKey: string, hotel: Hotel | null | undefined): boolean {
  return hotel?.web_redesign_sections?.includes(sectionKey) ?? false
}
