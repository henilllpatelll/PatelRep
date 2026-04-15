'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ClipboardCheck, Users, AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react'
import { reportsApi } from '@/lib/api/reports'
import { aiApi } from '@/lib/api/ai'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { useAuthStore } from '@/stores/authStore'

type StatusKey = 'DIRTY' | 'IN_PROGRESS' | 'CLEAN' | 'INSPECTED' | 'OOO' | 'PICKUP'

const STATUS_LABELS: Record<StatusKey, string> = {
  DIRTY: 'Dirty',
  IN_PROGRESS: 'In Progress',
  CLEAN: 'Clean – Pending Inspect',
  INSPECTED: 'Inspected',
  OOO: 'Out of Order',
  PICKUP: 'Pickup',
}

export function SupervisorDashboard() {
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
    'Supervisor'

  const { data: summaryData, isLoading: summaryLoading } = useQuery({
    queryKey: ['daily-summary'],
    queryFn: () => reportsApi.getDailySummary(),
    refetchInterval: 60_000,
  })

  const { data: alertsData, isLoading: alertsLoading } = useQuery({
    queryKey: ['ai-risk-alerts'],
    queryFn: () => aiApi.getRiskAlerts(),
    refetchInterval: 30_000,
  })

  const summary = summaryData?.data
  const breakdown = summary?.room_status_breakdown ?? {}
  const alerts = alertsData?.data
  const hkRisks = alerts?.housekeeping_risks ?? []

  const totalRooms = Object.values(breakdown).reduce((a, b) => a + b, 0)
  const inspected = breakdown['INSPECTED'] ?? 0
  const cleanPending = breakdown['CLEAN'] ?? 0
  const inProgress = breakdown['IN_PROGRESS'] ?? 0
  const dirty = breakdown['DIRTY'] ?? 0
  const inspectedPct = totalRooms > 0 ? Math.round((inspected / totalRooms) * 100) : 0

  const priorityStatuses: StatusKey[] = ['DIRTY', 'IN_PROGRESS', 'CLEAN', 'INSPECTED', 'OOO', 'PICKUP']

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

      {/* Progress strip */}
      <div className="grid grid-cols-4 gap-3">
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-stone-900">{totalRooms}</p>
          <p className="text-xs text-stone-400 mt-0.5">Total Rooms</p>
        </Card>
        <Card className={`p-3 text-center${dirty + inProgress > 0 ? ' border-amber-200 bg-amber-50' : ''}`}>
          <p className={`text-2xl font-bold ${dirty + inProgress > 0 ? 'text-amber-600' : 'text-stone-900'}`}>
            {dirty + inProgress}
          </p>
          <p className="text-xs text-stone-400 mt-0.5">Needs Cleaning</p>
        </Card>
        <Card className={`p-3 text-center${cleanPending > 0 ? ' border-blue-100 bg-blue-50' : ''}`}>
          <p className={`text-2xl font-bold ${cleanPending > 0 ? 'text-blue-600' : 'text-stone-900'}`}>
            {cleanPending}
          </p>
          <p className="text-xs text-stone-400 mt-0.5">Awaiting Inspect</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-green-600">{inspectedPct}%</p>
          <p className="text-xs text-stone-400 mt-0.5">Inspected</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Room status breakdown */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-stone-700">Room Status Breakdown</h2>
            <Link href="/housekeeping" className="text-xs text-amber-600 hover:underline flex items-center gap-0.5">
              Board <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {summaryLoading ? (
            <div className="animate-pulse space-y-2">
              {[...Array(4)].map((_, i) => <div key={i} className="h-7 bg-stone-100 rounded" />)}
            </div>
          ) : (
            <div className="space-y-1.5">
              {priorityStatuses.map(s => {
                const count = breakdown[s] ?? 0
                if (count === 0 && !['DIRTY', 'CLEAN', 'INSPECTED'].includes(s)) return null
                return (
                  <div key={s} className="flex justify-between items-center hover:bg-amber-50/40 rounded-lg px-2 -mx-2 py-1">
                    <span className="text-sm text-stone-500">{STATUS_LABELS[s]}</span>
                    <span className="text-sm font-semibold text-stone-800">{count}</span>
                  </div>
                )
              })}
              {Object.keys(breakdown).length === 0 && (
                <p className="text-xs text-stone-400 py-2">No room data yet today</p>
              )}
            </div>
          )}
        </Card>

        {/* Inspection queue */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-stone-700 flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-amber-500" />
              Inspection Queue
            </h2>
            <Link href="/housekeeping/inspections" className="text-xs text-amber-600 hover:underline flex items-center gap-0.5">
              Inspect <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {cleanPending === 0 ? (
            <div className="py-4 text-center">
              <CheckCircle2 className="w-7 h-7 text-green-300 mx-auto mb-1.5" />
              <p className="text-sm text-stone-400">No rooms waiting for inspection</p>
            </div>
          ) : (
            <div className="py-2">
              <p className="text-3xl font-bold text-blue-600">{cleanPending}</p>
              <p className="text-sm text-stone-500 mt-1">
                {cleanPending === 1 ? 'room is' : 'rooms are'} clean and ready for inspection
              </p>
              <Link
                href="/housekeeping/inspections"
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-400 text-white text-xs font-semibold rounded-lg hover:bg-amber-500 transition-colors"
              >
                Start Inspections <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          )}
        </Card>
      </div>

      {/* AI Housekeeping Risks */}
      {(alertsLoading || hkRisks.length > 0) && (
        <Card className={hkRisks.length > 0 ? 'border-red-200 bg-red-50' : undefined}>
          <h2 className="text-sm font-semibold text-stone-700 flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            AI Risk Flags
            {hkRisks.length > 0 && (
              <span className="px-1.5 py-0.5 bg-red-100 text-red-700 text-xs font-semibold rounded-full">
                {hkRisks.length}
              </span>
            )}
          </h2>
          {alertsLoading ? (
            <div className="animate-pulse space-y-2">
              {[...Array(2)].map((_, i) => <div key={i} className="h-10 bg-red-100 rounded-lg" />)}
            </div>
          ) : (
            <div className="space-y-2">
              {hkRisks.map((r, i) => (
                <div key={i} className="flex items-center justify-between bg-white/60 rounded-xl px-3 py-2.5 border border-red-100">
                  <div>
                    <p className="text-sm font-medium text-stone-800">Room {r.rooms?.room_number ?? '—'}</p>
                    <p className="text-xs text-stone-500 capitalize">{r.risk_level} risk</p>
                  </div>
                  <Link href="/housekeeping/assignments" className="text-xs text-amber-600 hover:underline">
                    Reassign
                  </Link>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Quick links */}
      <div className="grid grid-cols-2 gap-3">
        <Link href="/housekeeping/assignments">
          <Card className="p-4 hover:border-amber-300 transition-colors cursor-pointer">
            <Users className="w-5 h-5 text-amber-500 mb-2" />
            <p className="text-sm font-semibold text-stone-700">Manage Assignments</p>
            <p className="text-xs text-stone-400 mt-0.5">Assign rooms to housekeepers</p>
          </Card>
        </Link>
        <Link href="/housekeeping/inspections">
          <Card className="p-4 hover:border-amber-300 transition-colors cursor-pointer">
            <ClipboardCheck className="w-5 h-5 text-amber-500 mb-2" />
            <p className="text-sm font-semibold text-stone-700">Run Inspections</p>
            <p className="text-xs text-stone-400 mt-0.5">Inspect and approve rooms</p>
          </Card>
        </Link>
      </div>
    </div>
  )
}
