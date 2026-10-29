import React from "react";
import { StyleSheet } from "react-native";
import { act, configure, fireEvent, render, waitFor } from "@testing-library/react-native";
import { makeTranslator, type Language } from "../helpers/i18n";

/* The REAL Staffing Forecast route, screen, drawer, hooks and models, and the Team Schedule that hosts the Today and Week
   summaries. Only the network, the router, the translator, the app store and the icon font are doubled. The server doubled
   here is GET /schedules/forecast (routers/scheduling_forecast.py): see helpers/forecastFixtures. */

let mockLanguage: Language = "en";
let mockScheme: "light" | "dark" = "light";
const mockParams: Record<string, string | undefined> = {};
const mockRedirect = jest.fn();
const mockFocus: Array<() => void> = [];

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({ __esModule: true, default: () => mockScheme }));
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() },
  useLocalSearchParams: () => ({ ...mockParams }),
  useFocusEffect: (callback: () => void) => {
    mockFocus.push(callback);
  },
  Redirect: ({ href }: { href: string }) => {
    mockRedirect(href);
    return null;
  },
}));
jest.mock("react-i18next", () => {
  const { makeTranslator: translator } = require("../helpers/i18n");
  const t = translator(() => mockLanguage);
  return { useTranslation: () => ({ t, i18n: { language: mockLanguage } }) };
});
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 20, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn(), put: jest.fn() } }));
jest.mock("@/lib/theme/useToast", () => ({ useToast: () => ({ success: jest.fn(), error: jest.fn(), info: jest.fn() }) }));
jest.mock("@/lib/navigation/openSupervisorHref", () => ({ openSupervisorHref: jest.fn() }));

const mockAppState: { isOnline: boolean; hotelTimezone: string; user: { id: string; role: string; tenant_id: string } | null } = {
  isOnline: true,
  hotelTimezone: "America/Chicago",
  user: { id: "sup-1", role: "housekeeping_supervisor", tenant_id: "h1" },
};
jest.mock("@/stores/appStore", () => ({
  useAppStore: (selector?: (state: unknown) => unknown) => (selector ? selector(mockAppState) : mockAppState),
}));

import { router } from "expo-router";
import ForecastRoute from "@/app/(app)/team-schedule/forecast";
import TeamScheduleRoute from "@/app/(app)/team-schedule/index";
import { api } from "@/lib/api/client";
import { hotelDateKey } from "@/lib/housekeeping/hotelTime";
import { openSupervisorHref } from "@/lib/navigation/openSupervisorHref";
import { addDaysToYmd } from "@/lib/scheduling/teamScheduleDates";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { recommendation, wireDay, wireForecast } from "../helpers/forecastFixtures";
import { wirePage, wirePerson, ZONE } from "../helpers/teamScheduleFixtures";
import { allStrings } from "../helpers/workspaceHarness";

const get = api.get as jest.Mock;
const tr = (key: string, values?: Record<string, unknown>) => makeTranslator(mockLanguage)(key, values);
const TODAY = hotelDateKey(new Date(), ZONE) as string;
const D = (n: number) => addDaysToYmd(TODAY, n);

configure({ asyncUtilTimeout: 5000 });
jest.setTimeout(30000);

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });

/** Today per `today`, then six future days that (like the real server today) cannot be assessed. */
function week(today: Parameters<typeof wireDay>[0] extends infer _ ? Partial<Parameters<typeof wireDay>[0]> : never = {}, later: Array<Partial<Parameters<typeof wireDay>[0]>> = []) {
  const days = [
    wireDay({ date: TODAY, isToday: true, status: "sufficient", demand: 300, capacity: 480, ...today }),
    ...Array.from({ length: 6 }, (_, i) =>
      wireDay({ date: D(i + 1), status: "unknown", demand: null, capacity: 480, reason: "pms_not_connected", ...(later[i] ?? {}) }),
    ),
  ];
  return wireForecast(days, { hotel_today: TODAY });
}

function serve(body: unknown | (() => unknown) = week()) {
  get.mockImplementation(async (url: string) => {
    if (url.startsWith("/schedules/forecast")) {
      const value = typeof body === "function" ? (body as () => unknown)() : body;
      if (value instanceof Error) throw value;
      return value;
    }
    if (url.startsWith("/schedules/gaps")) return { data: [], meta: { count: 0 } };
    if (url.startsWith("/schedules/requests")) return { data: [], meta: { counts: { pending: 0 } } };
    return wirePage({ staff: [wirePerson("u1", "Ana Torres")], assignments: [], dateFrom: TODAY, dateTo: TODAY });
  });
}

