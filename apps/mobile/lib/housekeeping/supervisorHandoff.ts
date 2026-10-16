import AsyncStorage from "@react-native-async-storage/async-storage";
import { hotelDateKey } from "@/lib/housekeeping/hotelTime";
import { isActionable } from "@/lib/housekeeping/supervisor";
import { fetchedAtOf, knownValue, type SourceState } from "@/lib/housekeeping/supervisorSources";
import type { SupervisorToday } from "@/lib/housekeeping/supervisorToday";

/* ─── Supervisor shift handoff — the report, its rules, its draft ───────────
   Pure rules behind the four-step handoff (Prepare → Review → Confirm → Saved). No React.

   WHAT THE REPORT IS
     A DAILY HOUSEKEEPING HANDOFF for one hotel-local calendar day. It is not one employee's shift:
     the app has no verified start/end for the supervisor's own shift that matches the inspection history,
     so the reporting window is the hotel day and the screens say "today", never "your shift".

   TWO KINDS OF NUMBER, never mixed
     Snapshot   rooms ready / awaiting inspection / in progress / to clean / out of order, unassigned rooms:
                what the Room Board shows RIGHT NOW. Ready is not "passed inspections".
     Activity   inspections passed / failed / conditional: records completed during the hotel day. One room
                can appear twice (failed, then passed after a re-clean). The server re-derives these from the
                inspections table and refuses a report that no longer matches what was reviewed.

   WHAT BLOCKS SUBMITTING
     The Room Board and the inspection history are mandatory: a report built without either would show a
     fabricated zero. They must be FRESH (verified now), come from the same hotel day, and not be mid-load.
     Blocked tasks are context: if that source fails the report says "not verified" instead of "0".

   NOTHING HERE WRITES: submitting records status, it does not complete work, assign rooms, resolve blockers
   or clock anyone out. */

export const HANDOFF_NOTES_MAX = 1000;
export const HANDOFF_ROOM_LIST_MAX = 30;
/** A kept draft is dropped after this long; handoff text can name rooms and people. */
export const HANDOFF_DRAFT_TTL_MS = 36 * 60 * 60 * 1000;

export type HandoffStep = "prepare" | "review" | "confirm" | "saved";
export const HANDOFF_STEPS: readonly Exclude<HandoffStep, "saved">[] = ["prepare", "review", "confirm"];

/* ─── Source availability ─────────────────────────────────────────────────── */

export type Availability = "verified" | "stale" | "loading" | "unavailable";

/** available/empty = verified (a verified empty answer is a TRUE zero); stale = last known, not verified now. */
export function availabilityOf(state: SourceState<unknown>): Availability {
  switch (state.status) {
    case "available":
    case "empty":
      return "verified";
    case "stale":
      return "stale";
    case "loading":
      return "loading";
    default:
      return "unavailable";
  }
}

/* ─── The report ──────────────────────────────────────────────────────────── */

export interface HandoffRooms {
  total: number;
  outOfOrder: number;
  inService: number;
  ready: number;
  awaitingInspection: number;
  inProgress: number;
  toClean: number;
}

export interface HandoffInspections {
  passed: number;
  failed: number;
  conditional: number;
}

export interface HandoffUnresolved {
  unassignedRooms: number;
  unassignedRoomNumbers: string[];
  awaitingInspectionRoomNumbers: string[];
  /** Active housekeeping task blockers; null when that service could not be read (never shown as zero). */
  blockedTasks: number | null;
}

export interface HandoffReport {
  /** Hotel-local day the figures belong to; null when the sources do not agree on one. */
  reportDate: string | null;
  timeZone: string;
  /** null = unknown. A verified zero is a real value, never null. */
  rooms: HandoffRooms | null;
  inspections: HandoffInspections | null;
  unresolved: HandoffUnresolved | null;
  availability: { board: Availability; inspections: Availability; blockedTasks: Availability };
  /** The oldest verified time behind the mandatory figures (epoch ms), for "as of". */
  dataAsOf: number | null;
}

function numberedRooms(rooms: Array<{ roomNumber: string }>): string[] {
  return rooms
    .map((room) => room.roomNumber)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .slice(0, HANDOFF_ROOM_LIST_MAX);
}

