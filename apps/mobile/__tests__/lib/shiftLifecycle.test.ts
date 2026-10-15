import type { ShiftSession } from "@/lib/api/shifts";
import { resolveShiftLifecycle, workedSeconds, type ShiftLifecycleInput } from "@/lib/housekeeping/shiftLifecycle";

const ZONE = "America/Chicago";
const TODAY = "2026-10-14";

function shift(overrides: Partial<ShiftSession> = {}): ShiftSession {
  return {
    id: "shift-1",
    tenant_id: "hotel-1",
    user_id: "user-1",
    started_at: "2026-10-14T13:00:00.000Z",
    ended_at: null,
    status: "active",
    on_break_since: null,
    break_seconds: 0,
    ...overrides,
  };
}

function resolve(overrides: Partial<ShiftLifecycleInput> = {}) {
  return resolveShiftLifecycle({
    current: null,
    lastEnded: null,
    serverConfirmed: true,
    lastFetchFailed: false,
    pendingOp: null,
    shiftDate: TODAY,
    timeZone: ZONE,
    isOnline: true,
    ...overrides,
  });
}

describe("resolveShiftLifecycle", () => {
  it("is unknown until the server has answered — a failed first read is not 'not started'", () => {
    const l = resolve({ serverConfirmed: false, lastFetchFailed: true });
    expect(l.state).toBe("unknown");
    expect(l.canStart).toBe(false);
    expect(l.canEnd).toBe(false);
  });

  it("is not started when the server confirms there is no shift today", () => {
    const l = resolve();
    expect(l.state).toBe("not_started");
    expect(l.canStart).toBe(true);
    expect(l.canEnd).toBe(false);
  });

  it("is active with an open shift and offers a break and clock-out", () => {
    const l = resolve({ current: shift() });
    expect(l.state).toBe("active");
    expect(l.startedAt).toBe("2026-10-14T13:00:00.000Z");
    expect(l.canEnd).toBe(true);
    expect(l.canStartBreak).toBe(true);
    expect(l.canEndBreak).toBe(false);
    expect(l.canStart).toBe(false);
  });

  it("is on break, and resumes rather than ending a break twice", () => {
    const l = resolve({ current: shift({ status: "on_break", on_break_since: "2026-10-14T16:00:00.000Z" }) });
    expect(l.state).toBe("on_break");
    expect(l.onBreakSince).toBe("2026-10-14T16:00:00.000Z");
    expect(l.canEndBreak).toBe(true);
    expect(l.canStartBreak).toBe(false);
    expect(l.canEnd).toBe(true);
  });

  it("is 'ending' while a clock-out is in flight — not ended until the server confirms", () => {
    const l = resolve({ current: shift(), pendingOp: "end" });
    expect(l.state).toBe("ending");
    expect(l.busy).toBe(true);
    expect(l.canEnd).toBe(false);
    expect(l.endedAt).toBeNull();
  });

  it("is ended once the server reports today's shift closed, and does not offer an automatic restart", () => {
    const ended = shift({ status: "ended", ended_at: "2026-10-14T21:00:00.000Z" });
    const l = resolve({ lastEnded: ended });
    expect(l.state).toBe("ended");
    expect(l.endedAt).toBe("2026-10-14T21:00:00.000Z");
    expect(l.endedShift?.id).toBe("shift-1");
    // A new shift is possible, but only as a deliberate action.
    expect(l.canStart).toBe(true);
  });

  it("treats a shift that ended on an earlier day as not started today", () => {
    const l = resolve({ lastEnded: shift({ status: "ended", ended_at: "2026-10-13T21:00:00.000Z" }) });
    expect(l.state).toBe("not_started");
  });

  it("decides 'today' in the hotel's zone, not the device's or UTC", () => {
    // 11:30 PM Chicago on the 14th is already the 15th in UTC.
    const ended = shift({ status: "ended", ended_at: "2026-10-15T04:30:00.000Z" });
    expect(resolve({ lastEnded: ended, shiftDate: "2026-10-14" }).state).toBe("ended");
    expect(resolve({ lastEnded: ended, shiftDate: "2026-10-15" }).state).toBe("not_started");
  });

  it("rolls over with the hotel's date: yesterday's clock-out never shows as today's", () => {
    const ended = shift({ status: "ended", ended_at: "2026-10-14T21:00:00.000Z" });
    expect(resolve({ lastEnded: ended, shiftDate: "2026-10-15" }).state).toBe("not_started");
  });

  it("keeps the last known state, marked stale, when a later read fails", () => {
    const l = resolve({ current: shift(), lastFetchFailed: true });
    expect(l.state).toBe("active");
    expect(l.stale).toBe(true);
  });

  it("does not treat offline uncertainty as proof a shift ended", () => {
    const l = resolve({ current: shift(), lastFetchFailed: true, isOnline: false });
    expect(l.state).toBe("active");
    // But it cannot be ended without the server.
    expect(l.canEnd).toBe(false);
    expect(l.canStartBreak).toBe(false);
  });

  it("flags an open shift that began before today", () => {
    const l = resolve({ current: shift({ started_at: "2026-10-13T13:00:00.000Z" }) });
    expect(l.state).toBe("active");
    expect(l.carriedOver).toBe(true);
    expect(resolve({ current: shift() }).carriedOver).toBe(false);
  });

  it("blocks every action while one is pending", () => {
    const l = resolve({ current: shift(), pendingOp: "break" });
    expect(l.canEnd).toBe(false);
    expect(l.canStartBreak).toBe(false);
    expect(l.canEndBreak).toBe(false);
  });

  it("ignores a server row that already says ended when asked for the open shift", () => {
    const l = resolve({ current: shift({ status: "ended", ended_at: "2026-10-14T20:00:00.000Z" }) });
    expect(l.shift).toBeNull();
    expect(l.state).not.toBe("active");
  });
});

describe("workedSeconds", () => {
  const now = new Date("2026-10-14T17:00:00.000Z");

  it("subtracts finished breaks", () => {
    const open = shift({ break_seconds: 1800 });
    expect(workedSeconds({ shift: open, endedShift: null }, now)).toBe(4 * 3600 - 1800);
  });

  it("subtracts a break in progress", () => {
    const open = shift({ status: "on_break", on_break_since: "2026-10-14T16:30:00.000Z" });
    expect(workedSeconds({ shift: open, endedShift: null }, now)).toBe(4 * 3600 - 1800);
  });

  it("uses the recorded end for a finished shift", () => {
    const done = shift({ status: "ended", ended_at: "2026-10-14T21:00:00.000Z", break_seconds: 600 });
    expect(workedSeconds({ shift: null, endedShift: done }, now)).toBe(8 * 3600 - 600);
  });

  it("is null without a shift", () => {
    expect(workedSeconds({ shift: null, endedShift: null }, now)).toBeNull();
  });
});
