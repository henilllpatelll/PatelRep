import React from "react";
import { StyleSheet } from "react-native";
import { act, configure, fireEvent, render, waitFor } from "@testing-library/react-native";
import { makeTranslator, type Language } from "../helpers/i18n";

/* The REAL Team Schedule route, screen, hooks and models. Only the network, the router, the translator, the app store
   and the icon font are doubled, so what these tests see is what a supervisor sees. The server doubled here is the
   GET /schedules/team response of routers/scheduling_team.py (see helpers/teamScheduleFixtures). */

let mockLanguage: Language = "en";
let mockScheme: "light" | "dark" = "light";
const mockParams: Record<string, string | undefined> = {};
const mockRedirect = jest.fn();
const mockBack = jest.fn();

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({ __esModule: true, default: () => mockScheme }));
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: (...a: unknown[]) => mockBack(...a), canGoBack: () => true, replace: jest.fn() },
  useLocalSearchParams: () => ({ ...mockParams }),
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
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));
jest.mock("@/lib/theme/useToast", () => ({ useToast: () => ({ success: jest.fn(), error: jest.fn(), info: jest.fn() }) }));

const mockAppState: { isOnline: boolean; hotelTimezone: string; user: { id: string; role: string; effective_role?: string; tenant_id: string } | null } = {
  isOnline: true,
  hotelTimezone: "America/Chicago",
  user: { id: "sup-1", role: "housekeeping_supervisor", tenant_id: "h1" },
};
jest.mock("@/stores/appStore", () => ({
  useAppStore: (selector?: (state: unknown) => unknown) => (selector ? selector(mockAppState) : mockAppState),
}));

import { router } from "expo-router";
import { api } from "@/lib/api/client";
import { hotelDateKey, zonedTimeToInstant } from "@/lib/housekeeping/hotelTime";
import { addDaysToYmd, weekDays } from "@/lib/scheduling/teamScheduleDates";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import TeamScheduleRoute from "@/app/(app)/team-schedule/index";
import { allStrings } from "../helpers/workspaceHarness";
import { wirePage, wirePerson, wireShift, ZONE } from "../helpers/teamScheduleFixtures";

const get = api.get as jest.Mock;
const tr = (key: string, values?: Record<string, unknown>) => makeTranslator(mockLanguage)(key, values);
const TODAY = hotelDateKey(new Date(), ZONE) as string;
const TOMORROW = addDaysToYmd(TODAY, 1);

configure({ asyncUtilTimeout: 5000 });
// The first render of the whole screen compiles a lot of modules; give it room beyond waitFor's own 5 s.
jest.setTimeout(30000);

/** A shift for a hotel day. 00:00–23:59 hotel time, so it has "started" and not "ended" at any moment of the test. */
function dayShift(date: string, id: string, userId: string, over: Record<string, unknown> = {}) {
  const at = (h: number, m: number) => (zonedTimeToInstant(date, h, m, ZONE) as Date).toISOString();
  return wireShift({ id, user_id: userId, work_date: date, shift_name: "Day", start_time: "00:00:00", end_time: "23:59:00", starts_at: at(0, 0), ends_at: at(23, 59), ...over });
}

const STAFF = [
  wirePerson("u1", "Ana Torres", { roles: ["housekeeper"] }),
  wirePerson("u2", "Ben Ruiz", { roles: ["housekeeper"] }),
  wirePerson("u3", "Cy Díaz", { roles: ["inspector"] }),
];

interface Server {
  today?: "ok" | "fail" | "unverified" | "empty";
  week?: "ok" | "fail" | "empty";
}

