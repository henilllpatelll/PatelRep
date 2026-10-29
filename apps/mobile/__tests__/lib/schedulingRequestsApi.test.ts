import { api } from "@/lib/api/client";
import {
  addAvailabilityException, approveSwap, approveTimeOff, cancelSwap, cancelTimeOff, classifyRequestFailure, createTimeOff, denySwap, denyTimeOff,
  fetchManagerRequests, fetchMyAvailability, fetchMyRequests, fetchSwapOptions, fetchTeamAvailability, fetchTimeOff, proposeSwap, respondToSwap,
  retireAvailability, saveMyAvailability,
} from "@/lib/api/schedulingRequests";
import { apiError, inbox, person, wireAvailability, wireException, wireImpact, wireItem, wireLeave, wireShiftBrief, wireSwap, wireSwapItem, wireWeek } from "../helpers/requestFixtures";

jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const put = api.put as jest.Mock;

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  put.mockReset();
});

describe("availability", () => {
  it("reads seven days and calls a day with nothing submitted 'unset', never available", async () => {
    get.mockResolvedValue({ data: wireAvailability({ revision: 3, submitted: true, freshness: "current", weekly: wireWeek({ 0: { state: "available", windows: [{ start: "07:00", end: "15:00" }] }, 2: { state: "unavailable" } }) }) });
    const mine = await fetchMyAvailability();
    expect(get).toHaveBeenCalledWith("/schedules/me/availability");
    expect(mine.revision).toBe(3);
    expect(mine.weekly.map((d) => d.state)).toEqual(["available", "unset", "unavailable", "unset", "unset", "unset", "unset"]);
    expect(mine.weekly[0].windows).toEqual([{ start: "07:00", end: "15:00" }]);
  });

  it("fills missing or malformed days as unset and never invents hours", async () => {
    get.mockResolvedValue({ data: wireAvailability({ weekly: [{ weekday: 1, state: "available", windows: [{ start: "bad" }] }, { weekday: 9, state: "available" }, "junk"] }) });
    const mine = await fetchMyAvailability();
    expect(mine.weekly).toHaveLength(7);
    expect(mine.weekly[1]).toEqual({ weekday: 1, state: "available", windows: [] });
    expect(mine.weekly.filter((d) => d.state === "unset")).toHaveLength(6);
  });

  it("saves the whole week with the revision it read, leaves unset days out and sends no user id", async () => {
    put.mockResolvedValue({ data: wireAvailability({ revision: 4 }), meta: { shift_clashes: [{ ...wireShiftBrief(), availability: "outside" }], replayed: false } });
    const saved = await saveMyAvailability({
      expectedRevision: 3, effectiveFrom: null,
      days: [{ weekday: 0, mode: "available", windows: [{ start: "07:00", end: "15:00" }] }, { weekday: 2, mode: "unavailable", windows: [{ start: "01:00", end: "02:00" }] }],
    });
    const [url, body] = put.mock.calls[0];
    expect(url).toBe("/schedules/me/availability");
    expect(body).toEqual({ expected_revision: 3, days: [
      { weekday: 0, mode: "available", windows: [{ start: "07:00", end: "15:00" }] },
      { weekday: 2, mode: "unavailable", windows: [] },                               // an unavailable day never carries hours
    ] });
    expect(JSON.stringify(body)).not.toMatch(/user_id|userId/);
    expect(saved.availability.revision).toBe(4);
    expect(saved.clashes).toEqual([expect.objectContaining({ id: "s1", availability: "outside" })]);
  });

  it("sends an effective date only when one was chosen", async () => {
    put.mockResolvedValue({ data: wireAvailability(), meta: {} });
    await saveMyAvailability({ expectedRevision: 0, effectiveFrom: "2030-02-01", days: [] });
    expect(put.mock.calls[0][1]).toEqual({ expected_revision: 0, effective_from: "2030-02-01", days: [] });
  });

  it("adds and retires date exceptions", async () => {
    post.mockResolvedValue({ data: wireException({ mode: "available", windows: [{ start: "10:00", end: "14:00" }] }), meta: { shift_clashes: [] } });
    const added = await addAvailabilityException({ date: "2030-01-10", mode: "available", windows: [{ start: "10:00", end: "14:00" }], note: "School" });
    expect(post).toHaveBeenCalledWith("/schedules/me/availability/exceptions", { exception_date: "2030-01-10", mode: "available", windows: [{ start: "10:00", end: "14:00" }], note: "School" });
    expect(added.exception).toEqual(expect.objectContaining({ id: "x1", mode: "available" }));
    post.mockResolvedValue({ data: {} });
    await retireAvailability("x1", 2);
    expect(post).toHaveBeenLastCalledWith("/schedules/availability/x1/retire", { expected_version: 2 });
  });

  it("reads the team list and one member", async () => {
    get.mockResolvedValue({ data: [{ ...person("u1", "Ana Lopez"), weekly: wireWeek(), exception_count: 1, exceptions: [wireException()], submitted: true, freshness: "stale", last_updated_at: "2029-01-01T00:00:00+00:00", leave: [{ id: "l1", start_date: "2030-01-08", end_date: "2030-01-09", partial: false, status: "approved" }] }, "junk"], meta: { total: 4, truncated: false } });
    const team = await fetchTeamAvailability({ q: "an a", filter: "stale" });
    expect(get).toHaveBeenCalledWith("/schedules/availability/team?q=an%20a&filter=stale");
    expect(team.total).toBe(4);
    expect(team.people).toHaveLength(1);
    expect(team.people[0]).toEqual(expect.objectContaining({ freshness: "stale", exceptionCount: 1 }));
    expect(team.people[0].leave[0].status).toBe("approved");
  });
});

