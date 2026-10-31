/* Wire builders for the Phase 5 tests: exactly what the availability / time-off / swap / inbox endpoints send
   (snake_case), so the real parsers are exercised against the real contract. */

type Raw = Record<string, unknown>;

export const person = (id: string, name: string, role = "housekeeper"): Raw => ({ id, name, role });

export const wireWeek = (days: Record<number, { state: string; windows?: Array<{ start: string; end: string }> }> = {}): Raw[] =>
  Array.from({ length: 7 }, (_, weekday) => ({ weekday, state: days[weekday]?.state ?? "unset", windows: days[weekday]?.windows ?? [] }));

export const wireAvailability = (overrides: Raw = {}): Raw => ({
  revision: 0, weekly: wireWeek(), upcoming_change: null, exceptions: [], submitted: false, last_updated_at: null, freshness: "none", hotel_today: "2030-01-01",
  ...overrides,
});

export const wireException = (overrides: Raw = {}): Raw => ({
  id: "x1", kind: "exception", exception_date: "2030-01-10", mode: "unavailable", windows: [], note: null, version: 1, ...overrides,
});

export const wireShiftBrief = (overrides: Raw = {}): Raw => ({
  id: "s1", work_date: "2030-01-08", shift_name: "Morning", start_time: "07:00:00", end_time: "15:00:00",
  starts_at: "2030-01-08T13:00:00+00:00", ends_at: "2030-01-08T21:00:00+00:00", version: 1, user_id: "u1", ...overrides,
});

export const wireImpact = (overrides: Raw = {}): Raw => ({ verified: true, reason: null, shifts: [], shift_count: 0, unresolved_count: 0, ...overrides });

export const wireLeave = (overrides: Raw = {}): Raw => ({
  id: "l1", department_id: "d1", start_date: "2030-01-08", end_date: "2030-01-09", partial: false, start_time: null, end_time: null,
  starts_at: "2030-01-08T06:00:00+00:00", ends_at: "2030-01-10T06:00:00+00:00", reason_category: "personal", note: "Family trip", status: "pending",
  decision_reason: null, cancel_reason: null, decided_at: null, cancelled_at: null, version: 1, created_at: "2030-01-02T15:00:00+00:00",
  user: person("u1", "Ana Lopez"), decided_by: null, impact: wireImpact(),
  can: { approve: true, deny: true, cancel: false, cancel_needs_reason: false }, timeline: [], viewer: "manager", ...overrides,
});

export const wireSwap = (overrides: Raw = {}): Raw => ({
  id: "w1", department_id: "d1", note: null, response_note: null, decision_reason: null, cancel_reason: null, expires_at: "2030-01-05T00:00:00+00:00",
  responded_at: null, decided_at: null, version: 2, created_at: "2030-01-02T15:00:00+00:00", status: "accepted", stored_status: "accepted",
  requester: person("u1", "Ana Lopez"), counterpart: person("u2", "Bea Cruz"),
  requester_shift: wireShiftBrief({ id: "s1", user_id: "u1" }),
  counterpart_shift: wireShiftBrief({ id: "s2", work_date: "2030-01-09", user_id: "u2" }),
  decided_by: null, analysis: { blockers: [], warnings: [] },
  can: { respond: false, cancel: false, approve: true, deny: true }, timeline: [], viewer: "manager", ...overrides,
});

export const wireItem = (overrides: Raw = {}): Raw => ({
  type: "time_off", id: "l1", status: "pending", status_group: "pending", user: person("u1", "Ana Lopez"), counterpart: null,
  date_from: "2030-01-08", date_to: "2030-01-09", submitted_at: "2030-01-02T15:00:00+00:00", version: 1, needs_action: true, needs_my_response: false,
  leave: { partial: false, start_time: null, end_time: null, reason_category: "personal" }, swap: null, impact: { verified: true, shift_count: 2 }, ...overrides,
});

export const wireSwapItem = (overrides: Raw = {}): Raw =>
  wireItem({
    type: "shift_swap", id: "w1", status: "accepted", status_group: "pending", counterpart: person("u2", "Bea Cruz"), leave: null, impact: null,
    swap: { requester_shift: wireShiftBrief({ id: "s1" }), counterpart_shift: wireShiftBrief({ id: "s2", work_date: "2030-01-09", user_id: "u2" }), expires_at: null },
    version: 2, ...overrides,
  });

export const inbox = (items: Raw[], counts: Raw = {}): Raw => ({
  data: items,
  meta: { counts: { pending: items.filter((i) => i.needs_action).length, approved: 0, denied: 0, all: items.length, ...counts }, truncated: false },
});

export const apiError = (status: number, code: string, extra: Raw = {}, message = "refused") =>
  Object.assign(new Error(message), { status, code, body: { code, ...extra } });