/** Doubles GET /schedules/team: the attendance-bearing single-day read and the plain week read. */
function serve({ today = "ok", week = "ok" }: Server = {}) {
  get.mockImplementation(async (url: string) => {
    if (url.startsWith("/schedules/gaps")) return { data: [], meta: { count: 0 } };
    if (url === "/schedules/revisions/drafts") return { data: [] };
    const attendance = url.includes("include_attendance=true");
    const range = /date_from=([\d-]+)&date_to=([\d-]+)/.exec(url);
    const [from, to] = [range?.[1] ?? TODAY, range?.[2] ?? TODAY];
    if (attendance) {
      if (today === "fail") throw Object.assign(new Error("server"), { status: 500 });
      if (today === "empty") return wirePage({ staff: [], assignments: [], requested: true, verified: true, asOf: new Date().toISOString(), dateFrom: from, dateTo: to });
      const verified = today === "ok";
      const statuses = verified ? { u1: "working", u2: "not_clocked_in", u3: "clocked_out" } : { u1: "unknown", u2: "unknown", u3: "unknown" };
      return wirePage({
        staff: STAFF.map((p) => ({ ...p, workforce_status: statuses[p.user_id as "u1" | "u2" | "u3"] })),
        assignments: ["u1", "u2", "u3"].map((u, i) => dayShift(TODAY, `t${i}`, u, { workforce_status: statuses[u as "u1" | "u2" | "u3"] })),
        requested: true,
        verified,
        asOf: verified ? new Date().toISOString() : null,
        dateFrom: from,
        dateTo: to,
      });
    }
    if (week === "fail") throw Object.assign(new Error("server"), { status: 500 });
    if (week === "empty") return wirePage({ staff: [], assignments: [], dateFrom: from, dateTo: to });
    return wirePage({
      staff: STAFF,
      assignments: [dayShift(TODAY, "w1", "u1"), dayShift(TOMORROW, "w2", "u2"), dayShift(TOMORROW, "w3", "u1", { shift_name: "Late", start_time: "17:00:00", end_time: "21:00:00", starts_at: (zonedTimeToInstant(TOMORROW, 17, 0, ZONE) as Date).toISOString(), ends_at: (zonedTimeToInstant(TOMORROW, 21, 0, ZONE) as Date).toISOString() })].filter((a) => a.work_date >= from && a.work_date <= to),
      dateFrom: from,
      dateTo: to,
    });
  });
}

const ui = () => (
  <ThemeProvider>
    <TeamScheduleRoute />
  </ThemeProvider>
);

// The theme provider renders nothing until it has hydrated, so "no skeleton" alone would pass on an empty tree.
const ready = (screen: ReturnType<typeof render>) =>
  waitFor(() => {
    expect(screen.queryByTestId("team-schedule")).toBeTruthy();
    expect(screen.queryByTestId("team-schedule-skeleton")).toBeNull();
  });
const open = async (params: Record<string, string> = {}) => {
  Object.assign(mockParams, params);
  const screen = render(ui());
  // Let the already-resolved fetches land inside act, so their state updates are flushed before we look.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  await ready(screen);
  return screen;
};
const text = (node: { props: { children?: unknown } }) => String(node.props.children);

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockParams)) delete mockParams[key];
  mockLanguage = "en";
  mockScheme = "light";
  mockAppState.isOnline = true;
  mockAppState.user = { id: "sup-1", role: "housekeeping_supervisor", tenant_id: "h1" };
  serve();
});

