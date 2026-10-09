jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } }));

import {
  applyLocalState,
  checklistFromTemplate,
  classifyFailure,
  getPhase,
  getProgress,
  groupBySection,
  hasPendingSync,
  itemKey,
  newSessionId,
  setItemChecked,
  type ChecklistItem,
  type ChecklistTemplate,
  type LocalCleanSession,
} from "@/lib/housekeeping/cleanSession";

function item(id: string | null, label: string, required: boolean, checked = false, section = "General"): ChecklistItem {
  return { item_id: id, section, label, is_required: required, checked, checked_at: checked ? "2026-10-08T10:00:00Z" : null };
}

function record(overrides: Partial<LocalCleanSession> = {}): LocalCleanSession {
  return {
    roomId: "room-1",
    sessionId: "sess-1",
    cleanType: "DEP",
    startedAt: "2026-10-08T09:00:00Z",
    entryAcknowledged: false,
    checklist: [],
    provisional: false,
    startConfirmed: true,
    pendingItems: {},
    completeRequestedAt: null,
    completionConfirmed: false,
    endedAt: null,
    durationSeconds: null,
    conflict: null,
    lastError: null,
    updatedAt: "2026-10-08T09:00:00Z",
    ...overrides,
  };
}

describe("checklist progress", () => {
  const list = [
    item("a", "Strip beds", true, true, "Bedroom"),
    item("b", "Clean bathroom", true, false, "Bathroom"),
    item("c", "Vacuum", false, true, "Bedroom"),
  ];

  it("counts required and overall progress separately", () => {
    const progress = getProgress(list);
    expect(progress).toMatchObject({ done: 2, total: 3, requiredDone: 1, requiredTotal: 2 });
    expect(progress.requiredRemaining.map((i) => i.label)).toEqual(["Clean bathroom"]);
  });

  it("a zero-item checklist has nothing required", () => {
    expect(getProgress([]).requiredRemaining).toEqual([]);
  });

  it("groups by section in configured order of first appearance", () => {
    expect(groupBySection(list).map((g) => [g.section, g.items.length])).toEqual([
      ["Bedroom", 2],
      ["Bathroom", 1],
    ]);
  });
});

describe("setItemChecked", () => {
  it("marks the item pending and clears a stale rejection", () => {
    const before = record({ checklist: [item("a", "Strip beds", true)], lastError: { code: "X", message: "m" } });
    const after = setItemChecked(before, itemKey(before.checklist[0]), true, "2026-10-08T10:00:00Z");
    expect(after.checklist[0].checked).toBe(true);
    expect(after.pendingItems["id:a"]).toMatchObject({ checked: true, checked_at: "2026-10-08T10:00:00Z" });
    expect(after.lastError).toBeNull();
  });

  it("is a no-op when the state is unchanged", () => {
    const before = record({ checklist: [item("a", "Strip beds", true, true)] });
    expect(setItemChecked(before, "id:a", true, "2026-10-08T10:00:00Z")).toBe(before);
  });
});

describe("applyLocalState", () => {
  it("keeps newer server state for items the user did not touch", () => {
    const server = [item("a", "Strip beds", true, true), item("b", "Clean bathroom", true, false)];
    const merged = applyLocalState(server, {});
    expect(merged.checklist.map((i) => i.checked)).toEqual([true, false]);
    expect(merged.pendingItems).toEqual({});
  });

  it("re-applies only touched items on top of the server copy", () => {
    const server = [item("a", "Strip beds", true, true), item("b", "Clean bathroom", true, false)];
    const touched = { "id:b": item("b", "Clean bathroom", true, true) };
    const merged = applyLocalState(server, touched);
    expect(merged.checklist.map((i) => i.checked)).toEqual([true, true]);
    expect(Object.keys(merged.pendingItems)).toEqual(["id:b"]);
  });

  it("remaps a provisional (cached template) checklist onto the server snapshot by section+label", () => {
    const provisional = [item("old-1", "Strip beds", true, true, "Bedroom")];
    const server = [item("new-1", "Strip beds", true, false, "Bedroom"), item("new-2", "Vacuum", false, false, "General")];
    const merged = applyLocalState(server, { "id:old-1": provisional[0] }, provisional);
    expect(merged.checklist[0]).toMatchObject({ item_id: "new-1", checked: true });
    expect(merged.pendingItems["id:new-1"]).toBeDefined();
  });

  it("drops local state for items the new snapshot no longer contains", () => {
    const merged = applyLocalState([item("z", "Other", false)], { "id:gone": item("gone", "Removed item", true, true) });
    expect(merged.pendingItems).toEqual({});
  });
});

