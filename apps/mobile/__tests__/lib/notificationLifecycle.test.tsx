const mockPush = jest.fn();
const mockGetLast = jest.fn();
const mockClearLast = jest.fn().mockResolvedValue(undefined);
const mockRemoveListener = jest.fn();
const mockAddListener = jest.fn();
const mockSetBadge = jest.fn().mockResolvedValue(true);
const mockGetUnread = jest.fn();
const mockSync = jest.fn().mockResolvedValue(true);
const mockSetup = jest.fn().mockResolvedValue("granted");
const mockPermissionState = jest.fn();
let mockAppStateHandler: ((state: string) => void) | null = null;
let mockTokenHandler: (() => void) | null = null;

jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock("expo-notifications", () => ({
  getLastNotificationResponseAsync: (...a: unknown[]) => mockGetLast(...a),
  clearLastNotificationResponseAsync: (...a: unknown[]) => mockClearLast(...a),
  addNotificationResponseReceivedListener: (...a: unknown[]) => {
    mockAddListener(...a);
    return { remove: mockRemoveListener };
  },
  addPushTokenListener: (handler: () => void) => {
    mockTokenHandler = handler;
    return { remove: jest.fn() };
  },
  setBadgeCountAsync: (...a: unknown[]) => mockSetBadge(...a),
}));
jest.mock("@/lib/api/notifications", () => ({ getUnreadCount: (...a: unknown[]) => mockGetUnread(...a) }));
jest.mock("@/lib/notifications/registration", () => ({
  setupPushNotifications: (...a: unknown[]) => mockSetup(...a),
  syncPushRegistration: (...a: unknown[]) => mockSync(...a),
}));
jest.mock("@/lib/notifications/permissions", () => ({
  canReceivePush: (state: string) => state === "granted" || state === "provisional",
  getPushPermissionState: (...a: unknown[]) => mockPermissionState(...a),
}));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } }));
jest.mock("@/lib/offline/db", () => ({ clearRoomsCache: jest.fn().mockResolvedValue(undefined), upsertRooms: jest.fn() }));

import { AppState } from "react-native";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { useNotificationResponses, usePushRegistration, useUnreadBadge } from "@/lib/notifications/lifecycle";
import { useAppStore } from "@/stores/appStore";
import type { UserProfile } from "@/lib/supabase";

const ROOM = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const TASK = "11111111-1111-4111-8111-111111111111";

const response = (identifier: string, data: Record<string, unknown>) =>
  ({ notification: { request: { identifier, content: { data } } } }) as never;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  mockGetLast.mockResolvedValue(null);
  mockGetUnread.mockResolvedValue(0);
  mockPermissionState.mockResolvedValue("granted");
  mockAppStateHandler = null;
  mockTokenHandler = null;
  jest.spyOn(AppState, "addEventListener").mockImplementation(((_: string, handler: (state: string) => void) => {
    mockAppStateHandler = handler;
    return { remove: jest.fn() };
  }) as never);
  useAppStore.setState({ unreadCount: 0, user: null, isAuthenticated: false });
});

