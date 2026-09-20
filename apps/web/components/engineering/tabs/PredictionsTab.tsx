'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { format } from 'date-fns'
import { useTranslation } from 'react-i18next'
import {
  CheckCircle,
  Loader2,
  Plus,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  XCircle,
  HelpCircle,
} from 'lucide-react'
import { engineeringApi, type FailurePrediction, type BatchAcknowledgePredictionResult } from '@/lib/api/engineering'
import { aiApi } from '@/lib/api/ai'
import { getRiskBadge, getRiskColorClass, getRiskBorderClass } from '@/lib/utils/engineering'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { StateBlock } from '@/components/ui/StateBlock'
import { Pill, Stat } from '@/components/ui/primitives'

function getAvgScoreColorClass(score: number): string {
  if (score >= 70) return 'text-[var(--alert)]'
  if (score >= 40) return 'text-[var(--caution)]'
  return 'text-[var(--ready)]'
}

type RiskFilter = 'all' | 'high' | 'medium' | 'low'
type StatusFilter = 'all' | 'active' | 'acknowledged'

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

function RiskRing({ score }: { score: number }) {
  const { t } = useTranslation()
  const ringColorClass = getRiskColorClass(score)
  const circumference = 125.66
  return (
    <div className="relative shrink-0 w-12 h-12">
      <svg className="w-12 h-12 -rotate-90" viewBox="0 0 48 48" aria-label={t('engineering.predictionsPage.riskAriaLabel', { score })}>
        <circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" strokeWidth="4" className="text-surface-3" />
        <circle
          cx="24"
          cy="24"
          r="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeDasharray={`${(score / 100) * circumference} ${circumference}`}
          strokeLinecap="round"
          className={ringColorClass}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-ink2">
        {score}
      </span>
    </div>
  )
}

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
  cardRef?: (el: HTMLDivElement | null) => void
  isHighlighted?: boolean
  isSelected: boolean
  onToggleSelect: (id: string) => void
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
  cardRef,
  isHighlighted,
  isSelected,
  onToggleSelect,
}: PredictionCardProps) {
  const { t } = useTranslation()
  const score = prediction.risk_score
  const borderColor = getRiskBorderClass(score)
  const risk = getRiskBadge(score, t)
  const assetName = prediction.assets?.name ?? t('engineering.failurePrediction.unknownAsset')
  const categoryName = prediction.assets?.asset_categories?.name
  const indicators = prediction.failure_indicators ?? []
  const isExpanded = expandedId === prediction.id

  const reasoning = prediction.ai_reasoning ?? ''
  const reasoningPreview = reasoning.slice(0, 100)
  const hasMoreReasoning = reasoning.length > 100

  const repairCost = prediction.estimated_repair_cost
  const replaceCost = prediction.estimated_replace_cost

  const generatedAt = prediction.generated_at ? format(new Date(prediction.generated_at), 'MMM d, yyyy') : null
  const acknowledgedAt = prediction.acknowledged_at ? format(new Date(prediction.acknowledged_at), 'MMM d, yyyy') : null

  return (
    <div ref={cardRef}>
    <Card
      className={`border-l-4 ${borderColor} p-5 ${prediction.is_acknowledged ? 'opacity-75' : ''}${score >= 70 ? ' border-red-200 bg-[var(--alert-soft)]' : ''}${isHighlighted ? ' ring-2 ring-[var(--caution)] ring-offset-2' : ''}`}
    >
      <div className="flex items-start gap-4">
        {canManage && !prediction.is_acknowledged && (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect(prediction.id)}
            aria-label={assetName}
            className="mt-1.5 h-4 w-4 shrink-0 rounded border-line text-[var(--caution)] focus:ring-[var(--caution)]"
          />
        )}
        <RiskRing score={score} />

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-base font-semibold text-ink leading-tight truncate">{assetName}</p>
              {categoryName && <p className="text-sm text-ink3 mt-0.5">{categoryName}</p>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Pill tone={risk.tone} size="sm">{risk.label}</Pill>
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

      <div className="mt-3 space-y-2 ml-16">
        {prediction.predicted_failure_window && (
          <p className="text-sm text-ink2">
            <span className="font-medium">{t('engineering.failurePrediction.failureWindowLabel')}</span>{' '}
            {prediction.predicted_failure_window}
          </p>
        )}

        <p className="text-sm text-ink2">{prediction.recommendation}</p>

        {indicators.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {indicators.map((indicator, idx) => (
              <span key={idx} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-surface-2 border border-line-2 text-ink2">
                {indicator}
              </span>
            ))}
          </div>
        )}

        {reasoning && (
          <div className="pt-1">
            <p className="text-sm text-ink2">
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

        {(repairCost != null || replaceCost != null) && (
          <p className="text-sm text-ink2">
            <span className="font-medium">{t('engineering.predictionsPage.costsLabel')}</span>
            {repairCost != null && <span>{t('engineering.predictionsPage.repairCost', { cost: repairCost.toLocaleString() })}</span>}
            {repairCost != null && replaceCost != null && <span className="mx-1 text-ink3">|</span>}
            {replaceCost != null && <span>{t('engineering.predictionsPage.replaceCost', { cost: replaceCost.toLocaleString() })}</span>}
          </p>
        )}

        {generatedAt && <p className="text-xs text-ink3">{t('engineering.predictionsPage.generatedLabel', { date: generatedAt })}</p>}

        {canManage && !prediction.is_acknowledged && (
          <div className="flex items-center gap-3 pt-1">
            {canAuthorize && (
              <Button variant="secondary" onClick={() => onAuthorize(prediction.id)} disabled={isAuthorizing} className="text-xs px-3 py-1.5">
                {isAuthorizing ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />}
                {t('engineering.predictionsPage.authorizeAiAction')}
              </Button>
            )}
            <Button variant="primary" onClick={() => onCreateWO(prediction.id)} disabled={isCreatingWO} className="text-xs px-3 py-1.5">
              {isCreatingWO ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              {t('engineering.predictionsPage.createWorkOrder')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => onAcknowledge(prediction.id)}
              disabled={isAcknowledging}
              className="text-xs px-3 py-1.5 border-green-200 text-[var(--ready)] bg-[var(--ready-soft)] hover:bg-green-100"
            >
              {isAcknowledging ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
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
    </div>
  )
}

interface PredictionsTabProps {
  canManage: boolean
  canAuthorize: boolean
  highlightAssetId: string | null
}

export function PredictionsTab({ canManage, canAuthorize, highlightAssetId }: PredictionsTabProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchConfirming, setBatchConfirming] = useState(false)
  const [batchResult, setBatchResult] = useState<{
    results: BatchAcknowledgePredictionResult[]
    succeeded: number
    failed: number
  } | null>(null)

  const { data: predictions, isLoading, isError, refetch } = useQuery({
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

  const batchAcknowledgeMutation = useMutation({
    mutationFn: (ids: string[]) => engineeringApi.batchAcknowledgeFailurePredictions(ids),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['failure-predictions-history'] })
      queryClient.invalidateQueries({ queryKey: ['failure-predictions'] })
      setBatchResult(res.data)
      setBatchConfirming(false)
      setSelected(new Set())
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

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      if (next.size === 0) setBatchConfirming(false)
      return next
    })
  }

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

  const actionableIds = canManage ? filtered.filter((p) => !p.is_acknowledged).map((p) => p.id) : []

  function handleSelectAll() {
    setSelected(new Set(actionableIds))
  }

  function handleDeselectAll() {
    setSelected(new Set())
    setBatchConfirming(false)
  }

  function handleBatchAcknowledgeConfirm() {
    batchAcknowledgeMutation.mutate([...selected])
  }

  // ── Deep link: scroll to and highlight a specific asset's prediction ───────

  useEffect(() => {
    if (!highlightAssetId || allPredictions.length === 0) return
    const target = allPredictions.find((p) => p.asset_id === highlightAssetId)
    if (!target) return // graceful not-found: deleted asset, cross-tenant id, or aged out of the history cap
    const isVisible = filtered.some((p) => p.id === target.id)
    if (!isVisible) {
      setRiskFilter('all')
      setStatusFilter('all')
    }
    setHighlightedId(target.id)
    const clearTimer = setTimeout(() => setHighlightedId(null), 3000)
    return () => clearTimeout(clearTimer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightAssetId, allPredictions])

  useEffect(() => {
    if (!highlightedId) return
    if (!filtered.some((p) => p.id === highlightedId)) return
    cardRefs.current[highlightedId]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [filtered, highlightedId])

  const activeCount = allPredictions.filter((p) => !p.is_acknowledged).length
  const highRiskCount = allPredictions.filter((p) => !p.is_acknowledged && p.risk_score >= 70).length
  const acknowledgedCount = allPredictions.filter((p) => p.is_acknowledged).length
  const avgScore = allPredictions.length
    ? Math.round(allPredictions.reduce((s, p) => s + p.risk_score, 0) / allPredictions.length)
    : 0

  const filtersActive = riskFilter !== 'all' || statusFilter !== 'all'

  return (
    <div className="space-y-5 max-w-5xl">
      {successMsg && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-[var(--ready-soft)] border border-green-200 text-[var(--ready)] text-sm">
          <CheckCircle size={15} />
          {successMsg}
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label={t('engineering.predictionsPage.statActiveAlerts')} value={<span className={activeCount > 0 ? 'text-[var(--alert)]' : undefined}>{activeCount}</span>} />
        <Stat label={t('engineering.predictionsPage.statHighRisk')} value={<span className={highRiskCount > 0 ? 'text-[var(--alert)]' : undefined}>{highRiskCount}</span>} />
        <Stat label={t('engineering.failurePrediction.acknowledged')} value={<span className={acknowledgedCount > 0 ? 'text-[var(--ready)]' : undefined}>{acknowledgedCount}</span>} />
        <Stat label={t('engineering.predictionsPage.statAvgRiskScore')} value={<span className={getAvgScoreColorClass(avgScore)}>{avgScore || '—'}</span>} />
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-4">
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
                riskFilter === key ? 'bg-[var(--caution)] text-white shadow-sm' : 'text-ink3 hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

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
                statusFilter === key ? 'bg-[var(--caution)] text-white shadow-sm' : 'text-ink3 hover:text-ink'
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

      {/* Batch action bar */}
      {selected.size > 0 && (
        <Card className="p-4 border-[var(--caution-line)] bg-[var(--caution-soft)]/40">
          {!batchConfirming ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-medium text-ink">{t('engineering.predictionsPage.selectedCount', { count: selected.size })}</span>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={handleSelectAll}>{t('engineering.predictionsPage.selectAll')}</Button>
                <Button variant="ghost" size="sm" onClick={handleDeselectAll}>{t('engineering.predictionsPage.deselectAll')}</Button>
                <Button variant="primary" size="sm" onClick={() => setBatchConfirming(true)}>{t('engineering.predictionsPage.batchAcknowledge')}</Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-medium text-ink">
                {t('engineering.predictionsPage.confirmBatchAcknowledge', { count: selected.size })}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setBatchConfirming(false)} disabled={batchAcknowledgeMutation.isPending}>
                  {t('common.cancel')}
                </Button>
                <Button variant="primary" size="sm" onClick={handleBatchAcknowledgeConfirm} disabled={batchAcknowledgeMutation.isPending}>
                  {batchAcknowledgeMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                  {t('engineering.predictionsPage.batchAcknowledge')}
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Batch result summary */}
      {batchResult && (
        <Card className="p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-ink">
              {t('engineering.predictionsPage.batchResultSummary', { succeeded: batchResult.succeeded, failed: batchResult.failed })}
            </p>
            <Button variant="ghost" size="sm" onClick={() => setBatchResult(null)}>
              <XCircle size={14} />
            </Button>
          </div>
          <ul className="mt-2 space-y-1">
            {batchResult.results.map((r) => (
              <li key={r.prediction_id} className="flex items-center gap-1.5 text-xs text-ink2">
                {r.action === 'acknowledged' && (
                  <>
                    <CheckCircle size={12} className="text-[var(--ready)]" />
                    {t('engineering.failurePrediction.acknowledged')}
                  </>
                )}
                {r.action === 'not_found' && (
                  <>
                    <HelpCircle size={12} className="text-ink3" />
                    {t('engineering.predictionsPage.resultNotFound')}
                  </>
                )}
                {r.action === 'error' && (
                  <>
                    <XCircle size={12} className="text-[var(--alert)]" />
                    {r.detail}
                  </>
                )}
                <span className="text-ink3">— {r.prediction_id}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Predictions list */}
      {isError ? (
        <StateBlock status="error" error={{ message: t('engineering.predictionsPage.loadError'), onRetry: () => refetch() }} />
      ) : isLoading ? (
        <div className="space-y-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-14 text-center">
          <div className="w-14 h-14 rounded-full bg-[var(--ready-soft)] flex items-center justify-center mb-3">
            <ShieldCheck size={24} className="text-[var(--ready)]" />
          </div>
          <p className="text-base font-semibold text-ink">{t('engineering.predictionsPage.emptyHeading')}</p>
          {filtersActive ? (
            <p className="text-sm mt-1 max-w-xs text-ink3">
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
              <p className="text-sm mt-1 max-w-xs text-ink3">{t('engineering.predictionsPage.emptyHelp')}</p>
              <Link
                href="/engineering?tab=assets"
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--caution)] hover:underline transition-colors"
              >
                {t('engineering.predictionsPage.goToAssetRegister')}
              </Link>
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
              cardRef={(el) => { cardRefs.current[prediction.id] = el }}
              isHighlighted={highlightedId === prediction.id}
              canManage={canManage}
              expandedId={expandedId}
              onToggleExpand={handleToggleExpand}
              onAcknowledge={(id) => acknowledgeMutation.mutate(id)}
              isAcknowledging={acknowledgeMutation.isPending && acknowledgeMutation.variables === prediction.id}
              onCreateWO={(id) => createWOMutation.mutate(id)}
              isCreatingWO={createWOMutation.isPending && createWOMutation.variables === prediction.id}
              canAuthorize={canAuthorize}
              onAuthorize={(id) => authorizeRecommendationMutation.mutate(id)}
              isAuthorizing={authorizeRecommendationMutation.isPending && authorizeRecommendationMutation.variables === prediction.id}
              isSelected={selected.has(prediction.id)}
              onToggleSelect={toggleSelected}
            />
          ))}
        </div>
      )}
    </div>
  )
}
