import { redirect } from 'next/navigation'

export default function GuestRequestsPage() {
  redirect('/tasks?source=guest-requests')
}
