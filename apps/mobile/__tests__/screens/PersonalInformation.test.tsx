import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Platform } from "react-native";
import { makeTranslator as mockMakeTranslator } from "../helpers/i18n";
import { displayNameFor, normalizePreferredName, validatePreferredName } from "@/lib/settings/displayName";

let mockLanguage: "en" | "es" = "en";
let mockMode: "light" | "dark" = "light";
const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
const mockPush = jest.fn();
const mockPickLibrary = jest.fn();
const mockPickCamera = jest.fn();
const mockCameraPermission = jest.fn();
const mockManipulate = jest.fn();
const mockApiGet = jest.fn();
const mockApiPatch = jest.fn();
const mockApiDelete = jest.fn();
let mockSessionEmail: string | null = "maria@hotel.com";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mockMakeTranslator(() => mockLanguage) }),
}));
jest.mock("@expo/vector-icons", () => ({
  Ionicons: ({ name }: { name: string }) => {
    const { Text } = require("react-native");
    return <Text>{name}</Text>;
  },
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("@/lib/theme/ThemeProvider", () => ({
  useThemeMode: () => mockMode,
  useAppearancePreference: () => ({ preference: "system", mode: mockMode, setPreference: jest.fn(), isHydrated: true }),
}));
jest.mock("@/i18n", () => ({
  get language() {
    return mockLanguage;
  },
  changeLanguage: jest.fn(),
}));
jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { version: "1.0.0" } } }));
jest.mock("@/lib/theme/useToast", () => ({ useToast: () => mockToast }));
jest.mock("expo-router", () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
}));
jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: (...a: unknown[]) => mockPickLibrary(...a),
  launchCameraAsync: (...a: unknown[]) => mockPickCamera(...a),
  requestCameraPermissionsAsync: () => mockCameraPermission(),
}));
jest.mock("expo-image-manipulator", () => ({
  manipulateAsync: (...a: unknown[]) => mockManipulate(...a),
  SaveFormat: { JPEG: "jpeg" },
}));
jest.mock("@/components/housekeeping/roomDetail/BottomSheet", () => ({
  BottomSheet: ({ visible, title, children, footer, testID }: any) => {
    const { View, Text } = require("react-native");
    return visible ? (
      <View testID={testID}>
        <Text accessibilityRole="header">{title}</Text>
        {children}
        {footer}
      </View>
    ) : null;
  },
}));
jest.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: { access_token: "tok", user: { email: mockSessionEmail } } } }),
    },
  },
}));
jest.mock("@/lib/api/client", () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return {
    ApiError,
    API_BASE: "https://api.test/v1",
    api: {
      get: (...a: unknown[]) => mockApiGet(...a),
      patch: (...a: unknown[]) => mockApiPatch(...a),
      delete: (...a: unknown[]) => mockApiDelete(...a),
    },
  };
});
jest.mock("@/stores/appStore", () => {
  const { create } = require("zustand");
  const useAppStore = create((set: any) => ({
    user: {
      id: "user-1",
      tenant_id: "hotel-1",
      full_name: "Maria Vega",
      role: "housekeeper",
      effective_role: "housekeeper",
      language_pref: "en",
    },
    isOnline: true,
    pendingActions: [],
    unreadCount: 0,
    flushQueue: jest.fn(),
    setUser: (user: unknown) => set({ user }),
  }));
  return { useAppStore };
});

import PersonalScreen from "@/app/(app)/profile/personal";
import SettingsHome from "@/app/(app)/profile";
import { ApiError } from "@/lib/api/client";
import { useAppStore } from "@/stores/appStore";

const PROFILE = {
  id: "user-1",
  full_name: "Maria Vega",
  preferred_name: null as string | null,
  email: "maria@hotel.com",
  role: "housekeeper",
  hotel_id: "hotel-1",
  hotel_name: "Fossil Creek Inn",
  avatar_url: null as string | null,
  has_uploaded_avatar: false,
};

