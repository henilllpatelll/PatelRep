'use client'

// Housekeeping program depth UI (04-07 / HK-01, HK-04, HK-05, HK-06, G12).
// Composes the DND welfare timing + documented escalation policy, the
// passive linen/chemical/amenity par-alert badges, the stayover linen-change
// rule, plus the deep-clean/public-area and inspection sampling/quality
// depth panels (split into sibling files to keep every file under the
// project's 500-line limit -- see DeepCleanAreasPanel.tsx and
// InspectionDepthPanel.tsx). All surfaces are tenant-scoped through the
// manager-gated /programs routes.
// Bilingual via react-i18next (04-08/4C) -- see the `programs` namespace
// (dndPolicy/stayover/parShortages keys) in i18n/locales/{en,es}.ts.

import { FormEvent, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Droplets, PackageCheck, ShieldAlert } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { useRole } from '@/lib/hooks/useRole'
import { programsApi, type SupplyPar } from '@/lib/api/programs'
import { DeepCleanAreasPanel } from '@/components/programs/DeepCleanAreasPanel'
import { InspectionDepthPanel } from '@/components/programs/InspectionDepthPanel'

// Shared with ProgramsPage's own overview query -- same key means React
// Query dedupes the network call across every component that reads it.
const OVERVIEW_KEY = ['operational-programs']

function toggleValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value]
}

