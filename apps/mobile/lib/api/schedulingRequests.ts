import { api } from "./client";

/* ─── Availability, time off and shift swaps (Team Scheduling Phase 5) ──────
   Every function here is a real server call; nothing is held locally, so a screen can only say "approved" after the server
   answered with a record whose status is `approved`.

   Rules the callers rely on
     - WHO is acting is the signed-in session. No call here sends a user id for a self-service action.
     - Availability is what an employee SAYS they can work. A day with nothing submitted is `unset` (unknown), never "available".
     - Approving time off records a decision; it does not move a shift. `impact` lists the shifts still on the schedule.
     - A coworker accepting a swap changes no schedule; only `approveSwap` does, atomically for both people.
     - `expectedVersion` travels with every decision; a 409 means someone else changed the record (see `classifyRequestFailure`). */

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
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function codes(value: unknown): string[] {
  return list(value).filter((item): item is string => typeof item === "string");
}
function keep<T>(items: Array<T | null>): T[] {
  return items.filter((item): item is T => item !== null);
}
function dataOf(body: unknown, what: string): Raw {
  const root = rec(body);
  const data = root ? rec(root.data) : null;
  if (!data) throw new Error(`${what} response was not in the expected shape.`);
  return data;
}
function rowsOf(body: unknown, what: string): { rows: unknown[]; meta: Raw } {
  const root = rec(body);
  if (!root || !Array.isArray(root.data)) throw new Error(`${what} response was not in the expected shape.`);
  return { rows: root.data, meta: rec(root.meta) ?? {} };
}

