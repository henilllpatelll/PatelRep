jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));

import { api } from "@/lib/api/client";
import {
  archiveTemplate,
  cancelShift,
  classifyWriteFailure,
  createShift,
  createShiftsBatch,
  createTemplate,
  failureFromBlocking,
  fetchShiftDetail,
  fetchTemplates,
  fetchTemplateUsage,
  previewShifts,
  updateShift,
  updateTemplate,
} from "@/lib/api/schedulingManage";
import { buildTimeline } from "@/lib/scheduling/shiftTimeline";
import { wireShift } from "../helpers/teamScheduleFixtures";

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const patch = api.patch as jest.Mock;
const del = api.delete as jest.Mock;

beforeEach(() => {
  for (const fn of [get, post, patch, del]) fn.mockReset();
});

const api409 = (code: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(code), { status: 409, code, body: { code, ...extra } });

describe("templates", () => {
  it("reads templates from the server and counts rows it could not read", async () => {
    get.mockResolvedValue({ data: [{ id: "t1", name: "Morning", department_id: "d1", start_time: "07:00:00", end_time: "15:00:00", is_active: true, archived_at: null, version: 2 }, { id: "t2", name: "Old", start_time: "07:00:00", end_time: "15:00:00", is_active: false, archived_at: "2026-01-01T00:00:00Z" }, { nope: true }] });
    const list = await fetchTemplates(true);
    expect(get).toHaveBeenCalledWith("/schedules/shifts?include_archived=true");
    expect(list.unreadable).toBe(1);
    expect(list.templates).toEqual([
      { id: "t1", name: "Morning", departmentId: "d1", startTime: "07:00:00", endTime: "15:00:00", isActive: true, archived: false, version: 2 },
      { id: "t2", name: "Old", departmentId: null, startTime: "07:00:00", endTime: "15:00:00", isActive: false, archived: true, version: 1 },
    ]);
  });

  it("refuses a body that is not the documented envelope", async () => {
    get.mockResolvedValue({ templates: [] });
    await expect(fetchTemplates()).rejects.toThrow(/expected shape/);
  });

  it("creates and updates with the server's field names and the version it read", async () => {
    const row = { data: { id: "t1", name: "Morning", start_time: "07:00:00", end_time: "15:00:00", version: 3 } };
    post.mockResolvedValue(row);
    patch.mockResolvedValue(row);
    await createTemplate({ name: "Morning", departmentId: "d1", startTime: "07:00", endTime: "15:00" });
    expect(post).toHaveBeenCalledWith("/schedules/shifts", { name: "Morning", department_id: "d1", start_time: "07:00", end_time: "15:00" });
    await updateTemplate("t1", { name: "Early", isActive: false, expectedVersion: 2 });
    expect(patch).toHaveBeenCalledWith("/schedules/shifts/t1", { expected_version: 2, name: "Early", is_active: false });
  });

  it("archives with DELETE and accepts the server's empty 204 body", async () => {
    del.mockRejectedValueOnce(new SyntaxError("JSON Parse error: Unexpected end of input"));
    await expect(archiveTemplate("t1")).resolves.toBeUndefined();
    expect(del).toHaveBeenCalledWith("/schedules/shifts/t1");
    del.mockRejectedValueOnce(Object.assign(new Error("nope"), { status: 403 }));
    await expect(archiveTemplate("t1")).rejects.toMatchObject({ status: 403 });
  });

  it("reads how many shifts reference a template", async () => {
    get.mockResolvedValue({ data: { shift_id: "t1", upcoming: 4, past: 9, archived: false, version: 1 } });
    await expect(fetchTemplateUsage("t1")).resolves.toEqual({ upcoming: 4, past: 9, archived: false });
    get.mockResolvedValue({ data: { upcoming: "x" } });
    await expect(fetchTemplateUsage("t1")).rejects.toThrow(/expected shape/);
  });
});

