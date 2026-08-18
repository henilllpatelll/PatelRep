'use client'

import { useCallback, useEffect, useState } from 'react'
import { BookText, FlaskConical, Phone, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { StateBlock } from '@/components/ui/StateBlock'
import { safetyApi, type ChemicalItem, type EmergencyContact, type SafetyProcedure } from '@/lib/api/safety'

export function SafetyInformation({ redesigned }: { redesigned?: boolean }) {
  const { t } = useTranslation()
  const [chemicals, setChemicals] = useState<ChemicalItem[]>([])
  const [procedures, setProcedures] = useState<SafetyProcedure[]>([])
  const [contacts, setContacts] = useState<EmergencyContact[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [info, contactResponse] = await Promise.all([safetyApi.getSafetyInformation(), safetyApi.listEmergencyContacts()])
      setChemicals(info.data.chemicals)
      setProcedures(info.data.procedures)
      setContacts(contactResponse.data)
    } catch {
      // surfaced by parent-level refresh; keep empty states here
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-6">
      <section className="rounded-[var(--r-lg)] border border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <FlaskConical size={18} className="text-accent" />
          <h2 className="font-medium text-ink">{t('safety.chemicalsHeading')}</h2>
        </div>
        {loading ? (
          <p className="p-5 text-sm text-ink3">{t('common.loading')}</p>
        ) : chemicals.length ? (
          <ul className="divide-y divide-line">
            {chemicals.map((chemical) => (
              <li key={chemical.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{chemical.product_name}{chemical.manufacturer ? <span className="text-ink3"> · {chemical.manufacturer}</span> : null}</p>
                  <p className="text-xs text-ink3">{t('safety.storedAt')}: {chemical.storage_location}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {chemical.secondary_label_verified ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success"><ShieldCheck size={12} />{t('safety.labelVerified')}</span>
                    ) : null}
                    {(chemical.ppe_requirements ?? []).map((ppe) => (
                      <span key={ppe} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink2">{t('safety.ppe')}: {ppe}</span>
                    ))}
                  </div>
                </div>
                {chemical.sds_url ? (
                  <a href={chemical.sds_url} target="_blank" rel="noreferrer" className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90">{t('safety.viewSds')}</a>
                ) : (
                  <span className="shrink-0 text-xs text-ink3">{t('safety.noSds')}</span>
                )}
              </li>
            ))}
          </ul>
        ) : redesigned ? (
          <StateBlock status="empty" empty={{ title: t('safety.noChemicals') }} />
        ) : (
          <p className="p-5 text-sm text-ink3">{t('safety.noChemicals')}</p>
        )}
      </section>

      <section className="rounded-[var(--r-lg)] border border-line bg-surface p-4">
        <div className="mb-3 flex items-center gap-2"><BookText size={18} className="text-accent" /><h2 className="font-medium text-ink">{t('safety.procedures')}</h2></div>
        {procedures.length ? (
          <ul className="space-y-2">
            {procedures.map((procedure) => (
              <li key={procedure.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
                <span className="text-ink">{procedure.title}</span>
                <span className="text-xs text-ink3">{t('safety.version')} {procedure.version_number}{procedure.effective_date ? ` · ${procedure.effective_date}` : ''}</span>
              </li>
            ))}
          </ul>
        ) : redesigned ? (
          <StateBlock status="empty" empty={{ title: t('safety.noProcedures') }} />
        ) : (
          <p className="text-sm text-ink3">{t('safety.noProcedures')}</p>
        )}
      </section>

      <section className="rounded-[var(--r-lg)] border border-line bg-surface p-4">
        <div className="mb-3 flex items-center gap-2"><Phone size={18} className="text-accent" /><h2 className="font-medium text-ink">{t('safety.emergencyContacts')}</h2></div>
        {contacts.length ? (
          <ul className="space-y-2">
            {contacts.map((contact) => (
              <li key={contact.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
                <div>
                  <span className="font-medium text-ink">{contact.contact_name}</span>
                  <span className="text-ink3"> · {contact.role_label}</span>
                  {contact.is_primary ? <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">{t('safety.primary')}</span> : null}
                </div>
                <a href={`tel:${contact.phone}`} className="font-medium text-accent">{contact.phone}</a>
              </li>
            ))}
          </ul>
        ) : redesigned ? (
          <StateBlock status="empty" empty={{ title: t('safety.noContacts') }} />
        ) : (
          <p className="text-sm text-ink3">{t('safety.noContacts')}</p>
        )}
      </section>
    </div>
  )
}