export function newRequestKey(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ─── Shared shapes ───────────────────────────────────────────────────────── */

export interface Person {
  id: string;
  name: string | null;
  role: string | null;
}

export function parsePerson(raw: unknown): Person | null {
  const row = rec(raw);
  const id = row ? str(row.id) : null;
  return row && id ? { id, name: str(row.name), role: str(row.role) } : null;
}

export interface ShiftBrief {
  id: string;
  workDate: string;
  shiftName: string | null;
  startTime: string | null;
  endTime: string | null;
  startsAt: string | null;
  endsAt: string | null;
  version: number;
  userId: string | null;
}

export function parseShiftBrief(raw: unknown): ShiftBrief | null {
  const row = rec(raw);
  const id = row ? str(row.id) : null;
  const workDate = row ? str(row.work_date) : null;
  if (!row || !id || !workDate) return null;
  return {
    id, workDate: workDate.slice(0, 10), shiftName: str(row.shift_name), startTime: str(row.start_time), endTime: str(row.end_time),
    startsAt: str(row.starts_at), endsAt: str(row.ends_at), version: num(row.version) ?? 1, userId: str(row.user_id),
  };
}

export interface TimelineEvent {
  id: string;
  action: string;
  at: string | null;
  actorName: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  reason: string | null;
}

function parseTimeline(raw: unknown): TimelineEvent[] {
  return keep(list(raw).map((item, index) => {
    const row = rec(item);
    const action = row ? str(row.action) : null;
    return row && action ? { id: str(row.id) ?? String(index), action, at: str(row.at), actorName: str(row.actor_name), fromStatus: str(row.from_status), toStatus: str(row.to_status), reason: str(row.reason) } : null;
  }));
}

/* ─── Availability ────────────────────────────────────────────────────────── */

export interface Window {
  start: string;
  end: string;
}
export type DayState = "available" | "unavailable" | "unset";
export interface DayRule {
  /** 0 = Monday … 6 = Sunday. */
  weekday: number;
  state: DayState;
  windows: Window[];
}
export interface AvailabilityException {
  id: string;
  date: string;
  mode: "available" | "unavailable";
  windows: Window[];
  note: string | null;
  version: number;
}
export type Freshness = "none" | "current" | "stale";

export interface ShiftClash extends ShiftBrief {
  availability: "unavailable" | "outside";
}

function parseWindows(raw: unknown): Window[] {
  return keep(list(raw).map((item) => {
    const row = rec(item);
    const start = row ? str(row.start) : null;
    const end = row ? str(row.end) : null;
    return start && end ? { start: start.slice(0, 5), end: end.slice(0, 5) } : null;
  }));
}

function parseWeek(raw: unknown): DayRule[] {
  const byDay = new Map<number, DayRule>();
  for (const item of list(raw)) {
    const row = rec(item);
    const weekday = row ? num(row.weekday) : null;
    if (!row || weekday === null || weekday < 0 || weekday > 6) continue;
    const state = row.state === "available" || row.state === "unavailable" ? row.state : "unset";
    byDay.set(weekday, { weekday, state, windows: state === "available" ? parseWindows(row.windows) : [] });
  }
  return Array.from({ length: 7 }, (_, weekday) => byDay.get(weekday) ?? { weekday, state: "unset" as const, windows: [] });
}

function parseException(raw: unknown): AvailabilityException | null {
  const row = rec(raw);
  const id = row ? str(row.id) : null;
  const date = row ? str(row.exception_date) : null;
  if (!row || !id || !date) return null;
  return { id, date: date.slice(0, 10), mode: row.mode === "available" ? "available" : "unavailable", windows: parseWindows(row.windows), note: str(row.note), version: num(row.version) ?? 1 };
}

function freshnessOf(value: unknown): Freshness {
  return value === "current" || value === "stale" ? value : "none";
}

export interface MyAvailability {
  revision: number;
  weekly: DayRule[];
  upcomingChange: { effectiveFrom: string; weekly: DayRule[] } | null;
  exceptions: AvailabilityException[];
  submitted: boolean;
  lastUpdatedAt: string | null;
  freshness: Freshness;
  hotelToday: string | null;
}

function parseMyAvailability(data: Raw): MyAvailability {
  const upcoming = rec(data.upcoming_change);
  const from = upcoming ? str(upcoming.effective_from) : null;
  return {
    revision: num(data.revision) ?? 0,
    weekly: parseWeek(data.weekly),
    upcomingChange: upcoming && from ? { effectiveFrom: from.slice(0, 10), weekly: parseWeek(upcoming.weekly) } : null,
    exceptions: keep(list(data.exceptions).map(parseException)),
    submitted: data.submitted === true,
    lastUpdatedAt: str(data.last_updated_at),
    freshness: freshnessOf(data.freshness),
    hotelToday: str(data.hotel_today),
  };
}

export async function fetchMyAvailability(): Promise<MyAvailability> {
  return parseMyAvailability(dataOf(await api.get<unknown>("/schedules/me/availability"), "Availability"));
}

export interface AvailabilitySaved {
  availability: MyAvailability;
  /** Upcoming published shifts the new hours clash with. Saving never changes them. */
  clashes: ShiftClash[];
  replayed: boolean;
}

function parseClashes(meta: Raw): ShiftClash[] {
  return keep(list(meta.shift_clashes).map((item) => {
    const shift = parseShiftBrief(item);
    const row = rec(item);
    return shift && row ? { ...shift, availability: row.availability === "unavailable" ? ("unavailable" as const) : ("outside" as const) } : null;
  }));
}

export interface WeekInput {
  expectedRevision: number;
  /** Hotel-local YYYY-MM-DD; omitted = today. */
  effectiveFrom?: string | null;
  days: Array<{ weekday: number; mode: "available" | "unavailable"; windows: Window[] }>;
}

export async function saveMyAvailability(input: WeekInput): Promise<AvailabilitySaved> {
  const body = await api.put<unknown>("/schedules/me/availability", {
    expected_revision: input.expectedRevision,
    ...(input.effectiveFrom ? { effective_from: input.effectiveFrom } : {}),
    days: input.days.map((d) => ({ weekday: d.weekday, mode: d.mode, windows: d.mode === "available" ? d.windows : [] })),
  });
  const meta = rec(rec(body)?.meta) ?? {};
  return { availability: parseMyAvailability(dataOf(body, "Availability")), clashes: parseClashes(meta), replayed: meta.replayed === true };
}

export async function addAvailabilityException(input: { date: string; mode: "available" | "unavailable"; windows: Window[]; note?: string | null }): Promise<{ exception: AvailabilityException; clashes: ShiftClash[] }> {
  const body = await api.post<unknown>("/schedules/me/availability/exceptions", {
    exception_date: input.date, mode: input.mode, windows: input.mode === "available" ? input.windows : [], ...(input.note ? { note: input.note } : {}),
  });
  const exception = parseException(dataOf(body, "Availability"));
  if (!exception) throw new Error("Availability response was not in the expected shape.");
  return { exception, clashes: parseClashes(rec(rec(body)?.meta) ?? {}) };
}

export async function retireAvailability(id: string, expectedVersion: number): Promise<void> {
  await api.post<unknown>(`/schedules/availability/${encodeURIComponent(id)}/retire`, { expected_version: expectedVersion });
}

export interface LeaveBrief {
  id: string;
  startDate: string;
  endDate: string;
  partial: boolean;
  status: string;
}

function parseLeaveBrief(raw: unknown): LeaveBrief | null {
  const row = rec(raw);
  const id = row ? str(row.id) : null;
  const startDate = row ? str(row.start_date) : null;
  const endDate = row ? str(row.end_date) : null;
  return row && id && startDate && endDate ? { id, startDate: startDate.slice(0, 10), endDate: endDate.slice(0, 10), partial: row.partial === true, status: str(row.status) ?? "pending" } : null;
}

export interface TeamAvailabilityPerson extends Person {
  weekly: DayRule[];
  exceptionCount: number;
  exceptions: AvailabilityException[];
  submitted: boolean;
  freshness: Freshness;
  lastUpdatedAt: string | null;
  leave: LeaveBrief[];
}

function parseTeamPerson(raw: unknown): TeamAvailabilityPerson | null {
  const row = rec(raw);
  const person = parsePerson(row);
  if (!row || !person) return null;
  return {
    ...person, weekly: parseWeek(row.weekly), exceptionCount: num(row.exception_count) ?? 0, exceptions: keep(list(row.exceptions).map(parseException)),
    submitted: row.submitted === true, freshness: freshnessOf(row.freshness), lastUpdatedAt: str(row.last_updated_at), leave: keep(list(row.leave).map(parseLeaveBrief)),
  };
}

export type TeamAvailabilityFilter = "all" | "submitted" | "none" | "stale";

export async function fetchTeamAvailability(options: { q?: string; filter?: TeamAvailabilityFilter } = {}): Promise<{ people: TeamAvailabilityPerson[]; total: number; truncated: boolean }> {
  const params = [options.q?.trim() ? `q=${encodeURIComponent(options.q.trim())}` : "", options.filter && options.filter !== "all" ? `filter=${options.filter}` : ""].filter(Boolean).join("&");
  const { rows, meta } = rowsOf(await api.get<unknown>(`/schedules/availability/team${params ? `?${params}` : ""}`), "Team availability");
  return { people: keep(rows.map(parseTeamPerson)), total: num(meta.total) ?? rows.length, truncated: meta.truncated === true };
}

export interface MemberAvailability extends TeamAvailabilityPerson {
  upcomingChange: MyAvailability["upcomingChange"];
  clashes: ShiftClash[];
}

export async function fetchMemberAvailability(userId: string): Promise<MemberAvailability> {
  const body = await api.get<unknown>(`/schedules/availability/team/${encodeURIComponent(userId)}`);
  const data = dataOf(body, "Availability");
  const person = parseTeamPerson(data);
  if (!person) throw new Error("Availability response was not in the expected shape.");
  const mine = parseMyAvailability(data);
  return { ...person, exceptions: mine.exceptions, exceptionCount: mine.exceptions.length, upcomingChange: mine.upcomingChange, clashes: parseClashes({ shift_clashes: data.shift_clashes }) };
}

/* ─── Time off ────────────────────────────────────────────────────────────── */

export type ReasonCategory = "vacation" | "personal" | "family" | "appointment" | "health" | "other";
export const REASON_CATEGORIES: readonly ReasonCategory[] = ["vacation", "personal", "family", "appointment", "health", "other"];
export type LeaveStatus = "pending" | "approved" | "denied" | "cancelled";

export interface ImpactShift extends ShiftBrief {
  overlap: "full" | "partial";
  resolved: boolean;
  coverage: { gapId: string | null; status: string; resolution: string | null; replacement: Person | null } | null;
}

export interface LeaveImpact {
  /** false = the schedule could not be read; nothing below is a count. */
  verified: boolean;
  shiftCount: number | null;
  unresolvedCount: number | null;
  shifts: ImpactShift[];
}

function parseImpact(raw: unknown): LeaveImpact {
  const row = rec(raw);
  if (!row || row.verified !== true) return { verified: false, shiftCount: null, unresolvedCount: null, shifts: [] };
  return {
    verified: true, shiftCount: num(row.shift_count), unresolvedCount: num(row.unresolved_count),
    shifts: keep(list(row.shifts).map((item) => {
      const shift = parseShiftBrief(item);
      const r = rec(item);
      if (!shift || !r) return null;
      const cov = rec(r.coverage);
      return {
        ...shift, overlap: r.overlap === "partial" ? ("partial" as const) : ("full" as const), resolved: r.resolved === true,
        coverage: cov ? { gapId: str(cov.gap_id), status: str(cov.status) ?? "open", resolution: str(cov.resolution), replacement: parsePerson(cov.replacement) } : null,
      };
    })),
  };
}

export interface TimeOffRequest {
  id: string;
  status: LeaveStatus;
  user: Person;
  startDate: string;
  endDate: string;
  partial: boolean;
  startTime: string | null;
  endTime: string | null;
  reason: ReasonCategory;
  note: string | null;
  decisionReason: string | null;
  cancelReason: string | null;
  decidedBy: Person | null;
  decidedAt: string | null;
  createdAt: string | null;
  version: number;
  impact: LeaveImpact;
  can: { approve: boolean; deny: boolean; cancel: boolean; cancelNeedsReason: boolean };
  timeline: TimelineEvent[];
  viewer: "self" | "manager";
}

function statusOfLeave(value: unknown): LeaveStatus {
  return value === "approved" || value === "denied" || value === "cancelled" ? value : "pending";
}

export function parseTimeOff(raw: unknown): TimeOffRequest | null {
  const row = rec(raw);
  const id = row ? str(row.id) : null;
  const user = row ? parsePerson(row.user) : null;
  const startDate = row ? str(row.start_date) : null;
  const endDate = row ? str(row.end_date) : null;
  if (!row || !id || !user || !startDate || !endDate) return null;
  const can = rec(row.can) ?? {};
  const reason = REASON_CATEGORIES.find((c) => c === row.reason_category) ?? "other";
  return {
    id, status: statusOfLeave(row.status), user, startDate: startDate.slice(0, 10), endDate: endDate.slice(0, 10), partial: row.partial === true,
    startTime: str(row.start_time), endTime: str(row.end_time), reason, note: str(row.note), decisionReason: str(row.decision_reason),
    cancelReason: str(row.cancel_reason), decidedBy: parsePerson(row.decided_by), decidedAt: str(row.decided_at), createdAt: str(row.created_at),
    version: num(row.version) ?? 1, impact: parseImpact(row.impact),
    can: { approve: can.approve === true, deny: can.deny === true, cancel: can.cancel === true, cancelNeedsReason: can.cancel_needs_reason === true },
    timeline: parseTimeline(row.timeline), viewer: row.viewer === "manager" ? "manager" : "self",
  };
}

function oneLeave(body: unknown): TimeOffRequest {
  const leave = parseTimeOff(dataOf(body, "Time-off"));
  if (!leave) throw new Error("Time-off response was not in the expected shape.");
  return leave;
}

export interface TimeOffInput {
  startDate: string;
  endDate: string;
  partial: boolean;
  startTime?: string | null;
  endTime?: string | null;
  reason: ReasonCategory;
  note?: string | null;
  idempotencyKey: string;
}

export async function createTimeOff(input: TimeOffInput): Promise<TimeOffRequest> {
  return oneLeave(await api.post<unknown>("/schedules/me/time-off", {
    start_date: input.startDate, end_date: input.endDate, partial: input.partial,
    ...(input.partial ? { start_time: input.startTime, end_time: input.endTime } : {}),
    reason_category: input.reason, ...(input.note?.trim() ? { note: input.note.trim() } : {}), idempotency_key: input.idempotencyKey,
  }));
}
export async function fetchTimeOff(id: string): Promise<TimeOffRequest> {
  return oneLeave(await api.get<unknown>(`/schedules/time-off/${encodeURIComponent(id)}`));
}
export async function approveTimeOff(id: string, expectedVersion: number): Promise<{ request: TimeOffRequest; followUpRequired: boolean }> {
  const body = await api.post<unknown>(`/schedules/time-off/${encodeURIComponent(id)}/approve`, { expected_version: expectedVersion });
  return { request: oneLeave(body), followUpRequired: rec(rec(body)?.meta)?.follow_up_required === true };
}
export async function denyTimeOff(id: string, expectedVersion: number, reason: string): Promise<TimeOffRequest> {
  return oneLeave(await api.post<unknown>(`/schedules/time-off/${encodeURIComponent(id)}/deny`, { expected_version: expectedVersion, reason }));
}
export async function cancelTimeOff(id: string, expectedVersion: number, reason?: string | null): Promise<TimeOffRequest> {
  return oneLeave(await api.post<unknown>(`/schedules/time-off/${encodeURIComponent(id)}/cancel`, { expected_version: expectedVersion, ...(reason?.trim() ? { reason: reason.trim() } : {}) }));
}

/* ─── Shift swaps ─────────────────────────────────────────────────────────── */

export type SwapStatus = "proposed" | "accepted" | "declined" | "cancelled" | "expired" | "approved" | "denied";
const SWAP_STATUSES: readonly SwapStatus[] = ["proposed", "accepted", "declined", "cancelled", "expired", "approved", "denied"];

export interface Finding {
  code: string;
  userId: string | null;
}

function parseFindings(raw: unknown): Finding[] {
  return keep(list(raw).map((item) => {
    const row = rec(item);
    const code = row ? str(row.code) : null;
    return code ? { code, userId: row ? str(row.user_id) : null } : null;
  }));
}

export interface SwapRequest {
  id: string;
  status: SwapStatus;
  requester: Person;
  counterpart: Person;
  requesterShift: ShiftBrief | null;
  counterpartShift: ShiftBrief | null;
  note: string | null;
  responseNote: string | null;
  decisionReason: string | null;
  decidedBy: Person | null;
  expiresAt: string | null;
  createdAt: string | null;
  version: number;
  /** null once the swap is over; otherwise the server's CURRENT view of whether the exchange would be valid. */
  analysis: { blockers: Finding[]; warnings: Finding[] } | null;
  can: { respond: boolean; cancel: boolean; approve: boolean; deny: boolean };
  timeline: TimelineEvent[];
  viewer: "requester" | "counterpart" | "manager";
}

export function parseSwap(raw: unknown): SwapRequest | null {
  const row = rec(raw);
  const id = row ? str(row.id) : null;
  const requester = row ? parsePerson(row.requester) : null;
  const counterpart = row ? parsePerson(row.counterpart) : null;
  if (!row || !id || !requester || !counterpart) return null;
  const analysis = rec(row.analysis);
  const can = rec(row.can) ?? {};
  return {
    id, status: SWAP_STATUSES.find((s) => s === row.status) ?? "proposed", requester, counterpart,
    requesterShift: parseShiftBrief(row.requester_shift), counterpartShift: parseShiftBrief(row.counterpart_shift),
    note: str(row.note), responseNote: str(row.response_note), decisionReason: str(row.decision_reason), decidedBy: parsePerson(row.decided_by),
    expiresAt: str(row.expires_at), createdAt: str(row.created_at), version: num(row.version) ?? 1,
    analysis: analysis ? { blockers: parseFindings(analysis.blockers), warnings: parseFindings(analysis.warnings) } : null,
    can: { respond: can.respond === true, cancel: can.cancel === true, approve: can.approve === true, deny: can.deny === true },
    timeline: parseTimeline(row.timeline),
    viewer: row.viewer === "requester" || row.viewer === "counterpart" ? row.viewer : "manager",
  };
}

function oneSwap(body: unknown): SwapRequest {
  const swap = parseSwap(dataOf(body, "Swap"));
  if (!swap) throw new Error("Swap response was not in the expected shape.");
  return swap;
}

export interface SwapOption {
  person: Person;
  shifts: Array<ShiftBrief & { warnings: string[] }>;
}

export async function fetchSwapOptions(assignmentId: string): Promise<{ options: SwapOption[]; myShift: ShiftBrief | null; reason: string | null }> {
  const { rows, meta } = rowsOf(await api.get<unknown>(`/schedules/me/swap-options?assignment_id=${encodeURIComponent(assignmentId)}`), "Swap options");
  return {
    options: keep(rows.map((item) => {
      const row = rec(item);
      const person = row ? parsePerson(row.person) : null;
      if (!row || !person) return null;
      return { person, shifts: keep(list(row.shifts).map((s) => { const shift = parseShiftBrief(s); return shift ? { ...shift, warnings: codes(rec(s)?.warnings) } : null; })) };
    })).filter((o) => o.shifts.length > 0),
    myShift: parseShiftBrief(meta.my_shift), reason: str(meta.reason),
  };
}

export async function proposeSwap(input: { myAssignmentId: string; theirAssignmentId: string; note?: string | null; idempotencyKey: string }): Promise<SwapRequest> {
  return oneSwap(await api.post<unknown>("/schedules/me/swaps", {
    requester_assignment_id: input.myAssignmentId, counterpart_assignment_id: input.theirAssignmentId,
    ...(input.note?.trim() ? { note: input.note.trim() } : {}), idempotency_key: input.idempotencyKey,
  }));
}
export async function fetchSwap(id: string): Promise<SwapRequest> {
  return oneSwap(await api.get<unknown>(`/schedules/swaps/${encodeURIComponent(id)}`));
}
export async function respondToSwap(id: string, expectedVersion: number, accept: boolean, note?: string | null): Promise<SwapRequest> {
  return oneSwap(await api.post<unknown>(`/schedules/swaps/${encodeURIComponent(id)}/respond`, { accept, expected_version: expectedVersion, ...(note?.trim() ? { note: note.trim() } : {}) }));
}
export async function cancelSwap(id: string, expectedVersion: number, reason?: string | null): Promise<SwapRequest> {
  return oneSwap(await api.post<unknown>(`/schedules/swaps/${encodeURIComponent(id)}/cancel`, { expected_version: expectedVersion, ...(reason?.trim() ? { reason: reason.trim() } : {}) }));
}
export async function approveSwap(id: string, expectedVersion: number, acknowledgeWarnings: boolean): Promise<SwapRequest> {
  return oneSwap(await api.post<unknown>(`/schedules/swaps/${encodeURIComponent(id)}/approve`, { expected_version: expectedVersion, acknowledge_warnings: acknowledgeWarnings }));
}
export async function denySwap(id: string, expectedVersion: number, reason: string): Promise<SwapRequest> {
  return oneSwap(await api.post<unknown>(`/schedules/swaps/${encodeURIComponent(id)}/deny`, { expected_version: expectedVersion, reason }));
}

/* ─── The request lists ───────────────────────────────────────────────────── */

export type RequestType = "time_off" | "shift_swap";
export type StatusGroup = "pending" | "approved" | "denied" | "cancelled";

export interface RequestItem {
  type: RequestType;
  id: string;
  /** The record's own status (a LeaveStatus or SwapStatus). */
  status: string;
  statusGroup: StatusGroup;
  user: Person;
  counterpart: Person | null;
  dateFrom: string | null;
  dateTo: string | null;
  submittedAt: string | null;
  version: number;
  needsAction: boolean;
  needsMyResponse: boolean;
  leave: { partial: boolean; startTime: string | null; endTime: string | null; reason: ReasonCategory } | null;
  swap: { requesterShift: ShiftBrief | null; counterpartShift: ShiftBrief | null; expiresAt: string | null } | null;
  /** Only a verified count; `null` when the schedule could not be read. */
  shiftCount: number | null;
}

function parseItem(raw: unknown): RequestItem | null {
  const row = rec(raw);
  const id = row ? str(row.id) : null;
  const user = row ? parsePerson(row.user) : null;
  if (!row || !id || !user || (row.type !== "time_off" && row.type !== "shift_swap")) return null;
  const leave = rec(row.leave);
  const swap = rec(row.swap);
  const impact = rec(row.impact);
  const group = row.status_group === "approved" || row.status_group === "denied" || row.status_group === "cancelled" ? row.status_group : "pending";
  return {
    type: row.type, id, status: str(row.status) ?? "pending", statusGroup: group, user, counterpart: parsePerson(row.counterpart),
    dateFrom: str(row.date_from), dateTo: str(row.date_to), submittedAt: str(row.submitted_at), version: num(row.version) ?? 1,
    needsAction: row.needs_action === true, needsMyResponse: row.needs_my_response === true,
    leave: leave ? { partial: leave.partial === true, startTime: str(leave.start_time), endTime: str(leave.end_time), reason: REASON_CATEGORIES.find((c) => c === leave.reason_category) ?? "other" } : null,
    swap: swap ? { requesterShift: parseShiftBrief(swap.requester_shift), counterpartShift: parseShiftBrief(swap.counterpart_shift), expiresAt: str(swap.expires_at) } : null,
    shiftCount: impact && impact.verified === true ? num(impact.shift_count) : null,
  };
}

export interface RequestList {
  items: RequestItem[];
  counts: Record<string, number>;
  unreadable: number;
  truncated: boolean;
}

function parseList(body: unknown, what: string): RequestList {
  const { rows, meta } = rowsOf(body, what);
  const parsed = rows.map(parseItem);
  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(rec(meta.counts) ?? {})) if (typeof value === "number") counts[key] = value;
  return { items: keep(parsed), counts, unreadable: parsed.filter((item) => item === null).length, truncated: meta.truncated === true };
}

