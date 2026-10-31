import { act, renderHook, waitFor } from "@testing-library/react-native";

jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn() } }));

import {
  findCachedAsset,
  markAssetListStale,
  resetAssetBrowseCache,
  takeAssetListStale,
  useAssetBrowse,
} from "@/lib/engineering/useAssetBrowse";
import { ASSET_PAGE_SIZE, EMPTY_ASSET_FILTERS, type AssetFilters, type AssetPage, type AssetRow } from "@/lib/engineering/assetModel";

const make = (n: number, prefix = "a"): AssetRow => ({
  id: `${prefix}-${n}`,
  name: `Asset ${n}`,
  asset_tag: `TAG-${n}`,
  service_status: "operational",
  active_work_order_count: 0,
  pm_overdue: false,
  pm_due_soon: false,
  repeat_repairs_90d: 0,
  has_active_prediction: false,
  had_downtime_365d: false,
});

/** A server holding `total` assets that honours the page size. */
function serverOf(total: number, prefix = "a") {
  return jest.fn(async (_f: AssetFilters, query: string, page: number): Promise<AssetPage> => {
    const all = Array.from({ length: total }, (_, i) => make(i + 1, prefix)).filter((r) => !query || r.name.includes(query));
    const start = (page - 1) * ASSET_PAGE_SIZE;
    return { rows: all.slice(start, start + ASSET_PAGE_SIZE), hasMore: start + ASSET_PAGE_SIZE < all.length, total: all.length };
  });
}

const defer = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};

beforeEach(() => resetAssetBrowseCache());

const mount = (fetchPage: ReturnType<typeof serverOf>, over: { scope?: string | null; query?: string; filters?: AssetFilters } = {}) =>
  renderHook((props: { scope: string | null; query: string; filters: AssetFilters }) => useAssetBrowse({ ...props, fetchPage }), {
    initialProps: { scope: "h1:u1", query: "", filters: EMPTY_ASSET_FILTERS, ...over } as { scope: string | null; query: string; filters: AssetFilters },
  });

describe("paging a large inventory", () => {
  it("loads every page of a 300-asset hotel, in order, with no duplicates", async () => {
    const server = serverOf(300);
    const { result } = mount(server);
    await waitFor(() => expect(result.current.rows).toHaveLength(ASSET_PAGE_SIZE));
    expect(result.current.total).toBe(300);
    expect(result.current.hasMore).toBe(true);

    for (let i = 0; i < 12; i++) {
      await act(async () => result.current.loadMore());
      await waitFor(() => expect(result.current.loadingMore).toBe(false));
    }
    expect(result.current.rows).toHaveLength(300);
    expect(new Set(result.current.rows.map((r) => r.id)).size).toBe(300);
    expect(result.current.hasMore).toBe(false);
    expect(server).toHaveBeenCalledTimes(12);
  });

  it("ignores a burst of end-reached events: one request per page", async () => {
    const first = defer<AssetPage>();
    const server = serverOf(100);
    server.mockImplementationOnce(() => first.promise);
    const { result } = mount(server);
    first.resolve({ rows: Array.from({ length: 25 }, (_, i) => make(i + 1)), hasMore: true, total: 100 });
    await waitFor(() => expect(result.current.rows).toHaveLength(25));

    await act(async () => {
      result.current.loadMore();
      result.current.loadMore();
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.loadingMore).toBe(false));
    expect(server).toHaveBeenCalledTimes(2);
    expect(result.current.rows).toHaveLength(50);
  });

  it("does not repeat a row if the server returns an overlapping page", async () => {
    const server = jest
      .fn<Promise<AssetPage>, [AssetFilters, string, number]>()
      .mockResolvedValueOnce({ rows: [make(1), make(2)], hasMore: true, total: 3 })
      .mockResolvedValueOnce({ rows: [make(2), make(3)], hasMore: false, total: 3 });
    const { result } = mount(server as never);
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    await act(async () => result.current.loadMore());
    await waitFor(() => expect(result.current.rows.map((r) => r.id)).toEqual(["a-1", "a-2", "a-3"]));
  });
});

