'use client'

import { AlertTriangle, ArrowRight, CheckCircle2, Plus, RefreshCw, Siren, Sparkles, UsersRound } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ExceptionsModel, ReadinessModel, TeamPulseModel } from '@/lib/design/dashboardV2Model'
import { formatPartialCount } from '@/lib/design/dashboardV2Model'
import type { WorkOrder } from '@/lib/api/engineering'
import { cn } from '@/lib/utils'

/** Phase 7 manager-dashboard sections. Rendered by SimplifiedDashboard ONLY when the Design System V2
 *  preview is on. Purely presentational: every number arrives from data the dashboard already
 *  fetches (no queries here, no AI calls, no invented values). */

const card = 'bg-surface border border-line rounded-[var(--r-lg)] shadow-card'
const cardTitle = 'text-[15px] font-semibold text-ink'

export function DashboardV2Header({
  hotelName, updatedAt, onRefresh, onNewTask,
}: { hotelName?: string | null; updatedAt?: number; onRefresh: () => void; onNewTask: () => void }) {
  const { t, i18n } = useTranslation()
  const date = new Intl.DateTimeFormat(i18n.language, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())
  const time = updatedAt ? new Intl.DateTimeFormat(i18n.language, { hour: 'numeric', minute: '2-digit' }).format(new Date(updatedAt)) : null
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.01em] text-ink">{t('dashboardV2.title')}</h1>
        <p className="mt-1 text-[14px] text-ink2">
          {[hotelName, date].filter(Boolean).join(' · ')}
          <span className="mx-2 text-ink3" aria-hidden>·</span>
          <span className="inline-flex items-center gap-1.5 text-ink3" role="status">
            <span className="inline-block h-2 w-2 rounded-full bg-[var(--ready)]" aria-hidden />
            {time ? `${t('dashboardV2.live')} · ${t('dashboardV2.updated', { time })}` : t('dashboardV2.notUpdated')}
          </span>
        </p>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onRefresh} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-[var(--r-md)] border border-line bg-surface px-3.5 text-[14px] font-medium text-ink hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">
          <RefreshCw size={14} aria-hidden /> {t('dashboardV2.refresh')}
        </button>
        <button type="button" onClick={onNewTask} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-[var(--r-md)] bg-[var(--accent)] px-3.5 text-[14px] font-semibold text-[var(--accent-ink)] hover:bg-[var(--dv2-primary-pressed)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">
          <Plus size={14} aria-hidden /> {t('dashboardV2.newTask')}
        </button>
      </div>
    </header>
  )
}

export interface KpiTile {
  key: string
  label: string
  value: string
  hint?: string
  active?: boolean
  /** Overrides the default "Show {label} rooms" name for tiles that do not filter rooms. */
  ariaLabel?: string
  onClick?: () => void
}

export function DashboardV2Kpis({ tiles, loading }: { tiles: KpiTile[]; loading: boolean }) {
  const { t } = useTranslation()
  return (
    <section aria-label={t('dashboardV2.kpiAria')} className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {loading
        ? tiles.map((tile) => <div key={tile.key} className={cn(card, 'min-h-[88px] animate-pulse')} />)
        : tiles.map((tile) => {
            const body = (
              <>
                <span className="text-[12px] font-medium text-ink2">{tile.label}</span>
                <span className="flex items-baseline gap-2">
                  <span className="text-[28px] leading-none font-semibold tabular-nums text-ink">{tile.value}</span>
                  {tile.hint && <span className="text-[12px] text-ink3">{tile.hint}</span>}
                </span>
              </>
            )
            const base = cn(card, 'flex min-h-[88px] flex-col justify-between gap-2 px-4 py-3 text-left')
            return tile.onClick ? (
              <button
                key={tile.key}
                type="button"
                onClick={tile.onClick}
                aria-pressed={tile.active === undefined ? undefined : tile.active}
                aria-label={tile.ariaLabel ?? t('dashboardV2.openRoomList', { label: tile.label })}
                className={cn(base, 'transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]', tile.active && 'border-[var(--accent)] bg-[var(--accent-soft)]')}
              >
                {body}
              </button>
            ) : (
              <div key={tile.key} className={base}>{body}</div>
            )
          })}
    </section>
  )
}