export interface InboxQuery {
  type?: "all" | RequestType;
  status?: "pending" | "approved" | "denied" | "all";
  dateFrom?: string | null;
  dateTo?: string | null;
  q?: string;
}

export async function fetchManagerRequests(query: InboxQuery = {}): Promise<RequestList> {
  const params = [
    `type=${query.type ?? "all"}`, `status=${query.status ?? "pending"}`,
    query.dateFrom ? `date_from=${query.dateFrom}` : "", query.dateTo ? `date_to=${query.dateTo}` : "",
    query.q?.trim() ? `q=${encodeURIComponent(query.q.trim())}` : "",
  ].filter(Boolean).join("&");
  return parseList(await api.get<unknown>(`/schedules/requests?${params}`), "Requests");
}

export async function fetchMyRequests(): Promise<RequestList> {
  return parseList(await api.get<unknown>("/schedules/me/requests"), "Requests");
}

/* ─── Failures ────────────────────────────────────────────────────────────── */

export type RequestFailureKind = "signed_out" | "unconfirmed" | "forbidden" | "not_found" | "conflict" | "invalid" | "other";

export interface RequestFailure {
  kind: RequestFailureKind;
  /** The server's stable code (or the kind when it sent none); the screen maps it to words. */
  key: string;
  status: number | null;
  message: string | null;
  blockers: string[];
  warnings: string[];
  /** The record changed under us: reload it and let the person decide again. */
  stale: boolean;
}

