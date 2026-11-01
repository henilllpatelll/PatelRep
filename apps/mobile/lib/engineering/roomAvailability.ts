/* ─── Room availability rules ───────────────────────────────────────────────
   Pure rules for taking a room out of order / out of service and for returning it. The dedicated API
   (/room-unavailability) is the authority: it records the period, flips the room status and writes the audit
   events in one database transaction. The client never sets a room status itself. Two honest limits are
   repeated in the UI copy: PatelRep does not send this to the PMS, and the server's release hands the room to
   housekeeping as DIRTY, never clean or sellable. */

import { ACTIVE_WORK_ORDER_STATUSES, type WorkOrderStatus } from "@/lib/engineering/workOrders";
import { periodTypeOf, type RoomAvailability, type RoomUnavailability } from "@/lib/engineering/roomModel";

export const AVAILABILITY_TYPES = ["OUT_OF_ORDER", "OUT_OF_SERVICE"] as const;
export type AvailabilityType = (typeof AVAILABILITY_TYPES)[number];

export interface AvailabilityReason {
  id: string;
  code: string;
  label: string;
  external_code?: string | null;
  is_active?: boolean;
}

export const DETAILS_MAX = 2000;
export const NOTE_MAX = 2000;
/** The longest a promised return may be set from now; beyond this it is almost certainly a typo. */
export const MAX_RETURN_DAYS = 365;

export interface AvailabilityDraft {
  type: AvailabilityType | null;
  reasonCode: string | null;
  details: string;
  returnAt: Date | null;
  /** An existing repair this unavailability is for (the period's primary work order). */
  workOrderId: string | null;
}

export const EMPTY_AVAILABILITY_DRAFT: AvailabilityDraft = {
  type: null,
  reasonCode: null,
  details: "",
  returnAt: null,
  workOrderId: null,
};

export type AvailabilityError =
  | "type_required"
  | "reason_required"
  | "return_required"
  | "return_past"
  | "return_too_far"
  | "details_too_long";

export function validateAvailability(draft: AvailabilityDraft, now: Date = new Date()): AvailabilityError[] {
  const errors: AvailabilityError[] = [];
  if (!draft.type) errors.push("type_required");
  if (!draft.reasonCode) errors.push("reason_required");
  if (!draft.returnAt || Number.isNaN(draft.returnAt.getTime())) errors.push("return_required");
  else if (draft.returnAt.getTime() <= now.getTime()) errors.push("return_past");
  else if (draft.returnAt.getTime() - now.getTime() > MAX_RETURN_DAYS * 86_400_000) errors.push("return_too_far");
  if (draft.details.trim().length > DETAILS_MAX) errors.push("details_too_long");
  return errors;
}

export function isAvailabilityDirty(draft: AvailabilityDraft): boolean {
  return Boolean(draft.type || draft.reasonCode || draft.details.trim() || draft.returnAt || draft.workOrderId);
}

export interface CreateAvailabilityBody {
  room_id: string;
  type: AvailabilityType;
  reason_code: string;
  reason_label: string;
  expected_return_at: string;
  details?: string;
  primary_work_order_id?: string;
  source: "MOBILE";
}

/** The reason label comes from the hotel's own reason list, never from a client string. */
export function buildCreateBody(roomId: string, draft: AvailabilityDraft, reasons: readonly AvailabilityReason[]): CreateAvailabilityBody | null {
  const reason = reasons.find((r) => r.code === draft.reasonCode);
  if (!draft.type || !reason || !draft.returnAt) return null;
  return {
    room_id: roomId,
    type: draft.type,
    reason_code: reason.code,
    reason_label: reason.label,
    expected_return_at: draft.returnAt.toISOString(),
    ...(draft.details.trim() ? { details: draft.details.trim() } : {}),
    ...(draft.workOrderId ? { primary_work_order_id: draft.workOrderId } : {}),
    source: "MOBILE",
  };
}

export interface PeriodResult {
  period?: Partial<RoomUnavailability> & { id?: string };
  room_status?: { status?: string | null } | null;
}

export type CreateOutcome =
  | { kind: "confirmed"; period: PeriodResult["period"]; roomStatus: string | null }
  /** The server already held an active period for this room and answered with it instead of making a second. */
  | { kind: "already_active"; period: PeriodResult["period"]; roomStatus: string | null };

/**
 * `create_room_unavailability` returns the existing active period unchanged when the room is already down, so a
 * 200 alone does not prove OUR request was recorded. Only an answer that matches what was asked is "confirmed".
 */
export function interpretCreate(body: Pick<CreateAvailabilityBody, "type" | "reason_code" | "expected_return_at">, result: PeriodResult | null | undefined): CreateOutcome | null {
  const period = result?.period;
  if (!period?.id) return null;
  const roomStatus = result?.room_status?.status ?? null;
  const askedReturn = Date.parse(body.expected_return_at);
  const gotReturn = period.expected_return_at ? Date.parse(period.expected_return_at) : NaN;
  const sameReturn = Number.isFinite(gotReturn) && Number.isFinite(askedReturn) && Math.abs(gotReturn - askedReturn) < 1000;
  const matches = period.type === body.type && period.reason_code === body.reason_code && sameReturn;
  return { kind: matches ? "confirmed" : "already_active", period, roomStatus };
}

