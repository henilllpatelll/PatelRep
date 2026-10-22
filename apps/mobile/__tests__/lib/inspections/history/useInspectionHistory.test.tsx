import { act, renderHook, waitFor } from "@testing-library/react-native";

jest.mock("@/lib/supabase", () => ({ supabase: { auth: { getSession: jest.fn(), refreshSession: jest.fn() } } }));
const mockSubscribe = jest.fn((..._args: unknown[]) => jest.fn());
jest.mock("@/lib/housekeeping/supervisorRealtime", () => ({ subscribeSupervisorRealtime: (...args: unknown[]) => mockSubscribe(...args) }));

const mockState: { user: { id: string; tenant_id: string } | null; isOnline: boolean; hotelTimezone: string | null } = {
  user: { id: "sup-1", tenant_id: "hotel-1" },
  isOnline: true,
  hotelTimezone: "America/Chicago",
};
jest.mock("@/stores/appStore", () => {
  const hook = (selector?: (state: unknown) => unknown) => (selector ? selector(mockState) : mockState);
  hook.getState = () => mockState;
  return { useAppStore: hook };
});

import { DEFAULT_HISTORY_FILTERS } from "@/lib/inspections/history/filters";
import { PAGE_SIZE, useInspectionHistory, type HistoryFetchers } from "@/lib/inspections/history/useInspectionHistory";
import { historyInsights, historyRow } from "../../../helpers/inspectionFixtures";

const NOW = Date.parse("2026-10-21T17:00:00Z"); // 12:00 PM in Chicago

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const page = (rows: ReturnType<typeof historyRow>[], over: Record<string, unknown> = {}) => ({ rows, hasMore: false, nextCursor: null, total: rows.length, ...over });

function fetchers(over: Partial<HistoryFetchers> = {}): HistoryFetchers {
  return {
    page: jest.fn().mockResolvedValue(page([])),
    insights: jest.fn().mockResolvedValue(historyInsights()),
    inspectors: jest.fn().mockResolvedValue({ rows: [{ id: "u1", name: "Ana", count: 2 }], truncated: false }),
    ...over,
  };
}

let dateNow: jest.SpyInstance;
beforeEach(() => {
  dateNow = jest.spyOn(Date, "now").mockReturnValue(NOW);
  mockState.user = { id: "sup-1", tenant_id: "hotel-1" };
  mockState.isOnline = true;
  mockState.hotelTimezone = "America/Chicago";
  mockSubscribe.mockClear();
});
afterEach(() => dateNow.mockRestore());

const hook = (f: HistoryFetchers, opts: { enabled?: boolean } = {}) => renderHook(() => useInspectionHistory({ fetchers: f, realtime: false, ...opts }));

