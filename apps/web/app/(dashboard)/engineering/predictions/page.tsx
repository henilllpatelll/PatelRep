'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  CheckCircle,
  Loader2,
  Plus,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
} from 'lucide-react'
import { engineeringApi, FailurePrediction } from '@/lib/api/engineering'
import { aiApi } from '@/lib/api/ai'
import { useRole } from '@/lib/hooks/useRole'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/shared/PageHeader'

// ─── Types ────────────────────────────────────────────────────────────────────

type RiskFilter = 'all' | 'high' | 'medium' | 'low'
type StatusFilter = 'all' | 'active' | 'acknowledged'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRiskLabel(score: number, t: TFunction): string {
  if (score >= 70) return t('engineering.failurePrediction.riskHigh')
  if (score >= 40) return t('engineering.failurePrediction.riskMedium')
  return t('engineering.failurePrediction.riskLow')
}

function getRiskBadgeCls(score: number): string {
  if (score >= 70) return 'bg-red-100 text-red-700'
  if (score >= 40) return 'bg-orange-100 text-orange-700'
  return 'bg-green-100 text-green-700'
}

function getRiskRingColor(score: number): string {
  if (score >= 70) return 'text-[var(--alert)]'
  if (score >= 40) return 'text-orange-400'
  return 'text-green-500'
}

function getBorderColor(score: number): string {
  if (score >= 70) return 'border-l-red-500'
  if (score >= 40) return 'border-l-orange-400'
  return 'border-l-green-400'
}

function getAvgScoreColor(score: number): string {
  if (score >= 70) return 'text-[var(--alert)]'
  if (score >= 40) return 'text-orange-500'
  return 'text-[var(--ready)]'
}

// ─── Skeleton card ────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-[var(--r-lg)] border border-line bg-surface border-l-4 border-l-stone-200 p-5">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-full bg-surface-3 shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-surface-3 rounded w-1/3" />
          <div className="h-3 bg-surface-3 rounded w-1/4" />
          <div className="h-3 bg-surface-3 rounded w-2/3 mt-3" />
          <div className="h-3 bg-surface-3 rounded w-1/2" />
        </div>
      </div>
    </div>
  )
}

// ─── Risk ring (48×48) ────────────────────────────────────────────────────────

function RiskRing({ score }: { score: number }) {
  const { t } = useTranslation()
  const ringColor = getRiskRingColor(score)
  // circumference = 2π×20 ≈ 125.66; dash for 48×48 viewBox with r=20
  const circumference = 125.66
  return (
    <div className="relative shrink-0 w-12 h-12">
      <svg className="w-12 h-12 -rotate-90" viewBox="0 0 48 48" aria-label={t('engineering.predictionsPage.riskAriaLabel', { score })}>
        <circle
          cx="24"
          cy="24"
          r="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          className="text-gray-200"
        />
        <circle
          cx="24"
          cy="24"
          r="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeDasharray={`${(score / 100) * circumference} ${circumference}`}
          strokeLinecap="round"
          className={ringColor}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-gray-700">
        {score}
      </span>
    </div>
  )
}

// ─── Prediction card ──────────────────────────────────────────────────────────

interface PredictionCardProps {
  prediction: FailurePrediction
  canManage: boolean
  expandedId: string | null
  onToggleExpand: (id: string) => void
  onAcknowledge: (id: string) => void
  isAcknowledging: boolean
  onCreateWO: (id: string) => void
  isCreatingWO: boolean
  canAuthorize: boolean
  onAuthorize: (id: string) => void
  isAuthorizing: boolean
}

