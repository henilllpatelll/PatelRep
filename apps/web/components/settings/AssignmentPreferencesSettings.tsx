'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { hotelsApi, type AssignmentPreferences } from '@/lib/api/hotels'
import { useHotelStore } from '@/stores/hotelStore'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { StateBlock } from '@/components/ui/StateBlock'
import { useToast } from '@/components/ui/Toast'

const DEFAULTS: AssignmentPreferences = {
  prioritize_guest_waiting: true, prioritize_rush: true, prioritize_earliest_arrival: true,
  balance_workload: true, minimize_reassignment: true,
  avoid_on_break: true, exclude_off_shift: true, exclude_unavailable: true,
  prefer_same_building: true, prefer_same_floor: true,
}

const GROUPS: Array<{ title: string; items: Array<keyof AssignmentPreferences> }> = [
  { title: 'priority', items: ['prioritize_guest_waiting', 'prioritize_rush', 'prioritize_earliest_arrival'] },
  { title: 'workload', items: ['balance_workload', 'minimize_reassignment'] },
  { title: 'availability', items: ['avoid_on_break', 'exclude_off_shift', 'exclude_unavailable'] },
  { title: 'location', items: ['prefer_same_building', 'prefer_same_floor'] },
]

export function AssignmentPreferencesSettings() {
  const { t } = useTranslation()
  const { hotel } = useHotelStore()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<AssignmentPreferences>(DEFAULTS)
  const [hydrated, setHydrated] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['housekeeping-settings', hotel?.id], queryFn: () => hotelsApi.getHousekeepingSettings(hotel!.id), enabled: !!hotel?.id,
  })
  useEffect(() => {
    if (data?.data.assignment_preferences && !hydrated) {
      setDraft(data.data.assignment_preferences)
      setHydrated(true)
    }
  }, [data, hydrated])
  const save = useMutation({
    mutationFn: () => hotelsApi.updateHousekeepingSettings(hotel!.id, { assignment_preferences: draft }),
    onSuccess: (result) => {
      setDraft(result.data.assignment_preferences)
      queryClient.setQueryData(['housekeeping-settings', hotel?.id], result)
      toast.success(t('housekeeping.settings.saved'))
    },
    onError: () => setSaveError(t('housekeeping.settings.saveError')),
  })

  return (
    <StateBlock status={isLoading ? 'loading' : isError ? 'error' : null} loadingLabel={t('housekeeping.settings.loading')} error={{ message: t('housekeeping.settings.loadError'), onRetry: refetch }}>
      <div className="space-y-4">
        <div><h3 className="font-semibold text-ink">{t('housekeeping.settings.assignment.title')}</h3><p className="mt-1 max-w-2xl text-sm text-ink3">{t('housekeeping.settings.assignment.description')}</p></div>
        {GROUPS.map((group) => (
          <Card key={group.title} className="space-y-2.5">
            <h4 className="text-sm font-semibold text-ink">{t(`housekeeping.settings.assignment.groups.${group.title}`)}</h4>
            {group.items.map((key) => (
              <label key={key} className="flex cursor-pointer items-start gap-3 rounded-[var(--r-sm)] py-1 text-sm text-ink">
                <input type="checkbox" checked={draft[key]} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.checked }))} className="mt-0.5 h-4 w-4 rounded border-line text-accent focus:ring-accent" />
                <span><span className="font-medium">{t(`housekeeping.settings.assignment.options.${key}.label`)}</span><span className="mt-0.5 block text-xs leading-5 text-ink3">{t(`housekeeping.settings.assignment.options.${key}.description`)}</span></span>
              </label>
            ))}
          </Card>
        ))}
        {saveError && <p role="alert" className="text-sm text-alert">{saveError}</p>}
        <Button type="button" variant="primary" onClick={() => { setSaveError(null); save.mutate() }} disabled={save.isPending}>{save.isPending ? t('common.saving') : t('common.saveChanges')}</Button>
      </div>
    </StateBlock>
  )
}
