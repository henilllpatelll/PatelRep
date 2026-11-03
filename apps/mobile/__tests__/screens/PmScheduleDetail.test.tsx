import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ scheduleId: "s1" }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const React = require("react");
    React.useEffect(() => cb(), [cb]);
  },
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o && "count" in o ? `${k}:${o.count}` : k),
    i18n: { language: "en" },
  }),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/lib/housekeeping/useHotelTimezone", () => ({ useHotelTimezone: () => undefined }));
jest.mock("@/lib/api/assets", () => ({ listPmSchedules: jest.fn() }));
jest.mock("@/lib/api/pm", () => ({
  getPmAsset: jest.fn(),
  listAssetMeters: jest.fn(),
  listPmCompletions: jest.fn(),
  listPmTemplates: jest.fn(),
}));
jest.mock("@/lib/engineering/pmDraftStore", () => ({ loadPmDraft: jest.fn() }));
let mockRole = "engineer";
jest.mock("@/lib/api/pmManagement", () => ({
  listPmTechnicians: jest.fn().mockResolvedValue([{ id: "u2", name: "Ana", role: "engineer" }]),
  assignPmSchedule: jest.fn(),
  requestPmDeferral: jest.fn(),
}));
jest.mock("@/stores/appStore", () => {
  const { makeAppStoreMock } = require("../helpers/appStoreMock");
  return {
    useAppStore: makeAppStoreMock(() => ({
      user: { id: "u1", tenant_id: "h1", role: mockRole },
      isOnline: true,
      hotelTimezone: "America/Chicago",
    })),
  };
});

import { router } from "expo-router";
import { listPmSchedules } from "@/lib/api/assets";
import { getPmAsset, listAssetMeters, listPmCompletions, listPmTemplates } from "@/lib/api/pm";
import { loadPmDraft } from "@/lib/engineering/pmDraftStore";
import PmScheduleDetailScreen from "@/app/(app)/pm-schedules/[scheduleId]";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { ToastProvider } from "@/lib/theme/ToastProvider";
import { resetPmScheduleCache } from "@/lib/engineering/usePmSchedules";

const schedulesApi = listPmSchedules as jest.Mock;

