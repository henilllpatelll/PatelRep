import { act, renderHook, waitFor } from "@testing-library/react-native";
import { useWorkSummary } from "@/lib/engineering/useWorkSummary";
import type { WorkSummary } from "@/lib/engineering/workSummary";

const sum = (urgent: number, inProgress = 0, waiting = 0): WorkSummary => ({ urgent, inProgress, waiting });

type Fetch = NonNullable<Parameters<typeof useWorkSummary>[0]["fetchSummary"]>;

function mount(fetchSummary: Fetch, extra: Partial<Parameters<typeof useWorkSummary>[0]> = {}) {
  return renderHook((props: Parameters<typeof useWorkSummary>[0]) => useWorkSummary(props), {
    initialProps: { scope: "t1:u1", enabled: true, fetchSummary, ...extra },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useWorkSummary", () => {
  it("is unknown until the server answers, then holds the server's counts", async () => {
    const gate = deferred<WorkSummary | null>();
    const hook = mount(jest.fn(() => gate.promise));
    expect(hook.result.current.summary).toBeNull();
    expect(hook.result.current.failed).toBe(false);
    await act(async () => gate.resolve(sum(2, 3, 4)));
    expect(hook.result.current.summary).toEqual(sum(2, 3, 4));
  });

  it("does not call the server when disabled (a role with no My Work)", async () => {
    const fetchSummary = jest.fn(async () => sum(1));
    const hook = mount(fetchSummary, { enabled: false });
    await act(async () => undefined);
    expect(fetchSummary).not.toHaveBeenCalled();
    expect(hook.result.current.summary).toBeNull();
  });

  it("refresh re-reads, and a slow older answer can never overwrite a newer one", async () => {
    const first = deferred<WorkSummary | null>();
    const second = deferred<WorkSummary | null>();
    const fetchSummary = jest.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const hook = mount(fetchSummary);
    await act(async () => {
      void hook.result.current.refresh();
    });
    await act(async () => second.resolve(sum(5)));
    expect(hook.result.current.summary).toEqual(sum(5));
    await act(async () => first.resolve(sum(1)));
    expect(hook.result.current.summary).toEqual(sum(5));
  });

  it("keeps the last good counts but flags the failure when a refresh fails", async () => {
    const fetchSummary = jest.fn().mockResolvedValueOnce(sum(2)).mockRejectedValueOnce(new Error("offline"));
    const hook = mount(fetchSummary);
    await waitFor(() => expect(hook.result.current.summary).toEqual(sum(2)));
    await act(async () => hook.result.current.refresh());
    expect(hook.result.current.summary).toEqual(sum(2));
    expect(hook.result.current.failed).toBe(true);
  });

  it("treats a malformed answer as a failure, not as zero", async () => {
    const hook = mount(jest.fn(async () => null));
    await waitFor(() => expect(hook.result.current.failed).toBe(true));
    expect(hook.result.current.summary).toBeNull();
  });

  it("survives a missing client function the same way as a network error", async () => {
    const hook = mount((() => {
      throw new TypeError("not a function");
    }) as unknown as Fetch);
    await waitFor(() => expect(hook.result.current.failed).toBe(true));
    expect(hook.result.current.summary).toBeNull();
  });

  it("never shows one hotel's or person's counts to another, even when the old answer arrives late", async () => {
    const old = deferred<WorkSummary | null>();
    const next = deferred<WorkSummary | null>();
    const fetchSummary = jest.fn().mockReturnValueOnce(Promise.resolve(sum(9))).mockReturnValueOnce(next.promise).mockReturnValue(old.promise);
    const hook = mount(fetchSummary);
    await waitFor(() => expect(hook.result.current.summary).toEqual(sum(9)));

    hook.rerender({ scope: "t2:u2", enabled: true, fetchSummary });
    // The moment the scope changes, the previous person's counts are gone.
    expect(hook.result.current.summary).toBeNull();
    await act(async () => next.resolve(sum(1)));
    expect(hook.result.current.summary).toEqual(sum(1));
    await act(async () => old.resolve(sum(9)));
    expect(hook.result.current.summary).toEqual(sum(1));
  });
});
