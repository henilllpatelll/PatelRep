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

