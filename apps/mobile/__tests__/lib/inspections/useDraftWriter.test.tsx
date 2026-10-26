import { act, renderHook } from "@testing-library/react-native";
import { AppState } from "react-native";
import { createDraft, type InspectionDraft } from "@/lib/inspections/draft";
import { DRAFT_WRITE_DELAY_MS, useDraftWriter } from "@/lib/inspections/useDraftWriter";
import { rawItem, template } from "../../helpers/inspectionFixtures";

const checklist = template("t", { items: [rawItem("a")] });
const draft = (n: number): InspectionDraft => ({
  ...createDraft({ hotelId: "h", userId: "u", roomId: "r", businessDate: "2026-10-20", cleanCycleId: null, reinspectionOf: null, template: checklist, submissionId: "sub", now: n }),
  notes: `rev ${n}`,
});

const tick = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

function setup(write: jest.Mock) {
  return renderHook(() => useDraftWriter({ write, now: () => 5000 }));
}

describe("writing the draft", () => {
  it("a burst of edits is one write, of the newest draft, after a short pause", async () => {
    const write = jest.fn().mockResolvedValue(true);
    const { result } = setup(write);
    act(() => { result.current.track(draft(1)); result.current.track(draft(2)); result.current.track(draft(3)); });
    expect(result.current.state.status).toBe("pending");
    expect(write).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(DRAFT_WRITE_DELAY_MS); });
    await tick();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0].notes).toBe("rev 3");
    expect(result.current.state).toEqual({ status: "saved", at: 5000 });
  });

  it("says saved only after the write completed", async () => {
    let finish: (ok: boolean) => void = () => undefined;
    const write = jest.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const { result } = setup(write);
    act(() => result.current.track(draft(1)));
    await act(async () => { void result.current.flush(); });
    expect(result.current.state.status).toBe("saving");
    await act(async () => finish(true));
    expect(result.current.state.status).toBe("saved");
  });

  it("flush writes at once, and resolves true only when everything is stored", async () => {
    const write = jest.fn().mockResolvedValue(true);
    const { result } = setup(write);
    act(() => result.current.track(draft(1)));
    let ok = false;
    await act(async () => { ok = await result.current.flush(); });
    expect(ok).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    expect(result.current.isDirty()).toBe(false);
    // nothing changed: a second flush writes nothing
    await act(async () => { ok = await result.current.flush(); });
    expect(ok && write.mock.calls.length).toBe(1);
  });

  it("a failed write is reported, keeps the work marked unsaved, and the next flush tries again", async () => {
    const write = jest.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const { result } = setup(write);
    act(() => result.current.track(draft(1)));
    let ok = true;
    await act(async () => { ok = await result.current.flush(); });
    expect(ok).toBe(false);
    expect(result.current.state.status).toBe("failed");
    expect(result.current.isDirty()).toBe(true);
    await act(async () => { ok = await result.current.flush(); });
    expect(ok).toBe(true);
    expect(result.current.state.status).toBe("saved");
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("a write that throws is a failure, not a crash", async () => {
    const write = jest.fn().mockRejectedValue(new Error("disk"));
    const { result } = setup(write);
    act(() => result.current.track(draft(1)));
    let ok = true;
    await act(async () => { ok = await result.current.flush(); });
    expect(ok).toBe(false);
    expect(result.current.state.status).toBe("failed");
  });

  it("an edit that lands while a write is running is written next, never lost, and never reordered", async () => {
    const order: number[] = [];
    let release: () => void = () => undefined;
    const write = jest.fn(async (d: InspectionDraft) => {
      order.push(d.startedAt);
      if (order.length === 1) await new Promise<void>((resolve) => { release = resolve; });
      return true;
    });
    const { result } = setup(write);
    act(() => result.current.track(draft(1)));
    let done: Promise<boolean> = Promise.resolve(false);
    await act(async () => { done = result.current.flush(); });
    act(() => result.current.track(draft(2))); // arrives mid-write
    await act(async () => { release(); await done; });
    expect(order).toEqual([1, 2]);
    expect(result.current.state.status).toBe("saved");
    expect(result.current.isDirty()).toBe(false);
  });

  it("leaving the foreground writes immediately", async () => {
    const write = jest.fn().mockResolvedValue(true);
    let listener: (state: string) => void = () => undefined;
    jest.spyOn(AppState, "addEventListener").mockImplementation(((_: string, cb: (s: string) => void) => { listener = cb; return { remove: jest.fn() }; }) as never);
    const { result } = setup(write);
    act(() => result.current.track(draft(1)));
    await act(async () => listener("background"));
    await tick();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("the screen going away writes what is pending, without waiting for the pause", async () => {
    const write = jest.fn().mockResolvedValue(true);
    const { result, unmount } = setup(write);
    act(() => result.current.track(draft(1)));
    unmount();
    await tick();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("reset forgets what is tracked without writing", async () => {
    const write = jest.fn().mockResolvedValue(true);
    const { result } = setup(write);
    act(() => result.current.track(draft(1)));
    act(() => result.current.reset());
    await act(async () => { jest.advanceTimersByTime(DRAFT_WRITE_DELAY_MS * 2); });
    await tick();
    expect(write).not.toHaveBeenCalled();
    expect(result.current.state.status).toBe("idle");
  });
});