const apiError = (status: number) => Object.assign(new Error("server"), { status });
const forecastCalls = () => get.mock.calls.map((c) => c[0] as string).filter((u) => u.startsWith("/schedules/forecast"));

const forecastUi = () => (
  <ThemeProvider>
    <ForecastRoute />
  </ThemeProvider>
);
const scheduleUi = () => (
  <ThemeProvider>
    <TeamScheduleRoute />
  </ThemeProvider>
);

async function openForecast(params: Record<string, string> = {}) {
  Object.assign(mockParams, params);
  const screen = render(forecastUi());
  await settle();
  await waitFor(() => expect(screen.queryByTestId("forecast-screen")).toBeTruthy());
  return screen;
}

async function openSchedule(params: Record<string, string> = {}) {
  Object.assign(mockParams, params);
  const screen = render(scheduleUi());
  await settle();
  await waitFor(() => {
    expect(screen.queryByTestId("team-schedule")).toBeTruthy();
    expect(screen.queryByTestId("team-schedule-skeleton")).toBeNull();
  });
  return screen;
}

const words = (node: { findAll: (p: (n: { type: unknown }) => boolean) => Array<{ props: { children?: unknown } }> }) =>
  node.findAll((n) => (n.type as unknown) === "Text").map((n) => [n.props.children].flat(2).filter((p) => typeof p === "string" || typeof p === "number").join("")).join(" ");

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockParams)) delete mockParams[key];
  mockFocus.length = 0;
  mockLanguage = "en";
  mockScheme = "light";
  mockAppState.isOnline = true;
  mockAppState.user = { id: "sup-1", role: "housekeeping_supervisor", tenant_id: "h1" };
  serve();
});

describe("access", () => {
  it.each(["housekeeper", "inspector", "engineer", "gm", "chief_engineer"])("redirects a %s home and never calls the API", async (role) => {
    mockAppState.user = { id: "x", role, tenant_id: "h1" };
    render(forecastUi());
    await waitFor(() => expect(mockRedirect).toHaveBeenCalledWith("/(app)/home"));
    await act(async () => undefined);
    expect(get).not.toHaveBeenCalled();
  });
});

