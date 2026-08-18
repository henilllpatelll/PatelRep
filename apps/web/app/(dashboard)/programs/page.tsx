'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ClipboardCheck, RefreshCw, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { StateBlock } from '@/components/ui/StateBlock'
import { HousekeepingDepthPanels } from '@/components/programs/HousekeepingDepthPanels'
import { programsApi } from '@/lib/api/programs'
import { useHotelStore } from '@/stores/hotelStore'
import { isSectionRedesigned } from '@/lib/utils/redesignFlag'

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
  const hotel = useHotelStore((s) => s.hotel)
  const v2 = isSectionRedesigned('programs', hotel)

  const overview = useQuery({ queryKey: ['operational-programs'], queryFn: programsApi.overview })
  const data = overview.data?.data

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['operational-programs'] })
  const initialize = useMutation({ mutationFn: programsApi.initializeTemplates, onSuccess: refresh })

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

      {overview.isError ? (
        v2 ? (
          <StateBlock status="error" error={{ message: t('programs.loadError'), onRetry: () => overview.refetch() }} />
        ) : (
          <Card className="border-alert-line bg-alert-soft p-4 text-alert">{t('programs.loadError')}</Card>
        )
      ) : null}

      <section className="grid gap-3 sm:grid-cols-3">
        <ProgramMetric label={t('programs.templates')} value={data?.templates.length ?? 0} icon={ClipboardCheck} />
        <ProgramMetric label={t('programs.deepCleans')} value={data?.deep_clean_schedules.length ?? 0} icon={Sparkles} />
        <ProgramMetric label={t('programs.parAlerts')} value={data?.supply_alerts.length ?? 0} icon={AlertTriangle} tone="alert" />
      </section>

      <section className="grid gap-4">
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
      </section>

      <HousekeepingDepthPanels redesigned={v2} />
    </main>
  )
}