describe("time off", () => {
  it("creates a full-day request without times, with a trimmed note and the idempotency key", async () => {
    post.mockResolvedValue({ data: wireLeave({ viewer: "self", can: { approve: false, deny: false, cancel: true, cancel_needs_reason: false } }) });
    const made = await createTimeOff({ startDate: "2030-01-08", endDate: "2030-01-09", partial: false, startTime: "09:00", endTime: "12:00", reason: "family", note: "  Trip  ", idempotencyKey: "leave-key-1" });
    expect(post).toHaveBeenCalledWith("/schedules/me/time-off", { start_date: "2030-01-08", end_date: "2030-01-09", partial: false, reason_category: "family", note: "Trip", idempotency_key: "leave-key-1" });
    expect(made.status).toBe("pending");
    expect(made.can.cancel).toBe(true);
  });

  it("sends the times only for a partial day and never a user id or status", async () => {
    post.mockResolvedValue({ data: wireLeave({ partial: true, start_time: "13:00:00", end_time: "17:00:00" }) });
    await createTimeOff({ startDate: "2030-01-08", endDate: "2030-01-08", partial: true, startTime: "13:00", endTime: "17:00", reason: "appointment", idempotencyKey: "leave-key-2" });
    const body = post.mock.calls[0][1];
    expect(body).toEqual(expect.objectContaining({ partial: true, start_time: "13:00", end_time: "17:00" }));
    expect(JSON.stringify(body)).not.toMatch(/user|status/);
  });

  it("reads the verified schedule impact, and an unverified one is never a count", async () => {
    get.mockResolvedValue({ data: wireLeave({ impact: wireImpact({ shift_count: 1, unresolved_count: 1, shifts: [{ ...wireShiftBrief(), overlap: "partial", resolved: false, coverage: { gap_id: "g1", status: "open", resolution: null, replacement: null } }] }) }) });
    const leave = await fetchTimeOff("l1");
    expect(get).toHaveBeenCalledWith("/schedules/time-off/l1");
    expect(leave.impact).toEqual({ verified: true, shiftCount: 1, unresolvedCount: 1, shifts: [expect.objectContaining({ overlap: "partial", resolved: false, coverage: expect.objectContaining({ status: "open" }) })] });
    get.mockResolvedValue({ data: wireLeave({ impact: { verified: false, reason: "schedule_unavailable", shifts: [], shift_count: null, unresolved_count: null } }) });
    expect((await fetchTimeOff("l1")).impact).toEqual({ verified: false, shiftCount: null, unresolvedCount: null, shifts: [] });
  });

  it("approves, denies and cancels with the version that was read", async () => {
    post.mockResolvedValue({ data: wireLeave({ status: "approved", version: 2 }), meta: { follow_up_required: true } });
    const approved = await approveTimeOff("l1", 1);
    expect(post).toHaveBeenLastCalledWith("/schedules/time-off/l1/approve", { expected_version: 1 });
    expect(approved.followUpRequired).toBe(true);
    await denyTimeOff("l1", 1, "Short staffed");
    expect(post).toHaveBeenLastCalledWith("/schedules/time-off/l1/deny", { expected_version: 1, reason: "Short staffed" });
    await cancelTimeOff("l1", 2, " Plans changed ");
    expect(post).toHaveBeenLastCalledWith("/schedules/time-off/l1/cancel", { expected_version: 2, reason: "Plans changed" });
    await cancelTimeOff("l1", 2);
    expect(post).toHaveBeenLastCalledWith("/schedules/time-off/l1/cancel", { expected_version: 2 });
  });

  it("refuses a response that is not the expected shape instead of guessing", async () => {
    post.mockResolvedValue({ data: { id: "l1" } });
    await expect(approveTimeOff("l1", 1)).rejects.toThrow(/expected shape/);
  });
});

