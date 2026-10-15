const mockApi = { patch: jest.fn().mockResolvedValue({}), post: jest.fn().mockResolvedValue({}) };
const mockGetToken = jest.fn();
const mockGetPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
const mockSetChannel = jest.fn().mockResolvedValue(undefined);
const mockSetBadge = jest.fn().mockResolvedValue(true);
const calls: string[] = [];

jest.mock("@/lib/api/client", () => ({
  api: {
    patch: (...a: unknown[]) => mockApi.patch(...a),
    post: (...a: unknown[]) => mockApi.post(...a),
  },
}));
jest.mock("@/lib/supabase", () => ({ supabase: { from: jest.fn(), auth: {} } }));
jest.mock("@/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
  getExpoPushTokenAsync: (...a: unknown[]) => mockGetToken(...a),
  getPermissionsAsync: (...a: unknown[]) => mockGetPermissions(...a),
  requestPermissionsAsync: (...a: unknown[]) => {
    calls.push("request");
    return mockRequestPermissions(...a);
  },
  setNotificationChannelAsync: (...a: unknown[]) => {
    calls.push("channel");
    return mockSetChannel(...a);
  },
  setBadgeCountAsync: (...a: unknown[]) => mockSetBadge(...a),
  AndroidImportance: { HIGH: 4, DEFAULT: 3 },
}));
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { version: "1.4.0", extra: { eas: { projectId: "proj-1" } } } },
}));
jest.mock("react-native", () => ({ Platform: { OS: "android" }, Linking: { openSettings: jest.fn() } }));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { savePushTokenToProfile, setupPushNotifications, syncPushRegistration, unregisterPushToken } from "@/lib/notifications";
import { supabase } from "@/lib/supabase";

const TOKEN = "ExponentPushToken[abc123]";
const granted = { status: "granted", granted: true, canAskAgain: true };

beforeEach(async () => {
  jest.clearAllMocks();
  calls.length = 0;
  await AsyncStorage.clear();
  mockGetToken.mockResolvedValue({ data: TOKEN });
  mockGetPermissions.mockResolvedValue(granted);
});

describe("savePushTokenToProfile", () => {
  it("registers the token with this install's id, platform and app version through the API", async () => {
    await savePushTokenToProfile(TOKEN);
    expect(mockApi.patch).toHaveBeenCalledWith("/staff/me/push-token", {
      token: TOKEN,
      installation_id: expect.stringMatching(/.{8,}/),
      platform: "android",
      app_version: "1.4.0",
    });
  });

  it("keeps the same install id across calls and never touches user_profiles directly", async () => {
    await savePushTokenToProfile(TOKEN);
    await savePushTokenToProfile("ExponentPushToken[rotated]");
    const [first, second] = mockApi.patch.mock.calls.map((c) => c[1].installation_id);
    expect(first).toBe(second);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

describe("syncPushRegistration", () => {
  it("collapses overlapping calls for the same person into one request", async () => {
    await Promise.all([syncPushRegistration("u1"), syncPushRegistration("u1"), syncPushRegistration("u1")]);
    expect(mockApi.patch).toHaveBeenCalledTimes(1);
  });

  it("does not re-send a registration the server already has for this person and token", async () => {
    await syncPushRegistration("u1");
    await syncPushRegistration("u1");
    expect(mockApi.patch).toHaveBeenCalledTimes(1);
    await syncPushRegistration("u1", { force: true });
    expect(mockApi.patch).toHaveBeenCalledTimes(2);
  });

  it("re-registers when the token rotates or a different person signs in on this phone", async () => {
    await syncPushRegistration("u1");
    mockGetToken.mockResolvedValue({ data: "ExponentPushToken[new]" });
    await syncPushRegistration("u1");
    expect(mockApi.patch).toHaveBeenCalledTimes(2);
    await syncPushRegistration("u2");
    expect(mockApi.patch).toHaveBeenCalledTimes(3);
    expect(mockApi.patch.mock.calls[2][1].token).toBe("ExponentPushToken[new]");
  });

  it("an account switch during an in-flight registration still registers the new person", async () => {
    let release: () => void = () => undefined;
    mockApi.patch.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const first = syncPushRegistration("u1");
    const second = syncPushRegistration("u2");
    await new Promise((r) => setTimeout(r, 0));
    release();
    await Promise.all([first, second]);
    expect(mockApi.patch).toHaveBeenCalledTimes(2);
  });

  it("reports failure without throwing when no token can be obtained or the server refuses", async () => {
    mockGetToken.mockRejectedValueOnce(new Error("no play services"));
    expect(await syncPushRegistration("u1")).toBe(false);
    mockApi.patch.mockRejectedValueOnce(new Error("offline"));
    expect(await syncPushRegistration("u1")).toBe(false);
  });
});

describe("setupPushNotifications", () => {
  it("creates channels before asking, asks once, then registers", async () => {
    mockGetPermissions.mockResolvedValue({ status: "undetermined", granted: false, canAskAgain: true });
    mockRequestPermissions.mockResolvedValue(granted);
    expect(await setupPushNotifications("u1")).toBe("granted");
    expect(calls.slice(0, 3)).toEqual(["channel", "channel", "request"]);
    expect(mockApi.patch).toHaveBeenCalledTimes(1);
  });

  it("does not prompt again on a later launch after it already asked once", async () => {
    mockGetPermissions.mockResolvedValue({ status: "undetermined", granted: false, canAskAgain: true });
    mockRequestPermissions.mockResolvedValue({ status: "denied", granted: false, canAskAgain: true });
    await setupPushNotifications("u1");
    expect(mockRequestPermissions).toHaveBeenCalledTimes(1);
    await setupPushNotifications("u1");
    expect(mockRequestPermissions).toHaveBeenCalledTimes(1);
    expect(mockApi.patch).not.toHaveBeenCalled();
  });

  it("never registers a phone the OS has not allowed", async () => {
    mockGetPermissions.mockResolvedValue({ status: "denied", granted: false, canAskAgain: false });
    expect(await setupPushNotifications("u1")).toBe("denied");
    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(mockApi.patch).not.toHaveBeenCalled();
  });
});

describe("unregisterPushToken", () => {
  it("detaches this phone's token on sign-out, clears the badge, and forgets the registration", async () => {
    await syncPushRegistration("u1");
    await unregisterPushToken();
    expect(mockApi.post).toHaveBeenCalledWith("/staff/me/push-token/revoke", { token: TOKEN });
    expect(mockSetBadge).toHaveBeenCalledWith(0);
    // The next person on this phone registers afresh rather than being skipped as "already registered".
    await syncPushRegistration("u2");
    expect(mockApi.patch).toHaveBeenCalledTimes(2);
  });

  it("is a no-op when nothing was ever registered, and surfaces a revoke failure to the caller", async () => {
    await unregisterPushToken();
    expect(mockApi.post).not.toHaveBeenCalled();
    await syncPushRegistration("u1");
    mockApi.post.mockRejectedValueOnce(new Error("offline"));
    await expect(unregisterPushToken()).rejects.toThrow("offline");
  });
});
