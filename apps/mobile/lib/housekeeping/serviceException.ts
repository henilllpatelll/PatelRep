import { resolveReturnTime } from "@/lib/housekeeping/hotelTime";
import type { AttemptResult } from "@/lib/housekeeping/serviceAttempts";

/**
 * "Can't enter" reasons -> the server records they map to. Every reason is a
 * PRE-ENTRY exception: it goes to the service-attempt / service-declined log and
 * never to a clean session, so reporting one can not start, finish or advance
 * a clean, and the room's status is left alone.
 */

export type ExceptionReason = "dnd" | "guest_inside" | "come_back_later" | "double_locked" | "guest_declined" | "other";

export const EXCEPTION_REASONS: readonly ExceptionReason[] = [
  "dnd",
  "guest_inside",
  "come_back_later",
  "double_locked",
  "guest_declined",
  "other",
];

export const EXCEPTION_NOTE_MAX = 500;
const OTHER_NOTE_MIN = 3;
const TIME_PRESETS = ["11:00 AM", "12:00 PM", "1:00 PM", "2:00 PM", "3:00 PM"];

export function returnTimePresets(): string[] {
  return TIME_PRESETS;
}

export interface ExceptionDraft {
  reason: ExceptionReason | null;
  returnText: string;
  note: string;
}

export const EMPTY_EXCEPTION_DRAFT: ExceptionDraft = { reason: null, returnText: "", note: "" };

export function isExceptionDirty(draft: ExceptionDraft): boolean {
  return draft.reason !== null || draft.returnText.trim() !== "" || draft.note.trim() !== "";
}

export type ExceptionPlan =
  | {
      kind: "attempt";
      result: AttemptResult;
      returnAt?: string;
      /** Stored with the attempt (English, like every note the app writes). */
      note?: string;
      /** Room note that keeps the Needs Attention signal for this reason. */
      roomNote?: string;
    }
  | { kind: "declined"; note?: string };

export type ExceptionField = "reason" | "time" | "note";
export type ExceptionError = { field: ExceptionField; code: "required" | "invalid" | "past" | "tooShort" | "tooLong" };

export type ExceptionValidation = { ok: true; plan: ExceptionPlan } | { ok: false; error: ExceptionError };

function joinNote(label: string, note: string): string {
  return note ? `${label}: ${note}` : label;
}

export function planException(draft: ExceptionDraft, timeZone: string | null | undefined, now: Date = new Date()): ExceptionValidation {
  const note = draft.note.trim();
  if (!draft.reason) return { ok: false, error: { field: "reason", code: "required" } };
  if (note.length > EXCEPTION_NOTE_MAX) return { ok: false, error: { field: "note", code: "tooLong" } };

  switch (draft.reason) {
    case "dnd":
      return { ok: true, plan: { kind: "attempt", result: "dnd_no_response", note: note || undefined } };
    case "come_back_later": {
      // The attendant names the time. A time is never invented for them.
      if (!draft.returnText.trim()) return { ok: false, error: { field: "time", code: "required" } };
      const resolved = resolveReturnTime(draft.returnText, timeZone, now);
      if (!resolved.ok) return { ok: false, error: { field: "time", code: resolved.reason === "past" ? "past" : "invalid" } };
      return { ok: true, plan: { kind: "attempt", result: "return_later", returnAt: resolved.iso, note: note || undefined } };
    }
    case "guest_inside":
      return {
        ok: true,
        plan: { kind: "attempt", result: "other", note: joinNote("Guest inside", note), roomNote: "BLOCKER: Guest inside" },
      };
    case "double_locked":
      return {
        ok: true,
        plan: {
          kind: "attempt",
          result: "other",
          note: joinNote("Door double-locked", note),
          roomNote: "BLOCKER: Can't enter (double-locked)",
        },
      };
    case "guest_declined":
      return { ok: true, plan: { kind: "declined", note: note || undefined } };
    case "other": {
      if (note.length < OTHER_NOTE_MIN) return { ok: false, error: { field: "note", code: note ? "tooShort" : "required" } };
      return {
        ok: true,
        plan: { kind: "attempt", result: "other", note: joinNote("Access issue", note), roomNote: `BLOCKER: Access issue — ${note}` },
      };
    }
  }
}
