import {
  applyItemUpdate,
  checklistEditing,
  checklistGate,
  offlineChecklistBlock,
  parseChecklistResponse,
  parseChecklistUpdate,
  progressRatio,
  type ChecklistItem,
  type ChecklistLoad,
  type ChecklistSnapshot,
  type ChecklistSummary,
} from "@/lib/engineering/workOrderChecklist";
import {
  completionBlockers,
  emptyCompletionDraft,
  interpretCompletionError,
  offlineCompletionBlock,
  type CompletionDraft,
} from "@/lib/engineering/repairWorkspace";

const item = (id: string, over: Partial<ChecklistItem> = {}): ChecklistItem => ({
  id,
  label: `Step ${id}`,
  is_required: false,
  is_done: false,
  done_by: null,
  done_at: null,
  sort_order: Number(id.replace(/\D/g, "")) || 0,
  estimated_minutes: null,
  ...over,
});

const summaryOf = (items: ChecklistItem[]): ChecklistSummary => {
  const required = items.filter((i) => i.is_required);
  const remaining = required.filter((i) => !i.is_done).map((i) => ({ id: i.id, label: i.label }));
  return {
    total: items.length,
    completed: items.filter((i) => i.is_done).length,
    required_total: required.length,
    required_completed: required.length - remaining.length,
    required_remaining: remaining,
    ready: remaining.length === 0,
  };
};

const snapshot = (items: ChecklistItem[], editable = true): ChecklistSnapshot => ({ items, summary: summaryOf(items), editable });
const ready = (items: ChecklistItem[]): ChecklistLoad => ({ phase: "ready", snapshot: snapshot(items) });

const wireItem = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  label: `Step ${id}`,
  is_required: false,
  is_done: false,
  done_by: null,
  done_at: null,
  sort_order: Number(id.replace(/\D/g, "")) || 0,
  estimated_minutes: null,
  ...over,
});
const wireSummary = (over: Record<string, unknown> = {}) => ({ total: 2, completed: 1, required_total: 1, required_completed: 0, required_remaining: [{ id: "a2", label: "Step a2" }], ready: false, ...over });

describe("parseChecklistResponse", () => {
  it("reads steps in server order with their requiredness and the server's summary", () => {
    const parsed = parseChecklistResponse({
      data: [wireItem("a2", { is_required: true }), wireItem("a1", { is_done: true, done_by: "u1", done_at: "2026-10-31T10:00:00Z" })],
      summary: wireSummary(),
      meta: { editable: true },
    });
    expect(parsed?.items.map((i) => i.id)).toEqual(["a1", "a2"]);
    expect(parsed?.items[1].is_required).toBe(true);
    expect(parsed?.summary.required_remaining).toEqual([{ id: "a2", label: "Step a2" }]);
    expect(parsed?.editable).toBe(true);
  });

  it("treats a missing is_required as optional, never required", () => {
    const raw = wireItem("a1") as Record<string, unknown>;
    delete raw.is_required;
    expect(parseChecklistResponse({ data: [raw], summary: wireSummary({ total: 1, required_total: 0, required_remaining: [], ready: true }) })?.items[0].is_required).toBe(false);
  });

  it("reads a closed order as not editable", () => {
    expect(parseChecklistResponse({ data: [], summary: wireSummary({ total: 0, completed: 0, required_total: 0, required_remaining: [], ready: true }), meta: { editable: false } })?.editable).toBe(false);
  });

  it("rejects a malformed answer so it can never pass as an empty checklist", () => {
    expect(parseChecklistResponse(null)).toBeNull();
    expect(parseChecklistResponse({ data: "nope", summary: wireSummary() })).toBeNull();
    expect(parseChecklistResponse({ data: [{ id: 1 }], summary: wireSummary() })).toBeNull();
    expect(parseChecklistResponse({ data: [] })).toBeNull();
    expect(parseChecklistResponse({ data: [], summary: { total: 0 } })).toBeNull();
  });

  it("never reads ready when the server lists a required step as open", () => {
    const parsed = parseChecklistResponse({ data: [wireItem("a1", { is_required: true })], summary: wireSummary({ ready: true, required_remaining: [{ id: "a1", label: "Step a1" }] }) });
    expect(parsed?.summary.ready).toBe(false);
  });
});

