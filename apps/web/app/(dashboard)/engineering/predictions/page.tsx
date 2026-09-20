import { redirect } from 'next/navigation'

export default async function PredictionsRedirect({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const sp = await searchParams
  const params = new URLSearchParams()
  params.set('tab', 'predictions')
  if (typeof sp.asset === 'string') params.set('asset', sp.asset)

  redirect(`/engineering?${params.toString()}`)
}
