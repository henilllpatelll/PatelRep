const mockPost = jest.fn();
jest.mock("@/lib/api/client", () => ({ api: { post: (...args: unknown[]) => mockPost(...args) } }));

import {
  notifySupervisor,
  pendingAttemptStamp,
  recordServiceAttempt,
  recordServiceDeclined,
  resetPendingAttempts,
} from "@/lib/housekeeping/serviceAttempts";

const reply = (overrides: Record<string, unknown> = {}) => ({
  data: {},
  replayed: false,
  room: { dnd_flag: true, dnd_attempt_count: 3, dnd_last_attempt_at: "2026-10-08T16:00:00Z", dnd_retry_at: null },
  ...overrides,
});

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date("2026-10-08T15:00:00.000Z"));
  mockPost.mockReset();
  resetPendingAttempts();
});

afterEach(() => {
  jest.useRealTimers();
});

const tick = (ms = 1000) => jest.setSystemTime(new Date(Date.now() + ms));

describe("recordServiceAttempt", () => {
  it("posts to the pre-entry endpoint — never a clean session — and returns the server's counters", async () => {
    mockPost.mockResolvedValue(reply());
    const outcome = await recordServiceAttempt({ roomId: "r1", result: "dnd_no_response" }, true);
    expect(mockPost).toHaveBeenCalledWith(
      "/rooms/r1/service-attempts",
      expect.objectContaining({ result: "dnd_no_response", attempted_at: expect.any(String) }),
    );
    expect(mockPost.mock.calls.some(([path]) => String(path).includes("clean-sessions"))).toBe(false);
    expect(outcome).toEqual({
      outcome: "recorded",
      replayed: false,
      room: { dnd_flag: true, dnd_attempt_count: 3, dnd_last_attempt_at: "2026-10-08T16:00:00Z", dnd_retry_at: null },
    });
  });

  it("sends the retry instant for come-back-later", async () => {
    mockPost.mockResolvedValue(reply());
    await recordServiceAttempt({ roomId: "r1", result: "return_later", returnAt: "2026-10-08T18:30:00.000Z" }, true);
    expect(mockPost.mock.calls[0][1]).toMatchObject({ result: "return_later", return_at: "2026-10-08T18:30:00.000Z" });
  });

  it("is refused offline with no request and no pretend success", async () => {
    expect(await recordServiceAttempt({ roomId: "r1", result: "dnd_no_response" }, false)).toEqual({ outcome: "offline" });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("reuses the same attempted_at after a network failure so the retry is a server-side replay", async () => {
    mockPost.mockRejectedValueOnce(new Error("Network request failed")).mockResolvedValue(reply({ replayed: true }));
    const first = await recordServiceAttempt({ roomId: "r1", result: "dnd_no_response" }, true);
    expect(first).toMatchObject({ outcome: "failed" });
    const second = await recordServiceAttempt({ roomId: "r1", result: "dnd_no_response" }, true);
    expect(second).toMatchObject({ outcome: "recorded", replayed: true });
    expect(mockPost.mock.calls[1][1].attempted_at).toBe(mockPost.mock.calls[0][1].attempted_at);
  });

  it("uses a fresh stamp for the next genuine attempt once the previous one is confirmed", async () => {
    mockPost.mockResolvedValue(reply());
    await recordServiceAttempt({ roomId: "r1", result: "dnd_no_response" }, true);
    tick();
    const stamp = pendingAttemptStamp({ roomId: "r1", result: "dnd_no_response" });
    expect(stamp).not.toBe(mockPost.mock.calls[0][1].attempted_at);
  });

  it("drops the stamp after a definitive client rejection (it will never succeed as-is)", async () => {
    mockPost.mockRejectedValueOnce(Object.assign(new Error("This room is not assigned to you"), { status: 403 }));
    const first = await recordServiceAttempt({ roomId: "r1", result: "dnd_no_response" }, true);
    expect(first).toMatchObject({ outcome: "failed", status: 403 });
    tick();
    mockPost.mockResolvedValue(reply());
    await recordServiceAttempt({ roomId: "r1", result: "dnd_no_response" }, true);
    expect(mockPost.mock.calls[1][1].attempted_at).not.toBe(mockPost.mock.calls[0][1].attempted_at);
  });

  it("different results or rooms never share a stamp, and the same attempt keeps its own", () => {
    const a = pendingAttemptStamp({ roomId: "r1", result: "dnd_no_response" });
    tick();
    const b = pendingAttemptStamp({ roomId: "r2", result: "dnd_no_response" });
    tick();
    const c = pendingAttemptStamp({ roomId: "r1", result: "guest_answered" });
    expect(new Set([a, b, c]).size).toBe(3);
    tick();
    expect(pendingAttemptStamp({ roomId: "r1", result: "dnd_no_response" })).toBe(a);
  });
});

describe("supervisor notification and declined service", () => {
  it("notifies the housekeeping supervisor through the existing push route", async () => {
    mockPost.mockResolvedValue({});
    expect(await notifySupervisor("314", "DND — 2 attempts", true)).toBe(true);
    expect(mockPost).toHaveBeenCalledWith("/notifications/push", {
      message: "Room 314: DND — 2 attempts",
      target_role: "housekeeping_supervisor",
    });
  });

  it("reports failure and offline honestly", async () => {
    mockPost.mockRejectedValue(new Error("boom"));
    expect(await notifySupervisor("314", "x", true)).toBe(false);
    expect(await notifySupervisor("314", "x", false)).toBe(false);
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it("records a reason-bearing decline, or refuses offline", async () => {
    mockPost.mockResolvedValue({});
    expect(await recordServiceDeclined("r1", true)).toEqual({ outcome: "recorded" });
    expect(mockPost).toHaveBeenCalledWith("/rooms/r1/service-declined", { reason: "guest_declined_housekeeping", note: undefined });
    mockPost.mockClear();
    expect(await recordServiceDeclined("r1", false)).toEqual({ outcome: "offline" });
    expect(mockPost).not.toHaveBeenCalled();
  });
});
