import type { CorrectionStatus, InspectionRecordRow, OpenCorrectionRow } from "@/lib/api/inspections";
import { hotelDateKey } from "@/lib/housekeeping/hotelTime";
import { correctionStage, type CorrectionStage } from "@/lib/inspections/corrections";
import { searchRank, normalizeQuery } from "@/lib/housekeeping/roomBoardFilters";
import type { CorrectionKind } from "@/lib/inspections/types";

/* ─── The Corrections and Done lists (pure) ──────────────────────────────────
   Both are built only from what the server verified. A row that cannot be read safely is counted, never guessed at:
   a correction with an unknown status is not shown as if it needed action, and a person's name is a real name or
   nothing - never an id standing in for one. */

const KNOWN_STATUSES: ReadonlySet<string> = new Set<CorrectionStatus>([
  "correction_missing",
  "unassigned",
  "assigned",
  "in_progress",
  "escalated",
  "resubmitted",
  "verified",
  "superseded",
  "cancelled",
]);

function parseMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function realName(value: string | null | undefined): string | null {
  const name = value?.trim();
  return name ? name : null;
}

/* ─── Corrections ───────────────────────────────────────────────────────────── */

export type CorrectionOwner =
  | { kind: "named"; name: string }
  /** Someone is responsible but the app has no name for them. */
  | { kind: "unnamed" }
  | { kind: "none" };

export interface CorrectionItem {
  inspectionId: string;
  roomId: string;
  roomNumber: string;
  floor: number | null;
  building: string | null;
  status: CorrectionStatus;
  stage: Exclude<CorrectionStage, "closed">;
  kind: CorrectionKind | null;
  failedCount: number;
  failedLabels: string[];
  notes: string | null;
  inspectedAtMs: number | null;
  /** The most recent thing that happened to this correction (inspection, task start, task completion). */
  latestAtMs: number | null;
  owner: CorrectionOwner;
  /** The correction task, when one exists. */
  taskId: string | null;
  /** Who owns it (id), or null. The server needs this back to detect a concurrent reassignment. */
  assignedTo: string | null;
  /** The room's own status as the server reported it (null = not reported). */
  roomStatus: string | null;
  /** The work is marked done but the room is NOT back in CLEAN: nothing was resubmitted, so it cannot be re-checked yet. */
  roomNotClean: boolean;
}

export interface CorrectionList {
  items: CorrectionItem[];
  /** Rows the server sent that could not be read safely. */
  unreadable: number;
  /** More corrections exist than the server returned: the list is a lower bound. */
  truncated: boolean;
}

const STAGE_RANK: Record<CorrectionItem["stage"], number> = { needs_action: 0, awaiting_reinspection: 1, with_housekeeper: 2 };

function compareCorrections(a: CorrectionItem, b: CorrectionItem): number {
  if (STAGE_RANK[a.stage] !== STAGE_RANK[b.stage]) return STAGE_RANK[a.stage] - STAGE_RANK[b.stage];
  // The longest-outstanding first; an unknown time sorts last.
  if (a.inspectedAtMs !== b.inspectedAtMs) {
    if (a.inspectedAtMs === null) return 1;
    if (b.inspectedAtMs === null) return -1;
    return a.inspectedAtMs - b.inspectedAtMs;
  }
  return a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }) || a.roomId.localeCompare(b.roomId);
}

export function buildCorrections(rows: readonly OpenCorrectionRow[], truncated = false): CorrectionList {
  let unreadable = 0;
  const byRoom = new Map<string, CorrectionItem>();
  for (const row of rows) {
    const status = String(row.status);
    if (!row.inspection_id || !row.room_id || !row.room_number || !KNOWN_STATUSES.has(status)) {
      unreadable += 1;
      continue;
    }
    const baseStage = correctionStage(status as CorrectionStatus);
    if (baseStage === "closed") continue; // settled by a later inspection: nothing is outstanding
    // "Done" with the room not back to CLEAN is a task that says completed while no clean was resubmitted. It cannot
    // be re-checked (the room is not awaiting inspection) and a clean-room event is never invented for it.
    const roomStatus = realName(row.room_status);
    const roomNotClean = status === "resubmitted" && roomStatus !== null && roomStatus !== "CLEAN";
    const stage = roomNotClean ? "needs_action" : baseStage;
    const task = row.task;
    const inspectedAtMs = parseMs(row.inspected_at);
    const times = [inspectedAtMs, parseMs(task?.started_at), parseMs(task?.completed_at)].filter((ms): ms is number => ms !== null);
    const name = realName(task?.assigned_name);
    const item: CorrectionItem = {
      inspectionId: row.inspection_id,
      roomId: row.room_id,
      roomNumber: row.room_number,
      floor: row.floor ?? null,
      building: realName(row.building),
      status: status as CorrectionStatus,
      stage,
      kind: row.kind ?? null,
      failedCount: Math.max(row.failed_count ?? 0, row.failed_items?.length ?? 0),
      failedLabels: (row.failed_items ?? []).map((item) => item.label).filter(Boolean),
      notes: realName(row.notes),
      inspectedAtMs,
      latestAtMs: times.length > 0 ? Math.max(...times) : null,
      owner: name ? { kind: "named", name } : task?.assigned_to ? { kind: "unnamed" } : { kind: "none" },
      taskId: task?.id ?? null,
      assignedTo: task?.assigned_to ?? null,
      roomStatus,
      roomNotClean,
    };
    // One room has one outstanding correction: if the server ever sends two, only the newer is counted.
    const existing = byRoom.get(item.roomId);
    if (!existing || (item.inspectedAtMs ?? 0) >= (existing.inspectedAtMs ?? 0)) byRoom.set(item.roomId, item);
  }
  return { items: [...byRoom.values()].sort(compareCorrections), unreadable, truncated };
}

