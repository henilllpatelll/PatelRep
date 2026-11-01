import React from "react";
import { RefreshControl } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
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
jest.mock("@/lib/api/pm", () => ({ listPmCompletions: jest.fn() }));
jest.mock("@/lib/engineering/pmDraftStore", () => ({ listPmDraftIds: jest.fn().mockResolvedValue(["pm-today"]) }));
let mockOnline = true;
let mockRole = "engineer";
jest.mock("@/stores/appStore", () => {
  const { makeAppStoreMock } = require("../helpers/appStoreMock");
  return {
    useAppStore: makeAppStoreMock(() => ({
      user: { id: "u1", tenant_id: "h1", role: mockRole },
      isOnline: mockOnline,
      hotelTimezone: "America/Chicago",
    })),
  };
});

import { router } from "expo-router";
import { listPmSchedules } from "@/lib/api/assets";
import { listPmCompletions } from "@/lib/api/pm";
import PreventiveMaintenanceScreen from "@/app/(app)/pm-schedules/index";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { resetPmScheduleCache } from "@/lib/engineering/usePmSchedules";

const listApi = listPmSchedules as jest.Mock;
const historyApi = listPmCompletions as jest.Mock;

function iso(daysFromToday: number): string {
  // Midday Chicago time on the hotel's own calendar day (not the UTC day, which is already tomorrow in the evening).
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
  const d = new Date(`${todayKey}T18:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d.toISOString();
}
const row = (id: string, days: number | null, extra: object = {}) => ({
  id,
  asset_id: `a-${id}`,
  name: `PM ${id}`,
  interval_type: "monthly",
  next_due_at: days == null ? null : iso(days),
  is_active: true,
  assets: { name: `Asset ${id}`, room_id: null },
  ...extra,
});

const renderScreen = () =>
  render(
    <ThemeProvider>
      <PreventiveMaintenanceScreen />
    </ThemeProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  // Drop any unconsumed once-queues from the previous test without touching React Native's own mocks.
  listApi.mockReset();
  historyApi.mockReset();
  resetPmScheduleCache();
  mockOnline = true;
  mockRole = "engineer";
  historyApi.mockResolvedValue({ rows: [], hasMore: false });
});

describe("PM dashboard", () => {
  it("shows overdue and due-today work in separate sections with real counts", async () => {
    listApi.mockResolvedValue([row("late", -3), row("today", 0), row("soon", 2), row("far", 30)]);
    const { findByTestId, getByTestId, queryByTestId } = renderScreen();
    await findByTestId("pm-today-overdue");
    expect(getByTestId("pm-card-late")).toBeTruthy();
    expect(getByTestId("pm-today-due")).toBeTruthy();
    expect(getByTestId("pm-card-today")).toBeTruthy();
    expect(queryByTestId("pm-card-far")).toBeNull();
    expect(getByTestId("pm-metric-overdue").props.accessibilityLabel).toBe("pmSchedules.overdue: 1");
    expect(getByTestId("pm-metric-today").props.accessibilityLabel).toBe("pmSchedules.dueToday: 1");
  });

  it("offers Start or Continue straight from the card and opens the detail on tap", async () => {
    listApi.mockResolvedValue([row("today", 0), row("late", -1)]);
    const { findByTestId, getByTestId } = renderScreen();
    await findByTestId("pm-card-today");
    await waitFor(() => expect(getByTestId("pm-card-inspect-today")).toBeTruthy());
    fireEvent.press(getByTestId("pm-card-inspect-late"));
    expect(router.push).toHaveBeenCalledWith("/(app)/pm-schedules/inspect/late");
    fireEvent.press(getByTestId("pm-card-open-today"));
    expect(router.push).toHaveBeenCalledWith("/(app)/pm-schedules/today");
  });

  it("does not show a confirmed zero when the load failed: counts are unknown and an error with Retry is shown", async () => {
    listApi.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    const { findByText, getByTestId, queryByText } = renderScreen();
    await findByText("engineeringState.loadFailed");
    expect(getByTestId("pm-metric-overdue").props.accessibilityLabel).toBe("pmSchedules.overdue: pm.unknownCount");
    expect(queryByText("pmSchedules.noSchedules")).toBeNull();
  });

  it("says so when there genuinely are no schedules, and keeps last good data (with a notice) when a refresh fails", async () => {
    listApi.mockResolvedValueOnce([]);
    const empty = renderScreen();
    await empty.findByText("pmSchedules.noSchedules");
    empty.unmount();

    resetPmScheduleCache();
    listApi.mockResolvedValueOnce([row("today", 0)]);
    const { findByTestId, queryByTestId, queryByText, UNSAFE_getByType } = renderScreen();
    await findByTestId("pm-card-today");
    listApi.mockRejectedValueOnce(new Error("Network request failed"));
    await act(async () => {
      await UNSAFE_getByType(RefreshControl).props.onRefresh();
    });
    // The last good schedules stay on screen, flagged as stale, rather than turning into an empty or error screen.
    expect(queryByTestId("pm-card-today")).toBeTruthy();
    expect(queryByText("engineeringState.loadFailed")).toBeNull();
  });

  it("labels the data as possibly out of date while offline", async () => {
    listApi.mockResolvedValue([row("today", 0)]);
    const { findByTestId, rerender, queryByTestId } = renderScreen();
    await findByTestId("pm-card-today");
    expect(queryByTestId("pm-offline-note")).toBeNull();
    mockOnline = false;
    rerender(
      <ThemeProvider>
        <PreventiveMaintenanceScreen />
      </ThemeProvider>,
    );
    expect(queryByTestId("pm-offline-note")).toBeTruthy();
  });

  it("hides inspection actions from roles the API would refuse", async () => {
    mockRole = "front_desk";
    listApi.mockResolvedValue([row("today", 0)]);
    const { findByTestId, queryByTestId } = renderScreen();
    await findByTestId("pm-card-today");
    expect(queryByTestId("pm-card-inspect-today")).toBeNull();
  });
});

describe("PM views", () => {
  it("Week shows each schedule once, on its due day, with a count per day", async () => {
    listApi.mockResolvedValue([row("today", 0), row("today2", 0), row("late", -30)]);
    const { findByTestId, getByTestId, getAllByTestId } = renderScreen();
    await findByTestId("pm-card-today");
    fireEvent.press(getByTestId("pm-view-week"));
    await findByTestId("pm-week-carried");
    expect(getAllByTestId("pm-card-late")).toHaveLength(1);
    expect(getAllByTestId("pm-card-today")).toHaveLength(1);
  });

  it("Week navigation moves to the next week without duplicating or losing work", async () => {
    listApi.mockResolvedValue([row("next", 8)]);
    const { findByTestId, getByTestId, queryByTestId } = renderScreen();
    await findByTestId("pm-metric-week");
    fireEvent.press(getByTestId("pm-view-week"));
    await findByTestId("pm-week-empty");
    fireEvent.press(getByTestId("pm-week-next"));
    await waitFor(() => expect(queryByTestId("pm-card-next")).toBeTruthy());
    fireEvent.press(getByTestId("pm-week-prev"));
    await waitFor(() => expect(queryByTestId("pm-card-next")).toBeNull());
  });

  it("Calendar marks real due dates and lists the selected day's agenda", async () => {
    listApi.mockResolvedValue([row("today", 0)]);
    const { findByTestId, getByTestId } = renderScreen();
    await findByTestId("pm-card-today");
    fireEvent.press(getByTestId("pm-view-calendar"));
    await findByTestId("pm-cal-agenda");
    expect(getByTestId("pm-card-today")).toBeTruthy();
  });

  it("History is read a page at a time only when opened, and opens a record", async () => {
    listApi.mockResolvedValue([row("today", 0)]);
    historyApi.mockResolvedValue({
      rows: [{ id: "c1", pm_schedule_id: "pm-x", schedule_name: "Boiler PM", asset_name: "Boiler 1", technician_name: "Eli", completed_at: iso(-1), passed_count: 4, failed_count: 1, not_applicable_count: 0 }],
      hasMore: false,
    });
    const { findByTestId, getByTestId } = renderScreen();
    await findByTestId("pm-card-today");
    expect(historyApi).not.toHaveBeenCalled();
    fireEvent.press(getByTestId("pm-view-history"));
    fireEvent.press(await findByTestId("pm-history-c1"));
    expect(router.push).toHaveBeenCalledWith("/(app)/pm-schedules/record/c1?scheduleId=pm-x");
  });
});

describe("search and filters", () => {
  it("narrows the list, shows what is active, and Reset brings everything back", async () => {
    listApi.mockResolvedValue([row("alpha", 0, { name: "Boiler pressure" }), row("beta", 0, { name: "Pool pump" })]);
    const { findByTestId, getByTestId, queryByTestId } = renderScreen();
    await findByTestId("pm-card-alpha");
    fireEvent.press(getByTestId("pm-search-toggle"));
    fireEvent.changeText(getByTestId("pm-search-input"), "pool");
    await waitFor(() => expect(queryByTestId("pm-card-alpha")).toBeNull());
    expect(getByTestId("pm-card-beta")).toBeTruthy();
    expect(getByTestId("pm-active-filters")).toBeTruthy();
    fireEvent.press(getByTestId("pm-filters-reset"));
    await waitFor(() => expect(queryByTestId("pm-card-alpha")).toBeTruthy());
  });

  it("says nothing matches (not 'no schedules') when filters remove everything", async () => {
    listApi.mockResolvedValue([row("alpha", 0)]);
    const { findByTestId, getByTestId, findByText } = renderScreen();
    await findByTestId("pm-card-alpha");
    fireEvent.press(getByTestId("pm-search-toggle"));
    fireEvent.changeText(getByTestId("pm-search-input"), "zzz");
    await findByText("pm.noMatches");
  });
});