describe("parseChecklistUpdate", () => {
  it("returns the confirmed step and the new summary", () => {
    const parsed = parseChecklistUpdate({ data: wireItem("a1", { is_done: true }), summary: wireSummary({ ready: true, required_remaining: [] }) });
    expect(parsed?.item.is_done).toBe(true);
    expect(parsed?.summary.ready).toBe(true);
  });
  it("rejects an answer without a step", () => {
    expect(parseChecklistUpdate({ data: null, summary: wireSummary() })).toBeNull();
  });
});

describe("applyItemUpdate", () => {
  it("replaces one step, keeps the order and takes the server summary", () => {
    const base = snapshot([item("a1"), item("a2", { is_required: true })]);
    const done = item("a2", { is_required: true, is_done: true, done_by: "u1", done_at: "2026-10-31T10:00:00Z" });
    const next = applyItemUpdate(base, done, summaryOf([item("a1"), done]));
    expect(next.items.map((i) => [i.id, i.is_done])).toEqual([["a1", false], ["a2", true]]);
    expect(next.summary.ready).toBe(true);
  });
  it("ignores a step the list does not contain", () => {
    const base = snapshot([item("a1")]);
    expect(applyItemUpdate(base, item("zz"), summaryOf([]))).toBe(base);
  });
});

describe("progressRatio", () => {
  it("is completed over total", () => {
    expect(progressRatio({ total: 5, completed: 3 })).toBeCloseTo(0.6);
    expect(progressRatio({ total: 2, completed: 2 })).toBe(1);
    expect(progressRatio({ total: 4, completed: 0 })).toBe(0);
  });
  it("has no progress, rather than 100% or NaN, when there are no steps", () => {
    expect(progressRatio({ total: 0, completed: 0 })).toBeNull();
  });
  it("stays within 0..1 on inconsistent input", () => {
    expect(progressRatio({ total: 2, completed: 5 })).toBe(1);
    expect(progressRatio({ total: 2, completed: -1 })).toBe(0);
  });
});

describe("checklistEditing", () => {
  const base = { online: true, snapshotEditable: true };
  const mine = { block: null, isMine: true } as const;

  it("lets the assigned engineer and a GM tick steps online", () => {
    expect(checklistEditing({ ...base, actions: mine, role: "engineer" })).toEqual({ canEdit: true, reason: null });
    expect(checklistEditing({ ...base, actions: { block: null, isMine: false }, role: "gm" })).toEqual({ canEdit: true, reason: null });
  });
  it("is read-only for a chief engineer, who has no repair actions in the app", () => {
    expect(checklistEditing({ ...base, actions: { block: "viewOnly", isMine: false }, role: "chief_engineer" })).toEqual({ canEdit: false, reason: "viewOnly" });
  });
  it("is read-only on someone else's order", () => {
    expect(checklistEditing({ ...base, actions: { block: "claimedElsewhere", isMine: false }, role: "engineer" })).toEqual({ canEdit: false, reason: "notAssigned" });
    expect(checklistEditing({ ...base, actions: { block: null, isMine: false }, role: "engineer" })).toEqual({ canEdit: false, reason: "notAssigned" });
  });
  it("is a read-only record once the order is closed, however it is known", () => {
    expect(checklistEditing({ ...base, actions: { block: "closed", isMine: true }, role: "engineer" }).reason).toBe("closed");
    expect(checklistEditing({ ...base, snapshotEditable: false, actions: mine, role: "engineer" }).reason).toBe("closed");
  });
  it("needs a connection: a step is never queued offline", () => {
    expect(checklistEditing({ ...base, online: false, actions: mine, role: "engineer" })).toEqual({ canEdit: false, reason: "offline" });
  });
});

describe("checklistGate", () => {
  it("is ready with no checklist and with every required step done", () => {
    expect(checklistGate(ready([]))).toEqual({ kind: "ready" });
    expect(checklistGate(ready([item("a1", { is_required: true, is_done: true }), item("a2")]))).toEqual({ kind: "ready" });
  });
  it("is blocked by an open required step, never by an open optional one", () => {
    expect(checklistGate(ready([item("a1", { is_required: true })]))).toEqual({ kind: "blocked", remaining: [{ id: "a1", label: "Step a1" }] });
    expect(checklistGate(ready([item("a1")]))).toEqual({ kind: "ready" });
  });
  it("is unverified while loading or after a failed read, not 'ready'", () => {
    expect(checklistGate({ phase: "loading" })).toEqual({ kind: "unverified" });
    expect(checklistGate({ phase: "error", failure: "failed" })).toEqual({ kind: "unverified" });
  });
});

