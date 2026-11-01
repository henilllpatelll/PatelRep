import AsyncStorage from "@react-native-async-storage/async-storage";
import { setQueueOwner } from "@/lib/offline/queueOwner";
import { newDraft, adaptPmTemplates } from "@/lib/engineering/pmChecklist";
import { clearPmDraft, listPmDraftIds, listPmDraftSummaries, loadPmDraft, savePmDraft } from "@/lib/engineering/pmDraftStore";

const template = adaptPmTemplates([{ id: "t1", name: "Boiler", version: 1, items: { checklist: [{ label: "Leaks" }] } }])[0];

beforeEach(async () => {
  await AsyncStorage.clear();
  setQueueOwner("hotel-1:user-1");
});

describe("local PM drafts", () => {
  it("restores exactly what was saved, after a 'restart' (a fresh read)", async () => {
    const draft = newDraft("s1", template);
    draft.items.i0 = { result: "failed", note: "drip", evidence: [{ id: "ev-1" }] };
    await savePmDraft(draft);
    expect(await loadPmDraft("s1")).toEqual(draft);
  });

  it("keeps drafts private to the signed-in person and property", async () => {
    await savePmDraft(newDraft("s1", template));
    setQueueOwner("hotel-1:user-2");
    expect(await loadPmDraft("s1")).toBeNull();
    expect(await listPmDraftIds()).toEqual([]);
    setQueueOwner("hotel-2:user-1");
    expect(await loadPmDraft("s1")).toBeNull();
    setQueueOwner("hotel-1:user-1");
    expect(await loadPmDraft("s1")).not.toBeNull();
  });

  it("does nothing without a signed-in owner", async () => {
    setQueueOwner(null);
    await savePmDraft(newDraft("s1", template));
    expect(await loadPmDraft("s1")).toBeNull();
    setQueueOwner("hotel-1:user-1");
    expect(await listPmDraftIds()).toEqual([]);
  });

  it("lists which schedules have a draft, and discarding removes it", async () => {
    await savePmDraft(newDraft("s1", template));
    await savePmDraft(newDraft("s2", template));
    expect((await listPmDraftIds()).sort()).toEqual(["s1", "s2"]);
    await clearPmDraft("s1");
    expect(await listPmDraftIds()).toEqual(["s2"]);
    expect(await loadPmDraft("s1")).toBeNull();
  });

  it("ignores a corrupt or foreign record instead of half-restoring it", async () => {
    await AsyncStorage.setItem("engineering.pmDraft.v1:hotel-1:user-1:s1", "{not json");
    expect(await loadPmDraft("s1")).toBeNull();
    await AsyncStorage.setItem("engineering.pmDraft.v1:hotel-1:user-1:s1", JSON.stringify({ ...newDraft("other", template) }));
    expect(await loadPmDraft("s1")).toBeNull();
    await AsyncStorage.setItem("engineering.pmDraft.v1:hotel-1:user-1:s1", JSON.stringify({ v: 2 }));
    expect(await loadPmDraft("s1")).toBeNull();
  });
});

describe("draft summaries (Continue Inspection)", () => {
  it("reports how far each real draft got and who owns it", async () => {
    const draft = newDraft("s1", template);
    draft.items.i0 = { result: "passed", note: "", evidence: [] };
    await savePmDraft(draft);
    const summaries = await listPmDraftSummaries();
    expect(summaries).toEqual([{ scheduleId: "s1", answered: 1, total: 1, updatedAt: draft.updatedAt }]);
    setQueueOwner("hotel-1:user-2");
    expect(await listPmDraftSummaries()).toEqual([]);
  });

  it("does not count unanswered items as progress and skips malformed records", async () => {
    await savePmDraft(newDraft("s2", template));
    await AsyncStorage.setItem("engineering.pmDraft.v1:hotel-1:user-1:broken", "{not json");
    const summaries = await listPmDraftSummaries();
    expect(summaries.map((s) => [s.scheduleId, s.answered])).toEqual([["s2", 0]]);
  });

  it("is empty without a signed-in owner", async () => {
    await savePmDraft(newDraft("s1", template));
    setQueueOwner(null);
    expect(await listPmDraftSummaries()).toEqual([]);
  });
});
