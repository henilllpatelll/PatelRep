'use client'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Wrench, Calendar, CheckCircle2, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/authStore'
import { useHotelStore } from '@/stores/hotelStore'
import { isSectionRedesigned } from '@/lib/utils/redesignFlag'
import { engineeringApi, type WorkOrder, type PMSchedule, type FailurePrediction } from '@/lib/api/engineering'
import { reportsApi } from '@/lib/api/reports'
import { Stat, Pill, SectionLabel, AILabel, Mono } from '@/components/ui/primitives'
import { StateBlock } from '@/components/ui/StateBlock'
import { DashboardGreeting } from '@/components/dashboard/DashboardGreeting'
import { cn } from '@/lib/utils'
import { format, subDays } from 'date-fns'

function SkeletonRow({ v2 }: { v2?: boolean } = {}) {
  return (
    <div className={cn('animate-pulse flex items-center gap-3 px-4 py-3 border-t border-line-2', v2 && 'ease-standard')}>
      <div className="w-[3px] h-8 rounded-full bg-surface-3 shrink-0" />
      <div className="h-3 w-16 bg-surface-3 rounded shrink-0" />
      <div className="flex-1">
        <div className="h-3 bg-surface-3 rounded w-3/4" />
      </div>
      <div className="h-4 w-12 bg-surface-3 rounded shrink-0" />
      <div className="h-5 w-14 bg-surface-3 rounded-full shrink-0" />
    </div>
  )
}

const PRIORITY_TONE: Record<string, 'alert' | 'caution' | 'neutral'> = {
  urgent: 'alert',
  normal: 'caution',
  low: 'neutral',
}

const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  in_progress: 'In progress',
  on_hold: 'On hold',
  completed: 'Done',
  cancelled: 'Cancelled',
}

