import AsyncStorage from "@react-native-async-storage/async-storage";
import { setQueueOwner } from "@/lib/offline/queueOwner";
import { clearOwnerFamily, listScoped, pruneScoped, readScoped, removeScoped, writeScoped } from "@/lib/engineering/offlineStore";

const parseAny = (raw: unknown) => (raw == null ? null : raw);

beforeEach(async () => {
  await AsyncStorage.clear();
  setQueueOwner("hotel-1:user-1");
});

describe("engineering offline store", () => {
  it("round-trips a record and survives a restart (a fresh read)", async () => {
    expect(await writeScoped("a/1", { x: 1 })).toBe(true);
    const stored = await readScoped("a/1", parseAny);
    expect(stored?.data).toEqual({ x: 1 });
    expect(typeof stored?.savedAt).toBe("string");
  });

  it("never reads another person or another hotel record", async () => {
    await writeScoped("a/1", "mine");
    setQueueOwner("hotel-1:user-2");
    expect(await readScoped("a/1", parseAny)).toBeNull();
    setQueueOwner("hotel-2:user-1");
    expect(await readScoped("a/1", parseAny)).toBeNull();
    setQueueOwner("hotel-1:user-1");
    expect((await readScoped("a/1", parseAny))?.data).toBe("mine");
  });

  it("refuses an envelope that claims a different owner, even under this owner key", async () => {
    await writeScoped("a/1", "mine");
    const key = (await AsyncStorage.getAllKeys())[0];
    const env = JSON.parse((await AsyncStorage.getItem(key)) as string);
    await AsyncStorage.setItem(key, JSON.stringify({ ...env, owner: "hotel-9:user-9" }));
    expect(await readScoped("a/1", parseAny)).toBeNull();
    expect(await AsyncStorage.getItem(key)).toBeNull();
  });

  it("drops malformed JSON, another schema version and failed validation without throwing", async () => {
    await writeScoped("a/1", "x");
    const key = (await AsyncStorage.getAllKeys())[0];
    await AsyncStorage.setItem(key, "{not json");
    expect(await readScoped("a/1", parseAny)).toBeNull();
    expect(await AsyncStorage.getItem(key)).toBeNull();

    await writeScoped("a/1", "x");
    const env = JSON.parse((await AsyncStorage.getItem(key)) as string);
    await AsyncStorage.setItem(key, JSON.stringify({ ...env, v: 99 }));
    expect(await readScoped("a/1", parseAny)).toBeNull();

    await writeScoped("a/1", 5);
    expect(await readScoped("a/1", (raw) => (typeof raw === "string" ? raw : null))).toBeNull();
  });

  it("expires old records", async () => {
    const day = 24 * 60 * 60 * 1000;
    await writeScoped("a/1", "old", Date.now() - 3 * day);
    expect(await readScoped("a/1", parseAny, { maxAgeMs: 2 * day })).toBeNull();
    await writeScoped("a/2", "fresh", Date.now() - day);
    expect((await readScoped("a/2", parseAny, { maxAgeMs: 2 * day }))?.data).toBe("fresh");
  });

  it("keeps a family bounded by dropping the oldest records", async () => {
    for (let i = 0; i < 5; i += 1) await writeScoped(`f/${i}`, i, 1_700_000_000_000 + i * 1000);
    await pruneScoped("f/", 3);
    expect((await listScoped("f/")).sort()).toEqual(["f/2", "f/3", "f/4"]);
  });

  it("removes one record, a whole family for an owner, and does nothing without an owner", async () => {
    await writeScoped("cache/a", 1);
    await writeScoped("draft/b", 2);
    await removeScoped("draft/b");
    expect(await listScoped("")).toEqual(["cache/a"]);
    await clearOwnerFamily("hotel-1:user-1", "cache/");
    expect(await listScoped("")).toEqual([]);
    setQueueOwner(null);
    expect(await writeScoped("x", 1)).toBe(false);
    expect(await readScoped("x", parseAny)).toBeNull();
  });
});
