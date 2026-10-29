import { api } from "./client";
import { parseTeamShift, type TeamShift } from "./schedulingTeam";

/* ─── Shift management (Team Scheduling Phase 3) ────────────────────────────
   Writes and the reads that sit beside them. Every shift change HERE is an IMMEDIATE schedule change (the web scheduler
   and the supervisor's "apply immediately" mode use it). Planning in a draft, reviewing and publishing live in
   schedulingRevisions.ts; nothing in this file says "draft", "published" or "notified".

   Safety rules the callers rely on
     - `expected_version` travels with every edit/cancel; a 409 `version_conflict` carries the server's current row.
     - Creating the same (person, shift, date) twice is a server-side no-op, so repeating a request whose answer was
       lost can never create a second shift. An edit repeated with a stale version comes back as `version_conflict`,
       and `matchesIntent` lets the caller recognise that its OWN change already landed. */

type Raw = Record<string, unknown>;

function rec(value: unknown): Raw | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : null;
}
function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/* ─── Templates ───────────────────────────────────────────────────────────── */

export interface ShiftTemplate {
  id: string;
  name: string;
  departmentId: string | null;
  /** Hotel-local wall clock, "HH:MM:SS". */
  startTime: string;
  endTime: string;
  isActive: boolean;
  archived: boolean;
  version: number;
}

export function parseTemplate(raw: unknown): ShiftTemplate | null {
  const row = rec(raw);
  const id = row ? str(row.id) : null;
  const name = row ? str(row.name) : null;
  const startTime = row ? str(row.start_time) : null;
  const endTime = row ? str(row.end_time) : null;
  if (!row || !id || !name || !startTime || !endTime) return null;
  return {
    id,
    name,
    departmentId: str(row.department_id),
    startTime,
    endTime,
    isActive: row.is_active !== false,
    archived: Boolean(row.archived_at),
    version: num(row.version) ?? 1,
  };
}

export interface TemplateList {
  templates: ShiftTemplate[];
  /** Rows the server sent that this client could not read. */
  unreadable: number;
}

export async function fetchTemplates(includeArchived = false): Promise<TemplateList> {
  const body = rec(await api.get<unknown>(`/schedules/shifts${includeArchived ? "?include_archived=true" : ""}`));
  if (!body || !Array.isArray(body.data)) throw new Error("Shift template response was not in the expected shape.");
  const parsed = body.data.map(parseTemplate);
  return { templates: parsed.filter((t): t is ShiftTemplate => t !== null), unreadable: parsed.filter((t) => t === null).length };
}

function oneTemplate(body: unknown): ShiftTemplate {
  const root = rec(body);
  const template = root ? parseTemplate(root.data) : null;
  if (!template) throw new Error("Shift template response was not in the expected shape.");
  return template;
}

export async function createTemplate(input: { name: string; departmentId: string; startTime: string; endTime: string }): Promise<ShiftTemplate> {
  return oneTemplate(await api.post<unknown>("/schedules/shifts", { name: input.name, department_id: input.departmentId, start_time: input.startTime, end_time: input.endTime }));
}

export async function updateTemplate(id: string, input: { name?: string; startTime?: string; endTime?: string; isActive?: boolean; expectedVersion: number }): Promise<ShiftTemplate> {
  const body: Raw = { expected_version: input.expectedVersion };
  if (input.name !== undefined) body.name = input.name;
  if (input.startTime !== undefined) body.start_time = input.startTime;
  if (input.endTime !== undefined) body.end_time = input.endTime;
  if (input.isActive !== undefined) body.is_active = input.isActive;
  return oneTemplate(await api.patch<unknown>(`/schedules/shifts/${encodeURIComponent(id)}`, body));
}

/** Archives (never deletes) the template. The server answers 204 with no body; callers re-read the list to confirm. */
export async function archiveTemplate(id: string): Promise<void> {
  try {
    await api.delete<unknown>(`/schedules/shifts/${encodeURIComponent(id)}`);
  } catch (error) {
    // An empty 204 body is not valid JSON to the shared client; the request itself succeeded.
    if (error instanceof SyntaxError) return;
    throw error;
  }
}

export interface TemplateUsage {
  upcoming: number;
  past: number;
  archived: boolean;
}