describe("shift swaps", () => {
  it("lists swap options for my own shift, keeping only the person and shift", async () => {
    get.mockResolvedValue({ data: [{ person: person("u2", "Bea Cruz"), shifts: [{ ...wireShiftBrief({ id: "s2" }), warnings: ["insufficient_rest"] }] }, { person: person("u3", "Cy"), shifts: [] }], meta: { my_shift: wireShiftBrief() } });
    const result = await fetchSwapOptions("s1");
    expect(get).toHaveBeenCalledWith("/schedules/me/swap-options?assignment_id=s1");
    expect(result.options).toHaveLength(1);
    expect(result.options[0].shifts[0].warnings).toEqual(["insufficient_rest"]);
    expect(result.myShift?.id).toBe("s1");
  });

  it("proposes by shift ids only: the requester is never sent", async () => {
    post.mockResolvedValue({ data: wireSwap({ status: "proposed", viewer: "requester" }) });
    const swap = await proposeSwap({ myAssignmentId: "s1", theirAssignmentId: "s2", note: " Dentist ", idempotencyKey: "swap-key-1" });
    expect(post).toHaveBeenCalledWith("/schedules/me/swaps", { requester_assignment_id: "s1", counterpart_assignment_id: "s2", note: "Dentist", idempotency_key: "swap-key-1" });
    expect(swap).toEqual(expect.objectContaining({ status: "proposed", viewer: "requester" }));
  });

  it("answers, cancels, approves and denies with the version that was read", async () => {
    post.mockResolvedValue({ data: wireSwap() });
    await respondToSwap("w1", 1, true, "Happy to");
    expect(post).toHaveBeenLastCalledWith("/schedules/swaps/w1/respond", { accept: true, expected_version: 1, note: "Happy to" });
    await respondToSwap("w1", 1, false);
    expect(post).toHaveBeenLastCalledWith("/schedules/swaps/w1/respond", { accept: false, expected_version: 1 });
    await cancelSwap("w1", 2, "Changed my mind");
    expect(post).toHaveBeenLastCalledWith("/schedules/swaps/w1/cancel", { expected_version: 2, reason: "Changed my mind" });
    await approveSwap("w1", 2, true);
    expect(post).toHaveBeenLastCalledWith("/schedules/swaps/w1/approve", { expected_version: 2, acknowledge_warnings: true });
    await denySwap("w1", 2, "Training that day");
    expect(post).toHaveBeenLastCalledWith("/schedules/swaps/w1/deny", { expected_version: 2, reason: "Training that day" });
  });

  it("reads the server's own checks for the exchange", async () => {
    post.mockResolvedValue({ data: wireSwap({ analysis: { blockers: [{ code: "approved_time_off", user_id: "u2" }], warnings: [{ code: "insufficient_rest", user_id: "u1" }] } }) });
    const swap = await approveSwap("w1", 2, false);
    expect(swap.analysis).toEqual({ blockers: [{ code: "approved_time_off", userId: "u2" }], warnings: [{ code: "insufficient_rest", userId: "u1" }] });
    post.mockResolvedValue({ data: wireSwap({ status: "approved", analysis: null }) });
    expect((await approveSwap("w1", 2, false)).analysis).toBeNull();
  });
});

