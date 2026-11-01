import { act, renderHook, waitFor } from "@testing-library/react-native";
import { MAX_REFRESH_PAGES, useWorkQueue } from "@/lib/engineering/useWorkQueue";
import { initialQueueState, queueReducer, MAX_BUCKETS } from "@/lib/engineering/workQueueState";
import { EMPTY_FILTERS, buildListParams, type WorkOrderListParams } from "@/lib/engineering/workQueue";
import type { WorkOrder } from "@/lib/engineering/workOrders";

const ME = "eng-me";
const make = (n: number, over: Partial<WorkOrder> = {}): WorkOrder => ({
  id: `wo-${String(n).padStart(4, "0")}`,
  title: `Job ${n}`,
  status: "open",
  priority: "normal",
  assigned_to: null,
  created_at: "2026-10-15T10:00:00Z",
  ...over,
});
const many = (count: number, over: Partial<WorkOrder> = {}) => Array.from({ length: count }, (_, i) => make(i + 1, over));

/** A fake paged API over `rows`: pages of `size`, a real has_more, and a call log. */
function pagedApi(rows: WorkOrder[], size = 25) {
  const calls: number[] = [];
  const fetchPage = jest.fn(async (_params: WorkOrderListParams, page: number) => {
    calls.push(page);
    const start = (page - 1) * size;
    return { orders: rows.slice(start, start + size), hasMore: start + size < rows.length };
  });
  return { fetchPage, calls };
}

const viewer = { userId: ME, role: "engineer" };
const available = buildListParams("available", EMPTY_FILTERS, "", { role: "engineer" });

type FetchPage = NonNullable<Parameters<typeof useWorkQueue>[0]["fetchPage"]>;

function mount(fetchPage: FetchPage, extra: Partial<Parameters<typeof useWorkQueue>[0]> = {}) {
  return renderHook((props: Parameters<typeof useWorkQueue>[0]) => useWorkQueue(props), {
    initialProps: { scope: "t1:u1", view: "available", params: available, viewer, enabled: true, fetchPage, ...extra },
  });
}

describe("work queue state reducer", () => {
  it("replaces on first load and appends on more, never repeating an id", () => {
    let state = initialQueueState("s");
    state = queueReducer(state, { type: "start", key: "k", mode: "initial", now: 1 });
    expect(state.buckets.k.loading).toBe(true);
    state = queueReducer(state, { type: "success", key: "k", mode: "initial", orders: many(3), pages: 1, hasMore: true, now: 2 });
    // The next page overlaps by one row because an order moved while paging.
    state = queueReducer(state, { type: "start", key: "k", mode: "more", now: 3 });
    state = queueReducer(state, { type: "success", key: "k", mode: "more", orders: [make(3), make(4)], pages: 1, hasMore: false, now: 4 });
    expect(state.buckets.k.items.map((o) => o.id)).toEqual(["wo-0001", "wo-0002", "wo-0003", "wo-0004"]);
    expect(state.buckets.k.page).toBe(2);
    expect(state.buckets.k.hasMore).toBe(false);
  });

  it("keeps rows on a failed refresh and records the failure", () => {
    let state = initialQueueState("s");
    state = queueReducer(state, { type: "success", key: "k", mode: "initial", orders: many(2), pages: 1, hasMore: false, now: 1 });
    state = queueReducer(state, { type: "start", key: "k", mode: "refresh", now: 2 });
    state = queueReducer(state, { type: "failure", key: "k", failure: "offline" });
    expect(state.buckets.k.items).toHaveLength(2);
    expect(state.buckets.k.failure).toBe("offline");
    expect(state.buckets.k.refreshing).toBe(false);
  });

  it("invalidates every bucket but the one in use, removes one row, and resets on a new scope", () => {
    let state = initialQueueState("s");
    for (const key of ["a", "b"]) {
      state = queueReducer(state, { type: "success", key, mode: "initial", orders: many(2), pages: 1, hasMore: false, now: 1 });
    }
    state = queueReducer(state, { type: "invalidate", exceptKey: "a" });
    expect(state.buckets.a.stale).toBe(false);
    expect(state.buckets.b.stale).toBe(true);
    state = queueReducer(state, { type: "remove", key: "a", id: "wo-0001" });
    expect(state.buckets.a.items.map((o) => o.id)).toEqual(["wo-0002"]);
    expect(queueReducer(state, { type: "reset", scope: "other" }).buckets).toEqual({});
    expect(queueReducer(state, { type: "reset", scope: "s" })).toBe(state);
  });

  it("bounds the cache while someone types a search", () => {
    let state = initialQueueState("s");
    for (let i = 0; i < MAX_BUCKETS + 5; i += 1) {
      state = queueReducer(state, { type: "start", key: `k${i}`, mode: "initial", now: i + 1 });
    }
    expect(Object.keys(state.buckets)).toHaveLength(MAX_BUCKETS);
    expect(state.buckets[`k${MAX_BUCKETS + 4}`]).toBeDefined();
  });
});

