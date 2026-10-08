import { MyPreferences } from '@/components/preferences/MyPreferences'

// Personal preferences for every signed-in web role. Deliberately outside /settings (GM-only property admin).
export default function PreferencesPage() {
  return <MyPreferences />
}
