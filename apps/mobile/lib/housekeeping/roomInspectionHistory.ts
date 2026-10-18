import type { RoomInspectionRaw } from "@/lib/api/roomPanels";
import { addDaysToYmd, hotelDateKey } from "@/lib/housekeeping/hotelTime";
import { momentLabel, type HistoryContext } from "@/lib/housekeeping/roomCleaningHistory";

/* ─── Inspection history — view layer (pure) ────────────────────────────────
   GET /housekeeping/inspections returns SUMMARY rows only (result, inspector, notes, time): there is no
   per-item evidence in it, so none is shown. The date window is a pair of hotel-local calendar days — the
   server resolves both local midnights itself, so DST days are right whatever the phone's zone is.

   The endpoint falls back to the first 8 characters of the inspector's id (or "Unknown") when it cannot
   resolve a name. That is not a person's name, so it is treated as "inspector not recorded". */

export const INSPECTION_RANGES = [7, 30, 90] as const;
export type InspectionRangeDays = (typeof INSPECTION_RANGES)[number];
export const DEFAULT_INSPECTION_RANGE: InspectionRangeDays = 7;

/** `days` hotel-local calendar days ending today (inclusive). */
export function inspectionWindow(days: number, now: number, timeZone: string | null | undefined): { from: string; to: string } {
  const to = hotelDateKey(new Date(now), timeZone) ?? new Date(now).toISOString().slice(0, 10);
  return { from: addDaysToYmd(to, -(Math.max(1, days) - 1)), to };
}

export type InspectionResult = "passed" | "failed" | "conditional" | "unknown";

export function inspectionResultOf(value: string | null | undefined): InspectionResult {
  return value === "passed" || value === "failed" || value === "conditional" ? value : "unknown";
}

/** The inspector's name, or null when the server only had an id fragment (or nothing) to offer. */
export function inspectorNameOf(raw: string | null | undefined): string | null {
  const name = raw?.trim();
  if (!name || name.toLowerCase() === "unknown" || /^[0-9a-f]{8}$/i.test(name)) return null;
  return name;
}

export interface InspectionRow {
  id: string;
  result: InspectionResult;
  resultLabel: string;
  at: string | null;
  inspector: string | null;
  note: string | null;
}

export function buildInspectionHistory(rows: readonly RoomInspectionRaw[], ctx: HistoryContext): InspectionRow[] {
  return [...rows]
    .sort((a, b) => Date.parse(b.completed_at ?? "") - Date.parse(a.completed_at ?? "") || 0)
    .map((row) => {
      const result = inspectionResultOf(row.overall_result);
      return {
        id: row.id,
        result,
        resultLabel: ctx.t(`roomBoard.panel.inspections.result.${result}`),
        at: momentLabel(row.completed_at, ctx),
        inspector: inspectorNameOf(row.inspector_name),
        note: row.notes?.trim() ? row.notes.trim() : null,
      };
    });
}