function PredictionCard({
  prediction,
  canManage,
  expandedId,
  onToggleExpand,
  onAcknowledge,
  isAcknowledging,
  onCreateWO,
  isCreatingWO,
  canAuthorize,
  onAuthorize,
  isAuthorizing,
}: PredictionCardProps) {
  const { t } = useTranslation()
  const score = prediction.risk_score
  const borderColor = getBorderColor(score)
  const badgeCls = getRiskBadgeCls(score)
  const riskLabel = getRiskLabel(score, t)
  const assetName = prediction.assets?.name ?? t('engineering.failurePrediction.unknownAsset')
  const categoryName = prediction.assets?.asset_categories?.name
  const indicators = prediction.failure_indicators ?? []
  const isExpanded = expandedId === prediction.id

  const reasoning = prediction.ai_reasoning ?? ''
  const reasoningPreview = reasoning.slice(0, 100)
  const hasMoreReasoning = reasoning.length > 100

  const repairCost = prediction.estimated_repair_cost
  const replaceCost = prediction.estimated_replace_cost

  const generatedAt = prediction.generated_at
    ? format(new Date(prediction.generated_at), 'MMM d, yyyy')
    : null

  const acknowledgedAt = prediction.acknowledged_at
    ? format(new Date(prediction.acknowledged_at), 'MMM d, yyyy')
    : null

  return (
    <Card
      className={`border-l-4 ${borderColor} p-5 ${prediction.is_acknowledged ? 'opacity-75' : ''}${score >= 70 ? ' border-red-200 bg-[var(--alert-soft)]' : ''}`}
    >
      {/* Top row */}
      <div className="flex items-start gap-4">
        <RiskRing score={score} />

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-base font-semibold text-gray-900 leading-tight truncate">
                {assetName}
              </p>
              {categoryName && (
                <p className="text-sm text-gray-500 mt-0.5">{categoryName}</p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span
                className={`text-xs font-bold px-2 py-0.5 rounded ${badgeCls}`}
              >
                {riskLabel}
              </span>
              {prediction.is_acknowledged && (
                <span className="text-xs font-medium text-[var(--ready)] flex items-center gap-1">
                  <CheckCircle size={12} />
                  {t('engineering.failurePrediction.acknowledged')}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="mt-3 space-y-2 ml-16">
        {/* Failure window */}
        {prediction.predicted_failure_window && (
          <p className="text-sm text-gray-600">
            <span className="font-medium">{t('engineering.failurePrediction.failureWindowLabel')}</span>{' '}
            {prediction.predicted_failure_window}
          </p>
        )}

        {/* Recommendation */}
        <p className="text-sm text-gray-700">{prediction.recommendation}</p>

        {/* Risk indicators */}
        {indicators.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {indicators.map((indicator, idx) => (
              <span
                key={idx}
                className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-surface/80 border border-gray-200 text-gray-600"
              >
                {indicator}
              </span>
            ))}
          </div>
        )}

        {/* AI Reasoning (expandable) */}
        {reasoning && (
          <div className="pt-1">
            <p className="text-sm text-gray-600">
              <span className="font-medium">{t('engineering.predictionsPage.aiReasoningLabel')}</span>
              {isExpanded ? reasoning : reasoningPreview}
              {!isExpanded && hasMoreReasoning && '…'}
            </p>
            {hasMoreReasoning && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onToggleExpand(prediction.id)}
                className="mt-1 gap-1 px-0 h-auto min-h-0 text-xs text-[var(--caution)] hover:text-amber-800"
              >
                {isExpanded ? (
                  <>
                    <ChevronUp size={13} /> {t('engineering.predictionsPage.showLess')}
                  </>
                ) : (
                  <>
                    <ChevronDown size={13} /> {t('engineering.predictionsPage.showMore')}
                  </>
                )}
              </Button>
            )}
          </div>
        )}

        {/* Costs */}
        {(repairCost != null || replaceCost != null) && (
          <p className="text-sm text-gray-600">
            <span className="font-medium">{t('engineering.predictionsPage.costsLabel')}</span>
            {repairCost != null && (
              <span>
                {t('engineering.predictionsPage.repairCost', { cost: repairCost.toLocaleString() })}
              </span>
            )}
            {repairCost != null && replaceCost != null && (
              <span className="mx-1 text-gray-400">|</span>
            )}
            {replaceCost != null && (
              <span>
                {t('engineering.predictionsPage.replaceCost', { cost: replaceCost.toLocaleString() })}
              </span>
            )}
          </p>
        )}

        {/* Generated at */}
        {generatedAt && (
          <p className="text-xs text-gray-400">{t('engineering.predictionsPage.generatedLabel', { date: generatedAt })}</p>
        )}

        {/* Actions */}
        {canManage && !prediction.is_acknowledged && (
          <div className="flex items-center gap-3 pt-1">
            {canAuthorize && (
              <Button variant="secondary" onClick={() => onAuthorize(prediction.id)} disabled={isAuthorizing} className="text-xs px-3 py-1.5">
                {isAuthorizing ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />}
                {t('engineering.predictionsPage.authorizeAiAction')}
              </Button>
            )}
            <Button
              variant="primary"
              onClick={() => onCreateWO(prediction.id)}
              disabled={isCreatingWO}
              className="text-xs px-3 py-1.5"
            >
              {isCreatingWO ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Plus size={12} />
              )}
              {t('engineering.predictionsPage.createWorkOrder')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => onAcknowledge(prediction.id)}
              disabled={isAcknowledging}
              className="text-xs px-3 py-1.5 border-green-200 text-green-700 bg-[var(--ready-soft)] hover:bg-green-100"
            >
              {isAcknowledging ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <CheckCircle size={12} />
              )}
              {t('engineering.failurePrediction.acknowledge')}
            </Button>
          </div>
        )}

        {prediction.is_acknowledged && acknowledgedAt && (
          <p className="flex items-center gap-1.5 text-xs text-[var(--ready)] font-medium pt-1">
            <CheckCircle size={12} />
            {t('engineering.predictionsPage.acknowledgedDate', { date: acknowledgedAt })}
          </p>
        )}
      </div>
    </Card>
  )
}

