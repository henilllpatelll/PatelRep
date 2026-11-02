import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

const mockParams: { assetId?: string } = { assetId: "a1" };
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
  // The screen is focused for the whole test.
  useFocusEffect: (cb: () => void | (() => void)) => require("react").useEffect(cb, []),
  useLocalSearchParams: () => mockParams,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o && Object.keys(o).length > 0 && !("defaultValue" in o) ? `${k}:${Object.entries(o).map(([key, v]) => `${key}=${v}`).join(",")}` : k,
    i18n: { language: "en" },
  }),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@react-native-community/datetimepicker", () => ({ __esModule: true, default: () => null, DateTimePickerAndroid: { open: jest.fn() } }));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("@/lib/api/assets", () => ({
  createAsset: jest.fn(),
  updateAsset: jest.fn(),
  getAsset: jest.fn(),
  removeAssetPhoto: jest.fn(),
  listAssetCategories: jest.fn(),
}));
jest.mock("@/lib/api/assetPhoto", () => ({ uploadAssetPhoto: jest.fn() }));
jest.mock("@/lib/api/engineeringRooms", () => ({ fetchRoomBoard: jest.fn() }));
jest.mock("@/lib/housekeeping/photo", () => ({ pickPhoto: jest.fn(), prepareForUpload: jest.fn(async (uri: string) => uri) }));
let mockOnline = true;
let mockRole = "engineer";
jest.mock("@/stores/appStore", () => {
  const { makeAppStoreMock } = require("../helpers/appStoreMock");
  return { useAppStore: makeAppStoreMock(() => ({ isOnline: mockOnline, user: { id: "u1", role: mockRole, tenant_id: "h1" } })) };
});

import { router } from "expo-router";
import * as assetsApi from "@/lib/api/assets";
import { uploadAssetPhoto } from "@/lib/api/assetPhoto";
import { pickPhoto } from "@/lib/housekeeping/photo";
import RegisterAssetScreen from "@/app/(app)/assets/new";
import EditAssetScreen from "@/app/(app)/assets/edit/[assetId]";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { ToastProvider } from "@/lib/theme/ToastProvider";
import { resetAsyncResourceCache } from "@/lib/engineering/useAsyncResource";
import { takeAssetListStale } from "@/lib/engineering/useAssetBrowse";

const api = assetsApi as unknown as Record<string, jest.Mock>;
const CAT = "11111111-1111-4111-8111-111111111111";
const apiError = (status: number, code?: string, detail?: unknown) => Object.assign(new Error(`HTTP ${status}`), { status, code, detail });
const ASSET = {
  id: "a1", name: "PTAC Unit", asset_tag: "AC-312", category_id: CAT, room_id: "r312", location_text: null, manufacturer: "Amana", notes: null,
  criticality: "medium", row_version: 5, asset_categories: { name: "HVAC", code: "hvac" }, rooms: { room_number: "312", floor: 3 },
};

const wrap = (node: React.ReactNode) => (
  <ThemeProvider>
    <ToastProvider>{node}</ToastProvider>
  </ThemeProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  mockOnline = true;
  mockRole = "engineer";
  mockParams.assetId = "a1";
  resetAsyncResourceCache();
  takeAssetListStale();
  api.listAssetCategories.mockResolvedValue([{ id: CAT, name: "HVAC", code: "hvac" }]);
});

async function fillValid(screen: ReturnType<typeof render>) {
  await waitFor(() => expect(api.listAssetCategories).toHaveBeenCalled());
  fireEvent.changeText(screen.getByTestId("asset-form-name"), "Pool pump");
  fireEvent.press(screen.getByTestId("asset-form-category"));
  fireEvent.press(await screen.findByTestId(`asset-form-category-sheet-${CAT}`));
}

