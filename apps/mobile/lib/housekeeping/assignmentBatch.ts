import type { BatchChangeInput, BatchPublishRequest } from "@/lib/api/housekeepingSupervisor";
import type { SoftBlock } from "@/lib/housekeeping/assignmentEligibility";
import { expectedOwnerId } from "@/lib/housekeeping/assignmentOwnership";
import type { PlannedChange } from "@/lib/housekeeping/assignmentPlan";

/* ─── Supervisor Assignments — atomic batch publication contract ─────────────
   Pure. Everything between a reviewed set of `PlannedChange`s and the server's all-or-nothing endpoint
   (POST /housekeeping/assignments/batch-publish, apps/api + migration 221):

     toBatchRequest      the wire body, refused here if it could not be sent honestly
     parseBatchPublication   a STRICT reading of a committed answer (anything else is not "published")
     classifyBatchFailure    what a thrown error PROVES: not applied, or unknown
     readBatchCheck          the read-only "did it commit?" answer

   This is separate from the legacy `toSaveRequests` / `saveAssignments` path, which is NOT atomic and says so
   (`PublicationSummary.atomic` is the literal `false`). THIS path is atomic because the SERVER runs one database
   transaction — the app cannot make anything atomic by itself, so it only ever reports what the server proved.

   THE RULE THAT MATTERS: only an answer from the server proves the outcome.
     200 committed         → published (and only if the answer matches what was asked)
     4xx, or a 500 that says `applied: false`   → the database refused and rolled back: NOTHING was written
     no answer, a timeout, a gateway 5xx      → UNKNOWN: read the result back with the SAME operation id, never
                                                publish a different operation for the same draft. */

/** The most changes one publication may carry. Mirrors MAX_BATCH_PUBLISH_CHANGES (API) and the database function. */
export const MAX_BATCH_CHANGES = 150;

/* ─── Request ─────────────────────────────────────────────────────────────── */

export type BatchRequestRefusal =
  | "empty"
  | "too_many"
  /** The batch endpoint never carries an acknowledgement: a soft-blocked room cannot be published in bulk. */
  | "acknowledgement_not_allowed"
  | "duplicate_room"
  | "inconsistent_change";

export type BatchRequestResult = { ok: true; request: BatchPublishRequest } | { ok: false; refusal: BatchRequestRefusal; roomId?: string };

function wireChange(change: PlannedChange): BatchChangeInput | null {
  const expected = expectedOwnerId(change.expected);
  if (expected !== change.fromUserId) return null;
  if (change.kind === "assign") {
    return change.fromUserId === null && change.toUserId !== null ? { room_id: change.roomId, kind: "assign", housekeeper_id: change.toUserId, expect_unassigned: true } : null;
  }
  if (change.kind === "reassign") {
    return change.fromUserId !== null && change.toUserId !== null && change.fromUserId !== change.toUserId
      ? { room_id: change.roomId, kind: "reassign", housekeeper_id: change.toUserId, expected_assigned_to: change.fromUserId }
      : null;
  }
  return change.fromUserId !== null && change.toUserId === null ? { room_id: change.roomId, kind: "remove", expected_assigned_to: change.fromUserId } : null;
}

/**
 * The body for one publication. Changes are sent in room order so a retry of the same draft is byte-identical, and
 * every change carries the owner the supervisor SAW. Anything the server would have to guess about is refused here.
 */
export function toBatchRequest(operationId: string, hotelDate: string, changes: readonly PlannedChange[]): BatchRequestResult {
  if (changes.length === 0) return { ok: false, refusal: "empty" };
  if (changes.length > MAX_BATCH_CHANGES) return { ok: false, refusal: "too_many" };
  const seen = new Set<string>();
  const wire: BatchChangeInput[] = [];
  for (const change of [...changes].sort((a, b) => a.roomId.localeCompare(b.roomId))) {
    if (seen.has(change.roomId)) return { ok: false, refusal: "duplicate_room", roomId: change.roomId };
    seen.add(change.roomId);
    if (change.acknowledged.length > 0) return { ok: false, refusal: "acknowledgement_not_allowed", roomId: change.roomId };
    const item = wireChange(change);
    if (!item) return { ok: false, refusal: "inconsistent_change", roomId: change.roomId };
    wire.push(item);
  }
  return { ok: true, request: { operation_id: operationId, date: hotelDate, changes: wire } };
}