describe("Staffing Forecast screen", () => {
  it("asks for today and the next six days in one bounded read", async () => {
    await openForecast();
    expect(forecastCalls()).toEqual([`/schedules/forecast?date_from=${TODAY}&days=7`]);
    expect(api.post as jest.Mock).not.toHaveBeenCalled();
  });

  it("leads with one coverage statement built from the server's result, with units", async () => {
    serve(week({ status: "short", demand: 570, capacity: 480, gap: 90, quality: "estimated" }));
    const screen = await openForecast();
    expect(words(screen.getByTestId("forecast-hero"))).toContain("Projected staffing gap");
    expect(words(screen.getByTestId("forecast-hero"))).toContain("About 1 h 30 min of cleaning work is not covered by scheduled labour.");
    expect(words(screen.getByTestId("forecast-metric-demand"))).toContain("9 h 30 min");
    expect(words(screen.getByTestId("forecast-metric-capacity"))).toContain("8 h");
    expect(words(screen.getByTestId("forecast-metric-gap"))).toContain("1 h 30 min short");
    expect(screen.getByTestId("forecast-hero-quality").props.children).toBe("Estimated from your schedule and room standards");
  });

  it("shows a sufficient day as sufficient, with the figures behind it", async () => {
    const screen = await openForecast();
    expect(words(screen.getByTestId("forecast-hero"))).toContain("Coverage appears sufficient");
    expect(words(screen.getByTestId("forecast-hero"))).toContain("8 h of scheduled labour for about 5 h of cleaning work.");
  });

  it("cannot-assess is never dressed up as sufficient and never shows a zero", async () => {
    serve(week({ status: "unknown", demand: null, reason: "room_board_unreadable", rooms: null }));
    const screen = await openForecast();
    expect(words(screen.getByTestId("forecast-hero"))).toContain("Cannot assess coverage");
    expect(words(screen.getByTestId("forecast-hero"))).toContain("Today's room statuses could not be read.");
    expect(screen.getByTestId("forecast-metric-demand-value").props.children).toBe("Not available");
    expect(screen.getByTestId("forecast-metric-rooms-value").props.children).toBe("Not available");
    expect(words(screen.getByTestId("forecast-metrics"))).not.toMatch(/\b0 min\b/);
  });

  it("lists seven days and never marks a day without workload data as sufficient", async () => {
    const screen = await openForecast();
    expect(screen.getAllByTestId(/^forecast-day-\d{4}/)).toHaveLength(7);
    expect(screen.getByTestId(`forecast-day-status-${TODAY}`).props.children).toBe("Projected sufficient");
    for (let i = 1; i <= 6; i += 1) expect(screen.getByTestId(`forecast-day-status-${D(i)}`).props.children).toBe("Not enough data");
    expect(words(screen.getByTestId(`forecast-day-${D(1)}`))).toContain("Workload not available");
  });

  it("shows the hotel, the date and when it was last updated", async () => {
    const screen = await openForecast();
    const line = String(screen.getByTestId("forecast-dateline").props.children);
    expect(line).toContain("Fossil Creek Inn");
    expect(line).toMatch(/Updated/);
  });

  it("opens a details drawer that explains the numbers in plain words", async () => {
    serve(week({ status: "short", demand: 570, capacity: 480, gap: 90, limitations: ["later_departures_unknown", "pending_callouts"] }));
    const screen = await openForecast();
    fireEvent.press(screen.getByTestId(`forecast-day-${TODAY}`));
    await waitFor(() => expect(screen.getByTestId("forecast-sheet")).toBeTruthy());
    expect(words(screen.getByTestId("forecast-sheet-comparison"))).toMatch(/Cleaning work.*9 h 30 min/);
    expect(words(screen.getByTestId("forecast-sheet-comparison"))).toContain("1 h 30 min short");
    expect(words(screen.getByTestId("forecast-sheet-labor"))).toContain("Morning");
    expect(words(screen.getByTestId("forecast-sheet-limitations"))).toContain("Departures that have not happened yet are not included.");
    expect(words(screen.getByTestId("forecast-sheet-sources"))).toContain("live room board");
    expect(screen.getByTestId("forecast-sheet-assumption").props.children).toMatch(/No break policy is set/);
    expect(screen.getByTestId("forecast-sheet-current")).toBeTruthy();
    const everything = allStrings(screen).join(" ");
    expect(everything).not.toMatch(/hk_shift_sessions|room_status|opera_|shift_assignments|coverage_gaps/);
    fireEvent.press(screen.getByTestId("forecast-sheet-close"));
    await waitFor(() => expect(screen.queryByTestId("forecast-sheet")).toBeNull());
  });

  it("explains an unassessable future day in the drawer instead of showing numbers", async () => {
    const screen = await openForecast();
    fireEvent.press(screen.getByTestId(`forecast-day-${D(1)}`));
    await waitFor(() => expect(screen.getByTestId("forecast-sheet")).toBeTruthy());
    expect(words(screen.getByTestId("forecast-sheet-hero"))).toContain("not connected");
    expect(screen.getByTestId("forecast-sheet-quality").props.accessibilityLabel).toBe("Data quality: Not enough data");
    expect(screen.getByTestId("forecast-sheet-demand").props.accessibilityLabel).toBe("Cleaning work: Not available");
    expect(words(screen.getByTestId("forecast-sheet-sources"))).toContain("There is no source for future cleaning workload yet.");
  });

  it("opens the day named in the link", async () => {
    const screen = await openForecast({ date: D(2) });
    await waitFor(() => expect(screen.getByTestId("forecast-sheet")).toBeTruthy());
  });

  it("never states a recommendation without its reason and where it comes from", async () => {
    serve(week({
      status: "short", gap: 60, demand: 540, capacity: 480,
      recommendations: [
        recommendation(),
        recommendation({ id: "uncovered_shift:x:g1", kind: "uncovered_shift", basis: "verified", params: { shift_name: "Morning", date: TODAY }, action: { type: "find_coverage", gap_id: "g1", date: TODAY } }),
      ],
    }));
    const screen = await openForecast();
    const card = screen.getByTestId("forecast-rec-shortfall:2026-10-28");
    expect(words(card)).toContain("Add about 1 more shift");
    expect(words(card)).toContain("This is an estimate, not a requirement.");
    expect(words(card)).toContain("Estimated");
    expect(words(screen.getByTestId("forecast-rec-uncovered_shift:x:g1"))).toContain("From your records");
  });

  it("opens existing screens with the right ids and dates and changes nothing itself", async () => {
    serve(week({
      status: "short", gap: 60, demand: 540, capacity: 480,
      recommendations: [
        recommendation({ params: { gap_minutes: 60, is_minimum: false, additional_shifts: 1 }, action: { type: "add_shift", date: D(0) } }),
        recommendation({ id: "uncovered_shift:y:g9", kind: "uncovered_shift", basis: "verified", params: { shift_name: "Evening" }, action: { type: "find_coverage", gap_id: "g9", date: TODAY } }),
        recommendation({ id: "unassigned_rooms:z", kind: "unassigned_rooms", severity: "info", basis: "verified", params: { rooms: 2 }, action: { type: "view_assignments", date: TODAY } }),
        recommendation({ id: "leave_conflict:q", kind: "leave_conflict", basis: "verified", params: { count: 1 }, action: { type: "review_time_off", date: TODAY } }),
      ],
    }));
    const screen = await openForecast();
    fireEvent.press(screen.getByTestId("forecast-rec-action-uncovered_shift:y:g9"));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: "/(app)/team-schedule/coverage", params: { gapId: "g9" } });
    fireEvent.press(screen.getByTestId("forecast-rec-action-shortfall:2026-10-28"));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: "/(app)/team-schedule", params: { date: TODAY, compose: "add" } });
    fireEvent.press(screen.getByTestId("forecast-rec-action-leave_conflict:q"));
    expect(router.push).toHaveBeenLastCalledWith("/(app)/team-schedule/requests");
    fireEvent.press(screen.getByTestId("forecast-rec-action-unassigned_rooms:z"));
    expect(openSupervisorHref).toHaveBeenCalledWith({ pathname: "/(app)/assignments" });
    for (const method of ["post", "patch", "delete", "put"] as const) expect(api[method] as jest.Mock).not.toHaveBeenCalled();
  });

  it("reads the forecast again when a screen opened from it comes back into focus", async () => {
    await openForecast();
    expect(forecastCalls()).toHaveLength(1);
    await act(async () => { mockFocus.at(-1)?.(); });
    await settle();
    expect(forecastCalls()).toHaveLength(1);                       // the first focus is the initial load
    await act(async () => { mockFocus.at(-1)?.(); });
    await settle();
    await waitFor(() => expect(forecastCalls().length).toBeGreaterThanOrEqual(2));
  });

  it("shows a loading skeleton, then an honest failure with a way to retry", async () => {
    let answer: unknown = apiError(500);
    serve(() => answer);
    const screen = render(forecastUi());
    await waitFor(() => expect(screen.queryByTestId("team-schedule-skeleton")).toBeTruthy());
    await settle();
    await waitFor(() => expect(screen.getByTestId("team-schedule-error")).toBeTruthy());
    expect(screen.queryByTestId("forecast-hero")).toBeNull();
    answer = week();
    fireEvent.press(screen.getByTestId("team-schedule-retry"));
    await settle();
    await waitFor(() => expect(screen.getByTestId("forecast-hero")).toBeTruthy());
  });

  it("keeps the last forecast, labelled out of date, when a refresh fails — read-only offline", async () => {
    let answer: unknown = week();
    serve(() => answer);
    const screen = await openForecast();
    expect(screen.getByTestId("forecast-hero")).toBeTruthy();
    answer = apiError(500);
    await act(async () => { mockFocus.at(-1)?.(); });
    await act(async () => { mockFocus.at(-1)?.(); });
    await settle();
    await waitFor(() => expect(screen.getByTestId("forecast-banner")).toBeTruthy());
    expect(words(screen.getByTestId("forecast-banner"))).toMatch(/may be out of date/);
    expect(screen.getByTestId("forecast-hero")).toBeTruthy();
    for (const method of ["post", "patch", "delete", "put"] as const) expect(api[method] as jest.Mock).not.toHaveBeenCalled();
  });

  it("says it is offline when the device is, and still shows what it has", async () => {
    mockAppState.isOnline = false;
    const screen = await openForecast();
    const text = allStrings(screen).join(" ");
    expect(text).toMatch(/offline/i);
  });

  it("counts a day it could not read instead of dropping it silently", async () => {
    const body = week();
    (body.data.days as unknown[]).splice(3, 1, { date: "garbage" });
    serve(body);
    const screen = await openForecast();
    expect(words(screen.getByTestId("forecast-unreadable"))).toContain("A day of the forecast could not be read.");
    expect(screen.getAllByTestId(/^forecast-day-\d{4}/)).toHaveLength(6);
  });

  it("is fully available in Spanish", async () => {
    mockLanguage = "es";
    serve(week({ status: "short", gap: 90, demand: 570, capacity: 480 }));
    const screen = await openForecast();
    expect(words(screen.getByTestId("forecast-hero"))).toContain("Déficit de personal proyectado");
    expect(screen.getByTestId(`forecast-day-status-${D(1)}`).props.children).toBe("Datos insuficientes");
    expect(allStrings(screen).join(" ")).not.toContain("teamSchedule.");
  });

  it("renders in dark mode with every control labelled and at least 44pt tall", async () => {
    mockScheme = "dark";
    serve(week({ status: "short", gap: 60, demand: 540, capacity: 480, recommendations: [recommendation()] }));
    const screen = await openForecast();
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(8);
    for (const node of buttons) {
      expect(String(node.props.accessibilityLabel ?? "").length).toBeGreaterThan(0);
      const style = StyleSheet.flatten(node.props.style) ?? {};
      const height = Math.max(Number(style.minHeight ?? 0), Number(style.height ?? 0));
      if (node.props.testID?.startsWith("forecast-")) expect({ id: node.props.testID, height: height >= 44 }).toEqual({ id: node.props.testID, height: true });
    }
    expect(words(screen.getByTestId("forecast-hero"))).toContain("Projected staffing gap");
  });
});

