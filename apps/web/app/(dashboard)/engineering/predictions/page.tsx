'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  AlertTriangle,
  CheckCircle,
  Loader2,
  Plus,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
} from 'lucide-react'
import { engineeringApi, FailurePrediction } from '@/lib/api/engineering'
import { useRole } from '@/lib/hooks/useRole'
import { GlassCard } from '@/components/ui/GlassCard'
import { Button } from '@/components/ui/Button'

// ─── Types ────────────────────────────────────────────────────────────────────

type RiskFilter = 'all' | 'high' | 'medium' | 'low'
type StatusFilter = 'all' | 'active' | 'acknowledged'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRiskLabel(score: number): string {
  if (score >= 70) return 'HIGH'
  if (score >= 40) return 'MEDIUM'
  return 'LOW'
}

function getRiskBadgeCls(score: number): string {
  if (score >= 70) return 'bg-red-100 text-red-700'
  if (score >= 40) return 'bg-orange-100 text-orange-700'
  return 'bg-green-100 text-green-700'
}

function getRiskRingColor(score: number): string {
  if (score >= 70) return 'text-red-500'
  if (score >= 40) return 'text-orange-400'
  return 'text-green-500'
}

function getBorderColor(score: number): string {
  if (score >= 70) return 'border-l-red-500'
  if (score >= 40) return 'border-l-orange-400'
  return 'border-l-green-400'
}

function getAvgScoreColor(score: number): string {
  if (score >= 70) return 'text-red-600'
  if (score >= 40) return 'text-orange-500'
  return 'text-green-600'
}

// ─── Skeleton card ────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-2xl border border-white/90 bg-white/[0.65] backdrop-blur-md border-l-4 border-l-gray-200 p-5">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-full bg-gray-100 shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-gray-100 rounded w-1/3" />
          <div className="h-3 bg-gray-100 rounded w-1/4" />
          <div className="h-3 bg-gray-100 rounded w-2/3 mt-3" />
          <div className="h-3 bg-gray-100 rounded w-1/2" />
        </div>
      </div>
    </div>
  )
}

// ─── Risk ring (48×48) ────────────────────────────────────────────────────────

