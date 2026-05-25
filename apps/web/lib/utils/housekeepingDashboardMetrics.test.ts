import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getHousekeeperDashboardMetrics,
  getHousekeeperDashboardRooms,
  getSupervisorHousekeepingMetrics,
} from './housekeepingDashboardMetrics'

test('uses live board rows instead of stale zero report summaries', () => {
  const metrics = getSupervisorHousekeepingMetrics(
    {
      data: [
        { status: 'DIRTY', assigned_to: 'hk-1' },
        { status: 'CLEAN', assigned_to: 'hk-1' },
        { status: 'INSPECTED', assigned_to: 'hk-2' },
        { status: 'PICKUP', assigned_to: null },
      ],
    },
    { DIRTY: 0, CLEAN: 0, INSPECTED: 0 },
  )

  assert.deepEqual(metrics, {
    totalRooms: 4,
    remaining: 2,
    done: 1,
    inspectNow: 1,
    assignedTotal: 3,
    inspected: 1,
    cleanPending: 1,
    inspectedPct: 33,
  })
})

test('falls back to report breakdown before board data loads', () => {
  const metrics = getSupervisorHousekeepingMetrics(undefined, {
    DIRTY: 5,
    CLEAN: 2,
    INSPECTED: 3,
  })

  assert.deepEqual(metrics, {
    totalRooms: 10,
    remaining: 0,
    done: 3,
    inspectNow: 2,
    assignedTotal: 0,
    inspected: 3,
    cleanPending: 2,
    inspectedPct: 0,
  })
})

test('housekeeper dashboard uses authoritative my-rooms rows for regular housekeepers', () => {
  const rooms = getHousekeeperDashboardRooms(
    {
      data: [
        { room_id: 'clean', status: 'CLEAN', assigned_to: 'claudia' },
        { room_id: 'dirty', status: 'DIRTY', assigned_to: 'claudia' },
      ],
    },
    {
      data: [
        { room_id: 'wrong-user', status: 'INSPECTED', assigned_to: 'elisa' },
      ],
    },
    'claudia',
  )

  assert.deepEqual(rooms.map((room) => room.room_id), ['dirty', 'clean'])
  assert.deepEqual(getHousekeeperDashboardMetrics(rooms), {
    totalRooms: 2,
    remaining: 1,
    done: 0,
    inspectNow: 1,
  })
})

test('housekeeper dashboard falls back to board rows when my-rooms is empty or unavailable', () => {
  const rooms = getHousekeeperDashboardRooms(
    { data: [] },
    {
      data: [
        { room_id: 'elisa-room', status: 'PICKUP', assigned_to: 'elisa' },
        { room_id: 'claudia-room', status: 'DIRTY', assigned_to: 'claudia' },
        { room_id: 'elisa-done', status: 'INSPECTED', assigned_to: 'elisa' },
      ],
    },
    'elisa',
  )

  assert.deepEqual(rooms.map((room) => room.room_id), ['elisa-room', 'elisa-done'])
  assert.deepEqual(getHousekeeperDashboardMetrics(rooms), {
    totalRooms: 2,
    remaining: 1,
    done: 1,
    inspectNow: 0,
  })
})
