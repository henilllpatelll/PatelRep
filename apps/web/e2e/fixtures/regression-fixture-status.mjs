export const FIXTURE_IN_PROGRESS_ROOM_NUMBER = '104'
export const FIXTURE_IN_PROGRESS_UPDATED_AT = '2020-01-01T12:58:00.000Z'

/**
 * Returns the cron-inert canonical room-status payload. Room 104 deliberately
 * carries the same old timestamp as the checked-in Linux drawer baseline: its
 * elapsed-cleaning display is therefore consistently unavailable rather than
 * drifting with each fixture reseed.
 */
export function buildRegressionFixtureRoomStatus({ roomId, tenantId, room }) {
  const status = {
    room_id: roomId,
    tenant_id: tenantId,
    status: room.status,
    vip_flag: room.vip,
    checkin_time: null,
    checkout_time: null,
    dnd_flag: false,
    do_not_service: false,
    clean_type: null,
    fo_status: null,
    assigned_to: null,
    guest_name: null,
    notes: null,
  }

  if (room.room_number === FIXTURE_IN_PROGRESS_ROOM_NUMBER) {
    status.updated_at = FIXTURE_IN_PROGRESS_UPDATED_AT
  }

  return status
}
