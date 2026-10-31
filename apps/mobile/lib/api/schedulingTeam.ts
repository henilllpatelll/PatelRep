import { api } from "./client";

/* ─── GET /schedules/team ───────────────────────────────────────────────────
   The supervisor's team-wide schedule (Team Scheduling Phase 1). Read-only here.

     plan        shift_assignments     who is scheduled when (hotel-local dates)
     attendance  hk_shift_sessions     only when `include_attendance=true`, single day; `meta.attendance.verified`
                                       says whether the server could actually read it

   The server paginates PEOPLE, not shifts. `fetchTeamSchedule` reads every page and refuses to return a partial
   answer: if any page fails the whole read fails, so a half-read hotel can never look like a complete one.
   A row the server sent that this client cannot read is counted (`unreadableShifts`), never silently dropped. */

export type WorkforceStatus = "scheduled" | "working" | "on_break" | "clocked_out" | "not_clocked_in" | "unknown";
export type ShiftPublication = "draft" | "published";

/** How a PROPOSED change shows over the published schedule. Only the draft preview sets it; the server never does. */
export type ProposalKind = "new" | "changed" | "cancelled";
export interface ShiftProposal {
  kind: ProposalKind;
  changeId: string;
}

export interface TeamPerson {
  userId: string;
  /** null = the server sent no usable name. */
  name: string | null;
  roles: string[];
  departmentId: string | null;
  departmentCode: string | null;
  /** The server's "has a shift in the requested range" flag. */
  scheduled: boolean;
  /** Present only when attendance was requested. */
  status: WorkforceStatus | null;
}

export interface TeamShift {
  id: string;
  userId: string;
  shiftId: string | null;
  /** Hotel-local calendar day the shift belongs to (YYYY-MM-DD). */
  workDate: string;
  name: string | null;
  departmentId: string | null;
  /** Hotel-local wall clock from the shift's own snapshot ("07:00:00"). */
  startTime: string | null;
  endTime: string | null;
  /** Absolute instants (ISO). */
  startsAt: string;
  endsAt: string;
  publication: ShiftPublication;
  notes: string | null;
  /** Began the day before the range and runs into it. */
  carriedFromPreviousDay: boolean;
  /** Present only when attendance was requested. */
  status: WorkforceStatus | null;
  version: number;
  /** Set only on a shift drawn from a pending draft (see lib/scheduling/draftOverlay). */
  proposal?: ShiftProposal;
}

export interface TeamAttendanceMeta {
  requested: boolean;
  /** The server read hk_shift_sessions successfully for every page. */
  verified: boolean;
  /** Oldest read time across pages (ISO), or null. */
  asOf: string | null;
}

export interface TeamSchedule {
  dateFrom: string;
  dateTo: string;
  /** The hotel's calendar day according to the server. */
  hotelToday: string | null;
  generatedAt: string | null;
  people: TeamPerson[];
  shifts: TeamShift[];
  attendance: TeamAttendanceMeta;
  /** People in scope across every page (not the page size). */
  totalPeople: number;
  /** Every page was read AND the server did not hit one of its own caps. */
  complete: boolean;
  /** The server hit its staff or shift cap, so more exist than were returned. */
  serverTruncated: boolean;
  /** Shift rows the server sent that this client could not read. */
  unreadableShifts: number;
  revision: string | null;
}

export interface TeamScheduleRequest {
  dateFrom: string;
  dateTo?: string;
  includeAttendance?: boolean;
  departmentId?: string | null;
  role?: string | null;
  userId?: string | null;
}

/** The server's per-page maximum; fewer round trips for a large hotel. */
export const TEAM_PER_PAGE = 200;
/** 8 × 200 covers the server's own 1,000-person cap with room to spare; more pages than this is a server bug. */
export const TEAM_MAX_PAGES = 8;

const WORKFORCE_STATUSES: ReadonlySet<string> = new Set(["scheduled", "working", "on_break", "clocked_out", "not_clocked_in", "unknown"]);
const YMD = /^\d{4}-\d{2}-\d{2}$/;

type Raw = Record<string, unknown>;

function asRecord(value: unknown): Raw | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** An unknown status string is `unknown` (never invented as one of the known ones); an absent one is null. */
function statusOf(value: unknown): WorkforceStatus | null {
  if (value === undefined || value === null) return null;
  return typeof value === "string" && WORKFORCE_STATUSES.has(value) ? (value as WorkforceStatus) : "unknown";
}

export function parseTeamPerson(raw: unknown): TeamPerson | null {
  const row = asRecord(raw);
  const userId = row ? str(row.user_id) : null;
  if (!row || !userId) return null;
  return {
    userId,
    name: str(row.full_name),
    roles: Array.isArray(row.roles) ? row.roles.filter((role): role is string => typeof role === "string") : [],
    departmentId: str(row.department_id),
    departmentCode: str(row.department_code),
    scheduled: row.scheduled === true,
    status: statusOf(row.workforce_status),
  };
}

function isInstant(value: string | null): value is string {
  return value !== null && !Number.isNaN(Date.parse(value));
}

