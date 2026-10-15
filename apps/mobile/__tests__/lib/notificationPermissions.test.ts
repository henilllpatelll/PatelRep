const mockGetPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
const mockSetChannel = jest.fn().mockResolvedValue(undefined);
const mockOpenSettings = jest.fn().mockResolvedValue(undefined);
const calls: string[] = [];
let mockOS = "android";

jest.mock("expo-notifications", () => ({
  getPermissionsAsync: (...a: unknown[]) => mockGetPermissions(...a),
  requestPermissionsAsync: (...a: unknown[]) => {
    calls.push("request");
    return mockRequestPermissions(...a);
  },
  setNotificationChannelAsync: (...a: unknown[]) => {
    calls.push(`channel:${String(a[0])}`);
    return mockSetChannel(...a);
  },
  AndroidImportance: { NONE: 0, MIN: 1, LOW: 2, DEFAULT: 3, HIGH: 4, MAX: 5 },
}));
jest.mock("react-native", () => ({
  Platform: { get OS() { return mockOS; } },
  Linking: { openSettings: (...a: unknown[]) => mockOpenSettings(...a) },
}));
jest.mock("@/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));

import * as Notifications from "expo-notifications";
import {
  canReceivePush,
  getPushPermissionState,
  mapPermission,
  openDeviceNotificationSettings,
  requestPushPermission,
} from "@/lib/notifications/permissions";

type Response = Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>;
const response = (over: Record<string, unknown>) => ({ status: "undetermined", granted: false, canAskAgain: true, expires: "never", ...over }) as unknown as Response;

beforeEach(() => {
  jest.clearAllMocks();
  calls.length = 0;
  mockOS = "android";
});

describe("mapPermission", () => {
  it("reports what the operating system says", () => {
    expect(mapPermission(response({ status: "granted", granted: true }))).toBe("granted");
    expect(mapPermission(response({ status: "undetermined" }))).toBe("undetermined");
    expect(mapPermission(response({ status: "denied", canAskAgain: false }))).toBe("denied");
  });

  it("treats an iOS provisional grant as quiet delivery, not full permission", () => {
    expect(mapPermission(response({ status: "granted", granted: true, ios: { status: 3 } }))).toBe("provisional");
    expect(canReceivePush("provisional")).toBe(true);
  });

  it("treats 'granted' with every Android channel switched off as denied", () => {
    expect(mapPermission(response({ status: "granted", granted: true, android: { importance: 0 } }))).toBe("denied");
  });

  it("lets Android ask once more after a first refusal, but never after a permanent one", () => {
    expect(mapPermission(response({ status: "denied", canAskAgain: true }))).toBe("undetermined");
    expect(mapPermission(response({ status: "denied", canAskAgain: false }))).toBe("denied");
  });

  it("only granted and provisional can receive push", () => {
    expect(["granted", "provisional", "undetermined", "denied", "unavailable"].filter((s) => canReceivePush(s as never))).toEqual(["granted", "provisional"]);
  });
});

describe("getPushPermissionState", () => {
  it("is unavailable on web and when the permission API fails", async () => {
    mockOS = "web";
    expect(await getPushPermissionState()).toBe("unavailable");
    mockOS = "ios";
    mockGetPermissions.mockRejectedValueOnce(new Error("boom"));
    expect(await getPushPermissionState()).toBe("unavailable");
  });
});

describe("requestPushPermission", () => {
  it("creates the Android channels before it asks (a requirement of the Android 13+ prompt)", async () => {
    mockGetPermissions.mockResolvedValue(response({ status: "undetermined" }));
    mockRequestPermissions.mockResolvedValue(response({ status: "granted", granted: true }));
    expect(await requestPushPermission()).toBe("granted");
    expect(calls).toEqual(["channel:alerts", "channel:updates", "request"]);
  });

  it("never re-prompts after a permanent denial, and never prompts when already allowed", async () => {
    mockGetPermissions.mockResolvedValue(response({ status: "denied", canAskAgain: false }));
    expect(await requestPushPermission()).toBe("denied");
    mockGetPermissions.mockResolvedValue(response({ status: "granted", granted: true }));
    expect(await requestPushPermission()).toBe("granted");
    expect(mockRequestPermissions).not.toHaveBeenCalled();
  });

  it("reports a refusal as denied and does not loop", async () => {
    mockGetPermissions.mockResolvedValue(response({ status: "undetermined" }));
    mockRequestPermissions.mockResolvedValue(response({ status: "denied", canAskAgain: false }));
    expect(await requestPushPermission()).toBe("denied");
    expect(mockRequestPermissions).toHaveBeenCalledTimes(1);
  });
});

describe("Android channels", () => {
  it("uses HIGH for time-sensitive work, DEFAULT for updates, and never MAX", async () => {
    mockGetPermissions.mockResolvedValue(response({ status: "undetermined" }));
    mockRequestPermissions.mockResolvedValue(response({ status: "granted", granted: true }));
    jest.resetModules();
    const { ensureNotificationChannels } = require("@/lib/notifications/channels") as typeof import("@/lib/notifications/channels");
    await ensureNotificationChannels();
    await ensureNotificationChannels(); // created once per run
    const created = Object.fromEntries(mockSetChannel.mock.calls.map(([id, config]) => [id, config.importance]));
    expect(created).toEqual({ alerts: 4, updates: 3 });
    expect(mockSetChannel).toHaveBeenCalledTimes(2);
  });

  it("does nothing on iOS", async () => {
    mockOS = "ios";
    jest.resetModules();
    const { ensureNotificationChannels } = require("@/lib/notifications/channels") as typeof import("@/lib/notifications/channels");
    await ensureNotificationChannels();
    expect(mockSetChannel).not.toHaveBeenCalled();
  });
});

describe("openDeviceNotificationSettings", () => {
  it("opens the system settings page for this app and survives a failure", async () => {
    await openDeviceNotificationSettings();
    expect(mockOpenSettings).toHaveBeenCalledTimes(1);
    mockOpenSettings.mockRejectedValueOnce(new Error("no settings"));
    await expect(openDeviceNotificationSettings()).resolves.toBeUndefined();
  });
});
