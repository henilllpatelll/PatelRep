import { redirect } from 'next/navigation'

const SUB_TABS = new Set(['work-orders', 'parts', 'archived'])

export default async function WorkOrdersRedirect({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const sp = await searchParams
  const requestedTab = typeof sp.tab === 'string' ? sp.tab : undefined
  const tab = requestedTab && SUB_TABS.has(requestedTab) ? requestedTab : 'work-orders'

  const params = new URLSearchParams()
  params.set('tab', tab)
  if (typeof sp.focus === 'string') params.set('focus', sp.focus)

  redirect(`/engineering?${params.toString()}`)
}