export function HousekeepingDepthPanels() {
  const { t } = useTranslation()
  const ESCALATION_ROLE_OPTIONS: Array<{ value: 'housekeeping_supervisor' | 'front_desk' | 'gm'; label: string }> = [
    { value: 'housekeeping_supervisor', label: t('programs.dndPolicy.roleSupervisor') },
    { value: 'front_desk', label: t('programs.dndPolicy.roleFrontDesk') },
    { value: 'gm', label: t('programs.dndPolicy.roleGm') },
  ]
  const { isSupervisor, canViewEngineering } = useRole()
  // Union of gm/housekeeping_supervisor/engineer/chief_engineer -- exactly
  // matches apps/api/routers/programs.py's MANAGER_ROLES.
  const isManager = isSupervisor || canViewEngineering
  // DND policy and stayover-rule mutations require the narrower
  // require_role("gm", "housekeeping_supervisor") server-side.
  const canConfigurePolicy = isSupervisor

  const queryClient = useQueryClient()
  const invalidateOverview = () => queryClient.invalidateQueries({ queryKey: OVERVIEW_KEY })

  const overview = useQuery({ queryKey: OVERVIEW_KEY, queryFn: programsApi.overview, enabled: isManager })
  const data = overview.data?.data

  // ── DND welfare policy (documented escalation policy, HK-06) ────────────
  const [dndThreshold, setDndThreshold] = useState(8)
  const [escalationRoles, setEscalationRoles] = useState<string[]>(['housekeeping_supervisor', 'front_desk'])
  const [escalationInstructions, setEscalationInstructions] = useState('')
  useEffect(() => {
    if (!data?.dnd_welfare_policy) return
    setDndThreshold(data.dnd_welfare_policy.threshold_hours)
    setEscalationRoles(data.dnd_welfare_policy.escalation_roles)
    setEscalationInstructions(data.dnd_welfare_policy.escalation_instructions || '')
  }, [data?.dnd_welfare_policy])
  const saveDndPolicy = useMutation({ mutationFn: programsApi.updateDndPolicy, onSuccess: invalidateOverview })
  const submitDndPolicy = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!escalationRoles.length) return
    saveDndPolicy.mutate({
      threshold_hours: dndThreshold,
      escalation_roles: escalationRoles as Array<'housekeeping_supervisor' | 'front_desk' | 'gm'>,
      escalation_instructions: escalationInstructions.trim() || undefined,
    })
  }

  // ── Stayover linen rule ──────────────────────────────────────────────────
  const [linenDays, setLinenDays] = useState(3)
  const [optOutAllowed, setOptOutAllowed] = useState(true)
  useEffect(() => {
    if (!data?.stayover_rule) return
    setLinenDays(data.stayover_rule.linen_change_frequency_days)
    setOptOutAllowed(data.stayover_rule.opt_out_allowed)
  }, [data?.stayover_rule])
  const saveStayover = useMutation({ mutationFn: programsApi.updateStayoverRule, onSuccess: invalidateOverview })

  // ── Supply pars + passive alert badges ───────────────────────────────────
  const [supplyForm, setSupplyForm] = useState<Pick<SupplyPar, 'supply_type' | 'name' | 'on_hand' | 'par_level' | 'unit'>>({
    supply_type: 'linen', name: '', on_hand: 0, par_level: 0, unit: 'each',
  })
  const saveSupplyPar = useMutation({
    mutationFn: programsApi.upsertSupplyPar,
    onSuccess: () => {
      invalidateOverview()
      setSupplyForm({ supply_type: 'linen', name: '', on_hand: 0, par_level: 0, unit: 'each' })
    },
  })
  const submitSupplyPar = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supplyForm.name.trim()) return
    saveSupplyPar.mutate({ ...supplyForm, name: supplyForm.name.trim() })
  }

  // All hooks above must run unconditionally (Rules of Hooks) -- the
  // manager gate only affects what renders, never how many hooks fire.
  if (!isManager) return null

  return (
    <div className="space-y-4">
      <DeepCleanAreasPanel />

      {/* DND welfare policy + stayover rule */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 text-alert" />
            <div>
              <h2 className="font-semibold text-ink">{t('programs.dndPolicy.title')}</h2>
              <p className="mt-1 text-sm text-ink3">
                {t('programs.dndPolicy.subtitle')}
              </p>
            </div>
          </div>
          {canConfigurePolicy ? (
            <form className="mt-4 space-y-3" onSubmit={submitDndPolicy}>
              <label className="block text-sm font-medium text-ink2">
                {t('programs.dndPolicy.hoursBeforeEscalation')}
                <Input
                  type="number" min={1} max={72} value={dndThreshold}
                  onChange={(event) => setDndThreshold(Number(event.target.value))}
                  className="mt-1 min-h-11"
                />
              </label>
              <fieldset className="text-sm font-medium text-ink2">
                <legend>{t('programs.dndPolicy.escalateTo')}</legend>
                <div className="mt-1 flex flex-wrap gap-3">
                  {ESCALATION_ROLE_OPTIONS.map((option) => (
                    <label key={option.value} className="flex items-center gap-2 font-normal text-ink3">
                      <input
                        type="checkbox"
                        checked={escalationRoles.includes(option.value)}
                        onChange={() => setEscalationRoles((current) => toggleValue(current, option.value))}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="block text-sm font-medium text-ink2">
                {t('programs.dndPolicy.escalationInstructionsLabel')}
                <textarea
                  value={escalationInstructions}
                  onChange={(event) => setEscalationInstructions(event.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
                  placeholder={t('programs.dndPolicy.escalationInstructionsPlaceholder')}
                />
              </label>
              <Button type="submit" disabled={saveDndPolicy.isPending} className="min-h-11">{t('programs.dndPolicy.savePolicy')}</Button>
            </form>
          ) : (
            <p className="mt-4 text-sm text-ink3">{t('programs.dndPolicy.restrictedEdit')}</p>
          )}
        </Card>

        <Card className="p-4 sm:p-5">
          <h2 className="font-semibold text-ink">{t('programs.stayover.title')}</h2>
          <p className="mt-1 text-sm text-ink3">{t('programs.stayover.subtitle')}</p>
          {canConfigurePolicy ? (
            <form
              className="mt-4 space-y-3"
              onSubmit={(event) => { event.preventDefault(); saveStayover.mutate({ linen_change_frequency_days: linenDays, opt_out_allowed: optOutAllowed }) }}
            >
              <label className="block text-sm font-medium text-ink2">
                {t('programs.stayover.daysBetween')}
                <Input type="number" min={1} max={30} value={linenDays} onChange={(event) => setLinenDays(Number(event.target.value))} className="mt-1 min-h-11" />
              </label>
              <label className="flex items-center gap-2 text-sm font-medium text-ink2">
                <input type="checkbox" checked={optOutAllowed} onChange={(event) => setOptOutAllowed(event.target.checked)} />
                {t('programs.stayover.optOutLabel')}
              </label>
              <Button type="submit" disabled={saveStayover.isPending} className="min-h-11">{t('programs.stayover.saveRule')}</Button>
            </form>
          ) : (
            <p className="mt-4 text-sm text-ink3">{t('programs.stayover.restrictedEdit')}</p>
          )}
        </Card>
      </section>

      {/* Par alerts (passive) + supply par upsert */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-alert" />
            <div>
              <h2 className="font-semibold text-ink">{t('programs.parShortages.title')}</h2>
              <p className="mt-1 text-sm text-ink3">{t('programs.parShortages.subtitle')}</p>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {(data?.supply_alerts ?? []).map((alert) => (
              <div key={alert.name} className="flex items-center justify-between rounded-lg border border-alert-line bg-alert-soft px-3 py-2.5 text-sm text-alert">
                <span className="font-medium">{alert.name}</span>
                <span>{t('programs.parShortages.onHandOf', { onHand: alert.on_hand, parLevel: alert.par_level, shortage: alert.shortage })}</span>
              </div>
            ))}
            {!data?.supply_alerts?.length && !overview.isLoading ? (
              <p className="text-sm text-ink3">{t('programs.parShortages.noShortages')}</p>
            ) : null}
          </div>
        </Card>

        <Card className="p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <PackageCheck className="mt-0.5 h-5 w-5 text-accent" />
            <div>
              <h2 className="font-semibold text-ink">{t('programs.parShortages.supplyTitle')}</h2>
              <p className="mt-1 text-sm text-ink3">{t('programs.parShortages.supplyHelp')}</p>
            </div>
          </div>
          <form className="mt-4 grid gap-2 sm:grid-cols-2" onSubmit={submitSupplyPar}>
            <Input aria-label={t('programs.supplyName')} placeholder={t('programs.supplyName')} value={supplyForm.name} onChange={(event) => setSupplyForm((current) => ({ ...current, name: event.target.value }))} className="min-h-11" />
            <select
              aria-label={t('programs.supplyType')}
              value={supplyForm.supply_type}
              onChange={(event) => setSupplyForm((current) => ({ ...current, supply_type: event.target.value as SupplyPar['supply_type'] }))}
              className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm text-ink"
            >
              <option value="linen">{t('programs.linen')}</option>
              <option value="chemical">{t('programs.chemical')}</option>
              <option value="amenity">{t('programs.amenity')}</option>
            </select>
            <Input aria-label={t('programs.onHand')} type="number" min={0} value={supplyForm.on_hand} onChange={(event) => setSupplyForm((current) => ({ ...current, on_hand: Number(event.target.value) }))} className="min-h-11" />
            <Input aria-label={t('programs.parLevel')} type="number" min={0} value={supplyForm.par_level} onChange={(event) => setSupplyForm((current) => ({ ...current, par_level: Number(event.target.value) }))} className="min-h-11" />
            <Button type="submit" disabled={saveSupplyPar.isPending} className="min-h-11 sm:col-span-2">
              <Droplets className="h-4 w-4" /> {t('programs.saveSupply')}
            </Button>
          </form>
        </Card>
      </section>

      <InspectionDepthPanel />
    </div>
  )
}
