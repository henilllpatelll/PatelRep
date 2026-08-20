'use client'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StatusDot, SectionLabel, Mono, AILabel } from '@/components/ui/primitives'
import { StateBlock } from '@/components/ui/StateBlock'
import { cn } from '@/lib/utils'
import type { PaceProjection } from '@/lib/hooks/useArrivalReadiness'

const DIAL_RADIUS = 78
const DIAL_CIRCUMFERENCE = 2 * Math.PI * DIAL_RADIUS

interface ArrivalReadinessHeroProps {
  arrivalsCount: number
  readyForArrivals: number
  awaitingInspection: number
  beingCleaned: number
  notStarted: number
  departureRoomsInPlay: number
  blockedCount: number
  paceProjection: PaceProjection | null
  isLoading: boolean
  isError: boolean
  onRetry: () => void
}

function useThreePmCountdown() {
  const [label, setLabel] = useState<{ text: string; passed: boolean } | null>(null)

  useEffect(() => {
    const compute = () => {
      const now = new Date()
      const target = new Date(now)
      target.setHours(15, 0, 0, 0)
      const diffMs = target.getTime() - now.getTime()
      if (diffMs <= 0) {
        setLabel({ text: '3:00 PM passed', passed: true })
        return
      }
      const h = Math.floor(diffMs / 3_600_000)
      const m = Math.floor((diffMs % 3_600_000) / 60_000)
      setLabel({ text: `${h}h ${m}m to 3:00 PM`, passed: false })
    }
    compute()
    const interval = setInterval(compute, 60_000)
    return () => clearInterval(interval)
  }, [])

  return label
}

export function ArrivalReadinessHero({
  arrivalsCount,
  readyForArrivals,
  awaitingInspection,
  beingCleaned,
  notStarted,
  departureRoomsInPlay,
  blockedCount,
  paceProjection,
  isLoading,
  isError,
  onRetry,
}: ArrivalReadinessHeroProps) {
  const { t } = useTranslation()
  const countdown = useThreePmCountdown()
  const pct = arrivalsCount > 0 ? (readyForArrivals / arrivalsCount) * 100 : 0

  const tiles = [
    { key: 'inspected', tone: 'ready' as const, label: t('dashboard.gm.tileInspected'), value: readyForArrivals },
    { key: 'awaiting', tone: 'info' as const, label: t('dashboard.gm.tileAwaitingInspection'), value: awaitingInspection },
    { key: 'cleaning', tone: 'progress' as const, label: t('dashboard.gm.tileBeingCleaned'), value: beingCleaned },
    { key: 'notStarted', tone: 'alert' as const, label: t('dashboard.gm.tileNotStarted'), value: notStarted },
  ]

  if (isLoading) {
    return (
      <div className="bg-surface border border-line rounded-[var(--r-xl)] shadow-[var(--shadow-md)] p-6 flex flex-col md:flex-row gap-8 md:items-stretch">
        <div className="w-[184px] h-[184px] rounded-full bg-surface-3 animate-pulse shrink-0 mx-auto md:mx-0" />
        <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-3.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-[var(--r-md)] bg-surface-3 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="bg-surface border border-line rounded-[var(--r-xl)] shadow-[var(--shadow-md)]">
        <StateBlock status="error" error={{ message: t('common.error'), onRetry }} />
      </div>
    )
  }

  return (
    <div className="bg-surface border border-line rounded-[var(--r-xl)] shadow-[var(--shadow-md)] p-6 flex flex-col md:flex-row gap-8 md:items-stretch">
      <div className="relative w-[184px] h-[184px] shrink-0 mx-auto md:mx-0">
        <svg width="184" height="184" viewBox="0 0 184 184" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="92" cy="92" r={DIAL_RADIUS} fill="none" stroke="var(--surface-3)" strokeWidth="16" />
          <circle
            cx="92"
            cy="92"
            r={DIAL_RADIUS}
            fill="none"
            stroke="var(--ready)"
            strokeWidth="16"
            strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * DIAL_CIRCUMFERENCE} ${DIAL_CIRCUMFERENCE}`}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
          <span className="font-display text-[52px] leading-none text-ink">{readyForArrivals}</span>
          <span className="text-[12px] text-ink3">{t('dashboard.gm.ofArrivals', { count: arrivalsCount })}</span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ready)] mt-0.5">
            {t('dashboard.gm.readyNow')}
          </span>
        </div>
      </div>

      <div className="flex-1 flex flex-col gap-4 min-w-0">
        <div className="flex items-baseline justify-between">
          <SectionLabel className="mb-0">{t('dashboard.gm.readyForArrivals')}</SectionLabel>
          {countdown && (
            <Mono className={cn('text-[12px]', countdown.passed ? 'text-ink4' : 'text-ink3')}>{countdown.text}</Mono>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
          {tiles.map((tile) => (
            <div key={tile.key} className="bg-surface-2 border border-line-2 rounded-[var(--r-md)] px-3.5 py-3 flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <StatusDot tone={tile.tone} size={7} />
                <span className="text-[11px] font-medium text-ink3">{tile.label}</span>
              </div>
              <span className="font-display text-[30px] leading-none text-ink">{tile.value}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex h-3 rounded-[6px] overflow-hidden bg-surface-3">
            {arrivalsCount > 0 && (
              <>
                <div style={{ width: `${(readyForArrivals / arrivalsCount) * 100}%`, background: 'var(--ready)' }} />
                <div style={{ width: `${(awaitingInspection / arrivalsCount) * 100}%`, background: 'var(--info)' }} />
                <div style={{ width: `${(beingCleaned / arrivalsCount) * 100}%`, background: 'var(--progress)' }} />
                <div style={{ width: `${(notStarted / arrivalsCount) * 100}%`, background: 'var(--alert)' }} />
              </>
            )}
          </div>
          <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 font-mono text-[11px] text-ink4">
            <span>{t('dashboard.gm.departureRoomsInPlay', { count: departureRoomsInPlay })}</span>
            <span>{t('dashboard.gm.blockedSeeBelow', { count: blockedCount })}</span>
          </div>
        </div>

        {paceProjection && (
          <div className="mt-auto border border-[var(--ai-line)] bg-[var(--ai-soft)] rounded-[var(--r-md)] px-3.5 py-3 flex items-center gap-3">
            <AILabel className="bg-white shrink-0" />
            <p className="font-display italic text-[16px] leading-[1.35] text-ink flex-1 m-0">
              {t('dashboard.gm.pacePrediction', {
                arrivalsCount,
                readyByTime: paceProjection.readyByTime,
                floor: paceProjection.worstFloor,
                minutes: paceProjection.worstFloorDelayMinutes,
                vipCount: paceProjection.worstFloorVipCount,
              })}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
