/* ─── PM schedule form (pure) ───────────────────────────────────────────────
   What the create / edit screen decides locally: which values are acceptable, what the request body is, and which
   fields actually changed. The server re-validates everything (property, equipment, procedure, version).

   Editing deliberately has NO due-date field. Moving a due date is a different act with different rules: postponing is a
   deferral request that another manager approves, and a plain edit must not become a way around that. */

import { hotelDateKey, zonedTimeToInstant } from "@/lib/housekeeping/hotelTime";
import type { PmIntervalType, PmScheduleCreateBody } from "@/lib/api/pmManagement";

export const INTERVAL_TYPES: readonly PmIntervalType[] = ["daily", "weekly", "monthly", "quarterly", "annual", "custom"];
export const NAME_MAX = 255;
export const DESCRIPTION_MAX = 2000;

export interface ScheduleFormValues {
  assetId: string | null;
  name: string;
  description: string;
  intervalType: PmIntervalType;
  /** Days between inspections; only used when `intervalType` is "custom". */
  intervalDays: string;
  estimatedMinutes: string;
  /** YYYY-MM-DD in the hotel's calendar. Create only. */
  firstDueDate: string;
  recurrenceBasis: "scheduled_date" | "completion_date";
  checklistId: string | null;
}

export const EMPTY_SCHEDULE_FORM: ScheduleFormValues = {
  assetId: null,
  name: "",
  description: "",
  intervalType: "monthly",
  intervalDays: "",
  estimatedMinutes: "30",
  firstDueDate: "",
  recurrenceBasis: "scheduled_date",
  checklistId: null,
};

export type ScheduleProblem =
  | "asset_missing"
  | "name_missing"
  | "name_long"
  | "description_long"
  | "interval_days"
  | "minutes"
  | "due_missing"
  | "due_past"
  | "checklist_missing";

const wholeNumber = (text: string) => (/^\d{1,5}$/.test(text.trim()) ? Number(text.trim()) : null);

export function validateSchedule(
  values: ScheduleFormValues,
  mode: "create" | "edit",
  timezone: string | null | undefined,
  now: Date = new Date(),
  /** Edit only: the schedule had no procedure before, so leaving it that way is not a new problem. */
  legacyUnbound = false,
): ScheduleProblem[] {
  const problems: ScheduleProblem[] = [];
  if (mode === "create" && !values.assetId) problems.push("asset_missing");
  const name = values.name.trim();
  if (!name) problems.push("name_missing");
  else if (name.length > NAME_MAX) problems.push("name_long");
  if (values.description.length > DESCRIPTION_MAX) problems.push("description_long");
  if (values.intervalType === "custom") {
    const days = wholeNumber(values.intervalDays);
    if (days == null || days < 1 || days > 3650) problems.push("interval_days");
  }
  const minutes = wholeNumber(values.estimatedMinutes);
  if (minutes == null || minutes < 1 || minutes > 1440) problems.push("minutes");
  if (mode === "create") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(values.firstDueDate)) problems.push("due_missing");
    else {
      const today = hotelDateKey(now, timezone);
      if (today && values.firstDueDate < today) problems.push("due_past");
    }
  }
  if (!values.checklistId && !(mode === "edit" && legacyUnbound)) problems.push("checklist_missing");
  return problems;
}

/** The first inspection falls due at noon in the hotel on the chosen day, so no timezone can roll it onto a neighbour. */
export function firstDueInstant(date: string, timezone: string | null | undefined): string | null {
  return zonedTimeToInstant(date, 12, 0, timezone)?.toISOString() ?? null;
}

export function toCreateBody(values: ScheduleFormValues, timezone: string | null | undefined): PmScheduleCreateBody | null {
  const due = firstDueInstant(values.firstDueDate, timezone);
  if (!values.assetId || !due) return null;
  return {
    asset_id: values.assetId,
    name: values.name.trim(),
    description: values.description.trim() || null,
    interval_type: values.intervalType,
    interval_days: values.intervalType === "custom" ? wholeNumber(values.intervalDays) : null,
    estimated_minutes: wholeNumber(values.estimatedMinutes) ?? 30,
    next_due_at: due,
    recurrence_basis: values.recurrenceBasis,
    checklist_template_id: values.checklistId,
  };
}

export interface ScheduleSnapshot {
  name: string;
  description: string | null;
  intervalType: PmIntervalType | null;
  intervalDays: number | null;
  estimatedMinutes: number | null;
  recurrenceBasis: "scheduled_date" | "completion_date" | null;
  /** The procedure the schedule is bound to now (null = unassigned). */
  checklistId: string | null;
}

export function formFromSchedule(s: ScheduleSnapshot): ScheduleFormValues {
  return {
    assetId: null,
    name: s.name,
    description: s.description ?? "",
    intervalType: s.intervalType ?? "monthly",
    intervalDays: s.intervalDays != null ? String(s.intervalDays) : "",
    estimatedMinutes: s.estimatedMinutes != null ? String(s.estimatedMinutes) : "30",
    firstDueDate: "",
    recurrenceBasis: s.recurrenceBasis ?? "scheduled_date",
    checklistId: s.checklistId,
  };
}

export interface ScheduleChanges {
  /** Sent to PATCH /pm-schedules/{id}. Empty = nothing but possibly the procedure changed. */
  fields: Record<string, unknown>;
  checklistChanged: boolean;
}

/** Only what the manager actually changed is sent, so an untouched field can never overwrite someone else's edit. */
export function diffSchedule(original: ScheduleSnapshot, values: ScheduleFormValues): ScheduleChanges {
  const fields: Record<string, unknown> = {};
  const name = values.name.trim();
  if (name !== original.name) fields.name = name;
  const description = values.description.trim() || null;
  if (description !== (original.description?.trim() || null)) fields.description = description;
  if (values.intervalType !== original.intervalType) fields.interval_type = values.intervalType;
  // Days only matter for a custom interval; leaving custom needs no days change (the server ignores them then).
  if (values.intervalType === "custom") {
    const days = wholeNumber(values.intervalDays);
    if (values.intervalType !== original.intervalType || days !== original.intervalDays) fields.interval_days = days;
  }
  const minutes = wholeNumber(values.estimatedMinutes);
  if (minutes != null && minutes !== original.estimatedMinutes) fields.estimated_minutes = minutes;
  if (values.recurrenceBasis !== original.recurrenceBasis) fields.recurrence_basis = values.recurrenceBasis;
  return { fields, checklistChanged: values.checklistId !== original.checklistId };
}

export function hasChanges(changes: ScheduleChanges): boolean {
  return Object.keys(changes.fields).length > 0 || changes.checklistChanged;
}

/* ── warranty (recorded dates only) ── */

export type WarrantyState = "unknown" | "active" | "expiring_soon" | "expired";
export const WARRANTY_SOON_DAYS = 90;

/** Mirrors the server rule. It reports the recorded date, not whether a claim would be honoured. */
export function warrantyState(expires: string | null | undefined, timezone: string | null | undefined, now: Date = new Date()): WarrantyState {
  if (!expires || !/^\d{4}-\d{2}-\d{2}/.test(expires)) return "unknown";
  const today = hotelDateKey(now, timezone);
  if (!today) return "unknown";
  const days = Math.round((Date.parse(`${expires.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (Number.isNaN(days)) return "unknown";
  if (days < 0) return "expired";
  return days <= WARRANTY_SOON_DAYS ? "expiring_soon" : "active";
}
