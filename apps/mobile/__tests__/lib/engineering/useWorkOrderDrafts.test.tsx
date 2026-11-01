import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { setQueueOwner } from "@/lib/offline/queueOwner";
import { emptyCompletionDraft } from "@/lib/engineering/repairWorkspace";
import { DRAFT_SAVE_DELAY_MS, useCompletionDraft, useTextDraft } from "@/lib/engineering/useWorkOrderDrafts";
import { loadCompletionDraft, loadTextDraft, saveCompletionDraft, saveTextDraft } from "@/lib/engineering/workOrderDrafts";
import type { WorkOrder } from "@/lib/engineering/workOrders";

const order = (over: Partial<WorkOrder> = {}): WorkOrder => ({ id: "wo-1", title: "AC", status: "in_progress", priority: "normal", ...over });

beforeEach(async () => {
  await AsyncStorage.clear();
  setQueueOwner("hotel-1:user-1");
});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, DRAFT_SAVE_DELAY_MS + 80)); });

describe("useCompletionDraft", () => {
  it("restores a saved draft for this order without sending anything, and says it was restored", async () => {
    await saveCompletionDraft("wo-1", { ...emptyCompletionDraft(), notes: "half done" }, "in_progress", "WO-1");
    const { result } = renderHook(() => useCompletionDraft("wo-1", order(), "WO-1"));
    await waitFor(() => expect(result.current.draft.notes).toBe("half done"));
    expect(result.current.restored?.review).toBe("none");
  });

  it("warns when the order moved on since the draft was saved", async () => {
    await saveCompletionDraft("wo-1", { ...emptyCompletionDraft(), notes: "x" }, "in_progress");
    const { result } = renderHook(() => useCompletionDraft("wo-1", order({ status: "on_hold" }), null));
    await waitFor(() => expect(result.current.restored?.review).toBe("statusChanged"));
  });

  it("never overwrites input typed before the restore finished", async () => {
    await saveCompletionDraft("wo-1", { ...emptyCompletionDraft(), notes: "OLD saved text" }, "in_progress");
    const { result } = renderHook(() => useCompletionDraft("wo-1", order(), null));
    act(() => result.current.editDraft((d) => ({ ...d, notes: "typed right now" })));
    await flush();
    expect(result.current.draft.notes).toBe("typed right now");
    expect(result.current.restored).toBeNull();
  });

  it("saves edits after a pause, and survives a restart (new mount) with the edits", async () => {
    const first = renderHook(() => useCompletionDraft("wo-1", order(), "WO-1"));
    await flush();
    act(() => first.result.current.editDraft((d) => ({ ...d, notes: "capacitor replaced", verification: "passed" })));
    await flush();
    expect((await loadCompletionDraft("wo-1"))?.draft.notes).toBe("capacitor replaced");
    first.unmount();

    const second = renderHook(() => useCompletionDraft("wo-1", order(), "WO-1"));
    await waitFor(() => expect(second.result.current.draft.notes).toBe("capacitor replaced"));
    expect(second.result.current.draft.verification).toBe("passed");
  });

  it("saves on the way out even before the pause elapsed", async () => {
    const { result, unmount } = renderHook(() => useCompletionDraft("wo-1", order(), null));
    await flush();
    act(() => result.current.editDraft((d) => ({ ...d, notes: "leaving now" })));
    unmount();
    await waitFor(async () => expect((await loadCompletionDraft("wo-1"))?.draft.notes).toBe("leaving now"));
  });

  it("does not save a draft that matches the order own coding (nothing was changed)", async () => {
    const { result } = renderHook(() => useCompletionDraft("wo-1", order(), null));
    await flush();
    act(() => result.current.editDraft((d) => ({ ...d })));
    await flush();
    expect(await loadCompletionDraft("wo-1")).toBeNull();
  });

  it("keeps the draft when the completion was only queued or failed, and clears it once confirmed", async () => {
    const { result } = renderHook(() => useCompletionDraft("wo-1", order(), null));
    await flush();
    act(() => result.current.editDraft((d) => ({ ...d, notes: "ready" })));
    await flush();
    // A queued or failed submission never calls confirmed(): the saved copy stays.
    expect(await loadCompletionDraft("wo-1")).not.toBeNull();
    await act(async () => result.current.confirmed());
    await flush();
    expect(await loadCompletionDraft("wo-1")).toBeNull();
    expect(result.current.draft.notes).toBe("");
  });

  it("discard throws the saved draft away and returns to the order coding", async () => {
    await saveCompletionDraft("wo-1", { ...emptyCompletionDraft(), notes: "drop me" }, "in_progress");
    const { result } = renderHook(() => useCompletionDraft("wo-1", order(), null));
    await waitFor(() => expect(result.current.restored).not.toBeNull());
    await act(async () => result.current.discard());
    await flush();
    expect(result.current.draft.notes).toBe("");
    expect(result.current.restored).toBeNull();
    expect(await loadCompletionDraft("wo-1")).toBeNull();
  });

  it("removes the draft of an order the server shows as completed, and never restores onto it", async () => {
    await saveCompletionDraft("wo-1", { ...emptyCompletionDraft(), notes: "stale" }, "in_progress");
    const { result } = renderHook(() => useCompletionDraft("wo-1", order({ status: "completed" }), null));
    await flush();
    expect(result.current.restored).toBeNull();
    expect(result.current.draft.notes).toBe("");
    await waitFor(async () => expect(await loadCompletionDraft("wo-1")).toBeNull());
  });

  it("never shows another person a draft", async () => {
    await saveCompletionDraft("wo-1", { ...emptyCompletionDraft(), notes: "private" }, "in_progress");
    setQueueOwner("hotel-1:user-2");
    const { result } = renderHook(() => useCompletionDraft("wo-1", order(), null));
    await flush();
    expect(result.current.draft.notes).toBe("");
    expect(result.current.restored).toBeNull();
  });
});

describe("useTextDraft", () => {
  it("restores, saves while typing and clears after the server stored it", async () => {
    await saveTextDraft("wo-1", "note", "earlier thought");
    const { result } = renderHook(() => useTextDraft("wo-1", "note"));
    await waitFor(() => expect(result.current.text).toBe("earlier thought"));
    act(() => result.current.setText("earlier thought, plus more"));
    await flush();
    expect(await loadTextDraft("wo-1", "note")).toBe("earlier thought, plus more");
    expect(result.current.saved).toBe(true);
    act(() => result.current.clear());
    await waitFor(async () => expect(await loadTextDraft("wo-1", "note")).toBeNull());
    expect(result.current.text).toBe("");
  });

  it("does not overwrite what was typed before the saved copy loaded", async () => {
    await saveTextDraft("wo-1", "hold", "saved");
    const { result } = renderHook(() => useTextDraft("wo-1", "hold"));
    act(() => result.current.setText("fresh"));
    await flush();
    expect(result.current.text).toBe("fresh");
  });

  it("keeps different orders and kinds apart", async () => {
    await saveTextDraft("wo-1", "note", "one");
    const other = renderHook(() => useTextDraft("wo-2", "note"));
    const kind = renderHook(() => useTextDraft("wo-1", "escalate"));
    await flush();
    expect(other.result.current.text).toBe("");
    expect(kind.result.current.text).toBe("");
  });
});
