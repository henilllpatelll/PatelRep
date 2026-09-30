'use client'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { hotelsApi, type HousekeepingSettings } from '@/lib/api/hotels'
import { staffApi, type StaffMember } from '@/lib/api/staff'
import { useHotelStore } from '@/stores/hotelStore'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { StateBlock } from '@/components/ui/StateBlock'
import { useToast } from '@/components/ui/Toast'

const EMPTY: HousekeepingSettings = { default_target_credits: 16, credit_weights: { DEP: 3, FULL: 2, LIGHT: 1 }, capacity_overrides: {}, assignment_preferences: { prioritize_guest_waiting: true, prioritize_rush: true, prioritize_earliest_arrival: true, balance_workload: true, minimize_reassignment: true, avoid_on_break: true, exclude_off_shift: true, exclude_unavailable: true, prefer_same_building: true, prefer_same_floor: true } }

export function HousekeepingWorkloadSettings() {
  const { t } = useTranslation(); const { hotel } = useHotelStore(); const toast = useToast(); const queryClient = useQueryClient()
  const [draft, setDraft] = useState<HousekeepingSettings>(EMPTY); const [hydrated, setHydrated] = useState(false); const [error, setError] = useState<string | null>(null)
  const { data, isLoading, isError } = useQuery({ queryKey: ['housekeeping-settings', hotel?.id], queryFn: () => hotelsApi.getHousekeepingSettings(hotel!.id), enabled: !!hotel?.id })
  const { data: staffData } = useQuery({ queryKey: ['staff-list'], queryFn: () => staffApi.list() })
  useEffect(() => { if (data?.data && !hydrated) { setDraft(data.data); setHydrated(true) } }, [data, hydrated])
  const save = useMutation({ mutationFn: () => hotelsApi.updateHousekeepingSettings(hotel!.id, draft), onSuccess: (result) => { setDraft(result.data); queryClient.setQueryData(['housekeeping-settings', hotel?.id], result); toast.success(t('housekeeping.settings.saved')) }, onError: () => setError(t('housekeeping.settings.saveError')) })
  const setTarget = (value: string) => { const target = Number(value); if (!Number.isFinite(target) || target <= 0 || target > 100) { setError(t('housekeeping.settings.invalidTarget')); return }; setError(null); setDraft((v) => ({ ...v, default_target_credits: target })) }
  const setWeight = (type: keyof HousekeepingSettings['credit_weights'], value: string) => { const weight = Number(value); if (!Number.isFinite(weight) || weight < 0 || weight > 10) { setError(t('housekeeping.settings.invalidWeight')); return }; setError(null); setDraft((v) => ({ ...v, credit_weights: { ...v.credit_weights, [type]: weight } })) }
  const staff = ((staffData?.data.staff ?? []) as StaffMember[]).filter((member) => member.role === 'housekeeper')
  return <StateBlock status={isLoading ? 'loading' : isError ? 'error' : null} loadingLabel={t('housekeeping.settings.loading')} error={{ message: t('housekeeping.settings.loadError') }}><div className="space-y-4">
    <Card className="space-y-4"><div><h3 className="font-semibold text-ink">{t('housekeeping.settings.defaultTarget')}</h3><p className="mt-1 text-sm text-ink3">{t('housekeeping.settings.defaultTargetDescription')}</p></div><label className="block max-w-xs text-sm font-medium text-ink" htmlFor="default-target">{t('housekeeping.settings.creditsPerAttendant')}<input id="default-target" name="default-target" type="number" min="0.5" max="100" step="0.5" value={draft.default_target_credits} onChange={(event) => setTarget(event.target.value)} aria-invalid={!!error} className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-accent" /></label></Card>
    <Card className="space-y-3"><div><h3 className="font-semibold text-ink">{t('housekeeping.settings.cleanTypeWeights')}</h3><p className="mt-1 text-sm text-ink3">{t('housekeeping.settings.cleanTypeWeightsDescription')}</p></div>{(['DEP', 'FULL', 'LIGHT'] as const).map((type) => <label key={type} className="flex items-center justify-between gap-4 text-sm font-medium text-ink" htmlFor={`weight-${type}`}><span>{t(`housekeeping.settings.weights.${type}`)}</span><input id={`weight-${type}`} type="number" min="0" max="10" step="0.25" value={draft.credit_weights[type]} onChange={(event) => setWeight(type, event.target.value)} aria-invalid={!!error} className="w-28 rounded-lg border border-line bg-surface px-3 py-2 text-right text-ink focus:outline-none focus:ring-2 focus:ring-accent" /></label>)}</Card>
    <Card className="space-y-3"><div><h3 className="font-semibold text-ink">{t('housekeeping.settings.staffOverrides')}</h3><p className="mt-1 text-sm text-ink3">{t('housekeeping.settings.staffOverridesDescription')}</p></div>{staff.length === 0 ? <p className="text-sm text-ink3">{t('housekeeping.settings.noHousekeepers')}</p> : staff.map((member) => <label key={member.user_id} className="flex items-center justify-between gap-4 text-sm text-ink" htmlFor={`override-${member.user_id}`}><span>{member.full_name}</span><input id={`override-${member.user_id}`} type="number" min="0" max="100" step="0.5" placeholder={t('housekeeping.settings.usesHotelDefault')} value={draft.capacity_overrides[member.user_id] ?? ''} onChange={(event) => setDraft((current) => { const overrides = { ...current.capacity_overrides }; if (!event.target.value) delete overrides[member.user_id]; else overrides[member.user_id] = Number(event.target.value); return { ...current, capacity_overrides: overrides } })} className="w-40 rounded-lg border border-line bg-surface px-3 py-2 text-right text-ink placeholder:text-ink3 focus:outline-none focus:ring-2 focus:ring-accent" /></label>)}</Card>
    {error && <p role="alert" className="text-sm text-alert">{error}</p>}<Button type="button" variant="primary" onClick={() => { setError(null); save.mutate() }} disabled={save.isPending}>{save.isPending ? t('common.saving') : t('common.saveChanges')}</Button>
  </div></StateBlock>
}
