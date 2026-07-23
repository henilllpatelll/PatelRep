'use client'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { RoomPrediction } from '@/lib/api/housekeeping'
import { Card } from '@/components/ui/Card'
import { AILabel, Mono, Pill } from '@/components/ui/primitives'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatETA(predictedReadyAt: string | null, t: TFunction): string {
  if (!predictedReadyAt) return t('housekeeping.predictionPanel.unknown')
  const dt = new Date(predictedReadyAt)
  const now = new Date()
  const diffMin = Math.round((dt.getTime() - now.getTime()) / 60000)
  if (diffMin < 0) return t('housekeeping.predictionPanel.overdue')
  if (diffMin < 60) return t('housekeeping.predictionPanel.readyIn', { minutes: diffMin })
  return t('housekeeping.predictionPanel.readyBy', {
    time: dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
  })
}

function getRiskFactorLabels(t: TFunction): Record<string, string> {
  return {
    vip_room: t('housekeeping.predictionPanel.riskFactors.vipRoom'),
    will_be_late: t('housekeeping.predictionPanel.riskFactors.willBeLate'),
    tight_timeline: t('housekeeping.predictionPanel.riskFactors.tightTimeline'),
    overloaded_housekeeper: t('housekeeping.predictionPanel.riskFactors.overloadedHousekeeper'),
    no_housekeeper_assigned: t('housekeeping.predictionPanel.riskFactors.unassigned'),
  }
}

function prettifyRiskFactor(factor: string, t: TFunction): string {
  const labels = getRiskFactorLabels(t)
  return labels[factor] ?? factor.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// ── Skeleton row ──────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b border-line last:border-0 animate-pulse">
      <div className="w-2.5 h-2.5 rounded-full bg-surface-3 mt-1 flex-shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="flex items-center gap-2">
          <div className="h-4 w-20 bg-surface-3 rounded" />
          <div className="h-4 w-12 bg-surface-3 rounded-full" />
          <div className="h-4 w-28 bg-surface-3 rounded ml-auto" />
        </div>
        <div className="flex gap-1.5">
          <div className="h-3.5 w-16 bg-surface-2 rounded-full" />
          <div className="h-3.5 w-20 bg-surface-2 rounded-full" />
        </div>
      </div>
    </div>
  )
}

// ── Prediction row ────────────────────────────────────────────────────────────

function PredictionRow({ prediction }: { prediction: RoomPrediction }) {
  const { t } = useTranslation()
  const roomLabel = prediction.room_number
    ? `${prediction.room_number}`
    : prediction.room_id.slice(0, 8)

  const riskTone =
    prediction.risk_level === 'HIGH' ? 'alert' :
    prediction.risk_level === 'MEDIUM' ? 'caution' :
    'pickup'

  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b border-line last:border-0 hover:bg-surface-2 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Mono className="text-[13px] font-semibold text-ink">{t('housekeeping.predictionPanel.room')} {roomLabel}</Mono>
          <Pill tone={riskTone} size="sm">
            {prediction.risk_level ?? 'LOW'}
          </Pill>
          <span className="ml-auto text-[11px] font-mono text-ink-3 whitespace-nowrap">
            {formatETA(prediction.predicted_ready_at, t)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
          {prediction.risk_factors.map((factor) => (
            <span
              key={factor}
              className="px-1.5 py-px rounded-full text-[10.5px] bg-surface-3 text-ink-2 border border-line"
            >
              {prettifyRiskFactor(factor, t)}
            </span>
          ))}
          {prediction.confidence_score !== null && (
            <span className="text-[11px] font-mono text-[var(--ai)] ml-auto whitespace-nowrap font-semibold">
              {Math.round(prediction.confidence_score * 100)}%
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface PredictionPanelProps {
  predictions: RoomPrediction[]
  isLoading: boolean
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function PredictionPanel({ predictions, isLoading }: PredictionPanelProps) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)

  const atRiskRooms = predictions
    .filter((p) => p.risk_level === 'HIGH' || p.risk_level === 'MEDIUM')
    .sort((a, b) => {
      if (a.risk_level === b.risk_level) return 0
      return a.risk_level === 'HIGH' ? -1 : 1
    })

  const highCount = atRiskRooms.filter((p) => p.risk_level === 'HIGH').length
  const mediumCount = atRiskRooms.filter((p) => p.risk_level === 'MEDIUM').length

  return (
    <Card className="overflow-hidden p-0">
      {/* ── Header ── */}
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3.5 cursor-pointer text-left hover:bg-[var(--ai-soft)] transition-colors bg-[var(--ai-soft)] border-b border-[var(--ai-line)]"
        aria-expanded={isExpanded}
      >
        <div className="flex items-center gap-3">
          <AILabel>{t('housekeeping.predictionPanel.predictions')}</AILabel>
          <div className="flex items-center gap-1.5">
            {highCount > 0 && (
              <Pill tone="alert" size="sm">{t('housekeeping.predictionPanel.highCount', { count: highCount })}</Pill>
            )}
            {mediumCount > 0 && (
              <Pill tone="caution" size="sm">{t('housekeeping.predictionPanel.mediumCount', { count: mediumCount })}</Pill>
            )}
            {highCount === 0 && mediumCount === 0 && !isLoading && (
              <span className="text-[11px] font-mono text-[var(--ai)] opacity-70">{t('housekeeping.predictionPanel.allClear')}</span>
            )}
          </div>
        </div>

        <svg
          className={`w-4 h-4 text-[var(--ai)] transition-transform duration-200 flex-shrink-0 ${
            isExpanded ? 'rotate-180' : ''
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* ── Body ── */}
      {isExpanded && (
        <div>
          {isLoading ? (
            <>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </>
          ) : atRiskRooms.length === 0 ? (
            <div className="px-4 py-6 text-center space-y-2">
              <div className="flex justify-center">
                <AILabel>{t('housekeeping.predictionPanel.predictions')}</AILabel>
              </div>
              <p className="font-display italic text-[14px] text-ink-3 leading-relaxed">
                {t('housekeeping.predictionPanel.noRisks')}
              </p>
            </div>
          ) : (
            atRiskRooms.map((prediction) => (
              <PredictionRow key={prediction.room_id} prediction={prediction} />
            ))
          )}
        </div>
      )}
    </Card>
  )
}
