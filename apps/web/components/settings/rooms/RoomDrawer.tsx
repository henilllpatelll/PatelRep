'use client'

import { useMemo, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { AlertTriangle, Trash2 } from 'lucide-react'
import { roomsApi, type RoomDeletionCheck, type RoomType } from '@/lib/api/rooms'
import {
  EMPTY_ROOM_FORM, roomFormChanged, roomToForm, validateRoomForm, type RoomFormErrors, type RoomFormValues, type RoomRow,
} from '@/lib/settings/rooms'
import { STATUS_LABELS } from '@/lib/utils/roomStatus'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { SettingsDrawer } from '@/components/settings/workspace/SettingsDrawer'
import { SettingsConfirmDialog } from '@/components/settings/workspace/SettingsConfirmDialog'
import {
  SettingsField, SettingsSelect, SettingsTextInput, controlA11y,
} from '@/components/settings/workspace/SettingsFormControls'
import { errorMessage, errorStatus, useInvalidateRooms } from './useRoomsData'

// OOO / OOS are deliberately not offered: they need a reason and expected return, which the Engineering
// room-down flow records and the return-to-service flow releases.
const LOCKED_STATUSES = new Set(['OOO', 'OUT_OF_ORDER', 'OUT_OF_SERVICE'])
const CORRECTABLE_STATUSES: { value: string; label: string }[] = [
  { value: 'DIRTY', label: 'Vacant dirty' },
  { value: 'OCCUPIED', label: 'Occupied' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'PICKUP', label: 'Pickup' },
  { value: 'CLEAN', label: 'Clean' },
  { value: 'INSPECTED', label: 'Inspected vacant' },
]

function StatusCorrection({ room, onDone }: { room: RoomRow; onDone: () => void }) {
  const toast = useToast()
  const invalidate = useInvalidateRooms()
  const [target, setTarget] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const locked = LOCKED_STATUSES.has(room.status)

  async function apply() {
    if (!target || reason.trim().length < 3 || busy) return
    setBusy(true)
    setError(null)
    try {
      await roomsApi.updateStatus(room.id, target, `GM correction from Settings: ${reason.trim()}`, true)
      toast.success(`Room ${room.roomNumber} status corrected.`)
      await invalidate()
      setTarget('')
      setReason('')
      onDone()
    } catch (err) {
      setError(errorMessage(err, 'Could not change the status.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="room-status-heading" className="space-y-3 rounded-[var(--r-md)] border border-line bg-surface-2 p-4">
      <div>
        <h3 id="room-status-heading" className="text-sm font-semibold text-ink">Live status</h3>
        <p className="mt-0.5 text-[13px] text-ink-2">
          Currently <span className="font-medium">{STATUS_LABELS[room.status] ?? room.status}</span>. Day-to-day changes belong on the{' '}
          <Link href="/housekeeping" className="font-medium text-[var(--accent)] hover:underline">Housekeeping Room Board</Link>.
        </p>
      </div>
      {locked ? (
        <p className="text-[13px] text-ink-3">
          This room is out of order / out of service. Return it to service from the Room Board or{' '}
          <Link href="/engineering" className="font-medium text-[var(--accent)] hover:underline">Engineering</Link>{' '}
          so the return is recorded; it can’t be changed here.
        </p>
      ) : (
        <details className="group">
          <summary className="cursor-pointer text-[13px] font-medium text-ink-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
            Correct a wrong status (GM)
          </summary>
          <div className="mt-3 space-y-3">
            <SettingsField id="status-target" label="Correct to">
              <SettingsSelect id="status-target" value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Choose a status…</option>
                {CORRECTABLE_STATUSES.filter((s) => s.value !== room.status).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </SettingsSelect>
            </SettingsField>
            <SettingsField id="status-reason" label="Reason" hint="Saved in the room’s status history.">
              <SettingsTextInput id="status-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
            </SettingsField>
            {error && <p role="alert" className="text-xs text-[var(--alert)]">{error}</p>}
            <Button type="button" variant="outline" size="sm" onClick={apply} loading={busy} disabled={!target || reason.trim().length < 3}>
              Apply correction
            </Button>
          </div>
        </details>
      )}
    </section>
  )
}

function DangerZone({ room, onDeleted }: { room: RoomRow; onDeleted: () => void }) {
  const toast = useToast()
  const invalidate = useInvalidateRooms()
  const [checking, setChecking] = useState(false)
  const [check, setCheck] = useState<RoomDeletionCheck | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function begin() {
    setChecking(true)
    setError(null)
    try {
      const res = await roomsApi.checkDeletion(room.id)
      setCheck(res.data)
      if (res.data.can_delete) setConfirming(true)
    } catch (err) {
      setError(errorMessage(err, 'Could not check whether this room can be deleted.'))
    } finally {
      setChecking(false)
    }
  }

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      await roomsApi.deleteRoom(room.id)
      toast.success(`Room ${room.roomNumber} deleted.`)
      await invalidate()
      onDeleted()
    } catch (err) {
      // 409 = the server found operational history; surface its explanation instead of failing silently.
      setError(errorStatus(err) === 409 ? errorMessage(err, 'This room has history and can’t be deleted.') : errorMessage(err, 'Could not delete the room.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="room-danger-heading" className="space-y-3 rounded-[var(--r-md)] border border-[var(--alert-line)] p-4">
      <div>
        <h3 id="room-danger-heading" className="text-sm font-semibold text-[var(--alert)]">Danger zone</h3>
        <p className="mt-0.5 text-[13px] text-ink-2">
          Only a room that has never been used can be deleted. Rooms with cleaning, work-order, task or guest history are protected so that history is never erased.
        </p>
      </div>
      {check && !check.can_delete && (
        <div role="alert" className="flex gap-2 rounded-lg bg-[var(--caution-soft)] p-3 text-[13px] text-ink">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[var(--caution)]" aria-hidden="true" />
          <p>Room {room.roomNumber} can’t be deleted because it has: {check.blocked_by.join(', ')}.</p>
        </div>
      )}
      {error && !confirming && <p role="alert" className="text-xs text-[var(--alert)]">{error}</p>}
      <Button type="button" variant="destructive" size="sm" onClick={begin} loading={checking}>
        <Trash2 size={14} aria-hidden="true" /> Delete room
      </Button>
      {confirming && (
        <SettingsConfirmDialog
          title={`Delete room ${room.roomNumber}?`}
          body={
            <>
              <p>Room {room.roomNumber} will be permanently removed from your inventory, along with its accessibility features. This can’t be undone.</p>
              <p className="text-ink-3">It has no operational history, so no cleaning, task or work-order records are affected.</p>
            </>
          }
          confirmLabel="Delete room"
          tone="destructive"
          busy={busy}
          error={error}
          onCancel={() => { setConfirming(false); setError(null) }}
          onConfirm={remove}
        />
      )}
    </section>
  )
}

export function RoomDrawer({ mode, room, rooms, types, buildings, onClose, onSaved }: {
  mode: 'create' | 'edit'
  room?: RoomRow
  rooms: RoomRow[]
  types: RoomType[]
  buildings: string[]
  onClose: () => void
  /** Called after a successful save or delete; the parent unmounts the drawer. */
  onSaved: () => void
}) {
  const toast = useToast()
  const invalidate = useInvalidateRooms()
  const initial = useMemo<RoomFormValues>(() => (room ? roomToForm(room) : EMPTY_ROOM_FORM), [room])
  const [values, setValues] = useState<RoomFormValues>(initial)
  const [attempted, setAttempted] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const dirty = roomFormChanged(values, initial)
  const errors: RoomFormErrors = useMemo(() => validateRoomForm(values, rooms, room?.id), [values, rooms, room?.id])
  const shown: RoomFormErrors = attempted ? errors : {}
  const set = (key: keyof RoomFormValues) => (e: { target: { value: string } }) => {
    setValues((v) => ({ ...v, [key]: e.target.value }))
    setServerError(null)
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault()
    if (saving) return
    setAttempted(true)
    if (Object.keys(errors).length > 0) return
    setSaving(true)
    setServerError(null)
    const payload = {
      room_number: values.roomNumber.trim(),
      floor: Number(values.floor),
      room_type_id: values.roomTypeId,
      building: values.building.trim(),
    }
    try {
      if (mode === 'create') await roomsApi.createRoom(payload)
      else await roomsApi.updateRoomDetails(room!.id, payload)
      toast.success(mode === 'create' ? `Room ${payload.room_number} added.` : `Room ${payload.room_number} saved.`)
      await invalidate()
      onSaved()
    } catch (err) {
      // Stay open with every edit intact; a 409 means another user took the number meanwhile.
      setServerError(errorMessage(err, 'Could not save the room. Please try again.'))
    } finally {
      setSaving(false)
    }
  }

  const noTypes = types.length === 0

  return (
    <SettingsDrawer
      title={mode === 'create' ? 'Add room' : `Edit room ${room?.roomNumber ?? ''}`}
      description={mode === 'create' ? 'Add a room to your inventory.' : 'Room details used by housekeeping, engineering and reports.'}
      dirty={dirty}
      onClose={onClose}
      footer={({ requestClose }) => (
        <div className="flex items-center justify-end gap-3 px-4 py-3 sm:px-5">
          <Button type="button" variant="ghost" onClick={requestClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="room-form" loading={saving} disabled={noTypes || (mode === 'edit' && !dirty)}>Save room</Button>
        </div>
      )}
    >
      <div className="space-y-6">
        <form id="room-form" onSubmit={submit} noValidate className="space-y-4">
          <h3 className="text-sm font-semibold text-ink">Room information</h3>
          {serverError && (
            <p role="alert" className="rounded-lg border border-[var(--alert-line)] bg-[var(--alert-soft)] px-3 py-2 text-[13px] text-[var(--alert)]">{serverError}</p>
          )}
          <SettingsField id="room-number" label="Room number" required error={shown.roomNumber}>
            <SettingsTextInput {...controlA11y('room-number', { error: shown.roomNumber, required: true })} value={values.roomNumber} onChange={set('roomNumber')} maxLength={20} autoComplete="off" />
          </SettingsField>
          <div className="grid gap-4 sm:grid-cols-2">
            <SettingsField id="room-floor" label="Floor" required error={shown.floor}>
              <SettingsTextInput {...controlA11y('room-floor', { error: shown.floor, required: true })} value={values.floor} onChange={set('floor')} inputMode="numeric" autoComplete="off" />
            </SettingsField>
            <SettingsField id="room-building" label="Building" error={shown.building} hint="Optional, e.g. A or West.">
              <SettingsTextInput {...controlA11y('room-building', { error: shown.building, hint: true })} value={values.building} onChange={set('building')} list="room-building-options" maxLength={50} autoComplete="off" />
              <datalist id="room-building-options">{buildings.map((b) => <option key={b} value={b} />)}</datalist>
            </SettingsField>
          </div>
          <SettingsField
            id="room-type"
            label="Room type"
            required
            error={shown.roomTypeId}
            hint={noTypes ? 'No room types exist yet. Use Import Rooms with a room type name to create your first type.' : undefined}
          >
            <SettingsSelect {...controlA11y('room-type', { error: shown.roomTypeId, hint: noTypes, required: true })} value={values.roomTypeId} onChange={set('roomTypeId')} disabled={noTypes}>
              <option value="">Select a room type…</option>
              {types.map((t) => <option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}
            </SettingsSelect>
          </SettingsField>
        </form>

        {mode === 'edit' && room && (
          <>
            <StatusCorrection room={room} onDone={() => { /* list refreshes via invalidation */ }} />
            <DangerZone room={room} onDeleted={onSaved} />
          </>
        )}
      </div>
    </SettingsDrawer>
  )
}
