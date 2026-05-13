'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Bed, ClipboardList, CheckCircle2, Clock, ArrowRight } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { housekeepingApi } from '@/lib/api/housekeeping'
import { tasksApi } from '@/lib/api/tasks'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'

type BadgeVariant = 'dirty' | 'in_progress' | 'clean' | 'inspected' | 'out_of_order' | 'high' | 'medium' | 'low' | 'default'
type RoomStatus = 'DIRTY' | 'IN_PROGRESS' | 'CLEAN' | 'INSPECTED' | 'OOO' | 'PICKUP'

const STATUS_MAP: Record<RoomStatus, { label: string; variant: BadgeVariant }> = {
  DIRTY:       { label: 'Dirty',       variant: 'dirty' },
  IN_PROGRESS: { label: 'In Progress', variant: 'in_progress' },
  CLEAN:       { label: 'Clean',       variant: 'clean' },
  INSPECTED:   { label: 'Inspected',   variant: 'inspected' },
  OOO:         { label: 'Out of Order',variant: 'out_of_order' },
  PICKUP:      { label: 'Pickup',      variant: 'default' },
}

interface MyRoom {
  room_id: string
  room_number: string
  floor?: number
  status: string
  room_type?: string
  notes?: string
}

function RoomRow({ room }: { room: MyRoom }) {
  const cfg = STATUS_MAP[(room.status as RoomStatus)] ?? { label: room.status, variant: 'default' as BadgeVariant }
  return (
    <Link 
      href="/housekeeping" 
      className="flex items-center justify-between py-3 px-2 border-b border-stone-100 last:border-0 hover:bg-amber-50 rounded-xl -mx-2 transition-colors group cursor-pointer"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-stone-50 flex items-center justify-center shrink-0 group-hover:bg-amber-100 transition-colors border border-stone-100">
          <Bed className="w-4 h-4 text-stone-500 group-hover:text-amber-600 transition-colors" />
        </div>
        <div>
          <p className="text-sm font-bold text-stone-900 group-hover:text-amber-700 transition-colors">Room {room.room_number}</p>
          {room.floor && <p className="text-xs text-stone-500 font-medium mt-0.5">Floor {room.floor}</p>}
        </div>
      </div>
      <Badge variant={cfg.variant}>{cfg.label}</Badge>
    </Link>
  )
}

function SkeletonRow() {
  return (
    <div className="animate-pulse flex items-center gap-3 py-2.5 border-b border-stone-100">
      <div className="w-8 h-8 rounded-lg bg-stone-100 shrink-0" />
      <div className="flex-1">
        <div className="h-3 bg-stone-200 rounded w-24 mb-1" />
        <div className="h-2 bg-stone-100 rounded w-14" />
      </div>
      <div className="h-5 bg-stone-100 rounded w-16" />
    </div>
  )
}

export function HousekeeperDashboard() {
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
    'there'

  const { data: myRoomsData, isLoading: roomsLoading } = useQuery({
    queryKey: ['my-rooms', user?.id],
    queryFn: () => housekeepingApi.getMyRooms(),
    enabled: !!user?.id,
    refetchInterval: 60_000,
  })

  const { data: tasksData, isLoading: tasksLoading } = useQuery({
    queryKey: ['my-tasks', user?.id],
    queryFn: () => tasksApi.list({ assigned_to: user?.id, status: 'open', per_page: 5 }),
    enabled: !!user?.id,
    refetchInterval: 60_000,
  })

  const rooms: MyRoom[] = (myRoomsData as { data?: MyRoom[] })?.data ?? []
  const tasks = (tasksData as { data?: { id: string; title: string; priority: string; due_at?: string }[] })?.data ?? []

  const done = rooms.filter(r => r.status === 'INSPECTED').length
  const remaining = rooms.filter(r => r.status === 'DIRTY' || r.status === 'IN_PROGRESS').length

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

      {/* Shift summary strip */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3 sm:p-4 flex flex-col items-center justify-center text-center">
          <p className="text-2xl sm:text-3xl font-bold text-stone-900">{rooms.length}</p>
          <p className="text-[10px] sm:text-xs font-semibold text-stone-500 mt-1 uppercase tracking-wider">Total</p>
        </Card>
        <Card className="p-3 sm:p-4 flex flex-col items-center justify-center text-center bg-green-50/50 border-green-100">
          <p className="text-2xl sm:text-3xl font-bold text-green-700">{done}</p>
          <p className="text-[10px] sm:text-xs font-semibold text-green-600 mt-1 uppercase tracking-wider">Done</p>
        </Card>
        <Card className={`p-3 sm:p-4 flex flex-col items-center justify-center text-center ${remaining > 0 ? 'bg-amber-50/50 border-amber-200' : ''}`}>
          <p className={`text-2xl sm:text-3xl font-bold ${remaining > 0 ? 'text-amber-700' : 'text-stone-900'}`}>{remaining}</p>
          <p className={`text-[10px] sm:text-xs font-semibold mt-1 uppercase tracking-wider ${remaining > 0 ? 'text-amber-600' : 'text-stone-500'}`}>Left</p>
        </Card>
      </div>

      {/* My rooms */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-stone-700 flex items-center gap-2">
            <Bed className="w-4 h-4 text-amber-500" />
            My Rooms
          </h2>
          <Link href="/housekeeping" prefetch={false} className="text-xs text-amber-600 hover:underline flex items-center gap-0.5">
            Full board <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {roomsLoading ? (
          <div>{[...Array(4)].map((_, i) => <SkeletonRow key={i} />)}</div>
        ) : rooms.length === 0 ? (
          <div className="py-6 text-center">
            <CheckCircle2 className="w-8 h-8 text-green-300 mx-auto mb-2" />
            <p className="text-sm text-stone-400">No rooms assigned for today</p>
          </div>
        ) : (
          <div>
            {rooms.map(r => <RoomRow key={r.room_id} room={r} />)}
          </div>
        )}
      </Card>

      {/* My open tasks */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-stone-700 flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-amber-500" />
            My Tasks
          </h2>
          <Link href="/tasks" prefetch={false} className="text-xs text-amber-600 hover:text-amber-700 font-medium transition-colors flex items-center gap-0.5">
            All tasks <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {tasksLoading ? (
          <div className="animate-pulse space-y-2">
            {[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-stone-100 rounded-xl" />)}
          </div>
        ) : tasks.length === 0 ? (
          <div className="py-6 text-center">
            <CheckCircle2 className="w-8 h-8 text-green-300 mx-auto mb-2" />
            <p className="text-sm text-stone-500 font-medium">No pending tasks!</p>
          </div>
        ) : (
          <div className="space-y-1">
            {tasks.map(t => (
              <Link key={t.id} href="/tasks" className="flex items-center gap-3 py-2.5 px-2 -mx-2 hover:bg-stone-50 rounded-xl transition-colors group">
                <div className="w-8 h-8 rounded-lg bg-stone-100 flex items-center justify-center shrink-0 group-hover:bg-amber-100 transition-colors">
                  <Clock className="w-3.5 h-3.5 text-stone-500 group-hover:text-amber-600 transition-colors" />
                </div>
                <p className="text-sm font-medium text-stone-700 group-hover:text-amber-700 flex-1 min-w-0 truncate transition-colors">{t.title}</p>
                <Badge variant={t.priority === 'urgent' ? 'high' : t.priority === 'normal' ? 'medium' : 'low'}>
                  {t.priority}
                </Badge>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
