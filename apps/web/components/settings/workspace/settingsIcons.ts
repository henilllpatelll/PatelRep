import {
  Home, Building2, Hotel, Brush, ClipboardList, Clock, ShieldCheck, Link2, CreditCard, History,
} from 'lucide-react'
import type { SettingsIconKey } from '@/lib/settings/navigation'

export const SETTINGS_ICONS: Record<SettingsIconKey, React.ElementType> = {
  home: Home,
  building: Building2,
  hotel: Hotel,
  brush: Brush,
  clipboard: ClipboardList,
  clock: Clock,
  shield: ShieldCheck,
  link: Link2,
  card: CreditCard,
  history: History,
}
