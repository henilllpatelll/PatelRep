'use client'
import { useState } from 'react'
import { AlertTriangle, Zap, Clock, ChevronDown, ChevronUp, CheckCircle } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { aiApi } from '@/lib/api/ai'
import { Card } from '@/components/ui/Card'

export function AIRiskAlertsPanel() {
  const [expanded, setExpanded] = useState(true)

  const { data, isLoading } = useQuery({
    queryKey: ['ai-risk-alerts'],
    queryFn: () => aiApi.getRiskAlerts(),
    refetchInterval: 30_000,
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
    return <Card><div className="animate-pulse h-16" /></Card>
  }

  return (
    <Card className={`p-0 overflow-hidden${hasAlerts ? ' border-red-200 bg-red-50' : ''}`}>
      {/* Header */}
      <button
        className="w-full px-5 py-4 flex items-center justify-between"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          {hasAlerts ? (
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          ) : (
            <span className="w-2 h-2 bg-green-500 rounded-full" />
          )}
          <h2 className="text-sm font-bold text-slate-700">AI Risk Alerts</h2>
          <span className="bg-purple-50 text-purple-700 text-xs font-semibold px-2 py-0.5 rounded-md">AI</span>
          {hasAlerts && (
            <span className="ml-1 px-2 py-0.5 bg-red-100 text-red-700 text-xs font-semibold rounded-full">
              {totalCount}
            </span>
          )}
        </div>
        <span className="text-slate-400">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
      </button>

      {/* Body */}
      {expanded && (
        <div className="px-4 pb-4">
          {!hasAlerts ? (
            <div className="flex items-center gap-3 py-3 text-green-700">
              <CheckCircle size={18} className="shrink-0" />
              <p className="text-sm font-medium">No active alerts — operations running smoothly</p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Housekeeping risks */}
              {alerts?.housekeeping_risks?.map((r, i) => (
                <div key={i} className="flex items-start gap-3 p-3 bg-red-50 rounded-lg">
                  <span className="w-2 h-2 bg-red-500 rounded-full mt-1.5 shrink-0" />
                  <AlertTriangle size={16} className="text-red-500 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-slate-700">
                        Room {r.rooms?.room_number ?? '—'} — {r.risk_level} risk
                      </p>
                      <span className="px-1.5 py-0.5 bg-red-100 text-red-700 text-xs font-semibold rounded uppercase">
                        HK
                      </span>
                    </div>
                  </div>
                  <a
                    href="/housekeeping"
                    className="text-xs text-blue-600 hover:underline shrink-0"
                  >
                    Reassign
                  </a>
                </div>
              ))}

              {/* SLA breaches */}
              {alerts?.sla_breaches?.map((b, i) => (
                <div key={i} className="flex items-start gap-3 p-3 bg-red-50 rounded-lg">
                  <span className="w-2 h-2 bg-red-600 rounded-full mt-1.5 shrink-0" />
                  <Clock size={16} className="text-red-500 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-slate-700">
                        WO-{b.work_order_number} — {b.title}
                      </p>
                      <span className="px-1.5 py-0.5 bg-red-600 text-white text-xs font-semibold rounded uppercase">
                        OVERDUE
                      </span>
                    </div>
                    {b.due_at && (
                      <p className="text-xs text-slate-400 mt-0.5">
                        Due: {new Date(b.due_at).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <a
                    href="/engineering"
                    className="text-xs text-blue-600 hover:underline shrink-0"
                  >
                    View
                  </a>
                </div>
              ))}

              {/* Maintenance risks */}
              {alerts?.maintenance_risks?.map((r, i) => (
                <div key={i} className="flex items-start gap-3 p-3 bg-orange-50 rounded-lg">
                  <span className="w-2 h-2 bg-orange-500 rounded-full mt-1.5 shrink-0" />
                  <Zap size={16} className="text-orange-500 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-slate-700">
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
    </Card>
  )
}