function RiskRing({ score }: { score: number }) {
  const ringColor = getRiskRingColor(score)
  // circumference = 2π×20 ≈ 125.66; dash for 48×48 viewBox with r=20
  const circumference = 125.66
  return (
    <div className="relative shrink-0 w-12 h-12">
      <svg className="w-12 h-12 -rotate-90" viewBox="0 0 48 48">
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
}: PredictionCardProps) {
  const score = prediction.risk_score
  const borderColor = getBorderColor(score)
  const badgeCls = getRiskBadgeCls(score)
  const riskLabel = getRiskLabel(score)
  const assetName = prediction.assets?.name ?? 'Unknown Asset'
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

  const cardVariant = score >= 70 ? 'danger' : score >= 40 ? 'accent' : 'default'

  return (
    <GlassCard
      variant={cardVariant}
      className={`border-l-4 ${borderColor} p-5 ${prediction.is_acknowledged ? 'opacity-75' : ''}`}
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
                <span className="text-xs font-medium text-green-600 flex items-center gap-1">
                  <CheckCircle size={12} />
                  Acknowledged
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
            <span className="font-medium">Failure window:</span>{' '}
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
                className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-white/80 border border-gray-200 text-gray-600"
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
              <span className="font-medium">AI Reasoning: </span>
              {isExpanded ? reasoning : reasoningPreview}
              {!isExpanded && hasMoreReasoning && '…'}
            </p>
            {hasMoreReasoning && (
              <button
                onClick={() => onToggleExpand(prediction.id)}
                className="mt-1 flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
              >
                {isExpanded ? (
                  <>
                    <ChevronUp size={13} /> Show less
                  </>
                ) : (
                  <>
                    <ChevronDown size={13} /> Show more
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {/* Costs */}
        {(repairCost != null || replaceCost != null) && (
          <p className="text-sm text-gray-600">
            <span className="font-medium">Costs: </span>
            {repairCost != null && (
              <span>
                Repair ~$
                {repairCost.toLocaleString()}
              </span>
            )}
            {repairCost != null && replaceCost != null && (
              <span className="mx-1 text-gray-400">|</span>
            )}
            {replaceCost != null && (
              <span>
                Replace ~$
                {replaceCost.toLocaleString()}
              </span>
            )}
          </p>
        )}

        {/* Generated at */}
        {generatedAt && (
          <p className="text-xs text-gray-400">Generated: {generatedAt}</p>
        )}

        {/* Actions */}
        {canManage && !prediction.is_acknowledged && (
          <div className="flex items-center gap-3 pt-1">
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
              Create Work Order
            </Button>
            <Button
              variant="secondary"
              onClick={() => onAcknowledge(prediction.id)}
              disabled={isAcknowledging}
              className="text-xs px-3 py-1.5 border-green-200 text-green-700 bg-green-50 hover:bg-green-100"
            >
              {isAcknowledging ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <CheckCircle size={12} />
              )}
              Acknowledge
            </Button>
          </div>
        )}

        {prediction.is_acknowledged && acknowledgedAt && (
          <p className="flex items-center gap-1.5 text-xs text-green-600 font-medium pt-1">
            <CheckCircle size={12} />
            Acknowledged {acknowledgedAt}
          </p>
        )}
      </div>
    </GlassCard>
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
    <GlassCard variant="default" className="p-4">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${accent}`}>{value}</p>
    </GlassCard>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PredictionsPage() {
  const { isGM, role } = useRole()
  const canManage = isGM || role === 'chief_engineer'
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
      showSuccess('Work order created successfully')
    },
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
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2.5">
            <AlertTriangle size={22} className="text-orange-500 shrink-0" />
            Asset Failure Predictions
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            AI-powered failure risk analysis — updated nightly
          </p>
        </div>

        {canManage && (
          <div className="shrink-0">
            <p className="text-xs text-gray-400 text-right leading-tight">
              To run a fresh analysis,
              <br />
              open an asset from the Asset Register.
            </p>
          </div>
        )}
      </div>

      {/* Success banner */}
      {successMsg && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
          <CheckCircle size={15} />
          {successMsg}
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Active Alerts"
          value={activeCount}
          accent={activeCount > 0 ? 'text-red-600' : 'text-gray-900'}
        />
        <StatCard
          label="High Risk"
          value={highRiskCount}
          accent={highRiskCount > 0 ? 'text-red-600' : 'text-gray-900'}
        />
        <StatCard
          label="Acknowledged"
          value={acknowledgedCount}
          accent={acknowledgedCount > 0 ? 'text-green-600' : 'text-gray-500'}
        />
        <StatCard
          label="Avg Risk Score"
          value={avgScore || '—'}
          accent={getAvgScoreColor(avgScore)}
        />
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Risk filter */}
        <div className="flex items-center gap-1 bg-white/70 backdrop-blur-sm border border-indigo-200/40 rounded-lg p-1">
          {(
            [
              { key: 'all', label: 'All Risk' },
              { key: 'high', label: 'High' },
              { key: 'medium', label: 'Medium' },
              { key: 'low', label: 'Low' },
            ] as { key: RiskFilter; label: string }[]
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setRiskFilter(key)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                riskFilter === key
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <div className="flex items-center gap-1 bg-white/70 backdrop-blur-sm border border-indigo-200/40 rounded-lg p-1">
          {(
            [
              { key: 'all', label: 'All Status' },
              { key: 'active', label: 'Active' },
              { key: 'acknowledged', label: 'Acknowledged' },
            ] as { key: StatusFilter; label: string }[]
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                statusFilter === key
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {filtersActive && (
          <button
            onClick={() => {
              setRiskFilter('all')
              setStatusFilter('all')
            }}
            className="text-sm text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
          >
            Clear filters
          </button>
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
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mb-3">
            <ShieldCheck size={24} className="text-green-600" />
          </div>
          <p className="text-base font-semibold text-gray-800">No predictions found</p>
          {filtersActive ? (
            <p className="text-sm text-gray-500 mt-1 max-w-xs">
              No predictions match these filters.{' '}
              <button
                onClick={() => {
                  setRiskFilter('all')
                  setStatusFilter('all')
                }}
                className="text-indigo-600 hover:underline font-medium"
              >
                Clear filters
              </button>{' '}
              to see all predictions.
            </p>
          ) : (
            <p className="text-sm text-gray-500 mt-1 max-w-xs">
              Predictions run nightly. You can trigger an analysis from the Asset Register.
            </p>
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
            />
          ))}
        </div>
      )}
    </div>
  )
}
