import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

const mockParams: { assetId?: string } = { assetId: "0b6f3a52-6a7c-4b1d-8d8e-1f2a3b4c5d6e" };
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
  useFocusEffect: jest.fn(),
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
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("@/lib/api/assets", () => ({ getAsset: jest.fn() }));
jest.mock("@/lib/settings/useSettingsIdentity", () => ({ useSettingsIdentity: () => ({ hotelName: "Fossil Creek Inn" }) }));
jest.mock("@/lib/engineering/assetLabelActions", () => ({ printLabel: jest.fn(), shareLabel: jest.fn() }));
const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
jest.mock("@/lib/theme/useToast", () => ({ useToast: () => mockToast }));
jest.mock("@/stores/appStore", () => {
  const { makeAppStoreMock } = require("../helpers/appStoreMock");
  return { useAppStore: makeAppStoreMock(() => ({ isOnline: true, user: { id: "u1", role: "engineer", tenant_id: "h1" } })) };
});

import { router } from "expo-router";
import { getAsset } from "@/lib/api/assets";
import { printLabel, shareLabel } from "@/lib/engineering/assetLabelActions";
import AssetLabelScreen from "@/app/(app)/assets/label/[assetId]";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { ToastProvider } from "@/lib/theme/ToastProvider";
import { resetAsyncResourceCache } from "@/lib/engineering/useAsyncResource";

const ID = "0b6f3a52-6a7c-4b1d-8d8e-1f2a3b4c5d6e";
const ASSET = { id: ID, name: "PTAC Unit", asset_tag: "AC-312", room_id: "r1", location_text: null, rooms: { room_number: "312" }, is_active: true };
const get = getAsset as jest.Mock;
const apiError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
const renderScreen = () =>
  render(
    <ThemeProvider>
      <ToastProvider>
        <AssetLabelScreen />
      </ToastProvider>
    </ThemeProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockToast.error.mockClear();
  resetAsyncResourceCache();
  mockParams.assetId = ID;
});

describe("Equipment QR label", () => {
  it("shows the equipment name, tag, location, property and a QR code", async () => {
    get.mockResolvedValue(ASSET);
    const screen = renderScreen();
    expect(await screen.findByTestId("asset-label-card")).toBeTruthy();
    expect(screen.getByTestId("asset-label-name").props.children).toBe("PTAC Unit");
    expect(screen.getByTestId("asset-label-code").props.children).toBe("AC-312");
    expect(screen.getByTestId("asset-label-qr")).toBeTruthy();
    expect(screen.getByText("Fossil Creek Inn")).toBeTruthy();
    expect(screen.getByText("assets.roomLabel:room=312")).toBeTruthy();
  });

  it("falls back to a short code when there is no tag, and says so", async () => {
    get.mockResolvedValue({ ...ASSET, asset_tag: null });
    const screen = renderScreen();
    await screen.findByTestId("asset-label-card");
    expect(screen.getByTestId("asset-label-code").props.children).toBe("0B6F3A52");
    expect(screen.getByText("assets.label.noTagNote")).toBeTruthy();
  });

  it("hands the label to the system print dialog and share sheet - and reports neither as done", async () => {
    get.mockResolvedValue(ASSET);
    (printLabel as jest.Mock).mockResolvedValue("opened");
    (shareLabel as jest.Mock).mockResolvedValue("opened");
    const screen = renderScreen();
    await screen.findByTestId("asset-label-card");
    await act(async () => fireEvent.press(screen.getByTestId("asset-label-print")));
    await act(async () => fireEvent.press(screen.getByTestId("asset-label-share")));
    expect(printLabel).toHaveBeenCalledWith(expect.objectContaining({ assetId: ID, assetTag: "AC-312", name: "PTAC Unit" }));
    expect(shareLabel).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/printed|sent|shared successfully/i)).toBeNull();
    expect(screen.getByText("assets.label.handoffNote")).toBeTruthy();
  });

  it("tells the person when printing or sharing could not even be opened", async () => {
    get.mockResolvedValue(ASSET);
    (printLabel as jest.Mock).mockRejectedValue(new Error("no printer service"));
    (shareLabel as jest.Mock).mockResolvedValue("unavailable");
    const screen = renderScreen();
    await screen.findByTestId("asset-label-card");
    await act(async () => fireEvent.press(screen.getByTestId("asset-label-print")));
    expect(mockToast.error).toHaveBeenLastCalledWith("assets.label.printFailed");
    await act(async () => fireEvent.press(screen.getByTestId("asset-label-share")));
    expect(mockToast.error).toHaveBeenLastCalledWith("assets.label.shareUnavailable");
  });

  it("marks a retired unit's label, and returns to the equipment", async () => {
    get.mockResolvedValue({ ...ASSET, is_active: false });
    const screen = renderScreen();
    await screen.findByTestId("asset-label-card");
    expect(screen.getByText("assets.label.retiredNote")).toBeTruthy();
    fireEvent.press(screen.getByTestId("asset-label-done"));
    expect(router.back).toHaveBeenCalled();
  });

  it("shows an unavailable state for equipment that isn't in this property", async () => {
    get.mockRejectedValue(apiError(404));
    const screen = renderScreen();
    await waitFor(() => expect(screen.getByTestId("asset-label-unavailable")).toBeTruthy());
    expect(screen.queryByTestId("asset-label-qr")).toBeNull();
  });
});
