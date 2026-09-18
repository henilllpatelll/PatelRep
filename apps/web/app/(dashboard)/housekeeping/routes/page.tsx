import { redirect } from 'next/navigation'

/** Preserve legacy route-planning links while keeping the view inside Room Board. */
export default function HousekeepingRoutesPage() {
  redirect('/housekeeping')
}
