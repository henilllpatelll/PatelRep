import { savePushTokenToProfile } from "@/lib/notifications";

jest.mock("@/lib/api/client", () => ({
  api: { patch: jest.fn().mockResolvedValue({}) },
}));
jest.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
    from: jest.fn(),
  },
}));
jest.mock("expo-notifications", () => ({ setNotificationHandler: jest.fn() }));
jest.mock("expo-constants", () => ({ default: { expoConfig: null } }));
jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));

import { api } from "@/lib/api/client";
import { supabase } from "@/lib/supabase";

describe("savePushTokenToProfile", () => {
  beforeEach(() => jest.clearAllMocks());

  it("calls api.patch /staff/me/push-token with token", async () => {
    await savePushTokenToProfile("ExponentPushToken[abc123]");
    expect((api.patch as jest.Mock)).toHaveBeenCalledWith(
      "/staff/me/push-token",
      { token: "ExponentPushToken[abc123]" }
    );
  });

  it("does NOT call supabase.from(user_profiles)", async () => {
    await savePushTokenToProfile("ExponentPushToken[abc123]");
    expect((supabase.from as jest.Mock)).not.toHaveBeenCalledWith("user_profiles");
  });
});
