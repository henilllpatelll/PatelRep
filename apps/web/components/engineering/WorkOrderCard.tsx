'use client'
import type { WorkOrder } from '@/lib/api/engineering'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { KebabMenu } from '@/components/shared/KebabMenu'

const CATEGORY_ICONS: Record<string, string> = {
  plumbing: '💧',
  electrical: '⚡',
  hvac: '❄️',
  furniture: '🪑',
  appliance: '🔌',
  structural: '🏗️',
  safety: '🛡️',
  general: '🔧',
}

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-blue-50 text-blue-700',
  in_progress: 'bg-purple-50 text-purple-700',
  on_hold: 'bg-orange-50 text-orange-700',
  completed: 'bg-green-50 text-green-700',
  cancelled: 'bg-gray-50 text-gray-500',
}

function formatSLA(dueAt: string): { text: string; breached: boolean } {
  const diff = new Date(dueAt).getTime() - Date.now()
  const breached = diff < 0
  const abs = Math.abs(diff)
  const h = Math.floor(abs / 3600000)
  const m = Math.floor((abs % 3600000) / 60000)
  const suffix = breached ? 'overdue' : 'left'
  if (h > 48) return { text: `${Math.floor(h / 24)}d ${suffix}`, breached }
  if (h > 0) return { text: `${h}h ${m}m ${suffix}`, breached }
  return { text: `${m}m ${suffix}`, breached }
}

function priorityVariant(priority: string): 'high' | 'medium' | 'low' {
  if (priority === 'urgent' || priority === 'high') return 'high'
  if (priority === 'normal') return 'medium'
  return 'low'
}

interface Props {
  wo: WorkOrder
  onClick: (wo: WorkOrder) => void
  onEdit?: (wo: WorkOrder) => void
  onDelete?: (wo: WorkOrder) => void
}

export function WorkOrderCard({ wo, onClick, onEdit, onDelete }: Props) {
  const sla =
    wo.due_at && wo.status !== 'completed' && wo.status !== 'cancelled'
      ? formatSLA(wo.due_at)
      : null

  const isDanger = wo.priority === 'urgent' || sla?.breached

  return (
    <Card
      className={`cursor-pointer p-3${isDanger ? ' border-red-200 bg-red-50' : ''}`}
    >
      <div onClick={() => onClick(wo)}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {/* Top row */}
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="text-xs font-mono text-gray-400">WO-{wo.work_order_number}</span>
              <Badge variant={priorityVariant(wo.priority)}>
                {wo.priority}
              </Badge>
              {sla?.breached && (
                <Badge variant="high">SLA BREACHED</Badge>
              )}
              {wo.is_pm_generated && (
                <span className="text-xs px-1.5 py-0.5 bg-teal-50 text-teal-600 rounded font-medium border border-teal-200">
                  PM
                </span>
              )}
            </div>

            {/* Title */}
            <p className="font-medium text-gray-900 text-sm leading-snug">{wo.title}</p>

            {/* Meta */}
            <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-500 flex-wrap">
              <span>
                {CATEGORY_ICONS[wo.category]} {wo.category}
              </span>
              {wo.rooms?.room_number && <span>· Room {wo.rooms.room_number}</span>}
              {wo.location_text && !wo.rooms?.room_number && (
                <span className="truncate max-w-32">· {wo.location_text}</span>
              )}
              {wo.assets && <span>· {wo.assets.name}</span>}
            </div>
          </div>

          {/* Right side */}
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_STYLES[wo.status] || 'bg-gray-50 text-gray-500'}`}
            >
              {wo.status.replace('_', ' ')}
            </span>
            {sla && (
              <span className={`text-xs ${sla.breached ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
                {sla.text}
              </span>
            )}
            {(onEdit || onDelete) && (
              <KebabMenu
                onEdit={() => onEdit?.(wo)}
                onDelete={() => onDelete?.(wo)}
              />
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}
