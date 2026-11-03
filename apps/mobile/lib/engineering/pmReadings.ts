/* ─── PM condition readings ─────────────────────────────────────────────────
   A PM records readings against the asset's configured meters (GET /assets/{id}/meters) and sends them as
   `condition_readings` inside the completion itself, so a reading and its inspection are one append - there is no
   separate "save reading" call to retry or duplicate. Units, limits and the meaning of "out of range" all come from the
   meter row; nothing is invented. The status preview mirrors `evaluate_meter_reading` on the server, which stays the
   authority (critical limits inclusive). */

export type PmReadingStatus = "normal" | "warning" | "critical";

export interface PmMeterRow {
  id: string;
  name: string;
  unit: string;
  meter_type?: string | null;
  warning_low?: number | null;
  warning_high?: number | null;
  critical_low?: number | null;
  critical_high?: number | null;
  critical_action?: "none" | "create_work_order" | null;
  is_active?: boolean | null;
  latest_reading?: { value: number | string; recorded_at: string; status_at_recording?: string | null } | null;
}

export interface PmMeter {
  id: string;
  name: string;
  unit: string;
  warningLow: number | null;
  warningHigh: number | null;
  criticalLow: number | null;
  criticalHigh: number | null;
  /** A critical reading on this meter opens a corrective work order on the server. */
  opensWorkOrderWhenCritical: boolean;
  last: { value: number; recordedAt: string } | null;
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function adaptPmMeters(rows: readonly PmMeterRow[] | null | undefined): PmMeter[] {
  const meters: PmMeter[] = [];
  for (const row of rows ?? []) {
    if (!row?.id || row.is_active === false) continue;
    const last = row.latest_reading ? { value: num(row.latest_reading.value), recordedAt: row.latest_reading.recorded_at } : null;
    meters.push({
      id: row.id,
      name: row.name,
      unit: row.unit,
      warningLow: num(row.warning_low),
      warningHigh: num(row.warning_high),
      criticalLow: num(row.critical_low),
      criticalHigh: num(row.critical_high),
      opensWorkOrderWhenCritical: row.critical_action === "create_work_order",
      last: last && last.value != null ? { value: last.value, recordedAt: last.recordedAt } : null,
    });
  }
  return meters;
}

/** Whether the meter has any configured limit to compare against. */
export function hasReferenceLimits(meter: PmMeter): boolean {
  return [meter.warningLow, meter.warningHigh, meter.criticalLow, meter.criticalHigh].some((v) => v != null);
}

export function evaluateReading(meter: PmMeter, value: number): PmReadingStatus {
  if (meter.criticalLow != null && value <= meter.criticalLow) return "critical";
  if (meter.criticalHigh != null && value >= meter.criticalHigh) return "critical";
  if (meter.warningLow != null && value <= meter.warningLow) return "warning";
  if (meter.warningHigh != null && value >= meter.warningHigh) return "warning";
  return "normal";
}

/**
 * Typed text -> number. Accepts a decimal point or comma ("18,5"), rejects blanks, units, NaN/Infinity and values outside
 * the API's +/-1e9 range. Returns null for "not entered" so an optional reading can stay empty.
 */
export type ParsedReading = { kind: "empty" } | { kind: "invalid" } | { kind: "ok"; value: number };

export function parseReading(text: string | null | undefined): ParsedReading {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return { kind: "empty" };
  if (!/^-?\d+([.,]\d+)?$|^-?[.,]\d+$/.test(trimmed)) return { kind: "invalid" };
  const value = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(value) || Math.abs(value) > 1_000_000_000) return { kind: "invalid" };
  return { kind: "ok", value };
}

/**
 * Flips the sign of a typed reading. The decimal keypad on iPhone has no minus key, yet a freezer or a chilled-water
 * return is legitimately below zero, so the field offers this instead of guessing a sign.
 */
export function toggleReadingSign(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "-";
  return trimmed.startsWith("-") ? trimmed.slice(1) : `-${trimmed}`;
}

/** "15 - 20 psi" style summary of the configured normal band, or null when no limit is set. */
export function referenceRange(meter: PmMeter): { low: number | null; high: number | null } | null {
  const low = meter.warningLow ?? meter.criticalLow;
  const high = meter.warningHigh ?? meter.criticalHigh;
  return low == null && high == null ? null : { low, high };
}