const STALE_CODES = new Set([
  "version_conflict", "availability_changed", "request_not_pending", "request_not_cancellable", "swap_not_proposed", "swap_not_accepted",
  "swap_not_approvable", "swap_not_cancellable", "swap_expired", "shift_changed", "leave_over", "availability_not_active", "shift_missing",
]);

function findingCodes(value: unknown): string[] {
  return list(value).flatMap((item) => {
    if (typeof item === "string") return [item];
    const code = rec(item) ? str(rec(item)?.code) : null;
    return code ? [code] : [];
  });
}

/** Classify without `instanceof`, so it works when a test mocks the client module. */
export function classifyRequestFailure(error: unknown): RequestFailure {
  const raw = error as { status?: unknown; code?: unknown; message?: unknown; body?: unknown; detail?: unknown } | null;
  const status = typeof raw?.status === "number" ? raw.status : null;
  const body = rec(raw?.body) ?? rec(raw?.detail);
  const code = typeof raw?.code === "string" ? raw.code : body ? str(body.code) : null;
  const message = typeof raw?.message === "string" && raw.message ? raw.message : null;
  const blockers = findingCodes(body?.blockers);
  const warnings = findingCodes(body?.warnings);
  const base = { status, message, blockers, warnings, stale: code !== null && STALE_CODES.has(code) };
  if (status === null) {
    const signedOut = /not authenticated|session expired/i.test(message ?? "");
    return { ...base, kind: signedOut ? "signed_out" : "unconfirmed", key: signedOut ? "signed_out" : "unconfirmed" };
  }
  if (status === 401) return { ...base, kind: "signed_out", key: "signed_out" };
  if (status >= 500) return { ...base, kind: "unconfirmed", key: "unconfirmed" };
  const kind: RequestFailureKind = status === 403 ? "forbidden" : status === 404 ? "not_found" : status === 409 ? "conflict" : status === 422 ? "invalid" : "other";
  return { ...base, kind, key: code ?? kind };
}
