import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useFocusEffect: jest.fn(),
  useLocalSearchParams: () => ({}),
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
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn() } }));
jest.mock("@/lib/api/pmManagement", () => ({ getAssetOverview: jest.fn() }));
let mockRole = "chief_engineer";
jest.mock("@/stores/appStore", () => {
  const { makeAppStoreMock } = require("../helpers/appStoreMock");
  return { useAppStore: makeAppStoreMock(() => ({ isOnline: true, hotelTimezone: "America/Chicago", user: { id: "u1", role: mockRole, tenant_id: "h1" } })) };
});

import { router } from "expo-router";
import * as mgmt from "@/lib/api/pmManagement";
import AssetManagementScreen from "@/app/(app)/assets/management";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { ToastProvider } from "@/lib/theme/ToastProvider";

const overview = mgmt.getAssetOverview as unknown as jest.Mock;
const item = (id: string, over: Record<string, unknown> = {}) => ({ id, name: `Asset ${id}`, asset_tag: `T-${id}`, location_text: "Roof", criticality: "high", warranty_expires: null, downtime_impact: null, ...over });
const section = (items: ReturnType<typeof item>[], count = items.length) => ({ count, items });
const DATA = {
  critical: section([item("a1", { criticality: "life_safety" }), item("a2")]),
  out_of_service: section([item("a3", { downtime_impact: "out_of_service" })]),
  active_repairs: section([]),
  warranty_expiring: section([item("a4", { warranty_expires: "2026-12-01" })]),
  warranty_expired: section([], 0),
  retired: { count: 2 },
  active_assets: 40,
  warranty_unknown: 11,
  warranty_window_days: 90,
};
const screen = () => render(<ThemeProvider><ToastProvider><AssetManagementScreen /></ToastProvider></ThemeProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = "chief_engineer";
  overview.mockResolvedValue(DATA);
});

describe("Asset Management", () => {
  it("shows real counts per group and opens on the critical list, life safety first", async () => {
    const { findByTestId, getByTestId } = screen();
    expect(await findByTestId("asset-mgmt-card-critical")).toBeTruthy();
    expect(getByTestId("asset-mgmt-card-critical").props.accessibilityLabel).toBe("assets.management.group.critical: 2");
    expect(getByTestId("asset-mgmt-card-active_repairs").props.accessibilityLabel).toBe("assets.management.group.active_repairs: 0");
    expect(getByTestId("asset-mgmt-row-a1")).toBeTruthy();
  });

  it("switching group shows that group's rows, and an empty group says so rather than looking broken", async () => {
    const { findByTestId, getByTestId, queryByTestId } = screen();
    fireEvent.press(await findByTestId("asset-mgmt-card-out_of_service"));
    expect(getByTestId("asset-mgmt-row-a3")).toBeTruthy();
    expect(queryByTestId("asset-mgmt-row-a1")).toBeNull();
    fireEvent.press(getByTestId("asset-mgmt-card-active_repairs"));
    expect(getByTestId("asset-mgmt-none")).toBeTruthy();
  });

  it("a row opens that exact equipment", async () => {
    const { findByTestId, getByTestId } = screen();
    await findByTestId("asset-mgmt-row-a2");
    fireEvent.press(getByTestId("asset-mgmt-row-a2"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/(app)/assets/[assetId]", params: { assetId: "a2" } });
  });

  it("says when a list is longer than what is shown", async () => {
    overview.mockResolvedValue({ ...DATA, critical: section([item("a1")], 60) });
    const { findByTestId } = screen();
    expect(await findByTestId("asset-mgmt-more")).toBeTruthy();
  });

  it("a failed read is an error with retry, never a screen of zeros", async () => {
    overview.mockRejectedValue(Object.assign(new Error("HTTP 500"), { status: 500 }));
    const { findByText, queryByTestId } = screen();
    expect(await findByText("common.retry")).toBeTruthy();
    expect(queryByTestId("asset-mgmt-card-critical")).toBeNull();
  });

  it("a line engineer is refused and nothing is fetched", async () => {
    mockRole = "engineer";
    screen();
    await act(async () => { await Promise.resolve(); });
    expect(overview).not.toHaveBeenCalled();
  });

  it("keeps the caveat that dates and criticality are records, not guarantees", async () => {
    const { findByTestId, getByText } = screen();
    await findByTestId("asset-mgmt-summary");
    await waitFor(() => expect(getByText("assets.management.disclaimer")).toBeTruthy());
  });
});
