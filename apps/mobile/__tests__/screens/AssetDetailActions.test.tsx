import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

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
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
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
  retireAsset: jest.fn(),
}));
jest.mock("@/lib/api/workOrders", () => ({ listAssetWorkOrderPage: jest.fn(), createWorkOrder: jest.fn() }));
jest.mock("@/lib/api/pm", () => ({ listPmCompletions: jest.fn() }));
jest.mock("@/lib/housekeeping/useHotelTimezone", () => ({ useHotelTimezone: jest.fn() }));
let mockRole = "engineer";
let mockOnline = true;
jest.mock("@/stores/appStore", () => {
  const { makeAppStoreMock } = require("../helpers/appStoreMock");
  return { useAppStore: makeAppStoreMock(() => ({ isOnline: mockOnline, hotelTimezone: "America/Chicago", user: { id: "u1", role: mockRole, tenant_id: "h1" } })) };
});

import { router } from "expo-router";
import * as assetsApi from "@/lib/api/assets";
import { listAssetWorkOrderPage } from "@/lib/api/workOrders";
import { listPmCompletions } from "@/lib/api/pm";
import AssetDetailScreen from "@/app/(app)/assets/[assetId]";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { ToastProvider } from "@/lib/theme/ToastProvider";
import { resetAsyncResourceCache } from "@/lib/engineering/useAsyncResource";
import { resetAssetBrowseCache, takeAssetListStale } from "@/lib/engineering/useAssetBrowse";

const api = assetsApi as unknown as Record<string, jest.Mock>;
const apiError = (status: number, code?: string) => Object.assign(new Error(`HTTP ${status}`), { status, code });
const ASSET = {
  id: "a1", name: "PTAC Unit", asset_tag: "AC-312", room_id: "r312", location_text: null, row_version: 4, criticality: "high",
  asset_categories: { name: "HVAC", code: "HVAC" }, rooms: { room_number: "312" }, active_downtime: null, service_status: "operational",
  active_work_order_count: 0, repeat_repairs_90d: 0, pm_schedules: [], is_active: true,
};

function serve(over: Record<string, unknown> = {}) {
  api.getAsset.mockResolvedValue({ ...ASSET, ...over });
  api.getAssetPredictions.mockResolvedValue([]);
  api.getAssetMeters.mockResolvedValue([]);
  api.listAssetDowntime.mockResolvedValue([]);
  api.getAssetReliability.mockResolvedValue({});
  api.listAssetDocuments.mockResolvedValue([]);
  api.listMeterReadings.mockResolvedValue([]);
  (listAssetWorkOrderPage as jest.Mock).mockResolvedValue({ orders: [], hasMore: false });
  (listPmCompletions as jest.Mock).mockResolvedValue({ rows: [], hasMore: false });
}

const renderScreen = () =>
  render(
    <ThemeProvider>
      <ToastProvider>
        <AssetDetailScreen />
      </ToastProvider>
    </ThemeProvider>,
  );

async function openMore(screen: ReturnType<typeof render>) {
  await screen.findByTestId("asset-overview");
  fireEvent.press(screen.getByTestId("asset-action-more"));
}

beforeEach(() => {
  jest.clearAllMocks();
  resetAsyncResourceCache();
  resetAssetBrowseCache();
  mockRole = "engineer";
  mockOnline = true;
  mockParams.assetId = "a1";
  serve();
});

