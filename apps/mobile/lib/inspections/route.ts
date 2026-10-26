/* ─── Where the active inspection lives, and how to get back (pure) ──────────
   ONE canonical route serves every entry point: `/(app)/inspect/[roomId]`. The room is named by its stable id (the
   number is only a label for the header while the room loads). `from` records where the supervisor came from so
   Back returns there deterministically instead of relying on the tab navigator's history; it is checked against a
   short allow-list, so a crafted link cannot send anyone elsewhere. */

export type InspectOrigin = "queue" | "board";

const ORIGINS: readonly InspectOrigin[] = ["queue", "board"];

export interface InspectHref {
  pathname: string;
  params: Record<string, string>;
}

export function inspectionHref(roomId: string, roomNumber: string | null | undefined, from: InspectOrigin = "queue"): InspectHref {
  const params: Record<string, string> = { roomId, from };
  if (roomNumber) params.roomNumber = roomNumber;
  return { pathname: "/(app)/inspect/[roomId]", params };
}

export function parseOrigin(raw: string | null | undefined): InspectOrigin {
  return ORIGINS.find((origin) => origin === raw) ?? "queue";
}

/** Where Back goes. The queue screen stays mounted, so its tab, search, filters and scroll are exactly as left. */
export function originHref(origin: InspectOrigin, roomId: string | null): { pathname: string; params?: Record<string, string> } {
  if (origin === "board" && roomId) return { pathname: "/(app)/room-board", params: { roomId } };
  return { pathname: "/(app)/inspect" };
}


/* ─── The read-only record of a finished inspection ───────────────────────────
   ONE canonical screen shows any completed inspection, by its stable inspection id: from the Done list, a correction,
   the Room Board's room history, or another inspection in the same correction cycle. `from` is only used for the
   fallback when there is nothing to go back to (a cold link); it is checked against an allow-list. */

export type RecordOrigin = "done" | "corrections" | "board" | "cycle";

const RECORD_ORIGINS: readonly RecordOrigin[] = ["done", "corrections", "board", "cycle"];

export function recordHref(inspectionId: string, from: RecordOrigin = "done", roomId?: string | null, roomNumber?: string | null): InspectHref {
  const params: Record<string, string> = { inspectionId, from };
  if (roomId) params.roomId = roomId;
  if (roomNumber) params.roomNumber = roomNumber;
  return { pathname: "/(app)/inspect/record/[inspectionId]", params };
}

export function parseRecordOrigin(raw: string | null | undefined): RecordOrigin {
  return RECORD_ORIGINS.find((origin) => origin === raw) ?? "done";
}

/** Where Back goes when the navigator has no history to pop. */
export function recordFallbackHref(origin: RecordOrigin, roomId: string | null): { pathname: string; params?: Record<string, string> } {
  if (origin === "board" && roomId) return { pathname: "/(app)/room-board", params: { roomId } };
  if (origin === "corrections") return { pathname: "/(app)/inspect", params: { tab: "corrections" } };
  return { pathname: "/(app)/inspect", params: { tab: "done" } };
}