describe("Register Equipment", () => {
  it("only offers the form to roles the server lets register equipment", () => {
    mockRole = "front_desk";
    const screen = render(wrap(<RegisterAssetScreen />));
    expect(screen.getByTestId("asset-form-forbidden")).toBeTruthy();
    expect(screen.queryByTestId("asset-form")).toBeNull();
  });

  it("explains each missing required field and sends nothing", async () => {
    const screen = render(wrap(<RegisterAssetScreen />));
    fireEvent.press(screen.getByTestId("asset-form-submit"));
    expect(await screen.findByTestId("asset-form-name-error")).toBeTruthy();
    expect(screen.getByTestId("asset-form-category-error")).toBeTruthy();
    expect(api.createAsset).not.toHaveBeenCalled();
  });

  it("registers the equipment, then opens its own page - only after the server confirmed", async () => {
    let confirm!: (v: unknown) => void;
    api.createAsset.mockReturnValue(new Promise((res) => (confirm = res)));
    const screen = render(wrap(<RegisterAssetScreen />));
    await fillValid(screen);
    fireEvent.changeText(screen.getByTestId("asset-form-tag"), "PP-1");
    fireEvent.press(screen.getByTestId("asset-form-submit"));
    await waitFor(() => expect(api.createAsset).toHaveBeenCalledTimes(1));
    expect(api.createAsset.mock.calls[0][0]).toMatchObject({ name: "Pool pump", category_id: CAT, asset_tag: "PP-1", criticality: "medium", id: expect.any(String) });
    expect(router.replace).not.toHaveBeenCalled(); // nothing is claimed before the answer arrives
    await act(async () => confirm({ id: "new1", name: "Pool pump" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: "/(app)/assets/[assetId]", params: { assetId: "new1" } }));
    expect(takeAssetListStale()).toBe(true);
  });

  it("keeps everything typed and names the tag when it is already in use", async () => {
    api.createAsset.mockRejectedValue(apiError(409, "asset_tag_in_use"));
    const screen = render(wrap(<RegisterAssetScreen />));
    await fillValid(screen);
    fireEvent.changeText(screen.getByTestId("asset-form-tag"), "CH-1");
    fireEvent.press(screen.getByTestId("asset-form-submit"));
    expect(await screen.findByTestId("asset-form-tag-error")).toBeTruthy();
    expect(screen.getByTestId("asset-form-failure")).toBeTruthy();
    expect(screen.getByTestId("asset-form-name").props.value).toBe("Pool pump");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("offline, it says so and does not send", async () => {
    mockOnline = false;
    const screen = render(wrap(<RegisterAssetScreen />));
    await fillValid(screen);
    expect(screen.getByTestId("asset-form-offline")).toBeTruthy();
    fireEvent.press(screen.getByTestId("asset-form-submit"));
    expect(api.createAsset).not.toHaveBeenCalled();
  });

  it("asks before throwing typed work away, and leaves straight away when nothing was typed", async () => {
    const screen = render(wrap(<RegisterAssetScreen />));
    fireEvent.press(screen.getByTestId("asset-form-back"));
    expect(router.back).toHaveBeenCalledTimes(1);

    fireEvent.changeText(screen.getByTestId("asset-form-name"), "Pool pump");
    fireEvent.press(screen.getByTestId("asset-form-back"));
    expect(await screen.findByTestId("asset-form-discard-keep")).toBeTruthy();
    expect(router.back).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId("asset-form-discard-confirm"));
    expect(router.back).toHaveBeenCalledTimes(2);
  });

  it("when only the photo fails, says the equipment IS registered and retries just the photo", async () => {
    api.createAsset.mockResolvedValue({ id: "new1", name: "Pool pump", row_version: 1 });
    (pickPhoto as jest.Mock).mockResolvedValue({ ok: true, uri: "file:///p.jpg" });
    (uploadAssetPhoto as jest.Mock).mockRejectedValueOnce(new Error("Network request failed")).mockResolvedValueOnce({ id: "new1", row_version: 2 });
    const screen = render(wrap(<RegisterAssetScreen />));
    await fillValid(screen);
    await act(async () => fireEvent.press(screen.getByTestId("asset-photo-take")));
    expect(await screen.findByTestId("asset-photo-preview")).toBeTruthy();
    fireEvent.press(screen.getByTestId("asset-form-submit"));

    expect(await screen.findByTestId("asset-form-partial")).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("asset-form-retry-photo"));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: "/(app)/assets/[assetId]", params: { assetId: "new1" } }));
    expect(api.createAsset).toHaveBeenCalledTimes(1);
  });

  it("explains a refused camera permission without losing the form", async () => {
    (pickPhoto as jest.Mock).mockResolvedValue({ ok: false, reason: "permission_denied" });
    const screen = render(wrap(<RegisterAssetScreen />));
    fireEvent.changeText(screen.getByTestId("asset-form-name"), "Pool pump");
    await act(async () => fireEvent.press(screen.getByTestId("asset-photo-take")));
    expect(await screen.findByTestId("asset-photo-error")).toBeTruthy();
    expect(screen.getByTestId("asset-photo-settings")).toBeTruthy();
    expect(screen.getByTestId("asset-form-name").props.value).toBe("Pool pump");
  });
});

