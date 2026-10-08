import { redirect } from 'next/navigation'

// Front Desk module access now lives in Roles & Access (Front Desk → Manage Access). Old links land there.
export default function FrontDeskSettingsRedirect() {
  redirect('/settings/roles?access=front-desk')
}