describe("shift writes", () => {
  it("creates one shift, sending times and notes only when set, and reports whether it was new", async () => {
    post.mockResolvedValue({ data: wireShift(), meta: { created: false, warnings: [{ code: "long_shift", user_id: "u1", work_date: "2026-10-28", detail: "x", severity: "warn" }] } });
    const outcome = await createShift({ userId: "u1", shiftId: "t1", workDate: "2026-10-28" });
    expect(post).toHaveBeenCalledWith("/schedules/assignments", { user_id: "u1", shift_id: "t1", work_date: "2026-10-28" });
    expect(outcome.created).toBe(false);
    expect(outcome.warnings[0]).toMatchObject({ code: "long_shift", severity: "warn" });
    await createShift({ userId: "u1", shiftId: "t1", workDate: "2026-10-28", startTime: "08:00", endTime: "16:00", notes: "n" });
    expect(post).toHaveBeenLastCalledWith("/schedules/assignments", { user_id: "u1", shift_id: "t1", work_date: "2026-10-28", start_time: "08:00", end_time: "16:00", notes: "n" });
  });

  it("sends a whole series as ONE batch request", async () => {
    post.mockResolvedValue({ data: { created_count: 3, updated_count: 0, unchanged_count: 1, warnings: [] } });
    const outcome = await createShiftsBatch([1, 2, 3, 4].map((n) => ({ userId: "u1", shiftId: "t1", workDate: `2026-11-0${n}` })));
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe("/schedules/assignments/bulk");
    expect(post.mock.calls[0][1].assignments).toHaveLength(4);
    expect(outcome).toEqual({ created: 3, unchanged: 1, warnings: [] });
  });

  it("edits with expected_version and only the fields given", async () => {
    patch.mockResolvedValue({ data: wireShift({ version: 5 }), meta: { warnings: [] } });
    const outcome = await updateShift("a1", { expectedVersion: 4, userId: "u2", workDate: "2026-10-30", notes: null });
    expect(patch).toHaveBeenCalledWith("/schedules/assignments/a1", { expected_version: 4, user_id: "u2", work_date: "2026-10-30", notes: "" });
    expect(outcome.shift.version).toBe(5);
  });

  it("cancels with the version the person saw", async () => {
    del.mockResolvedValue({ data: { success: true, deleted_id: "a1" } });
    await cancelShift("a1", 4);
    expect(del).toHaveBeenCalledWith("/schedules/assignments/a1?expected_version=4");
    del.mockResolvedValue({ data: {} });
    await expect(cancelShift("a1", 4)).rejects.toThrow(/expected shape/);
  });

  it("previews without writing and carries the server's refusal", async () => {
    post.mockResolvedValue({
      data: {
        ok: false, create_count: 0, unchanged_count: 0, warnings: [], items: [],
        blocking: { status: 409, code: "schedule_conflict", detail: "That schedule overlaps another shift for the same person.", conflicts: [{ code: "overlapping_shift", user_id: "u1", work_date: "2026-10-29", with_assignment_id: "a9" }] },
      },
    });
    const preview = await previewShifts([{ userId: "u1", shiftId: "t1", workDate: "2026-10-29" }]);
    expect(post.mock.calls[0][0]).toBe("/schedules/assignments/preview");
    expect(preview.ok).toBe(false);
    expect(failureFromBlocking(preview.blocking!)).toMatchObject({ kind: "schedule_conflict", status: 409, conflicts: [{ code: "overlapping_shift", workDate: "2026-10-29", withAssignmentId: "a9" }] });
  });

  it("reads the items of an accepted preview", async () => {
    post.mockResolvedValue({ data: { ok: true, create_count: 1, unchanged_count: 1, warnings: [], blocking: null, items: [{ user_id: "u1", shift_id: "t1", work_date: "2026-10-29", start_time: "07:00:00", end_time: "15:00:00", starts_at: "2026-10-29T12:00:00+00:00", ends_at: "2026-10-29T20:00:00+00:00", status: "new" }, { user_id: "u1", shift_id: "t1", work_date: "2026-10-30", status: "existing" }] } });
    const preview = await previewShifts([{ userId: "u1", shiftId: "t1", workDate: "2026-10-29" }]);
    expect(preview.items.map((item) => item.status)).toEqual(["new", "existing"]);
    expect(preview.createCount).toBe(1);
  });
});

