import { dataState, isServerConfirmed, needsPerson, queuedState, stateLabelKey, verifiedAgeMinutes } from "@/lib/engineering/pmSyncState";

describe("engineering sync state", () => {
  it("only current and synced are statements about the server", () => {
    expect(isServerConfirmed("current")).toBe(true);
    expect(isServerConfirmed("synced")).toBe(true);
    for (const s of ["cached", "local_draft", "queued", "syncing", "needs_review", "rejected", "unknown_outcome"] as const) expect(isServerConfirmed(s)).toBe(false);
  });

  it("a queued completion is never shown as recorded", () => {
    expect(queuedState({ phase: "queued", attempts: 0, active: false })).toBe("queued");
    expect(queuedState({ phase: "uploading", attempts: 1, active: true })).toBe("syncing");
    expect(queuedState({ phase: "unknown", attempts: 2, active: false })).toBe("unknown_outcome");
  });

  it("a stop is review for things a person can fix and rejected for a definitive refusal", () => {
    expect(queuedState({ phase: "queued", stop: "conflict_completed", attempts: 0, active: false })).toBe("needs_review");
    expect(queuedState({ phase: "queued", stop: "checklist_unavailable", attempts: 0, active: false })).toBe("needs_review");
    expect(queuedState({ phase: "queued", stop: "forbidden", attempts: 0, active: false })).toBe("rejected");
    expect(queuedState({ phase: "queued", stop: "invalid", attempts: 0, active: false })).toBe("rejected");
    expect(needsPerson("needs_review")).toBe(true);
    expect(needsPerson("queued")).toBe(false);
  });

  it("never turns an unknown verification time into zero", () => {
    expect(verifiedAgeMinutes(null)).toBeNull();
    expect(verifiedAgeMinutes("not a date")).toBeNull();
    expect(verifiedAgeMinutes("2026-01-01T00:00:00Z", Date.parse("2026-01-01T00:10:00Z"))).toBe(10);
  });

  it("server data is current only when verified recently and online", () => {
    const now = Date.parse("2026-01-01T00:10:00Z");
    expect(dataState({ online: true, verifiedAt: "2026-01-01T00:09:00Z", now })).toBe("current");
    expect(dataState({ online: true, verifiedAt: "2026-01-01T00:01:00Z", now })).toBe("cached");
    expect(dataState({ online: false, verifiedAt: "2026-01-01T00:09:30Z", now })).toBe("cached");
    expect(dataState({ online: true, verifiedAt: null, now })).toBe("cached");
  });

  it("has a label key per state", () => {
    expect(stateLabelKey("needs_review")).toBe("engSync.state.needs_review");
  });
});
