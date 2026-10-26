import { act, renderHook, waitFor } from "@testing-library/react-native";

const mockState: { user: { id: string; tenant_id: string } | null; isOnline: boolean } = { user: { id: "sup-1", tenant_id: "hotel-1" }, isOnline: true };
jest.mock("@/stores/appStore", () => {
  const hook = (selector?: (state: unknown) => unknown) => (selector ? selector(mockState) : mockState);
  hook.getState = () => mockState;
  return { useAppStore: hook };
});
jest.mock("@/lib/supabase", () => ({ supabase: { auth: { getSession: jest.fn(), refreshSession: jest.fn() } } }));

import type { InspectionDetail } from "@/lib/api/inspections";
import { classifyLoadFailure, hasCycle, useInspectionRecord, type RecordFetchers } from "@/lib/inspections/history/useInspectionRecord";

const detail = (id: string, over: Partial<InspectionDetail> = {}): InspectionDetail =>
  ({ id, room_id: "r1", room_number: "205", floor: 2, room_type_id: null, template_id: null, template_name: null, overall_result: "passed", notes: null, completed_at: null, inspected_by: null, inspector_name: null, correction_kind: null, reinspection_of: null, items: [], correction: null, ...over }) as InspectionDetail;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const fetchers = (over: Partial<RecordFetchers> = {}): RecordFetchers => ({
  detail: jest.fn(async (id: string) => detail(id)),
  timeline: jest.fn(async (id: string) => ({ inspection_id: id, room_id: "r1", room_number: "205", inspections: [], events: [], truncated: false })),
  evidence: jest.fn(async () => ({ url: "https://signed/new", expiresIn: 600 })),
  ...over,
});

beforeEach(() => {
  mockState.user = { id: "sup-1", tenant_id: "hotel-1" };
  mockState.isOnline = true;
});

describe("classifyLoadFailure", () => {
  it("keeps 'not found', 'no permission', 'offline' and 'server error' apart", () => {
    expect(classifyLoadFailure({ status: 404 }, true)).toBe("not_found");
    expect(classifyLoadFailure({ status: 403 }, true)).toBe("forbidden");
    expect(classifyLoadFailure({ status: 401 }, true)).toBe("forbidden");
    expect(classifyLoadFailure(new Error("x"), false)).toBe("offline");
    expect(classifyLoadFailure({ status: 500 }, true)).toBe("error");
  });
});

describe("hasCycle", () => {
  it("is true only for a reinspection or a failure with a correction", () => {
    expect(hasCycle(null)).toBe(false);
    expect(hasCycle(detail("a"))).toBe(false);
    expect(hasCycle(detail("a", { reinspection_of: "b" }))).toBe(true);
    expect(hasCycle(detail("a", { correction: { status: "assigned" } as never }))).toBe(true);
  });
});

describe("useInspectionRecord", () => {
  it("loads the record for one inspection id", async () => {
    const f = fetchers();
    const { result } = renderHook(() => useInspectionRecord("insp-1", f));
    expect(result.current.detail.status).toBe("loading");
    await waitFor(() => expect(result.current.detail.status).toBe("ready"));
    expect(f.detail).toHaveBeenCalledWith("insp-1");
    expect(result.current.detail.status === "ready" && result.current.detail.data.id).toBe("insp-1");
    expect(result.current.timeline.status).toBe("idle"); // the timeline is only read when asked for
  });

  it("a missing record, a refused one and a server error are different failures", async () => {
    for (const [error, expected] of [[{ status: 404 }, "not_found"], [{ status: 403 }, "forbidden"], [{ status: 500 }, "error"]] as const) {
      const { result } = renderHook(() => useInspectionRecord("insp-1", fetchers({ detail: jest.fn().mockRejectedValue(error) })));
      await waitFor(() => expect(result.current.detail.status).toBe("failed"));
      expect(result.current.detail.status === "failed" && result.current.detail.failure).toBe(expected);
    }
  });

  it("following a related inspection loads the new one and drops the old, even if the old answer lands late", async () => {
    const slow = deferred<InspectionDetail>();
    const f = fetchers({ detail: jest.fn().mockReturnValueOnce(slow.promise).mockImplementation(async (id: string) => detail(id)) });
    const { result, rerender } = renderHook((props: { id: string }) => useInspectionRecord(props.id, f), { initialProps: { id: "old" } });
    rerender({ id: "new" });
    await waitFor(() => expect(result.current.detail.status === "ready" && result.current.detail.data.id).toBe("new"));
    await act(async () => slow.resolve(detail("old")));
    expect(result.current.detail.status === "ready" && result.current.detail.data.id).toBe("new");
  });

  it("a failed refresh keeps the record on screen, marked stale - unless the record is gone or refused", async () => {
    const f = fetchers({ detail: jest.fn().mockResolvedValueOnce(detail("insp-1")).mockRejectedValueOnce({ status: 500 }).mockRejectedValueOnce({ status: 404 }) });
    const { result } = renderHook(() => useInspectionRecord("insp-1", f));
    await waitFor(() => expect(result.current.detail.status).toBe("ready"));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.detail.status === "ready" && result.current.detail.stale).toBe(true));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.detail.status).toBe("failed"));
  });

  it("switching hotel throws the record away", async () => {
    const f = fetchers();
    const { result, rerender } = renderHook(() => useInspectionRecord("insp-1", f));
    await waitFor(() => expect(result.current.detail.status).toBe("ready"));
    mockState.user = { id: "sup-1", tenant_id: "hotel-2" };
    rerender({});
    expect(result.current.detail.status).toBe("loading");
    await waitFor(() => expect(result.current.detail.status).toBe("ready"));
    expect(f.detail).toHaveBeenCalledTimes(2); // re-read under the new hotel's credentials, nothing reused
  });

  it("reads the timeline on demand and reports its own failure", async () => {
    const f = fetchers({ timeline: jest.fn().mockRejectedValue({ status: 500 }) });
    const { result } = renderHook(() => useInspectionRecord("insp-1", f));
    await waitFor(() => expect(result.current.detail.status).toBe("ready"));
    act(() => result.current.loadTimeline());
    await waitFor(() => expect(result.current.timeline.status).toBe("failed"));
    expect(result.current.detail.status).toBe("ready"); // the record is unaffected
  });

  it("asks the server for a fresh photo link, and says null when the photo is gone", async () => {
    const f = fetchers();
    const { result } = renderHook(() => useInspectionRecord("insp-1", f));
    await waitFor(() => expect(result.current.detail.status).toBe("ready"));
    await expect(result.current.refreshEvidence("item-1")).resolves.toBe("https://signed/new");
    expect(f.evidence).toHaveBeenCalledWith("insp-1", "item-1");
    (f.evidence as jest.Mock).mockRejectedValueOnce({ status: 404 });
    await expect(result.current.refreshEvidence("item-1")).resolves.toBeNull();
  });
});
