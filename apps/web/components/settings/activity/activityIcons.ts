import { Building2, ClipboardCheck, Clock, Link2, ShieldCheck, Sparkles, Wrench, BedDouble, type LucideIcon } from 'lucide-react'

/** One icon per category id returned by the API (the labels themselves come from the server catalog). */
export const ACTIVITY_CATEGORY_ICONS: Record<string, LucideIcon> = {
  property: Building2,
  rooms: BedDouble,
  housekeeping: Sparkles,
  inspections: ClipboardCheck,
  sla: Clock,
  permissions: ShieldCheck,
  integrations: Link2,
  operations: Wrench,
}

export const DEFAULT_CATEGORY_ICON: LucideIcon = Building2
