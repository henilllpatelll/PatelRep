import { redirect } from 'next/navigation'

// Programs lives at its own top-level route; keep old /settings/programs bookmarks working.
export default function LegacySettingsProgramsPage() {
  redirect('/programs')
}
