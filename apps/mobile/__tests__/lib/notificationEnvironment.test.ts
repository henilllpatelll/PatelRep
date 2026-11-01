const mockIsExpoGo = jest.fn();
let mockOS = "android";
const mockGetToken = jest.fn();
const mockGetPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
const mockSetChannel = jest.fn().mockResolvedValue(undefined);
const mockAddTokenListener = jest.fn(() => ({ remove: jest.fn() }));
const mockApi = { patch: jest.fn().mockResolvedValue({}), post: jest.fn().mockResolvedValue({}) };

jest.mock("expo", () => ({ isRunningInExpoGo: () => mockIsExpoGo() }));
jest.mock("react-native", () => ({
  get Platform() {
    return { OS: mockOS };
  },
  Linking: { openSettings: jest.fn() },
  AppState: { addEventListener: () => ({ remove: jest.fn() }), currentState: "active" },
}));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("@/lib/api/client", () => ({ api: { patch: (...a: unknown[]) => mockApi.patch(...a), post: (...a: unknown[]) => mockApi.post(...a) } }));
jest.mock("@/lib/api/notifications", () => ({ getUnreadCount: jest.fn().mockResolvedValue(0) }));
jest.mock("@/lib/supabase", () => ({ supabase: { from: jest.fn(), auth: {} } }));
jest.mock("@/lib/offline/db", () => ({ clearRoomsCache: jest.fn().mockResolvedValue(undefined), upsertRooms: jest.fn() }));
jest.mock("@/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/lib/app/appInfo", () => ({ getAppInfo: () => ({ name: "PatelRep", version: "1.4.0", build: "7", updateId: null }) }));
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: "proj-1" } } } },
}));
jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
  getExpoPushTokenAsync: (...a: unknown[]) => mockGetToken(...a),
  getPermissionsAsync: (...a: unknown[]) => mockGetPermissions(...a),
  requestPermissionsAsync: (...a: unknown[]) => mockRequestPermissions(...a),
  setNotificationChannelAsync: (...a: unknown[]) => mockSetChannel(...a),
  addPushTokenListener: (...a: unknown[]) => (mockAddTokenListener as (...x: unknown[]) => unknown)(...a),
  setBadgeCountAsync: jest.fn().mockResolvedValue(true),
  AndroidImportance: { HIGH: 4, DEFAULT: 3 },
}));

import { renderHook } from "@testing-library/react-native";
import { isRemotePushSupported } from "@/lib/notifications/environment";
import { usePushRegistration } from "@/lib/notifications/lifecycle";
import { getExpoPushToken, setupPushNotifications, syncPushRegistration } from "@/lib/notifications/registration";

beforeEach(() => {
  jest.clearAllMocks();
  mockOS = "android";
  mockIsExpoGo.mockReturnValue(false);
  mockGetToken.mockResolvedValue({ data: "ExponentPushToken[abc]" });
  mockGetPermissions.mockResolvedValue({ status: "granted", granted: true, canAskAgain: true });
});

describe("isRemotePushSupported", () => {
  it("is false only on Android inside Expo Go", () => {
    mockIsExpoGo.mockReturnValue(true);
    expect(isRemotePushSupported()).toBe(false);
    mockOS = "ios";
    expect(isRemotePushSupported()).toBe(true);
  });

  it("is true in a native development or production build", () => {
    expect(isRemotePushSupported()).toBe(true);
  });

  it("stays supported if detection itself throws", () => {
    mockIsExpoGo.mockImplementation(() => {
      throw new Error("boom");
    });
    expect(isRemotePushSupported()).toBe(true);
  });
});

describe("Android Expo Go", () => {
  beforeEach(() => mockIsExpoGo.mockReturnValue(true));

  it("never subscribes to push tokens or registers", () => {
    renderHook(() => usePushRegistration("u1"));
    expect(mockAddTokenListener).not.toHaveBeenCalled();
    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockApi.patch).not.toHaveBeenCalled();
  });

  it("skips permission, token and registration during setup", async () => {
    await expect(setupPushNotifications("u1")).resolves.toBe("unavailable");
    expect(mockGetPermissions).not.toHaveBeenCalled();
    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  it("returns no token and does not register", async () => {
    await expect(getExpoPushToken()).resolves.toBeNull();
    await expect(syncPushRegistration("u1", { force: true })).resolves.toBe(false);
    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockApi.patch).not.toHaveBeenCalled();
  });
});

describe("native development / production build", () => {
  it("subscribes to token rotation and registers the token", async () => {
    renderHook(() => usePushRegistration("u1"));
    expect(mockAddTokenListener).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 0));
    await expect(syncPushRegistration("u1", { force: true })).resolves.toBe(true);
    expect(mockApi.patch).toHaveBeenCalledWith("/staff/me/push-token", expect.objectContaining({ token: "ExponentPushToken[abc]" }));
  });

  it("requests a token during setup", async () => {
    await expect(setupPushNotifications("u2")).resolves.toBe("granted");
    expect(mockGetToken).toHaveBeenCalled();
  });
});
