import { act, renderHook, waitFor } from "@testing-library/react-native";

const mockGet = jest.fn();
jest.mock("@/lib/api/client", () => ({ api: { get: (...args: unknown[]) => mockGet(...args) } }));

import { useHotelTimezone } from "@/lib/housekeeping/useHotelTimezone";
import { useAppStore } from "@/stores/appStore";

function signIn(tenantId: string, isOnline = true) {
  useAppStore.setState({
    user: { id: "sup-1", tenant_id: tenantId, role: "housekeeping_supervisor" } as never,
    hotelTimezone: null,
    isOnline,
  });
}

beforeEach(() => {
  mockGet.mockReset();
});

describe("useHotelTimezone", () => {
  it("teaches the app the authenticated hotel's own zone when none is known", async () => {
    signIn("hotel-1");
    mockGet.mockResolvedValue({ hotel: { id: "hotel-1", timezone: "America/Denver" } });
    renderHook(() => useHotelTimezone());
    await waitFor(() => expect(useAppStore.getState().hotelTimezone).toBe("America/Denver"));
    expect(mockGet).toHaveBeenCalledWith("/auth/me");
  });

  it("does not ask when a zone is already known", () => {
    signIn("hotel-1");
    useAppStore.setState({ hotelTimezone: "America/Chicago" });
    renderHook(() => useHotelTimezone());
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("does not ask while offline", () => {
    signIn("hotel-1", false);
    renderHook(() => useHotelTimezone());
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("ignores an answer for a different hotel or an unusable zone", async () => {
    signIn("hotel-1");
    mockGet.mockResolvedValue({ hotel: { id: "hotel-2", timezone: "America/Denver" } });
    renderHook(() => useHotelTimezone());
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    await Promise.resolve();
    expect(useAppStore.getState().hotelTimezone).toBeNull();

    signIn("hotel-1");
    mockGet.mockResolvedValue({ hotel: { id: "hotel-1", timezone: "Not/AZone" } });
    renderHook(() => useHotelTimezone());
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(useAppStore.getState().hotelTimezone).toBeNull();
  });

  it("writes nothing when the person switched hotels while the request was in flight", async () => {
    signIn("hotel-1");
    let resolve!: (value: unknown) => void;
    mockGet.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderHook(() => useHotelTimezone());
    act(() => useAppStore.setState({ user: { id: "sup-1", tenant_id: "hotel-2", role: "housekeeping_supervisor" } as never }));
    await act(async () => {
      resolve({ hotel: { id: "hotel-1", timezone: "America/Denver" } });
    });
    expect(useAppStore.getState().hotelTimezone).toBeNull();
  });

  it("a failed read keeps the default and does not throw", async () => {
    signIn("hotel-1");
    mockGet.mockRejectedValue(new Error("offline"));
    renderHook(() => useHotelTimezone());
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(useAppStore.getState().hotelTimezone).toBeNull();
  });
});
