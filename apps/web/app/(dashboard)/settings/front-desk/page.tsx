'use client'

import { useCallback, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Bed, Wrench, Bell, Package, ClipboardList,
  Users, Calendar, BookOpen, Library, FileText, Sparkles, CheckCircle2,
} from 'lucide-react'
import { useHotelStore } from '@/stores/hotelStore'
import { useRole } from '@/lib/hooks/useRole'
import { hotelsApi } from '@/lib/api/hotels'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

// ─── Constants ────────────────────────────────────────────────────────────────

const FRONT_DESK_MODULES = [
  { key: 'housekeeping',   label: 'Housekeeping',   description: 'Room board, assignments and inspections', icon: Bed },
  { key: 'engineering',    label: 'Maintenance',    description: 'Work orders and maintenance tracking', icon: Wrench },
  { key: 'guest-requests', label: 'Guest Requests', description: 'Guest service requests and escalations', icon: Bell },
  { key: 'lost-found',     label: 'Lost & Found',   description: 'Log and look up guest items', icon: Package },
  { key: 'tasks',          label: 'Tasks',          description: 'Assign and track ad-hoc tasks', icon: ClipboardList },
  { key: 'staff',          label: 'Staff',          description: 'View and manage hotel staff', icon: Users },
  { key: 'scheduling',     label: 'Schedule',       description: 'Staff scheduling and shifts', icon: Calendar },
  { key: 'logbook',        label: 'Logbook',        description: 'Shift-by-shift log entries', icon: BookOpen },
  { key: 'sop',            label: 'SOP Library',    description: 'Standard operating procedures', icon: Library },
  { key: 'reports',        label: 'Reports',        description: 'Analytics and daily summaries', icon: FileText },
  { key: 'ai',             label: 'AI Copilot',     description: 'AI-powered hotel insights and automation', icon: Sparkles },
]

const DEFAULT_FD_MODULES = ['housekeeping', 'engineering', 'guest-requests', 'lost-found', 'tasks', 'logbook']

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FrontDeskSettingsPage() {
  const { hotel, setHotel } = useHotelStore()
  const { isGM } = useRole()
  const [fdModules, setFdModules] = useState<string[]>(DEFAULT_FD_MODULES)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const { data: fullHotel } = useQuery({
    queryKey: ['hotel-full', hotel?.id],
    queryFn: () => hotelsApi.get(hotel!.id),
    enabled: !!hotel?.id && isGM,
    select: res => res.data,
  })

  useEffect(() => {
    if (fullHotel?.front_desk_modules) {
      setFdModules(fullHotel.front_desk_modules)
    }
  }, [fullHotel])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(timer)
  }, [toast])

  const saveAccess = useCallback(async () => {
    if (!hotel?.id) return
    setSaving(true)
    try {
      const res = await hotelsApi.update(hotel.id, { front_desk_modules: fdModules })
      setHotel({ ...hotel, front_desk_modules: res.data.front_desk_modules ?? fdModules })
      setToast({ type: 'success', message: 'Front desk access saved.' })
    } catch (err: any) {
      setToast({ type: 'error', message: err.message || 'Failed to save. Please try again.' })
    } finally {
      setSaving(false)
    }
  }, [hotel, fdModules, setHotel])

  return (
    <div className="space-y-4 max-w-2xl">
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

      <div>
        <h2 className="text-base font-semibold text-stone-900 mb-1">Front Desk Access</h2>
        <p className="text-sm text-stone-500">
          Choose which modules front desk staff can access from the sidebar. Dashboard is always visible.
        </p>
      </div>

      <Card className="overflow-hidden p-0 divide-y divide-stone-100">
        {FRONT_DESK_MODULES.map(({ key, label, description, icon: Icon }) => {
          const enabled = fdModules.includes(key)
          return (
            <div
              key={key}
              className="flex items-center gap-4 px-6 py-4 hover:bg-[var(--caution-soft)]/30 transition-colors"
            >
              <Icon className="w-4 h-4 text-[var(--caution)] shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-stone-900">{label}</p>
                <p className="text-xs text-stone-500 mt-0.5">{description}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                onClick={() =>
                  setFdModules(prev => enabled ? prev.filter(m => m !== key) : [...prev, key])
                }
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                  enabled ? 'bg-amber-400' : 'bg-line'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-surface shadow transition-transform ${
                    enabled ? 'translate-x-[18px]' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          )
        })}
      </Card>

      <div className="flex justify-end">
        <Button type="button" variant="primary" onClick={saveAccess} disabled={saving}>
          {saving ? 'Saving…' : 'Save Access'}
        </Button>
      </div>
    </div>
  )
}