describe("search and filters run on the server", () => {
  it("a new search replaces the list and is sent to the server, not filtered locally", async () => {
    const server = serverOf(120);
    const { result, rerender } = mount(server);
    await waitFor(() => expect(result.current.rows).toHaveLength(25));
    rerender({ scope: "h1:u1", query: "Asset 117", filters: EMPTY_ASSET_FILTERS });
    await waitFor(() => expect(result.current.rows.map((r) => r.id)).toEqual(["a-117"]));
    expect(server).toHaveBeenLastCalledWith(EMPTY_ASSET_FILTERS, "Asset 117", 1, expect.anything());
  });

  it("a slow answer for an old search never overwrites the newer one", async () => {
    const slow = defer<AssetPage>();
    const server = jest
      .fn<Promise<AssetPage>, [AssetFilters, string, number]>()
      .mockImplementationOnce(() => slow.promise)
      .mockResolvedValueOnce({ rows: [make(9)], hasMore: false, total: 1 });
    const { result, rerender } = mount(server as never, { query: "old" });
    rerender({ scope: "h1:u1", query: "new", filters: EMPTY_ASSET_FILTERS });
    await waitFor(() => expect(result.current.rows.map((r) => r.id)).toEqual(["a-9"]));
    await act(async () => slow.resolve({ rows: [make(1), make(2)], hasMore: false, total: 2 }));
    expect(result.current.rows.map((r) => r.id)).toEqual(["a-9"]);
  });

  it("coming back to a request reuses the pages already loaded", async () => {
    const server = serverOf(60);
    const { result, rerender } = mount(server);
    await waitFor(() => expect(result.current.rows).toHaveLength(25));
    await act(async () => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(50));
    rerender({ scope: "h1:u1", query: "7", filters: EMPTY_ASSET_FILTERS });
    await waitFor(() => expect(result.current.rows.every((r) => r.name.includes("7"))).toBe(true));
    rerender({ scope: "h1:u1", query: "", filters: EMPTY_ASSET_FILTERS });
    expect(result.current.rows.length).toBeGreaterThanOrEqual(50);
  });
});

describe("failure and offline", () => {
  it("a failed first read is an error, never an empty inventory", async () => {
    const server = jest.fn().mockRejectedValue(Object.assign(new Error("HTTP 500"), { status: 500 }));
    const { result } = mount(server as never);
    await waitFor(() => expect(result.current.failure).toBe("failed"));
    expect(result.current.loaded).toBe(false);
    expect(result.current.rows).toEqual([]);
  });

  it("a failed refresh keeps the rows on screen and reports it", async () => {
    const server = serverOf(10);
    const { result } = mount(server);
    await waitFor(() => expect(result.current.rows).toHaveLength(10));
    server.mockRejectedValueOnce(new Error("Network request failed"));
    await act(async () => result.current.refresh());
    expect(result.current.failure).toBe("offline");
    expect(result.current.rows).toHaveLength(10);
    expect(result.current.syncedAt).toBeInstanceOf(Date);
  });

  it("reports a refused role as forbidden", async () => {
    const server = jest.fn().mockRejectedValue(Object.assign(new Error("HTTP 403"), { status: 403 }));
    const { result } = mount(server as never);
    await waitFor(() => expect(result.current.failure).toBe("forbidden"));
  });
});

describe("hotel and account isolation", () => {
  it("never shows one person's or hotel's rows to another", async () => {
    const hotelA = serverOf(30, "A");
    const { result, rerender } = mount(hotelA, { scope: "hotelA:u1" });
    await waitFor(() => expect(result.current.rows[0]?.id).toBe("A-1"));

    const hotelB = serverOf(5, "B");
    const second = renderHook(() => useAssetBrowse({ scope: "hotelB:u2", filters: EMPTY_ASSET_FILTERS, query: "", fetchPage: hotelB }));
    expect(second.result.current.rows).toEqual([]);
    await waitFor(() => expect(second.result.current.rows.map((r) => r.id)).toEqual(["B-1", "B-2", "B-3", "B-4", "B-5"]));

    rerender({ scope: "hotelB:u2", query: "", filters: EMPTY_ASSET_FILTERS });
    expect(result.current.rows.every((r) => !r.id.startsWith("A-"))).toBe(true);
  });

  it("finds a cached asset only inside the caller's own scope", async () => {
    const { result } = mount(serverOf(5, "A"), { scope: "hotelA:u1" });
    await waitFor(() => expect(result.current.rows).toHaveLength(5));
    expect(findCachedAsset("hotelA:u1", { kind: "tag", value: "TAG-3" })).toMatchObject({ id: "A-3" });
    expect(findCachedAsset("hotelA:u1", { kind: "id", value: "a-3" })).toMatchObject({ name: "Asset 3" });
    expect(findCachedAsset("hotelB:u2", { kind: "tag", value: "TAG-3" })).toBeNull();
    expect(findCachedAsset("hotelA:u9", { kind: "tag", value: "TAG-3" })).toBeNull();
    expect(findCachedAsset(null, { kind: "tag", value: "TAG-3" })).toBeNull();
    expect(findCachedAsset("hotelA:u1", { kind: "tag", value: "TAG-99" })).toBeNull();
  });
});

describe("list refresh flag", () => {
  it("is raised by a change elsewhere and consumed exactly once", () => {
    expect(takeAssetListStale()).toBe(false);
    markAssetListStale();
    expect(takeAssetListStale()).toBe(true);
    expect(takeAssetListStale()).toBe(false);
  });
});