export function parseTeamShift(raw: unknown): TeamShift | null {
  const row = asRecord(raw);
  if (!row) return null;
  const id = str(row.id);
  const userId = str(row.user_id);
  const workDate = str(row.work_date)?.slice(0, 10) ?? null;
  const startsAt = str(row.starts_at);
  const endsAt = str(row.ends_at);
  if (!id || !userId || !workDate || !YMD.test(workDate) || !isInstant(startsAt) || !isInstant(endsAt)) return null;
  const nested = asRecord(row.shifts);
  return {
    id,
    userId,
    shiftId: str(row.shift_id),
    workDate,
    name: str(row.shift_name) ?? (nested ? str(nested.name) : null),
    departmentId: str(row.department_id),
    startTime: str(row.start_time) ?? (nested ? str(nested.start_time) : null),
    endTime: str(row.end_time) ?? (nested ? str(nested.end_time) : null),
    startsAt,
    endsAt,
    // A cancelled row is never returned by the server; if one slips through it must not look scheduled.
    publication: row.publication_state === "draft" ? "draft" : "published",
    notes: str(row.notes),
    carriedFromPreviousDay: row.carried_from_previous_day === true,
    status: statusOf(row.workforce_status),
    version: typeof row.version === "number" ? row.version : 1,
  };
}

interface Page {
  people: TeamPerson[];
  shifts: TeamShift[];
  unreadableShifts: number;
  unreadablePeople: number;
  attendanceVerified: boolean;
  attendanceAsOf: string | null;
  hotelToday: string | null;
  generatedAt: string | null;
  total: number;
  hasMore: boolean;
  truncated: boolean;
  revision: string | null;
}

/** One response page, read strictly: a body that is not the documented envelope throws instead of reading as empty. */
export function parseTeamPage(body: unknown): Page {
  const root = asRecord(body);
  const data = root ? asRecord(root.data) : null;
  const meta = root ? asRecord(root.meta) : null;
  if (!data || !meta || !Array.isArray(data.staff) || !Array.isArray(data.assignments)) {
    throw new Error("Team schedule response was not in the expected shape.");
  }
  const people = data.staff.map(parseTeamPerson);
  const shifts = data.assignments.map(parseTeamShift);
  const attendance = asRecord(meta.attendance);
  const pagination = asRecord(meta.pagination);
  return {
    people: people.filter((p): p is TeamPerson => p !== null),
    shifts: shifts.filter((s): s is TeamShift => s !== null),
    unreadablePeople: people.filter((p) => p === null).length,
    unreadableShifts: shifts.filter((s) => s === null).length,
    attendanceVerified: attendance?.verified === true,
    attendanceAsOf: attendance ? str(attendance.as_of) : null,
    hotelToday: str(meta.hotel_today),
    generatedAt: str(meta.generated_at),
    total: pagination && typeof pagination.total === "number" ? pagination.total : data.staff.length,
    hasMore: pagination?.has_more === true,
    truncated: meta.truncated === true,
    revision: str(meta.revision),
  };
}

function queryFor(req: TeamScheduleRequest, page: number): string {
  const params = new URLSearchParams();
  params.set("date_from", req.dateFrom);
  params.set("date_to", req.dateTo ?? req.dateFrom);
  if (req.includeAttendance) params.set("include_attendance", "true");
  if (req.departmentId) params.set("department_id", req.departmentId);
  if (req.role) params.set("role", req.role);
  if (req.userId) params.set("user_id", req.userId);
  params.set("page", String(page));
  params.set("per_page", String(TEAM_PER_PAGE));
  return params.toString();
}

/**
 * Every page of the team schedule, merged. Throws if any page fails or is malformed, or if the server keeps
 * asking for pages past `TEAM_MAX_PAGES`. People and shifts are de-duplicated by id in case the roster changed
 * between two page requests.
 */
export async function fetchTeamSchedule(req: TeamScheduleRequest): Promise<TeamSchedule> {
  const people = new Map<string, TeamPerson>();
  const shifts = new Map<string, TeamShift>();
  let unreadableShifts = 0;
  let unreadablePeople = 0;
  let serverTruncated = false;
  let verified = true;
  let asOf: string | null = null;
  let hotelToday: string | null = null;
  let generatedAt: string | null = null;
  let revision: string | null = null;
  let total = 0;
  let done = false;

  for (let page = 1; page <= TEAM_MAX_PAGES && !done; page += 1) {
    const parsed = parseTeamPage(await api.get<unknown>(`/schedules/team?${queryFor(req, page)}`));
    for (const person of parsed.people) people.set(person.userId, person);
    for (const shift of parsed.shifts) shifts.set(shift.id, shift);
    unreadableShifts += parsed.unreadableShifts;
    unreadablePeople += parsed.unreadablePeople;
    serverTruncated = serverTruncated || parsed.truncated;
    verified = verified && parsed.attendanceVerified;
    // The OLDEST read time is the honest "as of" for a multi-page answer.
    if (parsed.attendanceAsOf && (asOf === null || parsed.attendanceAsOf < asOf)) asOf = parsed.attendanceAsOf;
    hotelToday = parsed.hotelToday ?? hotelToday;
    generatedAt = parsed.generatedAt ?? generatedAt;
    revision = parsed.revision ?? revision;
    total = parsed.total;
    done = !parsed.hasMore;
  }

  // The server still had more pages after the cap: the answer is incomplete, and says so.
  const allPagesRead = done;
  const includeAttendance = req.includeAttendance === true;
  const attendanceVerified = includeAttendance && verified && allPagesRead;
  const normalise = <T extends { status: WorkforceStatus | null }>(item: T): T =>
    includeAttendance && !attendanceVerified ? { ...item, status: "unknown" } : item;

  return {
    dateFrom: req.dateFrom,
    dateTo: req.dateTo ?? req.dateFrom,
    hotelToday,
    generatedAt,
    people: [...people.values()].map(normalise),
    shifts: [...shifts.values()].map(normalise),
    attendance: { requested: includeAttendance, verified: attendanceVerified, asOf: attendanceVerified ? asOf : null },
    totalPeople: total,
    complete: allPagesRead && !serverTruncated && unreadablePeople === 0 && people.size >= total,
    serverTruncated,
    unreadableShifts,
    revision,
  };
}