/* ─── Committed result ────────────────────────────────────────────────────── */

export interface PublishedRoom {
  roomId: string;
  roomNumber: string | null;
  kind: "assign" | "reassign" | "remove";
  previousAssignedTo: string | null;
  assignedTo: string | null;
}

export interface BatchPublication {
  operationId: string;
  assignmentDate: string;
  /** The server had already committed this operation; this answer is the stored original. */
  replayed: boolean;
  counts: { total: number; assign: number; reassign: number; remove: number };
  rooms: PublishedRoom[];
  affectedRoomIds: string[];
  affectedHousekeeperIds: string[];
}

const KINDS = ["assign", "reassign", "remove"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);
const count = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null);

/**
 * Reads a committed answer strictly: every figure the success screen shows must be present and agree with the
 * others. Anything else returns null — the caller then treats the outcome as UNVERIFIED, never as published.
 */
export function parseBatchPublication(raw: unknown, expectedOperationId?: string): BatchPublication | null {
  if (!isRecord(raw) || raw.status !== "committed") return null;
  const operationId = text(raw.operation_id);
  const assignmentDate = text(raw.assignment_date);
  if (!operationId || !assignmentDate) return null;
  if (expectedOperationId !== undefined && operationId !== expectedOperationId) return null;
  if (!isRecord(raw.counts) || !Array.isArray(raw.rooms)) return null;
  const rooms: PublishedRoom[] = [];
  for (const row of raw.rooms) {
    if (!isRecord(row)) return null;
    const roomId = text(row.room_id);
    const kind = KINDS.find((candidate) => candidate === row.kind);
    if (!roomId || !kind) return null;
    rooms.push({ roomId, roomNumber: text(row.room_number), kind, previousAssignedTo: text(row.previous_assigned_to), assignedTo: text(row.assigned_to) });
  }
  const counts = { total: count(raw.counts.total), assign: count(raw.counts.assign), reassign: count(raw.counts.reassign), remove: count(raw.counts.remove) };
  if (counts.total === null || counts.assign === null || counts.reassign === null || counts.remove === null) return null;
  const total = rooms.length;
  if (counts.total !== total || counts.assign + counts.reassign + counts.remove !== total || total === 0) return null;
  for (const kind of KINDS) if (rooms.filter((room) => room.kind === kind).length !== counts[kind]) return null;
  const ids = (value: unknown): string[] | null => (Array.isArray(value) && value.every((entry) => typeof entry === "string") ? (value as string[]) : null);
  const affectedRoomIds = ids(raw.affected_room_ids);
  const affectedHousekeeperIds = ids(raw.affected_housekeeper_ids);
  if (!affectedRoomIds || !affectedHousekeeperIds) return null;
  return {
    operationId,
    assignmentDate,
    replayed: raw.replayed === true,
    counts: { total, assign: counts.assign, reassign: counts.reassign, remove: counts.remove },
    rooms,
    affectedRoomIds,
    affectedHousekeeperIds,
  };
}

/**
 * Whether a committed answer is the one that was asked for: the same set of rooms, each with the intended kind and
 * owner. A mismatch (another operation's answer, a server bug) must never be shown as "your changes were published".
 */
export function matchesRequest(publication: BatchPublication, changes: readonly PlannedChange[]): boolean {
  if (publication.rooms.length !== changes.length) return false;
  const byRoom = new Map(publication.rooms.map((room) => [room.roomId, room] as const));
  return changes.every((change) => {
    const room = byRoom.get(change.roomId);
    return room !== undefined && room.kind === change.kind && room.assignedTo === change.toUserId && room.previousAssignedTo === change.fromUserId;
  });
}

/* ─── Failures ────────────────────────────────────────────────────────────── */

export type BatchConflictCode = "assignment_changed" | "room_not_assignable" | "room_blocked" | "room_not_found" | "invalid_housekeeper";

export interface BatchConflict {
  roomId: string;
  roomNumber: string | null;
  code: BatchConflictCode;
  /** The owner now, when the room's owner is what changed (null = unassigned). undefined = not reported. */
  currentOwnerId: string | null | undefined;
  blocks: SoftBlock[];
}

export type NotAppliedReason = "conflict" | "invalid_request" | "forbidden" | "date_changed" | "operation_reused" | "database" | "session" | "unavailable";

