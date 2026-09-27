import type { WorkOrder } from '@/lib/api/engineering'

export type WorkOrderQueueGroupKey = 'attention' | 'in_progress' | 'waiting' | 'completed'

export interface WorkOrderQueueGroup {
  key: WorkOrderQueueGroupKey
  items: WorkOrder[]
}

function isOverdue(workOrder: WorkOrder, now: Date): boolean {
  return Boolean(
    workOrder.due_at
    && workOrder.status !== 'completed'
    && new Date(workOrder.due_at).getTime() < now.getTime(),
  )
}

/** Lower values surface first. This is deterministic operational triage, not AI ranking. */
export function rankWorkOrder(workOrder: WorkOrder, now = new Date(), unavailableRoomIds = new Set<string>()): number {
  if (workOrder.priority === 'emergency') return 0
  if (workOrder.status === 'escalated') return 1
  if (workOrder.room_id && unavailableRoomIds.has(workOrder.room_id)) return 2
  if (isOverdue(workOrder, now)) return 3
  if (workOrder.priority === 'urgent' && !workOrder.assigned_to) return 4
  if (workOrder.priority === 'urgent' && workOrder.guest_reported) return 5
  if (workOrder.priority === 'urgent') return 6
  if (workOrder.priority === 'normal') return 7
  return 8
}

export function orderWorkOrders(workOrders: WorkOrder[], now = new Date(), unavailableRoomIds = new Set<string>()): WorkOrder[] {
  return [...workOrders].sort((a, b) => {
    const rankDifference = rankWorkOrder(a, now, unavailableRoomIds) - rankWorkOrder(b, now, unavailableRoomIds)
    if (rankDifference !== 0) return rankDifference
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

function isSameDay(dateString: string | undefined, now: Date): boolean {
  if (!dateString) return false
  const date = new Date(dateString)
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate()
}

export function groupWorkOrderQueue(
  workOrders: WorkOrder[],
  now = new Date(),
  unavailableRoomIds = new Set<string>(),
): WorkOrderQueueGroup[] {
  const grouped: WorkOrderQueueGroup[] = [
    { key: 'attention', items: [] },
    { key: 'in_progress', items: [] },
    { key: 'waiting', items: [] },
    { key: 'completed', items: [] },
  ]

  for (const workOrder of workOrders) {
    if (workOrder.status === 'completed') {
      if (isSameDay(workOrder.completed_at, now)) grouped[3].items.push(workOrder)
    } else if (workOrder.status === 'on_hold') {
      grouped[2].items.push(workOrder)
    } else if (workOrder.status === 'in_progress') {
      grouped[1].items.push(workOrder)
    } else if (workOrder.status !== 'cancelled') {
      grouped[0].items.push(workOrder)
    }
  }

  return grouped
    .map((group) => ({ ...group, items: orderWorkOrders(group.items, now, unavailableRoomIds) }))
    .filter((group) => group.items.length > 0)
}
