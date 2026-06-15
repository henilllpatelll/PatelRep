import type { LateCheckoutRequest } from '@/lib/api/lateCheckout'

export type RoomWithLateCheckout<T extends { room_id?: string }> = T & {
  late_checkout_request?: LateCheckoutRequest
  late_checkout_requested_time?: string
}

export function getPendingLateCheckoutByRoom(
  requests: LateCheckoutRequest[],
): Record<string, LateCheckoutRequest> {
  return requests.reduce<Record<string, LateCheckoutRequest>>((acc, request) => {
    if (request.status !== 'pending' || !request.room_id) return acc

    const existing = acc[request.room_id]
    if (!existing || new Date(request.created_at).getTime() > new Date(existing.created_at).getTime()) {
      acc[request.room_id] = request
    }

    return acc
  }, {})
}

export function withPendingLateCheckout<T extends { room_id?: string }>(
  room: T,
  requestsByRoom: Record<string, LateCheckoutRequest>,
): RoomWithLateCheckout<T> {
  const request = room.room_id ? requestsByRoom[room.room_id] : undefined
  if (!request) {
    const { late_checkout_request: _request, late_checkout_requested_time: _time, ...rest } =
      room as RoomWithLateCheckout<T>
    return rest as RoomWithLateCheckout<T>
  }

  return {
    ...room,
    late_checkout_request: request,
    late_checkout_requested_time: request.requested_time,
  }
}