function iso(daysFromToday: number): string {
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
  const d = new Date(`${todayKey}T18:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d.toISOString();
}

const schedule = (extra: object = {}) => ({
  id: "s1",
  asset_id: "asset-7",
  name: "Quarterly boiler check",
  interval_type: "quarterly",
  next_due_at: iso(0),
  estimated_minutes: 30,
  is_active: true,
  assets: { name: "Boiler 1", room_id: null, asset_tag: "BL-1", location_text: "Basement" },
  checklist: { state: "ready", template_id: "t1", template_name: "Boiler inspection", template_version: 3 },
  ...extra,
});

// The first render pays the cold import cost of the whole screen tree.
jest.setTimeout(20000);

const renderScreen = () =>
  render(
    <ThemeProvider>
      <ToastProvider>
        <PmScheduleDetailScreen />
      </ToastProvider>
    </ThemeProvider>,
  );

beforeEach(() => {
  mockRole = "engineer";
  jest.clearAllMocks();
  resetPmScheduleCache();
  (getPmAsset as jest.Mock).mockResolvedValue({ id: "asset-7", name: "Boiler 1", asset_tag: "BL-1", service_status: "under_repair" });
  (listAssetMeters as jest.Mock).mockResolvedValue([]);
  (listPmCompletions as jest.Mock).mockResolvedValue({ rows: [], hasMore: false });
  (listPmTemplates as jest.Mock).mockResolvedValue([
    { id: "t1", name: "Boiler inspection", version: 3, items: { checklist: [{ label: "Leaks" }, { label: "Pressure", requires_evidence: true }] } },
  ]);
  (loadPmDraft as jest.Mock).mockResolvedValue(null);
});

describe("PM schedule detail", () => {
  it("opens the exact linked equipment, not the general asset directory", async () => {
    schedulesApi.mockResolvedValue([schedule()]);
    const { findByTestId, getByTestId } = renderScreen();
    await findByTestId("pm-detail-summary");
    fireEvent.press(getByTestId("pm-detail-assets"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/(app)/assets/[assetId]", params: { assetId: "asset-7" } });
  });

  it("shows the assigned procedure with its version, step count and photo steps", async () => {
    schedulesApi.mockResolvedValue([schedule()]);
    const { findByText, findByTestId } = renderScreen();
    await findByTestId("pm-detail-summary");
    expect(await findByText("Boiler inspection")).toBeTruthy();
    expect(await findByText("v3")).toBeTruthy();
    expect(await findByText("pm.stepsCount:2")).toBeTruthy();
    expect(await findByText("pm.detail.stepsWithPhoto:1")).toBeTruthy();
  });

  it("shows the equipment's confirmed service condition when the API sends one", async () => {
    schedulesApi.mockResolvedValue([schedule()]);
    const { findByTestId } = renderScreen();
    expect(await findByTestId("pm-detail-asset-status")).toBeTruthy();
  });

  it("explains a broken checklist binding and blocks Start instead of guessing a procedure", async () => {
    schedulesApi.mockResolvedValue([schedule({ checklist: { state: "inactive", template_id: "t1", template_name: "Old", template_version: 1 } })]);
    const { findByTestId, getByTestId, findByText } = renderScreen();
    await findByTestId("pm-detail-binding-error");
    expect(await findByText("pm.binding.inactive.title")).toBeTruthy();
    expect(getByTestId("pm-detail-start").props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(getByTestId("pm-detail-start"));
    expect(router.push).not.toHaveBeenCalled();
  });

  it("offers Continue Inspection when a real draft exists and opens that exact inspection", async () => {
    (loadPmDraft as jest.Mock).mockResolvedValue({ v: 1, scheduleId: "s1" });
    schedulesApi.mockResolvedValue([schedule()]);
    const { findByTestId, getByTestId, findByText } = renderScreen();
    await findByTestId("pm-detail-draft");
    expect(await findByText("pm.continueInspection")).toBeTruthy();
    fireEvent.press(getByTestId("pm-detail-start"));
    expect(router.push).toHaveBeenCalledWith("/(app)/pm-schedules/inspect/s1");
  });

  it("links the most recent completed inspection to its real record", async () => {
    (listPmCompletions as jest.Mock).mockResolvedValue({
      rows: [{ id: "c1", pm_schedule_id: "s1", technician_name: "Eli", completed_at: iso(-30), passed_count: 4, failed_count: 1, not_applicable_count: 0 }],
      hasMore: false,
    });
    schedulesApi.mockResolvedValue([schedule()]);
    const { findByTestId } = renderScreen();
    fireEvent.press(await findByTestId("pm-detail-history-c1"));
    expect(router.push).toHaveBeenCalledWith("/(app)/pm-schedules/record/c1?scheduleId=s1");
  });

  it("a chief engineer sees the management actions, wired to this exact schedule", async () => {
    mockRole = "chief_engineer";
    schedulesApi.mockResolvedValue([schedule({ row_version: 4, effective_assigned_to: "u2" })]);
    const { findByTestId, getByTestId, findByText } = renderScreen();
    await findByTestId("pm-detail-summary");
    expect(getByTestId("pm-detail-assign")).toBeTruthy();
    expect(getByTestId("pm-detail-defer")).toBeTruthy();
    expect(await findByText("Ana")).toBeTruthy(); // the current assignee, by name
    fireEvent.press(getByTestId("pm-detail-edit"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/(app)/pm-schedules/management/schedule-form", params: { scheduleId: "s1" } });
  });

  it("a line engineer sees no management actions", async () => {
    schedulesApi.mockResolvedValue([schedule()]);
    const { findByTestId, queryByTestId } = renderScreen();
    await findByTestId("pm-detail-summary");
    expect(queryByTestId("pm-detail-assign")).toBeNull();
    expect(queryByTestId("pm-detail-defer")).toBeNull();
    expect(queryByTestId("pm-detail-edit")).toBeNull();
    expect(queryByTestId("pm-detail-start")).toBeTruthy(); // they still run the inspection
  });
});
