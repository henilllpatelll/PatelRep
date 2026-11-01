import AsyncStorage from "@react-native-async-storage/async-storage";
import { setQueueOwner } from "@/lib/offline/queueOwner";
import type { WorkOrder } from "@/lib/engineering/workOrders";
import {
  CACHE_MAX_AGE_MS,
  MAX_DETAILS,
  MAX_SNAPSHOTS,
  MAX_SNAPSHOT_ORDERS,
  clearEngineeringCache,
  loadQueueSnapshot,
  loadWorkOrderCopy,
  saveQueueSnapshot,
  saveWorkOrderCopy,
  slimWorkOrder,
} from "@/lib/engineering/workOrderCache";

const wo = (n: number, over: Partial<WorkOrder> = {}): WorkOrder => ({ id: `wo-${n}`, title: `Job ${n}`, status: "open", priority: "normal", ...over });

beforeEach(async () => {
  await AsyncStorage.clear();
  setQueueOwner("hotel-1:user-1");
});

describe("saved work orders", () => {
  it("keeps the operational row but not comments, photos or free notes", async () => {
    const full = wo(1, {
      notes: "guest in 204 asked",
      work_order_comments: [{ id: "c", comment: "hi" }],
      work_order_photos: [{ id: "p", storage_path: "x" }],
    });
    expect(slimWorkOrder(full)).toEqual({ id: "wo-1", title: "Job 1", status: "open", priority: "normal" });
    await saveWorkOrderCopy(full);
    const copy = await loadWorkOrderCopy("wo-1");
    expect(copy?.order).toEqual(slimWorkOrder(full));
    expect(copy?.order.work_order_comments).toBeUndefined();
  });

  it("expires after 72 hours and is private to person and hotel", async () => {
    await saveWorkOrderCopy(wo(1), Date.now() - CACHE_MAX_AGE_MS - 1000);
    expect(await loadWorkOrderCopy("wo-1")).toBeNull();
    await saveWorkOrderCopy(wo(2));
    setQueueOwner("hotel-1:user-2");
    expect(await loadWorkOrderCopy("wo-2")).toBeNull();
    setQueueOwner("hotel-2:user-1");
    expect(await loadWorkOrderCopy("wo-2")).toBeNull();
  });

  it("never returns a record stored under another order id", async () => {
    await saveWorkOrderCopy(wo(1));
    const key = (await AsyncStorage.getAllKeys()).find((k) => k.endsWith("cache/wo/wo-1")) as string;
    await AsyncStorage.setItem(key.replace("wo-1", "wo-9"), (await AsyncStorage.getItem(key)) as string);
    expect(await loadWorkOrderCopy("wo-9")).toBeNull();
  });

  it("keeps only the most recent copies", async () => {
    const t = Date.now();
    for (let i = 0; i < MAX_DETAILS + 4; i += 1) await saveWorkOrderCopy(wo(i), t + i * 1000);
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.includes("cache/wo/"));
    expect(keys.length).toBeLessThanOrEqual(MAX_DETAILS);
  });
});

describe("saved queue views", () => {
  it("saves and reloads a view, capped in size", async () => {
    await saveQueueSnapshot("mine?", Array.from({ length: MAX_SNAPSHOT_ORDERS + 20 }, (_, i) => wo(i)));
    const snap = await loadQueueSnapshot("mine?");
    expect(snap?.orders).toHaveLength(MAX_SNAPSHOT_ORDERS);
    expect(await loadQueueSnapshot("other?")).toBeNull();
  });

  it("keeps a bounded number of views, dropping the oldest", async () => {
    const t = Date.now();
    for (let i = 0; i < MAX_SNAPSHOTS + 3; i += 1) await saveQueueSnapshot(`view-${i}`, [wo(i)], t + i * 1000);
    expect(await loadQueueSnapshot("view-0", t + 20_000)).toBeNull();
    expect(await loadQueueSnapshot(`view-${MAX_SNAPSHOTS + 2}`, t + 20_000)).not.toBeNull();
  });

  it("does not let two views finishing together overwrite each other", async () => {
    await Promise.all([saveQueueSnapshot("a", [wo(1)]), saveQueueSnapshot("b", [wo(2)])]);
    expect(await loadQueueSnapshot("a")).not.toBeNull();
    expect(await loadQueueSnapshot("b")).not.toBeNull();
  });

  it("drops an expired view and survives a corrupt record", async () => {
    await saveQueueSnapshot("old", [wo(1)], Date.now() - CACHE_MAX_AGE_MS - 1000);
    expect(await loadQueueSnapshot("old")).toBeNull();
    const key = (await AsyncStorage.getAllKeys()).find((k) => k.endsWith("cache/queue")) as string;
    await AsyncStorage.setItem(key, "garbage");
    expect(await loadQueueSnapshot("old")).toBeNull();
  });

  it("is private to person and hotel, and can be cleared for one owner", async () => {
    await saveQueueSnapshot("v", [wo(1)]);
    setQueueOwner("hotel-1:user-2");
    expect(await loadQueueSnapshot("v")).toBeNull();
    setQueueOwner("hotel-1:user-1");
    await clearEngineeringCache("hotel-1:user-1");
    expect(await loadQueueSnapshot("v")).toBeNull();
  });
});
