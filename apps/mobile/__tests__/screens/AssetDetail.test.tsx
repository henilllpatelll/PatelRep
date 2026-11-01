import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

const mockParams: { assetId?: string } = { assetId: "a1" };
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
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("@/lib/api/assets", () => ({
  getAsset: jest.fn(),
  getAssetPredictions: jest.fn(),
  getAssetMeters: jest.fn(),
  listAssetDowntime: jest.fn(),
  getAssetReliability: jest.fn(),
  listAssetDocuments: jest.fn(),
  getAssetDocumentUrl: jest.fn(),
  listMeterReadings: jest.fn(),
  recordMeterReading: jest.fn(),
  acknowledgePrediction: jest.fn(),
  createWorkOrderFromPrediction: jest.fn(),
}));
jest.mock("@/lib/api/workOrders", () => ({ listAssetWorkOrderPage: jest.fn(), createWorkOrder: jest.fn() }));
jest.mock("@/lib/api/pm", () => ({ listPmCompletions: jest.fn() }));
jest.mock("@/lib/housekeeping/useHotelTimezone", () => ({ useHotelTimezone: jest.fn() }));
let mockOnline = true;
let mockRole = "engineer";
jest.mock("@/stores/appStore", () => {
  const { makeAppStoreMock } = require("../helpers/appStoreMock");
  return {
    useAppStore: makeAppStoreMock(() => ({
      isOnline: mockOnline,
      hotelTimezone: "America/Chicago",
      user: { id: "u1", role: mockRole, tenant_id: "h1" },
    })),
  };
});

import { Linking } from "react-native";
import { router } from "expo-router";
import * as assetsApi from "@/lib/api/assets";
import { createWorkOrder, listAssetWorkOrderPage } from "@/lib/api/workOrders";
import { listPmCompletions } from "@/lib/api/pm";
import AssetDetailScreen from "@/app/(app)/assets/[assetId]";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { ToastProvider } from "@/lib/theme/ToastProvider";
import { resetAsyncResourceCache } from "@/lib/engineering/useAsyncResource";
import { resetAssetBrowseCache } from "@/lib/engineering/useAssetBrowse";

const api = assetsApi as unknown as Record<string, jest.Mock>;
const woPage = listAssetWorkOrderPage as jest.Mock;
const apiError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
/** The text matcher is a full match for strings; these assertions mean "contains". */
const has = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

const ASSET = {
  id: "a1",
  name: "PTAC Unit",
  asset_tag: "AC-312",
  room_id: "r312",
  location_text: null,
  manufacturer: "Amana",
  model: "PTH153",
  serial_number: "SN-9981",
  installation_date: "2022-03-01",
  warranty_expires: "2030-03-01",
  asset_categories: { name: "HVAC", code: "HVAC" },
  rooms: { room_number: "312" },
  active_downtime: null,
  service_status: "operational",
  active_work_order_count: 0,
  repeat_repairs_90d: 0,
  pm_schedules: [],
};

const wo = (id: string, over: Record<string, unknown> = {}) => ({ id, title: `Job ${id}`, status: "open", priority: "normal", created_at: iso(-2), ...over });

function serve(over: { asset?: unknown; active?: unknown[]; completed?: unknown[]; meters?: unknown[]; predictions?: unknown[]; docs?: unknown[]; pm?: unknown[] } = {}) {
  api.getAsset.mockResolvedValue({ ...ASSET, ...(over.asset as object) });
  api.getAssetPredictions.mockResolvedValue(over.predictions ?? []);
  api.getAssetMeters.mockResolvedValue(over.meters ?? []);
  api.listAssetDowntime.mockResolvedValue([]);
  api.getAssetReliability.mockResolvedValue({});
  api.listAssetDocuments.mockResolvedValue(over.docs ?? []);
  api.listMeterReadings.mockResolvedValue([]);
  woPage.mockImplementation(async (_id: string, kind: string) => ({ orders: kind === "active" ? over.active ?? [] : over.completed ?? [], hasMore: false }));
  (listPmCompletions as jest.Mock).mockResolvedValue({ rows: over.pm ?? [], hasMore: false });
}

