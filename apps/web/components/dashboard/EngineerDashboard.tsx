'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Wrench, AlertCircle, CheckCircle2, ArrowRight, Clock } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { engineeringApi, type WorkOrder } from '@/lib/api/engineering'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'

type BadgeVariant = 'high' | 'medium' | 'low' | 'default'

const PRIORITY_VARIANT: Record<string, BadgeVariant> = {
  urgent: 'high',
  normal: 'medium',
  low: 'low',
}

const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  on_hold: 'On Hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

function WORow({ wo }: { wo: WorkOrder }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-stone-100 last:border-0 hover:bg-amber-50/30 rounded-lg -mx-1 px-2 transition-colors">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
        wo.priority === 'urgent' ? 'bg-red-50' : 'bg-amber-50'
      }`}>
        <Wrench className={`w-3.5 h-3.5 ${wo.priority === 'urgent' ? 'text-red-500' : 'text-amber-600'}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-stone-800 truncate">WO-{wo.work_order_number} · {wo.title}</p>
        <div className="flex items-center gap-2 mt-0.5">
          {wo.rooms?.room_number && (
            <span className="text-xs text-stone-400">Room {wo.rooms.room_number}</span>
          )}
          {wo.location_text && !wo.rooms?.room_number && (
            <span className="text-xs text-stone-400 truncate">{wo.location_text}</span>
          )}
          <span className="text-xs text-stone-300">·</span>
          <span className="text-xs text-stone-400 capitalize">{STATUS_LABEL[wo.status] ?? wo.status}</span>
        </div>
      </div>
      <Badge variant={PRIORITY_VARIANT[wo.priority] ?? 'default'}>{wo.priority}</Badge>
    </div>
  )
}

function SkeletonRow() {
  return (
    <div className="animate-pulse flex items-center gap-3 py-2.5 border-b border-stone-100">
      <div className="w-8 h-8 rounded-lg bg-stone-100 shrink-0" />
      <div className="flex-1">
        <div className="h-3 bg-stone-200 rounded w-3/4 mb-1.5" />
        <div className="h-2 bg-stone-100 rounded w-1/2" />
      </div>
      <div className="h-5 bg-stone-100 rounded w-14" />
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

  const { data, isLoading } = useQuery({
    queryKey: ['my-work-orders', user?.id],
    queryFn: () => engineeringApi.listWorkOrders({ assigned_to: user?.id, per_page: 20 }),
    enabled: !!user?.id,
    refetchInterval: 60_000,
  })

  const allWOs: WorkOrder[] = (data as { data?: WorkOrder[] })?.data ?? []
  const activeWOs = allWOs.filter(wo => wo.status === 'open' || wo.status === 'in_progress')
  const urgentWOs = activeWOs.filter(wo => wo.priority === 'urgent')
  const inProgressWOs = activeWOs.filter(wo => wo.status === 'in_progress')
  const openWOs = activeWOs.filter(wo => wo.status === 'open')

  // Show urgent first, then in-progress, then open
  const sortedWOs = [
    ...urgentWOs.filter(wo => wo.status === 'in_progress'),
    ...urgentWOs.filter(wo => wo.status === 'open'),
    ...inProgressWOs.filter(wo => wo.priority !== 'urgent'),
    ...openWOs.filter(wo => wo.priority !== 'urgent'),
  ]

  return (
    <div className="space-y-5">
      {/* Greeting */}
      <div>
        <h1 className="text-[28px] font-bold text-[#1C1208] tracking-[-0.02em] leading-tight">
          {greeting}, {fullName}!
        </h1>
        <p className="text-xs font-semibold text-amber-500 mt-1.5 uppercase tracking-[0.12em]" suppressHydrationWarning>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Status strip */}
      <div className="grid grid-cols-3 gap-3">
        <Card className={`p-3 text-center${urgentWOs.length > 0 ? ' border-red-200 bg-red-50' : ''}`}>
          <p className={`text-2xl font-bold ${urgentWOs.length > 0 ? 'text-red-600' : 'text-stone-900'}`}>
            {urgentWOs.length}
          </p>
          <p className="text-xs text-stone-400 mt-0.5">Urgent</p>
        </Card>
        <Card className={`p-3 text-center${inProgressWOs.length > 0 ? ' border-amber-200 bg-amber-50' : ''}`}>
          <p className={`text-2xl font-bold ${inProgressWOs.length > 0 ? 'text-amber-600' : 'text-stone-900'}`}>
            {inProgressWOs.length}
          </p>
          <p className="text-xs text-stone-400 mt-0.5">In Progress</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-stone-900">{openWOs.length}</p>
          <p className="text-xs text-stone-400 mt-0.5">Queued</p>
        </Card>
      </div>

      {/* Work orders list */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-stone-700 flex items-center gap-2">
            <Wrench className="w-4 h-4 text-amber-500" />
            My Work Orders
          </h2>
          <Link href="/engineering" className="text-xs text-amber-600 hover:underline flex items-center gap-0.5">
            Full list <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {isLoading ? (
          <div>{[...Array(4)].map((_, i) => <SkeletonRow key={i} />)}</div>
        ) : sortedWOs.length === 0 ? (
          <div className="py-6 text-center">
            <CheckCircle2 className="w-8 h-8 text-green-300 mx-auto mb-2" />
            <p className="text-sm text-stone-400">No open work orders assigned to you</p>
          </div>
        ) : (
          <div>{sortedWOs.map(wo => <WORow key={wo.id} wo={wo} />)}</div>
        )}
      </Card>

      {/* Overdue warning */}
      {urgentWOs.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-700">
              {urgentWOs.length} urgent {urgentWOs.length === 1 ? 'job' : 'jobs'} need your attention
            </p>
            <p className="text-xs text-red-500 mt-0.5">Urgent work orders may have SLA timers running</p>
          </div>
        </div>
      )}

      {/* Shift tip */}
      {!isLoading && sortedWOs.length > 0 && (
        <div className="flex items-start gap-2 px-1">
          <Clock className="w-3.5 h-3.5 text-stone-300 mt-0.5 shrink-0" />
          <p className="text-xs text-stone-400">
            Claim a work order on the engineering page to mark it in-progress and start the SLA timer.
          </p>
        </div>
      )}
    </div>
  )
}