/** Build the report from the shared Today snapshot. Pure: the same `today` always gives the same report. */
export function buildHandoffReport(today: SupervisorToday): HandoffReport {
  const { sources } = today;
  const availability = {
    board: availabilityOf(sources.board),
    inspections: availabilityOf(sources.inspections),
    blockedTasks: availabilityOf(sources.blockedTasks),
  };
  const boardOk = availability.board === "verified";
  const inspectionsOk = availability.inspections === "verified";
  const boardAt = fetchedAtOf(sources.board);
  const inspectionsAt = fetchedAtOf(sources.inspections);

  // Both mandatory answers must describe the same hotel day (a refresh can straddle midnight).
  const boardDay = boardAt === null ? null : hotelDateKey(new Date(boardAt), today.timeZone);
  const inspectionsDay = inspectionsAt === null ? null : hotelDateKey(new Date(inspectionsAt), today.timeZone);
  const reportDate = boardOk && inspectionsOk && boardDay !== null && boardDay === inspectionsDay ? boardDay : null;

  const readiness = boardOk ? today.readiness.value : null;
  const boardRooms = boardOk ? (knownValue(sources.board, { rooms: [], invalidRows: 0, duplicateRows: 0 })?.rooms ?? []) : [];
  const metrics = inspectionsOk ? today.inspections.value : null;

  const rooms: HandoffRooms | null = readiness
    ? {
        total: readiness.inventoryTotal,
        outOfOrder: readiness.outOfOrder,
        inService: readiness.inService,
        ready: readiness.ready,
        awaitingInspection: readiness.awaitingInspection,
        inProgress: readiness.inProgress,
        toClean: readiness.toClean,
      }
    : null;

  // Active blockers on housekeeping tasks only: another department's blocker is not this handoff's business.
  const blocked = knownValue(sources.blockedTasks, []);
  const blockedVerified = availability.blockedTasks === "verified";
  const blockedTasks = blockedVerified && blocked
    ? blocked.filter((item) => item.blocker.status === "active" && item.task.task_type === "housekeeping").length
    : null;

  const unresolved: HandoffUnresolved | null = readiness
    ? {
        unassignedRooms: readiness.unassignedActionable,
        unassignedRoomNumbers: numberedRooms(boardRooms.filter((room) => isActionable(room.status) && !room.assignedTo)),
        awaitingInspectionRoomNumbers: numberedRooms(boardRooms.filter((room) => room.status === "CLEAN")),
        blockedTasks,
      }
    : null;

  return {
    reportDate,
    timeZone: today.timeZone,
    rooms,
    inspections: metrics ? { passed: metrics.passed, failed: metrics.failed, conditional: metrics.conditional } : null,
    unresolved,
    availability,
    dataAsOf: [boardAt, inspectionsAt].filter((at): at is number => at !== null).reduce<number | null>((min, at) => (min === null ? at : Math.min(min, at)), null),
  };
}

/* ─── What blocks submitting ──────────────────────────────────────────────── */

export type HandoffBlocker = "boardLoading" | "boardUnavailable" | "boardStale" | "inspectionsLoading" | "inspectionsUnavailable" | "inspectionsStale" | "dayMismatch";

/** Why this report may not be submitted. Empty = the mandatory figures are all verified. */
export function handoffBlockers(report: HandoffReport): HandoffBlocker[] {
  const blockers: HandoffBlocker[] = [];
  const { board, inspections } = report.availability;
  if (board === "loading") blockers.push("boardLoading");
  else if (board === "unavailable") blockers.push("boardUnavailable");
  else if (board === "stale") blockers.push("boardStale");
  if (inspections === "loading") blockers.push("inspectionsLoading");
  else if (inspections === "unavailable") blockers.push("inspectionsUnavailable");
  else if (inspections === "stale") blockers.push("inspectionsStale");
  if (blockers.length === 0 && report.reportDate === null) blockers.push("dayMismatch");
  return blockers;
}


/* ─── Material changes ────────────────────────────────────────────────────── */