describe("Edit Equipment", () => {
  it("loads the real record, and has nothing to save until something changes", async () => {
    api.getAsset.mockResolvedValue(ASSET);
    const screen = render(wrap(<EditAssetScreen />));
    expect(await screen.findByTestId("asset-form")).toBeTruthy();
    expect(screen.getByTestId("asset-form-name").props.value).toBe("PTAC Unit");
    expect(screen.getByTestId("asset-form-tag").props.value).toBe("AC-312");
    expect(screen.getByTestId("asset-form-manufacturer").props.value).toBe("Amana");
    fireEvent.press(screen.getByTestId("asset-form-submit"));
    expect(api.updateAsset).not.toHaveBeenCalled();
  });

  it("saves only what changed, against the loaded version, then returns to the equipment", async () => {
    api.getAsset.mockResolvedValue(ASSET);
    api.updateAsset.mockResolvedValue({ ...ASSET, notes: "Serviced", row_version: 6 });
    const screen = render(wrap(<EditAssetScreen />));
    await screen.findByTestId("asset-form");
    fireEvent.changeText(screen.getByTestId("asset-form-notes"), "Serviced");
    fireEvent.press(screen.getByTestId("asset-form-submit"));
    await waitFor(() => expect(api.updateAsset).toHaveBeenCalledWith("a1", { notes: "Serviced", expected_row_version: 5 }));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(takeAssetListStale()).toBe(true);
  });

  it("shows the conflict choices instead of overwriting, and re-reads the record when asked", async () => {
    api.getAsset.mockResolvedValue(ASSET);
    api.updateAsset.mockRejectedValue(apiError(409, "asset_conflict", { current: { id: "a1" } }));
    const screen = render(wrap(<EditAssetScreen />));
    await screen.findByTestId("asset-form");
    fireEvent.changeText(screen.getByTestId("asset-form-notes"), "mine");
    fireEvent.press(screen.getByTestId("asset-form-submit"));
    expect(await screen.findByTestId("asset-form-conflict")).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
    api.getAsset.mockResolvedValue({ ...ASSET, row_version: 9 });
    fireEvent.press(screen.getByTestId("asset-form-conflict-mine"));
    await waitFor(() => expect(api.getAsset).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId("asset-form-conflict")).toBeNull());
    expect(screen.getByTestId("asset-form-notes").props.value).toBe("mine");
  });

  it("says plainly when the equipment is gone, and refuses roles that cannot edit", async () => {
    api.getAsset.mockRejectedValue(apiError(404));
    const gone = render(wrap(<EditAssetScreen />));
    expect(await gone.findByText("assets.detail.unavailableTitle")).toBeTruthy();
    gone.unmount();
    mockRole = "front_desk";
    const denied = render(wrap(<EditAssetScreen />));
    expect(denied.getByTestId("asset-form-forbidden")).toBeTruthy();
  });

  it("offline, it says editing needs a connection", async () => {
    mockOnline = false;
    api.getAsset.mockRejectedValue(new Error("Network request failed"));
    const screen = render(wrap(<EditAssetScreen />));
    expect(await screen.findByText("assets.form.offlineEdit")).toBeTruthy();
  });
});
