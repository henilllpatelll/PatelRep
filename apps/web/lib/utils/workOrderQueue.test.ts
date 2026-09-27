import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkOrder } from '@/lib/api/engineering'
import { groupWorkOrderQueue, rankWorkOrder } from './workOrderQueue'

const now = new Date('2026-09-26T18:00:00.000Z')

function workOrder(overrides: Partial<WorkOrder>): WorkOrder {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    work_order_number: 1,
    title: 'Test order',
    category: 'hvac',
    priority: 'normal',
    status: 'open',
    created_by: 'creator',
    is_ai_created: false,
    is_pm_generated: false,
    guest_reported: false,
    sla_minutes: 60,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    ...overrides,
  }
}

test('ranks emergencies before every other operational exception', () => {
  const emergency = workOrder({ id: 'emergency', priority: 'emergency' })
  const overdue = workOrder({ id: 'overdue', priority: 'urgent', due_at: '2026-09-26T17:00:00.000Z' })

  assert.ok(rankWorkOrder(emergency, now) < rankWorkOrder(overdue, now))
})

test('groups active work into attention, progress, waiting, and collapsed completion', () => {
  const groups = groupWorkOrderQueue([
    workOrder({ id: 'overdue', due_at: '2026-09-26T17:00:00.000Z' }),
    workOrder({ id: 'progress', status: 'in_progress' }),
    workOrder({ id: 'waiting', status: 'on_hold' }),
    workOrder({ id: 'complete', status: 'completed', completed_at: '2026-09-26T17:30:00.000Z' }),
  ], now)

  assert.deepEqual(groups.map((group) => [group.key, group.items.map((item) => item.id)]), [
    ['attention', ['overdue']],
    ['in_progress', ['progress']],
    ['waiting', ['waiting']],
    ['completed', ['complete']],
  ])
})
