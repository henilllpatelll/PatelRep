import { redirect } from 'next/navigation'

// Departments was informational only (fixed descriptions + staff counts, nothing editable). Real department
// assignment lives with each person in Staff, so old bookmarks land there. /settings is GM-only and so is /staff.
export default function LegacySettingsDepartmentsPage() {
  redirect('/staff')
}
