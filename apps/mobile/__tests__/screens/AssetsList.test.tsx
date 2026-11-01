import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
  useFocusEffect: jest.fn(),
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
  browseAssets: jest.fn(),
  listAssetCategories: jest.fn(),
  getFailurePredictions: jest.fn(),
}));
let mockOnline = true;
jest.mock("@/stores/appStore", () => {
  const { makeAppStoreMock } = require("../helpers/appStoreMock");
  return {
    useAppStore: makeAppStoreMock(() => ({
      isOnline: mockOnline,
      hotelTimezone: "America/Chicago",
      user: { id: "u1", role: "engineer", tenant_id: "h1", language_pref: "en" },
    })),
  };
});

import { router } from "expo-router";
import { browseAssets, getFailurePredictions, listAssetCategories } from "@/lib/api/assets";
import AssetsScreen from "@/app/(app)/assets/index";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { resetAssetBrowseCache } from "@/lib/engineering/useAssetBrowse";
import { resetAsyncResourceCache } from "@/lib/engineering/useAsyncResource";
import type { AssetRow } from "@/lib/engineering/assetModel";

const browse = browseAssets as jest.Mock;
const asset = (n: number, over: Partial<AssetRow> = {}): AssetRow => ({
  id: `a${n}`,
  name: `Asset ${n}`,
  asset_tag: `AC-${n}`,
  asset_categories: { name: "HVAC" },
  rooms: { room_number: String(300 + n) },
  service_status: "operational",
  active_work_order_count: 0,
  pm_overdue: false,
  pm_due_soon: false,
  repeat_repairs_90d: 0,
  has_active_prediction: false,
  had_downtime_365d: false,
  ...over,
});
const page = (rows: AssetRow[], hasMore = false, total = rows.length) => ({ rows, hasMore, total });

function renderScreen() {
  return render(
    <ThemeProvider>
      <AssetsScreen />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOnline = true;
  resetAssetBrowseCache();
  resetAsyncResourceCache();
  (listAssetCategories as jest.Mock).mockResolvedValue([{ id: "c1", name: "HVAC" }]);
  (getFailurePredictions as jest.Mock).mockResolvedValue({ data: [] });
});

