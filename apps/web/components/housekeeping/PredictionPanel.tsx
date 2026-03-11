'use client'

import { useState } from 'react'
import { RoomPrediction } from '@/lib/api/housekeeping'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatETA(predictedReadyAt: string | null): string {
  if (!predictedReadyAt) return 'Unknown'
  const dt = new Date(predictedReadyAt)
  const now = new Date()
  const diffMin = Math.round((dt.getTime() - now.getTime()) / 60000)
  if (diffMin < 0) return 'Overdue'
  if (diffMin < 60) return `Ready in ${diffMin} min`
  return `Ready by ${dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
}

const RISK_FACTOR_LABELS: Record<string, string> = {
  vip_room: 'VIP Room',
  will_be_late: 'Will Be Late',
  tight_timeline: 'Tight Timeline',
  overloaded_housekeeper: 'HK Overloaded',
  no_housekeeper_assigned: 'Unassigned',
}

function prettifyRiskFactor(factor: string): string {
  return RISK_FACTOR_LABELS[factor] ?? factor.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// ── Risk dot ──────────────────────────────────────────────────────────────────

function RiskDot({ level }: { level: 'LOW' | 'MEDIUM' | 'HIGH' | null }) {
  if (level === 'HIGH') return <span className="w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0 mt-0.5" />
  if (level === 'MEDIUM') return <span className="w-2.5 h-2.5 rounded-full bg-orange-400 flex-shrink-0 mt-0.5" />
  return <span className="w-2.5 h-2.5 rounded-full bg-green-400 flex-shrink-0 mt-0.5" />
}

// ── Risk badge ────────────────────────────────────────────────────────────────

function RiskBadge({ level }: { level: 'LOW' | 'MEDIUM' | 'HIGH' | null }) {
  if (level === 'HIGH')
    return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">HIGH</span>
  if (level === 'MEDIUM')
    return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700">MEDIUM</span>
  return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">LOW</span>
}

// ── Skeleton row ──────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b border-gray-100 last:border-0 animate-pulse">
      <div className="w-2.5 h-2.5 rounded-full bg-gray-200 mt-1 flex-shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="flex items-center gap-2">
          <div className="h-4 w-20 bg-gray-200 rounded" />
          <div className="h-4 w-12 bg-gray-200 rounded-full" />
          <div className="h-4 w-28 bg-gray-200 rounded ml-auto" />
        </div>
        <div className="flex gap-1.5">
          <div className="h-3.5 w-16 bg-gray-100 rounded-full" />
          <div className="h-3.5 w-20 bg-gray-100 rounded-full" />
        </div>
      </div>
    </div>
  )
}

// ── Prediction row ────────────────────────────────────────────────────────────

function PredictionRow({ prediction }: { prediction: RoomPrediction }) {
  const roomLabel = prediction.room_number
    ? `Room ${prediction.room_number}`
    : `Room ${prediction.room_id.slice(0, 8)}`

  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors">
      <RiskDot level={prediction.risk_level} />

      <div className="flex-1 min-w-0">
        {/* Top row: room name + badge + ETA */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">{roomLabel}</span>
          <RiskBadge level={prediction.risk_level} />
          <span className="ml-auto text-xs font-medium text-gray-600 whitespace-nowrap">
            {formatETA(prediction.predicted_ready_at)}
          </span>
        </div>

        {/* Bottom row: risk factor chips + confidence */}
        <div className="flex flex-wrap items-center gap-1.5 mt-1">
          {prediction.risk_factors.map((factor) => (
            <span
              key={factor}
              className="px-1.5 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600 border border-gray-200"
            >
              {prettifyRiskFactor(factor)}
            </span>
          ))}
          {prediction.confidence_score !== null && (
            <span className="text-xs text-gray-400 ml-auto whitespace-nowrap">
              {Math.round(prediction.confidence_score * 100)}% confidence
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
  const [isExpanded, setIsExpanded] = useState(false)

  // Only show HIGH and MEDIUM risk rooms, sorted HIGH first
  const atRiskRooms = predictions
    .filter((p) => p.risk_level === 'HIGH' || p.risk_level === 'MEDIUM')
    .sort((a, b) => {
      if (a.risk_level === b.risk_level) return 0
      return a.risk_level === 'HIGH' ? -1 : 1
    })

  const highCount = atRiskRooms.filter((p) => p.risk_level === 'HIGH').length
  const mediumCount = atRiskRooms.filter((p) => p.risk_level === 'MEDIUM').length

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* ── Header ── */}
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className="w-full flex items-center justify-between p-4 cursor-pointer text-left hover:bg-gray-50 transition-colors"
        aria-expanded={isExpanded}
      >
        <div className="flex items-center gap-3">
          {/* Warning icon */}
          <span className="text-orange-500 text-lg leading-none">&#9888;</span>
          <span className="text-sm font-semibold text-gray-900">Room Readiness Alerts</span>

          {/* Count badges */}
          <div className="flex items-center gap-1.5">
            {highCount > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                {highCount} HIGH
              </span>
            )}
            {mediumCount > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700">
                {mediumCount} MEDIUM
              </span>
            )}
          </div>
        </div>

        {/* Chevron */}
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform duration-200 flex-shrink-0 ${
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
        <div className="border-t border-gray-100">
          {isLoading ? (
            <>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </>
          ) : atRiskRooms.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-gray-400">
              No at-risk rooms. All rooms on track.
            </div>
          ) : (
            atRiskRooms.map((prediction) => (
              <PredictionRow key={prediction.room_id} prediction={prediction} />
            ))
          )}
        </div>
      )}
    </div>
  )
}
