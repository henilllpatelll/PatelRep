import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SOPDocument } from "@/lib/api/sop";
import { resetAssistantSession } from "@/lib/ai/session";
import { clearSopCache, readSopCache, SOP_CACHE_MAX_AGE_MS, writeSopCache } from "@/lib/sop/offlineCache";

const KEY = "@patelrep/sop_library_cache.v1";
const A = "hotel-a:user-1";
const B = "hotel-b:user-2";

const DOC = {
  id: "d0000000-0000-4000-8000-000000000001",
  title: "Do Not Disturb Policy",
  description: "Room access rules",
  category: "Housekeeping",
  page_count: 3,
  indexing_status: "indexed",
  created_at: "2026-10-01T00:00:00Z",
  ai_ready: true,
  approval: { state: "approved", version: 2, effective_date: null, review_date: null, approved_at: null },
  // Things that must never be written to the phone:
  storage_path: "sop-documents/hotel-a/secret.pdf",
  content: "full document text",
  embedding: [0.1, 0.2],
} as unknown as SOPDocument;

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("saved procedure list", () => {
  it("round-trips for the same person", async () => {
    await writeSopCache(A, [DOC], 1_000);
    const snapshot = await readSopCache(A, 2_000);
    expect(snapshot?.docs).toHaveLength(1);
    expect(snapshot?.docs[0]).toMatchObject({ id: DOC.id, title: "Do Not Disturb Policy", approval: { version: 2 } });
    expect(snapshot?.savedAt).toBe(1_000);
  });

  it("writes only list fields: no file paths, text or embeddings", async () => {
    await writeSopCache(A, [DOC], 1_000);
    const raw = (await AsyncStorage.getItem(KEY)) ?? "";
    expect(raw).not.toContain("secret.pdf");
    expect(raw).not.toContain("full document text");
    expect(raw).not.toContain("embedding");
  });

  it("is empty for another person or hotel", async () => {
    await writeSopCache(A, [DOC], 1_000);
    expect(await readSopCache(B, 2_000)).toBeNull();
    expect(await readSopCache(null, 2_000)).toBeNull();
    await writeSopCache(null, [DOC], 1_000);
    expect(await readSopCache(null)).toBeNull();
  });

  it("expires after a week so a retired procedure is not shown as current for long", async () => {
    await writeSopCache(A, [DOC], 1_000);
    expect(await readSopCache(A, 1_000 + SOP_CACHE_MAX_AGE_MS)).not.toBeNull();
    expect(await readSopCache(A, 1_000 + SOP_CACHE_MAX_AGE_MS + 1)).toBeNull();
  });

  it("treats damaged or future-dated storage as empty", async () => {
    await AsyncStorage.setItem(KEY, "{not json");
    expect(await readSopCache(A)).toBeNull();
    await AsyncStorage.setItem(KEY, JSON.stringify({ scope: A, savedAt: 9_999_999_999_999, docs: [DOC] }));
    expect(await readSopCache(A, 1_000)).toBeNull();
    await AsyncStorage.setItem(KEY, JSON.stringify({ scope: A, savedAt: 1, docs: "nope" }));
    expect(await readSopCache(A, 2)).toBeNull();
  });

  it("is removed when the signed-in person or hotel changes", async () => {
    await writeSopCache(A, [DOC], Date.now());
    resetAssistantSession();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
  });

  it("can be cleared directly", async () => {
    await writeSopCache(A, [DOC], Date.now());
    await clearSopCache();
    expect(await readSopCache(A)).toBeNull();
  });
});
