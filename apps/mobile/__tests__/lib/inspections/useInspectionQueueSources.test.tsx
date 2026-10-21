import { act, renderHook, waitFor } from "@testing-library/react-native";

jest.mock("@/lib/supabase", () => ({ supabase: { auth: { getSession: jest.fn(), refreshSession: jest.fn() } } }));
const mockSubscribe = jest.fn();
jest.mock("@/lib/housekeeping/supervisorRealtime", () => ({
  subscribeSupervisorRealtime: (...args: unknown[]) => mockSubscribe(...args),
}));

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

import type { InspectionRecordRow, OpenCorrectionRow } from "@/lib/api/inspections";
import { useInspectionQueue, type InspectionFetchers } from "@/lib/inspections/useInspectionQueue";
import { rawTemplate, readyRoom } from "../../helpers/inspectionFixtures";

const correction = (id: string, status = "assigned"): OpenCorrectionRow => ({
  inspection_id: `insp-${id}`,
  room_id: `room-${id}`,
  room_number: id,
  floor: 2,
  building: null,
  inspected_at: "2026-10-20T14:00:00Z",
  overall_result: "failed",
  kind: "reclean",
  status,
  notes: null,
  inspector_name: null,
  failed_count: 1,
  failed_items: [],
  task: null,
});

const record = (id: string, result = "passed", completedAt = "2026-10-20T16:00:00Z"): InspectionRecordRow => ({
  id,
  room_id: `room-${id}`,
  room_number: id,
  overall_result: result,
  inspector_display_name: "Sam",
  completed_at: completedAt,
});

function fetchers(over: Partial<InspectionFetchers> = {}): InspectionFetchers {
  return {
    queue: jest.fn().mockResolvedValue([readyRoom("r204")]),
    templates: jest.fn().mockResolvedValue({ data: [rawTemplate("standard", { is_default: true })] }),
    corrections: jest.fn().mockResolvedValue({ rows: [], truncated: false }),
    records: jest.fn().mockResolvedValue([]),
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSubscribe.mockImplementation(() => jest.fn());
  mockState.user = { id: "sup-1", tenant_id: "hotel-1" };
  mockState.isOnline = true;
  mockState.hotelTimezone = "America/Chicago";
});

describe("corrections and today's inspections are separate verified sources", () => {
  it("each starts unknown (null), then becomes a list; a verified zero is an empty list, not null", async () => {
    const { result } = renderHook(() => useInspectionQueue({ fetchers: fetchers() }));
    expect(result.current.correctionList).toBeNull();
    expect(result.current.doneList).toBeNull();
    await waitFor(() => expect(result.current.correctionList).not.toBeNull());
    expect(result.current.correctionList!.items).toEqual([]);
    expect(result.current.doneList!.items).toEqual([]);
    expect(result.current.corrections.status).toBe("empty");
  });

  it("a failing corrections request does not blank the queue, and its count stays unknown rather than zero", async () => {
    const { result } = renderHook(() => useInspectionQueue({ fetchers: fetchers({ corrections: jest.fn().mockRejectedValue(new Error("boom")) }) }));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await waitFor(() => expect(result.current.corrections.status).toBe("failed"));
    expect(result.current.correctionList).toBeNull();
    expect(result.current.doneList).not.toBeNull();
  });

  it("a failing records request leaves Passed unknown but still shows the corrections", async () => {
    const { result } = renderHook(() =>
      useInspectionQueue({ fetchers: fetchers({ records: jest.fn().mockRejectedValue(new Error("boom")), corrections: jest.fn().mockResolvedValue({ rows: [correction("305")], truncated: false }) }) }),
    );
    await waitFor(() => expect(result.current.correctionList?.items).toHaveLength(1));
    expect(result.current.doneList).toBeNull();
    expect(result.current.recordsFreshness).toBe("unverified");
  });

  it("done lists the hotel's business date only, using the hotel clock", async () => {
    const records = jest.fn().mockResolvedValue([record("101", "passed", "2026-10-20T16:00:00Z"), record("102", "passed", "2026-10-20T03:00:00Z")]);
    jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-20T18:00:00Z"));
    try {
      const { result } = renderHook(() => useInspectionQueue({ fetchers: fetchers({ records }) }));
      await waitFor(() => expect(result.current.doneList).not.toBeNull());
      expect(records).toHaveBeenCalledWith("2026-10-20");
      expect(result.current.doneList!.items.map((i) => i.roomNumber)).toEqual(["101"]);
    } finally {
      (Date.now as jest.Mock).mockRestore();
    }
  });

  it("outstanding corrections drop closed ones and report a truncated list as a lower bound", async () => {
    const corrections = jest.fn().mockResolvedValue({ rows: [correction("305"), correction("306", "verified")], truncated: true });
    const { result } = renderHook(() => useInspectionQueue({ fetchers: fetchers({ corrections }) }));
    await waitFor(() => expect(result.current.correctionList).not.toBeNull());
    expect(result.current.correctionList!.items.map((i) => i.roomNumber)).toEqual(["305"]);
    expect(result.current.correctionList!.truncated).toBe(true);
  });

  it("offline keeps all four lists but stops calling any of them verified", async () => {
    const { result, rerender } = renderHook(() => useInspectionQueue({ fetchers: fetchers({ corrections: jest.fn().mockResolvedValue({ rows: [correction("305")], truncated: false }) }) }));
    await waitFor(() => expect(result.current.correctionList?.items).toHaveLength(1));
    mockState.isOnline = false;
    rerender({});
    await waitFor(() => expect(result.current.corrections.status).toBe("stale"));
    expect(result.current.correctionList!.items).toHaveLength(1);
    expect(result.current.correctionsFreshness).toBe("stale");
    expect(result.current.recordsFreshness).toBe("stale");
  });

  it("another hotel never sees the previous hotel's corrections or inspections", async () => {
    const f = fetchers({ corrections: jest.fn().mockResolvedValue({ rows: [correction("305")], truncated: false }), records: jest.fn().mockResolvedValue([record("101")]) });
    const { result, rerender } = renderHook(() => useInspectionQueue({ fetchers: f }));
    await waitFor(() => expect(result.current.correctionList?.items).toHaveLength(1));
    (f.corrections as jest.Mock).mockResolvedValue({ rows: [], truncated: false });
    (f.records as jest.Mock).mockResolvedValue([]);
    mockState.user = { id: "sup-1", tenant_id: "hotel-2" };
    rerender({});
    expect(result.current.correctionList).toBeNull();
    expect(result.current.doneList).toBeNull();
    await waitFor(() => expect(result.current.correctionList?.items).toEqual([]));
  });
});

