'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { useHotelStore } from '@/stores/hotelStore'
import { hotelsApi } from '@/lib/api/hotels'
import {
  EMPTY_PROFILE, formatTimezoneNow, propertyProfileSchema, timezoneOptions, toFormValues, toUpdatePayload,
  type PropertyProfileValues,
} from '@/lib/settings/propertyProfile'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { SettingsCard } from '@/components/settings/workspace/SettingsCard'
import { SettingsSectionHeader } from '@/components/settings/workspace/SettingsSectionHeader'
import { SettingsActionFooter } from '@/components/settings/workspace/SettingsActionFooter'
import { SettingsError } from '@/components/settings/workspace/SettingsStates'
import { UnsavedChangesGuard } from '@/components/settings/workspace/UnsavedChangesGuard'
import { SettingsField as Field, SettingsSelect, controlA11y } from '@/components/settings/workspace/SettingsFormControls'
import { cn } from '@/lib/utils'

function ProfileSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading property profile">
      {[2, 4, 2, 1, 1].map((rows, i) => (
        <div key={i} className="space-y-4 rounded-[var(--r-lg)] border border-line bg-surface p-5">
          <Skeleton className="h-5 w-40" />
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: rows }).map((_, j) => <Skeleton key={j} className="h-9 w-full" />)}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function PropertyProfilePage() {
  const { hotel, setHotel } = useHotelStore()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)

  const hotelKey = useMemo(() => ['hotel-full', hotel?.id], [hotel?.id])
  const { data: fullHotel, isLoading, isError, refetch } = useQuery({
    queryKey: hotelKey,
    queryFn: () => hotelsApi.get(hotel!.id),
    enabled: !!hotel?.id,
    select: (res) => res.data,
  })

  // Real room count = rooms in the inventory (not the number typed at onboarding).
  const { data: stats } = useQuery({
    queryKey: ['hotel-stats', hotel?.id],
    queryFn: () => hotelsApi.getStats(hotel!.id),
    enabled: !!hotel?.id,
    select: (res) => res.data,
  })

  const {
    register, handleSubmit, reset, control, formState: { errors, isDirty },
  } = useForm<PropertyProfileValues>({
    resolver: zodResolver(propertyProfileSchema),
    defaultValues: EMPTY_PROFILE,
  })
  const timezone = useWatch({ control, name: 'timezone' })

  // Hydrate once so a background refetch can never wipe in-progress edits.
  useEffect(() => {
    if (fullHotel && !hydrated) {
      reset(toFormValues(fullHotel))
      setHydrated(true)
    }
  }, [fullHotel, hydrated, reset])

  const onSubmit = useCallback(async (values: PropertyProfileValues) => {
    if (!hotel?.id || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      const res = await hotelsApi.update(hotel.id, toUpdatePayload(values))
      const updated = res.data
      queryClient.setQueryData(hotelKey, res) // so Discard restores the *saved* values, not stale ones
      setHotel({ ...hotel, name: updated.name, timezone: updated.timezone, room_count: updated.room_count, logo_url: updated.logo_url })
      reset(values)
      toast.success('Property profile saved.')
    } catch (err) {
      // Keep every edit in the form so the user can fix the problem and retry.
      const message = err instanceof Error && err.message ? err.message : 'Could not save. Please try again.'
      setSaveError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }, [hotel, hotelKey, queryClient, reset, saving, setHotel, toast])

  const discard = useCallback(() => {
    if (fullHotel) reset(toFormValues(fullHotel))
    setSaveError(null)
  }, [fullHotel, reset])

  if (isError && !fullHotel) {
    return <SettingsError message="We couldn't load the property profile." onRetry={() => refetch()} />
  }
  if (isLoading || !hydrated) return <ProfileSkeleton />

  const roomCount = stats?.room_count
  const localNow = formatTimezoneNow(timezone)

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="max-w-3xl space-y-4">
      <UnsavedChangesGuard dirty={isDirty} />
      <SettingsSectionHeader
        level={1}
        title="Property Profile"
        description="Manage your hotel's identity and property information."
      />

      <SettingsCard aria-labelledby="pp-identity">
        <h2 id="pp-identity" className="mb-4 text-sm font-semibold text-ink">Property identity</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="pp-name" label="Hotel name" error={errors.name?.message}>
            <Input {...register('name')} {...controlA11y('pp-name', { error: errors.name?.message })} autoComplete="organization" />
          </Field>
          <Field id="pp-phone" label="Phone number" error={errors.phone?.message}>
            <Input {...register('phone')} {...controlA11y('pp-phone', { error: errors.phone?.message })} type="tel" autoComplete="tel" placeholder="+1 (555) 555-0100" />
          </Field>
        </div>
      </SettingsCard>

      <SettingsCard aria-labelledby="pp-address">
        <h2 id="pp-address" className="mb-4 text-sm font-semibold text-ink">Property address</h2>
        <div className="grid grid-cols-6 gap-4">
          <Field id="pp-street" label="Street address" error={errors.address?.message} className="col-span-6">
            <Input {...register('address')} {...controlA11y('pp-street', { error: errors.address?.message })} autoComplete="street-address" />
          </Field>
          <Field id="pp-city" label="City" error={errors.city?.message} className="col-span-6 sm:col-span-3">
            <Input {...register('city')} {...controlA11y('pp-city', { error: errors.city?.message })} autoComplete="address-level2" />
          </Field>
          <Field id="pp-state" label="State" error={errors.state?.message} className="col-span-2 sm:col-span-1">
            <Input {...register('state')} {...controlA11y('pp-state', { error: errors.state?.message })} maxLength={2} autoComplete="address-level1" placeholder="TX" />
          </Field>
          <Field id="pp-zip" label="ZIP / postal code" error={errors.zip?.message} className="col-span-4 sm:col-span-2">
            <Input {...register('zip')} {...controlA11y('pp-zip', { error: errors.zip?.message })} inputMode="numeric" autoComplete="postal-code" />
          </Field>
        </div>
      </SettingsCard>

      <SettingsCard aria-labelledby="pp-regional">
        <h2 id="pp-regional" className="mb-4 text-sm font-semibold text-ink">Regional settings</h2>
        <Field
          id="pp-timezone"
          label="Property timezone"
          error={errors.timezone?.message}
          hint="Decides where each hotel day starts and ends. Operational dates, shift handoffs, daily reports, scheduled summaries and Management ROI periods all follow this timezone."
        >
          <SettingsSelect
            {...register('timezone')}
            {...controlA11y('pp-timezone', { error: errors.timezone?.message, hint: true })}
            className="max-w-sm"
          >
            {timezoneOptions(fullHotel?.timezone ?? timezone).map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </SettingsSelect>
        </Field>
        {localNow && <p className="mt-2 text-xs text-ink-3">Right now at the property: {localNow}</p>}
      </SettingsCard>

      <SettingsCard aria-labelledby="pp-inventory">
        <h2 id="pp-inventory" className="mb-1 text-sm font-semibold text-ink">Property inventory</h2>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-ink">
              <span className="font-semibold" aria-live="polite">{roomCount != null ? roomCount : '—'}</span>{' '}
              {roomCount === 1 ? 'room' : 'rooms'} in your inventory
              <span className="ml-2 rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-medium text-ink-3">Read-only</span>
            </p>
            <p className="mt-0.5 text-xs text-ink-3">Counted from the rooms you manage, so it always matches housekeeping and engineering.</p>
          </div>
          <Link
            href="/settings/rooms"
            className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] lg:min-h-[32px]"
          >
            Rooms &amp; Accessibility <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
      </SettingsCard>

      <SettingsCard aria-labelledby="pp-financial">
        <h2 id="pp-financial" className="mb-4 text-sm font-semibold text-ink">Financial assumptions</h2>
        <Field
          id="pp-adr"
          label="Average daily rate (ADR)"
          error={errors.average_daily_rate?.message}
          hint="Optional. Management ROI uses it to estimate the revenue impact of room downtime (hours out of order × ADR ÷ 24). Leave blank to show no dollar estimate."
          className="max-w-xs"
        >
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-3" aria-hidden="true">$</span>
            <Input
              {...register('average_daily_rate', { setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)) })}
              {...controlA11y('pp-adr', { error: errors.average_daily_rate?.message, hint: true })}
              type="number" inputMode="decimal" min={0} max={100000} step="0.01" placeholder="129.00"
              className={cn('pl-6', errors.average_daily_rate && 'border-[var(--alert)]')}
            />
          </div>
        </Field>
      </SettingsCard>

      {isDirty && (
        <div className="sticky bottom-0 z-10 -mx-1 overflow-hidden rounded-[var(--r-lg)] border border-line shadow-lg">
          <SettingsActionFooter
            dirty={isDirty}
            saving={saving}
            error={saveError}
            onDiscard={discard}
            onSave={() => { void handleSubmit(onSubmit)() }}
            saveLabel="Save changes"
            discardLabel="Discard changes"
            className="border-t-0"
          />
        </div>
      )}
    </form>
  )
}
