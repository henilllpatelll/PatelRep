'use client'

import { useState, useEffect, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { useHotelStore } from '@/stores/hotelStore'
import { hotelsApi } from '@/lib/api/hotels'
import { AlertTriangle, CheckCircle2, Building2, Layers } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

// ─── Schema ───────────────────────────────────────────────────────────────────

const hotelProfileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  address: z.string().min(5, 'Address is required'),
  city: z.string().min(2, 'City is required'),
  state: z.string().length(2, 'Use 2-letter state code (e.g. TX)'),
  zip: z
    .string()
    .regex(/^\d{5}(-\d{4})?$/, 'Enter a valid ZIP code'),
  phone: z
    .string()
    .regex(/^\+?[\d\s\-().]{7,20}$/, 'Enter a valid phone number'),
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

const DEPARTMENTS = [
  { name: 'Housekeeping', color: 'bg-teal-500', description: 'Room cleaning and laundry' },
  { name: 'Engineering', color: 'bg-sky-500', description: 'Maintenance and repairs' },
  { name: 'Front Desk', color: 'bg-amber-500', description: 'Guest services and check-in' },
  { name: 'Management', color: 'bg-violet-500', description: 'Hotel operations and oversight' },
]

type Tab = 'general' | 'departments'

// ─── Sub-components ───────────────────────────────────────────────────────────

function FormField({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      {children}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

function Input({
  error,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { error?: boolean }) {
  return (
    <input
      {...props}
      className={`w-full px-3 py-2 text-sm border rounded-lg bg-white/70 focus:outline-none focus:ring-2 focus:border-transparent transition-colors ${
        error
          ? 'border-red-300 focus:ring-red-500'
          : 'border-amber-200/40 hover:border-amber-200 focus:ring-amber-400/50 focus:border-amber-200'
      }`}
    />
  )
}

// ─── Settings Page ────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('general')
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const { hotel, setHotel } = useHotelStore()

  // Fetch full hotel profile (store only has id/name/timezone/room_count)
  const { data: fullHotel } = useQuery({
    queryKey: ['hotel-full', hotel?.id],
    queryFn: () => hotelsApi.get(hotel!.id),
    enabled: !!hotel?.id,
    select: (res) => res.data,
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

  // Populate form from full hotel data fetched from API
  useEffect(() => {
    if (fullHotel) {
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
        reset(values) // clear dirty state
        setToast({ type: 'success', message: 'Hotel profile saved successfully.' })
      } catch (err: any) {
        setToast({ type: 'error', message: err.message || 'Failed to save. Please try again.' })
      } finally {
        setSaving(false)
      }
    },
    [hotel, setHotel, reset]
  )

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: 'general', label: 'General', icon: Building2 },
    { key: 'departments', label: 'Departments', icon: Layers },
  ]

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your hotel profile and configuration.</p>
      </div>

      {/* Toast notification */}
      {toast && (
        <div
          className={`flex items-center gap-3 px-4 py-3 rounded-lg border text-sm font-medium transition-all ${
            toast.type === 'success'
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
          role="alert"
        >
          <CheckCircle2
            size={16}
            className={toast.type === 'success' ? 'text-green-600' : 'text-red-600'}
          />
          {toast.message}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === key
                ? 'border-amber-200 text-amber-700'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {/* General Tab */}
      {activeTab === 'general' && (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <Card className="p-6 space-y-5">
            <h2 className="text-base font-semibold text-slate-900">Hotel Profile</h2>

            <FormField label="Hotel Name" error={errors.name?.message}>
              <Input
                {...register('name')}
                placeholder="Sunrise Inn & Suites"
                error={!!errors.name}
              />
            </FormField>

            <FormField label="Address" error={errors.address?.message}>
              <Input
                {...register('address')}
                placeholder="1234 Main Street"
                error={!!errors.address}
              />
            </FormField>

            <div className="grid grid-cols-6 gap-4">
              <div className="col-span-3">
                <FormField label="City" error={errors.city?.message}>
                  <Input
                    {...register('city')}
                    placeholder="San Antonio"
                    error={!!errors.city}
                  />
                </FormField>
              </div>
              <div className="col-span-1">
                <FormField label="State" error={errors.state?.message}>
                  <Input
                    {...register('state')}
                    placeholder="TX"
                    maxLength={2}
                    error={!!errors.state}
                  />
                </FormField>
              </div>
              <div className="col-span-2">
                <FormField label="ZIP Code" error={errors.zip?.message}>
                  <Input
                    {...register('zip')}
                    placeholder="78201"
                    error={!!errors.zip}
                  />
                </FormField>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField label="Phone" error={errors.phone?.message}>
                <Input
                  {...register('phone')}
                  type="tel"
                  placeholder="+1 (210) 555-0100"
                  error={!!errors.phone}
                />
              </FormField>

              <FormField label="Room Count" error={errors.room_count?.message}>
                <Input
                  {...register('room_count', { valueAsNumber: true })}
                  type="number"
                  min={1}
                  max={999}
                  placeholder="85"
                  error={!!errors.room_count}
                />
              </FormField>
            </div>

            <FormField label="Timezone" error={errors.timezone?.message}>
              <select
                {...register('timezone')}
                className={`w-full px-3 py-2 text-sm border rounded-lg bg-white/70 focus:outline-none focus:ring-2 focus:border-transparent transition-colors ${
                  errors.timezone
                    ? 'border-red-300 focus:ring-red-500'
                    : 'border-amber-200/40 hover:border-amber-200 focus:ring-amber-400/50 focus:border-amber-200'
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
                hotel &&
                reset({
                  name: (hotel as any).name ?? '',
                  address: (hotel as any).address ?? '',
                  city: (hotel as any).city ?? '',
                  state: (hotel as any).state ?? '',
                  zip: (hotel as any).zip ?? '',
                  phone: (hotel as any).phone ?? '',
                  timezone: hotel.timezone ?? 'America/Chicago',
                  room_count: hotel.room_count ?? 50,
                })
              }
              disabled={!isDirty || saving}
            >
              Discard
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!isDirty || saving}
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </form>
      )}

      {/* Departments Tab */}
      {activeTab === 'departments' && (
        <div className="space-y-4">
          <Card className="overflow-hidden p-0 divide-y divide-white/40">
            {DEPARTMENTS.map((dept) => (
              <div key={dept.name} className="flex items-center gap-4 px-6 py-4 hover:bg-amber-50/30 transition-colors">
                <div className={`w-3 h-3 rounded-full ${dept.color} shrink-0`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{dept.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{dept.description}</p>
                </div>
                <span className="text-xs text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">
                  Default
                </span>
              </div>
            ))}
          </Card>
          <p className="text-xs text-gray-400 px-1">
            Department customization is available on request. Contact support to add or rename departments.
          </p>
        </div>
      )}

      {/* Danger Zone — shown on General tab */}
      {activeTab === 'general' && (
        <Card className="p-6 space-y-3 border-red-200 bg-red-50">
          <h2 className="text-base font-semibold text-red-700">Danger Zone</h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">Delete this hotel</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Permanently remove this hotel and all associated data.
              </p>
            </div>
            <div className="relative group">
              <button
                type="button"
                disabled
                className="px-4 py-2 text-sm font-medium text-red-400 bg-red-50 border border-red-200 rounded-lg cursor-not-allowed"
                aria-disabled="true"
              >
                Delete Hotel
              </button>
              {/* Tooltip */}
              <div className="absolute right-0 bottom-full mb-2 w-44 hidden group-hover:block">
                <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 text-center shadow-lg">
                  <AlertTriangle size={11} className="inline mr-1 mb-0.5" />
                  Contact support to delete
                  <div className="absolute bottom-0 right-6 translate-y-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-gray-900" />
                </div>
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
