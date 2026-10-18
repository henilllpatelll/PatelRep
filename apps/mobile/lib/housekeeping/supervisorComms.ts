import { isActionable, type AssignableStaff, type FloorRoom } from "@/lib/housekeeping/supervisor";
import type { StaffAvailability, StaffPulseMember } from "@/lib/housekeeping/supervisorTeam";

/* ─── Supervisor Today — notes, messages and the staff quick view ───────────
   Pure rules behind the four Phase 4 drawers. No React, no I/O.

   WHAT EACH SEND REALLY DOES (so the words on screen never claim more)
     Shift note     POST /logbook/entries     one informational logbook entry in the Housekeeping department.
     Team message   POST /notifications/broadcast   one INBOX row per active account holding a listed role.
                    It says nothing about who is clocked in, whether a push arrived or whether anyone read it.
     Direct message POST /notifications/direct      one inbox row for one active person in this hotel.
   None of these endpoints takes an idempotency key, so a request whose answer never arrived is "unconfirmed":
   it may have been stored. The drawers keep the draft and ask the person to decide, never retry on their own. */

/** CreateLogbookEntryRequest.content max. */
export const SHIFT_NOTE_MAX = 4000;
/** Inbox messages. The server allows 1000; the app asks for less so a notification stays readable. */
export const MESSAGE_MAX = 500;
/** The audience of a team message: housekeeper accounts, explicitly — not the supervisors who send them. */
export const TEAM_MESSAGE_ROLES = ["housekeeper"] as const;

/* ─── Housekeeping department ─────────────────────────────────────────────── */

export interface DepartmentRow {
  id?: string | null;
  name?: string | null;
  code?: string | null;
}

export type DepartmentResolution =
  | { status: "ok"; departmentId: string }
  /** The hotel has no department that is clearly Housekeeping. */
  | { status: "missing" }
  /** More than one department looks like Housekeeping; guessing could file the note under the wrong team. */
  | { status: "ambiguous" };

/**
 * The hotel's Housekeeping department from GET /hotels/{id}/departments: the one whose code is `HK` or whose
 * name is exactly "Housekeeping". Never falls back to "some other department".
 */
export function resolveHousekeepingDepartment(rows: DepartmentRow[] | null | undefined): DepartmentResolution {
  const ids = new Set<string>();
  for (const row of rows ?? []) {
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id) continue;
    const code = row.code?.trim().toUpperCase();
    const name = row.name?.trim().toLowerCase();
    if (code === "HK" || name === "housekeeping") ids.add(id);
  }
  if (ids.size === 0) return { status: "missing" };
  if (ids.size > 1) return { status: "ambiguous" };
  return { status: "ok", departmentId: [...ids][0] };
}

/** An ordinary note: informational (never an open follow-up), normal priority, general category. */
export function buildShiftNotePayload(departmentId: string, content: string) {
  return {
    department_id: departmentId,
    content: content.trim(),
    category: "general" as const,
    status: "informational" as const,
    priority: "normal" as const,
  };
}

/* ─── Failures ────────────────────────────────────────────────────────────── */

export type SendFailureKind =
  /** The server answered no (4xx). Nothing was stored; fixing the input and retrying is safe. */
  | "rejected"
  /** The person is no longer allowed to do this. */
  | "forbidden"
  /** The session ended. */
  | "signedOut"
  /** No answer (timeout, dropped connection) or a server error: it MAY have been stored. */
  | "unconfirmed";

/** Classify without `instanceof`: it must work when a test mocks the client module. */
export function classifySendFailure(error: unknown): SendFailureKind {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === "number") {
    if (status === 401) return "signedOut";
    if (status === 403) return "forbidden";
    if (status >= 400 && status < 500) return "rejected";
    return "unconfirmed";
  }
  const message = error instanceof Error ? error.message : "";
  if (/not authenticated|session expired/i.test(message)) return "signedOut";
  return "unconfirmed";
}

/* ─── Team message result ─────────────────────────────────────────────────── */

export type BroadcastOutcome =
  | { kind: "delivered"; count: number }
  /** The server answered but there was nobody to write an inbox row for. Nothing was sent. */
  | { kind: "nobody" }
  /** The answer was not the documented shape; do not claim any number. */
  | { kind: "unknown" };

/** POST /notifications/broadcast → `{ data: { sent } }`. */
export function readBroadcastResult(response: unknown): BroadcastOutcome {
  const sent = (response as { data?: { sent?: unknown } } | null)?.data?.sent;
  if (typeof sent !== "number" || !Number.isInteger(sent) || sent < 0) return { kind: "unknown" };
  return sent === 0 ? { kind: "nobody" } : { kind: "delivered", count: sent };
}

