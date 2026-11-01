import React from "react";
import { RefreshControl } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
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
jest.mock("@/lib/engineering/pmDraftStore", () => ({ listPmDraftSummaries: jest.fn() }));
let mockParams: { view?: string } = {};
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
import { listPmDraftSummaries } from "@/lib/engineering/pmDraftStore";
import PreventiveMaintenanceScreen from "@/app/(app)/pm-schedules/index";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { resetPmScheduleCache } from "@/lib/engineering/usePmSchedules";

const listApi = listPmSchedules as jest.Mock;
const historyApi = listPmCompletions as jest.Mock;
const draftsApi = listPmDraftSummaries as jest.Mock;

function iso(daysFromToday: number): string {
  // Midday Chicago time on the hotel's own calendar day (not the UTC day, which is already tomorrow in the evening).
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
  const d = new Date(`${todayKey}T18:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d.toISOString();
}
/** Days from today to next week's Tuesday (weeks start on Monday), so "next week" holds on every weekday, Sundays included. */
function daysToNextWeekTuesday(): number {
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
  const mondayBased = (new Date(`${todayKey}T12:00:00.000Z`).getUTCDay() + 6) % 7;
  return 8 - mondayBased;
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

// The first render pays the cold import cost of the whole screen tree.
jest.setTimeout(20000);

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
  draftsApi.mockReset();
  draftsApi.mockResolvedValue([]);
  mockParams = {};
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
    fireEvent.press(getByTestId("pm-view-plan"));
    await findByTestId("pm-week-carried");
    expect(getAllByTestId("pm-card-late")).toHaveLength(1);
    expect(getAllByTestId("pm-card-today")).toHaveLength(1);
  });

  it("Week navigation moves to the next week without duplicating or losing work", async () => {
    listApi.mockResolvedValue([row("next", daysToNextWeekTuesday())]);
    const { findByTestId, getByTestId, queryByTestId } = renderScreen();
    await findByTestId("pm-metric-week");
    fireEvent.press(getByTestId("pm-view-plan"));
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
    fireEvent.press(getByTestId("pm-view-plan"));
    fireEvent.press(getByTestId("pm-plan-calendar"));
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

describe("Phase 2 navigation and Today", () => {
  it("has exactly Today, Plan and History at the top level, with Week and Calendar inside Plan", async () => {
    listApi.mockResolvedValue([row("today", 0)]);
    const { findByTestId, getByTestId, queryByTestId } = renderScreen();
    await findByTestId("pm-card-today");
    expect(getByTestId("pm-view-today")).toBeTruthy();
    expect(getByTestId("pm-view-plan")).toBeTruthy();
    expect(getByTestId("pm-view-history")).toBeTruthy();
    expect(queryByTestId("pm-view-week")).toBeNull();
    expect(queryByTestId("pm-view-calendar")).toBeNull();
    fireEvent.press(getByTestId("pm-view-plan"));
    expect(getByTestId("pm-plan-week")).toBeTruthy();
    expect(getByTestId("pm-plan-calendar")).toBeTruthy();
  });

  it("keeps old ?view=calendar links working by landing on Plan > Calendar", async () => {
    mockParams = { view: "calendar" };
    listApi.mockResolvedValue([row("today", 0)]);
    const { findByTestId } = renderScreen();
    await findByTestId("pm-cal-agenda");
  });

  it("shows Continue Inspection only for a real saved draft and never repeats that schedule below", async () => {
    draftsApi.mockResolvedValue([{ scheduleId: "late", answered: 3, total: 8, updatedAt: "2026-11-01T12:00:00.000Z" }]);
    listApi.mockResolvedValue([row("late", -3), row("today", 0)]);
    const { findByTestId, getByTestId, queryByTestId } = renderScreen();
    await findByTestId("pm-continue-late");
    expect(getByTestId("pm-today-continue")).toBeTruthy();
    expect(getByTestId("pm-continue-open-late").props.accessibilityLabel).toContain("pm.today.progress");
    // The drafted overdue schedule is in Continue only; with nothing else overdue, Needs Attention is not shown at all.
    expect(queryByTestId("pm-card-late")).toBeNull();
    expect(queryByTestId("pm-today-overdue")).toBeNull();
    expect(getByTestId("pm-card-today")).toBeTruthy();
    fireEvent.press(getByTestId("pm-continue-open-late"));
    expect(router.push).toHaveBeenCalledWith("/(app)/pm-schedules/inspect/late");
  });

  it("hides the Continue section when there is no draft", async () => {
    listApi.mockResolvedValue([row("today", 0)]);
    const { findByTestId, queryByTestId } = renderScreen();
    await findByTestId("pm-card-today");
    expect(queryByTestId("pm-today-continue")).toBeNull();
  });

  it("orders Needs Attention by most overdue first and never lists overdue work as due today", async () => {
    listApi.mockResolvedValue([row("a", -1), row("b", -9), row("c", 0)]);
    const { findByTestId, getByTestId } = renderScreen();
    await findByTestId("pm-today-overdue");
    const overdue = getByTestId("pm-today-overdue");
    const ids = [...new Set(overdue.findAll((n) => typeof n.props.testID === "string" && /^pm-card-[a-z]$/.test(n.props.testID)).map((n) => n.props.testID))];
    expect(ids).toEqual(["pm-card-b", "pm-card-a"]);
    expect(getByTestId("pm-metric-today").props.accessibilityLabel).toBe("pmSchedules.dueToday: 1");
  });

  it("opens the filtered worklist when a summary card is tapped", async () => {
    listApi.mockResolvedValue([row("late", -3), row("today", 0)]);
    const { findByTestId, getByTestId, queryByTestId } = renderScreen();
    await findByTestId("pm-card-today");
    fireEvent.press(getByTestId("pm-metric-overdue"));
    await waitFor(() => expect(queryByTestId("pm-card-today")).toBeNull());
    expect(getByTestId("pm-card-late")).toBeTruthy();
    expect(getByTestId("pm-active-filters")).toBeTruthy();
    fireEvent.press(getByTestId("pm-metric-week"));
    await findByTestId("pm-plan");
    expect(queryByTestId("pm-active-filters")).toBeNull();
  });

  it("does not offer schedule search or filters on History, which reads recorded inspections from the server", async () => {
    listApi.mockResolvedValue([row("today", 0)]);
    const { findByTestId, getByTestId, queryByTestId } = renderScreen();
    await findByTestId("pm-card-today");
    expect(getByTestId("pm-search-toggle")).toBeTruthy();
    fireEvent.press(getByTestId("pm-view-history"));
    await waitFor(() => expect(queryByTestId("pm-search-toggle")).toBeNull());
    expect(queryByTestId("pm-filter-open")).toBeNull();
  });

  it("History flags follow-up defects and opens the exact equipment", async () => {
    listApi.mockResolvedValue([row("today", 0)]);
    historyApi.mockResolvedValue({
      rows: [{ id: "c1", pm_schedule_id: "pm-x", asset_id: "asset-9", schedule_name: "Boiler PM", asset_name: "Boiler 1", technician_name: "Eli", completed_at: iso(-1), defects: [{ description: "leak" }], passed_count: 4, failed_count: 1, not_applicable_count: 0 }],
      hasMore: false,
    });
    const { findByTestId, getByTestId, findByText } = renderScreen();
    await findByTestId("pm-card-today");
    fireEvent.press(getByTestId("pm-view-history"));
    await findByText("pm.history.followUp:1");
    fireEvent.press(await findByTestId("pm-history-asset-c1"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/(app)/assets/[assetId]", params: { assetId: "asset-9" } });
  });

  it("filter sheet offers All and applies only on Show results", async () => {
    listApi.mockResolvedValue([row("late", -3), row("today", 0), row("soon", 2)]);
    const { findByTestId, getByTestId, queryByTestId } = renderScreen();
    await findByTestId("pm-card-today");
    fireEvent.press(getByTestId("pm-filter-open"));
    expect(getByTestId("pm-filter-state-all")).toBeTruthy();
    fireEvent.press(getByTestId("pm-filter-state-overdue"));
    // Nothing is applied behind the sheet yet.
    expect(queryByTestId("pm-active-filters")).toBeNull();
    fireEvent.press(getByTestId("pm-filter-apply"));
    await waitFor(() => expect(getByTestId("pm-active-filters")).toBeTruthy());
    expect(queryByTestId("pm-card-today")).toBeNull();
  });
});
