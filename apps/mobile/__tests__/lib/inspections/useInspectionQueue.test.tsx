import { act, renderHook, waitFor } from "@testing-library/react-native";

jest.mock("@/lib/supabase", () => ({ supabase: { auth: { getSession: jest.fn(), refreshSession: jest.fn() } } }));
jest.mock("@/lib/housekeeping/supervisorRealtime", () => ({ subscribeSupervisorRealtime: jest.fn(() => jest.fn()) }));

const mockState: {
  user: { id: string; tenant_id: string } | null;
  isOnline: boolean;
  hotelTimezone: string | null;
} = { user: { id: "sup-1", tenant_id: "hotel-1" }, isOnline: true, hotelTimezone: "America/Chicago" };
jest.mock("@/stores/appStore", () => {
  const hook = (selector?: (state: unknown) => unknown) => (selector ? selector(mockState) : mockState);
  hook.getState = () => mockState;
  return { useAppStore: hook };
});

import { useInspectionQueue, type InspectionFetchers } from "@/lib/inspections/useInspectionQueue";
import { rawTemplate, readyRoom } from "../../helpers/inspectionFixtures";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const templates = { data: [rawTemplate("standard", { is_default: true }), { id: "broken", items: [{}] }] };

function fetchersOf(
  queue: InspectionFetchers["queue"],
  tpl: InspectionFetchers["templates"] = async () => templates,
  rest: Partial<Pick<InspectionFetchers, "corrections" | "records">> = {},
): InspectionFetchers {
  return {
    queue,
    templates: tpl,
    corrections: rest.corrections ?? (async () => ({ rows: [], truncated: false })),
    records: rest.records ?? (async () => []),
  };
}

beforeEach(() => {
  mockState.user = { id: "sup-1", tenant_id: "hotel-1" };
  mockState.isOnline = true;
  mockState.hotelTimezone = "America/Chicago";
});

describe("useInspectionQueue", () => {
  it("starts unknown, then shows the verified queue and the hotel's checklists", async () => {
    const queue = jest.fn().mockResolvedValue([readyRoom("r204"), readyRoom("r101", { room_number: "101", floor: 1 })]);
    const { result } = renderHook(() => useInspectionQueue({ fetchers: fetchersOf(queue) }));
    expect(result.current.items).toBeNull(); // not an empty queue: nothing is known yet
    expect(result.current.freshness).toBe("unverified");
    await waitFor(() => expect(result.current.items).not.toBeNull());
    expect(result.current.items!.map((i) => i.roomNumber)).toEqual(["101", "204"]);
    expect(result.current.freshness).toBe("live");
    expect(queue).toHaveBeenCalledWith(result.current.businessDate);
    const selection = result.current.selectionFor("type-king");
    expect(selection).toMatchObject({ ok: true, basis: "default" });
    expect(selection && selection.ok && selection.warnings).toContain("some_templates_unreadable");
  });

  it("a verified empty queue is a true zero", async () => {
    const { result } = renderHook(() => useInspectionQueue({ fetchers: fetchersOf(jest.fn().mockResolvedValue([])) }));
    await waitFor(() => expect(result.current.items).toEqual([]));
    expect(result.current.queue.status).toBe("empty");
  });

  it("a failed queue is unknown, not empty, and the checklists still load", async () => {
    const queue = jest.fn().mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    const { result } = renderHook(() => useInspectionQueue({ fetchers: fetchersOf(queue) }));
    await waitFor(() => expect(result.current.queue.status).toBe("failed"));
    expect(result.current.items).toBeNull();
    expect(result.current.templates.status).toBe("available");
  });

  it("a failed refresh keeps the last good queue but no longer calls it live", async () => {
    const queue = jest.fn().mockResolvedValueOnce([readyRoom("r204")]).mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useInspectionQueue({ fetchers: fetchersOf(queue) }));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.queue.status).toBe("stale");
    expect(result.current.freshness).toBe("stale");
  });

  it("does not fetch for nobody, or while disabled", async () => {
    mockState.user = null;
    const queue = jest.fn().mockResolvedValue([]);
    const { result } = renderHook(() => useInspectionQueue({ fetchers: fetchersOf(queue) }));
    await act(async () => undefined);
    expect(queue).not.toHaveBeenCalled();
    expect(result.current.items).toBeNull();
    mockState.user = { id: "sup-1", tenant_id: "hotel-1" };
    renderHook(() => useInspectionQueue({ enabled: false, fetchers: fetchersOf(queue) }));
    await act(async () => undefined);
    expect(queue).not.toHaveBeenCalled();
  });

  it("switching hotel discards the previous hotel's answers and ignores a late reply for it", async () => {
    const first = deferred<ReturnType<typeof readyRoom>[]>();
    const queue = jest
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce([readyRoom("other-room", { room_number: "900" })]);
    const { result, rerender } = renderHook(() => useInspectionQueue({ fetchers: fetchersOf(queue) }));
    await waitFor(() => expect(queue).toHaveBeenCalledTimes(1));

    mockState.user = { id: "sup-1", tenant_id: "hotel-2" };
    rerender({});
    await waitFor(() => expect(result.current.items?.map((i) => i.roomNumber)).toEqual(["900"]));

    await act(async () => {
      first.resolve([readyRoom("hotel-1-room", { room_number: "101" })]); // the old hotel's reply lands late
    });
    expect(result.current.items!.map((i) => i.roomNumber)).toEqual(["900"]);
  });

  it("a different person in the same hotel does not inherit the previous answers", async () => {
    const queue = jest.fn().mockResolvedValue([readyRoom("r204")]);
    const { result, rerender } = renderHook(() => useInspectionQueue({ fetchers: fetchersOf(queue) }));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    const slow = deferred<ReturnType<typeof readyRoom>[]>();
    queue.mockReturnValueOnce(slow.promise);
    mockState.user = { id: "sup-2", tenant_id: "hotel-1" };
    rerender({});
    expect(result.current.items).toBeNull();
    await act(async () => {
      slow.resolve([]);
    });
    await waitFor(() => expect(result.current.items).toEqual([]));
  });

  it("going offline keeps the rooms but stops calling them verified", async () => {
    const queue = jest.fn().mockResolvedValue([readyRoom("r204")]);
    const { result, rerender } = renderHook(() => useInspectionQueue({ fetchers: fetchersOf(queue) }));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    mockState.isOnline = false;
    rerender({});
    await waitFor(() => expect(result.current.queue.status).toBe("stale"));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.freshness).toBe("stale");
  });

  it("selection is unknown until the checklists have loaded", async () => {
    const tpl = deferred<{ data: unknown }>();
    const { result } = renderHook(() => useInspectionQueue({ fetchers: fetchersOf(jest.fn().mockResolvedValue([]), () => tpl.promise) }));
    expect(result.current.selectionFor("type-king")).toBeNull();
    await act(async () => {
      tpl.resolve({ data: [] });
    });
    await waitFor(() => expect(result.current.selectionFor("type-king")).toEqual({ ok: false, reason: "no_templates" }));
  });
});
