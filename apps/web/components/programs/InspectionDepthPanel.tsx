'use client'

// Inspection sampling rules + quality trends (04-07 / HK-02/HK-03 depth
// surface). Split out of HousekeepingDepthPanels.tsx to keep every file
// under the project's 500-line limit (CLAUDE.md).

import { FormEvent, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { useRole } from '@/lib/hooks/useRole'
import { roomsApi } from '@/lib/api/rooms'
import { programsApi } from '@/lib/api/programs'

// Shared with ProgramsPage's own overview query -- same key means React
// Query dedupes the network call across every component that reads it.
const OVERVIEW_KEY = ['operational-programs']

export function InspectionDepthPanel() {
  const { isSupervisor, canViewEngineering } = useRole()
  const isManager = isSupervisor || canViewEngineering
  // POST /programs/inspection-sampling-rules requires the narrower
  // require_role("gm", "housekeeping_supervisor") server-side.
  const canConfigurePolicy = isSupervisor

  const queryClient = useQueryClient()
  const invalidateOverview = () => queryClient.invalidateQueries({ queryKey: OVERVIEW_KEY })

  const overview = useQuery({ queryKey: OVERVIEW_KEY, queryFn: programsApi.overview, enabled: isManager })
  const data = overview.data?.data

  const roomsQuery = useQuery({
    queryKey: ['programs-depth-rooms'],
    queryFn: () => roomsApi.list(),
    enabled: isManager,
  })
  const roomTypeOptions = Array.from(
    new Map(
      ((roomsQuery.data?.data ?? []) as any[])
        .filter((row) => row.rooms?.room_type_id)
        .map((row) => [row.rooms.room_type_id as string, (row.rooms?.room_types?.name as string | undefined) || (row.rooms.room_type_id as string)]),
    ).entries(),
  )

  const inspectionSample = useQuery({
    queryKey: ['programs-inspection-sample'],
    queryFn: programsApi.inspectionSample,
    enabled: isManager,
  })
  const inspectionQuality = useQuery({
    queryKey: ['programs-inspection-quality'],
    queryFn: programsApi.inspectionQuality,
    enabled: isManager,
  })

  const [samplingForm, setSamplingForm] = useState({
    room_type_id: '',
    experience_band: 'standard' as 'new_hire' | 'standard' | 'trusted',
    risk_level: 'standard' as 'standard' | 'high',
    sample_percent: 10,
  })
  const saveSamplingRule = useMutation({
    mutationFn: programsApi.upsertSamplingRule,
    onSuccess: invalidateOverview,
  })
  const submitSamplingRule = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    saveSamplingRule.mutate({
      room_type_id: samplingForm.room_type_id || undefined,
      experience_band: samplingForm.experience_band,
      risk_level: samplingForm.risk_level,
      sample_percent: samplingForm.sample_percent,
    })
  }

  const quality = inspectionQuality.data?.data
  const sample = inspectionSample.data?.data

  // All hooks above must run unconditionally (Rules of Hooks) -- the
  // manager gate only affects what renders, never how many hooks fire.
  if (!isManager) return null

  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <Card className="p-4 sm:p-5">
        <h2 className="font-semibold text-ink">Inspection sampling rules</h2>
        <p className="mt-1 text-sm text-ink3">How much of each room type/experience/risk group a supervisor should physically inspect.</p>
        <div className="mt-4 space-y-2">
          {(data?.inspection_sampling_rules ?? []).map((rule) => (
            <div key={rule.id} className="rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink2">
              {rule.room_types?.name ?? 'All room types'} &middot; {rule.experience_band} &middot; {rule.risk_level} risk &middot; {rule.sample_percent}%
            </div>
          ))}
          {!data?.inspection_sampling_rules?.length && !overview.isLoading ? (
            <p className="text-sm text-ink3">No sampling rules configured -- a 10% default applies.</p>
          ) : null}
        </div>
        {canConfigurePolicy ? (
          <form className="mt-4 grid gap-2 sm:grid-cols-2" onSubmit={submitSamplingRule}>
            <select
              aria-label="Room type"
              value={samplingForm.room_type_id}
              onChange={(event) => setSamplingForm((current) => ({ ...current, room_type_id: event.target.value }))}
              className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm text-ink"
            >
              <option value="">All room types</option>
              {roomTypeOptions.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
            <select
              aria-label="Experience band"
              value={samplingForm.experience_band}
              onChange={(event) => setSamplingForm((current) => ({ ...current, experience_band: event.target.value as typeof current.experience_band }))}
              className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm text-ink"
            >
              <option value="new_hire">New hire</option>
              <option value="standard">Standard</option>
              <option value="trusted">Trusted</option>
            </select>
            <select
              aria-label="Risk level"
              value={samplingForm.risk_level}
              onChange={(event) => setSamplingForm((current) => ({ ...current, risk_level: event.target.value as typeof current.risk_level }))}
              className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm text-ink"
            >
              <option value="standard">Standard</option>
              <option value="high">High</option>
            </select>
            <Input
              aria-label="Sample percent"
              type="number" min={1} max={100} value={samplingForm.sample_percent}
              onChange={(event) => setSamplingForm((current) => ({ ...current, sample_percent: Number(event.target.value) }))}
              className="min-h-11"
            />
            <Button type="submit" disabled={saveSamplingRule.isPending} className="min-h-11 sm:col-span-2">Save sampling rule</Button>
          </form>
        ) : null}
        <div className="mt-4 rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink2">
          <p className="font-medium text-ink">Today&apos;s sample: {sample?.sample_size ?? 0} room(s)</p>
          {sample?.rooms.length ? (
            <p className="mt-1 text-ink3">{sample.rooms.map((room) => room.room_id).join(', ')}</p>
          ) : (
            <p className="mt-1 text-ink3">No rooms assigned yet today.</p>
          )}
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <h2 className="font-semibold text-ink">Inspection quality trends</h2>
        <p className="mt-1 text-sm text-ink3">{quality?.sample_size ?? 0} recent inspections, broken down by result, item, room type, and employee.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {(['by_item', 'by_room_type', 'by_employee'] as const).map((dimension) => (
            <div key={dimension} className="rounded-lg border border-line bg-surface p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink4">{dimension.replace('by_', '').replace('_', ' ')}</p>
              <ul className="mt-2 space-y-1 text-sm text-ink2">
                {(quality?.[dimension] ?? []).map((entry) => (
                  <li key={entry.key} className="flex justify-between gap-2">
                    <span>{entry.key}</span>
                    <span className="text-ink3">
                      {entry.count} {typeof entry.pass_rate === 'number' ? `(${Math.round(entry.pass_rate * 100)}% pass)` : ''}
                    </span>
                  </li>
                ))}
                {!quality?.[dimension]?.length ? <li className="text-ink4">No data yet.</li> : null}
              </ul>
            </div>
          ))}
        </div>
      </Card>
    </section>
  )
}
