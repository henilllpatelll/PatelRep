import { redirect } from 'next/navigation'

/** Preserve legacy links while keeping room assignments and OPERA import in Room Board. */
export default function AssignmentsPage() {
  redirect('/housekeeping')
}