describe("request lists", () => {
  it("asks for exactly the filters chosen and parses both kinds in one list", async () => {
    get.mockResolvedValue(inbox([wireItem(), wireSwapItem(), { type: "mystery", id: "z" }]));
    const list = await fetchManagerRequests({ type: "all", status: "pending", dateFrom: "2030-01-01", dateTo: "2030-01-31", q: "an a" });
    expect(get).toHaveBeenCalledWith("/schedules/requests?type=all&status=pending&date_from=2030-01-01&date_to=2030-01-31&q=an%20a");
    expect(list.items.map((i) => i.type)).toEqual(["time_off", "shift_swap"]);
    expect(list.unreadable).toBe(1);
    expect(list.counts.pending).toBe(2);
    expect(list.items[0].shiftCount).toBe(2);
    expect(list.items[1].swap?.counterpartShift?.id).toBe("s2");
  });

  it("shows no schedule count when the server could not verify one", async () => {
    get.mockResolvedValue(inbox([wireItem({ impact: { verified: false, shift_count: null } })]));
    expect((await fetchManagerRequests()).items[0].shiftCount).toBeNull();
  });

  it("flags swap proposals waiting on me", async () => {
    get.mockResolvedValue({ data: [wireSwapItem({ status: "proposed", needs_my_response: true, needs_action: false })], meta: { counts: { pending: 1, action_required: 1 } } });
    const mine = await fetchMyRequests();
    expect(get).toHaveBeenCalledWith("/schedules/me/requests");
    expect(mine.items[0].needsMyResponse).toBe(true);
    expect(mine.counts.action_required).toBe(1);
  });
});

describe("failures", () => {
  it("an answer that never came is unconfirmed, and a session problem is signed out", () => {
    expect(classifyRequestFailure(new Error("Network request failed"))).toEqual(expect.objectContaining({ kind: "unconfirmed", key: "unconfirmed", stale: false }));
    expect(classifyRequestFailure(new Error("Session expired. Please log in again."))).toEqual(expect.objectContaining({ kind: "signed_out", key: "signed_out" }));
    expect(classifyRequestFailure(apiError(401, "x"))).toEqual(expect.objectContaining({ kind: "signed_out" }));
    expect(classifyRequestFailure(apiError(503, "x"))).toEqual(expect.objectContaining({ kind: "unconfirmed" }));
  });

  it("keeps the server's code, and a changed record is stale so the screen reloads it", () => {
    for (const code of ["version_conflict", "request_not_pending", "swap_not_approvable", "shift_changed", "availability_changed", "swap_expired"]) {
      expect(classifyRequestFailure(apiError(409, code))).toEqual(expect.objectContaining({ kind: "conflict", key: code, stale: true }));
    }
    expect(classifyRequestFailure(apiError(409, "leave_overlap"))).toEqual(expect.objectContaining({ key: "leave_overlap", stale: false }));
    expect(classifyRequestFailure(apiError(422, "reason_required"))).toEqual(expect.objectContaining({ kind: "invalid", key: "reason_required" }));
    expect(classifyRequestFailure(apiError(403, "cannot_decide_own"))).toEqual(expect.objectContaining({ kind: "forbidden", key: "cannot_decide_own" }));
  });

  it("carries blockers and warnings from a refused swap", () => {
    const failure = classifyRequestFailure(apiError(409, "swap_invalid", { blockers: [{ code: "approved_time_off", user_id: "u2" }, "shifts_overlap"], warnings: [{ code: "insufficient_rest" }] }));
    expect(failure.blockers).toEqual(["approved_time_off", "shifts_overlap"]);
    expect(failure.warnings).toEqual(["insufficient_rest"]);
  });

  it("falls back to the failure kind when the server sent no code", () => {
    expect(classifyRequestFailure(apiError(404, undefined as unknown as string))).toEqual(expect.objectContaining({ kind: "not_found", key: "not_found" }));
  });
});