describe("classifying failures", () => {
  it("maps the server's codes to kinds, and reads the current row of a version conflict", () => {
    const failure = classifyWriteFailure(api409("version_conflict", { current: wireShift({ version: 7, notes: "theirs" }) }));
    expect(failure.kind).toBe("version_conflict");
    expect(failure.current).toMatchObject({ version: 7, notes: "theirs" });
    expect(classifyWriteFailure(api409("schedule_conflict", { conflicts: [{ code: "overlapping_shift", user_id: "u1", work_date: "2026-10-29" }] }))).toMatchObject({ kind: "schedule_conflict", conflicts: [{ workDate: "2026-10-29" }] });
    expect(classifyWriteFailure(api409("duplicate_assignment")).kind).toBe("duplicate");
    expect(classifyWriteFailure(api409("historical_assignment_locked")).kind).toBe("locked");
    expect(classifyWriteFailure(api409("has_attendance")).kind).toBe("attendance");
    expect(classifyWriteFailure(api409("schedule_policy_blocked", { warnings: [{ code: "weekly_overtime", severity: "block" }] }))).toMatchObject({ kind: "policy_blocked", warnings: [{ code: "weekly_overtime", severity: "block" }] });
    expect(classifyWriteFailure(Object.assign(new Error("x"), { status: 422, code: "department_mismatch" })).kind).toBe("department");
    expect(classifyWriteFailure(Object.assign(new Error("x"), { status: 403, code: "department_forbidden" })).kind).toBe("forbidden");
  });

  it("falls back by status, and says unconfirmed when no answer came back", () => {
    expect(classifyWriteFailure(Object.assign(new Error("x"), { status: 404 })).kind).toBe("not_found");
    expect(classifyWriteFailure(Object.assign(new Error("x"), { status: 422 })).kind).toBe("invalid");
    expect(classifyWriteFailure(Object.assign(new Error("x"), { status: 401 })).kind).toBe("signed_out");
    expect(classifyWriteFailure(Object.assign(new Error("x"), { status: 503 })).kind).toBe("unconfirmed");
    expect(classifyWriteFailure(new Error("Request timed out. Please try again.")).kind).toBe("unconfirmed");
    expect(classifyWriteFailure(new Error("Session expired. Please log in again.")).kind).toBe("signed_out");
    expect(classifyWriteFailure(Object.assign(new Error("odd"), { status: 409 })).kind).toBe("unknown");
  });
});

describe("shift detail and its timeline", () => {
  const body = (attendance: Record<string, unknown>, rooms: Record<string, unknown> = { applicable: true, available: true, count: 3 }) => ({
    data: { assignment: { ...wireShift(), created_at: "2026-10-20T10:00:00Z", updated_at: "2026-10-27T18:30:00Z" }, department_code: "HK", attendance, rooms, editable: true },
  });

  it("reads the detail, including the last update and the room summary", async () => {
    get.mockResolvedValue(body({ applicable: true, verified: true, sessions: [] }));
    const detail = await fetchShiftDetail("a1");
    expect(get).toHaveBeenCalledWith("/schedules/assignments/a1/detail");
    expect(detail).toMatchObject({ updatedAt: "2026-10-27T18:30:00Z", departmentCode: "HK", rooms: { available: true, count: 3 }, editable: true });
  });

  it("builds the timeline only from verified sessions, and never invents attendance", async () => {
    const zone = "America/Chicago";
    const make = async (attendance: Record<string, unknown>) => {
      get.mockResolvedValue(body(attendance));
      return buildTimeline(await fetchShiftDetail("a1"), "7:00 AM", zone, "en");
    };
    expect(await make({ applicable: false, verified: false, sessions: [] })).toMatchObject({ note: "future", events: [{ kind: "scheduled" }] });
    expect(await make({ applicable: true, verified: false, sessions: [] })).toMatchObject({ note: "unverified" });
    const none = await make({ applicable: true, verified: true, sessions: [] });
    expect(none.note).toBe("none");
    expect(none.events.map((event) => event.kind)).toEqual(["scheduled"]); // no clock-in is not an absence, and not an event
    const ended = await make({ applicable: true, verified: true, sessions: [{ status: "ended", started_at: "2026-10-28T12:05:00Z", ended_at: "2026-10-28T20:30:00Z", on_break_since: null, break_seconds: 1800 }] });
    expect(ended.events.map((event) => event.kind)).toEqual(["scheduled", "started", "break", "ended"]);
    expect(ended.events[1].time).toBe("7:05 AM");
    expect(ended.events[2]).toMatchObject({ breakMinutes: 30, time: null });
    const onBreak = await make({ applicable: true, verified: true, sessions: [{ status: "on_break", started_at: "2026-10-28T12:05:00Z", ended_at: null, on_break_since: "2026-10-28T17:00:00Z", break_seconds: 0 }] });
    expect(onBreak.events.at(-1)).toMatchObject({ kind: "break", ongoing: true, time: "12:00 PM" });
    expect(onBreak.events.some((event) => event.kind === "ended")).toBe(false);
  });

  it("refuses a detail body that is not the documented shape", async () => {
    get.mockResolvedValue({ data: { assignment: wireShift() } });
    await expect(fetchShiftDetail("a1")).rejects.toThrow(/expected shape/);
  });
});