/* ─── What the supervisor can do about a correction ─────────────────────────── */

export type CorrectionAction =
  /** Back from the housekeeper and the room is awaiting inspection. */
  | "reinspect"
  /** The task was never created: ask the server to create it. */
  | "repair"
  /** Nobody owns it. */
  | "assign"
  | "view";

/** The one thing worth offering on the card. Opening the details is always possible by tapping the card. */
export function correctionAction(item: Pick<CorrectionItem, "status" | "stage" | "assignedTo" | "roomNotClean">, roomAwaitingInspection: boolean): CorrectionAction {
  if (item.stage === "awaiting_reinspection" && roomAwaitingInspection) return "reinspect";
  if (item.status === "correction_missing") return "repair";
  if (item.roomNotClean) return "view";
  if ((item.status === "unassigned" || item.status === "escalated" || item.status === "cancelled") && !item.assignedTo) return "assign";
  return "view";
}

export interface CorrectionGroups {
  needsAttention: number;
  withHousekeepers: number;
  readyToReinspect: number;
}

/** The three counts at the top of the Corrections tab. A room that cannot be re-checked yet is not "ready". */
export function groupCorrections(items: readonly CorrectionItem[], awaitingIds: ReadonlySet<string>): CorrectionGroups {
  const groups: CorrectionGroups = { needsAttention: 0, withHousekeepers: 0, readyToReinspect: 0 };
  for (const item of items) {
    if (item.stage === "awaiting_reinspection") {
      if (awaitingIds.has(item.roomId)) groups.readyToReinspect += 1;
      else groups.needsAttention += 1;
    } else if (item.stage === "needs_action") groups.needsAttention += 1;
    else groups.withHousekeepers += 1;
  }
  return groups;
}

/* ─── Done ──────────────────────────────────────────────────────────────────── */

export type DoneResult = "passed" | "failed" | "conditional" | "unknown";

export interface DoneItem {
  id: string;
  roomId: string | null;
  roomNumber: string;
  floor: number | null;
  building: string | null;
  /** A real name, or null ("Inspector not recorded"). */
  inspectorName: string | null;
  completedAtMs: number | null;
  result: DoneResult;
  /** True only when the record is linked to an earlier failed inspection. */
  isReinspection: boolean;
  notes: string | null;
}

function resultOf(value: string): DoneResult {
  return value === "passed" || value === "failed" || value === "conditional" ? value : "unknown";
}

export interface DoneList {
  items: DoneItem[];
  unreadable: number;
}

/** Inspections completed on the hotel's current business date, newest first. */
export function buildDone(rows: readonly InspectionRecordRow[], businessDate: string, timeZone: string | null | undefined): DoneList {
  let unreadable = 0;
  const seen = new Set<string>();
  const items: DoneItem[] = [];
  for (const row of rows) {
    const completedAtMs = parseMs(row.completed_at);
    if (!row.id || !row.room_number || completedAtMs === null) {
      unreadable += 1;
      continue;
    }
    if (seen.has(row.id)) continue; // a repeated row is the same inspection
    seen.add(row.id);
    // The request is already for the hotel's day; this keeps a boundary row from another day out of "today".
    if (hotelDateKey(new Date(completedAtMs), timeZone) !== businessDate) continue;
    items.push({
      id: row.id,
      roomId: row.room_id ?? null,
      roomNumber: row.room_number,
      floor: row.floor ?? null,
      building: realName(row.building),
      inspectorName: realName(row.inspector_display_name),
      completedAtMs,
      result: resultOf(row.overall_result),
      isReinspection: Boolean(row.reinspection_of),
      notes: realName(row.notes),
    });
  }
  items.sort((a, b) => (b.completedAtMs ?? 0) - (a.completedAtMs ?? 0) || a.id.localeCompare(b.id));
  return { items, unreadable };
}

/* ─── Search shared by every tab ─────────────────────────────────────────────── */

/** Room-number search for the Corrections and Done lists: exact → prefix → contains, each rank keeping its order. */
export function searchByRoomNumber<T extends { roomNumber: string }>(items: readonly T[], query: string): T[] {
  const needle = normalizeQuery(query);
  if (!needle) return [...items];
  const ranked: T[][] = [[], [], []];
  for (const item of items) {
    const rank = searchRank(item.roomNumber, needle);
    if (rank !== null) ranked[rank].push(item);
  }
  return [...ranked[0], ...ranked[1], ...ranked[2]];
}