describe("realtime and refresh", () => {
  it("joins the shared supervisor channel for the signed-in hotel as an independent listener", async () => {
    renderHook(() => useInspectionQueue({ fetchers: fetchers() }));
    await waitFor(() => expect(mockSubscribe).toHaveBeenCalledTimes(1));
    expect(mockSubscribe).toHaveBeenCalledWith("hotel-1", expect.any(Function), { independent: true });
  });

  it("a room change reloads every source once", async () => {
    const f = fetchers();
    renderHook(() => useInspectionQueue({ fetchers: f }));
    await waitFor(() => expect(mockSubscribe).toHaveBeenCalled());
    await waitFor(() => expect(f.queue).toHaveBeenCalledTimes(1));
    const onChange = mockSubscribe.mock.calls[0][1] as () => void;
    await act(async () => {
      onChange();
    });
    await waitFor(() => expect(f.queue).toHaveBeenCalledTimes(2));
    expect(f.templates).toHaveBeenCalledTimes(2);
    expect(f.corrections).toHaveBeenCalledTimes(2);
    expect(f.records).toHaveBeenCalledTimes(2);
  });

  it("does not reload while the device is offline", async () => {
    const f = fetchers();
    renderHook(() => useInspectionQueue({ fetchers: f }));
    await waitFor(() => expect(mockSubscribe).toHaveBeenCalled());
    await waitFor(() => expect(f.queue).toHaveBeenCalledTimes(1));
    mockState.isOnline = false;
    await act(async () => {
      (mockSubscribe.mock.calls[0][1] as () => void)();
    });
    expect(f.queue).toHaveBeenCalledTimes(1);
  });

  it("leaves the channel on unmount and rejoins the new hotel after a switch", async () => {
    const unsubscribe = jest.fn();
    mockSubscribe.mockImplementation(() => unsubscribe);
    const { rerender, unmount } = renderHook(() => useInspectionQueue({ fetchers: fetchers() }));
    await waitFor(() => expect(mockSubscribe).toHaveBeenCalledTimes(1));
    mockState.user = { id: "sup-1", tenant_id: "hotel-2" };
    rerender({});
    await waitFor(() => expect(mockSubscribe).toHaveBeenCalledTimes(2));
    expect(mockSubscribe.mock.calls[1][0]).toBe("hotel-2");
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(2);
  });

  it("does not subscribe for nobody, when disabled, or when realtime is turned off", async () => {
    mockState.user = null;
    renderHook(() => useInspectionQueue({ fetchers: fetchers() }));
    mockState.user = { id: "sup-1", tenant_id: "hotel-1" };
    renderHook(() => useInspectionQueue({ enabled: false, fetchers: fetchers() }));
    renderHook(() => useInspectionQueue({ realtime: false, fetchers: fetchers() }));
    await act(async () => undefined);
    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it("a new business date reloads for the new day", async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(Date.parse("2026-10-21T04:59:00Z")); // 11:59 PM Oct 20 in Chicago
      const f = fetchers();
      renderHook(() => useInspectionQueue({ fetchers: f }));
      await act(async () => {
        await Promise.resolve();
      });
      expect(f.queue).toHaveBeenLastCalledWith("2026-10-20");
      await act(async () => {
        jest.setSystemTime(Date.parse("2026-10-21T05:01:00Z")); // 12:01 AM Oct 21
        jest.advanceTimersByTime(30_000);
        await Promise.resolve();
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(f.queue).toHaveBeenLastCalledWith("2026-10-21");
      expect(f.records).toHaveBeenLastCalledWith("2026-10-21");
    } finally {
      jest.useRealTimers();
    }
  });
});