export async function fetchTemplateUsage(id: string): Promise<TemplateUsage> {
  const root = rec(await api.get<unknown>(`/schedules/shifts/${encodeURIComponent(id)}/usage`));
  const data = root ? rec(root.data) : null;
  const upcoming = data ? num(data.upcoming) : null;
  const past = data ? num(data.past) : null;
  if (!data || upcoming === null || past === null) throw new Error("Template usage response was not in the expected shape.");
  return { upcoming, past, archived: data.archived === true };
}

/* ─── Warnings, conflicts, failures ───────────────────────────────────────── */

export interface ScheduleWarning {
  code: string;
  userId: string | null;
  workDate: string | null;
  detail: string | null;
  severity: "warn" | "block";
}

export interface ScheduleConflict {
  code: string;
  userId: string | null;
  workDate: string | null;
  withAssignmentId: string | null;
}

function parseWarnings(value: unknown): ScheduleWarning[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const row = rec(raw);
    const code = row ? str(row.code) : null;
    return row && code ? [{ code, userId: str(row.user_id), workDate: str(row.work_date), detail: str(row.detail), severity: row.severity === "block" ? ("block" as const) : ("warn" as const) }] : [];
  });
}

function parseConflicts(value: unknown): ScheduleConflict[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const row = rec(raw);
    const code = row ? str(row.code) : null;
    return row && code ? [{ code, userId: str(row.user_id), workDate: str(row.work_date), withAssignmentId: str(row.with_assignment_id) }] : [];
  });
}

export type WriteFailureKind =
  | "version_conflict"
  | "schedule_conflict"
  | "duplicate"
  | "policy_blocked"
  | "locked"
  | "attendance"
  | "forbidden"
  | "not_found"
  | "inactive"
  | "department"
  | "invalid"
  | "signed_out"
  /** No answer (offline, timeout, 5xx): the change MAY have been saved. */
  | "unconfirmed"
  | "unknown";

export interface WriteFailure {
  kind: WriteFailureKind;
  status: number | null;
  code: string | null;
  /** The server's own words; shown only when nothing more specific is known. */
  message: string | null;
  conflicts: ScheduleConflict[];
  warnings: ScheduleWarning[];
  /** The shift as it is now, for a version conflict. */
  current: TeamShift | null;
}

const BY_CODE: Record<string, WriteFailureKind> = {
  version_conflict: "version_conflict",
  schedule_conflict: "schedule_conflict",
  duplicate_assignment: "duplicate",
  duplicate_shift_name: "duplicate",
  schedule_policy_blocked: "policy_blocked",
  historical_assignment_locked: "locked",
  has_attendance: "attendance",
  department_forbidden: "forbidden",
  department_mismatch: "department",
  shift_inactive: "inactive",
  staff_inactive: "inactive",
  staff_not_found: "not_found",
  shift_not_found: "not_found",
  assignment_not_found: "not_found",
  invalid_time: "invalid",
  invalid_name: "invalid",
  no_changes: "invalid",
  batch_too_large: "invalid",
};

/** Classify without `instanceof`, so it works when a test mocks the client module. */
export function classifyWriteFailure(error: unknown): WriteFailure {
  const raw = error as { status?: unknown; code?: unknown; message?: unknown; body?: unknown } | null;
  const status = typeof raw?.status === "number" ? raw.status : null;
  const body = rec(raw?.body);
  const code = typeof raw?.code === "string" ? raw.code : body ? str(body.code) : null;
  const message = typeof raw?.message === "string" && raw.message ? raw.message : null;
  const base = { status, code, message, conflicts: parseConflicts(body?.conflicts), warnings: parseWarnings(body?.warnings), current: body ? parseTeamShift(body.current) : null };
  if (status === null) {
    const signedOut = /not authenticated|session expired/i.test(message ?? "");
    return { ...base, kind: signedOut ? "signed_out" : "unconfirmed" };
  }
  if (status === 401) return { ...base, kind: "signed_out" };
  if (status >= 500) return { ...base, kind: "unconfirmed" };
  const mapped = code ? BY_CODE[code] : undefined;
  if (mapped) return { ...base, kind: mapped };
  if (status === 403) return { ...base, kind: "forbidden" };
  if (status === 404) return { ...base, kind: "not_found" };
  if (status === 409) return { ...base, kind: "unknown" };
  return { ...base, kind: status === 422 ? "invalid" : "unknown" };
}

