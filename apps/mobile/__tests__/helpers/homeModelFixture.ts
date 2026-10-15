import type { Room } from "@/stores/appStore";
import type { LocalCleanSession } from "@/lib/housekeeping/cleanSession";
import { buildHomeModel, type HomeBoardInput, type HomeModelInput } from "@/lib/housekeeping/homeModel";
import { resolveShiftLifecycle, type ShiftLifecycleInput } from "@/lib/housekeeping/shiftLifecycle";
import type { ShiftSession } from "@/lib/api/shifts";
import type { SyncRow } from "@/lib/housekeeping/syncDetails";

/** Shared fixtures for tests that need a real HomeModel (no mocks: the same pure builder the app uses). */

export const NOW = new Date("2026-10-14T15:00:00.000Z");
export const TODAY = "2026-10-14";
export const ZONE = "America/Chicago";

export function room(id: string, overrides: Partial<Room> = {}): Room {
  return {
    id,
    room_number: id.replace(/\D/g, "") || id,
    floor: 2,
    status: "DIRTY",
    risk_level: null,
    dnd_flag: false,
    guest_name: null,
    predicted_ready_at: null,
    vip_flag: false,
    checkin_time: null,
    actual_checkout_at: "2026-10-14T12:00:00.000Z",
    clean_type: "DEP",
    clean_type_label: "Departure",
    assignment_date: TODAY,
    ...overrides,
  };
}

export function session(roomId: string, overrides: Partial<LocalCleanSession> = {}): LocalCleanSession {
  return {
    roomId,
    sessionId: `s-${roomId}`,
    cleanType: "DEP",
    startedAt: "2026-10-14T14:42:00.000Z",
    entryAcknowledged: true,
    checklist: [
      { item_id: "a", section: "Bed", label: "Make bed", is_required: true, checked: true, checked_at: null },
      { item_id: "b", section: "Bath", label: "Bathroom", is_required: true, checked: false, checked_at: null },
    ],
    provisional: false,
    startConfirmed: true,
    pendingItems: {},
    completeRequestedAt: null,
    completionConfirmed: false,
    endedAt: null,
    durationSeconds: null,
    conflict: null,
    lastError: null,
    updatedAt: "2026-10-14T14:50:00.000Z",
    ...overrides,
  };
}

function shiftRow(overrides: Partial<ShiftSession> = {}): ShiftSession {
  return {
    id: "shift-1",
    status: "active",
    started_at: "2026-10-14T13:00:00.000Z",
    ended_at: null,
    on_break_since: null,
    break_seconds: 0,
    ...overrides,
  } as ShiftSession;
}

export function lifecycleFor(kind: "not_started" | "active" | "on_break" | "ended" | "unknown", extra: Partial<ShiftLifecycleInput> = {}) {
  const base: ShiftLifecycleInput = {
    current: null,
    lastEnded: null,
    serverConfirmed: kind !== "unknown",
    lastFetchFailed: false,
    pendingOp: null,
    shiftDate: TODAY,
    timeZone: ZONE,
    isOnline: true,
  };
  if (kind === "active") base.current = shiftRow();
  if (kind === "on_break") base.current = shiftRow({ status: "on_break", on_break_since: "2026-10-14T14:30:00.000Z" });
  if (kind === "ended") base.lastEnded = shiftRow({ status: "ended", ended_at: "2026-10-14T14:55:00.000Z" });
  return resolveShiftLifecycle({ ...base, ...extra });
}

export const readyBoard: HomeBoardInput = {
  loading: false,
  refreshing: false,
  confirmedEmpty: false,
  freshness: "fresh",
  fetchError: null,
  usingCache: false,
  lastRefreshAt: NOW.getTime() - 30_000,
  serverShiftDate: TODAY,
  answeredForDate: TODAY,
};

export function build(
  rooms: Room[],
  opts: {
    shift?: Parameters<typeof lifecycleFor>[0];
    sessions?: Record<string, LocalCleanSession>;
    board?: Partial<HomeBoardInput>;
    online?: boolean;
    syncRows?: SyncRow[];
    note?: HomeModelInput["supervisorNote"];
    now?: Date;
  } = {},
) {
  const online = opts.online ?? true;
  const now = opts.now ?? NOW;
  return buildHomeModel({
    rooms,
    sessions: opts.sessions ?? {},
    rankedAt: now,
    now,
    expectedShiftDate: TODAY,
    timeZone: ZONE,
    isOnline: online,
    board: { ...readyBoard, ...opts.board },
    lifecycle: lifecycleFor(opts.shift ?? "active", { isOnline: online }),
    syncRows: opts.syncRows ?? [],
    syncRowsComplete: true,
    supervisorNote: opts.note ?? null,
  });
}
