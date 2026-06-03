'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, Clock } from 'lucide-react'
import { format, subDays } from 'date-fns'
import { guestRequestsApi, type GuestRequest } from '@/lib/api/guest_requests'
import { Input } from '@/components/ui/Input'
import { Pill } from '@/components/ui/primitives'

export function HistoryTab() {
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState(() => format(subDays(new Date(), 30), 'yyyy-MM-dd'))
  const [dateTo, setDateTo] = useState(() => format(new Date(), 'yyyy-MM-dd'))

  const { data, isLoading } = useQuery({
    queryKey: ['guest-requests-history'],
    queryFn: () => guestRequestsApi.listRequests({ status: 'resolved', per_page: 200 }),
    staleTime: 30_000,
  })

  const requests = useMemo<GuestRequest[]>(() => {
    const all: GuestRequest[] = (data as any)?.data ?? []
    const toLimit = dateTo + 'T23:59:59Z'
    return all.filter(r => {
      const ts = r.resolved_at ?? r.created_at
      if (ts < dateFrom || ts > toLimit) return false
      if (!search) return true
      const q = search.toLowerCase()
      return (
        (r.rooms?.room_number ?? '').toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q)
      )
    })
  }, [data, search, dateFrom, dateTo])

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3 pointer-events-none" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search room or keyword..."
            className="pl-8"
          />
        </div>
        <input
          type="date"
          value={dateFrom}
          max={dateTo}
          onChange={e => setDateFrom(e.target.value)}
          className="bg-surface border border-line rounded-[var(--r-md)] px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
        />
        <input
          type="date"
          value={dateTo}
          min={dateFrom}
          max={format(new Date(), 'yyyy-MM-dd')}
          onChange={e => setDateTo(e.target.value)}
          className="bg-surface border border-line rounded-[var(--r-md)] px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
        />
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 bg-surface-3 rounded-[var(--r-md)] animate-pulse" />
          ))}
        </div>
      ) : requests.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-[14px] text-ink3">No resolved requests in this date range.</p>
        </div>
      ) : (
        <div className="divide-y divide-line border border-line rounded-[var(--r-lg)] bg-surface overflow-hidden">
          {requests.map(r => {
            const roomNum = r.rooms?.room_number ?? '—'
            const resolvedTime = r.resolved_at
              ? format(new Date(r.resolved_at), 'MMM d, h:mm a')
              : '—'
            return (
              <div key={r.id} className="flex items-center gap-4 px-4 py-3.5">
                <span className="font-mono text-[18px] font-bold text-ink w-14 shrink-0">{roomNum}</span>
                <p className="flex-1 text-[13.5px] text-ink truncate">{r.title}</p>
                <div className="flex items-center gap-2 shrink-0">
                  <Pill tone="ready" size="sm">Resolved</Pill>
                  <span className="text-[11.5px] text-ink3 flex items-center gap-1">
                    <Clock size={11} />
                    {resolvedTime}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <p className="text-[11px] text-ink3">
        {requests.length} result{requests.length !== 1 ? 's' : ''}
      </p>
    </div>
  )
}