const SEGMENTS = [
  { key: 'inspected', labelKey: 'readinessInspected', color: 'var(--ready)', Icon: CheckCircle2 },
  { key: 'clean', labelKey: 'readinessClean', color: 'var(--dv2-clean)', Icon: CheckCircle2 },
  { key: 'inProgress', labelKey: 'readinessInProgress', color: 'var(--progress)', Icon: RefreshCw },
  { key: 'dirty', labelKey: 'readinessDirty', color: 'var(--alert)', Icon: AlertTriangle },
] as const

export function ReadinessCard({ model, onOpenBoard }: { model: ReadinessModel; onOpenBoard: () => void }) {
  const { t } = useTranslation()
  return (
    <section className={cn(card, 'flex flex-col gap-4 p-5')} aria-labelledby="dv2-readiness-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="dv2-readiness-title" className={cardTitle}>{t('dashboardV2.readinessTitle')}</h2>
        <button type="button" onClick={onOpenBoard} className="inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--accent)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">
          {t('dashboardV2.viewBoard')} <ArrowRight size={14} aria-hidden />
        </button>
      </div>
      {model.percent === null ? (
        <p className="text-[14px] text-ink2">{t('dashboardV2.readinessEmpty')}</p>
      ) : (
        <>
          <div className="flex items-baseline gap-3">
            <span className="text-[36px] leading-none font-semibold tabular-nums text-ink">{model.percent}%</span>
            <span className="text-[14px] text-ink2">{t('dashboardV2.readinessSummary', { inspected: model.inspected, scope: model.scope })}</span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={model.percent}
            aria-label={t('dashboardV2.readinessAria', { percent: model.percent })}
            className="flex h-3 w-full overflow-hidden rounded-full bg-surface-3"
          >
            {SEGMENTS.map(({ key, color }) => {
              const n = model[key]
              return n > 0 ? <span key={key} style={{ width: `${(n / model.scope) * 100}%`, background: color }} /> : null
            })}
          </div>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            {SEGMENTS.map(({ key, labelKey, color, Icon }) => (
              <li key={key} className="flex items-center gap-2 text-[13px] text-ink2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} aria-hidden />
                <Icon size={13} aria-hidden className="shrink-0 text-ink3" />
                <span>{t(`dashboardV2.${labelKey}`)}</span>
                <span className="ml-auto font-semibold tabular-nums text-ink">{model[key]}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="text-[12px] text-ink3">
        {t('dashboardV2.readinessOutside', { outOfOrder: model.outOfOrder, occupied: model.occupiedStayover })}
      </p>
    </section>
  )
}

export function ExceptionsCard({
  model, workOrders, workOrdersPerPage, onOpenWorkOrder, onOpenDepartures,
}: {
  model: ExceptionsModel
  workOrders: WorkOrder[]
  workOrdersPerPage?: number
  onOpenWorkOrder: (wo: WorkOrder) => void
  onOpenDepartures: () => void
}) {
  const { t } = useTranslation()
  const byId = new Map(workOrders.map((w) => [w.id, w]))
  const rows = model.urgentWorkOrders.map((u) => byId.get(u.id)).filter((w): w is WorkOrder => !!w).slice(0, 5)
  return (
    <section className={cn(card, 'flex flex-col gap-3 p-5')} aria-labelledby="dv2-exceptions-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="dv2-exceptions-title" className={cardTitle}>{t('dashboardV2.exceptionsTitle')}</h2>
        {model.total > 0 && <span className="text-[13px] font-medium text-ink2">{t('dashboardV2.exceptionsCount', { count: model.total })}</span>}
      </div>
      {model.total === 0 ? (
        <p className="flex items-center gap-2 text-[14px] text-ink2"><CheckCircle2 size={16} className="text-[var(--ready)]" aria-hidden />{t('dashboardV2.exceptionsEmpty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--line)]">
          {rows.map((wo) => (
            <li key={wo.id}>
              <button type="button" onClick={() => onOpenWorkOrder(wo)} className="flex w-full min-h-[48px] items-center gap-3 py-2 text-left hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
                <Siren size={16} className="shrink-0 text-[var(--alert)]" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-ink">{wo.title}</span>
                  <span className="block text-[12px] text-ink3">
                    {wo.rooms?.room_number ?? wo.location_text ?? ''}{wo.rooms?.room_number || wo.location_text ? ' · ' : ''}
                    <span className="font-semibold uppercase text-[var(--alert)]">{wo.priority}</span>
                    {!wo.assigned_to && <> · {t('dashboardV2.exceptionUrgentUnassigned')}</>}
                  </span>
                </span>
                <ArrowRight size={14} className="shrink-0 text-ink3" aria-hidden />
              </button>
            </li>
          ))}
          {model.departuresNotReady > 0 && (
            <li>
              <button type="button" onClick={onOpenDepartures} className="flex w-full min-h-[48px] items-center gap-3 py-2 text-left hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
                <AlertTriangle size={16} className="shrink-0 text-[var(--caution)]" aria-hidden />
                <span className="flex-1 text-[14px] font-medium text-ink">
                  {model.departuresNotReady === 1 ? t('dashboardV2.exceptionDeparturesOne') : t('dashboardV2.exceptionDepartures', { count: model.departuresNotReady })}
                </span>
                <ArrowRight size={14} className="shrink-0 text-ink3" aria-hidden />
              </button>
            </li>
          )}
        </ul>
      )}
      {model.workOrdersPartial && (
        <p className="text-[12px] text-ink3">{t('dashboardV2.exceptionsPartial', { count: formatPartialCount(workOrders.length, workOrdersPerPage) })}</p>
      )}
    </section>
  )
}

export function TeamPulseCard({ model }: { model: TeamPulseModel }) {
  const { t } = useTranslation()
  return (
    <section className={cn(card, 'flex flex-col gap-3 p-5')} aria-labelledby="dv2-pulse-title">
      <h2 id="dv2-pulse-title" className={cn(cardTitle, 'flex items-center gap-2')}><UsersRound size={16} aria-hidden />{t('dashboardV2.teamPulseTitle')}</h2>
      {model.percent === null ? (
        <p className="text-[14px] text-ink2">{t('dashboardV2.teamPulseNone')}</p>
      ) : (
        <>
          <div className="flex items-baseline gap-3">
            <span className="text-[28px] leading-none font-semibold tabular-nums text-ink">{model.percent}%</span>
            <span className="text-[14px] text-ink2">{t('dashboardV2.teamPulseProgress', { done: model.done, assigned: model.assigned })}</span>
          </div>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={model.percent} aria-label={t('dashboardV2.teamPulseProgress', { done: model.done, assigned: model.assigned })} className="h-2.5 w-full overflow-hidden rounded-full bg-surface-3">
            <span className="block h-full rounded-full bg-[var(--accent)]" style={{ width: `${model.percent}%` }} />
          </div>
          <p className="text-[13px] text-ink2">{t('dashboardV2.teamPulseStaff', { count: model.housekeepers })}</p>
        </>
      )}
      <p className="text-[12px] text-ink3">{t('dashboardV2.teamPulseNote')}</p>
    </section>
  )
}

/** Violet AI frame. The briefing and chat inside it are the existing, user-initiated components. */
export function AIInsightsCard({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <section className="relative overflow-hidden rounded-[var(--r-lg)] border border-[var(--ai-line)] bg-[var(--dv2-shell-bg)] text-white shadow-card" aria-labelledby="dv2-ai-title">
      <div className="flex items-center gap-2 border-b border-white/10 px-5 py-3">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-[var(--dv2-ai)] text-[var(--dv2-on-ai)]"><Sparkles size={14} aria-hidden /></span>
        <h2 id="dv2-ai-title" className="text-[15px] font-semibold text-white">{t('dashboardV2.aiTitle')}</h2>
      </div>
      <div className="flex flex-col gap-4 p-5">{children}</div>
      <p className="border-t border-white/10 px-5 py-2 text-[12px] text-white/70">{t('dashboardV2.aiNote')}</p>
    </section>
  )
}
