import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

const mockParams = { completionId: "c1", scheduleId: "s1" };
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
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
jest.mock("@/lib/api/pm", () => ({ getPmCompletion: jest.fn() }));
jest.mock("@/stores/appStore", () => {
  const { makeAppStoreMock } = require("../helpers/appStoreMock");
  return { useAppStore: makeAppStoreMock(() => ({ hotelTimezone: "America/Chicago", isOnline: true, user: { id: "u1", role: "engineer", tenant_id: "h1" } })) };
});

import { router } from "expo-router";
import { getPmCompletion } from "@/lib/api/pm";
import PmRecordScreen from "@/app/(app)/pm-schedules/record/[completionId]";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

const get = getPmCompletion as jest.Mock;
const RECORD = {
  id: "c1", pm_schedule_id: "s1", asset_id: "a1", technician_id: "u1", completed_at: "2026-10-01T15:00:00Z", checklist_template_id: null, checklist_version: 2,
  labor_minutes: 30, parts_used: [], defects: [], notes: null, photos: [],
  items: [{ id: "i1", label: "Belt", result: "failed", note: null, evidence: [] }],
  asset: { id: "a1", name: "Chiller 2", asset_tag: "CH-2", is_active: true },
  corrective_work_orders: [{ id: "w1", title: "Corrective PM work: Belt", status: "open", work_order_number: 41 }],
};
const renderScreen = () => render(<ThemeProvider><PmRecordScreen /></ThemeProvider>);

beforeEach(() => jest.clearAllMocks());

describe("an inspection record links onward to real records", () => {
  it("opens the exact equipment it was done on", async () => {
    get.mockResolvedValue(RECORD);
    const screen = renderScreen();
    fireEvent.press(await screen.findByTestId("pm-record-asset"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/(app)/assets/[assetId]", params: { assetId: "a1" } });
    expect(screen.getByText("Chiller 2 · CH-2")).toBeTruthy();
  });

  it("opens the corrective work order this inspection created - and reading never creates one", async () => {
    get.mockResolvedValue(RECORD);
    const screen = renderScreen();
    fireEvent.press(await screen.findByTestId("pm-record-wo-w1"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/(app)/work-orders/[woId]", params: { woId: "w1" } });
    expect(get).toHaveBeenCalledTimes(1);
    expect(require("@/lib/api/client").api.post).not.toHaveBeenCalled();
  });

  it("shows no work-order section when the inspection passed", async () => {
    get.mockResolvedValue({ ...RECORD, corrective_work_orders: [] });
    const screen = renderScreen();
    await screen.findByTestId("pm-record");
    expect(screen.queryByTestId("pm-record-work-orders")).toBeNull();
  });

  it("marks retired equipment but still links to its record", async () => {
    get.mockResolvedValue({ ...RECORD, asset: { ...RECORD.asset, is_active: false } });
    const screen = renderScreen();
    expect(await screen.findByText("pm.record.equipmentRetired")).toBeTruthy();
    fireEvent.press(screen.getByTestId("pm-record-asset"));
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it("still opens the equipment from an older server that sends only the id", async () => {
    const { asset: _asset, corrective_work_orders: _wos, ...legacy } = RECORD;
    get.mockResolvedValue(legacy);
    const screen = renderScreen();
    fireEvent.press(await screen.findByTestId("pm-record-asset"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/(app)/assets/[assetId]", params: { assetId: "a1" } });
  });

  it("offers no equipment link when the record has no equipment id", async () => {
    get.mockResolvedValue({ ...RECORD, asset_id: null, asset: null });
    const screen = renderScreen();
    await screen.findByTestId("pm-record");
    expect(screen.queryByTestId("pm-record-asset")).toBeNull();
  });
});
