import { redirect } from 'next/navigation'

/** Legacy room-administration link: canonical room management lives in Settings. */
export default function HousekeepingRoomsPage() {
  redirect('/settings/rooms')
}