const renderScreen = () =>
  render(
    <ThemeProvider>
      <ToastProvider>
        <AssetDetailScreen />
      </ToastProvider>
    </ThemeProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockParams.assetId = "a1";
  mockOnline = true;
  mockRole = "engineer";
  resetAsyncResourceCache();
  resetAssetBrowseCache();
});

describe("Asset detail: overview", () => {
  it("shows the equipment's own facts and omits the ones it doesn't have", async () => {
    serve({ asset: { serial_number: null, manufacturer: null } });
    const screen = renderScreen();
    expect(await screen.findByTestId("asset-detail-title")).toHaveTextContent(has("PTAC Unit"));
    expect(screen.getByTestId("asset-detail-status")).toBeTruthy();
    const specs = screen.getByTestId("asset-specs");
    expect(specs).toHaveTextContent(has("AC-312"));
    expect(specs).toHaveTextContent(has("PTH153"));
    expect(specs).not.toHaveTextContent(has("assets.detail.serial"));
    expect(specs).not.toHaveTextContent(has("assets.detail.manufacturer"));
  });

  it("shows manufacturer, model and serial when they exist", async () => {
    serve();
    const screen = renderScreen();
    const specs = await screen.findByTestId("asset-specs");
    for (const text of ["Amana", "PTH153", "SN-9981"]) expect(specs).toHaveTextContent(has(text));
  });

  it("keeps service status, repairs, planned maintenance, downtime and reliability as separate facts", async () => {
    serve({
      asset: { service_status: "under_repair", active_work_order_count: 1, active_downtime: { id: "d1", started_at: iso(-1), impact_level: "degraded" } },
      predictions: [{ id: "p1", asset_id: "a1", risk_score: 80, recommendation: "Inspect compressor", generated_at: iso(-1), is_acknowledged: false }],
    });
    const screen = renderScreen();
    const panel = await screen.findByTestId("asset-status-panel");
    for (const key of ["assets.detail.operational", "assets.detail.activeRepairs", "assets.detail.plannedMaintenance", "assets.detail.downtime", "assets.detail.reliability"]) {
      expect(panel).toHaveTextContent(has(key));
    }
    expect(screen.getByTestId("asset-detail-status")).toHaveTextContent(has("assets.status.under_repair"));
  });

  it("says an asset is unavailable when the server has no such asset here (404), and does not guess", async () => {
    serve();
    api.getAsset.mockRejectedValue(apiError(404));
    const screen = renderScreen();
    expect(await screen.findByTestId("asset-unavailable")).toBeTruthy();
    expect(screen.getByText("assets.detail.unavailableTitle")).toBeTruthy();
  });

  it("shows a refused role as a permission state", async () => {
    serve();
    api.getAsset.mockRejectedValue(apiError(403));
    const screen = renderScreen();
    expect(await screen.findByText("engineeringState.forbidden")).toBeTruthy();
  });

  it("offline and never opened: says a connection is needed instead of an empty record", async () => {
    serve();
    api.getAsset.mockRejectedValue(new Error("Network request failed"));
    const screen = renderScreen();
    expect(await screen.findByText("assets.detail.offlineUncached")).toBeTruthy();
  });
});

describe("Asset detail: create work order", () => {
  it("opens the shared report form with this equipment and its room already chosen", async () => {
    serve();
    const screen = renderScreen();
    fireEvent.press(await screen.findByTestId("asset-create-wo"));
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/(app)/work-orders/new",
      params: expect.objectContaining({ from: "asset", assetId: "a1", assetName: "PTAC Unit", assetRoomId: "r312", assetRoomNumber: "312" }),
    });
    expect(createWorkOrder).not.toHaveBeenCalled();
  });

  it("opens the room this equipment is registered to", async () => {
    serve();
    const screen = renderScreen();
    fireEvent.press(await screen.findByTestId("asset-action-room"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/(app)/room-status/[roomId]", params: { roomId: "r312" } });
  });

  it("is off, with the reason, when there is no connection", async () => {
    serve();
    mockOnline = false;
    const screen = renderScreen();
    await screen.findByTestId("asset-create-offline");
    expect(screen.getByTestId("asset-create-wo").props.accessibilityState).toMatchObject({ disabled: true });
  });
});
