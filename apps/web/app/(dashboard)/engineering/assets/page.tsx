import { redirect } from 'next/navigation'

export default function AssetsRedirect() {
  redirect('/engineering?tab=assets')
}
