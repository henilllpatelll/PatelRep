import { redirect } from 'next/navigation'

// Activity & Audit is planned (Settings Phase 6). Until it exists, send direct visits to Settings Home.
export default function SettingsActivityPage() {
  redirect('/settings')
}
