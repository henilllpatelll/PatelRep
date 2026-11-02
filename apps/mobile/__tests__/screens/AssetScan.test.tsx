import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
  // The screen is focused for the whole test.
  useFocusEffect: (cb: () => void | (() => void)) => require("react").useEffect(cb, []),
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("@/lib/api/assets", () => ({ lookupAsset: jest.fn(), browseAssets: jest.fn() }));

let mockPermission: { granted: boolean; canAskAgain: boolean } | null = { granted: true, canAskAgain: true };
const mockRequest = jest.fn();
let mockOnScanned: ((e: { data: string }) => void) | undefined;
jest.mock("expo-camera", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    CameraView: (props: { onBarcodeScanned?: (e: { data: string }) => void }) => {
      mockOnScanned = props.onBarcodeScanned;
      return <View testID="camera-view" />;
    },
    useCameraPermissions: () => [mockPermission, mockRequest],
  };
});
let mockOnline = true;
jest.mock("@/stores/appStore", () => {
  const { makeAppStoreMock } = require("../helpers/appStoreMock");
  return { useAppStore: makeAppStoreMock(() => ({ isOnline: mockOnline, user: { id: "u1", role: "engineer", tenant_id: "h1" } })) };
});

import { Linking } from "react-native";
import { router } from "expo-router";
import { lookupAsset } from "@/lib/api/assets";
import ScanEquipmentScreen from "@/app/(app)/assets/scan";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { resetAssetBrowseCache } from "@/lib/engineering/useAssetBrowse";

const lookup = lookupAsset as jest.Mock;
const ID = "0b6f3a52-6a7c-4b1d-8d8e-1f2a3b4c5d6e";
const apiError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

const renderScreen = () =>
  render(
    <ThemeProvider>
      <ScanEquipmentScreen />
    </ThemeProvider>,
  );
const scan = async (data: string) => act(async () => mockOnScanned?.({ data }));

beforeEach(() => {
  jest.clearAllMocks();
  mockPermission = { granted: true, canAskAgain: true };
  mockOnline = true;
  mockOnScanned = undefined;
  resetAssetBrowseCache();
});

