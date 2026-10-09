const mockClearRoomsCache = jest.fn().mockResolvedValue(undefined);
const mockUpsertRooms = jest.fn().mockResolvedValue(undefined);
const mockGet = jest.fn();

jest.mock("@/lib/offline/db", () => ({
  clearRoomsCache: (...args: unknown[]) => mockClearRoomsCache(...args),
  upsertRooms: (...args: unknown[]) => mockUpsertRooms(...args),
}));
jest.mock("@/lib/api/client", () => ({ api: { get: (...args: unknown[]) => mockGet(...args), post: jest.fn(), patch: jest.fn() } }));

import { useAppStore, type Room } from "@/stores/appStore";
import type { UserProfile } from "@/lib/supabase";

const user = (id: string, tenant: string) => ({ id, tenant_id: tenant }) as unknown as UserProfile;
const room = { id: "r1", room_number: "101" } as Room;

beforeEach(() => {
  jest.clearAllMocks();
  useAppStore.setState({ user: null, isAuthenticated: false, myRooms: [], hotelTimezone: null });
});

describe("room data never leaks between users or hotels", () => {
  it("clears rooms, the hotel timezone and the offline cache when a different user signs in", () => {
    useAppStore.getState().setUser(user("hk-1", "hotel-a"));
    useAppStore.getState().setMyRooms([room]);
    useAppStore.getState().setHotelTimezone("America/New_York");

    useAppStore.getState().setUser(user("hk-2", "hotel-a"));

    expect(useAppStore.getState().myRooms).toEqual([]);
    expect(useAppStore.getState().hotelTimezone).toBeNull();
    expect(mockClearRoomsCache).toHaveBeenCalledTimes(1);
  });

  it("does the same when the same person moves to another hotel", () => {
    useAppStore.getState().setUser(user("hk-1", "hotel-a"));
    useAppStore.getState().setMyRooms([room]);
    useAppStore.getState().setUser(user("hk-1", "hotel-b"));
    expect(useAppStore.getState().myRooms).toEqual([]);
    expect(mockClearRoomsCache).toHaveBeenCalledTimes(1);
  });

  it("clears on sign-out", () => {
    useAppStore.getState().setUser(user("hk-1", "hotel-a"));
    useAppStore.getState().setMyRooms([room]);
    useAppStore.getState().setUser(null);
    expect(useAppStore.getState().myRooms).toEqual([]);
    expect(mockClearRoomsCache).toHaveBeenCalledTimes(1);
  });

  it("keeps the rooms when the same user's profile refreshes", () => {
    useAppStore.getState().setUser(user("hk-1", "hotel-a"));
    useAppStore.getState().setMyRooms([room]);
    useAppStore.getState().setUser(user("hk-1", "hotel-a"));
    expect(useAppStore.getState().myRooms).toEqual([room]);
    expect(mockClearRoomsCache).not.toHaveBeenCalled();
  });

  it("the first sign-in does not wipe anything", () => {
    useAppStore.getState().setUser(user("hk-1", "hotel-a"));
    expect(mockClearRoomsCache).not.toHaveBeenCalled();
  });
});

describe("refreshRooms", () => {
  it("adopts the response's hotel timezone and prunes the cache to the server's shift date", async () => {
    useAppStore.getState().setUser(user("hk-1", "hotel-a"));
    mockGet.mockResolvedValue({ data: [room], meta: { timezone: "America/Denver", shift_date: "2026-10-08" } });
    await useAppStore.getState().refreshRooms();
    expect(useAppStore.getState().hotelTimezone).toBe("America/Denver");
    expect(useAppStore.getState().myRooms).toEqual([room]);
    expect(mockUpsertRooms).toHaveBeenCalledWith([room], { replaceDate: "2026-10-08" });
  });

  it("keeps local state when the refresh fails", async () => {
    useAppStore.getState().setUser(user("hk-1", "hotel-a"));
    useAppStore.getState().setMyRooms([room]);
    mockGet.mockRejectedValue(new Error("offline"));
    await useAppStore.getState().refreshRooms();
    expect(useAppStore.getState().myRooms).toEqual([room]);
  });
});
