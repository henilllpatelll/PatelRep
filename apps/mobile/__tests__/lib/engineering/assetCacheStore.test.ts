import AsyncStorage from "@react-native-async-storage/async-storage";
import { setQueueOwner } from "@/lib/offline/queueOwner";
import { CACHE_MAX_AGE_MS, MAX_CACHED_ASSETS, clearAssetCache, findDurableAsset, forgetAsset, rememberAssets } from "@/lib/engineering/assetCacheStore";
import { resolveAssetCode } from "@/lib/engineering/assetLookup";

const NOW = Date.parse("2026-03-01T12:00:00Z");
const ID = "0b9b6e1c-7c1a-4d4e-9d3f-2a1b3c4d5e6f";

beforeEach(async () => {
  await AsyncStorage.clear();
  setQueueOwner("hotel-1:user-1");
});

describe("durable equipment lookup cache", () => {
  it("finds equipment by exact id or tag after a restart, with its last-confirmed time", async () => {
    await rememberAssets([{ id: ID, name: "Boiler 2", asset_tag: "BLR-2", location: "#112" }], NOW);
    const byTag = await findDurableAsset({ kind: "tag", value: "BLR-2" }, NOW + 1000);
    expect(byTag).toMatchObject({ id: ID, name: "Boiler 2", location: "#112", verifiedAt: new Date(NOW).toISOString(), is_active: true });
    expect(await findDurableAsset({ kind: "id", value: ID.toUpperCase() }, NOW + 1000)).toMatchObject({ id: ID });
  });

  it("never invents a match: an unknown or partial code is not on this phone", async () => {
    await rememberAssets([{ id: ID, name: "Boiler 2", asset_tag: "BLR-2" }], NOW);
    expect(await findDurableAsset({ kind: "tag", value: "BLR-9" }, NOW)).toBeNull();
    expect(await findDurableAsset({ kind: "tag", value: "BLR" }, NOW)).toBeNull();
    expect(await findDurableAsset({ kind: "id", value: "other" }, NOW)).toBeNull();
  });

  it("is private to the signed-in person and hotel", async () => {
    await rememberAssets([{ id: ID, name: "Boiler 2", asset_tag: "BLR-2" }], NOW);
    setQueueOwner("hotel-1:user-2");
    expect(await findDurableAsset({ kind: "tag", value: "BLR-2" }, NOW)).toBeNull();
    setQueueOwner("hotel-2:user-1");
    expect(await findDurableAsset({ kind: "tag", value: "BLR-2" }, NOW)).toBeNull();
    setQueueOwner(null);
    expect(await findDurableAsset({ kind: "tag", value: "BLR-2" }, NOW)).toBeNull();
    setQueueOwner("hotel-1:user-1");
    expect(await findDurableAsset({ kind: "tag", value: "BLR-2" }, NOW)).not.toBeNull();
  });

  it("a changed tag stops matching the old one", async () => {
    await rememberAssets([{ id: ID, name: "Boiler 2", asset_tag: "BLR-2" }], NOW);
    await rememberAssets([{ id: ID, name: "Boiler 2", asset_tag: "BLR-22" }], NOW + 60_000);
    expect(await findDurableAsset({ kind: "tag", value: "BLR-2" }, NOW + 60_000)).toBeNull();
    expect(await findDurableAsset({ kind: "tag", value: "BLR-22" }, NOW + 60_000)).toMatchObject({ id: ID });
  });

  it("forgets equipment the server says does not exist, and expires old copies", async () => {
    await rememberAssets([{ id: ID, name: "Boiler 2", asset_tag: "BLR-2" }], NOW);
    await forgetAsset({ kind: "tag", value: "BLR-2" }, NOW);
    expect(await findDurableAsset({ kind: "tag", value: "BLR-2" }, NOW)).toBeNull();
    await rememberAssets([{ id: ID, name: "Boiler 2", asset_tag: "BLR-2" }], NOW);
    expect(await findDurableAsset({ kind: "tag", value: "BLR-2" }, NOW + CACHE_MAX_AGE_MS + 1)).toBeNull();
  });

  it("stays bounded, keeping the most recently confirmed", async () => {
    const many = Array.from({ length: MAX_CACHED_ASSETS + 25 }, (_, i) => ({ id: `id-${i}`, name: `A${i}`, asset_tag: `T${i}` }));
    for (let i = 0; i < many.length; i += 50) await rememberAssets(many.slice(i, i + 50), NOW + i * 1000);
    const keys = await AsyncStorage.getAllKeys();
    const raw = JSON.parse((await AsyncStorage.getItem(keys.find((k) => k.includes("assets/known"))!))!);
    expect(Object.keys(raw.data).length).toBeLessThanOrEqual(MAX_CACHED_ASSETS);
    expect(await findDurableAsset({ kind: "tag", value: `T${many.length - 1}` }, NOW + 1_000_000)).not.toBeNull();
  });

  it("two quick updates do not overwrite each other", async () => {
    await Promise.all([rememberAssets([{ id: "a", name: "A", asset_tag: "TA" }], NOW), rememberAssets([{ id: "b", name: "B", asset_tag: "TB" }], NOW)]);
    expect(await findDurableAsset({ kind: "tag", value: "TA" }, NOW)).not.toBeNull();
    expect(await findDurableAsset({ kind: "tag", value: "TB" }, NOW)).not.toBeNull();
  });

  it("drops a corrupted record instead of half-trusting it", async () => {
    await rememberAssets([{ id: ID, name: "Boiler 2", asset_tag: "BLR-2" }], NOW);
    const key = (await AsyncStorage.getAllKeys()).find((k) => k.includes("assets/known"))!;
    await AsyncStorage.setItem(key, "{not json");
    expect(await findDurableAsset({ kind: "tag", value: "BLR-2" }, NOW)).toBeNull();
  });

  it("clearing removes the person's copy", async () => {
    await rememberAssets([{ id: ID, name: "Boiler 2", asset_tag: "BLR-2" }], NOW);
    await clearAssetCache();
    expect(await findDurableAsset({ kind: "tag", value: "BLR-2" }, NOW)).toBeNull();
  });
});

