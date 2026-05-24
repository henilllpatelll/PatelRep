'use client'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { reportsApi } from '@/lib/api/reports'
import { StatusDot, Bar, SectionLabel, Mono } from '@/components/ui/primitives'

function getHotelIdFromSession(accessToken: string | undefined): string {
  if (!accessToken) return ''
  try {
    return JSON.parse(atob(accessToken.split('.')[1]))?.hotel_id ?? ''
  } catch {
    return ''
  }
}

type BarTone = 'accent' | 'ready' | 'caution' | 'alert' | 'info' | 'progress' | 'ai'

const TILES = [
  { code: 'DIRTY',      tone: 'dirty',     label: 'Vacant Dirty', barTone: 'alert'   },
  { code: 'IN_PROGRESS',tone: 'progress',  label: 'In Progress',  barTone: 'progress' },
  { code: 'CLEAN',      tone: 'clean',     label: 'Clean Inspect', barTone: 'info'   },
  { code: 'INSPECTED',  tone: 'inspected', label: 'Ready',        barTone: 'ready'   },
  { code: 'PICKUP',     tone: 'pickup',    label: 'Pickup',       barTone: 'caution' },
  { code: 'OOO',        tone: 'ooo',       label: 'OOO/OOS',      barTone: 'accent'  },
] as const

export function LiveOpsGrid() {
  const session = useAuthStore(s => s.session)
  const hotelId = getHotelIdFromSession(session?.access_token)

  const { data: summaryData, isLoading } = useQuery({
    queryKey: ['daily-summary', hotelId],
    queryFn: () => reportsApi.getDailySummary(),
    refetchInterval: 30_000,
    enabled: !!hotelId,
  })

  const breakdown: Record<string, number> = summaryData?.data?.room_status_breakdown ?? {}
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0) || 1

  if (isLoading) {
    return (
      <div className="bg-surface border border-line rounded-[var(--r-lg)] p-4">
        <div className="h-4 w-32 bg-surface-3 rounded animate-pulse mb-3" />
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-[88px] bg-surface-2 rounded-[10px] animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-surface border border-line rounded-[var(--r-lg)] p-4">
      <SectionLabel hint="Real-time">Room status</SectionLabel>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {TILES.map(({ code, tone, label, barTone }) => {
          const n = breakdown[code] ?? 0
          return (
            <div
              key={code}
              className="bg-surface-2 border border-line-2 rounded-[10px] p-3 flex flex-col gap-1.5"
            >
              <div className="flex items-center gap-1.5">
                <StatusDot tone={tone} size={7} />
                <span className="text-[11px] text-ink3 font-medium leading-none truncate">{label}</span>
              </div>
              <div className="font-display text-[28px] leading-none text-ink">{n}</div>
              <Bar value={n} max={total} tone={barTone as BarTone} height={3} />
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-2 mt-3.5 text-[12px] text-ink3">
        <Mono>{total} rooms total</Mono>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[var(--ready)]">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--ready)] inline-block" />
          Live
        </span>
      </div>
    </div>
  )
}
