const mockStore = new Map<string, string>();

jest.mock("@/lib/auth/secureSessionStorage", () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockStore.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      mockStore.set(key, value);
    },
    removeItem: async (key: string) => {
      mockStore.delete(key);
    },
  },
}));

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  HISTORY_LIMITS,
  LEGACY_HISTORY_KEY,
  clearHistory,
  historyKey,
  loadHistory,
  redact,
  resetLegacyPurgeFlag,
  saveHistory,
  toStoredMessages,
  type PersistableMessage,
} from "@/lib/ai/history";

const NOW = 1_800_000_000_000;
const msg = (id: string, role: "user" | "assistant", content: string, at = NOW - 1000, extra: Partial<PersistableMessage> = {}): PersistableMessage => ({
  id,
  role,
  content,
  at,
  ...extra,
});

const ALICE = "hotel-a:alice";
const BOB = "hotel-a:bob";
const ALICE_OTHER_HOTEL = "hotel-b:alice";

beforeEach(async () => {
  mockStore.clear();
  await AsyncStorage.clear();
  resetLegacyPurgeFlag();
});

describe("history isolation", () => {
  it("never shows one account's history to another on the same device", async () => {
    await saveHistory(ALICE, [msg("1", "user", "Room 214 needs towels")], NOW);
    expect(await loadHistory(BOB, NOW)).toEqual([]);
    expect((await loadHistory(ALICE, NOW)).map((m) => m.content)).toEqual(["Room 214 needs towels"]);
  });

  it("keeps the same person's histories apart per hotel", async () => {
    await saveHistory(ALICE, [msg("1", "user", "hotel a")], NOW);
    await saveHistory(ALICE_OTHER_HOTEL, [msg("2", "user", "hotel b")], NOW);
    expect((await loadHistory(ALICE, NOW))[0].content).toBe("hotel a");
    expect((await loadHistory(ALICE_OTHER_HOTEL, NOW))[0].content).toBe("hotel b");
  });

  it("uses a store key that is safe for the secure store and names the scope", () => {
    expect(historyKey("5c1e:9f2a")).toBe("patelrep.ai.history.v2.5c1e_9f2a");
    expect(historyKey("a/b c")).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it("clearHistory removes only that person's saved conversation", async () => {
    await saveHistory(ALICE, [msg("1", "user", "a")], NOW);
    await saveHistory(BOB, [msg("2", "user", "b")], NOW);
    await clearHistory(ALICE);
    expect(await loadHistory(ALICE, NOW)).toEqual([]);
    expect(await loadHistory(BOB, NOW)).toHaveLength(1);
  });

  it("saving an empty conversation removes the saved copy", async () => {
    await saveHistory(ALICE, [msg("1", "user", "a")], NOW);
    await saveHistory(ALICE, [], NOW);
    expect(mockStore.size).toBe(0);
  });
});

describe("legacy unscoped history", () => {
  it("is deleted, never read and never shown to whoever signs in next", async () => {
    await AsyncStorage.setItem(LEGACY_HISTORY_KEY, JSON.stringify([{ id: "x", role: "user", content: "Previous person's chat" }]));
    expect(await loadHistory(ALICE, NOW)).toEqual([]);
    expect(await AsyncStorage.getItem(LEGACY_HISTORY_KEY)).toBeNull();
    expect(await loadHistory(BOB, NOW)).toEqual([]);
  });

  it("is deleted even if the first thing that happens is a save", async () => {
    await AsyncStorage.setItem(LEGACY_HISTORY_KEY, "[]");
    await loadHistory(ALICE, NOW);
    expect(await AsyncStorage.getItem(LEGACY_HISTORY_KEY)).toBeNull();
  });
});

describe("retention and minimisation", () => {
  it("keeps only the most recent messages", () => {
    const many = Array.from({ length: 50 }, (_, i) => msg(String(i), i % 2 ? "assistant" : "user", `m${i}`));
    const stored = toStoredMessages(many, NOW);
    expect(stored).toHaveLength(HISTORY_LIMITS.messages);
    expect(stored[stored.length - 1].content).toBe("m49");
  });

  it("drops messages older than the retention window, on save and on load", async () => {
    const old = msg("old", "user", "yesterday", NOW - HISTORY_LIMITS.ttlMs - 1);
    const fresh = msg("new", "user", "today");
    expect(toStoredMessages([old, fresh], NOW).map((m) => m.id)).toEqual(["new"]);

    mockStore.set(historyKey(ALICE), JSON.stringify([{ ...old }, { ...fresh }]));
    expect((await loadHistory(ALICE, NOW)).map((m) => m.id)).toEqual(["new"]);
  });

  it("truncates long messages", () => {
    const [stored] = toStoredMessages([msg("1", "assistant", "x".repeat(5000))], NOW);
    expect(stored.content).toHaveLength(HISTORY_LIMITS.contentChars);
  });

  it("does not keep notices, or anything that led to a proposed guest request", () => {
    const stored = toStoredMessages(
      [
        msg("1", "user", "How do I strip a bed?"),
        msg("2", "assistant", "Strip the bed first."),
        msg("3", "user", "Mr. Lee in 412 wants a crib"),
        msg("4", "assistant", "I'll log that.", NOW - 500, { proposedGuestRequest: true }),
        msg("5", "assistant", "", NOW - 400, { notice: true }),
      ],
      NOW,
    );
    expect(stored.map((m) => m.id)).toEqual(["1", "2"]);
  });

  it("redacts email addresses and phone numbers but not lists of room numbers", () => {
    expect(redact("mail me at jo@example.com or call 214-555-0188")).toBe("mail me at [email] or call [number]");
    expect(redact("rooms 412 413 414 415")).toBe("rooms 412 413 414 415");
  });

  it("stores only id, role, content and time — nothing else", async () => {
    await saveHistory(ALICE, [msg("1", "assistant", "hi", NOW - 10, { proposedGuestRequest: false })], NOW);
    expect(JSON.parse(mockStore.get(historyKey(ALICE))!)).toEqual([{ id: "1", role: "assistant", content: "hi", at: NOW - 10 }]);
  });

  it("ignores corrupt or hand-edited storage", async () => {
    mockStore.set(historyKey(ALICE), "{not json");
    expect(await loadHistory(ALICE, NOW)).toEqual([]);
    mockStore.set(historyKey(ALICE), JSON.stringify([{ id: 1 }, null, "x", { id: "a", role: "system", content: "x", at: NOW }]));
    expect(await loadHistory(ALICE, NOW)).toEqual([]);
  });
});
