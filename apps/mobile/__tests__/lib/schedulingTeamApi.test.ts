import { fetchTeamSchedule, parseTeamPage, parseTeamShift, TEAM_MAX_PAGES } from "@/lib/api/schedulingTeam";
import { TODAY, wirePage, wirePerson, wireShift } from "../helpers/teamScheduleFixtures";

/* The /schedules/team client against the response the Phase 1 backend really sends (see routers/scheduling_team.py). */

const mockGet = jest.fn();
jest.mock("@/lib/api/client", () => ({ api: { get: (...args: unknown[]) => mockGet(...args) } }));

beforeEach(() => mockGet.mockReset());

describe("parseTeamPage", () => {
  it("reads the documented envelope", () => {
    const page = parseTeamPage(wirePage({ staff: [wirePerson("u1", "Ana Torres")], assignments: [wireShift()], total: 1 }));
    expect(page.people).toHaveLength(1);
    expect(page.shifts[0]).toMatchObject({ id: "a1", userId: "u1", workDate: TODAY, name: "Morning", startTime: "07:00:00", publication: "published" });
    expect(page.total).toBe(1);
    expect(page.hasMore).toBe(false);
  });

  it.each([null, "oops", {}, { data: {}, meta: {} }, { data: { staff: [], assignments: [] } }])("refuses a body that is not the envelope (%j) instead of reading it as empty", (body) => {
    expect(() => parseTeamPage(body)).toThrow();
  });

  it("counts shift rows it cannot read instead of silently dropping them", () => {
    const page = parseTeamPage(wirePage({ staff: [wirePerson("u1", "A")], assignments: [wireShift(), { id: "bad" }, wireShift({ id: "a3", starts_at: "not a time" })] }));
    expect(page.shifts).toHaveLength(1);
    expect(page.unreadableShifts).toBe(2);
  });

  it("keeps a draft as a draft and never invents a status the server did not send", () => {
    const draft = parseTeamShift(wireShift({ publication_state: "draft" }));
    expect(draft?.publication).toBe("draft");
    expect(draft?.status).toBeNull();
    expect(parseTeamShift(wireShift({ workforce_status: "teleporting" }))?.status).toBe("unknown");
  });

  it("does not leak the legacy clock columns", () => {
    const shape = parseTeamShift({ ...wireShift(), is_on_shift: true, clocked_in_at: "2026-10-28T12:01:00Z" });
    expect(shape).not.toHaveProperty("is_on_shift");
    expect(shape).not.toHaveProperty("clockedInAt");
  });
});