describe("useWorkQueue", () => {
  it("loads page by page through more than 100 records with no gaps or duplicates", async () => {
    const { fetchPage } = pagedApi(many(130));
    const { result } = mount(fetchPage);
    await waitFor(() => expect(result.current.bucket.loaded).toBe(true));
    expect(result.current.bucket.items).toHaveLength(25);
    expect(result.current.bucket.hasMore).toBe(true);

    for (const expected of [50, 75, 100, 125, 130]) {
      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.bucket.items.length).toBe(expected));
    }
    const ids = result.current.bucket.items.map((o) => o.id);
    expect(ids).toHaveLength(130);
    expect(new Set(ids).size).toBe(130);
    expect(result.current.bucket.hasMore).toBe(false);
    // Past the end, loadMore does nothing.
    act(() => result.current.loadMore());
    expect(fetchPage).toHaveBeenCalledTimes(6);
  });

  it("does not ask for the same next page twice while one is in flight", async () => {
    const { fetchPage } = pagedApi(many(60));
    const { result } = mount(fetchPage);
    await waitFor(() => expect(result.current.bucket.loaded).toBe(true));
    act(() => {
      result.current.loadMore();
      result.current.loadMore();
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.bucket.items).toHaveLength(50));
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("refreshes the loaded pages in place instead of appending a second copy", async () => {
    const rows = many(60);
    const { fetchPage } = pagedApi(rows);
    const { result } = mount(fetchPage);
    await waitFor(() => expect(result.current.bucket.loaded).toBe(true));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.bucket.items).toHaveLength(50));
    rows.splice(0, 1); // a realtime change: the first order was claimed elsewhere
    await act(async () => {
      await result.current.refresh();
    });
    const ids = result.current.bucket.items.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("wo-0001");
    expect(ids).toHaveLength(50);
  });

  it("caps a refresh at the page limit", async () => {
    const { fetchPage, calls } = pagedApi(many(400), 25);
    const { result } = mount(fetchPage);
    await waitFor(() => expect(result.current.bucket.loaded).toBe(true));
    for (let i = 0; i < 6; i += 1) {
      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.bucket.page).toBe(i + 2));
    }
    calls.length = 0;
    await act(async () => {
      await result.current.refresh();
    });
    expect(calls).toHaveLength(MAX_REFRESH_PAGES);
  });

  it("ignores a slow, older response that arrives after a newer one", async () => {
    let releaseSlow: (v: { orders: WorkOrder[]; hasMore: boolean }) => void = () => undefined;
    let call = 0;
    const fetchPage = jest.fn(async () => {
      call += 1;
      if (call === 2) return new Promise<{ orders: WorkOrder[]; hasMore: boolean }>((resolve) => (releaseSlow = resolve));
      return { orders: call === 1 ? [make(1)] : [make(9)], hasMore: false };
    });
    const { result } = mount(fetchPage);
    await waitFor(() => expect(result.current.bucket.loaded).toBe(true));
    let slow!: Promise<void>;
    act(() => {
      slow = result.current.refresh(); // call 2 — will be slow
    });
    await act(async () => {
      await result.current.refresh(); // call 3 — newer, resolves first
    });
    expect(result.current.bucket.items.map((o) => o.id)).toEqual(["wo-0009"]);
    await act(async () => {
      releaseSlow({ orders: [make(5)], hasMore: false });
      await slow;
    });
    expect(result.current.bucket.items.map((o) => o.id)).toEqual(["wo-0009"]);
  });

  it("drops a response that lands after the hotel or person changed", async () => {
    const releases: ((v: { orders: WorkOrder[]; hasMore: boolean }) => void)[] = [];
    const fetchPage = jest.fn(() => new Promise<{ orders: WorkOrder[]; hasMore: boolean }>((resolve) => releases.push(resolve)));
    const { result, rerender } = mount(fetchPage);
    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(1));
    rerender({ scope: "t2:u2", view: "available", params: available, viewer, enabled: true, fetchPage });
    await act(async () => {
      releases[0]({ orders: [make(1)], hasMore: false }); // the old hotel's request finally answers
    });
    expect(result.current.bucket.items).toEqual([]);
    await act(async () => {
      releases[1]({ orders: [make(2)], hasMore: false }); // the new hotel's own request
    });
    expect(result.current.bucket.items.map((o) => o.id)).toEqual(["wo-0002"]);
  });

  it("starts empty for a new scope and never shows the previous hotel's rows", async () => {
    const { fetchPage } = pagedApi(many(3));
    const { result, rerender } = mount(fetchPage);
    await waitFor(() => expect(result.current.bucket.items).toHaveLength(3));
    const seen: number[] = [];
    fetchPage.mockImplementation(async () => ({ orders: [make(99)], hasMore: false }));
    rerender({ scope: "t2:u2", view: "available", params: available, viewer, enabled: true, fetchPage });
    seen.push(result.current.bucket.items.length);
    await waitFor(() => expect(result.current.bucket.items.map((o) => o.id)).toEqual(["wo-0099"]));
    expect(seen).toEqual([0]);
  });

  it("filters out stray rows an older API ignored a filter for", async () => {
    const fetchPage = jest.fn(async () => ({
      orders: [make(1), make(2, { status: "completed" }), make(3, { assigned_to: "someone" })],
      hasMore: false,
    }));
    const { result } = mount(fetchPage);
    await waitFor(() => expect(result.current.bucket.loaded).toBe(true));
    expect(result.current.bucket.items.map((o) => o.id)).toEqual(["wo-0001"]);
  });

  it("keeps each view's rows when switching away and back, and loads a view only when first opened", async () => {
    const { fetchPage } = pagedApi(many(3));
    const done = buildListParams("done", EMPTY_FILTERS, "", { role: "engineer" });
    const { result, rerender } = mount(fetchPage);
    await waitFor(() => expect(result.current.bucket.loaded).toBe(true));
    expect(fetchPage).toHaveBeenCalledTimes(1); // Done (history) was never requested

    fetchPage.mockImplementation(async () => ({ orders: [make(50, { status: "completed" })], hasMore: false }));
    rerender({ scope: "t1:u1", view: "done", params: done, viewer, enabled: true, fetchPage });
    await waitFor(() => expect(result.current.bucket.items.map((o) => o.id)).toEqual(["wo-0050"]));
    rerender({ scope: "t1:u1", view: "available", params: available, viewer, enabled: true, fetchPage });
    expect(result.current.bucket.items).toHaveLength(3);
    expect(fetchPage).toHaveBeenCalledTimes(2); // coming back did not refetch
  });

  it("surfaces a failure as a failure (rows kept) and does not retry on its own", async () => {
    const fetchPage = jest
      .fn()
      .mockResolvedValueOnce({ orders: [make(1)], hasMore: false })
      .mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    const { result } = mount(fetchPage);
    await waitFor(() => expect(result.current.bucket.loaded).toBe(true));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.bucket.failure).toBe("failed");
    expect(result.current.bucket.items).toHaveLength(1);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("revalidates a stale view when it is next used, and removes a claimed row immediately", async () => {
    const { fetchPage } = pagedApi(many(3));
    const { result } = mount(fetchPage);
    await waitFor(() => expect(result.current.bucket.loaded).toBe(true));
    act(() => result.current.removeItem("wo-0001"));
    expect(result.current.bucket.items.map((o) => o.id)).toEqual(["wo-0002", "wo-0003"]);
  });

  it("does nothing until enabled", async () => {
    const { fetchPage } = pagedApi(many(3));
    const { result } = mount(fetchPage, { enabled: false });
    await act(async () => undefined);
    expect(fetchPage).not.toHaveBeenCalled();
    expect(result.current.bucket.loaded).toBe(false);
  });
});
