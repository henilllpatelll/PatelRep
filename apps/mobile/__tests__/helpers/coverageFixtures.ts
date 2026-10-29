/* Server doubles for the Phase 4 coverage endpoints (routers/scheduling_absences.py, scheduling_coverage.py). */

export function wireGap(over: Record<string, unknown> = {}) {
  return {
    id: "g1",
    department_id: "d1",
    source: "absence",
    absence_id: "ab1",
    original_assignment_id: "s1",
    shift_id: "sh1",
    shift_name: "Morning",
    work_date: "2030-01-08",
    start_time: "07:00:00",
    end_time: "15:00:00",
    starts_at: "2030-01-08T13:00:00+00:00",
    ends_at: "2030-01-08T21:00:00+00:00",
    required_role: "housekeeper",
    status: "open",
    claimable: false,
    resolution: null,
    resolution_reason: null,
    filled_assignment_id: null,
    filled_user_id: null,
    notes: null,
    version: 1,
    pending_offer_count: 0,
    pending_claim_count: 0,
    offers: [],
    claims: [],
    absent_user_id: "u1",
    absent_user_name: "Ana Torres",
    absence_kind: "called_out",
    ...over,
  };
}

export function wireCandidate(userId: string, name: string, over: Record<string, unknown> = {}) {
  return {
    user_id: userId,
    name,
    roles: ["housekeeper"],
    eligible: true,
    blockers: [],
    warnings: ["availability_unknown"],
    reasons: ["eligible_by_schedule"],
    existing_shifts: [],
    availability: "unknown",
    ...over,
  };
}

export function wireImpact(over: Record<string, unknown> = {}) {
  return {
    verified: true,
    reason: null,
    as_of: "2030-01-08T14:00:00+00:00",
    rooms_assigned: 12,
    rooms_done: 3,
    rooms_in_progress: 1,
    rooms_remaining: 9,
    estimated_minutes_remaining: 270,
    minutes_left_in_shift: 180,
    ...over,
  };
}