describe("useInspectionHistory", () => {
  it("is idle until enabled, then reads today from the hotel's clock", async () => {
    const f = fetchers();
    const { result, rerender } = renderHook((props: { enabled: boolean }) => useInspectionHistory({ fetchers: f, realtime: false, enabled: props.enabled }), { initialProps: { enabled: false } });
    expect(result.current.list.status).toBe("idle");
    expect(f.page).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.list.status).toBe("ready"));
    expect(result.current.today).toBe("2026-10-21");
    expect(f.page).toHaveBeenCalledWith({ dateFrom: "2026-10-21", dateTo: "2026-10-21", limit: PAGE_SIZE, cursor: null });
    expect(f.insights).toHaveBeenCalledWith("2026-10-21", "2026-10-21");
  });

  it("uses the HOTEL's date, not the phone's, around midnight", async () => {
    dateNow.mockReturnValue(Date.parse("2026-10-22T03:30:00Z")); // 10:30 PM Oct 21 in Chicago, already Oct 22 in UTC
    const f = fetchers();
    const { result } = hook(f);
    await waitFor(() => expect(result.current.list.status).toBe("ready"));
    expect(result.current.today).toBe("2026-10-21");
  });

  it("pages with the server's cursor and merges without duplicates", async () => {
    const f = fetchers({
      page: jest
        .fn()
        .mockResolvedValueOnce(page([historyRow("a"), historyRow("b")], { hasMore: true, nextCursor: "C1", total: 3 }))
        .mockResolvedValueOnce(page([historyRow("b"), historyRow("c")], { hasMore: false, nextCursor: null, total: null })),
    });
    const { result } = hook(f);
    await waitFor(() => expect(result.current.list.status).toBe("ready"));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.list.status === "ready" && result.current.list.items.length).toBe(3));
    expect(f.page).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "C1" }));
    const list = result.current.list;
    expect(list.status === "ready" && list.hasMore).toBe(false);
    expect(list.status === "ready" && list.total).toBe(3); // the first page's exact total is kept
  });

  it("ignores load-more while one is in flight or when there is nothing more", async () => {
    const more = deferred<ReturnType<typeof page>>();
    const f = fetchers({ page: jest.fn().mockResolvedValueOnce(page([historyRow("a")], { hasMore: true, nextCursor: "C1" })).mockReturnValueOnce(more.promise) });
    const { result } = hook(f);
    await waitFor(() => expect(result.current.list.status).toBe("ready"));
    act(() => result.current.loadMore());
    act(() => result.current.loadMore());
    expect(f.page).toHaveBeenCalledTimes(2); // one first page + ONE more
    await act(async () => more.resolve(page([historyRow("b")])));
    act(() => result.current.loadMore());
    expect(f.page).toHaveBeenCalledTimes(2); // nothing left to load
  });

  it("a failed load-more keeps the rows and flags it", async () => {
    const f = fetchers({ page: jest.fn().mockResolvedValueOnce(page([historyRow("a")], { hasMore: true, nextCursor: "C1" })).mockRejectedValueOnce(new Error("boom")) });
    const { result } = hook(f);
    await waitFor(() => expect(result.current.list.status).toBe("ready"));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.list.status === "ready" && result.current.list.moreFailed).toBe(true));
    expect(result.current.list.status === "ready" && result.current.list.items).toHaveLength(1);
  });

  it("changing a filter starts a new question: old rows are gone and a late old answer is dropped", async () => {
    const slow = deferred<ReturnType<typeof page>>();
    const f = fetchers({ page: jest.fn().mockReturnValueOnce(slow.promise).mockResolvedValueOnce(page([historyRow("failed-1", { overall_result: "failed" })])) });
    const { result } = hook(f);
    act(() => result.current.setFilters((previous) => ({ ...previous, result: "failed" })));
    await waitFor(() => expect(result.current.list.status === "ready" && result.current.list.items[0]?.id).toBe("failed-1"));
    await act(async () => slow.resolve(page([historyRow("stale-today")]))); // the answer to the OLD question arrives late
    const list = result.current.list;
    expect(list.status === "ready" && list.items.map((item) => item.id)).toEqual(["failed-1"]);
  });

  it("debounces the room search before asking the server", async () => {
    jest.useFakeTimers();
    try {
      const f = fetchers();
      const { result } = hook(f);
      await act(async () => { jest.advanceTimersByTime(10); });
      const before = (f.page as jest.Mock).mock.calls.length;
      act(() => result.current.setFilters((previous) => ({ ...previous, room: "2" })));
      act(() => result.current.setFilters((previous) => ({ ...previous, room: "20" })));
      act(() => result.current.setFilters((previous) => ({ ...previous, room: "204" })));
      await act(async () => { jest.advanceTimersByTime(100); });
      expect((f.page as jest.Mock).mock.calls.length).toBe(before); // still typing
      await act(async () => { jest.advanceTimersByTime(400); });
      expect(f.page).toHaveBeenLastCalledWith(expect.objectContaining({ roomNumber: "204" }));
      expect((f.page as jest.Mock).mock.calls.length).toBe(before + 1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("a failed first read is 'failed', not an empty list", async () => {
    const f = fetchers({ page: jest.fn().mockRejectedValue(Object.assign(new Error("boom"), { status: 500 })) });
    const { result } = hook(f);
    await waitFor(() => expect(result.current.list.status).toBe("failed"));
  });

  it("a failed REFRESH of the same question keeps the verified rows, marked stale", async () => {
    const f = fetchers({ page: jest.fn().mockResolvedValueOnce(page([historyRow("a")])).mockRejectedValueOnce(new Error("boom")) });
    const { result } = hook(f);
    await waitFor(() => expect(result.current.list.status).toBe("ready"));
    await act(async () => result.current.refresh());
    const list = result.current.list;
    expect(list.status).toBe("ready");
    expect(list.status === "ready" && list.stale).toBe("refresh_failed");
    expect(list.status === "ready" && list.items.map((item) => item.id)).toEqual(["a"]);
  });

  it("offline keeps what is shown and calls it stale; going back online refreshes", async () => {
    const f = fetchers({ page: jest.fn().mockResolvedValue(page([historyRow("a")])) });
    const { result, rerender } = hook(f);
    await waitFor(() => expect(result.current.list.status).toBe("ready"));
    mockState.isOnline = false;
    rerender({});
    await waitFor(() => expect(result.current.list.status === "ready" && result.current.list.stale).toBe("offline"));
    mockState.isOnline = true;
    rerender({});
    await waitFor(() => expect(result.current.list.status === "ready" && result.current.list.stale).toBeNull());
    expect((f.page as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("insights fail independently of the list", async () => {
    const f = fetchers({ page: jest.fn().mockResolvedValue(page([historyRow("a")])), insights: jest.fn().mockRejectedValue(new Error("boom")) });
    const { result } = hook(f);
    await waitFor(() => expect(result.current.insights.status).toBe("failed"));
    expect(result.current.list.status).toBe("ready");
  });

  it("insights follow the period, not the other filters", async () => {
    const f = fetchers();
    const { result } = hook(f);
    await waitFor(() => expect(result.current.insights.status).toBe("ready"));
    const calls = (f.insights as jest.Mock).mock.calls.length;
    act(() => result.current.setFilters((previous) => ({ ...previous, result: "failed" })));
    await waitFor(() => expect(f.page).toHaveBeenCalledTimes(2));
    expect((f.insights as jest.Mock).mock.calls.length).toBe(calls);
    act(() => result.current.setFilters((previous) => ({ ...previous, period: "7d" })));
    await waitFor(() => expect(f.insights).toHaveBeenLastCalledWith("2026-10-15", "2026-10-21"));
  });

  it("an invalid custom range fetches nothing and says why", async () => {
    const f = fetchers();
    const { result } = hook(f);
    await waitFor(() => expect(result.current.list.status).toBe("ready"));
    const calls = (f.page as jest.Mock).mock.calls.length;
    act(() => result.current.setFilters((previous) => ({ ...previous, period: "custom", custom: { from: "2026-10-21", to: "2026-10-01" } })));
    expect(result.current.rangeProblem).toBe("reversed");
    expect(result.current.range).toBeNull();
    expect((f.page as jest.Mock).mock.calls.length).toBe(calls);
  });

  it("loads who inspected on demand, for the selected period", async () => {
    const f = fetchers();
    const { result } = hook(f);
    await waitFor(() => expect(result.current.list.status).toBe("ready"));
    expect(f.inspectors).not.toHaveBeenCalled();
    act(() => result.current.loadInspectors());
    await waitFor(() => expect(result.current.inspectors.status).toBe("ready"));
    expect(f.inspectors).toHaveBeenCalledWith("2026-10-21", "2026-10-21");
    expect(result.current.inspectors.rows[0].name).toBe("Ana");
  });

  it("switching hotel throws away the old answers, the chosen filters and any in-flight reply", async () => {
    const slow = deferred<ReturnType<typeof page>>();
    const f = fetchers({ page: jest.fn().mockResolvedValueOnce(page([historyRow("hotel-1-row")])).mockReturnValueOnce(slow.promise).mockResolvedValue(page([historyRow("hotel-2-row")])) });
    const { result, rerender } = hook(f);
    await waitFor(() => expect(result.current.list.status).toBe("ready"));
    act(() => result.current.setFilters((previous) => ({ ...previous, result: "failed" })));
    mockState.user = { id: "sup-1", tenant_id: "hotel-2" };
    rerender({});
    await waitFor(() => expect(result.current.list.status === "ready" && result.current.list.items[0]?.id).toBe("hotel-2-row"));
    await act(async () => slow.resolve(page([historyRow("late-hotel-1")])));
    expect(result.current.filters).toEqual(DEFAULT_HISTORY_FILTERS);
    const list = result.current.list;
    expect(list.status === "ready" && list.items.map((item) => item.id)).toEqual(["hotel-2-row"]);
  });

  it("refreshes through the shared channel only when the period includes today", async () => {
    const f = fetchers();
    const { result } = renderHook(() => useInspectionHistory({ fetchers: f }));
    await waitFor(() => expect(result.current.list.status).toBe("ready"));
    const onChange = mockSubscribe.mock.calls[0][1] as () => void;
    const before = (f.page as jest.Mock).mock.calls.length;
    await act(async () => onChange());
    expect((f.page as jest.Mock).mock.calls.length).toBe(before + 1);
    act(() => result.current.setFilters((previous) => ({ ...previous, period: "custom", custom: { from: "2026-10-01", to: "2026-10-05" } })));
    await waitFor(() => expect(f.page).toHaveBeenLastCalledWith(expect.objectContaining({ dateFrom: "2026-10-01" })));
    const after = (f.page as jest.Mock).mock.calls.length;
    const latest = mockSubscribe.mock.calls[mockSubscribe.mock.calls.length - 1][1] as () => void;
    await act(async () => latest());
    expect((f.page as jest.Mock).mock.calls.length).toBe(after); // an old period can't have changed
  });
});
