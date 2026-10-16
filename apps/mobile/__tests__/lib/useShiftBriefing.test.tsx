import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ShiftBriefing } from "@/lib/ai/briefing";
import type { Room } from "@/stores/appStore";

const mockFetchBriefing = jest.fn();
jest.mock("@/lib/ai/briefing", () => ({ fetchShiftBriefing: (...args: unknown[]) => mockFetchBriefing(...args) }));

import { resetBriefingCache, useShiftBriefing } from "@/lib/housekeeping/useShiftBriefing";

const t = (key: string) => key;
const rooms = [{ id: "r1", room_number: "208" }] as unknown as Room[];
const ai: ShiftBriefing = { headline: "Start with 208.", plan: ["208"], watchouts: [], estimatedMinutes: 30, source: "ai" };
const localOnly: ShiftBriefing = { ...ai, source: "local" };

function setup(overrides: Partial<Parameters<typeof useShiftBriefing>[0]> = {}) {
  return renderHook(
    (props: Parameters<typeof useShiftBriefing>[0]) => useShiftBriefing(props),
    { initialProps: { scope: "hotel-1:user-1", shiftDate: "2026-10-14", language: "en" as const, rooms, isOnline: true, t, ...overrides } },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  resetBriefingCache();
});

describe("useShiftBriefing", () => {
  it("reports used-up AI help as credits, not as a generic failure, and does not store it as an answer", async () => {
    mockFetchBriefing.mockResolvedValue({ ...localOnly, failure: "credit_limit" });
    const { result } = setup();
    await act(async () => {
      await result.current.request();
    });
    expect(result.current.status).toBe("credits");
    expect(result.current.ai).toBeNull();
  });

  it("treats a rate limit the same way, and any other failure as unavailable", async () => {
    mockFetchBriefing.mockResolvedValueOnce({ ...localOnly, failure: "rate_limited" });
    const { result } = setup();
    await act(async () => {
      await result.current.request();
    });
    expect(result.current.status).toBe("credits");

    mockFetchBriefing.mockResolvedValueOnce({ ...localOnly, failure: "unavailable" });
    await act(async () => {
      await result.current.request({ force: true });
    });
    expect(result.current.status).toBe("unavailable");
  });


  it("never asks the AI on its own: mounting, re-rendering and refreshing cost nothing", async () => {
    const { rerender } = setup();
    rerender({ scope: "hotel-1:user-1", shiftDate: "2026-10-14", language: "en", rooms: [...rooms], isOnline: true, t });
    await act(async () => undefined);
    expect(mockFetchBriefing).not.toHaveBeenCalled();
  });

  it("asks once on request and keeps the answer", async () => {
    mockFetchBriefing.mockResolvedValue(ai);
    const { result } = setup();
    await act(async () => {
      await result.current.request();
    });
    expect(result.current.ai).toEqual(ai);
    expect(result.current.status).toBe("idle");
    expect(mockFetchBriefing).toHaveBeenCalledTimes(1);
  });

  it("reuses the stored answer when the screen is remounted (switching tabs does not rebuy it)", async () => {
    mockFetchBriefing.mockResolvedValue(ai);
    const first = setup();
    await act(async () => {
      await first.result.current.request();
    });
    first.unmount();

    const second = setup();
    expect(second.result.current.ai).toEqual(ai);
    await act(async () => {
      await second.result.current.request();
    });
    expect(mockFetchBriefing).toHaveBeenCalledTimes(1);
  });

  it("asks again only for a deliberate New briefing", async () => {
    mockFetchBriefing.mockResolvedValue(ai);
    const { result } = setup();
    await act(async () => {
      await result.current.request();
      await result.current.request({ force: true });
    });
    expect(mockFetchBriefing).toHaveBeenCalledTimes(2);
  });

  it("does not run two requests at once", async () => {
    let resolve: (value: ShiftBriefing) => void = () => undefined;
    mockFetchBriefing.mockImplementation(() => new Promise<ShiftBriefing>((r) => { resolve = r; }));
    const { result } = setup();
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.request({ force: true });
      second = result.current.request({ force: true });
    });
    expect(result.current.status).toBe("loading");
    await act(async () => {
      resolve(ai);
      await Promise.all([first, second]);
    });
    expect(mockFetchBriefing).toHaveBeenCalledTimes(1);
  });

  it("reports unavailable (and keeps nothing) when the AI times out or falls back to a local plan", async () => {
    mockFetchBriefing.mockResolvedValueOnce(localOnly).mockResolvedValueOnce(ai);
    const { result } = setup();
    await act(async () => {
      await result.current.request();
    });
    expect(result.current.status).toBe("unavailable");
    expect(result.current.ai).toBeNull();

    // The failure was not stored: the next ask really asks, and can succeed.
    await act(async () => {
      await result.current.request();
    });
    expect(result.current.status).toBe("idle");
    expect(result.current.ai).toEqual(ai);
    expect(mockFetchBriefing).toHaveBeenCalledTimes(2);
  });

  it("says offline without spending a request", async () => {
    const { result } = setup({ isOnline: false });
    await act(async () => {
      await result.current.request();
    });
    expect(result.current.status).toBe("offline");
    expect(mockFetchBriefing).not.toHaveBeenCalled();
  });

  it("keeps one person's briefing from another's", async () => {
    mockFetchBriefing.mockResolvedValue(ai);
    const mine = setup();
    await act(async () => {
      await mine.result.current.request();
    });
    const other = setup({ scope: "hotel-1:user-2" });
    expect(other.result.current.ai).toBeNull();
    const nextDay = setup({ shiftDate: "2026-10-15" });
    expect(nextDay.result.current.ai).toBeNull();
  });

  it("drops an answer that arrives after the person changed", async () => {
    let resolve: (value: ShiftBriefing) => void = () => undefined;
    mockFetchBriefing.mockImplementation(() => new Promise<ShiftBriefing>((r) => { resolve = r; }));
    const { result, rerender } = setup();
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.request();
    });
    rerender({ scope: "hotel-1:user-2", shiftDate: "2026-10-14", language: "en", rooms, isOnline: true, t });
    await act(async () => {
      resolve(ai);
      await pending;
    });
    expect(result.current.ai).toBeNull();
  });
});
