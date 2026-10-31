import type { TeamPerson, TeamSchedule, TeamShift, WorkforceStatus } from "@/lib/api/schedulingTeam";

/* Shared builders for the Team Schedule tests. The wire builders produce exactly what GET /schedules/team sends
   (snake_case), so the parser is exercised against the real contract; the model builders produce parsed objects. */

export const ZONE = "America/Chicago";
/** Wednesday 2026-10-28, 10:00 in Chicago (CDT, UTC−5). */
export const TODAY = "2026-10-28";
export const NOW_MS = Date.parse("2026-10-28T15:00:00Z");

export interface WireShift {
  id: string;
  user_id: string;
  work_date: string;
  start_time: string;
  end_time: string;
  starts_at: string;
  ends_at: string;
  shift_name?: string | null;
  shift_id?: string;
  publication_state?: string;
  carried_from_previous_day?: boolean;
  workforce_status?: string;
  notes?: string | null;
  version?: number;
}

/** 07:00–15:30 Chicago on 2026-10-28. */
export function wireShift(overrides: Partial<WireShift> = {}): WireShift {
  return {
    id: "a1",
    user_id: "u1",
    shift_id: "t1",
    work_date: TODAY,
    shift_name: "Morning",
    start_time: "07:00:00",
    end_time: "15:30:00",
    starts_at: "2026-10-28T12:00:00+00:00",
    ends_at: "2026-10-28T20:30:00+00:00",
    publication_state: "published",
    carried_from_previous_day: false,
    version: 1,
    ...overrides,
  };
}

export function wirePerson(userId: string, name: string, extra: Record<string, unknown> = {}) {
  return { user_id: userId, full_name: name, roles: ["housekeeper"], department_id: "d1", department_code: "housekeeping", scheduled: true, ...extra };
}

export function wirePage(opts: {
  staff: unknown[];
  assignments: unknown[];
  total?: number;
  hasMore?: boolean;
  verified?: boolean;
  requested?: boolean;
  asOf?: string | null;
  truncated?: boolean;
  page?: number;
  dateFrom?: string;
  dateTo?: string;
}) {
  return {
    data: { staff: opts.staff, assignments: opts.assignments },
    meta: {
      state: opts.staff.length ? "ok" : "empty",
      generated_at: "2026-10-28T15:00:00+00:00",
      hotel_today: TODAY,
      date_from: opts.dateFrom ?? TODAY,
      date_to: opts.dateTo ?? opts.dateFrom ?? TODAY,
      revision: "rev1",
      attendance: { requested: opts.requested ?? false, verified: opts.verified ?? false, source: "hk_shift_sessions", as_of: opts.asOf ?? null },
      counts: {},
      pagination: { page: opts.page ?? 1, per_page: 200, total: opts.total ?? opts.staff.length, has_more: opts.hasMore ?? false },
      truncated: opts.truncated ?? false,
      staff_without_department: 0,
      max_range_days: 42,
    },
  };
}

export function shift(overrides: Partial<TeamShift> = {}): TeamShift {
  return {
    id: "a1",
    userId: "u1",
    shiftId: "t1",
    workDate: TODAY,
    name: "Morning",
    departmentId: "d1",
    startTime: "07:00:00",
    endTime: "15:30:00",
    startsAt: "2026-10-28T12:00:00Z",
    endsAt: "2026-10-28T20:30:00Z",
    publication: "published",
    notes: null,
    carriedFromPreviousDay: false,
    status: null,
    version: 1,
    ...overrides,
  };
}

export function person(userId: string, name: string | null, status: WorkforceStatus | null = null, extra: Partial<TeamPerson> = {}): TeamPerson {
  return { userId, name, roles: ["housekeeper"], departmentId: "d1", departmentCode: "housekeeping", scheduled: true, status, ...extra };
}

export function schedule(overrides: Partial<TeamSchedule> = {}): TeamSchedule {
  const people = overrides.people ?? [];
  return {
    dateFrom: TODAY,
    dateTo: TODAY,
    hotelToday: TODAY,
    generatedAt: "2026-10-28T15:00:00Z",
    people,
    shifts: [],
    attendance: { requested: false, verified: false, asOf: null },
    totalPeople: people.length,
    complete: true,
    serverTruncated: false,
    unreadableShifts: 0,
    revision: "rev1",
    ...overrides,
  };
}

export const CTX = { zone: ZONE, language: "en", nowMs: NOW_MS };
