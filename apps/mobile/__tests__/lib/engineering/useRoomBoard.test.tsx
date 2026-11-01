import { act, renderHook, waitFor } from "@testing-library/react-native";

jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn() } }));

import { markRoomBoardStale, recallRoomView, rememberRoomView, resetRoomBoardCache, takeRoomBoardStale, useRoomBoard } from "@/lib/engineering/useRoomBoard";
import { EMPTY_ROOM_FILTERS, type RoomBoardPage, type RoomBoardRow, type RoomFilters } from "@/lib/engineering/roomModel";

const PAGE = 25;
const make = (n: number, prefix = "r"): RoomBoardRow => ({
  id: `${prefix}-${n}`,
  room_number: String(1000 + n),
  floor: 1 + Math.floor(n / 100),
  building: null,
  room_type: null,
  occupancy: "unknown",
  housekeeping_status: null,
  availability: null,
  unavailability: null,
  active_repair_count: 0,
  others_active_count: 0,
  top_priority: null,
  top_repair: null,
  last_activity_at: null,
  status_updated_at: null,
});

/** A server holding `total` rooms that honours the page size and the search text. */
function serverOf(total: number, prefix = "r") {
  return jest.fn(async (_f: RoomFilters, query: string, page: number): Promise<RoomBoardPage> => {
    const all = Array.from({ length: total }, (_, i) => make(i + 1, prefix)).filter((r) => !query || r.room_number.includes(query));
    const start = (page - 1) * PAGE;
    return { rows: all.slice(start, start + PAGE), total: all.length, hasMore: start + PAGE < all.length, counts: { total, active_repairs: 0, unavailable: 0, occupied: 0 }, floors: [1, 2], buildings: [] };
  });
}

const defer = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};

type Props = { scope: string | null; query: string; filters: RoomFilters };
const mount = (fetchPage: ReturnType<typeof serverOf>, over: Partial<Props> = {}) =>
  renderHook((props: Props) => useRoomBoard({ ...props, fetchPage }), { initialProps: { scope: "h1:u1", query: "", filters: EMPTY_ROOM_FILTERS, ...over } as Props });

beforeEach(() => resetRoomBoardCache());

describe("a large hotel", () => {
  it("pages through 300 rooms in order without duplicates or silent truncation", async () => {
    const server = serverOf(300);
    const { result } = mount(server);
    await waitFor(() => expect(result.current.rows).toHaveLength(PAGE));
    expect(result.current.total).toBe(300);
    expect(result.current.counts?.total).toBe(300);
    for (let i = 0; i < 12; i += 1) {
      await act(async () => result.current.loadMore());
      await waitFor(() => expect(result.current.loadingMore).toBe(false));
    }
    expect(result.current.rows).toHaveLength(300);
    expect(new Set(result.current.rows.map((r) => r.id)).size).toBe(300);
    expect(result.current.hasMore).toBe(false);
    expect(server).toHaveBeenCalledTimes(12);
  });

  it("a burst of end-reached events asks for one page", async () => {
    const first = defer<RoomBoardPage>();
    const server = serverOf(100);
    server.mockImplementationOnce(() => first.promise);
    const { result } = mount(server);
    await act(async () => first.resolve(await serverOf(100)(EMPTY_ROOM_FILTERS, "", 1)));
    await waitFor(() => expect(result.current.rows).toHaveLength(PAGE));
    await act(async () => {
      result.current.loadMore();
      result.current.loadMore();
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.rows).toHaveLength(PAGE * 2));
    expect(server).toHaveBeenCalledTimes(2);
  });
});

describe("search runs on the server over the whole hotel", () => {
  it("asks the server for the typed text rather than filtering the page on screen", async () => {
    const server = serverOf(300);
    const { result, rerender } = mount(server);
    await waitFor(() => expect(result.current.rows).toHaveLength(PAGE));
    rerender({ scope: "h1:u1", query: "1250", filters: EMPTY_ROOM_FILTERS });
    await waitFor(() => expect(result.current.rows.map((r) => r.room_number)).toEqual(["1250"]));
    expect(server).toHaveBeenLastCalledWith(EMPTY_ROOM_FILTERS, "1250", 1, expect.any(AbortSignal));
    expect(result.current.total).toBe(1);
  });

  it("drops a slow answer for an older search so it can't overwrite the newer one", async () => {
    const slow = defer<RoomBoardPage>();
    const server = serverOf(60);
    const { result, rerender } = mount(server);
    await waitFor(() => expect(result.current.rows).toHaveLength(PAGE));
    server.mockImplementationOnce(() => slow.promise);
    rerender({ scope: "h1:u1", query: "10", filters: EMPTY_ROOM_FILTERS });
    rerender({ scope: "h1:u1", query: "1005", filters: EMPTY_ROOM_FILTERS });
    await waitFor(() => expect(result.current.rows.map((r) => r.room_number)).toEqual(["1005"]));
    await act(async () => slow.resolve({ rows: [make(99)], total: 99, hasMore: false, counts: null, floors: [], buildings: [] }));
    expect(result.current.rows.map((r) => r.room_number)).toEqual(["1005"]);
  });
});

