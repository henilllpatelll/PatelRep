import { act, renderHook, waitFor } from "@testing-library/react-native";

jest.mock("@/lib/api/workOrders", () => ({
  getWorkOrderChecklist: jest.fn(),
  setWorkOrderChecklistItem: jest.fn(),
}));

import * as api from "@/lib/api/workOrders";
import { useWorkOrderChecklist } from "@/lib/engineering/useWorkOrderChecklist";
import type { ChecklistItem, ChecklistSnapshot, ChecklistSummary } from "@/lib/engineering/workOrderChecklist";

const m = (fn: unknown) => fn as jest.Mock;

const item = (id: string, over: Partial<ChecklistItem> = {}): ChecklistItem => ({
  id,
  label: `Step ${id}`,
  is_required: false,
  is_done: false,
  done_by: null,
  done_at: null,
  sort_order: Number(id.replace(/\D/g, "")),
  estimated_minutes: null,
  ...over,
});
const summaryOf = (items: ChecklistItem[]): ChecklistSummary => {
  const remaining = items.filter((i) => i.is_required && !i.is_done).map((i) => ({ id: i.id, label: i.label }));
  return { total: items.length, completed: items.filter((i) => i.is_done).length, required_total: items.filter((i) => i.is_required).length, required_completed: 0, required_remaining: remaining, ready: remaining.length === 0 };
};
const snap = (items: ChecklistItem[]): ChecklistSnapshot => ({ items, summary: summaryOf(items), editable: true });

