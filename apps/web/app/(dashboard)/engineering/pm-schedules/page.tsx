import { redirect } from 'next/navigation'

export default function PMSchedulesRedirect() {
  redirect('/engineering?tab=pm-schedules')
}
