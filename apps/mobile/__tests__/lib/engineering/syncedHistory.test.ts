import AsyncStorage from "@react-native-async-storage/async-storage";
import { setQueueOwner } from "@/lib/offline/queueOwner";
import { MAX_SYNCED, SYNCED_MAX_AGE_MS, loadRecentlySynced, mergeSynced, recordSynced, type SyncedEntry } from "@/lib/engineering/syncedHistory";
import { hasLiveQueuedAction } from "@/lib/engineering/queuedActions";

jest.mock("@/lib/offline/db", () => ({ getSyncQueueSummary: jest.fn().mockResolvedValue([]) }));

beforeEach(async () => {
  await AsyncStorage.clear();
  setQueueOwner("hotel-1:user-1");
});

const entry = (n: number, at = new Date(Date.now() - n * 1000).toISOString()): SyncedEntry => ({ woId: `wo-${n}`, kind: "claim", label: `L${n}`, at });

describe("recently synced", () => {
  it("is empty until the server confirmed something", async () => {
    expect(await loadRecentlySynced()).toEqual([]);
  });

  it("records a confirmed change, newest first, once per order and kind", async () => {
    await recordSynced({ woId: "wo-1", kind: "claim", label: "A" });
    await recordSynced({ woId: "wo-1", kind: "complete", label: "A" });
    await recordSynced({ woId: "wo-1", kind: "claim", label: "A2" });
    const list = await loadRecentlySynced();
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ woId: "wo-1", kind: "claim", label: "A2" });
  });

  it("stays bounded and drops old entries", () => {
    let list: SyncedEntry[] = [];
    for (let i = 0; i < MAX_SYNCED + 5; i += 1) list = mergeSynced(list, entry(i));
    expect(list).toHaveLength(MAX_SYNCED);
    const stale = entry(99, new Date(Date.now() - SYNCED_MAX_AGE_MS - 1000).toISOString());
    expect(mergeSynced([stale], entry(1))).toHaveLength(1);
  });

  it("is private to the signed-in person", async () => {
    await recordSynced({ woId: "wo-1", kind: "claim", label: null });
    setQueueOwner("hotel-1:user-2");
    expect(await loadRecentlySynced()).toEqual([]);
  });
});

describe("duplicate guard for queued actions", () => {
  const row = (over: Record<string, unknown>) =>
    ({ id: 1, entity_type: "work_order", action: "claim", entity_id: "wo-1", room_id: null, attempts: 0, ...over }) as never;

  it("sees a waiting claim or completion for the same order only", () => {
    const rows = [row({}), row({ id: 2, action: "complete", entity_id: "wo-2" })];
    expect(hasLiveQueuedAction(rows, "wo-1", "claim")).toBe(true);
    expect(hasLiveQueuedAction(rows, "wo-1", "complete")).toBe(false);
    expect(hasLiveQueuedAction(rows, "wo-2", "complete")).toBe(true);
    expect(hasLiveQueuedAction(rows, "wo-3", "claim")).toBe(false);
  });

  it("ignores a change the server already refused, so it can be redone on purpose", () => {
    expect(hasLiveQueuedAction([row({ last_error: "conflict" })], "wo-1", "claim")).toBe(false);
  });
});
