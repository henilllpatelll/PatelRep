import type { HistoryRowRaw } from "@/lib/api/inspectionHistory";
import type { DoneItem, DoneResult } from "@/lib/inspections/lists";

/* ─── History rows (pure) ───────────────────────────────────────────────────
   The server already filtered, sorted and paged. This only turns its rows into what the list draws, keeps the
   server's order, and refuses to show the same inspection twice when a page boundary overlaps. */

export interface HistoryItem extends DoneItem {
  /** The stable user id of the inspector (null when not recorded). */
  inspectorId: string | null;
}

function parseMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function resultOf(value: string): DoneResult {
  return value === "passed" || value === "failed" || value === "conditional" ? value : "unknown";
}

export interface HistoryBuild {
  items: HistoryItem[];
  /** Rows whose time could not be read: counted, never guessed at. */
  unreadable: number;
}

/** Fold more rows into what is already shown. The first occurrence of an id wins, so paging can never duplicate. */
export function appendHistory(existing: readonly HistoryItem[], rows: readonly HistoryRowRaw[]): HistoryBuild {
  const seen = new Set(existing.map((item) => item.id));
  const items = [...existing];
  let unreadable = 0;
  for (const row of rows) {
    if (!row.id || seen.has(row.id)) continue;
    const completedAtMs = parseMs(row.completed_at);
    if (completedAtMs === null) {
      unreadable += 1;
      continue;
    }
    seen.add(row.id);
    items.push({
      id: row.id,
      roomId: row.room_id ?? null,
      roomNumber: row.room_number?.trim() ?? "",
      floor: row.floor ?? null,
      building: text(row.building),
      inspectorName: text(row.inspector_display_name),
      inspectorId: text(row.inspected_by),
      completedAtMs,
      result: resultOf(row.overall_result),
      isReinspection: row.is_reinspection === true || Boolean(row.reinspection_of),
      notes: text(row.notes),
    });
  }
  return { items, unreadable };
}

export function buildHistory(rows: readonly HistoryRowRaw[]): HistoryBuild {
  return appendHistory([], rows);
}
