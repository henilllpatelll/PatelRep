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
    <div className="flex items-center justify-between py-2.5 px-1 border-b border-stone-100 last:border-0 hover:bg-amber-50/30 rounded-lg -mx-1 px-2 transition-colors">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
          <Bed className="w-3.5 h-3.5 text-amber-600" />
        </div>
        <div>
          <p className="text-sm font-semibold text-stone-800">Room {room.room_number}</p>
          {room.floor && <p className="text-xs text-stone-400">Floor {room.floor}</p>}
        </div>
      </div>
      <Badge variant={cfg.variant}>{cfg.label}</Badge>
    </div>
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
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-stone-900">{rooms.length}</p>
          <p className="text-xs text-stone-400 mt-0.5">Rooms Today</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold text-green-600">{done}</p>
          <p className="text-xs text-stone-400 mt-0.5">Completed</p>
        </Card>
        <Card className={`p-3 text-center${remaining > 0 ? ' border-amber-200 bg-amber-50' : ''}`}>
          <p className={`text-2xl font-bold ${remaining > 0 ? 'text-amber-600' : 'text-stone-900'}`}>{remaining}</p>
          <p className="text-xs text-stone-400 mt-0.5">Remaining</p>
        </Card>
      </div>

      {/* My rooms */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-stone-700 flex items-center gap-2">
            <Bed className="w-4 h-4 text-amber-500" />
            My Rooms
          </h2>
          <Link href="/housekeeping" className="text-xs text-amber-600 hover:underline flex items-center gap-0.5">
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
      {(tasksLoading || tasks.length > 0) && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-stone-700 flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-amber-500" />
              My Tasks
            </h2>
            <Link href="/tasks" className="text-xs text-amber-600 hover:underline flex items-center gap-0.5">
              All tasks <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {tasksLoading ? (
            <div className="animate-pulse space-y-2">
              {[...Array(3)].map((_, i) => <div key={i} className="h-8 bg-stone-100 rounded-lg" />)}
            </div>
          ) : (
            <div className="space-y-2">
              {tasks.map(t => (
                <div key={t.id} className="flex items-center gap-2 py-2 border-b border-stone-100 last:border-0">
                  <Clock className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                  <p className="text-sm text-stone-700 flex-1 min-w-0 truncate">{t.title}</p>
                  <Badge variant={t.priority === 'urgent' ? 'high' : t.priority === 'normal' ? 'medium' : 'low'}>
                    {t.priority}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
