interface RoomTypeSource {
  room_type_code?: string | null
  rooms?: {
    room_types?: {
      code?: string | null
    } | null
  } | null
}

function cleanCode(value: string | null | undefined): string | null {
  const code = value?.trim()
  return code ? code : null
}

export function getRoomTypeCode(room: RoomTypeSource | null | undefined): string | null {
  return cleanCode(room?.room_type_code) ?? cleanCode(room?.rooms?.room_types?.code)
}
