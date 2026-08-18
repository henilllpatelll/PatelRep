'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'
import { FlaskConical, Phone, Siren } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { StateBlock } from '@/components/ui/StateBlock'
import { safetyApi, type ChemicalItem, type EmergencyContact } from '@/lib/api/safety'

const DRILL_TYPES = ['fire', 'severe_weather', 'evacuation', 'medical', 'security', 'spill_exposure']

export function SafetyPrograms({ redesigned }: { redesigned?: boolean }) {
  const { t } = useTranslation()
  const [chemicals, setChemicals] = useState<ChemicalItem[]>([])
  const [contacts, setContacts] = useState<EmergencyContact[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [drillSaved, setDrillSaved] = useState(false)

  const load = useCallback(async () => {
    setLoadError(false)
    try {
      const [chemResponse, contactResponse] = await Promise.all([safetyApi.listChemicals(), safetyApi.listEmergencyContacts()])
      setChemicals(chemResponse.data); setContacts(contactResponse.data)
    } catch { setError('Unable to load safety programs.'); setLoadError(true) }
  }, [])
  useEffect(() => { void load() }, [load])

  const submitChemical = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(null)
    const form = new FormData(event.currentTarget)
    try {
      await safetyApi.createChemical({
        product_name: String(form.get('product_name')),
        manufacturer: String(form.get('manufacturer') || '') || null,
        storage_location: String(form.get('storage_location')),
        secondary_label_verified: form.get('secondary_label_verified') === 'on',
        ppe_requirements: String(form.get('ppe_requirements') || '').split(',').map((s) => s.trim()).filter(Boolean),
      })
      event.currentTarget.reset(); await load()
    } catch { setError('Unable to add the chemical.') }
  }

  const submitContact = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(null)
    const form = new FormData(event.currentTarget)
    try {
      await safetyApi.createContact({
        contact_name: String(form.get('contact_name')),
        role_label: String(form.get('role_label')),
        phone: String(form.get('phone')),
        alternate_phone: String(form.get('alternate_phone') || '') || null,
        is_primary: form.get('is_primary') === 'on',
      })
      event.currentTarget.reset(); await load()
    } catch { setError('Unable to add the contact.') }
  }

  const submitDrill = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(null); setDrillSaved(false)
    const form = new FormData(event.currentTarget)
    const occurred = String(form.get('occurred_at'))
    try {
      await safetyApi.createDrill({
        drill_type: String(form.get('drill_type')),
        occurred_at: occurred ? new Date(occurred).toISOString() : new Date().toISOString(),
        location: String(form.get('location')),
        notes: String(form.get('notes') || '') || null,
      })
      event.currentTarget.reset(); setDrillSaved(true)
    } catch { setError('Unable to record the drill.') }
  }

  return (
    <div className="space-y-6">
      {error && !(redesigned && loadError) ? <p className="rounded-lg bg-alert-soft p-2 text-sm text-alert">{error}</p> : null}

      <section className="rounded-[var(--r-lg)] border border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3"><FlaskConical size={18} className="text-accent" /><h2 className="font-medium text-ink">Chemical inventory</h2></div>
        <form className="grid gap-3 border-b border-line p-4 sm:grid-cols-2" onSubmit={(event) => void submitChemical(event)}>
          <input name="product_name" required placeholder="Product name" className="rounded-lg border border-line bg-surface p-2 text-sm" />
          <input name="manufacturer" placeholder="Manufacturer (optional)" className="rounded-lg border border-line bg-surface p-2 text-sm" />
          <input name="storage_location" required placeholder="Storage location" className="rounded-lg border border-line bg-surface p-2 text-sm" />
          <input name="ppe_requirements" placeholder="PPE (comma-separated)" className="rounded-lg border border-line bg-surface p-2 text-sm" />
          <label className="flex items-center gap-2 text-sm text-ink2 sm:col-span-2"><input type="checkbox" name="secondary_label_verified" className="rounded border-line" />Secondary label verified</label>
          <div className="sm:col-span-2"><Button type="submit">Add chemical</Button></div>
        </form>
        {redesigned ? (
          <StateBlock
            status={loadError ? 'error' : chemicals.length === 0 ? 'empty' : null}
            empty={{ title: t('safety.programs.chemicalsEmpty') }}
            error={{ message: t('safety.programs.loadError'), onRetry: () => void load() }}
          >
            <ul className="divide-y divide-line">
              {chemicals.map((chemical) => (
                <li key={chemical.id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
                  <span className="text-ink">{chemical.product_name} <span className="text-ink3">· {chemical.storage_location}</span></span>
                  <span className="text-xs text-ink3">{(chemical.ppe_requirements ?? []).join(', ') || 'No PPE listed'}</span>
                </li>
              ))}
            </ul>
          </StateBlock>
        ) : chemicals.length ? (
          <ul className="divide-y divide-line">
            {chemicals.map((chemical) => (
              <li key={chemical.id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
                <span className="text-ink">{chemical.product_name} <span className="text-ink3">· {chemical.storage_location}</span></span>
                <span className="text-xs text-ink3">{(chemical.ppe_requirements ?? []).join(', ') || 'No PPE listed'}</span>
              </li>
            ))}
          </ul>
        ) : <p className="p-4 text-sm text-ink3">No chemicals recorded.</p>}
      </section>

      <section className="rounded-[var(--r-lg)] border border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3"><Siren size={18} className="text-accent" /><h2 className="font-medium text-ink">Log an emergency drill</h2></div>
        <form className="grid gap-3 p-4 sm:grid-cols-2" onSubmit={(event) => void submitDrill(event)}>
          <select name="drill_type" className="rounded-lg border border-line bg-surface p-2 text-sm" aria-label="Drill type">
            {DRILL_TYPES.map((type) => <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>)}
          </select>
          <input name="occurred_at" type="datetime-local" required className="rounded-lg border border-line bg-surface p-2 text-sm" aria-label="Occurred at" />
          <input name="location" required placeholder="Location" className="rounded-lg border border-line bg-surface p-2 text-sm sm:col-span-2" />
          <textarea name="notes" placeholder="Notes (optional)" className="min-h-16 rounded-lg border border-line bg-surface p-2 text-sm sm:col-span-2" />
          <div className="flex items-center gap-3 sm:col-span-2"><Button type="submit">Record drill</Button>{drillSaved ? <span className="text-sm text-success">Drill recorded.</span> : null}</div>
        </form>
      </section>

      <section className="rounded-[var(--r-lg)] border border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3"><Phone size={18} className="text-accent" /><h2 className="font-medium text-ink">Emergency contacts</h2></div>
        <form className="grid gap-3 border-b border-line p-4 sm:grid-cols-2" onSubmit={(event) => void submitContact(event)}>
          <input name="contact_name" required placeholder="Contact name" className="rounded-lg border border-line bg-surface p-2 text-sm" />
          <input name="role_label" required placeholder="Role (e.g. Fire Dept)" className="rounded-lg border border-line bg-surface p-2 text-sm" />
          <input name="phone" required placeholder="Phone" className="rounded-lg border border-line bg-surface p-2 text-sm" />
          <input name="alternate_phone" placeholder="Alternate phone (optional)" className="rounded-lg border border-line bg-surface p-2 text-sm" />
          <label className="flex items-center gap-2 text-sm text-ink2 sm:col-span-2"><input type="checkbox" name="is_primary" className="rounded border-line" />Primary contact</label>
          <div className="sm:col-span-2"><Button type="submit">Add contact</Button></div>
        </form>
        {redesigned ? (
          <StateBlock
            status={loadError ? 'error' : contacts.length === 0 ? 'empty' : null}
            empty={{ title: t('safety.programs.contactsEmpty') }}
            error={{ message: t('safety.programs.loadError'), onRetry: () => void load() }}
          >
            <ul className="divide-y divide-line">
              {contacts.map((contact) => (
                <li key={contact.id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
                  <span className="text-ink">{contact.contact_name} <span className="text-ink3">· {contact.role_label}</span>{contact.is_primary ? <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">Primary</span> : null}</span>
                  <span className="text-ink2">{contact.phone}</span>
                </li>
              ))}
            </ul>
          </StateBlock>
        ) : contacts.length ? (
          <ul className="divide-y divide-line">
            {contacts.map((contact) => (
              <li key={contact.id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
                <span className="text-ink">{contact.contact_name} <span className="text-ink3">· {contact.role_label}</span>{contact.is_primary ? <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">Primary</span> : null}</span>
                <span className="text-ink2">{contact.phone}</span>
              </li>
            ))}
          </ul>
        ) : <p className="p-4 text-sm text-ink3">No emergency contacts listed.</p>}
      </section>
    </div>
  )
}