describe("fetchTeamSchedule", () => {
  it("asks for a bounded, single-day, attendance-bearing range and returns the verified overlay", async () => {
    mockGet.mockResolvedValueOnce(wirePage({ staff: [wirePerson("u1", "Ana", { workforce_status: "working" })], assignments: [wireShift({ workforce_status: "working" })], requested: true, verified: true, asOf: "2026-10-28T15:00:00+00:00" }));
    const result = await fetchTeamSchedule({ dateFrom: TODAY, includeAttendance: true });
    const url = mockGet.mock.calls[0][0] as string;
    expect(url).toContain("/schedules/team?");
    expect(url).toContain(`date_from=${TODAY}`);
    expect(url).toContain(`date_to=${TODAY}`);
    expect(url).toContain("include_attendance=true");
    expect(url).toContain("per_page=200");
    expect(result.attendance).toEqual({ requested: true, verified: true, asOf: "2026-10-28T15:00:00+00:00" });
    expect(result.people[0].status).toBe("working");
    expect(result.complete).toBe(true);
  });

  it("reads EVERY page and merges them (page-local counts are never the hotel total)", async () => {
    mockGet
      .mockResolvedValueOnce(wirePage({ staff: [wirePerson("u1", "A")], assignments: [wireShift({ id: "a1", user_id: "u1" })], total: 3, hasMore: true, page: 1 }))
      .mockResolvedValueOnce(wirePage({ staff: [wirePerson("u2", "B"), wirePerson("u3", "C")], assignments: [wireShift({ id: "a2", user_id: "u2" })], total: 3, hasMore: false, page: 2 }));
    const result = await fetchTeamSchedule({ dateFrom: TODAY });
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockGet.mock.calls[1][0]).toContain("page=2");
    expect(result.people.map((p) => p.userId)).toEqual(["u1", "u2", "u3"]);
    expect(result.shifts).toHaveLength(2);
    expect(result.totalPeople).toBe(3);
    expect(result.complete).toBe(true);
  });

  it("fails the whole read if a later page fails — a half-read hotel is never returned", async () => {
    mockGet.mockResolvedValueOnce(wirePage({ staff: [wirePerson("u1", "A")], assignments: [], total: 2, hasMore: true }));
    mockGet.mockRejectedValueOnce(Object.assign(new Error("boom"), { status: 503 }));
    await expect(fetchTeamSchedule({ dateFrom: TODAY })).rejects.toThrow("boom");
  });

  it("marks the answer incomplete when the server hit its own cap", async () => {
    mockGet.mockResolvedValueOnce(wirePage({ staff: [wirePerson("u1", "A")], assignments: [], truncated: true }));
    const result = await fetchTeamSchedule({ dateFrom: TODAY });
    expect(result.serverTruncated).toBe(true);
    expect(result.complete).toBe(false);
  });

  it("marks the answer incomplete when pages never stop", async () => {
    mockGet.mockImplementation(async () => wirePage({ staff: [wirePerson(`u${mockGet.mock.calls.length}`, "A")], assignments: [], total: 9999, hasMore: true }));
    const result = await fetchTeamSchedule({ dateFrom: TODAY });
    expect(mockGet).toHaveBeenCalledTimes(TEAM_MAX_PAGES);
    expect(result.complete).toBe(false);
  });

  it("downgrades every status to unknown when any page's attendance could not be verified", async () => {
    mockGet
      .mockResolvedValueOnce(wirePage({ staff: [wirePerson("u1", "A", { workforce_status: "working" })], assignments: [wireShift({ workforce_status: "working" })], total: 2, hasMore: true, requested: true, verified: true, asOf: "2026-10-28T15:00:00+00:00" }))
      .mockResolvedValueOnce(wirePage({ staff: [wirePerson("u2", "B", { workforce_status: "unknown" })], assignments: [], total: 2, requested: true, verified: false }));
    const result = await fetchTeamSchedule({ dateFrom: TODAY, includeAttendance: true });
    expect(result.attendance.verified).toBe(false);
    expect(result.attendance.asOf).toBeNull();
    expect(result.people.every((p) => p.status === "unknown")).toBe(true);
    expect(result.shifts.every((s) => s.status === "unknown")).toBe(true);
  });

  it("keeps the OLDEST attendance read time across pages", async () => {
    mockGet
      .mockResolvedValueOnce(wirePage({ staff: [wirePerson("u1", "A")], assignments: [], total: 2, hasMore: true, requested: true, verified: true, asOf: "2026-10-28T15:00:05+00:00" }))
      .mockResolvedValueOnce(wirePage({ staff: [wirePerson("u2", "B")], assignments: [], total: 2, requested: true, verified: true, asOf: "2026-10-28T15:00:01+00:00" }));
    expect((await fetchTeamSchedule({ dateFrom: TODAY, includeAttendance: true })).attendance.asOf).toBe("2026-10-28T15:00:01+00:00");
  });

  it("does not claim attendance for a plan-only request", async () => {
    mockGet.mockResolvedValueOnce(wirePage({ staff: [wirePerson("u1", "A")], assignments: [wireShift()] }));
    const result = await fetchTeamSchedule({ dateFrom: "2026-10-26", dateTo: "2026-11-01" });
    expect(result.attendance).toEqual({ requested: false, verified: false, asOf: null });
    expect(result.shifts[0].status).toBeNull();
  });

  it("de-duplicates a person or shift that appears on two pages", async () => {
    mockGet
      .mockResolvedValueOnce(wirePage({ staff: [wirePerson("u1", "A")], assignments: [wireShift()], total: 2, hasMore: true }))
      .mockResolvedValueOnce(wirePage({ staff: [wirePerson("u1", "A"), wirePerson("u2", "B")], assignments: [wireShift()], total: 2 }));
    const result = await fetchTeamSchedule({ dateFrom: TODAY });
    expect(result.people).toHaveLength(2);
    expect(result.shifts).toHaveLength(1);
  });
});
