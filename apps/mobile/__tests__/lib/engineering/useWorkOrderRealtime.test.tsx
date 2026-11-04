import { act, renderHook } from "@testing-library/react-native";

const mockHandlers: Array<() => void> = [];
const mockChannel = jest.fn();
const mockRemove = jest.fn();
jest.mock("@/lib/supabase", () => ({
  supabase: {
    channel: (name: string) => {
      mockChannel(name);
      const ch: { on: jest.Mock; subscribe: jest.Mock } = { on: jest.fn(), subscribe: jest.fn().mockReturnValue({}) };
      ch.on.mockImplementation((_t: string, filter: { filter: string }, cb: () => void) => {
        mockHandlers.push(cb);
        mockFilters.push(filter.filter);
        return ch;
      });
      return ch;
    },
    removeChannel: (c: unknown) => mockRemove(c),
  },
}));
const mockFilters: string[] = [];

import { REALTIME_DEBOUNCE_MS, useWorkOrderRealtime } from "@/lib/engineering/useWorkOrderRealtime";

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockHandlers.length = 0;
  mockFilters.length = 0;
});
afterEach(() => jest.useRealTimers());

describe("useWorkOrderRealtime", () => {
  it("subscribes once, scoped to the hotel, and not at all without one", () => {
    renderHook(() => useWorkOrderRealtime(null, jest.fn()));
    expect(mockChannel).not.toHaveBeenCalled();
    renderHook(() => useWorkOrderRealtime("h1", jest.fn()));
    expect(mockChannel).toHaveBeenCalledTimes(1);
    expect(mockFilters).toEqual(["tenant_id=eq.h1"]);
  });

  it("does not re-subscribe when the callback identity changes", () => {
    const { rerender } = renderHook(({ cb }: { cb: () => void }) => useWorkOrderRealtime("h1", cb), { initialProps: { cb: jest.fn() } });
    rerender({ cb: jest.fn() });
    rerender({ cb: jest.fn() });
    expect(mockChannel).toHaveBeenCalledTimes(1);
  });

  it("turns a burst into one trailing callback using the latest function", () => {
    const first = jest.fn();
    const latest = jest.fn();
    const { rerender } = renderHook(({ cb }: { cb: () => void }) => useWorkOrderRealtime("h1", cb), { initialProps: { cb: first } });
    rerender({ cb: latest });
    act(() => {
      for (let i = 0; i < 20; i += 1) mockHandlers[0]();
    });
    expect(latest).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(REALTIME_DEBOUNCE_MS + 10);
    });
    expect(latest).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("cancels a pending callback and the channel on unmount", () => {
    const cb = jest.fn();
    const { unmount } = renderHook(() => useWorkOrderRealtime("h1", cb));
    act(() => mockHandlers[0]());
    unmount();
    expect(mockRemove).toHaveBeenCalledTimes(1);
    act(() => {
      jest.advanceTimersByTime(REALTIME_DEBOUNCE_MS * 2);
    });
    expect(cb).not.toHaveBeenCalled();
  });

  it("moves to the new hotel's channel and ignores the old one when the hotel changes", () => {
    const cb = jest.fn();
    const { rerender } = renderHook(({ tenant }: { tenant: string }) => useWorkOrderRealtime(tenant, cb), { initialProps: { tenant: "h1" } });
    const oldHandler = mockHandlers[0];
    rerender({ tenant: "h2" });
    expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(mockChannel).toHaveBeenCalledTimes(2);
    expect(mockFilters).toEqual(["tenant_id=eq.h1", "tenant_id=eq.h2"]);
    act(() => {
      oldHandler();
      jest.advanceTimersByTime(REALTIME_DEBOUNCE_MS + 10);
    });
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("a change this phone confirmed", () => {
  it("shares the realtime debounce, so the change and its echo cost one callback", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { emitWorkOrderMutated } = require("@/lib/engineering/teamEvents");
    const cb = jest.fn();
    renderHook(() => useWorkOrderRealtime("h1", cb));
    act(() => {
      emitWorkOrderMutated();
      jest.advanceTimersByTime(600);
      mockHandlers[0](); // the realtime echo of the same change
      jest.advanceTimersByTime(REALTIME_DEBOUNCE_MS - 100);
    });
    expect(cb).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("stops listening after unmount or a hotel change", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { emitWorkOrderMutated } = require("@/lib/engineering/teamEvents");
    const cb = jest.fn();
    const { unmount } = renderHook(() => useWorkOrderRealtime("h1", cb));
    unmount();
    act(() => {
      emitWorkOrderMutated();
      jest.advanceTimersByTime(REALTIME_DEBOUNCE_MS * 2);
    });
    expect(cb).not.toHaveBeenCalled();
  });
});