describe("Scan equipment", () => {
  it("opens the asset for a valid label and replaces the scanner so Back returns to the list", async () => {
    lookup.mockResolvedValue({ id: ID, name: "PTAC", asset_tag: "AC-312" });
    const screen = renderScreen();
    expect(screen.getByTestId("camera-view")).toBeTruthy();
    await scan(`patelrep:asset:v1:${ID}`);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: "/(app)/assets/[assetId]", params: { assetId: ID } }));
    expect(lookup).toHaveBeenCalledWith({ kind: "id", value: ID });
  });

  it("recognises a label generated for newly registered equipment (the versioned payload the label screen prints)", async () => {
    const { labelPayload } = require("@/lib/engineering/assetLabel");
    lookup.mockResolvedValue({ id: ID, name: "New chiller", asset_tag: null, is_active: true });
    renderScreen();
    await scan(labelPayload(ID));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: "/(app)/assets/[assetId]", params: { assetId: ID } }));
    expect(lookup).toHaveBeenCalledWith({ kind: "id", value: ID });
  });

  it("a label on retired equipment says it is retired and only opens the record when asked", async () => {
    lookup.mockResolvedValue({ id: ID, name: "Old chiller", asset_tag: "OLD-1", is_active: false });
    const screen = renderScreen();
    await scan("OLD-1");
    expect(await screen.findByText("assets.scan.outcome.retired")).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("asset-scan-open-retired"));
    expect(router.replace).toHaveBeenCalledWith({ pathname: "/(app)/assets/[assetId]", params: { assetId: ID } });
  });

  it("also accepts a plain asset-tag label", async () => {
    lookup.mockResolvedValue({ id: ID, name: "PTAC", asset_tag: "AC-312" });
    renderScreen();
    await scan("AC-312");
    await waitFor(() => expect(lookup).toHaveBeenCalledWith({ kind: "tag", value: "AC-312" }));
  });

  it("handles a burst of the same frame as one scan and navigates once", async () => {
    let release!: (v: unknown) => void;
    lookup.mockImplementation(() => new Promise((res) => (release = res)));
    renderScreen();
    await scan("AC-312");
    await scan("AC-312");
    await scan("AC-312");
    await scan("OTHER-1");
    expect(lookup).toHaveBeenCalledTimes(1);
    await act(async () => release({ id: ID, name: "PTAC" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1));
  });

  it("ignores a web address in a QR code without any request, and offers another scan", async () => {
    const screen = renderScreen();
    await scan("https://evil.example/asset/1");
    expect(lookup).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(await screen.findByText("assets.scan.outcome.invalid")).toBeTruthy();
    expect(screen.getByText("assets.scan.invalidHint")).toBeTruthy();
    fireEvent.press(screen.getByTestId("asset-scan-again"));
    expect(screen.getByTestId("camera-view")).toBeTruthy();
  });

  it("says plainly when the equipment isn't in this hotel, without saying whether it exists elsewhere", async () => {
    lookup.mockRejectedValue(apiError(404));
    const screen = renderScreen();
    await scan(ID);
    expect(await screen.findByText("assets.scan.outcome.not_found")).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("reports an ambiguous tag and a refused role as their own outcomes", async () => {
    lookup.mockRejectedValueOnce(apiError(409));
    const screen = renderScreen();
    await scan("DUP");
    expect(await screen.findByText("assets.scan.outcome.ambiguous")).toBeTruthy();
    fireEvent.press(screen.getByTestId("asset-scan-again"));
    lookup.mockRejectedValueOnce(apiError(403));
    await scan("OTHER");
    expect(await screen.findByText("assets.scan.outcome.forbidden")).toBeTruthy();
  });

  it("offline, an uncached asset needs a connection and no request is made", async () => {
    mockOnline = false;
    const screen = renderScreen();
    await scan("AC-999");
    expect(lookup).not.toHaveBeenCalled();
    expect(await screen.findByText("assets.scan.outcome.offline")).toBeTruthy();
  });

  it("offline, an asset this person already loaded in this hotel still opens", async () => {
    const browse = require("@/lib/api/assets").browseAssets as jest.Mock;
    browse.mockResolvedValue({ rows: [{ id: ID, name: "PTAC", asset_tag: "AC-312", service_status: "operational" }], hasMore: false, total: 1 });
    const { renderHook } = require("@testing-library/react-native");
    const { useAssetBrowse } = require("@/lib/engineering/useAssetBrowse");
    const { EMPTY_ASSET_FILTERS } = require("@/lib/engineering/assetModel");
    const seeded = renderHook(() => useAssetBrowse({ scope: "h1:u1", filters: EMPTY_ASSET_FILTERS, query: "", fetchPage: browse }));
    await waitFor(() => expect(seeded.result.current.rows).toHaveLength(1));

    mockOnline = false;
    renderScreen();
    await scan("AC-312");
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: "/(app)/assets/[assetId]", params: { assetId: ID } }));
    expect(lookup).not.toHaveBeenCalled();
  });

  it("manual entry resolves the same way and is always available", async () => {
    lookup.mockResolvedValue({ id: ID, name: "PTAC", asset_tag: "AC-312" });
    const screen = renderScreen();
    fireEvent.press(screen.getByTestId("asset-scan-manual-open"));
    expect(screen.queryByTestId("camera-view")).toBeNull();
    fireEvent.changeText(screen.getByTestId("asset-scan-input"), "AC-312");
    fireEvent.press(screen.getByTestId("asset-scan-find"));
    await waitFor(() => expect(lookup).toHaveBeenCalledWith({ kind: "tag", value: "AC-312" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
  });

  it("when camera permission is denied, explains why, offers to ask, and keeps manual entry working", async () => {
    mockPermission = { granted: false, canAskAgain: true };
    const screen = renderScreen();
    expect(screen.queryByTestId("camera-view")).toBeNull();
    expect(screen.getByTestId("asset-scan-denied")).toBeTruthy();
    fireEvent.press(screen.getByTestId("asset-scan-allow"));
    expect(mockRequest).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId("asset-scan-manual-open"));
    expect(screen.getByTestId("asset-scan-input")).toBeTruthy();
  });

  it("when permission is blocked for good, points to Settings", async () => {
    mockPermission = { granted: false, canAskAgain: false };
    const open = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
    const screen = renderScreen();
    fireEvent.press(screen.getByTestId("asset-scan-settings"));
    expect(open).toHaveBeenCalled();
  });

  it("can go back to the searchable list", () => {
    const screen = renderScreen();
    fireEvent.press(screen.getByTestId("asset-scan-search-list"));
    expect(router.replace).toHaveBeenCalledWith("/(app)/assets");
  });
});