export type BatchFailure = { kind: "not_applied"; reason: NotAppliedReason; conflicts: BatchConflict[] } | { kind: "unknown" };

interface ErrorLike {
  status?: unknown;
  code?: unknown;
  message?: unknown;
  detail?: unknown;
}

const CONFLICT_CODES: readonly BatchConflictCode[] = ["assignment_changed", "room_not_assignable", "room_blocked", "room_not_found", "invalid_housekeeper"];
const SOFT_BLOCKS: readonly SoftBlock[] = ["service_declined", "return_later", "dnd", "occupancy_discrepancy"];

function readConflicts(detail: unknown): BatchConflict[] {
  const rows = isRecord(detail) && Array.isArray(detail.conflicts) ? detail.conflicts : [];
  const conflicts: BatchConflict[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const roomId = text(row.room_id);
    const code = CONFLICT_CODES.find((candidate) => candidate === row.code);
    if (!roomId || !code) continue;
    conflicts.push({
      roomId,
      roomNumber: text(row.room_number),
      code,
      currentOwnerId: "current_assigned_to" in row ? text(row.current_assigned_to) : undefined,
      blocks: Array.isArray(row.blocks) ? row.blocks.filter((block): block is SoftBlock => SOFT_BLOCKS.includes(block as SoftBlock)) : [],
    });
  }
  return conflicts;
}

const notApplied = (reason: NotAppliedReason, conflicts: BatchConflict[] = []): BatchFailure => ({ kind: "not_applied", reason, conflicts });

/** What a thrown publication error PROVES. See the module header. */
export function classifyBatchFailure(error: unknown): BatchFailure {
  const info = (error as ErrorLike | null) ?? null;
  const status = typeof info?.status === "number" ? info.status : null;
  const detail = info?.detail;
  const code = (isRecord(detail) && typeof detail.code === "string" ? detail.code : null) ?? (typeof info?.code === "string" ? info.code : null);
  const message = typeof info?.message === "string" ? info.message : "";

  if (status === null) {
    // Thrown before anything was sent (the session could not be refreshed): definitely not applied.
    if (/session expired/i.test(message) || info?.code === "session_expired") return notApplied("session");
    return { kind: "unknown" };
  }
  if (status === 401 || status === 403) return notApplied("forbidden");
  if (status === 409) {
    if (code === "operation_id_reused") return notApplied("operation_reused");
    if (code === "date_mismatch") return notApplied("date_changed");
    return notApplied("conflict", readConflicts(detail));
  }
  if (status === 422) return notApplied("invalid_request");
  if (status === 404 || status === 405) return notApplied("unavailable");
  if (status >= 400 && status < 500) return notApplied("invalid_request");
  // 5xx: only the application's own "the database refused and rolled back" is definite. A gateway 502/504 may have
  // been applied behind the proxy.
  if (status === 500 && isRecord(detail) && detail.applied === false) return notApplied("database");
  return { kind: "unknown" };
}

/** Whether the failure proves the database wrote nothing (so the draft is safe to correct and send again). */
export function isDefinitelyNotApplied(failure: BatchFailure): failure is Extract<BatchFailure, { kind: "not_applied" }> {
  return failure.kind === "not_applied";
}

/* ─── Read-back ───────────────────────────────────────────────────────────── */

export type BatchCheck =
  | { kind: "committed"; publication: BatchPublication }
  /** Not committed AS OF THIS READ. The original request may still be in flight: resend the SAME operation, never a new one. */
  | { kind: "not_found" }
  | { kind: "unreadable" };

export function readBatchCheck(raw: unknown, operationId: string): BatchCheck {
  if (!isRecord(raw)) return { kind: "unreadable" };
  if (raw.status === "not_found") return { kind: "not_found" };
  if (raw.status === "committed") {
    const publication = parseBatchPublication(raw.result, operationId);
    return publication ? { kind: "committed", publication } : { kind: "unreadable" };
  }
  return { kind: "unreadable" };
}

/* ─── Operation ids ───────────────────────────────────────────────────────── */

/**
 * A version-4 UUID: the server requires one. `crypto.randomUUID` where the runtime has it, else the Math.random
 * form — the id is an idempotency key, not a secret, and the server binds it to the person and the exact request.
 */
export function newOperationId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === "function") return g.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    return (char === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}