const BASE_USER = {
  id: "user-1",
  tenant_id: "hotel-1",
  full_name: "Maria Vega",
  role: "housekeeper",
  effective_role: "housekeeper",
  language_pref: "en",
};

function routeGet(profile: typeof PROFILE | Error = PROFILE) {
  mockApiGet.mockImplementation((path: string) => {
    if (path === "/staff/me/profile") return profile instanceof Error ? Promise.reject(profile) : Promise.resolve({ data: profile });
    if (path.startsWith("/hotels/")) return Promise.resolve({ data: { name: "Fossil Creek Inn" } });
    return new Promise(() => {});
  });
}

const store = () => useAppStore as unknown as { getState: () => any; setState: (s: object) => void };

async function renderLoaded() {
  const utils = render(<PersonalScreen />);
  await waitFor(() => expect(utils.getByTestId("detail-email-value").props.children).toBe("maria@hotel.com"));
  return utils;
}

afterEach(async () => {
  // Let in-flight session/profile reads settle inside act() so they do not warn after the test.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

beforeEach(() => {
  mockLanguage = "en";
  mockMode = "light";
  mockSessionEmail = "maria@hotel.com";
  [mockToast.success, mockToast.error, mockToast.info, mockPush, mockPickLibrary, mockPickCamera, mockCameraPermission,
    mockManipulate, mockApiGet, mockApiPatch, mockApiDelete].forEach((m) => m.mockReset());
  store().setState({ user: { ...BASE_USER }, isOnline: true });
  mockCameraPermission.mockResolvedValue({ granted: true });
  routeGet();
});

describe("display-name rules", () => {
  it("prefers a non-empty preferred name, then full name, then nothing", () => {
    expect(displayNameFor({ preferred_name: " Mari ", full_name: "Maria Vega" })).toBe("Mari");
    expect(displayNameFor({ preferred_name: "   ", full_name: "Maria Vega" })).toBe("Maria Vega");
    expect(displayNameFor({ preferred_name: null, full_name: "Maria Vega" })).toBe("Maria Vega");
    expect(displayNameFor(null)).toBe("");
  });

  it("validates and normalises preferred names", () => {
    expect(normalizePreferredName("  Mari   Jo ")).toBe("Mari Jo");
    expect(validatePreferredName("   ")).toBe("empty");
    expect(validatePreferredName("x".repeat(41))).toBe("tooLong");
    expect(validatePreferredName("x".repeat(40))).toBeNull();
    expect(validatePreferredName("bad\u0007name")).toBe("invalid");
    expect(validatePreferredName("José María")).toBeNull();
  });
});

describe("Personal Information details", () => {
  it("shows real identity data from the server and is no longer a placeholder", async () => {
    const { getByTestId, queryByTestId, getByText } = await renderLoaded();
    expect(queryByTestId("settings-not-configured")).toBeNull();
    expect(getByTestId("settings-title").props.children).toBe("Personal Information");
    expect(getByTestId("detail-full-name-value").props.children).toBe("Maria Vega");
    expect(getByTestId("detail-display-name-value").props.children).toBe("Maria Vega");
    expect(getByTestId("detail-email-value").props.children).toBe("maria@hotel.com");
    expect(getByTestId("detail-role-value").props.children).toBe("Housekeeper");
    expect(getByTestId("detail-property-value").props.children).toBe("Fossil Creek Inn");
    expect(getByText(/managed by your hotel/i)).toBeTruthy();
  });

  it.each([
    ["housekeeper", "Housekeeper"],
    ["inspector", "Inspector"],
    ["engineer", "Engineer"],
    ["housekeeping_supervisor", "HK Supervisor"],
    ["front_desk", "Front Desk"],
    ["gm", "GM"],
  ])("works for the %s role and shows the effective role", async (role, label) => {
    store().setState({ user: { ...BASE_USER, role: "housekeeper", effective_role: role } });
    const { getByTestId } = await renderLoaded();
    expect(getByTestId("detail-role-value").props.children).toBe(label);
    expect(getByTestId("detail-display-name").props.accessibilityRole).toBe("button");
  });

  it("uses the preferred name for the display name and avatar initials, keeping full name separate", async () => {
    store().setState({ user: { ...BASE_USER, preferred_name: "Mari" } });
    routeGet({ ...PROFILE, preferred_name: "Mari" });
    const { getByTestId, getByText } = await renderLoaded();
    expect(getByTestId("detail-display-name-value").props.children).toBe("Mari");
    expect(getByTestId("detail-full-name-value").props.children).toBe("Maria Vega");
    expect(getByText("M")).toBeTruthy();
  });

  it("falls back to initials with no photo and shows the photo when there is one", async () => {
    const none = await renderLoaded();
    expect(none.getByText("MV")).toBeTruthy();
    expect(none.queryByTestId("avatar-image")).toBeNull();
    none.unmount();

    routeGet({ ...PROFILE, avatar_url: "https://signed.test/a.jpg", has_uploaded_avatar: true });
    const withPhoto = render(<PersonalScreen />);
    await waitFor(() => expect(withPhoto.getByTestId("avatar-image")).toBeTruthy());
  });

  it("keeps hotel-managed rows read-only: locked, not pressable, no edit chevron", async () => {
    const { getByTestId, queryByTestId } = await renderLoaded();
    for (const id of ["detail-full-name", "detail-email", "detail-role", "detail-property"]) {
      const row = getByTestId(id);
      expect(row.props.accessibilityRole).not.toBe("button");
      expect(row.props.accessibilityHint).toBe("Managed by your hotel");
      fireEvent.press(row);
    }
    expect(queryByTestId("edit-display-name")).toBeNull();
  });

  it("falls back to the session email and identity data when the profile cannot load, with retry", async () => {
    routeGet(new Error("network down"));
    const { getByTestId, getByText } = render(<PersonalScreen />);
    await waitFor(() => expect(getByTestId("personal-load-error")).toBeTruthy());
    expect(getByTestId("detail-email-value").props.children).toBe("maria@hotel.com");
    expect(getByTestId("detail-full-name-value").props.children).toBe("Maria Vega");
    expect(getByText("Some details could not be loaded.")).toBeTruthy();

    routeGet();
    fireEvent.press(getByTestId("personal-retry"));
    await waitFor(() => expect(getByTestId("detail-property-value").props.children).toBe("Fossil Creek Inn"));
  });

  it("renders in Spanish and in dark mode", async () => {
    mockLanguage = "es";
    mockMode = "dark";
    const { getByText, getByTestId } = render(<PersonalScreen />);
    await waitFor(() => expect(getByText("Propiedad asignada")).toBeTruthy());
    expect(getByTestId("settings-title").props.children).toBe("Información personal");
    expect(getByText("Nombre completo")).toBeTruthy();
    expect(getByText("Cambiar foto")).toBeTruthy();
  });

  it("exposes accessible labels for the photo and the editable row", async () => {
    const { getByTestId } = await renderLoaded();
    expect(getByTestId("photo-edit").props.accessibilityLabel).toBe("Profile photo. Double tap to change.");
    expect(getByTestId("photo-change").props.accessibilityLabel).toBe("Change photo");
    expect(getByTestId("detail-display-name").props.accessibilityLabel).toBe("Display name, Maria Vega");
  });
});

describe("Editing the display name", () => {
  async function openSheet() {
    const utils = await renderLoaded();
    fireEvent.press(utils.getByTestId("detail-display-name"));
    return utils;
  }

  it("opens pre-filled and closes with Cancel without any request", async () => {
    const { getByTestId, queryByTestId } = await openSheet();
    expect(getByTestId("edit-display-name-input").props.value).toBe("Maria Vega");
    fireEvent.press(getByTestId("edit-display-name-cancel"));
    expect(queryByTestId("edit-display-name")).toBeNull();
    expect(mockApiPatch).not.toHaveBeenCalled();
  });

  it("does not send a request when nothing changed", async () => {
    const { getByTestId } = await openSheet();
    expect(getByTestId("edit-display-name-save").props.accessibilityState?.disabled).toBe(true);
    fireEvent.press(getByTestId("edit-display-name-save"));
    expect(mockApiPatch).not.toHaveBeenCalled();
  });

  it("blocks empty and over-long names with a helpful message", async () => {
    const { getByTestId, getByText } = await openSheet();
    fireEvent.changeText(getByTestId("edit-display-name-input"), "   ");
    expect(getByText("Enter a display name.")).toBeTruthy();
    expect(getByTestId("edit-display-name-save").props.accessibilityState?.disabled).toBe(true);
    fireEvent.changeText(getByTestId("edit-display-name-input"), "x".repeat(45));
    expect(getByText("Display names can be up to 40 characters.")).toBeTruthy();
    fireEvent.press(getByTestId("edit-display-name-save"));
    expect(mockApiPatch).not.toHaveBeenCalled();
  });

  it("saves the trimmed name, then updates the store (preserving id, tenant, roles) and shows success", async () => {
    mockApiPatch.mockResolvedValue({ data: { ...PROFILE, preferred_name: "Mari" } });
    const { getByTestId, queryByTestId } = await openSheet();
    fireEvent.changeText(getByTestId("edit-display-name-input"), "  Mari  ");
    await act(async () => {
      fireEvent.press(getByTestId("edit-display-name-save"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mockApiPatch).toHaveBeenCalledWith("/staff/me/profile", { preferred_name: "Mari" });
    await waitFor(() => expect(queryByTestId("edit-display-name")).toBeNull());
    expect(mockToast.success).toHaveBeenCalledWith("Changes saved");
    expect(getByTestId("detail-display-name-value").props.children).toBe("Mari");
    expect(store().getState().user).toMatchObject({
      id: "user-1",
      tenant_id: "hotel-1",
      role: "housekeeper",
      effective_role: "housekeeper",
      full_name: "Maria Vega",
      preferred_name: "Mari",
    });
  });

  it("persists across a remount and the Settings identity card uses the new name", async () => {
    mockApiPatch.mockResolvedValue({ data: { ...PROFILE, preferred_name: "Mari" } });
    const first = await openSheet();
    fireEvent.changeText(first.getByTestId("edit-display-name-input"), "Mari");
    await act(async () => {
      fireEvent.press(first.getByTestId("edit-display-name-save"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => expect(store().getState().user.preferred_name).toBe("Mari"));
    first.unmount();

    routeGet({ ...PROFILE, preferred_name: "Mari" });
    const home = render(<SettingsHome />);
    expect(home.getByTestId("identity-name").props.children).toBe("Mari");
    await waitFor(() => expect(home.getByTestId("identity-hotel").props.children).toBe("Fossil Creek Inn"));
    home.unmount();
    const again = render(<PersonalScreen />);
    await waitFor(() => expect(again.getByTestId("detail-property-value").props.children).toBe("Fossil Creek Inn"));
    expect(again.getByTestId("detail-display-name-value").props.children).toBe("Mari");
  });

  it("keeps the typed input and shows a safe message when the save fails", async () => {
    mockApiPatch.mockRejectedValue(new ApiError("Traceback: boom at line 42", 500));
    const { getByTestId, getByText, queryByText } = await openSheet();
    fireEvent.changeText(getByTestId("edit-display-name-input"), "Mari");
    await act(async () => {
      fireEvent.press(getByTestId("edit-display-name-save"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => expect(getByText("Something went wrong on our side. Please try again.")).toBeTruthy());
    expect(queryByText(/Traceback/)).toBeNull();
    expect(getByTestId("edit-display-name-input").props.value).toBe("Mari");
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(store().getState().user.preferred_name).toBeUndefined();
  });

  it.each([
    [401, "Your session expired. Please sign in again."],
    [403, "You don't have permission to change that."],
    [422, "That value isn't allowed. Please check it and try again."],
  ])("maps a %s response to a friendly message", async (status, message) => {
    mockApiPatch.mockRejectedValue(new ApiError("raw", status));
    const { getByTestId, getByText } = await openSheet();
    fireEvent.changeText(getByTestId("edit-display-name-input"), "Mari");
    await act(async () => {
      fireEvent.press(getByTestId("edit-display-name-save"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => expect(getByText(message)).toBeTruthy());
  });

  it("treats a network failure as offline-style and keeps the sheet open", async () => {
    mockApiPatch.mockRejectedValue(new Error("Network request failed"));
    const { getByTestId, getByText } = await openSheet();
    fireEvent.changeText(getByTestId("edit-display-name-input"), "Mari");
    await act(async () => {
      fireEvent.press(getByTestId("edit-display-name-save"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() =>
      expect(getByText("Can't reach the server. Check your connection and try again.")).toBeTruthy(),
    );
    expect(getByTestId("edit-display-name")).toBeTruthy();
  });

  it("ignores repeated taps while a save is in flight", async () => {
    let resolve: (v: unknown) => void = () => undefined;
    mockApiPatch.mockReturnValue(new Promise((r) => (resolve = r)));
    const { getByTestId } = await openSheet();
    fireEvent.changeText(getByTestId("edit-display-name-input"), "Mari");
    await act(async () => {
      fireEvent.press(getByTestId("edit-display-name-save"));
      fireEvent.press(getByTestId("edit-display-name-save"));
      fireEvent.press(getByTestId("edit-display-name-save"));
    });
    expect(mockApiPatch).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ data: { ...PROFILE, preferred_name: "Mari" } }));
  });
});

describe("Profile photo", () => {
  const fetchMock = jest.fn();
  const originalOS = Platform.OS;
  // iOS waits for the sheet modal to finish dismissing before opening the picker; skip that delay here.
  beforeEach(() => {
    Platform.OS = "android";
    fetchMock.mockReset();
    (global as any).fetch = fetchMock;
    mockManipulate.mockResolvedValue({ uri: "file:///small.jpg" });
  });

  afterEach(() => {
    Platform.OS = originalOS;
  });

  async function openPhotoSheet(profile = PROFILE) {
    routeGet(profile);
    const utils = render(<PersonalScreen />);
    await waitFor(() => expect(utils.getByTestId("detail-email-value").props.children).toBe("maria@hotel.com"));
    fireEvent.press(utils.getByTestId("photo-change"));
    return utils;
  }

  it("offers library and camera, and only offers Remove when a photo was uploaded", async () => {
    const none = await openPhotoSheet();
    expect(none.getByTestId("photo-library")).toBeTruthy();
    expect(none.getByTestId("photo-camera")).toBeTruthy();
    expect(none.queryByTestId("photo-remove")).toBeNull();
    fireEvent.press(none.getByTestId("photo-cancel"));
    expect(none.queryByTestId("photo-actions")).toBeNull();
    none.unmount();

    const withPhoto = await openPhotoSheet({ ...PROFILE, avatar_url: "https://signed.test/a.jpg", has_uploaded_avatar: true });
    expect(withPhoto.getByTestId("photo-remove")).toBeTruthy();
  });

  it("resizes the picked image, uploads it, and shows the server-confirmed photo", async () => {
    mockPickLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: "file:///big.jpg" }] });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { ...PROFILE, avatar_url: "https://signed.test/new.jpg", has_uploaded_avatar: true } }),
    });
    const { getByTestId } = await openPhotoSheet();
    await act(async () => {
      fireEvent.press(getByTestId("photo-library"));
    });

    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Photo updated"));
    expect(mockManipulate).toHaveBeenCalledWith("file:///big.jpg", [{ resize: { width: 512 } }], expect.objectContaining({ format: "jpeg" }));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.test/v1/staff/me/avatar");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(init.body).toBeInstanceOf(FormData);
    await waitFor(() => expect(getByTestId("avatar-image")).toBeTruthy());
    expect(store().getState().user.avatar_url).toBe("https://signed.test/new.jpg");
  });

  it("does nothing when the picker is cancelled", async () => {
    mockPickLibrary.mockResolvedValue({ canceled: true, assets: null });
    const { getByTestId } = await openPhotoSheet();
    await act(async () => {
      fireEvent.press(getByTestId("photo-library"));
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it("explains a denied camera permission and never opens the camera", async () => {
    mockCameraPermission.mockResolvedValue({ granted: false });
    const { getByTestId } = await openPhotoSheet();
    await act(async () => {
      fireEvent.press(getByTestId("photo-camera"));
    });
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith(expect.stringMatching(/Camera access is off/)));
    expect(mockPickCamera).not.toHaveBeenCalled();
  });

  it.each([
    [413, "That photo is too large. Choose a smaller one."],
    [400, "That file isn't a supported photo. Use a JPG or PNG."],
    [500, "Something went wrong on our side. Please try again."],
  ])("reports an upload failure (%s) without showing success or changing the photo", async (status, message) => {
    mockPickLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: "file:///big.jpg" }] });
    fetchMock.mockResolvedValue({ ok: false, status, json: async () => ({ detail: "internal path /srv/x" }) });
    const { getByTestId, queryByTestId } = await openPhotoSheet();
    await act(async () => {
      fireEvent.press(getByTestId("photo-library"));
    });
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith(message));
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(queryByTestId("avatar-image")).toBeNull();
    expect(queryByTestId("photo-status")).toBeNull();
  });

  it("removes an uploaded photo and returns to initials", async () => {
    mockApiDelete.mockResolvedValue({ data: { ...PROFILE, avatar_url: null, has_uploaded_avatar: false } });
    const { getByTestId, queryByTestId } = await openPhotoSheet({
      ...PROFILE,
      avatar_url: "https://signed.test/a.jpg",
      has_uploaded_avatar: true,
    });
    fireEvent.press(getByTestId("photo-remove"));
    // Nothing is removed until the person confirms.
    expect(mockApiDelete).not.toHaveBeenCalled();
    expect(getByTestId("photo-remove-sheet")).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByTestId("photo-remove-confirm"));
    });
    expect(mockApiDelete).toHaveBeenCalledTimes(1);
    expect(mockApiDelete).toHaveBeenCalledWith("/staff/me/avatar");
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Photo removed"));
    expect(queryByTestId("avatar-image")).toBeNull();
  });

  it("keeps the photo when removal is not confirmed", async () => {
    const { getByTestId, queryByTestId } = await openPhotoSheet({
      ...PROFILE,
      avatar_url: "https://signed.test/a.jpg",
      has_uploaded_avatar: true,
    });
    fireEvent.press(getByTestId("photo-remove"));
    fireEvent.press(getByTestId("photo-remove-keep"));
    expect(getByTestId("photo-actions")).toBeTruthy();
    expect(queryByTestId("photo-remove-sheet")).toBeNull();
    expect(mockApiDelete).not.toHaveBeenCalled();
    expect(mockToast.success).not.toHaveBeenCalled();
  });
});

describe("Offline", () => {
  it("disables server-dependent edits, explains why, and still shows existing details", async () => {
    store().setState({ isOnline: false });
    const { getByTestId, getByText, queryByTestId } = await renderLoaded();
    expect(getByTestId("personal-offline")).toBeTruthy();
    expect(getByText("Connection required")).toBeTruthy();
    expect(getByTestId("detail-full-name-value").props.children).toBe("Maria Vega");

    fireEvent.press(getByTestId("detail-display-name"));
    fireEvent.press(getByTestId("photo-edit"));
    fireEvent.press(getByTestId("photo-change"));
    expect(queryByTestId("edit-display-name")).toBeNull();
    expect(queryByTestId("photo-actions")).toBeNull();
    expect(getByTestId("photo-change").props.accessibilityState).toEqual({ disabled: true });
    expect(mockApiPatch).not.toHaveBeenCalled();
  });
});