describe("notification taps", () => {
  it("installs exactly one listener and removes it on unmount", () => {
    const hook = renderHook(() => useNotificationResponses(true, "housekeeper"));
    expect(mockAddListener).toHaveBeenCalledTimes(1);
    hook.unmount();
    expect(mockRemoveListener).toHaveBeenCalledTimes(1);
  });

  it("installs nothing while signed out", () => {
    renderHook(() => useNotificationResponses(false, undefined));
    expect(mockAddListener).not.toHaveBeenCalled();
    expect(mockGetLast).not.toHaveBeenCalled();
  });

  it("opens a task from a foreground or background tap", () => {
    renderHook(() => useNotificationResponses(true, "housekeeper"));
    const listener = mockAddListener.mock.calls[0][0];
    listener(response("n-task", { type: "task_assigned", task_id: TASK }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/(app)/tasks", params: { taskId: TASK } });
  });

  it("opens the tap that cold-started the app once, then clears it", async () => {
    mockGetLast.mockResolvedValue(response("n-cold", { type: "room_assignment", url: `/(app)/my-rooms/${ROOM}` }));
    renderHook(() => useNotificationResponses(true, "housekeeper"));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith({ pathname: `/(app)/my-rooms/${ROOM}` }));
    expect(mockClearLast).toHaveBeenCalledTimes(1);
  });

  it("does not open the same tap twice when the cold-start read and the listener both deliver it", async () => {
    const tap = response("n-dup", { type: "task_assigned", task_id: TASK });
    mockGetLast.mockResolvedValue(tap);
    renderHook(() => useNotificationResponses(true, "housekeeper"));
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    mockAddListener.mock.calls[0][0](tap);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it("opens nothing for a payload that is not on the supported list, or for the wrong role", async () => {
    renderHook(() => useNotificationResponses(true, "housekeeper"));
    const listener = mockAddListener.mock.calls[0][0];
    listener(response("n-evil", { url: "https://evil.example" }));
    listener(response("n-profile", { url: "/(app)/profile/security" }));
    listener(response("n-wo", { type: "wo_assignment", url: "/(app)/work-orders/0b8e1c52-3c3a-4f0e-9d64-1a6a8f6a2b11" }));
    listener(response("n-empty", {}));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("judges a tap by the person's CURRENT role, not the role at sign-in", () => {
    const hook = renderHook(({ role }: { role: "housekeeper" | "engineer" }) => useNotificationResponses(true, role), {
      initialProps: { role: "housekeeper" as const },
    });
    hook.rerender({ role: "engineer" as never });
    mockAddListener.mock.calls[0][0](response("n-wo2", { url: "/(app)/work-orders/0b8e1c52-3c3a-4f0e-9d64-1a6a8f6a2b11" }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/(app)/work-orders/0b8e1c52-3c3a-4f0e-9d64-1a6a8f6a2b11" });
    expect(mockAddListener).toHaveBeenCalledTimes(1); // a role change did not add a second listener
  });
});

describe("push registration lifecycle", () => {
  it("registers once per person and not again when only the role changes", () => {
    const hook = renderHook(({ id }: { id: string | undefined }) => usePushRegistration(id), { initialProps: { id: "u1" as string | undefined } });
    expect(mockSetup).toHaveBeenCalledTimes(1);
    expect(mockSetup).toHaveBeenCalledWith("u1");
    hook.rerender({ id: "u1" });
    expect(mockSetup).toHaveBeenCalledTimes(1);
    hook.rerender({ id: "u2" });
    expect(mockSetup).toHaveBeenCalledTimes(2);
  });

  it("does nothing while signed out", () => {
    renderHook(() => usePushRegistration(undefined));
    expect(mockSetup).not.toHaveBeenCalled();
  });

  it("re-registers immediately when the OS rotates the token", () => {
    renderHook(() => usePushRegistration("u1"));
    mockTokenHandler?.();
    expect(mockSync).toHaveBeenCalledWith("u1", { force: true });
  });
});

describe("unread badge", () => {
  it("uses the exact server count (not the length of a capped list)", async () => {
    mockGetUnread.mockResolvedValue(37);
    renderHook(() => useUnreadBadge(true));
    await waitFor(() => expect(useAppStore.getState().unreadCount).toBe(37));
    await waitFor(() => expect(mockSetBadge).toHaveBeenCalledWith(37));
  });

  it("refreshes when the app returns to the foreground and stops polling in the background", async () => {
    jest.useFakeTimers();
    mockGetUnread.mockResolvedValue(1);
    renderHook(() => useUnreadBadge(true));
    await act(async () => undefined);
    expect(mockGetUnread).toHaveBeenCalledTimes(1);
    await act(async () => jest.advanceTimersByTime(60_000));
    expect(mockGetUnread).toHaveBeenCalledTimes(2);
    act(() => mockAppStateHandler?.("background"));
    await act(async () => jest.advanceTimersByTime(180_000));
    expect(mockGetUnread).toHaveBeenCalledTimes(2);
    mockGetUnread.mockResolvedValue(5);
    await act(async () => mockAppStateHandler?.("active"));
    expect(mockGetUnread).toHaveBeenCalledTimes(3);
    expect(useAppStore.getState().unreadCount).toBe(5);
  });

  it("does not poll or touch the badge while signed out", async () => {
    renderHook(() => useUnreadBadge(false));
    await act(async () => undefined);
    expect(mockGetUnread).not.toHaveBeenCalled();
    expect(mockSetBadge).not.toHaveBeenCalled();
  });

  it("keeps the last count on a failed refresh instead of showing a wrong one", async () => {
    mockGetUnread.mockResolvedValueOnce(4).mockRejectedValue(new Error("offline"));
    jest.useFakeTimers();
    renderHook(() => useUnreadBadge(true));
    await act(async () => undefined);
    await act(async () => jest.advanceTimersByTime(60_000));
    expect(useAppStore.getState().unreadCount).toBe(4);
  });
});

describe("account switching", () => {
  const person = (id: string, tenant = "h1") => ({ id, tenant_id: tenant, role: "housekeeper" }) as unknown as UserProfile;

  it("never shows the previous person's unread count to the next person or after sign-out", () => {
    useAppStore.getState().setUser(person("a"));
    useAppStore.getState().setUnreadCount(9);
    useAppStore.getState().setUser(person("b"));
    expect(useAppStore.getState().unreadCount).toBe(0);
    useAppStore.getState().setUnreadCount(3);
    useAppStore.getState().setUser(null);
    expect(useAppStore.getState().unreadCount).toBe(0);
  });

  it("keeps the count when the same person's profile is simply refreshed", () => {
    useAppStore.getState().setUser(person("a"));
    useAppStore.getState().setUnreadCount(9);
    useAppStore.getState().setUser({ ...person("a"), effective_role: "engineer" } as unknown as UserProfile);
    expect(useAppStore.getState().unreadCount).toBe(9);
  });
});
