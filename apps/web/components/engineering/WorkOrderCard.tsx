'use client'
import type { WorkOrder } from '@/lib/api/engineering'
import { Badge } from '@/components/ui/Badge'
import { Pill } from '@/components/ui/primitives'
import { KebabMenu } from '@/components/shared/KebabMenu'
import { cn } from '@/lib/utils'

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

// WO status keeps the same hue meanings as the room status contract:
// blue = open/queued, violet = in progress, amber = on hold, teal = completed
const STATUS_TONE: Record<string, 'info' | 'progress' | 'caution' | 'ready' | 'blocked'> = {
  open: 'info',
  in_progress: 'progress',
  on_hold: 'caution',
  completed: 'ready',
  cancelled: 'blocked',
}

const STATUS_RAIL: Record<string, string> = {
  open: 'var(--info)',
  in_progress: 'var(--progress)',
  on_hold: 'var(--caution)',
  completed: 'var(--ready)',
  cancelled: 'var(--blocked)',
}

function formatSLA(dueAt: string): { text: string; breached: boolean } {
  const diff = new Date(dueAt).getTime() - Date.now()
  const breached = diff < 0
  const abs = Math.abs(diff)
  const h = Math.floor(abs / 3600000)
  const m = Math.floor((abs % 3600000) / 60000)
  const suffix = breached ? 'overdue' : 'left'
  if (h >= 24) {
    const d = Math.floor(h / 24)
    return { text: `${d} ${d === 1 ? 'day' : 'days'} ${suffix}`, breached }
  }
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
    <div
      className={cn(
        'lift relative overflow-hidden bg-surface border rounded-[var(--r-lg)] pl-4 pr-3 py-3 cursor-pointer shadow-[var(--shadow-sm)]',
        isDanger ? 'border-[var(--alert-line)] bg-[var(--alert-soft)]/40' : 'border-line'
      )}
    >
      {/* Status rail */}
      <div
        aria-hidden
        className="absolute top-0 left-0 bottom-0 w-[4px]"
        style={{ background: isDanger ? 'var(--alert)' : (STATUS_RAIL[wo.status] ?? 'var(--line)') }}
      />
      <div onClick={() => onClick(wo)}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {/* Top row */}
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="text-xs font-mono text-ink4">WO-{wo.work_order_number}</span>
              <Badge variant={priorityVariant(wo.priority)}>
                {wo.priority}
              </Badge>
              {sla?.breached && (
                <Badge variant="high">SLA BREACHED</Badge>
              )}
              {wo.is_pm_generated && (
                <Pill tone="ready" size="sm">PM</Pill>
              )}
            </div>

            {/* Title */}
            <p className="font-medium text-ink text-sm leading-snug">{wo.title}</p>

            {/* Meta */}
            <div className="flex items-center gap-2 mt-1.5 text-xs text-ink3 flex-wrap">
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
            <Pill tone={STATUS_TONE[wo.status] ?? 'blocked'} size="sm" dot className="capitalize">
              {wo.status.replace('_', ' ')}
            </Pill>
            {sla && (
              <span className={cn('text-xs font-mono', sla.breached ? 'text-[var(--alert)] font-medium' : 'text-ink4')}>
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
    </div>
  )
}
