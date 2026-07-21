'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'
import { ClipboardList, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { safetyApi, type ControlledIncident } from '@/lib/api/safety'

const EVENT_TYPES = ['correction', 'manager_review', 'follow_up', 'closed']

export function IncidentReview() {
  const [incidents, setIncidents] = useState<ControlledIncident[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { const response = await safetyApi.listIncidents(); setIncidents(response.data) }
    catch { setError('Unable to load controlled incidents.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const selected = incidents.find((incident) => incident.id === selectedId) ?? null

  const appendEvent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedId) return
    setSaving(true); setError(null)
    const form = new FormData(event.currentTarget)
    try {
      await safetyApi.appendIncidentEvent(selectedId, { event_type: String(form.get('event_type')), detail: String(form.get('detail')) })
      event.currentTarget.reset(); await load()
    } catch { setError('Unable to append the event.') }
    finally { setSaving(false) }
  }

  return (
    <section className="rounded-[var(--r-lg)] border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3"><ShieldAlert size={18} className="text-alert" /><h2 className="font-medium text-ink">Controlled incidents</h2></div>
      {error ? <p className="mx-4 mt-3 rounded-lg bg-alert-soft p-2 text-sm text-alert">{error}</p> : null}

      {loading ? (
        <p className="p-5 text-sm text-ink3">Loading…</p>
      ) : !incidents.length ? (
        <p className="p-5 text-sm text-ink3">No controlled incidents recorded.</p>
      ) : (
        <div className="grid gap-0 md:grid-cols-[1fr_1.3fr]">
          <ul className="divide-y divide-line border-line md:border-r">
            {incidents.map((incident) => (
              <li key={incident.id}>
                <button onClick={() => setSelectedId(incident.id)} className={`block w-full px-4 py-3 text-left text-sm hover:bg-surface-2 ${selectedId === incident.id ? 'bg-surface-2' : ''}`}>
                  <p className="font-medium text-ink">{incident.incident_type.replace(/_/g, ' ')}</p>
                  <p className="text-xs text-ink3">{incident.location} · {new Date(incident.occurred_at).toLocaleString()}</p>
                </button>
              </li>
            ))}
          </ul>

          <div className="p-4">
            {selected ? (
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium text-ink">{selected.incident_type.replace(/_/g, ' ')}</p>
                  <p className="text-xs text-ink3">{selected.location} · {new Date(selected.occurred_at).toLocaleString()}</p>
                  {selected.details ? <p className="mt-2 text-sm text-ink2">{selected.details}</p> : null}
                </div>

                <div>
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink3"><ClipboardList size={14} />Audit history</div>
                  <ol className="space-y-2">
                    {(selected.controlled_incident_events ?? []).slice().sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).map((incidentEvent) => (
                      <li key={incidentEvent.id} className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
                        <p className="font-medium text-ink">{incidentEvent.event_type.replace(/_/g, ' ')} <span className="text-xs font-normal text-ink3">· {incidentEvent.actor_role}</span></p>
                        <p className="text-ink2">{incidentEvent.detail}</p>
                        <p className="text-[11px] text-ink3">{new Date(incidentEvent.occurred_at).toLocaleString()}</p>
                      </li>
                    ))}
                  </ol>
                </div>

                <form className="space-y-2 border-t border-line pt-3" onSubmit={(event) => void appendEvent(event)}>
                  <select name="event_type" className="w-full rounded-lg border border-line bg-surface p-2 text-sm" aria-label="Event type">
                    {EVENT_TYPES.map((type) => <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>)}
                  </select>
                  <textarea name="detail" required placeholder="Detail" className="min-h-16 w-full rounded-lg border border-line bg-surface p-2 text-sm" />
                  <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Append event'}</Button>
                </form>
              </div>
            ) : (
              <p className="text-sm text-ink3">Select an incident to review its append-only history.</p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
