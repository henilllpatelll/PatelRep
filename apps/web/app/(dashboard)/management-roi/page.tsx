import { redirect } from 'next/navigation'

// Management ROI now lives inside Reports as the GM-only "Management" view.
// This route stays so existing bookmarks and deep links keep working.
export default function ManagementRoiRedirect() {
  redirect('/reports?view=management')
}
