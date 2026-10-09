/**
 * Tiny registry that lets the generic offline queue (appStore) and the
 * clean-session store cooperate without importing each other.
 *
 * - Rooms whose clean lifecycle is owned by a persistent clean session must not
 *   also replay a legacy `room_status` queue entry (that would transition the
 *   room twice).
 * - Reconnecting must flush the session queue first.
 */
let managedRooms: ReadonlySet<string> = new Set();
let flushHook: (() => Promise<void>) | null = null;

export function setManagedRooms(roomIds: Iterable<string>): void {
  managedRooms = new Set(roomIds);
}

export function isRoomManagedBySession(roomId: string): boolean {
  return managedRooms.has(roomId);
}

export function registerSessionFlush(hook: (() => Promise<void>) | null): void {
  flushHook = hook;
}

export async function flushSessions(): Promise<void> {
  if (flushHook) await flushHook();
}
