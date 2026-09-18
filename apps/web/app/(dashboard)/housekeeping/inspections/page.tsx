import { redirect } from 'next/navigation'

/** Preserve legacy inspection links while consolidating the workflow in Room Board. */
export default function InspectionsPage() {
  redirect('/housekeeping')
}