// ─── Stat card ────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string
  value: string | number
  accent?: string
}

function StatCard({ label, value, accent = 'text-gray-900' }: StatCardProps) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${accent}`}>{value}</p>
    </Card>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PredictionsPage() {
  const { t } = useTranslation()
  const { isGM, role } = useRole()
  const canManage = isGM || role === 'engineer'
  const canAuthorize = isGM || role === 'chief_engineer'
  const queryClient = useQueryClient()

  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // ── Queries & mutations ────────────────────────────────────────────────────

  const { data: predictions, isLoading } = useQuery({
    queryKey: ['failure-predictions-history'],
    queryFn: () => engineeringApi.getFailurePredictionHistory(),
    select: (res) => res.data as FailurePrediction[],
  })

  const acknowledgeMutation = useMutation({
    mutationFn: (id: string) => engineeringApi.acknowledgeFailurePrediction(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['failure-predictions-history'] })
      queryClient.invalidateQueries({ queryKey: ['failure-predictions'] })
    },
  })

  const createWOMutation = useMutation({
    mutationFn: (id: string) => engineeringApi.createWorkOrderFromPrediction(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-orders'] })
      showSuccess(t('engineering.predictionsPage.workOrderCreated'))
    },
  })

  const authorizeRecommendationMutation = useMutation({
    mutationFn: async (predictionId: string) => {
      const recommendation = await aiApi.createFailurePredictionRecommendation(predictionId)
      return aiApi.authorizeRecommendation(recommendation.data.id)
    },
    onSuccess: () => showSuccess(t('engineering.predictionsPage.aiActionAuthorized')),
  })

  function showSuccess(msg: string) {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(null), 4000)
  }

  function handleToggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  // ── Filtering ──────────────────────────────────────────────────────────────

  const allPredictions = predictions ?? []

  const filtered = allPredictions.filter((p) => {
    const score = p.risk_score
    if (riskFilter === 'high' && score < 70) return false
    if (riskFilter === 'medium' && (score < 40 || score >= 70)) return false
    if (riskFilter === 'low' && score >= 40) return false
    if (statusFilter === 'active' && p.is_acknowledged) return false
    if (statusFilter === 'acknowledged' && !p.is_acknowledged) return false
    return true
  })

  // ── Stats ──────────────────────────────────────────────────────────────────

  const activeCount = allPredictions.filter((p) => !p.is_acknowledged).length
  const highRiskCount = allPredictions.filter(
    (p) => !p.is_acknowledged && p.risk_score >= 70
  ).length
  const acknowledgedCount = allPredictions.filter((p) => p.is_acknowledged).length
  const avgScore = allPredictions.length
    ? Math.round(
        allPredictions.reduce((s, p) => s + p.risk_score, 0) / allPredictions.length
      )
    : 0

  const filtersActive = riskFilter !== 'all' || statusFilter !== 'all'

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-5xl">
      <PageHeader
        eyebrow="Engineering"
        title={t('engineering.predictionsPage.heading')}
        subtitle={t('engineering.predictionsPage.subtitle')}
        actions={canManage && (
          <p className="text-xs text-gray-400 text-right leading-tight shrink-0">
            {t('engineering.predictionsPage.freshAnalysisHint')}
            <br />
            {t('engineering.predictionsPage.freshAnalysisHint2')}
          </p>
        )}
      />

      {/* Success banner */}
      {successMsg && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-[var(--ready-soft)] border border-green-200 text-green-700 text-sm">
          <CheckCircle size={15} />
          {successMsg}
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label={t('engineering.predictionsPage.statActiveAlerts')}
          value={activeCount}
          accent={activeCount > 0 ? 'text-[var(--alert)]' : 'text-gray-900'}
        />
        <StatCard
          label={t('engineering.predictionsPage.statHighRisk')}
          value={highRiskCount}
          accent={highRiskCount > 0 ? 'text-[var(--alert)]' : 'text-gray-900'}
        />
        <StatCard
          label={t('engineering.failurePrediction.acknowledged')}
          value={acknowledgedCount}
          accent={acknowledgedCount > 0 ? 'text-[var(--ready)]' : 'text-gray-500'}
        />
        <StatCard
          label={t('engineering.predictionsPage.statAvgRiskScore')}
          value={avgScore || '—'}
          accent={getAvgScoreColor(avgScore)}
        />
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Risk filter */}
        <div className="flex items-center gap-1 bg-surface/70 backdrop-blur-sm border border-[var(--caution-line)]/40 rounded-lg p-1">
          {(
            [
              { key: 'all', label: t('engineering.predictionsPage.riskFilterAll') },
              { key: 'high', label: t('engineering.predictionsPage.riskFilterHigh') },
              { key: 'medium', label: t('engineering.predictionsPage.riskFilterMedium') },
              { key: 'low', label: t('engineering.predictionsPage.riskFilterLow') },
            ] as { key: RiskFilter; label: string }[]
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setRiskFilter(key)}
              aria-pressed={riskFilter === key}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                riskFilter === key
                  ? 'bg-[var(--caution)] text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <div className="flex items-center gap-1 bg-surface/70 backdrop-blur-sm border border-[var(--caution-line)]/40 rounded-lg p-1">
          {(
            [
              { key: 'all', label: t('engineering.predictionsPage.statusFilterAll') },
              { key: 'active', label: t('engineering.predictionsPage.statusFilterActive') },
              { key: 'acknowledged', label: t('engineering.failurePrediction.acknowledged') },
            ] as { key: StatusFilter; label: string }[]
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              aria-pressed={statusFilter === key}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                statusFilter === key
                  ? 'bg-[var(--caution)] text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {filtersActive && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setRiskFilter('all')
              setStatusFilter('all')
            }}
            className="text-[var(--caution)] hover:text-amber-800"
          >
            {t('engineering.predictionsPage.clearFilters')}
          </Button>
        )}
      </div>

      {/* Predictions list */}
      {isLoading ? (
        <div className="space-y-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-14 text-center">
          <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mb-3">
            <ShieldCheck size={24} className="text-[var(--ready)]" />
          </div>
          <p className="text-base font-semibold text-gray-800">{t('engineering.predictionsPage.emptyHeading')}</p>
          {filtersActive ? (
            <p className="text-sm text-gray-500 mt-1 max-w-xs">
              {t('engineering.predictionsPage.emptyFilteredText')}{' '}
              <button
                onClick={() => {
                  setRiskFilter('all')
                  setStatusFilter('all')
                }}
                className="text-[var(--caution)] hover:underline font-medium"
              >
                {t('engineering.predictionsPage.clearFilters')}
              </button>{' '}
              {t('engineering.predictionsPage.emptyFilteredSuffix')}
            </p>
          ) : (
            <>
              <p className="text-sm text-gray-500 mt-1 max-w-xs">
                {t('engineering.predictionsPage.emptyHelp')}
              </p>
              <a
                href="/engineering/assets"
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--caution)] hover:text-[var(--caution)] hover:underline transition-colors"
              >
                {t('engineering.predictionsPage.goToAssetRegister')}
              </a>
            </>
          )}
          {!filtersActive && (
            <div className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-3 text-left sm:grid-cols-3">
              {[
                t('engineering.predictionsPage.emptySampleFilter'),
                t('engineering.predictionsPage.emptySampleNoisy'),
                t('engineering.predictionsPage.emptySampleRepeat'),
              ].map((item) => (
                <div key={item} className="rounded-xl border border-amber-100 bg-[var(--caution-soft)]/50 px-4 py-3">
                  <p className="text-sm font-semibold text-ink">{item}</p>
                  <p className="mt-1 text-xs text-ink3">{t('engineering.predictionsPage.emptySampleSub')}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((prediction) => (
            <PredictionCard
              key={prediction.id}
              prediction={prediction}
              canManage={canManage}
              expandedId={expandedId}
              onToggleExpand={handleToggleExpand}
              onAcknowledge={(id) => acknowledgeMutation.mutate(id)}
              isAcknowledging={
                acknowledgeMutation.isPending &&
                acknowledgeMutation.variables === prediction.id
              }
              onCreateWO={(id) => createWOMutation.mutate(id)}
              isCreatingWO={
                createWOMutation.isPending &&
                createWOMutation.variables === prediction.id
              }
              canAuthorize={canAuthorize}
              onAuthorize={(id) => authorizeRecommendationMutation.mutate(id)}
              isAuthorizing={
                authorizeRecommendationMutation.isPending &&
                authorizeRecommendationMutation.variables === prediction.id
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}
