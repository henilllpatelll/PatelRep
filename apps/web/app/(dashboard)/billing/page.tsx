import { redirect } from 'next/navigation'

export default function BillingPageRedirect() {
  redirect('/settings/billing')
}
