'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ClipboardCheck, Droplets, PackageCheck, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { programsApi, type SupplyPar } from '@/lib/api/programs'

function ProgramMetric({ label, value, icon: Icon, tone = 'default' }: { label: string; value: number; icon: typeof Sparkles; tone?: 'default' | 'alert' }) {
  return (
    <Card className={tone === 'alert' ? 'border-alert-line bg-alert-soft p-4' : 'p-4'}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink3">{label}</p>
        <Icon className={tone === 'alert' ? 'h-5 w-5 text-alert' : 'h-5 w-5 text-accent'} />
      </div>
      <p className="mt-2 text-2xl font-semibold text-ink">{value}</p>
    </Card>
  )
}

export default function ProgramsPage() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [thresholdHours, setThresholdHours] = useState(8)
  const [linenDays, setLinenDays] = useState(3)
  const [supply, setSupply] = useState<Pick<SupplyPar, 'supply_type' | 'name' | 'on_hand' | 'par_level' | 'unit'>>({
    supply_type: 'linen', name: '', on_hand: 0, par_level: 0, unit: 'each',
  })

  const overview = useQuery({ queryKey: ['operational-programs'], queryFn: programsApi.overview })
  const data = overview.data?.data

  useEffect(() => {
    if (data?.dnd_welfare_policy) setThresholdHours(data.dnd_welfare_policy.threshold_hours)
    if (data?.stayover_rule) setLinenDays(data.stayover_rule.linen_change_frequency_days)
  }, [data?.dnd_welfare_policy, data?.stayover_rule])

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['operational-programs'] })
  const initialize = useMutation({ mutationFn: programsApi.initializeTemplates, onSuccess: refresh })
  const saveDnd = useMutation({ mutationFn: programsApi.updateDndPolicy, onSuccess: refresh })
  const saveStayover = useMutation({ mutationFn: programsApi.updateStayoverRule, onSuccess: refresh })
  const saveSupply = useMutation({ mutationFn: programsApi.upsertSupplyPar, onSuccess: () => { setSupply({ supply_type: 'linen', name: '', on_hand: 0, par_level: 0, unit: 'each' }); refresh() } })

  const submitSupply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supply.name.trim()) return
    saveSupply.mutate({ ...supply, name: supply.name.trim() })
  }

  const isSpanish = i18n.language === 'es'

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-5 sm:px-6">
      <PageHeader
        eyebrow={t('programs.eyebrow')}
        title={t('programs.title')}
        subtitle={t('programs.subtitle')}
        actions={
          <Button variant="secondary" onClick={() => overview.refetch()} className="min-h-11">
            <RefreshCw className="h-4 w-4" />
            {t('programs.refresh')}
          </Button>
        }
      />

      {overview.isError ? <Card className="border-alert-line bg-alert-soft p-4 text-alert">{t('programs.loadError')}</Card> : null}

      <section className="grid gap-3 sm:grid-cols-3">
        <ProgramMetric label={t('programs.templates')} value={data?.templates.length ?? 0} icon={ClipboardCheck} />
        <ProgramMetric label={t('programs.deepCleans')} value={data?.deep_clean_schedules.length ?? 0} icon={Sparkles} />
        <ProgramMetric label={t('programs.parAlerts')} value={data?.supply_alerts.length ?? 0} icon={AlertTriangle} tone="alert" />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold text-ink">{t('programs.checklists')}</h2>
              <p className="mt-1 text-sm text-ink3">{t('programs.checklistsHelp')}</p>
            </div>
            <Button onClick={() => initialize.mutate()} disabled={initialize.isPending} className="min-h-11">
              <ClipboardCheck className="h-4 w-4" />
              {t('programs.initialize')}
            </Button>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {data?.templates.map((template) => (
              <div key={template.id} className="rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink2">
                {isSpanish ? template.name_es || template.name : template.name}
              </div>
            ))}
            {!data?.templates.length && !overview.isLoading ? <p className="text-sm text-ink3 sm:col-span-2">{t('programs.noTemplates')}</p> : null}
          </div>
        </Card>

        <Card className="p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 text-alert" />
            <div>
              <h2 className="font-semibold text-ink">{t('programs.dndTitle')}</h2>
              <p className="mt-1 text-sm text-ink3">{t('programs.dndHelp')}</p>
            </div>
          </div>
          <form className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); saveDnd.mutate({ threshold_hours: thresholdHours, escalation_roles: ['housekeeping_supervisor', 'front_desk'] }) }}>
            <label className="flex-1 text-sm font-medium text-ink2">
              {t('programs.dndThreshold')}
              <Input type="number" min={1} max={72} value={thresholdHours} onChange={(event) => setThresholdHours(Number(event.target.value))} className="mt-1 min-h-11" />
            </label>
            <Button type="submit" disabled={saveDnd.isPending} className="min-h-11">{t('programs.save')}</Button>
          </form>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <h2 className="font-semibold text-ink">{t('programs.stayoverTitle')}</h2>
          <p className="mt-1 text-sm text-ink3">{t('programs.stayoverHelp')}</p>
          <form className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); saveStayover.mutate({ linen_change_frequency_days: linenDays, opt_out_allowed: true }) }}>
            <label className="flex-1 text-sm font-medium text-ink2">
              {t('programs.linenDays')}
              <Input type="number" min={1} max={30} value={linenDays} onChange={(event) => setLinenDays(Number(event.target.value))} className="mt-1 min-h-11" />
            </label>
            <Button type="submit" disabled={saveStayover.isPending} className="min-h-11">{t('programs.save')}</Button>
          </form>
        </Card>

        <Card className="p-4 sm:p-5">
          <div className="flex items-start gap-3"><PackageCheck className="mt-0.5 h-5 w-5 text-accent" /><div><h2 className="font-semibold text-ink">{t('programs.supplyTitle')}</h2><p className="mt-1 text-sm text-ink3">{t('programs.supplyHelp')}</p></div></div>
          <form className="mt-4 grid gap-2 sm:grid-cols-2" onSubmit={submitSupply}>
            <Input aria-label={t('programs.supplyName')} placeholder={t('programs.supplyName')} value={supply.name} onChange={(event) => setSupply((current) => ({ ...current, name: event.target.value }))} className="min-h-11" />
            <select aria-label={t('programs.supplyType')} value={supply.supply_type} onChange={(event) => setSupply((current) => ({ ...current, supply_type: event.target.value as SupplyPar['supply_type'] }))} className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm text-ink">
              <option value="linen">{t('programs.linen')}</option><option value="chemical">{t('programs.chemical')}</option><option value="amenity">{t('programs.amenity')}</option>
            </select>
            <Input aria-label={t('programs.onHand')} type="number" min={0} value={supply.on_hand} onChange={(event) => setSupply((current) => ({ ...current, on_hand: Number(event.target.value) }))} className="min-h-11" />
            <Input aria-label={t('programs.parLevel')} type="number" min={0} value={supply.par_level} onChange={(event) => setSupply((current) => ({ ...current, par_level: Number(event.target.value) }))} className="min-h-11" />
            <Button type="submit" disabled={saveSupply.isPending} className="min-h-11 sm:col-span-2"><Droplets className="h-4 w-4" />{t('programs.saveSupply')}</Button>
          </form>
          {data?.supply_alerts.length ? <p className="mt-3 text-sm text-alert">{t('programs.alertSummary', { count: data.supply_alerts.length })}</p> : null}
        </Card>
      </section>
    </main>
  )
}