describe("checklistFromTemplate", () => {
  const template = (clean_type: string, labels: string[]): ChecklistTemplate => ({
    id: `tpl-${clean_type}`,
    clean_type,
    name: clean_type,
    items: labels.map((label, i) => ({ id: `${clean_type}-${i}`, section: "Room", label, is_required: i === 0, sort_order: labels.length - i })),
  });
  const templates = [template("DEP", ["Strip", "Mop"]), template("FULL", ["Linens"]), template("LIGHT", ["Trash"]), template("DEFAULT", ["Standard"])];

  it.each([
    ["DEP", "Mop"], // sort_order reverses the declared order
    ["FULL", "Linens"],
    ["LIGHT", "Trash"],
    ["DEFAULT", "Standard"],
  ])("loads the %s configuration", (cleanType, firstLabel) => {
    expect(checklistFromTemplate(templates, cleanType)?.[0].label).toBe(firstLabel);
  });

  it("falls back to DEFAULT for unknown or missing clean types", () => {
    expect(checklistFromTemplate(templates, "STAYOVER")?.[0].label).toBe("Standard");
    expect(checklistFromTemplate(templates, null)?.[0].label).toBe("Standard");
  });

  it("preserves required flags and item ids", () => {
    const items = checklistFromTemplate(templates, "DEP")!;
    expect(items.map((i) => [i.item_id, i.is_required])).toEqual([["DEP-1", false], ["DEP-0", true]]);
    expect(items.every((i) => i.checked === false)).toBe(true);
  });

  it("returns null when no template is cached", () => {
    expect(checklistFromTemplate([], "DEP")).toBeNull();
  });
});

describe("session phase", () => {
  it("derives phase from what the server has confirmed", () => {
    expect(getPhase(record({ startConfirmed: false }))).toBe("starting");
    expect(getPhase(record())).toBe("active");
    expect(getPhase(record({ completeRequestedAt: "2026-10-08T10:00:00Z" }))).toBe("completing");
    expect(getPhase(record({ completionConfirmed: true }))).toBe("completed");
    expect(getPhase(record({ conflict: { code: "DND_ACTIVE", message: "m", at: "x" }, completeRequestedAt: "t" }))).toBe("conflict");
  });

  it("only reports pending sync for unconfirmed work", () => {
    expect(hasPendingSync(record())).toBe(false);
    expect(hasPendingSync(record({ startConfirmed: false }))).toBe(true);
    expect(hasPendingSync(record({ pendingItems: { "id:a": item("a", "x", false, true) } }))).toBe(true);
    expect(hasPendingSync(record({ completionConfirmed: true }))).toBe(false);
    expect(hasPendingSync(record({ conflict: { code: "DND_ACTIVE", message: "m", at: "x" } }))).toBe(false);
  });
});

describe("classifyFailure", () => {
  const apiError = (status: number, code?: string, detail?: unknown) =>
    Object.assign(new Error("boom"), { status, code, detail });

  it("treats errors without a status as offline (the request never got an answer)", () => {
    expect(classifyFailure(new Error("Network request failed")).kind).toBe("offline");
    expect(classifyFailure(new Error("Request timed out")).kind).toBe("offline");
  });

  it("retries server hiccups", () => {
    expect(classifyFailure(apiError(503)).kind).toBe("retry");
    expect(classifyFailure(apiError(429)).kind).toBe("retry");
  });

  it("surfaces required-item rejections as validation with the missing labels", () => {
    const failure = classifyFailure(apiError(422, "REQUIRED_ITEMS_INCOMPLETE", { missing: ["Strip beds"] }));
    expect(failure).toMatchObject({ kind: "validation", missing: ["Strip beds"] });
  });

  it("treats rejections and missing sessions as conflicts", () => {
    expect(classifyFailure(apiError(409, "DND_ACTIVE"))).toMatchObject({ kind: "conflict", code: "DND_ACTIVE" });
    expect(classifyFailure(apiError(404))).toMatchObject({ kind: "conflict", code: "SESSION_GONE" });
    expect(classifyFailure(apiError(403, "ROOM_NOT_ASSIGNED")).kind).toBe("conflict");
  });
});

describe("newSessionId", () => {
  it("generates RFC 4122 v4 ids (the API validates UUID4)", () => {
    const id = newSessionId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newSessionId()).not.toBe(id);
  });
});
