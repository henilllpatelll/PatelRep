/* ─── Assignments deep-link contract ────────────────────────────────────────
   What other supervisor screens (Today, the Attention Center, the Room Board) may ask the Assignments screen to
   open, and the only shape in which it reads those requests back.

     tab      "rooms" | "team"            which tab to show (default rooms)
     filter   "unassigned" | "urgent"     a Rooms-tab view; ignored on the Team tab and when a room is named
     roomId   a room                      opens that room's sheet (Rooms tab)
     staffId  a person                    opens that person's drawer (Team tab)

   Parameters are INTENT, never authority. The screen re-resolves every id against its own tenant-scoped,
   verified model and shows a safe message when the record is not in this hotel's data — a link can never open
   another property's room or person, and it never switches the selected hotel. Unknown or malformed values are
   dropped, not guessed at. */

export type AssignmentsTabParam = "rooms" | "team";
export type AssignmentsFilterParam = "unassigned" | "urgent";

export interface AssignmentsLink {
  tab: AssignmentsTabParam;
  filter: AssignmentsFilterParam | null;
  roomId: string | null;
  staffId: string | null;
}

/** What a caller may ask for. Everything is optional; an empty intent opens the screen as it is. */
export interface AssignmentsIntent {
  tab?: AssignmentsTabParam;
  filter?: AssignmentsFilterParam;
  roomId?: string | null;
  staffId?: string | null;
}

/** Ids are opaque (UUID-like). Anything else is refused rather than passed on to a lookup or a message. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function safeLinkId(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first !== "string") return null;
  const id = first.trim();
  return ID_PATTERN.test(id) ? id : null;
}

function single(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" ? first.trim() : null;
}

/** The route params for an intent. Empty when the intent asks for nothing. */
export function assignmentsParams(intent: AssignmentsIntent): Record<string, string> {
  const params: Record<string, string> = {};
  const roomId = safeLinkId(intent.roomId);
  const staffId = safeLinkId(intent.staffId);
  if (roomId) {
    params.roomId = roomId;
    return params;
  }
  if (staffId) {
    params.staffId = staffId;
    return params;
  }
  if (intent.tab === "team") params.tab = "team";
  else if (intent.filter === "unassigned" || intent.filter === "urgent") {
    params.tab = "rooms";
    params.filter = intent.filter;
  }
  return params;
}

/**
 * Reads the screen's route params back into one validated request, or null when they ask for nothing.
 * A room wins over a person (a link names one record); a person implies the Team tab; a room implies Rooms.
 */
export function parseAssignmentsParams(raw: Record<string, unknown> | null | undefined): AssignmentsLink | null {
  if (!raw) return null;
  const roomId = safeLinkId(raw.roomId);
  const staffId = safeLinkId(raw.staffId);
  const tabRaw = single(raw.tab);
  const filterRaw = single(raw.filter);
  const filter: AssignmentsFilterParam | null = filterRaw === "unassigned" || filterRaw === "urgent" ? filterRaw : null;
  const requestedTab: AssignmentsTabParam | null = tabRaw === "rooms" || tabRaw === "team" ? tabRaw : null;

  if (roomId) return { tab: "rooms", filter: null, roomId, staffId: null };
  if (staffId) return { tab: "team", filter: null, roomId: null, staffId };
  if (!requestedTab && !filter) return null;
  const tab: AssignmentsTabParam = requestedTab ?? "rooms";
  return { tab, filter: tab === "rooms" ? filter : null, roomId: null, staffId: null };
}

/** True when a link carries a record that must be looked up before it can be honoured. */
export function linkNamesRecord(link: AssignmentsLink): boolean {
  return link.roomId !== null || link.staffId !== null;
}

export type LinkTargetState = "found" | "missing";

export interface LinkResolution {
  room: LinkTargetState | null;
  staff: LinkTargetState | null;
}

/**
 * Judges a link's record against the hotel's verified data. `roomIds` / `staffIds` are the ids in the current
 * tenant-scoped model; an id outside them (another hotel, removed, never existed) is "missing" and opens nothing.
 */
export function resolveAssignmentsLink(link: AssignmentsLink, roomIds: ReadonlySet<string>, staffIds: ReadonlySet<string>): LinkResolution {
  return {
    room: link.roomId === null ? null : roomIds.has(link.roomId) ? "found" : "missing",
    staff: link.staffId === null ? null : staffIds.has(link.staffId) ? "found" : "missing",
  };
}
