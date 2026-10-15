import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ShiftSession } from "@/lib/api/shifts";

const mockGetShiftState = jest.fn();
const mockStartShift = jest.fn();
const mockEndShift = jest.fn();
const mockSetShiftBreak = jest.fn();
let mockIdCounter = 0;

jest.mock("@/lib/api/shifts", () => ({
  getShiftState: (...args: unknown[]) => mockGetShiftState(...args),
  startShift: (...args: unknown[]) => mockStartShift(...args),
  endShift: (...args: unknown[]) => mockEndShift(...args),
  setShiftBreak: (...args: unknown[]) => mockSetShiftBreak(...args),
  newShiftId: () => `id-${(mockIdCounter += 1)}`,
}));

import { useShiftLifecycle } from "@/lib/housekeeping/useShiftLifecycle";

const TODAY = new Date().toISOString().slice(0, 10);
const ZONE = "UTC";

function shift(overrides: Partial<ShiftSession> = {}): ShiftSession {
  return {
    id: "shift-1",
    tenant_id: "hotel-1",
    user_id: "user-1",
    started_at: new Date().toISOString(),
    ended_at: null,
    status: "active",
    on_break_since: null,
    break_seconds: 0,
    ...overrides,
  };
}

function setup(initial: { scope?: string | null; isOnline?: boolean; enabled?: boolean } = {}) {
  return renderHook(
    (props: { scope: string | null; isOnline: boolean; enabled: boolean }) =>
      useShiftLifecycle({ enabled: props.enabled, scope: props.scope, shiftDate: TODAY, timeZone: ZONE, isOnline: props.isOnline }),
    { initialProps: { scope: initial.scope === undefined ? "hotel-1:user-1" : initial.scope, isOnline: initial.isOnline ?? true, enabled: initial.enabled ?? true } },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIdCounter = 0;
  mockGetShiftState.mockResolvedValue({ current: null, lastEnded: null });
});