/** A preview's `blocking` refusal as the same failure the save would have produced. */
export function failureFromBlocking(blocking: PreviewBlocking): WriteFailure {
  const mapped = blocking.code ? BY_CODE[blocking.code] : undefined;
  return { kind: mapped ?? "unknown", status: blocking.status, code: blocking.code, message: blocking.message, conflicts: blocking.conflicts, warnings: blocking.warnings, current: null };
}

/* ─── Writing shifts ──────────────────────────────────────────────────────── */

/** One shift to create. `startTime`/`endTime` override the template's wall-clock times for this occurrence only. */
export interface ShiftInput {
  userId: string;
  shiftId: string;
  workDate: string;
  startTime?: string | null;
  endTime?: string | null;
  notes?: string | null;
}

function itemBody(input: ShiftInput): Raw {
  const body: Raw = { user_id: input.userId, shift_id: input.shiftId, work_date: input.workDate };
  if (input.startTime) body.start_time = input.startTime;
  if (input.endTime) body.end_time = input.endTime;
  if (input.notes) body.notes = input.notes;
  return body;
}

export interface CreateOutcome {
  /** false = the shift was already scheduled exactly like this (a repeat); nothing new was written. */
  created: boolean;
  shift: TeamShift | null;
  warnings: ScheduleWarning[];
}

export async function createShift(input: ShiftInput): Promise<CreateOutcome> {
  const root = rec(await api.post<unknown>("/schedules/assignments", itemBody(input)));
  const meta = root ? rec(root.meta) : null;
  if (!root || !meta) throw new Error("Shift response was not in the expected shape.");
  return { created: meta.created === true, shift: parseTeamShift(root.data), warnings: parseWarnings(meta.warnings) };
}

export interface ShiftPatch {
  expectedVersion: number;
  userId?: string;
  workDate?: string;
  shiftId?: string;
  startTime?: string;
  endTime?: string;
  notes?: string | null;
}

export interface UpdateOutcome {
  shift: TeamShift;
  warnings: ScheduleWarning[];
}

export async function updateShift(id: string, patch: ShiftPatch): Promise<UpdateOutcome> {
  const body: Raw = { expected_version: patch.expectedVersion };
  if (patch.userId !== undefined) body.user_id = patch.userId;
  if (patch.workDate !== undefined) body.work_date = patch.workDate;
  if (patch.shiftId !== undefined) body.shift_id = patch.shiftId;
  if (patch.startTime !== undefined) body.start_time = patch.startTime;
  if (patch.endTime !== undefined) body.end_time = patch.endTime;
  if (patch.notes !== undefined) body.notes = patch.notes ?? "";
  const root = rec(await api.patch<unknown>(`/schedules/assignments/${encodeURIComponent(id)}`, body));
  const meta = root ? rec(root.meta) : null;
  const shift = root ? parseTeamShift(root.data) : null;
  if (!shift) throw new Error("Shift response was not in the expected shape.");
  return { shift, warnings: parseWarnings(meta?.warnings) };
}

/** Removes (cancels) one scheduled shift. The server writes the removed row to the audit history first. */
export async function cancelShift(id: string, expectedVersion: number): Promise<void> {
  const root = rec(await api.delete<unknown>(`/schedules/assignments/${encodeURIComponent(id)}?expected_version=${expectedVersion}`));
  const data = root ? rec(root.data) : null;
  if (!data || data.success !== true) throw new Error("Shift response was not in the expected shape.");
}

export interface BatchOutcome {
  created: number;
  unchanged: number;
  warnings: ScheduleWarning[];
}

/** ALL OR NOTHING on the server. Used for recurring creation: never loop `createShift`. */
export async function createShiftsBatch(inputs: readonly ShiftInput[]): Promise<BatchOutcome> {
  const root = rec(await api.post<unknown>("/schedules/assignments/bulk", { assignments: inputs.map(itemBody) }));
  const data = root ? rec(root.data) : null;
  const created = data ? num(data.created_count) : null;
  const unchanged = data ? num(data.unchanged_count) : null;
  if (!data || created === null || unchanged === null) throw new Error("Shift response was not in the expected shape.");
  return { created, unchanged, warnings: parseWarnings(data.warnings) };
}

export interface PreviewItem {
  userId: string;
  shiftId: string;
  workDate: string;
  startTime: string | null;
  endTime: string | null;
  startsAt: string | null;
  endsAt: string | null;
  status: "new" | "existing";
}

