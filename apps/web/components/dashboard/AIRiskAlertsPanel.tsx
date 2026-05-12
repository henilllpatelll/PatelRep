'use client'
import { useState } from 'react'
import { AlertTriangle, Zap, Clock, ChevronDown, ChevronUp, CheckCircle } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { aiApi } from '@/lib/api/ai'

export function AIRiskAlertsPanel() {
  const [expanded, setExpanded] = useState(true)

  const { data, isLoading } = useQuery({
    queryKey: ['ai-risk-alerts'],
    queryFn: () => aiApi.getRiskAlerts(),
    refetchInterval: 120_000,
  })

  const alerts = data?.data

  const hasAlerts = alerts && (
    (alerts.housekeeping_risks?.length ?? 0) > 0 ||
    (alerts.maintenance_risks?.length ?? 0) > 0 ||
    (alerts.sla_breaches?.length ?? 0) > 0
  )

  const totalCount =
    (alerts?.housekeeping_risks?.length ?? 0) +
    (alerts?.maintenance_risks?.length ?? 0) +
    (alerts?.sla_breaches?.length ?? 0)

  if (isLoading) {
    return (
      <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-2xl p-4">
        <div className="animate-pulse h-16" />
      </div>
    )
  }

  return (
    <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-2xl p-4 overflow-hidden">
      {/* Header */}
      <button
        className="w-full flex items-center justify-between"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          {hasAlerts ? (
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          ) : (
            <span className="w-2 h-2 bg-green-500 rounded-full" />
          )}
          <h2 className="text-sm font-bold text-stone-700">AI Risk Alerts</h2>
          <span className="bg-amber-100 text-amber-700 text-xs font-semibold px-2 py-0.5 rounded-md">AI</span>
          {hasAlerts && (
            <span className="ml-1 px-2 py-0.5 bg-red-100 text-red-700 text-xs font-semibold rounded-full">
              {totalCount}
            </span>
          )}
        </div>
        <span className="text-stone-400">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
      </button>

      {/* Body */}
      {expanded && (
        <div className="mt-3">
          {!hasAlerts ? (
            <div className="flex items-center gap-3 py-3 text-green-700">
              <CheckCircle size={18} className="shrink-0" />
              <p className="text-sm font-medium">No active alerts — operations running smoothly</p>
            </div>
          ) : (
            <div>
              {/* Housekeeping risks */}
              {alerts?.housekeeping_risks?.map((r, i) => (
                <div key={i} className="border-l-4 border-red-400 bg-white/60 rounded-xl mb-2 p-3 flex items-start gap-3">
                  <AlertTriangle size={16} className="text-red-500 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-stone-700">
                        Room {r.rooms?.room_number ?? '—'} — {r.risk_level} risk
                      </p>
                      <span className="px-1.5 py-0.5 bg-red-100 text-red-700 text-xs font-semibold rounded uppercase">
                        HK
                      </span>
                    </div>
                  </div>
                  <a
                    href="/housekeeping"
                    className="text-xs text-amber-600 hover:underline shrink-0"
                  >
                    Reassign
                  </a>
                </div>
              ))}

              {/* SLA breaches */}
              {alerts?.sla_breaches?.map((b, i) => (
                <div key={i} className="border-l-4 border-red-400 bg-white/60 rounded-xl mb-2 p-3 flex items-start gap-3">
                  <Clock size={16} className="text-red-500 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-stone-700">
                        WO-{b.work_order_number} — {b.title}
                      </p>
                      <span className="px-1.5 py-0.5 bg-red-600 text-white text-xs font-semibold rounded uppercase">
                        OVERDUE
                      </span>
                    </div>
                    {b.due_at && (
                      <p className="text-xs text-stone-400 mt-0.5">
                        Due: {new Date(b.due_at).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <a
                    href="/engineering"
                    className="text-xs text-amber-600 hover:underline shrink-0"
                  >
                    View
                  </a>
                </div>
              ))}

              {/* Maintenance risks */}
              {alerts?.maintenance_risks?.map((r, i) => (
                <div key={i} className="border-l-4 border-amber-400 bg-white/60 rounded-xl mb-2 p-3 flex items-start gap-3">
                  <Zap size={16} className="text-amber-500 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-stone-700">
                        {r.name} — {r.failure_risk_score}% failure risk
                      </p>
                      <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-xs font-semibold rounded uppercase">
                        MAINT
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