/* ─── Drafts ──────────────────────────────────────────────────────────────── */

export function isMeaningfulDraft(text: string): boolean {
  return text.trim().length > 0;
}

export function draftLength(text: string): number {
  return text.trim().length;
}

/* ─── Staff list ──────────────────────────────────────────────────────────── */

/** Case- and accent-insensitive "contains" on the name. An empty query matches everyone. */
export function matchesName(name: string | null | undefined, query: string): boolean {
  const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const q = fold(query);
  if (!q) return true;
  return fold(name ?? "").includes(q);
}

/** Staff a supervisor may message: the authorized staff list, except themself, filtered by name. */
export function filterStaff(staff: AssignableStaff[], viewerId: string | null | undefined, query: string): AssignableStaff[] {
  return staff.filter((member) => member.userId !== viewerId && matchesName(member.name, query));
}

/** Translation key for a person's availability. Unknown is said out loud, never shown as "off shift". */
export function availabilityKey(availability: StaffAvailability | null | undefined): string {
  switch (availability) {
    case "on_shift":
      return "supervisorToday.team.statusOnShift";
    case "on_break":
      return "supervisorToday.team.statusOnBreak";
    case "ended":
      return "supervisorToday.team.statusEnded";
    case "not_clocked_in":
      return "supervisorToday.team.statusNotClockedIn";
    default:
      return "supervisorComms.quick.statusUnknown";
  }
}

/** Translation key for a role we have a label for; null otherwise (show nothing rather than a raw code). */
export function roleKey(role: string | null | undefined): string | null {
  return role === "housekeeper" || role === "housekeeping_supervisor" ? `supervisorComms.quick.roles.${role}` : null;
}

/* ─── Staff quick view ────────────────────────────────────────────────────── */

export const QUICK_VIEW_ROOM_LIMIT = 5;

export interface QuickViewRoom {
  roomId: string;
  roomNumber: string;
  status: string;
  vip: boolean;
  dnd: boolean;
}

export interface StaffQuickView {
  userId: string;
  name: string | null;
  role: string | null;
  availability: StaffAvailability;
  /** Rooms assigned to them today (assignment is not attendance). */
  assigned: number;
  /** Cleaning submitted OR already inspected. Not the same as guest-ready. */
  cleaned: number;
  /** Of `cleaned`, rooms that passed inspection (status INSPECTED). */
  inspected: number;
  /** Of `cleaned`, rooms still waiting for an inspector (status CLEAN). */
  awaitingInspection: number;
  /** Assigned rooms that still need housekeeping (to clean or being cleaned). */
  remaining: number;
  inProgress: number;
  /** Up to QUICK_VIEW_ROOM_LIMIT remaining rooms, being-cleaned first, then by room number. */
  remainingRooms: QuickViewRoom[];
  /** Remaining rooms beyond the preview. */
  hiddenRemaining: number;
}

function byRoomNumber(a: FloorRoom, b: FloorRoom): number {
  return a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true });
}

/** What the drawer shows for one person, from the same pulse member the Team Pulse card uses. */
export function buildStaffQuickView(member: StaffPulseMember): StaffQuickView {
  const rooms = member.load?.rooms ?? [];
  const inspected = rooms.filter((room) => room.status === "INSPECTED").length;
  const awaitingInspection = rooms.filter((room) => room.status === "CLEAN").length;
  const open = rooms.filter((room) => isActionable(room.status));
  const ordered = [...open].sort((a, b) => {
    const aw = a.status === "IN_PROGRESS" ? 0 : 1;
    const bw = b.status === "IN_PROGRESS" ? 0 : 1;
    return aw - bw || byRoomNumber(a, b);
  });
  return {
    userId: member.userId,
    name: member.name,
    role: member.role,
    availability: member.availability,
    assigned: rooms.length,
    cleaned: inspected + awaitingInspection,
    inspected,
    awaitingInspection,
    remaining: open.length,
    inProgress: open.filter((room) => room.status === "IN_PROGRESS").length,
    remainingRooms: ordered.slice(0, QUICK_VIEW_ROOM_LIMIT).map((room) => ({
      roomId: room.roomId,
      roomNumber: room.roomNumber,
      status: room.status,
      vip: room.vip,
      dnd: room.dnd,
    })),
    hiddenRemaining: Math.max(0, open.length - QUICK_VIEW_ROOM_LIMIT),
  };
}
