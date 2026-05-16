'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, Loader2, Plus } from 'lucide-react'
import { engineeringApi, FailurePrediction } from '@/lib/api/engineering'
import { useRole } from '@/lib/hooks/useRole'
import { Card } from '@/components/ui/Card'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRiskRingColor(score: number): string {
  if (score >= 70) return 'text-red-500'
  if (score >= 40) return 'text-orange-400'
  return 'text-green-500'
}

function getRiskBgColor(score: number): string {
  if (score >= 70) return 'bg-red-50 border-red-100'
  if (score >= 40) return 'bg-orange-50 border-orange-100'
  return 'bg-green-50 border-green-100'
}

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

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonItem() {
  return (
    <div className="p-3 rounded-lg border border-gray-100 animate-pulse space-y-2">
      <div className="flex items-start gap-2.5">
        <div className="w-9 h-9 rounded-full bg-gray-100 shrink-0" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3.5 bg-gray-100 rounded w-3/4" />
          <div className="h-3 bg-gray-100 rounded w-1/2" />
        </div>
      </div>
      <div className="h-3 bg-gray-100 rounded w-full" />
      <div className="h-3 bg-gray-100 rounded w-2/3" />
      <div className="flex gap-1.5">
        <div className="h-5 w-16 bg-gray-100 rounded-full" />
        <div className="h-5 w-20 bg-gray-100 rounded-full" />
      </div>
    </div>
  )
}

// ─── Prediction card ──────────────────────────────────────────────────────────

interface PredictionCardProps {
  prediction: FailurePrediction
  canAcknowledge: boolean
  onAcknowledge: (id: string) => void
  isAcknowledging: boolean
  onCreateWO: (id: string) => void
  isCreatingWO: boolean
}

function PredictionCard({
  prediction,
  canAcknowledge,
  onAcknowledge,
  isAcknowledging,
  onCreateWO,
  isCreatingWO,
}: PredictionCardProps) {
  const asset = prediction.assets
  const assetName = asset?.name ?? 'Unknown Asset'
  const categoryName = asset?.asset_categories?.name
  const indicators = (prediction.failure_indicators ?? []).slice(0, 2)
  const ringColor = getRiskRingColor(prediction.risk_score)
  const bgCls = getRiskBgColor(prediction.risk_score)
  const badgeCls = getRiskBadgeCls(prediction.risk_score)
  const riskLabel = getRiskLabel(prediction.risk_score)

  return (
    <div className={`p-3 rounded-lg border ${bgCls} ${prediction.is_acknowledged ? 'opacity-60' : ''}`}>
      {/* Top row: risk ring + asset name */}
      <div className="flex items-start gap-2.5 mb-2">
        {/* SVG risk score ring */}
        <div className="relative shrink-0 w-9 h-9">
          <svg className="w-9 h-9 -rotate-90" viewBox="0 0 36 36">
            <circle
              cx="18"
              cy="18"
              r="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              className="text-gray-200"
            />
            <circle
              cx="18"
              cy="18"
              r="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeDasharray={`${(prediction.risk_score / 100) * 94.25} 94.25`}
              strokeLinecap="round"
              className={ringColor}
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-gray-700">
            {prediction.risk_score}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-1">
            <p className="text-sm font-semibold text-gray-900 leading-tight truncate">{assetName}</p>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${badgeCls}`}>
              {riskLabel}
            </span>
          </div>
          {categoryName && (
            <p className="text-xs text-gray-500 mt-0.5">{categoryName}</p>
          )}
        </div>
      </div>

      {/* Predicted failure window */}
      {prediction.predicted_failure_window && (
        <p className="text-xs text-gray-600 mb-1.5">
          <span className="font-medium">Failure window:</span>{' '}
          {prediction.predicted_failure_window}
        </p>
      )}

      {/* Recommendation */}
      <p className="text-xs text-gray-700 line-clamp-2 mb-2">{prediction.recommendation}</p>

      {/* Failure indicator chips */}
      {indicators.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2.5">
          {indicators.map((indicator, idx) => (
            <span
              key={idx}
              className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/80 border border-gray-200 text-gray-600 truncate max-w-[140px]"
            >
              {indicator}
            </span>
          ))}
        </div>
      )}

      {/* Acknowledge + Create WO buttons */}
      {canAcknowledge && !prediction.is_acknowledged && (
        <div className="flex items-center gap-2 mt-1">
          <button
            onClick={() => onCreateWO(prediction.id)}
            disabled={isCreatingWO}
            className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors disabled:opacity-50"
          >
            {isCreatingWO ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Plus size={12} />
            )}
            Create WO
          </button>
          <button
            onClick={() => onAcknowledge(prediction.id)}
            disabled={isAcknowledging}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 transition-colors disabled:opacity-50"
          >
            {isAcknowledging ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <CheckCircle size={12} />
            )}
            Acknowledge
          </button>
        </div>
      )}

      {prediction.is_acknowledged && (
        <p className="flex items-center gap-1 text-xs text-green-600 font-medium">
          <CheckCircle size={12} />
          Acknowledged
        </p>
      )}
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FailurePredictionSidebar() {
  const { isGM, role } = useRole()
  const canAcknowledge = isGM || role === 'chief_engineer'
  const queryClient = useQueryClient()

  const { data: predictions, isLoading } = useQuery({
    queryKey: ['failure-predictions'],
    queryFn: () => engineeringApi.getFailurePredictions(),
    select: (res) => res.data as FailurePrediction[],
  })

  const acknowledgeMutation = useMutation({
    mutationFn: (predictionId: string) =>
      engineeringApi.acknowledgeFailurePrediction(predictionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['failure-predictions'] })
    },
  })

  const createWOMutation = useMutation({
    mutationFn: (predictionId: string) =>
      engineeringApi.createWorkOrderFromPrediction(predictionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-orders'] })
    },
  })

  const items = predictions ?? []
  const hasHighRisk = items.some((p) => !p.is_acknowledged && p.risk_score >= 70)

  return (
    <Card
      className={`w-72 h-fit shrink-0 p-4${hasHighRisk ? ' border-red-200 bg-red-50' : ''}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">Asset Failure Risks</h3>
        {items.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 font-medium">
            {items.filter((p) => !p.is_acknowledged).length} active
          </span>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-3">
          <SkeletonItem />
          <SkeletonItem />
          <SkeletonItem />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center mb-2.5">
            <CheckCircle size={18} className="text-green-600" />
          </div>
          <p className="text-sm font-medium text-gray-700">No high-risk assets</p>
          <p className="text-xs text-gray-400 mt-1">All assets are within normal risk levels.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((prediction) => (
            <PredictionCard
              key={prediction.id}
              prediction={prediction}
              canAcknowledge={canAcknowledge}
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

      {/* Footer note */}
      <div className="mt-4 pt-3 border-t border-white/60">
        <p className="text-xs text-gray-400 text-center">
          Predictions updated nightly by AI
        </p>
      </div>
    </Card>
  )
}