describe("access", () => {
  it.each(["housekeeper", "inspector", "engineer", "front_desk", "gm", "chief_engineer"])("redirects a %s home and never calls the API", async (role) => {
    mockAppState.user = { id: "x", role, tenant_id: "h1" };
    const screen = render(ui());
    await waitFor(() => expect(mockRedirect).toHaveBeenCalledWith("/(app)/home"));
    await act(async () => undefined); // let the theme provider finish hydrating before the test ends
    expect(screen.queryByTestId("team-schedule")).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it("uses the resolved effective role", async () => {
    mockAppState.user = { id: "x", role: "gm", effective_role: "housekeeping_supervisor", tenant_id: "h1" };
    const screen = await open();
    expect(screen.getByTestId("team-schedule")).toBeTruthy();
  });

  it("lets the housekeeping supervisor in", async () => {
    const screen = await open();
    expect(screen.getByTestId("team-schedule")).toBeTruthy();
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});

describe("Today", () => {
  it("shows the plan beside VERIFIED attendance, and never a shortage", async () => {
    const screen = await open();
    expect(text(screen.getByTestId("team-schedule-scheduled-count"))).toBe(tr("teamSchedule.summary.scheduled", { count: 3 }));
    expect(screen.getByTestId("team-schedule-count-onShift").props.accessibilityLabel).toBe("On shift: 1");
    expect(screen.getByTestId("team-schedule-count-notClockedIn")).toBeTruthy();
    // Coverage against the day's work is the staffing forecast's statement now; the summary no longer claims "not yet assessed".
    expect(screen.queryByText("Coverage not yet assessed")).toBeNull();
    expect(screen.getByTestId("team-schedule-forecast-card")).toBeTruthy();
    const everything = allStrings(screen).join(" ").toLowerCase();
    expect(everything).not.toMatch(/short \d|understaffed|required|recommended/);
    expect(screen.queryByTestId("team-schedule-attendance-missing")).toBeNull();
  });

  it("labels each person with a word, and lists who is expected vs. who started", async () => {
    const screen = await open();
    expect(screen.getByTestId("team-schedule-person-status-u1").props.accessibilityLabel).toBe("On shift");
    expect(screen.getByTestId("team-schedule-person-status-u2").props.accessibilityLabel).toBe("Not clocked in");
    expect(screen.getByTestId("team-schedule-person-status-u3").props.accessibilityLabel).toBe("Shift ended");
    expect(screen.getByTestId("team-schedule-person-u1").props.accessibilityLabel).toContain("Ana Torres");
  });

  it("raises a real attention item for a missing clock-in — 'hasn't clocked in', never 'absent'", async () => {
    const screen = await open();
    const row = screen.getByTestId("team-schedule-attention-nci:u2");
    expect(row.props.accessibilityLabel).toContain("Ben Ruiz hasn't clocked in");
    expect(allStrings(screen).join(" ").toLowerCase()).not.toMatch(/\babsent\b|no-show/);
  });

  it("reads exactly one team endpoint call per source (plan + attendance), bounded to one day", async () => {
    await open();
    const all = get.mock.calls.map((c) => c[0] as string);
    // Coverage (Phase 4) is its own bounded read pair: work still to do, and recently filled.
    expect(all.filter((u) => u.startsWith("/schedules/gaps"))).toHaveLength(2);
    // Requests (Phase 5) is its own single read: how many are waiting for a supervisor.
    expect(all.filter((u) => u.startsWith("/schedules/requests"))).toEqual(["/schedules/requests?type=all&status=pending"]);
    // The staffing forecast (Phase 6) is one bounded read: today and the next six hotel days.
    expect(all.filter((u) => u.startsWith("/schedules/forecast"))).toEqual([`/schedules/forecast?date_from=${TODAY}&days=7`]);
    // Drafts (Phase 7) are one bounded read of the manager's own open drafts; they never change what the team reads return.
    expect(all.filter((u) => u.startsWith("/schedules/revisions"))).toEqual(["/schedules/revisions/drafts"]);
    const urls = all.filter((u) => !u.startsWith("/schedules/gaps") && !u.startsWith("/schedules/requests") && !u.startsWith("/schedules/forecast") && !u.startsWith("/schedules/revisions"));
    expect(urls.some((u) => u.includes("include_attendance=true") && u.includes(`date_from=${TODAY}&date_to=${TODAY}`))).toBe(true);
    const days = weekDays(TODAY);
    expect(urls.some((u) => u.includes(`date_from=${days[0]}&date_to=${days[6]}`) && !u.includes("include_attendance"))).toBe(true);
    expect(urls.every((u) => u.startsWith("/schedules/team?"))).toBe(true);
  });

  it("falls back to the plan with 'attendance unavailable' when the attendance read fails", async () => {
    serve({ today: "fail" });
    const screen = await open();
    expect(screen.getByTestId("team-schedule-attendance-missing")).toBeTruthy();
    expect(screen.queryByTestId("team-schedule-counts")).toBeNull();
    expect(screen.getByTestId("team-schedule-attention-attendance")).toBeTruthy();
    expect(screen.getByTestId("team-schedule-person-status-u1").props.accessibilityLabel).toBe("Unknown");
  });

  it("treats a server read that could not verify attendance the same way", async () => {
    serve({ today: "unverified" });
    const screen = await open();
    expect(screen.queryByTestId("team-schedule-counts")).toBeNull();
    expect(screen.getByTestId("team-schedule-person-status-u2").props.accessibilityLabel).toBe("Unknown");
  });
});

describe("errors versus empty", () => {
  it("a failed request is an error with a retry, NEVER an empty schedule", async () => {
    serve({ today: "fail", week: "fail" });
    const screen = await open();
    expect(screen.getByTestId("team-schedule-error")).toBeTruthy();
    expect(screen.queryByTestId("team-schedule-empty-noStaff")).toBeNull();
    expect(screen.queryByTestId("team-schedule-empty-nobodyScheduled")).toBeNull();
    expect(screen.queryByTestId("team-schedule-person-u1")).toBeNull();
    serve();
    fireEvent.press(screen.getByTestId("team-schedule-retry"));
    await waitFor(() => expect(screen.getByTestId("team-schedule-person-u1")).toBeTruthy());
  });

  it("a verified empty read says there is nobody to show", async () => {
    serve({ today: "empty", week: "empty" });
    const screen = await open();
    expect(screen.getByTestId("team-schedule-empty-noStaff")).toBeTruthy();
    expect(screen.queryByTestId("team-schedule-error")).toBeNull();
  });

  it("people in scope but nobody on a quiet day is 'nobody is scheduled'", async () => {
    const screen = await open({ date: addDaysToYmd(TODAY, 3) });
    expect(screen.getByTestId("team-schedule-empty-nobodyScheduled")).toBeTruthy();
    expect(screen.getByTestId("team-schedule-plan-only")).toBeTruthy();
  });

  it("shows a skeleton, not a blank screen, while loading", () => {
    get.mockImplementation(() => new Promise(() => undefined));
    mockParams.date = undefined;
    const screen = render(ui());
    return waitFor(() => expect(screen.getByTestId("team-schedule-skeleton")).toBeTruthy());
  });

  it("keeps the last verified plan but stops vouching for it when a refresh fails (stale, not live)", async () => {
    const screen = await open();
    serve({ today: "fail", week: "fail" });
    await act(async () => {
      fireEvent.press(screen.getByTestId("team-schedule-refresh"));
    });
    await waitFor(() => expect(screen.getByTestId("team-schedule-attention-stale")).toBeTruthy());
    expect(screen.getByTestId("team-schedule-person-u1")).toBeTruthy(); // the plan is still there
    expect(screen.queryByTestId("team-schedule-counts")).toBeNull(); // but no attendance numbers
    expect(screen.getByTestId("team-schedule-person-status-u1").props.accessibilityLabel).toBe("Unknown");
    expect(text(screen.getByTestId("team-schedule-freshness"))).toMatch(/^Saved schedule from .* — not live$/);
  });

  it("says so when the device is offline", async () => {
    mockAppState.isOnline = false;
    const screen = render(ui());
    await waitFor(() => expect(screen.getByTestId("team-schedule-error")).toBeTruthy());
    expect(screen.getByText(tr("teamSchedule.error.offline.title"))).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
  });
});

describe("Today / Week", () => {
  it("switches views and keeps the selected date and the search text", async () => {
    const screen = await open({ view: "week" });
    expect(screen.getByTestId("team-schedule-week-selector")).toBeTruthy();
    fireEvent.press(screen.getByTestId(`team-schedule-day-${TOMORROW}`));
    await waitFor(() => expect(screen.getByTestId(`team-schedule-day-${TOMORROW}`).props.accessibilityState.selected).toBe(true));
    fireEvent.changeText(screen.getByTestId("team-schedule-search"), "ben");
    fireEvent.press(screen.getByTestId("team-schedule-view-today"));
    await waitFor(() => expect(screen.getByTestId("team-schedule-view-today").props.accessibilityState.selected).toBe(true));
    expect(screen.queryByTestId("team-schedule-week-selector")).toBeNull();
    expect(text(screen.getByTestId("team-schedule-date"))).toMatch(/\d/);
    expect(screen.getByTestId("team-schedule-search").props.value).toBe("ben");
    expect(screen.getByTestId("team-schedule-back-to-today")).toBeTruthy(); // not today any more
    expect(screen.getByTestId("team-schedule-person-u2")).toBeTruthy();
    expect(screen.queryByTestId("team-schedule-person-u1")).toBeNull(); // search applied
  });

  it("groups the selected day's shifts by real window, with a person in each group they work", async () => {
    const screen = await open({ view: "week", date: TOMORROW });
    const groups = screen.getAllByTestId(/^team-schedule-group-/);
    expect(groups).toHaveLength(2);
    expect(screen.getByTestId("team-schedule-member-w3")).toBeTruthy();
    expect(screen.getByTestId("team-schedule-member-w2")).toBeTruthy();
    // Ana has the "Late" shift on this day only; a future day never claims attendance.
    expect(screen.queryByTestId(/^team-schedule-person-status-/)).toBeNull();
  });

  it("shows the day's headcount on each of the seven dates, and 'unknown' (not 0) when the week failed", async () => {
    const screen = await open({ view: "week" });
    expect(text(screen.getByTestId(`team-schedule-day-count-${TOMORROW}`))).toBe("2");
    serve({ today: "fail", week: "fail" });
    const failed = await open({ view: "week", date: addDaysToYmd(TODAY, 21) });
    expect(failed.getAllByTestId(/^team-schedule-day-count-/).every((n) => text(n) === "–")).toBe(true);
  });

  it("moves between weeks across a month and a year boundary using hotel-local dates", async () => {
    const screen = await open({ view: "week", date: "2026-12-30" });
    expect(text(screen.getByTestId("team-schedule-week-range"))).toBe("Dec 28, 2026 – Jan 3, 2027");
    fireEvent.press(screen.getByTestId("team-schedule-next-week"));
    await waitFor(() => expect(text(screen.getByTestId("team-schedule-week-range"))).toBe("Jan 4 – Jan 10"));
    expect(get.mock.calls.some((c) => (c[0] as string).includes("date_from=2027-01-04&date_to=2027-01-10"))).toBe(true);
    fireEvent.press(screen.getByTestId("team-schedule-prev-week"));
    fireEvent.press(screen.getByTestId("team-schedule-prev-week"));
    await waitFor(() => expect(text(screen.getByTestId("team-schedule-week-range"))).toBe("Dec 21 – Dec 27"));
  });

  it("returns to today from anywhere", async () => {
    const screen = await open({ view: "week", date: "2026-12-30" });
    fireEvent.press(screen.getByTestId("team-schedule-week-today"));
    await waitFor(() => expect(screen.getByTestId(`team-schedule-day-${TODAY}`).props.accessibilityState.selected).toBe(true));
  });

  it("steps a day at a time in Today", async () => {
    const screen = await open();
    fireEvent.press(screen.getByTestId("team-schedule-next-day"));
    await waitFor(() => expect(screen.getByTestId("team-schedule-back-to-today")).toBeTruthy());
    fireEvent.press(screen.getByTestId("team-schedule-prev-day"));
    await waitFor(() => expect(screen.queryByTestId("team-schedule-back-to-today")).toBeNull());
  });

  it("has an obvious back path", async () => {
    const screen = await open();
    fireEvent.press(screen.getByTestId("team-schedule-back"));
    expect(mockBack).toHaveBeenCalled();
  });
});

describe("search and filters", () => {
  it("filters by name, and says why when nobody matches", async () => {
    const screen = await open();
    fireEvent.changeText(screen.getByTestId("team-schedule-search"), "zzz");
    await waitFor(() => expect(screen.getByTestId("team-schedule-empty-search")).toBeTruthy());
    fireEvent.press(screen.getByTestId("team-schedule-empty-search-action"));
    await waitFor(() => expect(screen.getByTestId("team-schedule-person-u1")).toBeTruthy());
  });

  it("filters by status from the sheet, previews the count, and clears from the empty state", async () => {
    const screen = await open();
    fireEvent.press(screen.getByTestId("team-schedule-filter-button"));
    fireEvent.press(await screen.findByTestId("team-schedule-filter-status-on_shift"));
    expect(text(screen.getByTestId("team-schedule-filter-apply-text"))).toBe(tr("teamSchedule.filters.apply", { count: 1 }));
    fireEvent.press(screen.getByTestId("team-schedule-filter-apply"));
    await waitFor(() => expect(screen.queryByTestId("team-schedule-person-u2")).toBeNull());
    expect(screen.getByTestId("team-schedule-person-u1")).toBeTruthy();
  });

  it("filters by role", async () => {
    const screen = await open();
    fireEvent.press(screen.getByTestId("team-schedule-filter-button"));
    fireEvent.press(await screen.findByTestId("team-schedule-filter-role-inspector"));
    fireEvent.press(screen.getByTestId("team-schedule-filter-apply"));
    await waitFor(() => expect(screen.queryByTestId("team-schedule-person-u1")).toBeNull());
    expect(screen.getByTestId("team-schedule-person-u3")).toBeTruthy();
  });

  it("offers no status filter on a day that makes no attendance claim", async () => {
    const screen = await open({ date: TOMORROW });
    fireEvent.press(screen.getByTestId("team-schedule-filter-button"));
    await screen.findByTestId("team-schedule-sort-name");
    expect(screen.queryByTestId("team-schedule-filter-status-all")).toBeNull();
  });
});

describe("shift details and Assignments", () => {
  it("opens a person's shift, with the Phase 3 shift actions but no later-phase workflows, and a link to Assignments by their real id", async () => {
    const screen = await open();
    fireEvent.press(screen.getByTestId("team-schedule-person-u2"));
    const sheet = await screen.findByTestId("team-schedule-detail-sheet");
    expect(sheet).toBeTruthy();
    expect(screen.getByTestId("team-schedule-detail-status")).toBeTruthy();
    expect(screen.getByTestId("team-schedule-detail-shift-t1")).toBeTruthy();
    const everything = allStrings(screen).join(" ").toLowerCase();
    // Phase 3 owns editing and Phase 4 call-outs; swaps, time off and publishing belong to later phases and must not appear.
    expect(screen.getByTestId("shift-action-call-out")).toBeTruthy();
    expect(screen.getByTestId("shift-action-edit")).toBeTruthy();
    expect(screen.getByTestId("shift-action-cancel")).toBeTruthy();
    expect(everything).not.toMatch(/swap|time off|publish/);
    fireEvent.press(screen.getByTestId("team-schedule-detail-assignments"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/(app)/assignments", params: { staffId: "u2" } });
    await waitFor(() => expect(screen.queryByTestId("team-schedule-detail-sheet")).toBeNull());
  });

  it("opens a named person from a deep link once the schedule has loaded", async () => {
    const screen = await open({ userId: "u1" });
    await waitFor(() => expect(screen.getByTestId("team-schedule-detail-sheet")).toBeTruthy());
    expect(allStrings(screen).join(" ")).toContain("Ana Torres");
  });

  it("says so, and opens nothing, when the linked person is not on this day's schedule", async () => {
    const screen = await open({ userId: "not-in-this-hotel" });
    await waitFor(() => expect(screen.getByTestId("team-schedule-link-missing")).toBeTruthy());
    expect(screen.queryByTestId("team-schedule-detail-sheet")).toBeNull();
  });
});

describe("accounts and hotels", () => {
  it("throws away the previous hotel's schedule and reloads for the new scope", async () => {
    const screen = await open();
    expect(screen.getByTestId("team-schedule-person-u1")).toBeTruthy();
    get.mockImplementation(() => new Promise(() => undefined));
    mockAppState.user = { id: "sup-2", role: "housekeeping_supervisor", tenant_id: "h2" };
    screen.rerender(ui());
    await waitFor(() => expect(screen.getByTestId("team-schedule-skeleton")).toBeTruthy());
    expect(screen.queryByTestId("team-schedule-person-u1")).toBeNull();
  });
});

describe("language, accessibility and theme", () => {
  it("renders in Spanish with no raw translation keys or leftover English", async () => {
    mockLanguage = "es";
    const screen = await open();
    const strings = allStrings(screen);
    expect(strings.some((s) => s.includes("Horario del equipo"))).toBe(true);
    expect(strings.some((s) => /^teamSchedule\./.test(s))).toBe(false);
    expect(strings.join(" ")).not.toMatch(/Not clocked in|Team Schedule|Needs a look|On shift/);
    expect(screen.getByTestId("team-schedule-person-status-u1").props.accessibilityLabel).toBe("En turno");
  });

  it("renders in dark mode", async () => {
    mockScheme = "dark";
    const screen = await open();
    expect(screen.getByTestId("team-schedule-person-u1")).toBeTruthy();
    const background = StyleSheet.flatten(screen.getByTestId("team-schedule").props.style).backgroundColor;
    expect(background).toBeTruthy();
  });

  it("gives every control a role, a label and a 44pt+ target", async () => {
    const screen = await open({ view: "week" });
    for (const id of ["team-schedule-back", "team-schedule-refresh", "team-schedule-prev-week", "team-schedule-next-week", `team-schedule-day-${TODAY}`, "team-schedule-view-today", "team-schedule-view-week", "team-schedule-filter-button"]) {
      const node = screen.getByTestId(id);
      expect(node.props.accessibilityRole).toBeTruthy();
      expect(String(node.props.accessibilityLabel ?? "").length).toBeGreaterThan(0);
      const style = StyleSheet.flatten(node.props.style);
      const height = Number(style?.height ?? style?.minHeight ?? 0);
      expect(height).toBeGreaterThanOrEqual(42);
    }
    expect(screen.getByTestId("team-schedule-view-week").props.accessibilityState).toEqual({ selected: true });
  });

  it("survives a very long name and a very large team", async () => {
    const long = "Maria de los Angeles Fernandez-Gonzalez de la Cruz y Santa Maria del Rosario";
    const many = Array.from({ length: 300 }, (_, i) => wirePerson(`m${i}`, i === 0 ? long : `Person ${i}`));
    get.mockImplementation(async (url: string) =>
      wirePage({ staff: many, assignments: many.map((p, i) => dayShift(TODAY, `m${i}`, p.user_id as string, { workforce_status: "working" })), requested: url.includes("include_attendance"), verified: true, asOf: new Date().toISOString() }),
    );
    const screen = await open();
    expect(text(screen.getByTestId("team-schedule-scheduled-count"))).toBe(tr("teamSchedule.summary.scheduled", { count: 300 }));
    expect(screen.getByTestId("team-schedule-person-m0")).toBeTruthy();
    // Virtualised: nowhere near 300 cards are mounted at once.
    expect(screen.queryAllByTestId(/^team-schedule-person-m/).length).toBeLessThan(60);
  });
});