describe("offline scan through the lookup", () => {
  const saved = { id: ID, name: "Boiler 2", asset_tag: "BLR-2", is_active: true, verifiedAt: "2026-03-01T10:00:00.000Z", location: "#112" };

  it("serves a saved copy offline, labelled with when it was last confirmed", async () => {
    const out = await resolveAssetCode("BLR-2", { isOnline: false, findCached: async () => saved });
    expect(out).toMatchObject({ kind: "found", fromCache: true, verifiedAt: saved.verifiedAt, location: "#112" });
  });

  it("an unknown code offline is 'offline', never a guessed match", async () => {
    expect(await resolveAssetCode("NOPE-1", { isOnline: false, findCached: async () => null })).toEqual({ kind: "offline" });
  });

  it("equipment the server last called retired is not offered as working", async () => {
    const out = await resolveAssetCode("BLR-2", { isOnline: false, findCached: async () => ({ ...saved, is_active: false }) });
    expect(out.kind).toBe("retired");
  });

  it("remembers what the server confirms and forgets what it says is gone", async () => {
    const remember = jest.fn();
    const forget = jest.fn();
    await resolveAssetCode("BLR-2", { isOnline: true, lookup: jest.fn().mockResolvedValue({ id: ID, name: "Boiler 2", asset_tag: "BLR-2" }), remember, forget });
    expect(remember).toHaveBeenCalledWith({ id: ID, name: "Boiler 2", asset_tag: "BLR-2" });
    await resolveAssetCode("BLR-3", { isOnline: true, lookup: jest.fn().mockRejectedValue(Object.assign(new Error("nf"), { status: 404 })), remember, forget });
    expect(forget).toHaveBeenCalledWith({ kind: "tag", value: "BLR-3" });
  });
});
