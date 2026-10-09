import { api, ApiError } from "@/lib/api/client";

/**
 * Quantity-based supply requests, carried by the existing housekeeping task
 * (POST /tasks). No new table: the task description is a readable summary for
 * the supervisor followed by one machine-readable line the web and reports can
 * parse. The catalog is the app's fixed choice list — no stock levels, no ETAs.
 */

export const SUPPLY_MAX_QTY = 20;
export const SUPPLY_NOTE_MAX = 500;
const MARKER = "[supply-request v1]";

export interface SupplyItem {
  key: string;
  /** i18n key for the on-screen label. */
  labelKey: string;
  /** Stored data stays English, like every other note and task the app writes. */
  storedLabel: string;
}

export const SUPPLY_CATALOG: readonly SupplyItem[] = [
  { key: "towels", labelKey: "supplies.items.towels", storedLabel: "Bath towels" },
  { key: "pillowcases", labelKey: "supplies.items.pillowcases", storedLabel: "Sheets / Pillowcases" },
  { key: "toiletries", labelKey: "supplies.items.toiletries", storedLabel: "Toiletries (shampoo, soap)" },
  { key: "trash_bags", labelKey: "supplies.items.trash_bags", storedLabel: "Trash bags" },
  { key: "amenities", labelKey: "supplies.items.amenities", storedLabel: "Amenities kit" },
];

export type Quantities = Record<string, number>;

export function clampQty(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(SUPPLY_MAX_QTY, Math.max(0, Math.trunc(value)));
}

export function totalRequested(quantities: Quantities): number {
  return SUPPLY_CATALOG.reduce((sum, item) => sum + clampQty(quantities[item.key] ?? 0), 0);
}

export type SupplyValidation = { ok: true } | { ok: false; code: "empty" | "noteTooLong" };

/** At least one item, or a free-text request on its own. */
export function validateSupply(quantities: Quantities, note: string): SupplyValidation {
  if (note.trim().length > SUPPLY_NOTE_MAX) return { ok: false, code: "noteTooLong" };
  if (totalRequested(quantities) === 0 && !note.trim()) return { ok: false, code: "empty" };
  return { ok: true };
}

export interface SupplyTaskInput {
  roomId: string;
  roomNumber: string;
  quantities: Quantities;
  note: string;
  requestId: string;
}

export interface SupplyTaskPayload {
  title: string;
  description: string;
  task_type: "housekeeping";
  priority: "normal";
  room_id: string;
}

export function buildSupplyTask(input: SupplyTaskInput): SupplyTaskPayload {
  const chosen = SUPPLY_CATALOG.map((item) => ({ item, qty: clampQty(input.quantities[item.key] ?? 0) })).filter(({ qty }) => qty > 0);
  const note = input.note.trim();
  const items: Quantities = {};
  for (const { item, qty } of chosen) items[item.key] = qty;

  const readable = [
    chosen.length
      ? `Room ${input.roomNumber} needs: ${chosen.map(({ item, qty }) => `${qty} × ${item.storedLabel}`).join(", ")}.`
      : `Room ${input.roomNumber} supply request.`,
  ];
  if (note) readable.push(`Note: ${note}`);
  const machine = `${MARKER} ${JSON.stringify({ request_id: input.requestId, items, ...(note ? { note } : {}) })}`;
  return {
    title: `Supply request — Room ${input.roomNumber}`,
    description: `${readable.join("\n")}\n\n${machine}`,
    task_type: "housekeeping",
    priority: "normal",
    room_id: input.roomId,
  };
}

/** Parse the machine-readable line back out (used by tests and any consumer). */
export function parseSupplyDescription(
  description: string | null | undefined,
): { request_id: string; items: Quantities; note?: string } | null {
  const line = description?.split("\n").find((entry) => entry.startsWith(MARKER));
  if (!line) return null;
  try {
    return JSON.parse(line.slice(MARKER.length).trim());
  } catch {
    return null;
  }
}

/** The request went out but the answer may have been lost (timeout, dropped link, 5xx). */
export function isAmbiguousFailure(err: unknown): boolean {
  if (err instanceof ApiError) return err.status >= 500;
  return true;
}

export type SupplySubmitResult =
  | { outcome: "created" | "already_sent" }
  | { outcome: "failed"; message: string; ambiguous: boolean };

/**
 * Send the request once. After an answer-less failure the next try first looks
 * for the same request id on the room's tasks, so a retry never creates a second task.
 */
export async function submitSupplyRequest(input: SupplyTaskInput, mayHaveBeenSent: boolean): Promise<SupplySubmitResult> {
  try {
    if (mayHaveBeenSent) {
      const existing = await api.get<{ data: Array<{ description?: string | null }> }>(
        `/tasks?room_id=${encodeURIComponent(input.roomId)}&task_type=housekeeping&per_page=20`,
      );
      if ((existing.data ?? []).some((task) => parseSupplyDescription(task.description)?.request_id === input.requestId)) {
        return { outcome: "already_sent" };
      }
    }
    await api.post("/tasks", buildSupplyTask(input));
    return { outcome: "created" };
  } catch (err: unknown) {
    return { outcome: "failed", message: err instanceof Error ? err.message : String(err), ambiguous: isAmbiguousFailure(err) };
  }
}