export interface PreviewBlocking {
  status: number | null;
  code: string | null;
  message: string | null;
  conflicts: ScheduleConflict[];
  warnings: ScheduleWarning[];
}

export interface PreviewResult {
  ok: boolean;
  createCount: number;
  unchangedCount: number;
  warnings: ScheduleWarning[];
  blocking: PreviewBlocking | null;
  items: PreviewItem[];
}

/** Validates a create / recurring batch with the server's own rules and writes nothing. */
export async function previewShifts(inputs: readonly ShiftInput[]): Promise<PreviewResult> {
  const root = rec(await api.post<unknown>("/schedules/assignments/preview", { assignments: inputs.map(itemBody) }));
  const data = root ? rec(root.data) : null;
  if (!data || typeof data.ok !== "boolean") throw new Error("Preview response was not in the expected shape.");
  const blocking = rec(data.blocking);
  const items = Array.isArray(data.items)
    ? data.items.flatMap((raw): PreviewItem[] => {
        const row = rec(raw);
        const userId = row ? str(row.user_id) : null;
        const shiftId = row ? str(row.shift_id) : null;
        const workDate = row ? str(row.work_date)?.slice(0, 10) ?? null : null;
        return row && userId && shiftId && workDate
          ? [{ userId, shiftId, workDate, startTime: str(row.start_time), endTime: str(row.end_time), startsAt: str(row.starts_at), endsAt: str(row.ends_at), status: row.status === "existing" ? "existing" : "new" }]
          : [];
      })
    : [];
  return {
    ok: data.ok,
    createCount: num(data.create_count) ?? 0,
    unchangedCount: num(data.unchanged_count) ?? 0,
    warnings: parseWarnings(data.warnings),
    blocking: blocking ? { status: num(blocking.status), code: str(blocking.code), message: str(blocking.detail), conflicts: parseConflicts(blocking.conflicts), warnings: parseWarnings(blocking.warnings) } : null,
    items,
  };
}

/* ─── Shift detail ────────────────────────────────────────────────────────── */

export interface AttendanceSession {
  status: "active" | "on_break" | "ended" | "unknown";
  startedAt: string | null;
  endedAt: string | null;
  onBreakSince: string | null;
  breakSeconds: number;
}

export interface ShiftDetail {
  shift: TeamShift;
  createdAt: string | null;
  updatedAt: string | null;
  departmentCode: string | null;
  attendance: { applicable: boolean; verified: boolean; sessions: AttendanceSession[] };
  rooms: { applicable: boolean; available: boolean; count: number | null };
  /** The shift's date has not passed (the server also refuses edits to shifts with recorded attendance). */
  editable: boolean;
}

function parseSession(raw: unknown): AttendanceSession | null {
  const row = rec(raw);
  const startedAt = row ? str(row.started_at) : null;
  if (!row || !startedAt) return null;
  const status = row.status === "active" || row.status === "on_break" || row.status === "ended" ? row.status : "unknown";
  return { status, startedAt, endedAt: str(row.ended_at), onBreakSince: str(row.on_break_since), breakSeconds: num(row.break_seconds) ?? 0 };
}

export async function fetchShiftDetail(id: string): Promise<ShiftDetail> {
  const root = rec(await api.get<unknown>(`/schedules/assignments/${encodeURIComponent(id)}/detail`));
  const data = root ? rec(root.data) : null;
  const assignment = data ? rec(data.assignment) : null;
  const shift = assignment ? parseTeamShift(assignment) : null;
  const attendance = data ? rec(data.attendance) : null;
  const rooms = data ? rec(data.rooms) : null;
  if (!data || !assignment || !shift || !attendance || !rooms) throw new Error("Shift detail response was not in the expected shape.");
  return {
    shift,
    createdAt: str(assignment.created_at),
    updatedAt: str(assignment.updated_at),
    departmentCode: str(data.department_code),
    attendance: {
      applicable: attendance.applicable === true,
      verified: attendance.verified === true,
      sessions: Array.isArray(attendance.sessions) ? attendance.sessions.map(parseSession).filter((s): s is AttendanceSession => s !== null) : [],
    },
    rooms: { applicable: rooms.applicable === true, available: rooms.available === true, count: num(rooms.count) },
    editable: data.editable === true,
  };
}
