import { redirect } from 'next/navigation'

// SOP Library lives at its own top-level route; keep old /settings/sop bookmarks working.
export default function LegacySettingsSopPage() {
  redirect('/sop')
}
