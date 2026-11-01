import type { RepairActions } from "@/lib/engineering/repairWorkspace";

/* ─── Work-order checklist ──────────────────────────────────────────────────
   Pure rules behind the Checklist tab and the completion gate. Everything here is a server record: GET
   /work-orders/{id}/checklist returns the steps AND the readiness summary, PATCH returns the changed step and the new
   summary, and POST /complete enforces the same summary. The app never recomputes readiness on its own, so it cannot
   disagree with the server about what is still required. */

export interface ChecklistItem {
  id: string;
  label: string;
  /** Only an item the server marked required can block completion. Everything else is optional. */
  is_required: boolean;
  is_done: boolean;
  done_by: string | null;
  done_at: string | null;
  sort_order: number;
  estimated_minutes: number | null;
}

export interface ChecklistRemaining {
  id: string;
  label: string;
}

export interface ChecklistSummary {
  total: number;
  completed: number;
  required_total: number;
  required_completed: number;
  required_remaining: ChecklistRemaining[];
  ready: boolean;
}

export interface ChecklistSnapshot {
  items: ChecklistItem[];
  summary: ChecklistSummary;
  /** False once the order is completed or cancelled: the checklist is then a read-only record. */
  editable: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function parseItem(raw: unknown): ChecklistItem | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.label !== "string") return null;
  return {
    id: raw.id,
    label: raw.label,
    is_required: raw.is_required === true,
    is_done: raw.is_done === true,
    done_by: typeof raw.done_by === "string" ? raw.done_by : null,
    done_at: typeof raw.done_at === "string" ? raw.done_at : null,
    sort_order: typeof raw.sort_order === "number" ? raw.sort_order : 0,
    estimated_minutes: typeof raw.estimated_minutes === "number" ? raw.estimated_minutes : null,
  };
}

function parseSummary(raw: unknown): ChecklistSummary | null {
  if (!isRecord(raw)) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const total = num(raw.total);
  const completed = num(raw.completed);
  const requiredTotal = num(raw.required_total);
  const requiredCompleted = num(raw.required_completed);
  if (total == null || completed == null || requiredTotal == null || requiredCompleted == null || !Array.isArray(raw.required_remaining)) return null;
  const remaining = raw.required_remaining.filter((r): r is ChecklistRemaining => isRecord(r) && typeof r.id === "string" && typeof r.label === "string");
  return { total, completed, required_total: requiredTotal, required_completed: requiredCompleted, required_remaining: remaining, ready: remaining.length === 0 && raw.ready !== false };
}

/** A malformed answer is `null`, which the screen shows as a load failure, never as "no checklist". */
export function parseChecklistResponse(raw: unknown): ChecklistSnapshot | null {
  if (!isRecord(raw) || !Array.isArray(raw.data)) return null;
  const items = raw.data.map(parseItem);
  if (items.some((i) => i == null)) return null;
  const summary = parseSummary(raw.summary);
  if (!summary) return null;
  const meta = isRecord(raw.meta) ? raw.meta : {};
  return { items: sortItems(items as ChecklistItem[]), summary, editable: meta.editable !== false };
}

export function parseChecklistUpdate(raw: unknown): { item: ChecklistItem; summary: ChecklistSummary } | null {
  if (!isRecord(raw)) return null;
  const item = parseItem(raw.data);
  const summary = parseSummary(raw.summary);
  return item && summary ? { item, summary } : null;
}

export function sortItems(items: readonly ChecklistItem[]): ChecklistItem[] {
  return [...items].sort((a, b) => a.sort_order - b.sort_order);
}

/** Replace one confirmed step and take the server's summary. A step the list no longer has is ignored. */
export function applyItemUpdate(snapshot: ChecklistSnapshot, item: ChecklistItem, summary: ChecklistSummary): ChecklistSnapshot {
  if (!snapshot.items.some((i) => i.id === item.id)) return snapshot;
  return { ...snapshot, items: snapshot.items.map((i) => (i.id === item.id ? item : i)), summary };
}

/** Completed / total as 0..1, or `null` when there are no steps: an empty checklist has no progress, not 100%. */
export function progressRatio(summary: Pick<ChecklistSummary, "total" | "completed">): number | null {
  if (summary.total <= 0) return null;
  return Math.min(1, Math.max(0, summary.completed / summary.total));
}

export type ChecklistReadOnlyReason = "closed" | "notAssigned" | "offline" | "viewOnly" | null;

/**
 * Whether the person may tick steps, and if not why. Mirrors PATCH /checklist/{id}: the assigned engineer (or a GM) on an
 * order that is still open. A checklist step is not queued offline: it is a record the server has not confirmed until it
 * answers, so it needs a connection.
 */
export function checklistEditing(input: {
  actions: Pick<RepairActions, "block" | "isMine">;
  role: string | null | undefined;
  online: boolean;
  snapshotEditable: boolean;
}): { canEdit: boolean; reason: ChecklistReadOnlyReason } {
  const { actions, role, online, snapshotEditable } = input;
  if (actions.block === "closed" || !snapshotEditable) return { canEdit: false, reason: "closed" };
  if (actions.block === "viewOnly") return { canEdit: false, reason: "viewOnly" };
  if (!(actions.isMine || role === "gm")) return { canEdit: false, reason: "notAssigned" };
  if (!online) return { canEdit: false, reason: "offline" };
  return { canEdit: true, reason: null };
}

/* ── Load state ─────────────────────────────────────────────────────────── */

export type ChecklistLoad =
  | { phase: "loading" }
  | { phase: "error"; failure: "forbidden" | "offline" | "failed" }
  | { phase: "ready"; snapshot: ChecklistSnapshot };

/**
 * What the checklist means for completing the order right now.
 *  - `ready`      the last confirmed read has no required step open (or no checklist at all)
 *  - `blocked`    a required step is open; `remaining` names them
 *  - `unverified` the checklist could not be read; online the server still decides, offline nothing is safe to queue
 */
export type ChecklistGate = { kind: "ready" } | { kind: "blocked"; remaining: ChecklistRemaining[] } | { kind: "unverified" };

export function checklistGate(load: ChecklistLoad): ChecklistGate {
  if (load.phase !== "ready") return { kind: "unverified" };
  const { summary } = load.snapshot;
  return summary.ready ? { kind: "ready" } : { kind: "blocked", remaining: summary.required_remaining };
}

/**
 * A completion made offline is queued and replayed later. It can only be offered when this phone has a confirmed read of
 * the checklist showing nothing required is open; the server re-checks on replay and may still refuse it.
 */
export type OfflineChecklistBlock = "checklistOpen" | "checklistUnverified" | null;

export function offlineChecklistBlock(gate: ChecklistGate): OfflineChecklistBlock {
  if (gate.kind === "blocked") return "checklistOpen";
  if (gate.kind === "unverified") return "checklistUnverified";
  return null;
}