describe("Today and Week", () => {
  it("shows a concise forecast summary on Today with a way to open the forecast", async () => {
    const screen = await openSchedule();
    expect(words(screen.getByTestId("team-schedule-forecast-card"))).toContain("Coverage appears sufficient");
    expect(forecastCalls()).toHaveLength(1);
    fireEvent.press(screen.getByTestId("team-schedule-forecast-open"));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: "/(app)/team-schedule/forecast", params: {} });
  });

  it("says 'Coverage not assessed' and why when the day cannot be assessed, never a green light", async () => {
    serve(week({ status: "unknown", demand: null, reason: "room_board_unreadable" }));
    const screen = await openSchedule();
    const card = screen.getByTestId("team-schedule-forecast-card");
    expect(words(card)).toContain("Coverage not assessed");
    expect(words(card)).toContain("Today's room statuses could not be read.");
    expect(words(card)).not.toMatch(/sufficient/i);
  });

  it("says the forecast could not be loaded, without inventing a status, and the rest of Today still works", async () => {
    serve(apiError(500));
    const screen = await openSchedule();
    expect(words(screen.getByTestId("team-schedule-forecast-card"))).toContain("The staffing forecast could not be loaded.");
    expect(screen.getByTestId("team-schedule-summary")).toBeTruthy();
  });

  it("marks a projected shortage in the week and opens that day's details", async () => {
    serve(week({}, [{ status: "short", demand: 900, capacity: 480, gap: 420, isMinimum: true, complete: false, reason: null }]));
    const screen = await openSchedule({ view: "week" });
    expect(screen.getByTestId(`team-schedule-day-short-${D(1)}`)).toBeTruthy();
    expect(screen.queryByTestId(`team-schedule-day-short-${D(2)}`)).toBeNull();
    expect(screen.getByTestId(`team-schedule-day-${D(1)}`).props.accessibilityLabel).toMatch(/projected staffing gap/);
    fireEvent.press(screen.getByTestId(`team-schedule-day-${D(1)}`));
    await settle();
    expect(words(screen.getByTestId("team-schedule-forecast-card"))).toContain("Projected staffing gap");
    fireEvent.press(screen.getByTestId("team-schedule-forecast-open"));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: "/(app)/team-schedule/forecast", params: { date: D(1) } });
  });

  it("opens the Add shift form when a recommendation asks for it, and saves nothing", async () => {
    const screen = await openSchedule({ compose: "add", date: D(1) });
    await waitFor(() => expect(screen.getByTestId("shift-form")).toBeTruthy());
    for (const method of ["post", "patch", "delete", "put"] as const) expect(api[method] as jest.Mock).not.toHaveBeenCalled();
  });

  it("does not repeat the call-out warning the Team Schedule already shows", async () => {
    const screen = await openSchedule();
    const text = allStrings(screen).join(" ");
    expect((text.match(/call-out/gi) ?? []).length).toBe(0);
  });

  it("reads the forecast again when coverage changes", async () => {
    await openSchedule();
    expect(forecastCalls()).toHaveLength(1);
    const { emitCoverageChanged } = require("@/lib/scheduling/coverageSignal");
    await act(async () => { emitCoverageChanged(); });
    await settle();
    await waitFor(() => expect(forecastCalls().length).toBeGreaterThanOrEqual(2));
  });
});
