'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'
import { useHotelStore } from '@/stores/hotelStore'
import { hotelsApi } from '@/lib/api/hotels'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

// ─── Schema ───────────────────────────────────────────────────────────────────

const hotelProfileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  address: z.string().min(5, 'Address is required'),
  city: z.string().min(2, 'City is required'),
  state: z.string().length(2, 'Use 2-letter state code (e.g. TX)'),
  zip: z.string().regex(/^\d{5}(-\d{4})?$/, 'Enter a valid ZIP code'),
  phone: z.string().regex(/^\+?[\d\s\-().]{7,20}$/, 'Enter a valid phone number'),
  timezone: z.string().min(1, 'Timezone is required'),
  room_count: z
    .number({ invalid_type_error: 'Must be a number' })
    .int()
    .min(1, 'Must be at least 1 room')
    .max(999, 'Max 999 rooms'),
})

type HotelProfileFormValues = z.infer<typeof hotelProfileSchema>

// ─── Constants ────────────────────────────────────────────────────────────────

const US_TIMEZONES = [
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Phoenix', label: 'Arizona (no DST)' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (HT)' },
]

// ─── Sub-components ───────────────────────────────────────────────────────────

function FormField({
  id,
  label,
  error,
  children,
}: {
  id?: string
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-stone-700">
        {label}
      </label>
      {children}
      {error && <p className="text-xs text-[var(--alert)]">{error}</p>}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function GeneralSettingsPage() {
  const { hotel, setHotel } = useHotelStore()
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const hydratedRef = useRef(false)

  const { data: fullHotel } = useQuery({
    queryKey: ['hotel-full', hotel?.id],
    queryFn: () => hotelsApi.get(hotel!.id),
    enabled: !!hotel?.id,
    select: res => res.data,
  })

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<HotelProfileFormValues>({
    resolver: zodResolver(hotelProfileSchema),
    defaultValues: {
      name: '',
      address: '',
      city: '',
      state: '',
      zip: '',
      phone: '',
      timezone: 'America/Chicago',
      room_count: 50,
    },
  })

  // One-time hydration guard — prevents form reset wiping user's in-progress edits
  useEffect(() => {
    if (fullHotel && !hydratedRef.current) {
      reset({
        name: fullHotel.name ?? '',
        address: fullHotel.address ?? '',
        city: fullHotel.city ?? '',
        state: fullHotel.state ?? '',
        zip: fullHotel.zip ?? '',
        phone: fullHotel.phone ?? '',
        timezone: fullHotel.timezone ?? 'America/Chicago',
        room_count: fullHotel.room_count ?? 50,
      })
      hydratedRef.current = true
    }
  }, [fullHotel, reset])

  // Auto-dismiss toast after 3 seconds
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(timer)
  }, [toast])

  const onSubmit = useCallback(
    async (values: HotelProfileFormValues) => {
      if (!hotel?.id) return
      setSaving(true)
      try {
        const res = await hotelsApi.update(hotel.id, values)
        const updated = res.data
        setHotel({
          id: hotel.id,
          name: updated.name,
          timezone: updated.timezone,
          room_count: updated.room_count,
          logo_url: updated.logo_url,
        })
        reset(values)
        setToast({ type: 'success', message: 'Hotel profile saved successfully.' })
      } catch (err: any) {
        setToast({ type: 'error', message: err.message || 'Failed to save. Please try again.' })
      } finally {
        setSaving(false)
      }
    },
    [hotel, setHotel, reset],
  )

  return (
    <div className="space-y-6 max-w-2xl">
      {toast && (
        <div
          role="alert"
          className={`flex items-center gap-3 px-4 py-3 rounded-lg border text-sm font-medium ${
            toast.type === 'success'
              ? 'bg-[var(--ready-soft)] border-[var(--ready-line)] text-green-800'
              : 'bg-[var(--alert-soft)] border-[var(--alert-line)] text-red-800'
          }`}
        >
          <CheckCircle2
            size={16}
            className={toast.type === 'success' ? 'text-[var(--ready)]' : 'text-[var(--alert)]'}
          />
          {toast.message}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <Card className="p-6 space-y-5">
          <h2 className="text-base font-semibold text-stone-900">Hotel Profile</h2>

          <FormField id="settings-hotel-name" label="Hotel Name" error={errors.name?.message}>
            <Input
              id="settings-hotel-name"
              {...register('name')}
              placeholder="Sunrise Inn & Suites"
              className={errors.name ? 'border-red-300 focus:ring-red-500' : undefined}
            />
          </FormField>

          <FormField id="settings-address" label="Address" error={errors.address?.message}>
            <Input
              id="settings-address"
              {...register('address')}
              placeholder="1234 Main Street"
              className={errors.address ? 'border-red-300 focus:ring-red-500' : undefined}
            />
          </FormField>

          <div className="grid grid-cols-3 sm:grid-cols-6 gap-4">
            <div className="col-span-3">
              <FormField id="settings-city" label="City" error={errors.city?.message}>
                <Input
                  id="settings-city"
                  {...register('city')}
                  placeholder="San Antonio"
                  className={errors.city ? 'border-red-300 focus:ring-red-500' : undefined}
                />
              </FormField>
            </div>
            <div className="col-span-1 sm:col-span-1">
              <FormField id="settings-state" label="State" error={errors.state?.message}>
                <Input
                  id="settings-state"
                  {...register('state')}
                  placeholder="TX"
                  maxLength={2}
                  className={errors.state ? 'border-red-300 focus:ring-red-500' : undefined}
                />
              </FormField>
            </div>
            <div className="col-span-2">
              <FormField id="settings-zip" label="ZIP Code" error={errors.zip?.message}>
                <Input
                  id="settings-zip"
                  {...register('zip')}
                  placeholder="78201"
                  className={errors.zip ? 'border-red-300 focus:ring-red-500' : undefined}
                />
              </FormField>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField id="settings-phone" label="Phone" error={errors.phone?.message}>
              <Input
                id="settings-phone"
                {...register('phone')}
                type="tel"
                placeholder="+1 (210) 555-0100"
                className={errors.phone ? 'border-red-300 focus:ring-red-500' : undefined}
              />
            </FormField>

            <FormField id="settings-room-count" label="Room Count" error={errors.room_count?.message}>
              <Input
                id="settings-room-count"
                {...register('room_count', { valueAsNumber: true })}
                type="number"
                min={1}
                max={999}
                placeholder="85"
                className={errors.room_count ? 'border-red-300 focus:ring-red-500' : undefined}
              />
            </FormField>
          </div>

          <FormField id="settings-timezone" label="Timezone" error={errors.timezone?.message}>
            <select
              id="settings-timezone"
              {...register('timezone')}
              className={`w-full px-3 py-2 text-sm border rounded-lg bg-surface text-ink2 focus:outline-none focus:ring-2 focus:border-transparent transition-colors appearance-none cursor-pointer ${
                errors.timezone
                  ? 'border-red-300 focus:ring-red-500'
                  : 'border-line hover:border-[var(--caution-line)] focus:ring-amber-400'
              }`}
            >
              {US_TIMEZONES.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </FormField>
        </Card>

        <div className="flex items-center justify-end gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              fullHotel &&
              reset({
                name: fullHotel.name ?? '',
                address: fullHotel.address ?? '',
                city: fullHotel.city ?? '',
                state: fullHotel.state ?? '',
                zip: fullHotel.zip ?? '',
                phone: fullHotel.phone ?? '',
                timezone: fullHotel.timezone ?? 'America/Chicago',
                room_count: fullHotel.room_count ?? 50,
              })
            }
            disabled={!isDirty || saving}
          >
            Discard
          </Button>
          <Button type="submit" variant="primary" disabled={!isDirty || saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </div>
  )
}