export type HandoffChangeKey = "rooms" | "inspections" | "unresolved" | "date";

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * What differs between the report the supervisor reviewed and the current one. Ignores timestamps and
 * freshness: only figures that change what the report SAYS count, so a routine refresh is not an alarm.
 */
export function materialChanges(reviewed: HandoffReport, current: HandoffReport): HandoffChangeKey[] {
  const changes: HandoffChangeKey[] = [];
  if (reviewed.reportDate !== current.reportDate) changes.push("date");
  if (JSON.stringify(reviewed.rooms) !== JSON.stringify(current.rooms)) changes.push("rooms");
  if (JSON.stringify(reviewed.inspections) !== JSON.stringify(current.inspections)) changes.push("inspections");
  const a = reviewed.unresolved;
  const b = current.unresolved;
  const unresolvedSame =
    a === b ||
    (a !== null &&
      b !== null &&
      a.unassignedRooms === b.unassignedRooms &&
      a.blockedTasks === b.blockedTasks &&
      sameList(a.unassignedRoomNumbers, b.unassignedRoomNumbers) &&
      sameList(a.awaitingInspectionRoomNumbers, b.awaitingInspectionRoomNumbers));
  if (!unresolvedSame) changes.push("unresolved");
  return changes;
}

/* ─── The request ─────────────────────────────────────────────────────────── */

/** POST /housekeeping/end-shift-summary (EndShiftSummaryRequest). Every field is required by the server. */
export interface EndShiftSummaryPayload {
  client_request_id: string;
  report_date: string;
  rooms: {
    total: number;
    out_of_order: number;
    ready: number;
    awaiting_inspection: number;
    in_progress: number;
    to_clean: number;
  };
  inspections: { passed: number; failed: number; conditional: number };
  unresolved: {
    unassigned_rooms: number;
    unassigned_room_numbers: string[];
    awaiting_inspection_room_numbers: string[];
    blocked_tasks: number | null;
  };
  notes: string | null;
}

/** The request for a report, or null when any mandatory figure is unverified (never a payload with made-up zeros). */
export function buildHandoffPayload(report: HandoffReport, notes: string, requestId: string): EndShiftSummaryPayload | null {
  if (handoffBlockers(report).length > 0) return null;
  const { rooms, inspections, unresolved, reportDate } = report;
  if (!rooms || !inspections || !unresolved || !reportDate) return null;
  const trimmed = notes.trim().slice(0, HANDOFF_NOTES_MAX);
  return {
    client_request_id: requestId,
    report_date: reportDate,
    rooms: {
      total: rooms.total,
      out_of_order: rooms.outOfOrder,
      ready: rooms.ready,
      awaiting_inspection: rooms.awaitingInspection,
      in_progress: rooms.inProgress,
      to_clean: rooms.toClean,
    },
    inspections: { passed: inspections.passed, failed: inspections.failed, conditional: inspections.conditional },
    unresolved: {
      unassigned_rooms: unresolved.unassignedRooms,
      unassigned_room_numbers: unresolved.unassignedRoomNumbers,
      awaiting_inspection_room_numbers: unresolved.awaitingInspectionRoomNumbers,
      blocked_tasks: unresolved.blockedTasks,
    },
    notes: trimmed === "" ? null : trimmed,
  };
}

/* ─── The answer ──────────────────────────────────────────────────────────── */

export type ManagerNotice = "complete" | "none_needed" | "failed" | "unknown";

export interface SavedHandoff {
  id: string;
  createdAt: string | null;
  reportDate: string | null;
  /** True when the server already had this report (a retry, or a report found after an unclear failure). */
  replay: boolean;
  managers: ManagerNotice;
}

/**
 * The saved report from a 200 answer, or null when the answer does not carry a record id. Success is only ever
 * shown for a non-null result: no id, no "saved".
 */
export function readSavedHandoff(response: unknown): SavedHandoff | null {
  const body = response as { data?: Record<string, unknown> | null; idempotent_replay?: unknown; notifications?: { status?: unknown } } | null;
  const data = body?.data;
  const id = typeof data?.id === "string" && data.id.trim() !== "" ? data.id : null;
  if (!id) return null;
  const status = body?.notifications?.status;
  return {
    id,
    createdAt: typeof data?.created_at === "string" ? data.created_at : null,
    reportDate: typeof data?.report_date === "string" ? data.report_date : null,
    replay: body?.idempotent_replay === true,
    managers: status === "complete" || status === "none_needed" || status === "failed" ? status : "unknown",
  };
}

