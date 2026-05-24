'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { engineeringApi, type WorkOrder } from '@/lib/api/engineering'
import { Stat, Pill, SectionLabel, Mono } from '@/components/ui/primitives'

type PillTone = 'alert' | 'caution' | 'info' | 'ready' | 'neutral'

const PRIORITY_TONE: Record<string, PillTone> = {
  urgent: 'alert',
  normal: 'caution',
  low: 'neutral',
}

const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  in_progress: 'In progress',
  on_hold: 'On hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

function SkeletonRow() {
  return (
    <div className="animate-pulse flex items-center gap-3 px-4 py-3 border-t border-line-2">
      <div className="w-10 h-10 rounded-[10px] bg-surface-3 shrink-0" />
      <div className="flex-1">
        <div className="h-3 bg-surface-3 rounded w-3/4 mb-1.5" />
        <div className="h-2 bg-surface-3 rounded w-1/2" />
      </div>
      <div className="h-5 bg-surface-3 rounded w-14" />
    </div>
  )
}

export function EngineerDashboard() {
  const user = useAuthStore(s => s.user)
  const [greeting, setGreeting] = useState('Good morning')
  useEffect(() => {
    const h = new Date().getHours()
    if (h < 12) setGreeting('Good morning')
    else if (h < 18) setGreeting('Good afternoon')
    else setGreeting('Good evening')
  }, [])

  const fullName: string =
    (user?.user_metadata?.full_name as string | undefined) ||
    user?.email?.split('@')[0] ||
    'Engineer'
  const firstName = fullName.includes('@') ? fullName.split('@')[0] : fullName.split(' ')[0] || fullName

  const { data, isLoading } = useQuery({
    queryKey: ['my-work-orders', user?.id],
    queryFn: () => engineeringApi.listWorkOrders({ assigned_to: user?.id, per_page: 20 }),
    enabled: !!user?.id,
    refetchInterval: 60_000,
  })

  const allWOs: WorkOrder[] = (data as { data?: WorkOrder[] })?.data ?? []
  const activeWOs = allWOs.filter(wo => wo.status === 'open' || wo.status === 'in_progress')
  const urgentWOs = activeWOs.filter(wo => wo.priority === 'urgent')
  const completedToday = allWOs.filter(wo => wo.status === 'completed').length

  const sortedWOs = [
    ...urgentWOs.filter(wo => wo.status === 'in_progress'),
    ...urgentWOs.filter(wo => wo.status === 'open'),
    ...activeWOs.filter(wo => wo.priority !== 'urgent' && wo.status === 'in_progress'),
    ...activeWOs.filter(wo => wo.priority !== 'urgent' && wo.status === 'open'),
  ]

  return (
    <div className="flex flex-col gap-5">
      {/* Greeting */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink3" suppressHydrationWarning>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
        <h1 className="font-display text-[34px] font-normal tracking-[-0.5px] leading-[1.05] text-ink mt-2">
          {greeting}, <em className="italic">{firstName}</em>.
        </h1>
        <p className="mt-2 text-[14px] text-ink2 leading-relaxed">
          {urgentWOs.length > 0
            ? `${activeWOs.length} open work orders, ${urgentWOs.length} high priority.`
            : activeWOs.length > 0
            ? `${activeWOs.length} open work orders. All clear on urgent items.`
            : 'No open work orders. Good shift.'}
        </p>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Open WOs" value={activeWOs.length} delta={urgentWOs.length > 0 ? `${urgentWOs.length} urgent` : undefined} deltaTone={urgentWOs.length > 0 ? 'alert' : 'ready'} />
        <Stat label="Urgent" value={urgentWOs.length} deltaTone={urgentWOs.length > 0 ? 'alert' : 'ready'} />
        <Stat label="Completed today" value={completedToday} deltaTone="ready" />
        <Stat label="PM due" value="—" deltaTone="caution" />
      </div>

      {/* Work order list */}
      <div className="bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden shadow-card">
        <div className="px-4 pt-3.5">
          <SectionLabel
            hint="Open"
            action={
              <Link href="/engineering" className="text-[11px] font-medium text-ink3 hover:text-ink transition-colors">
                View board
              </Link>
            }
          >
            Work orders
          </SectionLabel>
        </div>
        {isLoading ? (
          [...Array(4)].map((_, i) => <SkeletonRow key={i} />)
        ) : sortedWOs.length === 0 ? (
          <div className="py-8 flex flex-col items-center gap-2">
            <CheckCircle2 className="w-8 h-8 text-[var(--ready-line)]" />
            <p className="text-[13px] text-ink3">No open work orders</p>
          </div>
        ) : (
          sortedWOs.map(wo => {
            const tone = PRIORITY_TONE[wo.priority] ?? 'neutral'
            const loc = wo.rooms?.room_number ? `R-${wo.rooms.room_number}` : wo.location_text ?? '—'
            return (
              <Link
                key={wo.id}
                href="/engineering"
                className="flex items-center gap-3 px-4 py-2.5 border-t border-line-2 hover:bg-surface-2 transition-colors"
              >
                <Mono className="text-[11px] text-ink3 shrink-0">WO-{wo.work_order_number}</Mono>
                <Pill tone={tone} size="sm">{wo.priority}</Pill>
                <span className="text-[13px] text-ink flex-1 min-w-0 truncate">{wo.title}</span>
                <Mono className="text-[11px] text-ink3 shrink-0">{loc}</Mono>
                <span className="text-[11px] text-ink3 w-9 text-right shrink-0 capitalize">
                  {STATUS_LABEL[wo.status] ?? wo.status}
                </span>
              </Link>
            )
          })
        )}
      </div>

      {urgentWOs.length > 0 && (
        <div className="bg-[var(--alert-soft)] border border-[var(--alert-line)] rounded-[var(--r-lg)] px-4 py-3.5 flex items-start gap-3">
          <span className="w-4 h-4 rounded-full bg-[var(--alert)] flex items-center justify-center text-white text-[9px] font-bold shrink-0 mt-0.5">!</span>
          <div>
            <p className="text-[13px] font-semibold text-[var(--alert)]">
              {urgentWOs.length} urgent {urgentWOs.length === 1 ? 'job needs' : 'jobs need'} your attention
            </p>
            <p className="text-[11.5px] text-[var(--alert)] mt-0.5 opacity-80">SLA timers may be running on urgent work orders.</p>
          </div>
        </div>
      )}
    </div>
  )
}