/** A promise the test settles by hand, to put answers in a chosen order. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

beforeEach(() => jest.clearAllMocks());

describe("useWorkOrderChecklist", () => {
  it("loads the checklist and reports it ready", async () => {
    m(api.getWorkOrderChecklist).mockResolvedValue(snap([item("a1"), item("a2")]));
    const { result } = renderHook(() => useWorkOrderChecklist("wo-1"));
    expect(result.current.load.phase).toBe("loading");
    await waitFor(() => expect(result.current.load.phase).toBe("ready"));
    expect(result.current.load.phase === "ready" && result.current.load.snapshot.items).toHaveLength(2);
  });

  it("reports a failed first read as an error, not as an empty checklist", async () => {
    m(api.getWorkOrderChecklist).mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    const { result } = renderHook(() => useWorkOrderChecklist("wo-1"));
    await waitFor(() => expect(result.current.load).toEqual({ phase: "error", failure: "failed" }));
  });

  it("classifies a 403 read as forbidden and a network failure as offline", async () => {
    m(api.getWorkOrderChecklist).mockRejectedValueOnce(Object.assign(new Error("no"), { status: 403 }));
    const a = renderHook(() => useWorkOrderChecklist("wo-1"));
    await waitFor(() => expect(a.result.current.load).toEqual({ phase: "error", failure: "forbidden" }));
    m(api.getWorkOrderChecklist).mockRejectedValueOnce(new Error("Network request failed"));
    const b = renderHook(() => useWorkOrderChecklist("wo-2"));
    await waitFor(() => expect(b.result.current.load).toEqual({ phase: "error", failure: "offline" }));
  });

  it("keeps the last confirmed read and marks it stale when a refresh fails", async () => {
    m(api.getWorkOrderChecklist).mockResolvedValueOnce(snap([item("a1")]));
    const { result } = renderHook(() => useWorkOrderChecklist("wo-1"));
    await waitFor(() => expect(result.current.load.phase).toBe("ready"));
    m(api.getWorkOrderChecklist).mockRejectedValueOnce(new Error("Network request failed"));
    await act(async () => result.current.refresh());
    expect(result.current.load.phase).toBe("ready");
    expect(result.current.stale).toBe(true);
  });

  it("shows a step as saving, and changes it only when the server confirms", async () => {
    m(api.getWorkOrderChecklist).mockResolvedValue(snap([item("a1", { is_required: true })]));
    const save = deferred<{ item: ChecklistItem; summary: ChecklistSummary }>();
    m(api.setWorkOrderChecklistItem).mockReturnValue(save.promise);
    const { result } = renderHook(() => useWorkOrderChecklist("wo-1"));
    await waitFor(() => expect(result.current.load.phase).toBe("ready"));

    let outcome!: Promise<boolean>;
    act(() => {
      outcome = result.current.setDone("a1", true);
    });
    expect(result.current.pending.has("a1")).toBe(true);
    // Not confirmed yet: the step is still open.
    expect(result.current.load.phase === "ready" && result.current.load.snapshot.items[0].is_done).toBe(false);

    const done = item("a1", { is_required: true, is_done: true, done_by: "u1", done_at: "2026-10-31T10:00:00Z" });
    await act(async () => {
      save.resolve({ item: done, summary: summaryOf([done]) });
      await outcome;
    });
    expect(await outcome).toBe(true);
    expect(result.current.pending.has("a1")).toBe(false);
    expect(result.current.load.phase === "ready" && result.current.load.snapshot.items[0].is_done).toBe(true);
    expect(result.current.load.phase === "ready" && result.current.load.snapshot.summary.ready).toBe(true);
    expect(api.setWorkOrderChecklistItem).toHaveBeenCalledWith("wo-1", "a1", true);
  });

  it("ignores a second tap on a step that is already saving", async () => {
    m(api.getWorkOrderChecklist).mockResolvedValue(snap([item("a1")]));
    const save = deferred<{ item: ChecklistItem; summary: ChecklistSummary }>();
    m(api.setWorkOrderChecklistItem).mockReturnValue(save.promise);
    const { result } = renderHook(() => useWorkOrderChecklist("wo-1"));
    await waitFor(() => expect(result.current.load.phase).toBe("ready"));

    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = result.current.setDone("a1", true);
      second = result.current.setDone("a1", true);
    });
    expect(await second).toBe(false);
    expect(api.setWorkOrderChecklistItem).toHaveBeenCalledTimes(1);
    await act(async () => {
      const done = item("a1", { is_done: true });
      save.resolve({ item: done, summary: summaryOf([done]) });
      await first;
    });
  });

  it("leaves the step unchanged and explains a refused change", async () => {
    m(api.getWorkOrderChecklist).mockResolvedValue(snap([item("a1")]));
    m(api.setWorkOrderChecklistItem).mockRejectedValue(Object.assign(new Error("closed"), { status: 409, code: "work_order_closed" }));
    const { result } = renderHook(() => useWorkOrderChecklist("wo-1"));
    await waitFor(() => expect(result.current.load.phase).toBe("ready"));
    let ok = true;
    await act(async () => {
      ok = await result.current.setDone("a1", true);
    });
    expect(ok).toBe(false);
    expect(result.current.itemErrors.a1).toBe("closed");
    expect(result.current.pending.has("a1")).toBe(false);
    expect(result.current.load.phase === "ready" && result.current.load.snapshot.items[0].is_done).toBe(false);
  });

  it("reports a 403 as forbidden and a network failure as a generic failure", async () => {
    m(api.getWorkOrderChecklist).mockResolvedValue(snap([item("a1"), item("a2")]));
    m(api.setWorkOrderChecklistItem).mockRejectedValueOnce(Object.assign(new Error("no"), { status: 403 })).mockRejectedValueOnce(new Error("Network request failed"));
    const { result } = renderHook(() => useWorkOrderChecklist("wo-1"));
    await waitFor(() => expect(result.current.load.phase).toBe("ready"));
    await act(async () => void (await result.current.setDone("a1", true)));
    await act(async () => void (await result.current.setDone("a2", true)));
    expect(result.current.itemErrors).toEqual({ a1: "forbidden", a2: "failed" });
  });

  it("clears a step's earlier error when it is tried again", async () => {
    m(api.getWorkOrderChecklist).mockResolvedValue(snap([item("a1")]));
    m(api.setWorkOrderChecklistItem).mockRejectedValueOnce(new Error("Network request failed"));
    const { result } = renderHook(() => useWorkOrderChecklist("wo-1"));
    await waitFor(() => expect(result.current.load.phase).toBe("ready"));
    await act(async () => void (await result.current.setDone("a1", true)));
    expect(result.current.itemErrors.a1).toBe("failed");
    const done = item("a1", { is_done: true });
    m(api.setWorkOrderChecklistItem).mockResolvedValueOnce({ item: done, summary: summaryOf([done]) });
    await act(async () => void (await result.current.setDone("a1", true)));
    expect(result.current.itemErrors.a1).toBeUndefined();
  });

  it("drops a read that began before a change was confirmed (a stale answer never overwrites it)", async () => {
    const initial = snap([item("a1", { is_required: true })]);
    m(api.getWorkOrderChecklist).mockResolvedValueOnce(initial);
    const { result } = renderHook(() => useWorkOrderChecklist("wo-1"));
    await waitFor(() => expect(result.current.load.phase).toBe("ready"));

    // A refresh starts and is slow…
    const slowRead = deferred<ChecklistSnapshot>();
    m(api.getWorkOrderChecklist).mockReturnValueOnce(slowRead.promise);
    let refreshing!: Promise<void>;
    act(() => {
      refreshing = result.current.refresh();
    });
    // …the change is confirmed meanwhile…
    const done = item("a1", { is_required: true, is_done: true });
    m(api.setWorkOrderChecklistItem).mockResolvedValueOnce({ item: done, summary: summaryOf([done]) });
    await act(async () => void (await result.current.setDone("a1", true)));
    // …then the old read lands with the pre-change state.
    await act(async () => {
      slowRead.resolve(initial);
      await refreshing;
    });
    expect(result.current.load.phase === "ready" && result.current.load.snapshot.items[0].is_done).toBe(true);
  });

  it("lets the newest of two overlapping reads win", async () => {
    m(api.getWorkOrderChecklist).mockResolvedValueOnce(snap([item("a1")]));
    const { result } = renderHook(() => useWorkOrderChecklist("wo-1"));
    await waitFor(() => expect(result.current.load.phase).toBe("ready"));

    const older = deferred<ChecklistSnapshot>();
    const newer = deferred<ChecklistSnapshot>();
    m(api.getWorkOrderChecklist).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    let a!: Promise<void>;
    let b!: Promise<void>;
    act(() => {
      a = result.current.refresh();
      b = result.current.refresh();
    });
    await act(async () => {
      newer.resolve(snap([item("a1"), item("a2")]));
      await b;
      older.resolve(snap([item("a1")]));
      await a;
    });
    expect(result.current.load.phase === "ready" && result.current.load.snapshot.items).toHaveLength(2);
  });

  it("starts clean when the work order changes", async () => {
    m(api.getWorkOrderChecklist).mockResolvedValueOnce(snap([item("a1")])).mockResolvedValueOnce(snap([item("b1"), item("b2")]));
    const { result, rerender } = renderHook(({ id }: { id: string }) => useWorkOrderChecklist(id), { initialProps: { id: "wo-1" } });
    await waitFor(() => expect(result.current.load.phase).toBe("ready"));
    rerender({ id: "wo-2" });
    await waitFor(() => expect(result.current.load.phase === "ready" && result.current.load.snapshot.items[0].id).toBe("b1"));
    expect(api.getWorkOrderChecklist).toHaveBeenLastCalledWith("wo-2", expect.anything());
  });
});
