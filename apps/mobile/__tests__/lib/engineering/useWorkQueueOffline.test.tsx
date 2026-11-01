import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { setQueueOwner } from "@/lib/offline/queueOwner";
import { useWorkQueue } from "@/lib/engineering/useWorkQueue";
import { initialQueueState, queueReducer } from "@/lib/engineering/workQueueState";
import { EMPTY_FILTERS, buildListParams, queueKey, type WorkOrderListParams } from "@/lib/engineering/workQueue";
import { loadQueueSnapshot, saveQueueSnapshot } from "@/lib/engineering/workOrderCache";
import type { WorkOrder } from "@/lib/engineering/workOrders";

const make = (n: number): WorkOrder => ({ id: `wo-${n}`, title: `Job ${n}`, status: "open", priority: "normal", assigned_to: null, created_at: "2026-10-15T10:00:00Z" });
const viewer = { userId: "eng-me", role: "engineer" };
const available = buildListParams("available", EMPTY_FILTERS, "", { role: "engineer" });
const key = queueKey("available", available);

type FetchPage = NonNullable<Parameters<typeof useWorkQueue>[0]["fetchPage"]>;
const mount = (fetchPage: FetchPage, params: WorkOrderListParams = available) =>
  renderHook((p: Parameters<typeof useWorkQueue>[0]) => useWorkQueue(p), {
    initialProps: { scope: "h1:u1", view: "available" as const, params, viewer, enabled: true, fetchPage },
  });

const networkDown = () => Object.assign(new Error("Network request failed"));
const serverDown = () => Object.assign(new Error("HTTP 500"), { status: 500 });

beforeEach(async () => {
  await AsyncStorage.clear();
  setQueueOwner("h1:u1");
});

describe("saved queue (offline)", () => {
  it("saves the first page after a live read so Work can open later without a connection", async () => {
    const fetchPage = jest.fn(async () => ({ orders: [make(1), make(2)], hasMore: false }));
    const { result } = mount(fetchPage);
    await waitFor(() => expect(result.current.bucket.loaded).toBe(true));
    await waitFor(async () => expect((await loadQueueSnapshot(key))?.orders).toHaveLength(2));
    expect(result.current.bucket.cached).toBe(false);
  });

  it("opens the saved copy, labelled as saved, when there is no connection and nothing on screen", async () => {
    await saveQueueSnapshot(key, [make(1), make(2), make(3)]);
    const fetchPage = jest.fn(async (): Promise<never> => { throw networkDown(); });
    const { result } = mount(fetchPage);
    await waitFor(() => expect(result.current.bucket.items).toHaveLength(3));
    expect(result.current.bucket.cached).toBe(true);
    expect(result.current.bucket.failure).toBeNull();
    // A saved first page can never page further or claim to be complete.
    expect(result.current.bucket.hasMore).toBe(false);
    expect(result.current.bucket.fetchedAt).not.toBeNull();
  });

  it("does not hide a server error or a refusal behind old rows", async () => {
    await saveQueueSnapshot(key, [make(1)]);
    const { result } = mount(jest.fn(async (): Promise<never> => { throw serverDown(); }));
    await waitFor(() => expect(result.current.bucket.failure).toBe("failed"));
    expect(result.current.bucket.items).toHaveLength(0);
    expect(result.current.bucket.cached).toBe(false);
  });

  it("shows no saved copy for a typed search, and none to another person", async () => {
    const searching = { ...available, q: "boiler" };
    await saveQueueSnapshot(queueKey("available", searching), [make(1)]);
    const a = mount(jest.fn(async (): Promise<never> => { throw networkDown(); }), searching);
    await waitFor(() => expect(a.result.current.bucket.failure).toBe("offline"));
    expect(a.result.current.bucket.items).toHaveLength(0);

    await saveQueueSnapshot(key, [make(1)]);
    setQueueOwner("h1:someone-else");
    const b = mount(jest.fn(async (): Promise<never> => { throw networkDown(); }));
    await waitFor(() => expect(b.result.current.bucket.failure).toBe("offline"));
    expect(b.result.current.bucket.items).toHaveLength(0);
  });

  it("a live refresh replaces the saved copy and clears the label", async () => {
    await saveQueueSnapshot(key, [make(1)]);
    let up = false;
    const fetchPage = jest.fn(async () => {
      if (!up) throw networkDown();
      return { orders: [make(7)], hasMore: false };
    });
    const { result } = mount(fetchPage);
    await waitFor(() => expect(result.current.bucket.cached).toBe(true));
    up = true;
    await act(async () => result.current.refresh());
    expect(result.current.bucket.cached).toBe(false);
    expect(result.current.bucket.items.map((o) => o.id)).toEqual(["wo-7"]);
  });
});

describe("hydrate reducer", () => {
  it("never replaces rows a live read already loaded", () => {
    let state = initialQueueState("s");
    state = queueReducer(state, { type: "success", key: "k", mode: "initial", orders: [make(1)], pages: 1, hasMore: true, now: 1 });
    state = queueReducer(state, { type: "hydrate", key: "k", orders: [make(9)], fetchedAt: 0, now: 2 });
    expect(state.buckets.k.items.map((o) => o.id)).toEqual(["wo-1"]);
    expect(state.buckets.k.cached).toBe(false);
  });
});