/* ─── Failures ────────────────────────────────────────────────────────────── */

export type HandoffFailure =
  /** Inspection results moved since the review; carries the server's current figures. */
  | { kind: "countsChanged" }
  | { kind: "departmentMissing" }
  | { kind: "departmentAmbiguous" }
  | { kind: "dateOutOfRange" }
  | { kind: "forbidden" }
  | { kind: "signedOut" }
  /** The server answered no to something the person can fix. Nothing was stored. */
  | { kind: "rejected" }
  /** No answer (timeout, dropped connection) or a server error: the report MAY have been stored. Verify, never blindly resend. */
  | { kind: "unconfirmed" };

export function classifyHandoffFailure(error: unknown): HandoffFailure {
  const { status, code } = (error as { status?: unknown; code?: unknown } | null) ?? {};
  if (code === "inspection_counts_changed") return { kind: "countsChanged" };
  if (code === "housekeeping_department_missing") return { kind: "departmentMissing" };
  if (code === "housekeeping_department_ambiguous") return { kind: "departmentAmbiguous" };
  if (code === "report_date_out_of_range") return { kind: "dateOutOfRange" };
  if (typeof status === "number") {
    if (status === 401) return { kind: "signedOut" };
    if (status === 403) return { kind: "forbidden" };
    if (status >= 400 && status < 500) return { kind: "rejected" };
    return { kind: "unconfirmed" };
  }
  const message = error instanceof Error ? error.message : "";
  if (/not authenticated|session expired/i.test(message)) return { kind: "signedOut" };
  return { kind: "unconfirmed" };
}

/* ─── Draft ───────────────────────────────────────────────────────────────── */

/**
 * What survives leaving the sheet: the note, the idempotency key, and whether a submit was started whose outcome
 * is not known. Figures are NEVER kept — they are always rebuilt from fresh data.
 */
export interface HandoffDraft {
  notes: string;
  requestId: string;
  /** A submit was sent and no answer was seen. The next open checks the server before offering Submit again. */
  attempted: boolean;
  savedAt: number;
}

const draftKey = (scope: string) => `@patelrep/mobile/supervisor-handoff-draft:${scope}`;

export function newHandoffRequestId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  // Version-4 UUID without Web Crypto (older Hermes). The server only needs a well-formed, unique value.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    return (char === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

export function parseHandoffDraft(raw: string | null, now: number): HandoffDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<HandoffDraft>;
    if (typeof parsed.requestId !== "string" || typeof parsed.notes !== "string" || typeof parsed.savedAt !== "number") return null;
    if (now - parsed.savedAt > HANDOFF_DRAFT_TTL_MS || parsed.savedAt > now + 60_000) return null;
    return {
      notes: parsed.notes.slice(0, HANDOFF_NOTES_MAX),
      requestId: parsed.requestId,
      attempted: parsed.attempted === true,
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

/** Worth keeping or warning about: the person wrote a note, or a submit's outcome is still unknown. */
export function isMeaningfulHandoffDraft(draft: Pick<HandoffDraft, "notes" | "attempted">): boolean {
  return draft.notes.trim().length > 0 || draft.attempted;
}

export async function loadHandoffDraft(scope: string, now: number = Date.now()): Promise<HandoffDraft | null> {
  try {
    return parseHandoffDraft(await AsyncStorage.getItem(draftKey(scope)), now);
  } catch {
    return null;
  }
}

export async function saveHandoffDraft(scope: string, draft: HandoffDraft): Promise<void> {
  try {
    if (!isMeaningfulHandoffDraft(draft)) await AsyncStorage.removeItem(draftKey(scope));
    else await AsyncStorage.setItem(draftKey(scope), JSON.stringify(draft));
  } catch {
    // Storage unavailable: the sheet still works for this visit.
  }
}

export async function clearHandoffDraft(scope: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(draftKey(scope));
  } catch {
    // nothing to clear
  }
}
