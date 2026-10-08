'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { hotelsApi } from '@/lib/api/hotels'
import { errorMessage } from '@/lib/settings/apiErrors'
import { FRONT_DESK_DEFAULTS, frontDeskSelection, moduleLabel, modulesForRole, sameModules } from '@/lib/settings/rolesAccess'
import { useHotelStore } from '@/stores/hotelStore'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { SettingsDrawer } from '@/components/settings/workspace/SettingsDrawer'
import { SettingsError, SettingsLoading } from '@/components/settings/workspace/SettingsStates'
import { ModuleChecklist } from './ModuleChecklist'

/** Chooses which modules Front Desk staff see. Same endpoint and `front_desk_modules` key as the retired Front Desk page. */
export function FrontDeskAccessDrawer({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const { hotel, setHotel } = useHotelStore()
  const available = useMemo(() => modulesForRole('front_desk'), [])

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['hotel-full', hotel?.id],
    queryFn: () => hotelsApi.get(hotel!.id),
    enabled: !!hotel?.id,
    select: (res) => res.data,
    // Always show what is really saved, not a cached copy from earlier in the session.
    staleTime: 0,
  })

  if (isLoading) return <Shell onClose={onClose}><SettingsLoading label="Loading Front Desk access…" /></Shell>
  if (isError || !data || !hotel) return <Shell onClose={onClose}><SettingsError message="We couldn’t load the Front Desk access settings." onRetry={() => refetch()} /></Shell>

  return (
    <Editor
      saved={data.front_desk_modules}
      available={available}
      onClose={onClose}
      onSave={async (modules) => {
        const res = await hotelsApi.update(hotel.id, { front_desk_modules: modules })
        const stored = res.data.front_desk_modules ?? modules
        setHotel({ ...hotel, front_desk_modules: stored })
        await queryClient.invalidateQueries({ queryKey: ['hotel-full'] })
        toast.success('Front Desk access saved.')
      }}
    />
  )
}

function Shell({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <SettingsDrawer title="Front Desk Access" description="Choose which supported PatelRep modules are available to Front Desk staff." onClose={onClose}>
      {children}
    </SettingsDrawer>
  )
}

function Editor({ saved, available, onSave, onClose }: {
  saved: string[] | undefined
  available: ReturnType<typeof modulesForRole>
  onSave: (modules: string[]) => Promise<void>
  onClose: () => void
}) {
  const initial = useMemo(() => frontDeskSelection(saved), [saved])
  const [selected, setSelected] = useState<string[]>(initial.selected)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = !sameModules(selected, initial.selected)

  async function save() {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await onSave(selected)
      onClose()
    } catch (err) {
      setError(errorMessage(err, 'We couldn’t save Front Desk access. Your selection is still here.'))
    } finally {
      setSaving(false)
    }
  }

  const isDefault = sameModules(selected, [...FRONT_DESK_DEFAULTS])

  return (
    <SettingsDrawer
      title="Front Desk Access"
      description="Choose which supported PatelRep modules are available to Front Desk staff."
      dirty={dirty}
      onClose={onClose}
      footer={({ requestClose }) => (
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
          <p role={error ? 'alert' : 'status'} className={error ? 'mr-auto min-w-0 flex-1 text-[13px] text-[var(--alert)]' : 'mr-auto text-[13px] text-ink-3'}>{error ?? ''}</p>
          <Button type="button" variant="ghost" onClick={requestClose} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={save} loading={saving} disabled={!dirty && initial.ignored.length === 0}>Save Changes</Button>
        </div>
      )}
    >
      <div className="space-y-5">
        <p className="text-sm text-ink-3">
          Dashboard is always on. These are the only modules Front Desk can open; others (Engineering, Reports, People and so on) are reserved for other roles and can’t be added here.
          {isDefault ? ' This is the standard selection.' : ` The standard selection is ${FRONT_DESK_DEFAULTS.map(moduleLabel).join(', ')}.`}
        </p>
        {initial.ignored.length > 0 && (
          <p role="status" className="rounded-lg border border-[var(--caution-line)] bg-[var(--caution-soft)] px-3 py-2 text-xs text-ink">
            Your saved setting also lists {initial.ignored.map(moduleLabel).join(', ')}, which Front Desk can’t open. {initial.ignored.length === 1 ? 'It has' : 'They have'} no effect and will be removed when you save.
          </p>
        )}
        <ModuleChecklist legend="Front Desk modules" modules={available} selected={selected} onChange={(next) => { setSelected(next); setError(null) }} idPrefix="fd-module" />
        <p className="text-xs text-ink-3">Changes apply the next time each person’s session refreshes (for example on their next sign-in or page load). People who are signed in right now aren’t updated instantly.</p>
      </div>
    </SettingsDrawer>
  )
}