describe("Assets list", () => {
  it("shows each asset as a tappable card that opens its record", async () => {
    browse.mockResolvedValue(page([asset(1, { service_status: "under_repair", active_work_order_count: 1 }), asset(2)]));
    const screen = renderScreen();
    await screen.findByTestId("asset-card-a1");
    expect(screen.getByTestId("asset-status-a1")).toBeTruthy();
    fireEvent.press(screen.getByTestId("asset-card-a2"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/(app)/assets/[assetId]", params: { assetId: "a2" } });
  });

  it("opens the scanner from the header", async () => {
    browse.mockResolvedValue(page([asset(1)]));
    const screen = renderScreen();
    await screen.findByTestId("asset-card-a1");
    fireEvent.press(screen.getByTestId("asset-scan-button"));
    expect(router.push).toHaveBeenCalledWith("/(app)/assets/scan");
  });

  it("searches the server (debounced) instead of filtering the first page", async () => {
    browse.mockImplementation(async (_f: unknown, q: string) => (q === "312" ? page([asset(12)]) : page([asset(1), asset(2)], true, 400)));
    const screen = renderScreen();
    await screen.findByTestId("asset-card-a1");
    fireEvent.changeText(screen.getByTestId("asset-search"), "312");
    await waitFor(() => expect(browse).toHaveBeenCalledWith(expect.anything(), "312", 1, expect.anything()), { timeout: 2000 });
    await screen.findByTestId("asset-card-a12");
    expect(screen.queryByTestId("asset-card-a1")).toBeNull();
    // Typing three characters made one request, not three.
    expect(browse.mock.calls.filter(([, q]) => q !== "").length).toBe(1);
  });

  it("clears the search and the list returns", async () => {
    browse.mockImplementation(async (_f: unknown, q: string) => (q ? page([asset(12)]) : page([asset(1)])));
    const screen = renderScreen();
    await screen.findByTestId("asset-card-a1");
    fireEvent.changeText(screen.getByTestId("asset-search"), "x");
    await screen.findByTestId("asset-card-a12", {}, { timeout: 2000 });
    fireEvent.press(screen.getByTestId("asset-search-clear"));
    await screen.findByTestId("asset-card-a1", {}, { timeout: 2000 });
  });

  it("applies a quick filter by asking the server, not by hiding rows", async () => {
    browse.mockResolvedValue(page([asset(1)]));
    const screen = renderScreen();
    await screen.findByTestId("asset-card-a1");
    fireEvent.press(screen.getByTestId("asset-quick-out_of_service"));
    await waitFor(() => expect(browse).toHaveBeenLastCalledWith(expect.objectContaining({ quick: "out_of_service" }), "", 1, expect.anything()));
  });

  it("applies sheet filters together and shows how many are active", async () => {
    browse.mockResolvedValue(page([asset(1)]));
    const screen = renderScreen();
    await screen.findByTestId("asset-card-a1");
    fireEvent.press(screen.getByTestId("asset-filter-open"));
    fireEvent.press(await screen.findByTestId("asset-filter-category-c1"));
    fireEvent.press(screen.getByTestId("asset-filter-status-degraded"));
    fireEvent.press(screen.getByTestId("asset-filter-maintenance-pm_overdue"));
    fireEvent.press(screen.getByTestId("asset-filter-apply"));
    await waitFor(() =>
      expect(browse).toHaveBeenLastCalledWith(
        expect.objectContaining({ categoryId: "c1", status: "degraded", maintenance: "pm_overdue" }),
        "",
        1,
        expect.anything(),
      ),
    );
    expect(screen.getByLabelText("assets.filter.openActive:count=3")).toBeTruthy();
  });

  it("says 'no matches' with a way out when a search finds nothing, and 'no assets' only for an empty hotel", async () => {
    browse.mockResolvedValue(page([]));
    const screen = renderScreen();
    expect(await screen.findByText("assets.empty")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("asset-search"), "zzz");
    expect(await screen.findByText("assets.noMatches", {}, { timeout: 6000 })).toBeTruthy();
    // The footer renders in a later list batch on a loaded runner, so wait for it rather than reading it at once.
    expect(await screen.findByTestId("asset-clear-filters", {}, { timeout: 6000 })).toBeTruthy();
  });

  it("shows an error with Retry, never an empty inventory, when the first read fails", async () => {
    browse.mockRejectedValueOnce(Object.assign(new Error("HTTP 500"), { status: 500 })).mockResolvedValue(page([asset(1)]));
    const screen = renderScreen();
    expect(screen.queryByText("assets.empty")).toBeNull();
    const retry = await screen.findByText("common.retry");
    fireEvent.press(retry);
    await screen.findByTestId("asset-card-a1");
  });

  it("keeps the rows and says they may be old when a refresh fails offline", async () => {
    browse.mockResolvedValueOnce(page([asset(1)]));
    const screen = renderScreen();
    await screen.findByTestId("asset-card-a1");
    mockOnline = false;
    browse.mockRejectedValue(new Error("Network request failed"));
    await act(async () => {
      fireEvent(screen.getByTestId("asset-search"), "submitEditing");
    });
    fireEvent.changeText(screen.getByTestId("asset-search"), "");
    expect(screen.getByTestId("asset-card-a1")).toBeTruthy();
  });

  it("links to open reliability signals without putting a prediction card above the inventory", async () => {
    browse.mockResolvedValue(page([asset(1)]));
    (getFailurePredictions as jest.Mock).mockResolvedValue({ data: [{ id: "p1", asset_id: "a1", is_acknowledged: false, risk_score: 80 }] });
    const screen = renderScreen();
    fireEvent.press(await screen.findByTestId("asset-signals-row"));
    await waitFor(() => expect(browse).toHaveBeenLastCalledWith(expect.objectContaining({ reliability: "active_prediction" }), "", 1, expect.anything()));
  });

  it("restores the previous search and filters when the screen is opened again", async () => {
    browse.mockResolvedValue(page([asset(1)]));
    const first = renderScreen();
    await first.findByTestId("asset-card-a1");
    fireEvent.press(first.getByTestId("asset-quick-attention"));
    first.unmount();
    const second = renderScreen();
    await waitFor(() => expect(browse).toHaveBeenLastCalledWith(expect.objectContaining({ quick: "attention" }), "", 1, expect.anything()));
    second.unmount();
  });
});
