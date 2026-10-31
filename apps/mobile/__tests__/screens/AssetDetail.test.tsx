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
  it("links the new order to this asset by canonical id and lands on its work orders", async () => {
    serve();
    (createWorkOrder as jest.Mock).mockResolvedValue("wo-new");
    const screen = renderScreen();
    fireEvent.press(await screen.findByTestId("asset-create-wo"));
    expect(await screen.findByTestId("create-wo-asset")).toHaveTextContent(has("PTAC Unit"));
    fireEvent.changeText(screen.getByPlaceholderText("workOrders.whatNeedsFixing"), "No cooling");
    fireEvent.press(screen.getByText("Create Work Order"));
    await waitFor(() => expect(createWorkOrder).toHaveBeenCalledTimes(1));
    expect(createWorkOrder).toHaveBeenCalledWith(
      expect.objectContaining({ asset_id: "a1", room_id: "r312", title: "No cooling", category: "hvac", client_request_id: expect.any(String) }),
    );
    await waitFor(() => expect(screen.getByTestId("asset-work-orders")).toBeTruthy());
  });

  it("is off, with the reason, when there is no connection", async () => {
    serve();
    mockOnline = false;
    const screen = renderScreen();
    await screen.findByTestId("asset-create-offline");
    expect(screen.getByTestId("asset-create-wo").props.accessibilityState).toMatchObject({ disabled: true });
  });
});