describe("failures are never shown as an empty hotel", () => {
  it("a failed first read is a failure with nothing loaded, not 'no rooms'", async () => {
    const server = jest.fn().mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    const { result } = mount(server as never);
    await waitFor(() => expect(result.current.failure).toBe("forbidden"));
    expect(result.current.loaded).toBe(false);
    expect(result.current.rows).toEqual([]);
  });

  it("a failed refresh keeps the rooms already shown and reports the failure", async () => {
    const server = serverOf(30);
    const { result } = mount(server);
    await waitFor(() => expect(result.current.rows).toHaveLength(PAGE));
    server.mockRejectedValueOnce(new Error("Network request failed"));
    await act(async () => void (await result.current.refresh()));
    expect(result.current.rows).toHaveLength(PAGE);
    expect(result.current.failure).toBe("offline");
    expect(result.current.syncedAt).not.toBeNull();
  });

  it("retry after a failed first read loads the rooms", async () => {
    const server = serverOf(5);
    server.mockRejectedValueOnce(new Error("boom"));
    const { result } = mount(server);
    await waitFor(() => expect(result.current.failure).toBe("failed"));
    await act(async () => result.current.retry());
    await waitFor(() => expect(result.current.rows).toHaveLength(5));
    expect(result.current.failure).toBeNull();
  });
});

describe("switching hotels or people", () => {
  it("never shows another hotel's rooms for the same search", async () => {
    const hotelA = serverOf(10, "a");
    const { result, rerender } = mount(hotelA, { scope: "hotelA:u1" });
    await waitFor(() => expect(result.current.rows).toHaveLength(10));
    expect(result.current.rows[0].id).toBe("a-1");

    const hotelB = serverOf(4, "b");
    const view = renderHook((props: Props) => useRoomBoard({ ...props, fetchPage: hotelB }), { initialProps: { scope: "hotelB:u1", query: "", filters: EMPTY_ROOM_FILTERS } as Props });
    expect(view.result.current.rows).toEqual([]);
    await waitFor(() => expect(view.result.current.rows.map((r) => r.id)).toEqual(["b-1", "b-2", "b-3", "b-4"]));
    rerender({ scope: null, query: "", filters: EMPTY_ROOM_FILTERS });
    expect(result.current.rows).toEqual([]);
  });

  it("drops the answer to a request that was out when the hotel changed", async () => {
    const slow = defer<RoomBoardPage>();
    const server = serverOf(5, "b");
    server.mockImplementationOnce(() => slow.promise);
    const { result, rerender } = mount(server, { scope: "hotelA:u1" });
    rerender({ scope: "hotelB:u1", query: "", filters: EMPTY_ROOM_FILTERS });
    await waitFor(() => expect(result.current.rows.map((r) => r.id)[0]).toBe("b-1"));
    await act(async () => slow.resolve({ rows: [make(1, "a")], total: 1, hasMore: false, counts: null, floors: [], buildings: [] }));
    expect(result.current.rows.map((r) => r.id)[0]).toBe("b-1");
  });
});

describe("returning to the list", () => {
  it("remembers the search and filters per hotel and person, and nobody else's", () => {
    rememberRoomView("h1:u1", { filters: { ...EMPTY_ROOM_FILTERS, maintenance: "oos" }, text: "31" });
    expect(recallRoomView("h1:u1")).toEqual({ filters: expect.objectContaining({ maintenance: "oos" }), text: "31" });
    expect(recallRoomView("h1:u2")).toBeNull();
    expect(recallRoomView(null)).toBeNull();
  });

  it("shows the last good rooms immediately when coming back, then refreshes", async () => {
    const server = serverOf(30);
    const first = mount(server);
    await waitFor(() => expect(first.result.current.rows).toHaveLength(PAGE));
    first.unmount();
    const again = mount(server);
    expect(again.result.current.rows).toHaveLength(PAGE);
    expect(again.result.current.loading).toBe(false);
  });

  it("a repair or availability change elsewhere marks the board stale exactly once", () => {
    markRoomBoardStale();
    expect(takeRoomBoardStale()).toBe(true);
    expect(takeRoomBoardStale()).toBe(false);
  });
});