describe("useShiftLifecycle", () => {
  it("only reads on mount and foreground — it never starts a shift", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.lifecycle.state).toBe("not_started"));
    await act(async () => {
      await result.current.refresh();
    });
    expect(mockStartShift).not.toHaveBeenCalled();
    expect(mockEndShift).not.toHaveBeenCalled();
  });

  it("does nothing for roles that have no shift", async () => {
    const { result } = setup({ enabled: false });
    await act(async () => {
      await result.current.refresh();
    });
    expect(mockGetShiftState).not.toHaveBeenCalled();
    expect(result.current.lifecycle.state).toBe("unknown");
  });

  it("starts a shift only when asked, and becomes active", async () => {
    mockStartShift.mockResolvedValue(shift());
    const { result } = setup();
    await waitFor(() => expect(result.current.lifecycle.state).toBe("not_started"));

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.start();
    });

    expect(outcome).toEqual({ ok: true });
    expect(mockStartShift).toHaveBeenCalledTimes(1);
    expect(result.current.lifecycle.state).toBe("active");
  });

  it("retries a failed start with the same idempotency key, then uses a new one for the next shift", async () => {
    mockStartShift.mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(shift());
    const { result } = setup();
    await waitFor(() => expect(result.current.lifecycle.state).toBe("not_started"));

    await act(async () => {
      expect((await result.current.start()).ok).toBe(false);
    });
    expect(result.current.lifecycle.state).toBe("not_started");
    await act(async () => {
      expect((await result.current.start()).ok).toBe(true);
    });

    const [firstTry, retry] = mockStartShift.mock.calls.map((call) => call[0] as { id: string });
    expect(retry.id).toBe(firstTry.id);
  });

  it("cannot start while offline, and does not call the server", async () => {
    const { result } = setup({ isOnline: false });
    await act(async () => {
      expect(await result.current.start()).toEqual({ ok: false, reason: "offline" });
    });
    expect(mockStartShift).not.toHaveBeenCalled();
  });

  it("does not start a second shift when one is already open (another device)", async () => {
    mockGetShiftState.mockResolvedValue({ current: shift(), lastEnded: null });
    const { result } = setup();
    await waitFor(() => expect(result.current.lifecycle.state).toBe("active"));
    await act(async () => {
      expect(await result.current.start()).toEqual({ ok: false, reason: "not_allowed" });
    });
    expect(mockStartShift).not.toHaveBeenCalled();
  });

  it("adopts the open shift the server returns instead of its own request", async () => {
    mockStartShift.mockResolvedValue(shift({ id: "shift-from-other-device" }));
    const { result } = setup();
    await waitFor(() => expect(result.current.lifecycle.state).toBe("not_started"));
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.lifecycle.shift?.id).toBe("shift-from-other-device");
  });

  it("sends one clock-out for a double tap and ends only after the server confirms", async () => {
    mockGetShiftState.mockResolvedValue({ current: shift(), lastEnded: null });
    let resolveEnd: (value: ShiftSession) => void = () => undefined;
    mockEndShift.mockImplementation(() => new Promise<ShiftSession>((resolve) => { resolveEnd = resolve; }));
    const { result } = setup();
    await waitFor(() => expect(result.current.lifecycle.state).toBe("active"));

    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    act(() => {
      first = result.current.end();
      second = result.current.end();
    });
    expect(mockEndShift).toHaveBeenCalledTimes(1);
    expect(result.current.lifecycle.state).toBe("ending");

    await act(async () => {
      resolveEnd(shift({ status: "ended", ended_at: new Date().toISOString() }));
      await Promise.all([first, second]);
    });
    expect(result.current.lifecycle.state).toBe("ended");
    expect(mockEndShift).toHaveBeenCalledTimes(1);
  });

  it("stays on shift and reports the error when clock-out fails", async () => {
    mockGetShiftState.mockResolvedValue({ current: shift(), lastEnded: null });
    mockEndShift.mockRejectedValue(new Error("server error"));
    const { result } = setup();
    await waitFor(() => expect(result.current.lifecycle.state).toBe("active"));

    await act(async () => {
      expect(await result.current.end()).toMatchObject({ ok: false, reason: "failed" });
    });

    expect(result.current.lifecycle.state).toBe("active");
    expect(result.current.lastError).toBe("server error");
    // And it can be tried again.
    mockEndShift.mockResolvedValue(shift({ status: "ended", ended_at: new Date().toISOString() }));
    await act(async () => {
      expect((await result.current.end()).ok).toBe(true);
    });
    expect(result.current.lifecycle.state).toBe("ended");
  });

  it("treats a lost clock-out answer as ended only when the server then shows the shift closed", async () => {
    mockGetShiftState.mockResolvedValueOnce({ current: shift(), lastEnded: null });
    const { result } = setup();
    await waitFor(() => expect(result.current.lifecycle.state).toBe("active"));
    // The request timed out, but the server did end the shift.
    mockEndShift.mockRejectedValue(new Error("timeout"));
    mockGetShiftState.mockResolvedValue({ current: null, lastEnded: shift({ status: "ended", ended_at: new Date().toISOString() }) });

    await act(async () => {
      expect(await result.current.end()).toEqual({ ok: true });
    });
    expect(result.current.lifecycle.state).toBe("ended");
    expect(result.current.lastError).toBeNull();
  });

  it("stays on shift when the answer was lost and the server cannot be asked either", async () => {
    mockGetShiftState.mockResolvedValueOnce({ current: shift(), lastEnded: null });
    const { result } = setup();
    await waitFor(() => expect(result.current.lifecycle.state).toBe("active"));
    mockEndShift.mockRejectedValue(new Error("timeout"));
    mockGetShiftState.mockRejectedValue(new Error("still down"));

    await act(async () => {
      expect(await result.current.end()).toMatchObject({ ok: false, reason: "failed" });
    });
    expect(result.current.lifecycle.state).toBe("active");
    expect(result.current.lifecycle.canEnd).toBe(true);
  });

  it("does not call a failed clock-out ended just because an older shift ended earlier", async () => {
    mockGetShiftState.mockResolvedValueOnce({ current: shift(), lastEnded: null });
    const { result } = setup();
    await waitFor(() => expect(result.current.lifecycle.state).toBe("active"));
    mockEndShift.mockRejectedValue(new Error("server error"));
    // The shift is still open on the server.
    mockGetShiftState.mockResolvedValue({ current: shift(), lastEnded: shift({ id: "old", status: "ended", ended_at: new Date().toISOString() }) });

    await act(async () => {
      expect(await result.current.end()).toMatchObject({ ok: false });
    });
    expect(result.current.lifecycle.state).toBe("active");
  });

  it("cannot clock out offline — the server must confirm it", async () => {
    mockGetShiftState.mockResolvedValue({ current: shift(), lastEnded: null });
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.lifecycle.state).toBe("active"));
    rerender({ scope: "hotel-1:user-1", isOnline: false, enabled: true });

    await act(async () => {
      expect(await result.current.end()).toEqual({ ok: false, reason: "offline" });
    });
    expect(mockEndShift).not.toHaveBeenCalled();
    expect(result.current.lifecycle.state).toBe("active");
  });

  it("re-reads when the server says no shift was open (already ended elsewhere)", async () => {
    mockGetShiftState.mockResolvedValueOnce({ current: shift(), lastEnded: null });
    const { result } = setup();
    await waitFor(() => expect(result.current.lifecycle.state).toBe("active"));
    mockEndShift.mockResolvedValue(null);
    mockGetShiftState.mockResolvedValue({ current: null, lastEnded: shift({ status: "ended", ended_at: new Date().toISOString() }) });

    await act(async () => {
      expect((await result.current.end()).ok).toBe(true);
    });
    expect(result.current.lifecycle.state).toBe("ended");
  });

  it("drops a slow read that returns after a newer action", async () => {
    let resolveRead: (value: unknown) => void = () => undefined;
    mockGetShiftState
      .mockResolvedValueOnce({ current: shift(), lastEnded: null })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRead = resolve; }));
    mockEndShift.mockResolvedValue(shift({ status: "ended", ended_at: new Date().toISOString() }));
    const { result } = setup();
    await waitFor(() => expect(result.current.lifecycle.state).toBe("active"));

    let slowRead!: Promise<void>;
    act(() => {
      slowRead = result.current.refresh();
    });
    await act(async () => {
      await result.current.end();
    });
    expect(result.current.lifecycle.state).toBe("ended");

    // The stale read finally lands and says "still active" — it must not win.
    await act(async () => {
      resolveRead({ current: shift(), lastEnded: null });
      await slowRead;
    });
    expect(result.current.lifecycle.state).toBe("ended");
  });

  it("does not let a read overwrite state while a clock-out is in flight", async () => {
    mockGetShiftState.mockResolvedValue({ current: shift(), lastEnded: null });
    let resolveEnd: (value: ShiftSession) => void = () => undefined;
    mockEndShift.mockImplementation(() => new Promise<ShiftSession>((resolve) => { resolveEnd = resolve; }));
    const { result } = setup();
    await waitFor(() => expect(result.current.lifecycle.state).toBe("active"));

    let ending!: Promise<unknown>;
    act(() => {
      ending = result.current.end();
    });
    const readsBefore = mockGetShiftState.mock.calls.length;
    await act(async () => {
      await result.current.refresh();
    });
    expect(mockGetShiftState.mock.calls.length).toBe(readsBefore);
    expect(result.current.lifecycle.state).toBe("ending");

    await act(async () => {
      resolveEnd(shift({ status: "ended", ended_at: new Date().toISOString() }));
      await ending;
    });
  });

  it("takes a break and resumes using the existing break endpoint", async () => {
    mockGetShiftState.mockResolvedValue({ current: shift(), lastEnded: null });
    mockSetShiftBreak
      .mockResolvedValueOnce(shift({ status: "on_break", on_break_since: new Date().toISOString() }))
      .mockResolvedValueOnce(shift({ break_seconds: 300 }));
    const { result } = setup();
    await waitFor(() => expect(result.current.lifecycle.state).toBe("active"));

    await act(async () => {
      expect((await result.current.startBreak()).ok).toBe(true);
    });
    expect(result.current.lifecycle.state).toBe("on_break");
    expect(mockSetShiftBreak).toHaveBeenLastCalledWith("start");

    await act(async () => {
      expect((await result.current.endBreak()).ok).toBe(true);
    });
    expect(result.current.lifecycle.state).toBe("active");
    expect(result.current.lifecycle.breakSeconds).toBe(300);
    expect(mockSetShiftBreak).toHaveBeenLastCalledWith("end");
  });

  it("will not resume when not on break", async () => {
    mockGetShiftState.mockResolvedValue({ current: shift(), lastEnded: null });
    const { result } = setup();
    await waitFor(() => expect(result.current.lifecycle.state).toBe("active"));
    await act(async () => {
      expect(await result.current.endBreak()).toEqual({ ok: false, reason: "not_allowed" });
    });
    expect(mockSetShiftBreak).not.toHaveBeenCalled();
  });

  it("starts from nothing when a different person signs in", async () => {
    mockGetShiftState.mockResolvedValue({ current: shift(), lastEnded: null });
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.lifecycle.state).toBe("active"));

    mockGetShiftState.mockResolvedValue({ current: null, lastEnded: null });
    rerender({ scope: "hotel-2:user-9", isOnline: true, enabled: true });
    expect(result.current.lifecycle.state).toBe("unknown");
    await waitFor(() => expect(result.current.lifecycle.state).toBe("not_started"));
  });

  it("ignores a response that arrives after the person changed", async () => {
    let resolveRead: (value: unknown) => void = () => undefined;
    mockGetShiftState.mockImplementationOnce(() => new Promise((resolve) => { resolveRead = resolve; }));
    const { result, rerender } = setup();

    mockGetShiftState.mockResolvedValue({ current: null, lastEnded: null });
    rerender({ scope: "hotel-2:user-9", isOnline: true, enabled: true });
    await act(async () => {
      resolveRead({ current: shift({ user_id: "user-1" }), lastEnded: null });
    });
    await waitFor(() => expect(result.current.lifecycle.state).toBe("not_started"));
    expect(result.current.lifecycle.shift).toBeNull();
  });

  it("keeps the last known state, marked stale, when a later read fails", async () => {
    mockGetShiftState.mockResolvedValueOnce({ current: shift(), lastEnded: null });
    const { result } = setup();
    await waitFor(() => expect(result.current.lifecycle.state).toBe("active"));

    mockGetShiftState.mockRejectedValue(new Error("offline"));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.lifecycle.state).toBe("active");
    expect(result.current.lifecycle.stale).toBe(true);
  });
});