describe("offline completion and the checklist", () => {
  const draft = (over: Partial<CompletionDraft> = {}): CompletionDraft => ({ ...emptyCompletionDraft(), resolutionCodeId: "res-1", verification: "passed", ...over });

  it("blocks queueing while a required step is open or the checklist is unconfirmed", () => {
    expect(offlineChecklistBlock({ kind: "blocked", remaining: [] })).toBe("checklistOpen");
    expect(offlineChecklistBlock({ kind: "unverified" })).toBe("checklistUnverified");
    expect(offlineChecklistBlock({ kind: "ready" })).toBeNull();
  });
  it("lets a checklist-free (or fully done) order queue as before", () => {
    expect(offlineCompletionBlock(draft(), checklistGate(ready([])))).toBeNull();
    expect(offlineCompletionBlock(draft(), checklistGate(ready([item("a1", { is_required: true, is_done: true })])))).toBeNull();
  });
  it("keeps the existing parts and failed-test blocks first", () => {
    expect(offlineCompletionBlock(draft({ verification: "failed" }), { kind: "ready" })).toBe("failedVerification");
    expect(offlineCompletionBlock(draft({ parts: [{ partId: "p", locationId: "l", name: "x", quantity: 1 } as never] }), { kind: "ready" })).toBe("parts");
  });
  it("is unchanged when no gate is passed", () => {
    expect(offlineCompletionBlock(draft())).toBeNull();
  });
});

describe("completionBlockers", () => {
  const draft = (over: Partial<CompletionDraft> = {}): CompletionDraft => ({ ...emptyCompletionDraft(), resolutionCodeId: "res-1", verification: "passed", ...over });
  const open = { kind: "blocked", remaining: [{ id: "a", label: "A" }, { id: "b", label: "B" }] } as const;

  it("has none when everything is in place", () => {
    expect(completionBlockers(draft(), { kind: "ready" }, true)).toEqual([]);
  });
  it("names the missing resolution, verification and note", () => {
    expect(completionBlockers(draft({ resolutionCodeId: null }), { kind: "ready" }, true).map((b) => b.id)).toEqual(["resolution"]);
    expect(completionBlockers(draft({ verification: null }), { kind: "ready" }, true).map((b) => b.id)).toEqual(["verification"]);
    expect(completionBlockers(draft({ verification: "follow_up_required" }), { kind: "ready" }, true).map((b) => b.id)).toEqual(["verificationNotes"]);
  });
  it("counts the open required steps", () => {
    expect(completionBlockers(draft(), open, true)).toEqual([{ id: "checklist", count: 2 }]);
  });
  it("does not let the checklist block a recorded failed test", () => {
    expect(completionBlockers(draft({ verification: "failed", verificationNotes: "still warm" }), open, true)).toEqual([]);
  });
  it("only blocks on an unreadable checklist when offline", () => {
    expect(completionBlockers(draft(), { kind: "unverified" }, true)).toEqual([]);
    expect(completionBlockers(draft(), { kind: "unverified" }, false).map((b) => b.id)).toEqual(["checklistUnverified"]);
  });
});

describe("interpretCompletionError for the checklist", () => {
  const checklistError = (remaining: unknown[]) =>
    Object.assign(new Error("2 required checklist items must be done"), { status: 422, code: "checklist_incomplete", detail: { code: "checklist_incomplete", remaining } });

  it("is a rejection that names the checklist and how many steps are open", () => {
    expect(interpretCompletionError(checklistError([{}, {}]), { verification: "passed" })).toMatchObject({
      kind: "rejected",
      errors: { checklist: "required" },
      checklistRemaining: 2,
    });
  });
  it("is never read as success, a conflict or a stock problem", () => {
    const out = interpretCompletionError(checklistError([{}]), { verification: "passed" });
    expect(out.kind).toBe("rejected");
    expect(out).not.toMatchObject({ errors: { parts: expect.anything() } });
  });
  it("leaves other 422 validation errors alone", () => {
    expect(interpretCompletionError(Object.assign(new Error("Describe the selected Other resolution"), { status: 422 }), { verification: "passed" })).toMatchObject({ errors: { resolutionOther: "other" } });
  });
});
