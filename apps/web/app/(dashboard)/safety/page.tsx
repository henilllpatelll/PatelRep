'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, ClipboardCheck, RefreshCw, ShieldAlert } from 'lucide-react'
import { safetyApi, type EmergencyPlan, type TrainingStatusRow } from '@/lib/api/safety'
import { Button } from '@/components/ui/Button'
import { useTranslation } from 'react-i18next'

const STATUS_STYLE = { compliant: 'bg-success-soft text-success', due_soon: 'bg-caution-soft text-caution', overdue: 'bg-alert-soft text-alert', not_applicable: 'bg-surface-2 text-ink3' }

export default function SafetyPage() {
  const { t } = useTranslation()
  const [training, setTraining] = useState<TrainingStatusRow[]>([])
  const [plans, setPlans] = useState<EmergencyPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [incidentSaved, setIncidentSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { const [trainingResponse, planResponse] = await Promise.all([safetyApi.listTrainingStatus(), safetyApi.listEmergencyPlans()]); setTraining(trainingResponse.data); setPlans(planResponse.data) }
    catch { setError(t('safety.loadError')) }
    finally { setLoading(false) }
  }, [t])
  useEffect(() => { void load() }, [load])

  const complete = async (assignmentId: string) => { await safetyApi.completeTraining(assignmentId); await load() }
  const submitIncident = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget)
    await safetyApi.createIncident({ incident_type: String(form.get('incident_type')), occurred_at: new Date().toISOString(), location: String(form.get('location')), immediate_containment: String(form.get('containment')), details: String(form.get('details')) })
    event.currentTarget.reset(); setIncidentSaved(true)
  }

  return <main className="mx-auto max-w-5xl space-y-6 p-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">{t('safety.eyebrow')}</p><h1 className="font-display text-[28px] text-ink">{t('safety.title')}</h1><p className="mt-1 text-sm text-ink2">{t('safety.subtitle')}</p></div><Button variant="secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? 'animate-spin' : ''} />{t('safety.refresh')}</Button></header>
    {error ? <p className="rounded-lg bg-alert-soft p-3 text-sm text-alert">{error}</p> : null}
    <section className="rounded-[var(--r-lg)] border border-line bg-surface"><div className="flex items-center gap-2 border-b border-line px-4 py-3"><ClipboardCheck size={18} className="text-accent" /><h2 className="font-medium text-ink">{t('safety.training')}</h2></div>{loading ? <p className="p-5 text-sm text-ink3">{t('common.loading')}</p> : <ul className="divide-y divide-line">{training.map((row) => <li key={`${row.employee_id}-${row.course_id}`} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="text-sm font-medium text-ink">{row.course_name}</p><p className="text-xs text-ink3">{row.provider_name}{row.due_date ? ` · ${row.due_date}` : ''}</p></div><div className="flex items-center gap-2"><span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLE[row.status]}`}>{t(`safety.status.${row.status}`)}</span>{row.assignment_id && row.status !== 'compliant' ? <Button className="px-2 py-1 text-xs" onClick={() => void complete(row.assignment_id!)}>{t('safety.complete')}</Button> : null}</div></li>)}</ul>}</section>
    <section className="rounded-[var(--r-lg)] border border-line bg-surface p-4"><div className="mb-3 flex items-center gap-2"><CheckCircle2 size={18} className="text-accent" /><h2 className="font-medium text-ink">{t('safety.emergencyPlans')}</h2></div>{plans.length ? <ul className="space-y-2">{plans.map((plan) => <li key={plan.id} className="flex justify-between rounded-lg bg-surface-2 px-3 py-2 text-sm"><span className="text-ink">{plan.title}</span><span className="text-ink3">{plan.acknowledged_at ? t('safety.acknowledged') : t('safety.notAcknowledged')}</span></li>)}</ul> : <p className="text-sm text-ink3">{t('safety.noPlans')}</p>}</section>
    <section className="rounded-[var(--r-lg)] border border-alert-line bg-alert-soft p-4"><div className="mb-3 flex items-center gap-2"><ShieldAlert size={18} className="text-alert" /><h2 className="font-medium text-ink">{t('safety.reportIncident')}</h2></div><form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => void submitIncident(event)}><select name="incident_type" className="rounded-lg border border-line bg-surface p-2 text-sm" aria-label={t('safety.incidentType')}><option value="employee_injury">{t('safety.types.employee_injury')}</option><option value="chemical_exposure">{t('safety.types.chemical_exposure')}</option><option value="security">{t('safety.types.security')}</option><option value="life_safety_impairment">{t('safety.types.life_safety_impairment')}</option></select><input name="location" required placeholder={t('safety.location')} className="rounded-lg border border-line bg-surface p-2 text-sm" /><input name="containment" required placeholder={t('safety.containment')} className="rounded-lg border border-line bg-surface p-2 text-sm sm:col-span-2" /><textarea name="details" required placeholder={t('safety.details')} className="min-h-24 rounded-lg border border-line bg-surface p-2 text-sm sm:col-span-2" /><div className="flex items-center gap-3 sm:col-span-2"><Button type="submit"><AlertTriangle size={15} />{t('safety.submitIncident')}</Button>{incidentSaved ? <span className="text-sm text-success">{t('safety.incidentSaved')}</span> : null}</div></form></section>
  </main>
}
