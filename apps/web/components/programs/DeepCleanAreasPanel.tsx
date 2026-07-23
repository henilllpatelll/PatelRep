'use client'

// Deep-clean schedules + public areas (04-07 / HK-01). Split out of
// HousekeepingDepthPanels.tsx to keep every file under the project's
// 500-line limit (CLAUDE.md) while still covering the full 4B depth surface.

import { FormEvent, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CalendarClock, CheckCircle2, ClipboardList, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { useRole } from '@/lib/hooks/useRole'
import { roomsApi } from '@/lib/api/rooms'
import { programsApi } from '@/lib/api/programs'

// Shared with ProgramsPage's own overview query -- same key means React
// Query dedupes the network call across every component that reads it.
const OVERVIEW_KEY = ['operational-programs']

interface RoomOption {
  id: string
  room_number: string
}

export function DeepCleanAreasPanel() {
  const { t } = useTranslation()
  const { isSupervisor, canViewEngineering } = useRole()
  // Union of gm/housekeeping_supervisor/engineer/chief_engineer -- exactly
  // matches apps/api/routers/programs.py's MANAGER_ROLES (both the
  // deep-clean-schedule and public-area create routes use this set).
  const isManager = isSupervisor || canViewEngineering

  const queryClient = useQueryClient()
  const invalidateOverview = () => queryClient.invalidateQueries({ queryKey: OVERVIEW_KEY })

  const overview = useQuery({ queryKey: OVERVIEW_KEY, queryFn: programsApi.overview, enabled: isManager })
  const data = overview.data?.data

  const roomsQuery = useQuery({
    queryKey: ['programs-depth-rooms'],
    queryFn: () => roomsApi.list(),
    enabled: isManager,
  })
  const roomOptions: RoomOption[] = ((roomsQuery.data?.data ?? []) as any[])
    .map((row) => ({ id: row.rooms?.id as string, room_number: row.rooms?.room_number as string }))
    .filter((room) => Boolean(room.id))

  const [deepCleanForm, setDeepCleanForm] = useState({
    target_type: 'room' as 'room' | 'public_area',
    room_id: '',
    public_area_id: '',
    interval_days: 90,
    next_due_on: new Date().toISOString().slice(0, 10),
  })
  const createDeepClean = useMutation({
    mutationFn: programsApi.createDeepCleanSchedule,
    onSuccess: () => {
      invalidateOverview()
      setDeepCleanForm((current) => ({ ...current, room_id: '', public_area_id: '' }))
    },
  })
  const completeDeepClean = useMutation({
    mutationFn: (scheduleId: string) => programsApi.completeDeepClean(scheduleId, {}),
    onSuccess: invalidateOverview,
  })
  const submitDeepClean = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (deepCleanForm.target_type === 'room' && !deepCleanForm.room_id) return
    if (deepCleanForm.target_type === 'public_area' && !deepCleanForm.public_area_id) return
    createDeepClean.mutate({
      target_type: deepCleanForm.target_type,
      room_id: deepCleanForm.target_type === 'room' ? deepCleanForm.room_id : undefined,
      public_area_id: deepCleanForm.target_type === 'public_area' ? deepCleanForm.public_area_id : undefined,
      interval_days: deepCleanForm.interval_days,
      next_due_on: deepCleanForm.next_due_on,
    })
  }

  const [publicAreaForm, setPublicAreaForm] = useState({ name: '', location_detail: '' })
  const createPublicArea = useMutation({
    mutationFn: programsApi.createPublicArea,
    onSuccess: () => {
      invalidateOverview()
      setPublicAreaForm({ name: '', location_detail: '' })
    },
  })
  const submitPublicArea = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!publicAreaForm.name.trim()) return
    createPublicArea.mutate({
      name: publicAreaForm.name.trim(),
      location_detail: publicAreaForm.location_detail.trim() || undefined,
    })
  }

  // All hooks above must run unconditionally (Rules of Hooks) -- the
  // manager gate only affects what renders, never how many hooks fire.
  if (!isManager) return null

  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <Card className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-5 w-5 text-accent" />
          <div>
            <h2 className="font-semibold text-ink">{t('programs.deepClean.title')}</h2>
            <p className="mt-1 text-sm text-ink3">{t('programs.deepClean.subtitle')}</p>
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {(data?.deep_clean_schedules ?? []).map((schedule) => (
            <div key={schedule.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-sm">
              <div>
                <p className="font-medium text-ink">
                  {schedule.target_type === 'room' ? schedule.rooms?.room_number ?? t('programs.deepClean.room') : schedule.public_areas?.name ?? t('programs.deepClean.publicArea')}
                </p>
                <p className="text-ink3">
                  {t('programs.deepClean.everyDays', { count: schedule.interval_days })} &middot; {t('programs.deepClean.nextDueLabel', { date: schedule.next_due_on })}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={completeDeepClean.isPending}
                onClick={() => completeDeepClean.mutate(schedule.id)}
                className="min-h-9"
              >
                <CheckCircle2 className="h-4 w-4" /> {t('programs.deepClean.markComplete')}
              </Button>
            </div>
          ))}
          {!data?.deep_clean_schedules?.length && !overview.isLoading ? (
            <p className="text-sm text-ink3">{t('programs.deepClean.noSchedules')}</p>
          ) : null}
        </div>
        <form className="mt-4 grid gap-2 sm:grid-cols-2" onSubmit={submitDeepClean}>
          <select
            aria-label={t('programs.deepClean.targetType')}
            value={deepCleanForm.target_type}
            onChange={(event) => setDeepCleanForm((current) => ({ ...current, target_type: event.target.value as 'room' | 'public_area' }))}
            className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm text-ink"
          >
            <option value="room">{t('programs.deepClean.room')}</option>
            <option value="public_area">{t('programs.deepClean.publicArea')}</option>
          </select>
          {deepCleanForm.target_type === 'room' ? (
            <select
              aria-label={t('programs.deepClean.room')}
              value={deepCleanForm.room_id}
              onChange={(event) => setDeepCleanForm((current) => ({ ...current, room_id: event.target.value }))}
              className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm text-ink"
            >
              <option value="">{t('programs.deepClean.chooseRoom')}</option>
              {roomOptions.map((room) => (
                <option key={room.id} value={room.id}>{room.room_number}</option>
              ))}
            </select>
          ) : (
            <select
              aria-label={t('programs.deepClean.publicArea')}
              value={deepCleanForm.public_area_id}
              onChange={(event) => setDeepCleanForm((current) => ({ ...current, public_area_id: event.target.value }))}
              className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm text-ink"
            >
              <option value="">{t('programs.deepClean.choosePublicArea')}</option>
              {(data?.public_areas ?? []).map((area) => (
                <option key={area.id} value={area.id}>{area.name}</option>
              ))}
            </select>
          )}
          <Input
            aria-label={t('programs.deepClean.intervalDaysLabel')}
            type="number"
            min={1}
            max={3650}
            value={deepCleanForm.interval_days}
            onChange={(event) => setDeepCleanForm((current) => ({ ...current, interval_days: Number(event.target.value) }))}
            className="min-h-11"
          />
          <Input
            aria-label={t('programs.deepClean.nextDueOnLabel')}
            type="date"
            value={deepCleanForm.next_due_on}
            onChange={(event) => setDeepCleanForm((current) => ({ ...current, next_due_on: event.target.value }))}
            className="min-h-11"
          />
          <Button type="submit" disabled={createDeepClean.isPending} className="min-h-11 sm:col-span-2">
            <CalendarClock className="h-4 w-4" /> {t('programs.deepClean.addSchedule')}
          </Button>
        </form>
      </Card>

      <Card className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <ClipboardList className="mt-0.5 h-5 w-5 text-accent" />
          <div>
            <h2 className="font-semibold text-ink">{t('programs.deepClean.publicAreasTitle')}</h2>
            <p className="mt-1 text-sm text-ink3">{t('programs.deepClean.publicAreasSubtitle')}</p>
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {(data?.public_areas ?? []).map((area) => (
            <div key={area.id} className="rounded-lg border border-line bg-surface px-3 py-2.5 text-sm">
              <p className="font-medium text-ink">{area.name}</p>
              {area.location_detail ? <p className="text-ink3">{area.location_detail}</p> : null}
            </div>
          ))}
          {!data?.public_areas?.length && !overview.isLoading ? (
            <p className="text-sm text-ink3">{t('programs.deepClean.noPublicAreas')}</p>
          ) : null}
        </div>
        <form className="mt-4 grid gap-2 sm:grid-cols-2" onSubmit={submitPublicArea}>
          <Input
            aria-label={t('programs.deepClean.publicAreaNamePlaceholder')}
            placeholder={t('programs.deepClean.publicAreaNamePlaceholder')}
            value={publicAreaForm.name}
            onChange={(event) => setPublicAreaForm((current) => ({ ...current, name: event.target.value }))}
            className="min-h-11"
          />
          <Input
            aria-label={t('programs.deepClean.locationDetailPlaceholder')}
            placeholder={t('programs.deepClean.locationDetailPlaceholder')}
            value={publicAreaForm.location_detail}
            onChange={(event) => setPublicAreaForm((current) => ({ ...current, location_detail: event.target.value }))}
            className="min-h-11"
          />
          <Button type="submit" disabled={createPublicArea.isPending} className="min-h-11 sm:col-span-2">
            {t('programs.deepClean.addPublicArea')}
          </Button>
        </form>
      </Card>
    </section>
  )
}