describe("equipment actions on the detail screen", () => {
  it("a line engineer can edit, see the QR label and scan - but is not offered Retire", async () => {
    const screen = renderScreen();
    await openMore(screen);
    expect(screen.getByTestId("asset-action-edit")).toBeTruthy();
    expect(screen.getByTestId("asset-action-label")).toBeTruthy();
    expect(screen.getByTestId("asset-action-scan")).toBeTruthy();
    expect(screen.queryByTestId("asset-action-retire")).toBeNull();
  });

  it("Report issue stays the main action, ahead of the administrative ones", async () => {
    const screen = renderScreen();
    await screen.findByTestId("asset-overview");
    expect(screen.getByTestId("asset-create-wo")).toBeTruthy();
    expect(screen.queryByTestId("asset-action-edit")).toBeNull(); // administrative actions live in More
  });

  it("opens the exact edit and label screens for this equipment", async () => {
    const screen = renderScreen();
    await openMore(screen);
    fireEvent.press(screen.getByTestId("asset-action-edit"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/(app)/assets/edit/[assetId]", params: { assetId: "a1" } });
    fireEvent.press(screen.getByTestId("asset-action-more"));
    fireEvent.press(screen.getByTestId("asset-action-label"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/(app)/assets/label/[assetId]", params: { assetId: "a1" } });
  });

  it("roles that cannot manage equipment get no Edit, but can still view the label", async () => {
    mockRole = "housekeeping_supervisor";
    const screen = renderScreen();
    await openMore(screen);
    expect(screen.queryByTestId("asset-action-edit")).toBeNull();
    expect(screen.getByTestId("asset-action-label")).toBeTruthy();
  });

  it("shows the identity photo and the criticality when the record has them", async () => {
    serve({ photo_url: "https://signed.example/photo.jpg" });
    const screen = renderScreen();
    await screen.findByTestId("asset-overview");
    expect(screen.getByTestId("asset-photo").props.source).toEqual({ uri: "https://signed.example/photo.jpg" });
    expect(screen.getByText("assets.criticality.high")).toBeTruthy();
  });

  it("marks retired equipment, and stops offering new work against it", async () => {
    serve({ is_active: false, administrative_status: "inactive" });
    const screen = renderScreen();
    expect(await screen.findByTestId("asset-retired-banner")).toBeTruthy();
    expect(screen.getByTestId("asset-create-wo").props.accessibilityState?.disabled).toBe(true);
    expect(screen.queryByTestId("asset-action-reading")).toBeNull();
  });
});

describe("retiring equipment", () => {
  it("is offered to a chief engineer and needs a reason and a confirmation", async () => {
    mockRole = "chief_engineer";
    api.retireAsset.mockResolvedValue({ ...ASSET, is_active: false });
    const screen = renderScreen();
    await openMore(screen);
    fireEvent.press(screen.getByTestId("asset-action-retire"));
    expect(screen.getByTestId("asset-retire-continue").props.accessibilityState?.disabled).toBe(true);
    fireEvent.changeText(screen.getByTestId("asset-retire-reason"), "Replaced by new unit");
    fireEvent.press(screen.getByTestId("asset-retire-continue"));
    expect(api.retireAsset).not.toHaveBeenCalled(); // a confirmation step comes first
    fireEvent.press(await screen.findByTestId("asset-retire-confirm"));
    await waitFor(() => expect(api.retireAsset).toHaveBeenCalledWith("a1", "Replaced by new unit", 4));
    await waitFor(() => expect(takeAssetListStale()).toBe(true));
  });

  it("explains a refusal for open repairs and does not claim it was retired", async () => {
    mockRole = "gm";
    api.retireAsset.mockRejectedValue(apiError(409, "asset_has_open_work_orders"));
    const screen = renderScreen();
    await openMore(screen);
    fireEvent.press(screen.getByTestId("asset-action-retire"));
    fireEvent.changeText(screen.getByTestId("asset-retire-reason"), "Removed from service");
    fireEvent.press(screen.getByTestId("asset-retire-continue"));
    await act(async () => fireEvent.press(await screen.findByTestId("asset-retire-confirm")));
    expect(await screen.findByText("assets.retire.failure.asset_has_open_work_orders")).toBeTruthy();
    expect(takeAssetListStale()).toBe(false);
  });
});

describe("asset maintenance links to the exact PM schedule", () => {
  const SCHEDULE = { id: "s-77", name: "Quarterly belt check", interval_type: "quarterly", next_due_at: new Date(Date.now() + 20 * 86_400_000).toISOString(), last_completed_at: null, estimated_minutes: 45, is_active: true };

  it("lists the real schedules with name, due status, frequency and estimate, and opens that schedule - not the PM tab", async () => {
    serve({ pm_schedules: [SCHEDULE] });
    const screen = renderScreen();
    await screen.findByTestId("asset-overview");
    fireEvent.press(screen.getByTestId("asset-section-maintenance"));
    expect(await screen.findByTestId("asset-pm-s-77")).toBeTruthy();
    expect(screen.getByText("Quarterly belt check")).toBeTruthy();
    expect(screen.getByText("pmSchedules.minutes:count=45")).toBeTruthy();
    fireEvent.press(screen.getByTestId("asset-pm-open-s-77"));
    expect(router.push).toHaveBeenCalledWith("/(app)/pm-schedules/s-77");
  });

  it("invents no schedule for equipment that has none", async () => {
    serve({ pm_schedules: [] });
    const screen = renderScreen();
    await screen.findByTestId("asset-overview");
    fireEvent.press(screen.getByTestId("asset-section-maintenance"));
    await waitFor(() => expect(screen.queryByTestId(/^asset-pm-s-/)).toBeNull());
    expect(screen.queryByTestId("asset-pm-open-s-77")).toBeNull();
  });
});