export function ChiefEngineerDashboard() {
  const { t } = useTranslation()
  const hotel = useHotelStore(s => s.hotel)
  const v2 = isSectionRedesigned('dashboard', hotel)
  const user = useAuthStore(s => s.user)

  const fullName: string =
    (user?.user_metadata?.full_name as string | undefined) ||
    user?.email?.split('@')[0] ||
    'Chief Engineer'
  const firstName = fullName.includes('@') ? fullName.split('@')[0] : fullName.split(' ')[0] || fullName

  const { data: woData, isLoading: woLoading, isError: woError, refetch: refetchWO } = useQuery({
    queryKey: ['all-work-orders'],
    queryFn: () => engineeringApi.listWorkOrders({ per_page: 100 }),
    refetchInterval: 60_000,
  })

  const { data: pmData, isLoading: pmLoading } = useQuery({
    queryKey: ['pm-schedules'],
    queryFn: () => engineeringApi.listPMSchedules(),
    refetchInterval: 120_000,
  })

  const { data: predictionsData, isError: predictionsError, refetch: refetchPredictions } = useQuery({
    queryKey: ['failure-predictions'],
    queryFn: () => engineeringApi.getFailurePredictions(),
    refetchInterval: 120_000,
  })

  const { data: maintData, isError: maintError, refetch: refetchMaint } = useQuery({
    queryKey: ['maintenance-report', format(subDays(new Date(), 30), 'yyyy-MM-dd'), format(new Date(), 'yyyy-MM-dd')],
    queryFn: () => reportsApi.getMaintenance({
      start_date: format(subDays(new Date(), 30), 'yyyy-MM-dd'),
      end_date: format(new Date(), 'yyyy-MM-dd'),
    }),
    refetchInterval: 120_000,
  })

  const allWOs: WorkOrder[] = (woData as { data?: WorkOrder[] })?.data ?? []
  const openWOs = allWOs.filter(wo => wo.status === 'open' || wo.status === 'in_progress')
  const urgentWOs = openWOs.filter(wo => wo.priority === 'urgent')
  const unassignedWOs = openWOs.filter(wo => !wo.assigned_to)

  const pmSchedules: PMSchedule[] = (pmData as { data?: PMSchedule[] })?.data ?? []
  const now = new Date()
  const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  const pmDueSoon = pmSchedules.filter(pm => pm.is_active && new Date(pm.next_due_at) <= sevenDays)

  const predictions: FailurePrediction[] = (predictionsData as { data?: FailurePrediction[] })?.data ?? []
  const highRiskAssets = predictions.filter(p => !p.is_acknowledged && p.risk_score >= 70)

  const maint = maintData?.data
  const totalAssets = pmSchedules.length

  const sortedWOs = [
    ...urgentWOs.filter(wo => wo.status === 'in_progress'),
    ...urgentWOs.filter(wo => wo.status === 'open'),
    ...openWOs.filter(wo => wo.priority !== 'urgent' && wo.status === 'in_progress'),
    ...openWOs.filter(wo => wo.priority !== 'urgent' && wo.status === 'open'),
  ]

  if (!v2) {
  return (
    <div className="flex flex-col gap-5">
      <DashboardGreeting
        name={firstName}
        subtitle={
          urgentWOs.length > 0
            ? `${openWOs.length} open work orders — ${urgentWOs.length} need immediate attention.`
            : openWOs.length > 0
            ? `${openWOs.length} open work orders. No urgent items.`
            : 'All work orders resolved. Good shift.'
        }
      />

      {/* Stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat
          label="Open WOs"
          value={openWOs.length}
          delta={unassignedWOs.length > 0 ? `${unassignedWOs.length} unassigned` : undefined}
          deltaTone={unassignedWOs.length > 0 ? 'caution' : 'ready'}
        />
        <Stat
          label="Urgent Priority"
          value={urgentWOs.length}
          delta={urgentWOs.length > 0 ? 'needs action' : undefined}
          deltaTone={urgentWOs.length > 0 ? 'alert' : 'ready'}
        />
        <Stat
          label="PM Due"
          value={pmDueSoon.length}
          delta={pmDueSoon.length > 0 ? 'this week' : undefined}
          deltaTone={pmDueSoon.length > 0 ? 'caution' : 'ready'}
        />
        <Stat
          label="Assets Tracked"
          value={totalAssets}
          deltaTone="neutral"
        />
      </div>

      {/* Work order queue */}
      <div className="bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden shadow-card">
        <div className="px-4 pt-3.5">
          <SectionLabel
            hint={`${openWOs.length} open`}
            action={
              <Link href="/engineering" className="text-[11px] font-medium text-ink3 hover:text-ink transition-colors">
                View board
              </Link>
            }
          >
            Work order queue
          </SectionLabel>
        </div>
        {woLoading ? (
          [...Array(4)].map((_, i) => <SkeletonRow key={i} />)
        ) : sortedWOs.length === 0 ? (
          <div className="py-8 flex flex-col items-center gap-2">
            <CheckCircle2 className="w-8 h-8 text-[var(--ready-line)]" />
            <p className="text-[13px] text-ink3">All work orders closed</p>
          </div>
        ) : (
          sortedWOs.slice(0, 8).map(wo => {
            const tone = PRIORITY_TONE[wo.priority] ?? 'neutral'
            const loc = wo.rooms?.room_number
              ? `R-${wo.rooms.room_number}`
              : wo.location_text ?? '—'
            return (
              <Link
                key={wo.id}
                href="/engineering"
                className="flex items-center gap-3 px-4 py-2.5 border-t border-line-2 hover:bg-surface-2 transition-colors"
              >
                <div
                  className="w-[3px] h-8 rounded-full shrink-0"
                  style={{
                    background: tone === 'alert'
                      ? 'var(--alert)'
                      : tone === 'caution'
                      ? 'var(--caution)'
                      : 'var(--line)',
                  }}
                />
                <Mono className="text-[11px] text-ink3 shrink-0">
                  WO-{wo.work_order_number}
                </Mono>
                <span className="text-[13px] font-medium text-ink flex-1 min-w-0 truncate">
                  {wo.title}
                </span>
                <Mono className="text-[11px] text-ink3 bg-surface-2 border border-line rounded px-1.5 py-0.5 shrink-0">
                  {loc}
                </Mono>
                <Pill tone={tone} size="sm">{wo.priority}</Pill>
                <span className="text-[11px] text-ink3 w-16 text-right shrink-0 capitalize">
                  {STATUS_LABEL[wo.status] ?? wo.status}
                </span>
              </Link>
            )
          })
        )}
        {sortedWOs.length > 8 && (
          <div className="px-4 py-2.5 border-t border-line-2">
            <Link href="/engineering" className="text-[11px] text-ink3 hover:text-ink transition-colors">
              +{sortedWOs.length - 8} more work orders
            </Link>
          </div>
        )}
      </div>

      {/* PM due soon */}
      {(pmLoading || pmDueSoon.length > 0) && (
        <div className="bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden shadow-card">
          <div className="px-4 pt-3.5">
            <SectionLabel
              hint={`${pmDueSoon.length} due`}
              action={
                <Link href="/engineering/pm-schedules" className="text-[11px] font-medium text-ink3 hover:text-ink transition-colors">
                  All PM
                </Link>
              }
            >
              PM due in 7 days
            </SectionLabel>
          </div>
          {pmLoading ? (
            <div className="px-4 pb-3 animate-pulse space-y-2">
              {[...Array(3)].map((_, i) => <div key={i} className="h-8 bg-surface-3 rounded-lg" />)}
            </div>
          ) : (
            <div>
              {pmDueSoon.slice(0, 5).map(pm => {
                const dueDate = new Date(pm.next_due_at)
                const isOverdue = dueDate < now
                return (
                  <Link
                    key={pm.id}
                    href="/engineering/pm-schedules"
                    className="flex items-center gap-3 px-4 py-2.5 border-t border-line-2 hover:bg-surface-2 transition-colors"
                  >
                    <div className="w-7 h-7 rounded-lg bg-surface-2 border border-line flex items-center justify-center shrink-0">
                      <Calendar className="w-3.5 h-3.5 text-ink3" />
                    </div>
                    <span className="text-[13px] font-medium text-ink flex-1 min-w-0 truncate">
                      {pm.name}
                    </span>
                    <span className="text-[11.5px] text-ink3 truncate max-w-[120px]">
                      {pm.assets?.name ?? '—'}
                    </span>
                    <Pill tone={isOverdue ? 'alert' : 'caution'} size="sm">
                      {isOverdue ? 'Overdue' : format(dueDate, 'MMM d')}
                    </Pill>
                  </Link>
                )
              })}
              {pmDueSoon.length > 5 && (
                <div className="px-4 py-2.5 border-t border-line-2">
                  <Link href="/engineering/pm-schedules" className="text-[11px] text-ink3 hover:text-ink transition-colors">
                    +{pmDueSoon.length - 5} more
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* AI failure predictions */}
      {highRiskAssets.length > 0 && (
        <div className="bg-surface border border-[var(--alert-line)] rounded-[var(--r-lg)] overflow-hidden shadow-card">
          <div className="px-4 pt-3.5">
            <SectionLabel
              hint={`${highRiskAssets.length} flagged`}
              action={
                <Link href="/engineering/predictions" className="text-[11px] font-medium text-ink3 hover:text-ink transition-colors">
                  All predictions
                </Link>
              }
            >
              High-risk assets
            </SectionLabel>
          </div>
          <div className="px-4 pb-3">
            <div className="bg-[var(--ai-soft)] border border-[var(--ai-line)] rounded-[var(--r-md)] p-3.5 mb-3">
              <AILabel />
              <p className="font-display italic text-[13px] leading-[1.4] text-ink mt-1.5">
                {highRiskAssets.length} {highRiskAssets.length === 1 ? 'asset has' : 'assets have'} elevated failure risk.
                Preventive action now can avoid unplanned downtime.
              </p>
            </div>
            <div className="space-y-1">
              {highRiskAssets.slice(0, 4).map(p => (
                <Link
                  key={p.id}
                  href="/engineering/predictions"
                  className="flex items-center gap-3 py-2 hover:bg-surface-2 -mx-1 px-1 rounded-lg transition-colors"
                >
                  <div className="w-7 h-7 rounded-lg bg-[var(--alert-soft)] border border-[var(--alert-line)] flex items-center justify-center shrink-0">
                    <Zap className="w-3.5 h-3.5 text-[var(--alert)]" />
                  </div>
                  <span className="text-[13px] font-medium text-ink flex-1 min-w-0 truncate">
                    {p.assets?.name ?? 'Unknown Asset'}
                  </span>
                  <span className="text-[11.5px] text-ink3 truncate max-w-[100px]">
                    {p.assets?.asset_categories?.name}
                  </span>
                  <Pill tone="alert" size="sm">{p.risk_score}% risk</Pill>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SLA callout — shown only when data available */}
      {maint && (
        <div className="bg-surface border border-line rounded-[var(--r-lg)] px-4 py-3.5 shadow-card flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">SLA Compliance</p>
            <p className="font-display text-[28px] leading-none text-ink mt-1">
              {Math.round(maint.sla_compliance_pct)}%
            </p>
          </div>
          <p className="text-[11.5px] text-ink3">Last 30 days</p>
        </div>
      )}
    </div>
  )
  }

  // ── v2 branch ──────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-5">
      <DashboardGreeting
        name={firstName}
        subtitle={
          urgentWOs.length > 0
            ? `${openWOs.length} open work orders — ${urgentWOs.length} need immediate attention.`
            : openWOs.length > 0
            ? `${openWOs.length} open work orders. No urgent items.`
            : 'All work orders resolved. Good shift.'
        }
      />

      {/* Stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {woLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="bg-surface border border-line rounded-[var(--r-lg)] p-[14px_16px] flex flex-col gap-2 min-h-[96px] animate-pulse"
            >
              <div className="h-2.5 w-16 bg-surface-3 rounded" />
              <div className="h-6 w-10 bg-surface-3 rounded mt-1" />
              <div className="h-3 w-12 bg-surface-3 rounded mt-auto" />
            </div>
          ))
        ) : (
          <>
            <Stat
              label="Open WOs"
              value={openWOs.length}
              delta={unassignedWOs.length > 0 ? `${unassignedWOs.length} unassigned` : undefined}
              deltaTone={unassignedWOs.length > 0 ? 'caution' : 'ready'}
            />
            <Stat
              label="Urgent Priority"
              value={urgentWOs.length}
              delta={urgentWOs.length > 0 ? 'needs action' : undefined}
              deltaTone={urgentWOs.length > 0 ? 'alert' : 'ready'}
            />
            <Stat
              label="PM Due"
              value={pmDueSoon.length}
              delta={pmDueSoon.length > 0 ? 'this week' : undefined}
              deltaTone={pmDueSoon.length > 0 ? 'caution' : 'ready'}
            />
            <Stat
              label="Assets Tracked"
              value={totalAssets}
              deltaTone="neutral"
            />
          </>
        )}
      </div>

      {/* Work order queue */}
      <div className="bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden shadow-card transition-shadow duration-base ease-standard">
        <div className="px-4 pt-3.5">
          <SectionLabel
            hint={`${openWOs.length} open`}
            action={
              <Link
                href="/engineering"
                className="text-[11px] font-medium text-ink3 hover:text-ink transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] rounded-sm"
              >
                View board
              </Link>
            }
          >
            Work order queue
          </SectionLabel>
        </div>
        {woError ? (
          <StateBlock status="error" error={{ message: t('common.error'), onRetry: () => refetchWO() }} />
        ) : woLoading ? (
          [...Array(4)].map((_, i) => <SkeletonRow key={i} v2 />)
        ) : sortedWOs.length === 0 ? (
          <StateBlock
            status="empty"
            empty={{ icon: <CheckCircle2 className="w-5 h-5" />, title: t('dashboard.empty.chiefNoWorkOrders') }}
          />
        ) : (
          sortedWOs.slice(0, 8).map(wo => {
            const tone = PRIORITY_TONE[wo.priority] ?? 'neutral'
            const loc = wo.rooms?.room_number
              ? `R-${wo.rooms.room_number}`
              : wo.location_text ?? '—'
            return (
              <Link
                key={wo.id}
                href="/engineering"
                className="flex items-center gap-3 px-4 py-2.5 border-t border-line-2 hover:bg-surface-2 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-inset"
              >
                <div
                  className="w-[3px] h-8 rounded-full shrink-0"
                  style={{
                    background: tone === 'alert'
                      ? 'var(--alert)'
                      : tone === 'caution'
                      ? 'var(--caution)'
                      : 'var(--line)',
                  }}
                />
                <Mono className="text-[11px] text-ink3 shrink-0">
                  WO-{wo.work_order_number}
                </Mono>
                <span className="text-[13px] font-medium text-ink flex-1 min-w-0 truncate">
                  {wo.title}
                </span>
                <Mono className="text-[11px] text-ink3 bg-surface-2 border border-line rounded px-1.5 py-0.5 shrink-0">
                  {loc}
                </Mono>
                <Pill tone={tone} size="sm">{wo.priority}</Pill>
                <span className="text-[11px] text-ink3 w-16 text-right shrink-0 capitalize">
                  {STATUS_LABEL[wo.status] ?? wo.status}
                </span>
              </Link>
            )
          })
        )}
        {sortedWOs.length > 8 && (
          <div className="px-4 py-2.5 border-t border-line-2">
            <Link href="/engineering" className="text-[11px] text-ink3 hover:text-ink transition-colors">
              +{sortedWOs.length - 8} more work orders
            </Link>
          </div>
        )}
      </div>

      {/* PM due soon */}
      {(pmLoading || pmDueSoon.length > 0) && (
        <div className="bg-surface border border-line rounded-[var(--r-lg)] overflow-hidden shadow-card transition-shadow duration-base ease-standard">
          <div className="px-4 pt-3.5">
            <SectionLabel
              hint={`${pmDueSoon.length} due`}
              action={
                <Link
                  href="/engineering/pm-schedules"
                  className="text-[11px] font-medium text-ink3 hover:text-ink transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] rounded-sm"
                >
                  All PM
                </Link>
              }
            >
              PM due in 7 days
            </SectionLabel>
          </div>
          {pmLoading ? (
            <div className="px-4 pb-3 animate-pulse space-y-2">
              {[...Array(3)].map((_, i) => <div key={i} className="h-8 bg-surface-3 rounded-lg" />)}
            </div>
          ) : (
            <div>
              {pmDueSoon.slice(0, 5).map(pm => {
                const dueDate = new Date(pm.next_due_at)
                const isOverdue = dueDate < now
                return (
                  <Link
                    key={pm.id}
                    href="/engineering/pm-schedules"
                    className="flex items-center gap-3 px-4 py-2.5 border-t border-line-2 hover:bg-surface-2 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-inset"
                  >
                    <div className="w-7 h-7 rounded-lg bg-surface-2 border border-line flex items-center justify-center shrink-0">
                      <Calendar className="w-3.5 h-3.5 text-ink3" />
                    </div>
                    <span className="text-[13px] font-medium text-ink flex-1 min-w-0 truncate">
                      {pm.name}
                    </span>
                    <span className="text-[11.5px] text-ink3 truncate max-w-[120px]">
                      {pm.assets?.name ?? '—'}
                    </span>
                    <Pill tone={isOverdue ? 'alert' : 'caution'} size="sm">
                      {isOverdue ? 'Overdue' : format(dueDate, 'MMM d')}
                    </Pill>
                  </Link>
                )
              })}
              {pmDueSoon.length > 5 && (
                <div className="px-4 py-2.5 border-t border-line-2">
                  <Link href="/engineering/pm-schedules" className="text-[11px] text-ink3 hover:text-ink transition-colors">
                    +{pmDueSoon.length - 5} more
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* AI failure predictions */}
      <div className="bg-surface border border-[var(--alert-line)] rounded-[var(--r-lg)] overflow-hidden shadow-card transition-shadow duration-base ease-standard">
        <div className="px-4 pt-3.5">
          <SectionLabel
            hint={`${highRiskAssets.length} flagged`}
            action={
              <Link
                href="/engineering/predictions"
                className="text-[11px] font-medium text-ink3 hover:text-ink transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] rounded-sm"
              >
                All predictions
              </Link>
            }
          >
            High-risk assets
          </SectionLabel>
        </div>
        {predictionsError ? (
          <div className="px-4 pb-3">
            <StateBlock status="error" error={{ message: t('common.error'), onRetry: () => refetchPredictions() }} />
          </div>
        ) : highRiskAssets.length === 0 ? (
          <StateBlock status="empty" empty={{ icon: <Zap className="w-5 h-5" />, title: t('dashboard.empty.chiefNoAssets') }} />
        ) : (
          <div className="px-4 pb-3">
            <div className="bg-[var(--ai-soft)] border border-[var(--ai-line)] rounded-[var(--r-md)] p-3.5 mb-3">
              <AILabel />
              <p className="font-display italic text-[13px] leading-[1.4] text-ink mt-1.5">
                {highRiskAssets.length} {highRiskAssets.length === 1 ? 'asset has' : 'assets have'} elevated failure risk.
                Preventive action now can avoid unplanned downtime.
              </p>
            </div>
            <div className="space-y-1">
              {highRiskAssets.slice(0, 4).map(p => (
                <Link
                  key={p.id}
                  href="/engineering/predictions"
                  className="flex items-center gap-3 py-2 hover:bg-surface-2 -mx-1 px-1 rounded-lg transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                >
                  <div className="w-7 h-7 rounded-lg bg-[var(--alert-soft)] border border-[var(--alert-line)] flex items-center justify-center shrink-0">
                    <Zap className="w-3.5 h-3.5 text-[var(--alert)]" />
                  </div>
                  <span className="text-[13px] font-medium text-ink flex-1 min-w-0 truncate">
                    {p.assets?.name ?? 'Unknown Asset'}
                  </span>
                  <span className="text-[11.5px] text-ink3 truncate max-w-[100px]">
                    {p.assets?.asset_categories?.name}
                  </span>
                  <Pill tone="alert" size="sm">{p.risk_score}% risk</Pill>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* SLA callout */}
      {maintError ? (
        <div className="bg-surface border border-line rounded-[var(--r-lg)] shadow-card">
          <StateBlock status="error" error={{ message: t('common.error'), onRetry: () => refetchMaint() }} />
        </div>
      ) : maint && (
        <div className="bg-surface border border-line rounded-[var(--r-lg)] px-4 py-3.5 shadow-card flex items-center justify-between transition-shadow duration-base ease-standard">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3">SLA Compliance</p>
            <p className="font-display text-[28px] leading-none text-ink mt-1">
              {Math.round(maint.sla_compliance_pct)}%
            </p>
          </div>
          <p className="text-[11.5px] text-ink3">Last 30 days</p>
        </div>
      )}
    </div>
  )
}
