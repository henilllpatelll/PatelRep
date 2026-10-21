import AsyncStorage from "@react-native-async-storage/async-storage";
import { createDraft } from "@/lib/inspections/draft";
import { DRAFT_KEY_PREFIX, draftKey, readDraft, removeDraft, sweepStaleDrafts, writeDraft } from "@/lib/inspections/draftStore";
import { rawItem, template } from "../../helpers/inspectionFixtures";

const checklist = template("t", { items: [rawItem("a", { section: "Bath", description: "Mirror clean" })] });

function draftFor(hotelId: string, userId: string, roomId: string, businessDate = "2026-10-20") {
  const base = createDraft({ hotelId, userId, roomId, businessDate, cleanCycleId: "cycle-1", reinspectionOf: null, template: checklist, submissionId: `sub-${roomId}`, now: 1000 });
  return { ...base, answers: { a: { result: "pass" as const } }, questions: { a: { section: "Bath", description: "Mirror clean" } } };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});

describe("where a draft lives", () => {
  it("is keyed by hotel, person and room, so an account can only find its own", async () => {
    expect(draftKey("h1", "u1", "r1")).toBe(`${DRAFT_KEY_PREFIX}h1:u1:r1`);
    await writeDraft(draftFor("h1", "u1", "r1"));
    expect((await readDraft("h1", "u1", "r1")).status).toBe("found");
    expect((await readDraft("h2", "u1", "r1")).status).toBe("none"); // another hotel
    expect((await readDraft("h1", "u2", "r1")).status).toBe("none"); // another person
    expect((await readDraft("h1", "u1", "r2")).status).toBe("none"); // another room
  });

  it("round-trips everything, including the submission id that must survive a restart", async () => {
    const draft = draftFor("h1", "u1", "r1");
    expect(await writeDraft(draft)).toBe(true);
    expect(await readDraft("h1", "u1", "r1")).toEqual({ status: "found", draft });
  });

  it("stores no guest information: only ids, answers, the question wording and times", async () => {
    await writeDraft(draftFor("h1", "u1", "r1"));
    const raw = JSON.parse((await AsyncStorage.getItem(draftKey("h1", "u1", "r1"))) as string);
    expect(Object.keys(raw).sort()).toEqual([
      "answers", "businessDate", "cleanCycleId", "hotelId", "notes", "photos", "questions", "reinspectionOf", "roomId",
      "startedAt", "submissionId", "templateFingerprint", "templateId", "templateSignature", "updatedAt", "userId", "version",
    ]);
  });
});

describe("failures are reported, never hidden", () => {
  it("a write that fails says false, so the screen can never claim it saved", async () => {
    jest.spyOn(AsyncStorage, "setItem").mockRejectedValueOnce(new Error("disk full"));
    expect(await writeDraft(draftFor("h1", "u1", "r1"))).toBe(false);
    expect((await readDraft("h1", "u1", "r1")).status).toBe("none");
  });

  it("a read that fails is an error, not 'no draft'", async () => {
    jest.spyOn(AsyncStorage, "getItem").mockRejectedValueOnce(new Error("locked"));
    expect(await readDraft("h1", "u1", "r1")).toEqual({ status: "error" });
  });

  it("a stored value that is not a draft is reported corrupt and removed, not half trusted", async () => {
    await AsyncStorage.setItem(draftKey("h1", "u1", "r1"), "{not json");
    expect(await readDraft("h1", "u1", "r1")).toEqual({ status: "corrupt" });
    expect(await AsyncStorage.getItem(draftKey("h1", "u1", "r1"))).toBeNull();
    await AsyncStorage.setItem(draftKey("h1", "u1", "r2"), JSON.stringify({ version: 1, hotelId: "h1" }));
    expect(await readDraft("h1", "u1", "r2")).toEqual({ status: "corrupt" });
  });

  it("a removal that fails says false", async () => {
    await writeDraft(draftFor("h1", "u1", "r1"));
    jest.spyOn(AsyncStorage, "removeItem").mockRejectedValueOnce(new Error("nope"));
    expect(await removeDraft("h1", "u1", "r1")).toBe(false);
    expect((await readDraft("h1", "u1", "r1")).status).toBe("found");
  });
});

describe("discarding", () => {
  it("removes exactly that account's draft for that room and nothing else", async () => {
    await writeDraft(draftFor("h1", "u1", "r1"));
    await writeDraft(draftFor("h1", "u1", "r2"));
    await writeDraft(draftFor("h1", "u2", "r1"));
    await writeDraft(draftFor("h2", "u1", "r1"));
    expect(await removeDraft("h1", "u1", "r1")).toBe(true);
    expect((await readDraft("h1", "u1", "r1")).status).toBe("none");
    for (const [h, u, r] of [["h1", "u1", "r2"], ["h1", "u2", "r1"], ["h2", "u1", "r1"]]) expect((await readDraft(h, u, r)).status).toBe("found");
  });
});

describe("tidying earlier days", () => {
  it("drops this account's drafts from other days and unreadable ones, and nobody else's", async () => {
    await writeDraft(draftFor("h1", "u1", "today", "2026-10-20"));
    await writeDraft(draftFor("h1", "u1", "yesterday", "2026-10-19"));
    await AsyncStorage.setItem(draftKey("h1", "u1", "broken"), "garbage");
    await writeDraft(draftFor("h1", "u2", "theirs", "2026-10-01")); // someone else's old draft is not ours to touch
    expect(await sweepStaleDrafts("h1", "u1", "2026-10-20")).toBe(2);
    expect((await readDraft("h1", "u1", "today")).status).toBe("found");
    expect((await readDraft("h1", "u1", "yesterday")).status).toBe("none");
    expect(await AsyncStorage.getItem(draftKey("h1", "u2", "theirs"))).not.toBeNull();
  });

  it("never throws if storage is unavailable", async () => {
    jest.spyOn(AsyncStorage, "getAllKeys").mockRejectedValueOnce(new Error("x"));
    await expect(sweepStaleDrafts("h1", "u1", "2026-10-20")).resolves.toBe(0);
  });
});