describe("Asset detail: work orders", () => {
  it("lists active repairs and opens the Repair Workspace", async () => {
    serve({ active: [wo("w1", { status: "in_progress", priority: "urgent", assigned_to_name: "Eli" })] });
    const screen = renderScreen();
    fireEvent.press(await screen.findByTestId("asset-section-workOrders"));
    fireEvent.press(await screen.findByTestId("asset-wo-w1"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/(app)/work-orders/[woId]", params: { woId: "w1" } });
  });

  it("shows completed history with the resolution, and pages it", async () => {
    serve();
    const first = Array.from({ length: 10 }, (_, i) => wo(`c${i}`, { status: "completed", completed_at: iso(-i - 1), resolution_code: { label: "Replaced capacitor" } }));
    woPage.mockImplementation(async (_id: string, kind: string, page: number) =>
      kind === "active"
        ? { orders: [], hasMore: false }
        : page === 1
          ? { orders: first, hasMore: true }
          : { orders: [wo("c10", { status: "completed", completed_at: iso(-30) }), first[0]], hasMore: false },
    );
    const screen = renderScreen();
    fireEvent.press(await screen.findByTestId("asset-section-workOrders"));
    fireEvent.press(await screen.findByTestId("asset-wo-kind-completed"));
    expect(await screen.findByTestId("asset-wo-c0")).toHaveTextContent(has("Replaced capacitor"));
    fireEvent.press(screen.getByTestId("asset-wo-more"));
    await screen.findByTestId("asset-wo-c10");
    expect(screen.getAllByTestId("asset-wo-c0")).toHaveLength(1);
  });

  it("explains an engineer's scoped list and a clean empty state", async () => {
    serve();
    const screen = renderScreen();
    fireEvent.press(await screen.findByTestId("asset-section-workOrders"));
    expect(await screen.findByText("assets.workOrders.noActive")).toBeTruthy();
    expect(screen.getByTestId("asset-wo-scope")).toBeTruthy();
  });

  it("states the 90-day repeat count only when the API supplied it", async () => {
    serve({ asset: { repeat_repairs_90d: 3 } });
    const screen = renderScreen();
    fireEvent.press(await screen.findByTestId("asset-section-workOrders"));
    expect(await screen.findByTestId("asset-repeat-note")).toHaveTextContent(has("count=3"));
  });

  it("shows a failed history read as an error with Retry, not as 'no work orders'", async () => {
    serve();
    woPage.mockRejectedValue(apiError(500));
    const screen = renderScreen();
    fireEvent.press(await screen.findByTestId("asset-section-workOrders"));
    expect(await screen.findByText("common.retry")).toBeTruthy();
    expect(screen.queryByText("assets.workOrders.noActive")).toBeNull();
  });
});

describe("Asset detail: maintenance", () => {
  it("shows PM schedules with the Phase 5 due rules and opens the schedule (never completes from here)", async () => {
    serve({ asset: { pm_schedules: [{ id: "s1", name: "Quarterly service", interval_type: "quarterly", next_due_at: iso(-3), last_completed_at: iso(-90), is_active: true }] } });
    const screen = renderScreen();
    fireEvent.press(await screen.findByTestId("asset-section-maintenance"));
    const row = await screen.findByTestId("asset-pm-s1");
    expect(row).toHaveTextContent(has("Quarterly service"));
    expect(row).toHaveTextContent(has("pm.overdueBy"));
    fireEvent.press(screen.getByTestId("asset-pm-open-s1"));
    expect(router.push).toHaveBeenCalledWith("/(app)/pm-schedules/s1");
  });

  it("says plainly when there is no schedule and invents none", async () => {
    serve();
    const screen = renderScreen();
    fireEvent.press(await screen.findByTestId("asset-section-maintenance"));
    expect(await screen.findByTestId("asset-no-pm")).toBeTruthy();
  });

  it("shows inspection history with failed items and opens the record", async () => {
    serve({ pm: [{ id: "c1", pm_schedule_id: "s1", schedule_name: "Quarterly service", completed_at: iso(-5), technician_name: "Eli", passed_count: 8, failed_count: 2, not_applicable_count: 0 }] });
    const screen = renderScreen();
    fireEvent.press(await screen.findByTestId("asset-section-maintenance"));
    const record = await screen.findByTestId("asset-pm-record-c1");
    expect(record).toHaveTextContent(has("assets.maintenance.failed:count=2"));
    fireEvent.press(record);
    expect(router.push).toHaveBeenCalledWith("/(app)/pm-schedules/record/c1?scheduleId=s1");
  });
});

describe("Asset detail: readings", () => {
  const meter = { id: "m1", name: "Runtime", meter_type: "runtime_hours", unit: "hours", is_active: true, latest_reading: { id: "r9", value: 4280, recorded_at: iso(-2), status_at_recording: "normal" } };

  it("shows the latest value with the server's recorded status, and no invented 'safe' label", async () => {
    serve({ meters: [meter] });
    const screen = renderScreen();
    fireEvent.press(await screen.findByTestId("asset-section-readings"));
    const card = await screen.findByTestId("asset-meter-m1");
    expect(card).toHaveTextContent(has("4,280 hours"));
    expect(card).toHaveTextContent(has("assets.readings.recorded.normal"));
    expect(card).not.toHaveTextContent(/safe/i);
  });

  it("states that no meters exist rather than showing an empty chart", async () => {
    serve();
    const screen = renderScreen();
    fireEvent.press(await screen.findByTestId("asset-section-readings"));
    expect(await screen.findByTestId("asset-no-meters")).toBeTruthy();
  });

  it("records a reading through the sheet and refreshes only after the server confirms it", async () => {
    serve({ meters: [meter] });
    api.recordMeterReading.mockResolvedValue({ id: "r10", value: 4300, recorded_at: iso(0) });
    const screen = renderScreen();
    fireEvent.press(await screen.findByTestId("asset-section-readings"));
    fireEvent.press(await screen.findByTestId("asset-record-m1"));
    fireEvent.changeText(await screen.findByTestId("reading-value"), "4300");
    fireEvent.press(screen.getByTestId("reading-save"));
    await waitFor(() => expect(api.recordMeterReading).toHaveBeenCalledWith("m1", { value: 4300, notes: "" }));
    await waitFor(() => expect(api.getAssetMeters.mock.calls.length).toBeGreaterThan(1));
  });

  it("hides recording from a role that may not record", async () => {
    mockRole = "housekeeper";
    serve({ meters: [meter] });
    const screen = renderScreen();
    fireEvent.press(await screen.findByTestId("asset-section-readings"));
    await screen.findByTestId("asset-meter-m1");
    expect(screen.queryByTestId("asset-record-m1")).toBeNull();
  });
});

describe("Asset detail: history and documents", () => {
  it("loads history lazily, only once the section is opened", async () => {
    serve();
    const screen = renderScreen();
    await screen.findByTestId("asset-detail-title");
    expect(api.listAssetDocuments).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("asset-section-history"));
    await waitFor(() => expect(api.listAssetDocuments).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId("asset-no-documents")).toBeTruthy();
  });

  it("opens a document through a short-lived signed link fetched at the moment of opening", async () => {
    serve({ docs: [{ id: "d1", label: "Warranty certificate", evidence_type: "external_certificate", collected_at: iso(-100), storage_path: "private/path.pdf" }] });
    api.getAssetDocumentUrl.mockResolvedValue("https://signed.example/doc?token=abc");
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    const screen = renderScreen();
    fireEvent.press(await screen.findByTestId("asset-section-history"));
    const doc = await screen.findByTestId("asset-doc-d1");
    expect(doc).not.toHaveTextContent(has("private/path.pdf"));
    fireEvent.press(doc);
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://signed.example/doc?token=abc"));
    expect(api.getAssetDocumentUrl).toHaveBeenCalledWith("d1");
  });

  it("shows downtime from the records without restoring or inferring anything", async () => {
    serve();
    api.listAssetDowntime.mockResolvedValue([{ id: "dt1", started_at: iso(-2), restored_at: null, impact_level: "out_of_service", downtime_type: "unplanned", elapsed_minutes: 2880 }]);
    const screen = renderScreen();
    fireEvent.press(await screen.findByTestId("asset-section-history"));
    const downtime = await screen.findByTestId("asset-downtime");
    expect(downtime).toHaveTextContent(has("assets.history.ongoing"));
    expect(downtime).toHaveTextContent(has("2 d 0 h"));
  });
});
