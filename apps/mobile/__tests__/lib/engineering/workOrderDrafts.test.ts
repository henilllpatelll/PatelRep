import AsyncStorage from "@react-native-async-storage/async-storage";
import { setQueueOwner } from "@/lib/offline/queueOwner";
import { emptyCompletionDraft, type CompletionDraft } from "@/lib/engineering/repairWorkspace";
import {
  MAX_DRAFTS,
  MAX_DRAFT_TEXT,
  clearCompletionDraft,
  clearTextDraft,
  isMeaningfulCompletionDraft,
  listCompletionDrafts,
  loadCompletionDraft,
  loadTextDraft,
  reviewRestoredDraft,
  sanitizeCompletionDraft,
  saveCompletionDraft,
  saveTextDraft,
} from "@/lib/engineering/workOrderDrafts";

const filled = (over: Partial<CompletionDraft> = {}): CompletionDraft => ({
  ...emptyCompletionDraft(),
  resolutionCodeId: "res-1",
  notes: "Replaced the capacitor",
  verification: "passed",
  parts: [{ partId: "p1", name: "Capacitor", unit: null, locationId: "l1", locationName: null, quantity: 2, available: 5 }],
  ...over,
});

beforeEach(async () => {
  await AsyncStorage.clear();
  setQueueOwner("hotel-1:user-1");
});

describe("completion drafts", () => {
  it("saves, restores after a restart, and says what status it was saved against", async () => {
    await saveCompletionDraft("wo-1", filled(), "in_progress", "WO-1 · AC");
    const restored = await loadCompletionDraft("wo-1");
    expect(restored?.draft).toEqual(filled());
    expect(restored?.statusAtSave).toBe("in_progress");
    expect(restored?.label).toBe("WO-1 · AC");
  });

  it("keeps drafts apart per order, per person and per hotel", async () => {
    await saveCompletionDraft("wo-1", filled(), "in_progress");
    expect(await loadCompletionDraft("wo-2")).toBeNull();
    setQueueOwner("hotel-1:user-2");
    expect(await loadCompletionDraft("wo-1")).toBeNull();
    expect(await listCompletionDrafts()).toEqual([]);
    setQueueOwner("hotel-2:user-1");
    expect(await loadCompletionDraft("wo-1")).toBeNull();
    setQueueOwner("hotel-1:user-1");
    expect(await loadCompletionDraft("wo-1")).not.toBeNull();
  });

  it("discard removes it", async () => {
    await saveCompletionDraft("wo-1", filled(), "in_progress");
    await clearCompletionDraft("wo-1");
    expect(await loadCompletionDraft("wo-1")).toBeNull();
  });

  it("rebuilds a damaged draft field by field instead of trusting it", () => {
    const d = sanitizeCompletionDraft({
      resolutionCodeId: 5,
      notes: "x".repeat(MAX_DRAFT_TEXT + 50),
      verification: "maybe",
      parts: [{ partId: 1 }, { partId: "p", name: "n", locationId: "l", quantity: 1 }],
      assetRestoration: "restore",
    });
    expect(d?.resolutionCodeId).toBeNull();
    expect(d?.notes).toHaveLength(MAX_DRAFT_TEXT);
    expect(d?.verification).toBeNull();
    expect(d?.parts).toHaveLength(1);
    expect(d?.assetRestoration).toBe("restore");
    expect(sanitizeCompletionDraft("nope")).toBeNull();
    expect(sanitizeCompletionDraft([1])).toBeNull();
  });

  it("only counts what the person changed against the order own coding", () => {
    const wo = { problem_code: { id: "pc", code: "x", label: "X" } };
    expect(isMeaningfulCompletionDraft(emptyCompletionDraft(wo), wo)).toBe(false);
    expect(isMeaningfulCompletionDraft({ ...emptyCompletionDraft(wo), notes: "a" }, wo)).toBe(true);
  });

  it("flags a status change, and a finished order, on restore", () => {
    expect(reviewRestoredDraft("in_progress", "in_progress")).toBe("none");
    expect(reviewRestoredDraft("in_progress", "on_hold")).toBe("statusChanged");
    expect(reviewRestoredDraft("in_progress", "completed")).toBe("closed");
    expect(reviewRestoredDraft(null, "open")).toBe("none");
  });

  it("drops a draft older than two weeks, and lists the rest", async () => {
    await saveCompletionDraft("wo-1", filled(), "open", "A");
    await saveCompletionDraft("wo-2", filled(), "open", "B");
    expect((await listCompletionDrafts()).map((r) => r.woId).sort()).toEqual(["wo-1", "wo-2"]);
    const key = (await AsyncStorage.getAllKeys()).find((k) => k.endsWith("draft/completion/wo-1")) as string;
    const env = JSON.parse((await AsyncStorage.getItem(key)) as string);
    await AsyncStorage.setItem(key, JSON.stringify({ ...env, savedAt: new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString() }));
    expect(await loadCompletionDraft("wo-1")).toBeNull();
  });

  it("never keeps more than the bounded number of drafts", async () => {
    for (let i = 0; i < MAX_DRAFTS + 5; i += 1) await saveCompletionDraft(`wo-${i}`, filled(), "open");
    expect((await listCompletionDrafts()).length).toBeLessThanOrEqual(MAX_DRAFTS);
  });
});

describe("text drafts (note, hold, escalate)", () => {
  it("saves per kind and order, restores, and clears", async () => {
    await saveTextDraft("wo-1", "note", "Checked the valve");
    await saveTextDraft("wo-1", "escalate", "Needs vendor");
    expect(await loadTextDraft("wo-1", "note")).toBe("Checked the valve");
    expect(await loadTextDraft("wo-1", "escalate")).toBe("Needs vendor");
    expect(await loadTextDraft("wo-1", "hold")).toBeNull();
    expect(await loadTextDraft("wo-2", "note")).toBeNull();
    await clearTextDraft("wo-1", "note");
    expect(await loadTextDraft("wo-1", "note")).toBeNull();
  });

  it("treats empty text as no draft", async () => {
    await saveTextDraft("wo-1", "note", "x");
    await saveTextDraft("wo-1", "note", "   ");
    expect(await loadTextDraft("wo-1", "note")).toBeNull();
  });

  it("is private to the signed-in person", async () => {
    await saveTextDraft("wo-1", "note", "mine");
    setQueueOwner("hotel-1:user-2");
    expect(await loadTextDraft("wo-1", "note")).toBeNull();
  });
});