/** A later promised return needs a reason (the API refuses it otherwise); an earlier one does not. */
export function etaNeedsNote(current: Date | null, next: Date | null): boolean {
  return Boolean(current && next && next.getTime() > current.getTime());
}

export type EtaError = "return_required" | "return_past" | "return_too_far" | "note_required" | "unchanged";

export function validateEtaChange(current: Date | null, next: Date | null, note: string, now: Date = new Date()): EtaError[] {
  const errors: EtaError[] = [];
  if (!next || Number.isNaN(next.getTime())) return ["return_required"];
  if (next.getTime() <= now.getTime()) errors.push("return_past");
  else if (next.getTime() - now.getTime() > MAX_RETURN_DAYS * 86_400_000) errors.push("return_too_far");
  if (current && Math.abs(next.getTime() - current.getTime()) < 60_000) errors.push("unchanged");
  if (etaNeedsNote(current, next) && !note.trim()) errors.push("note_required");
  return errors;
}

/* ── Return time choices ──────────────────────────────────────────────────── */

export interface ReturnPreset {
  key: "in_2h" | "in_4h" | "tonight" | "tomorrow" | "in_3d" | "in_1w";
  at: Date;
}

function atHour(base: Date, dayOffset: number, hour: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/** Quick promises, computed from `now` in the device's own time. "Tonight" appears only while 6 PM is still ahead. */
export function returnPresets(now: Date = new Date()): ReturnPreset[] {
  const presets: ReturnPreset[] = [
    { key: "in_2h", at: new Date(now.getTime() + 2 * 3_600_000) },
    { key: "in_4h", at: new Date(now.getTime() + 4 * 3_600_000) },
  ];
  const tonight = atHour(now, 0, 18);
  if (tonight.getTime() - now.getTime() > 3_600_000) presets.push({ key: "tonight", at: tonight });
  presets.push({ key: "tomorrow", at: atHour(now, 1, 9) });
  presets.push({ key: "in_3d", at: atHour(now, 3, 9) });
  presets.push({ key: "in_1w", at: atHour(now, 7, 9) });
  return presets;
}

/** The custom picker: whole days ahead + an hour of day. */
export function composeReturn(base: Date, daysAhead: number, hour: number): Date {
  return atHour(base, Math.max(0, Math.min(MAX_RETURN_DAYS, daysAhead)), Math.max(0, Math.min(23, hour)));
}

export const RETURN_HOURS = [6, 8, 10, 12, 14, 16, 18, 20] as const;

/* ── Return (release) ──────────────────────────────────────────────────────── */

export interface ReleaseFacts {
  /** Status of the repair this unavailability was opened for, when it names one and the viewer can see it. */
  primaryStatus: WorkOrderStatus | null;
  /** The named repair exists but the viewer cannot read it (a colleague's job). */
  primaryHidden: boolean;
  /** Other active repairs in the room the viewer can see. */
  otherActiveCount: number;
  /** Active repairs a colleague holds that the viewer cannot open. */
  hiddenActiveCount: number;
}

export type ReleaseBlock = "primary_repair_open";

/** A completed or cancelled repair is no longer holding the room; an active one still is. */
export function releaseBlock(facts: ReleaseFacts): ReleaseBlock | null {
  if (facts.primaryStatus && (ACTIVE_WORK_ORDER_STATUSES as readonly string[]).includes(facts.primaryStatus)) return "primary_repair_open";
  return null;
}

/** Whether the person must also acknowledge repairs that are still open in the room. */
export function needsOpenRepairAcknowledgement(facts: ReleaseFacts): boolean {
  return facts.otherActiveCount > 0 || facts.hiddenActiveCount > 0 || facts.primaryHidden;
}

export interface ReleaseChecks {
  verified: boolean;
  acknowledgedOpenRepairs: boolean;
}

export function canConfirmRelease(facts: ReleaseFacts, checks: ReleaseChecks): boolean {
  if (releaseBlock(facts)) return false;
  if (!checks.verified) return false;
  if (needsOpenRepairAcknowledgement(facts) && !checks.acknowledgedOpenRepairs) return false;
  return true;
}

export interface ReleaseBody {
  release_notes?: string;
  source: "MOBILE";
}

export function buildReleaseBody(notes: string): ReleaseBody {
  return { ...(notes.trim() ? { release_notes: notes.trim() } : {}), source: "MOBILE" };
}

export type ReleaseOutcome = { kind: "released"; roomStatus: string | null };

export function interpretRelease(result: PeriodResult | null | undefined): ReleaseOutcome | null {
  if (!result?.period || (result.period as { status?: string }).status !== "RELEASED") return null;
  return { kind: "released", roomStatus: result.room_status?.status ?? null };
}

/** Which option the sheet starts on for a room that is not yet down. */
export function defaultTypeFor(availability: RoomAvailability | null): AvailabilityType | null {
  return availability ? periodTypeOf(availability) : null;
}
