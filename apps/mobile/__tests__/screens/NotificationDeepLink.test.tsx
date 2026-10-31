import React from "react";
import { act, configure, fireEvent, render, waitFor } from "@testing-library/react-native";
import { makeTranslator } from "../helpers/i18n";
import { person, wireItem, wireShiftBrief, wireSwap, wireSwapItem, inbox } from "../helpers/requestFixtures";

/* Issue B of the final audit: tapping a schedule notification must land on the thing it is about. These render the REAL
   employee screens with the params the notification router passes, and double only the network, the router, the
   translator, the app store and the icon font. */

let mockParams: Record<string, string> = {};
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({ __esModule: true, default: () => "light" }));
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() },
  useLocalSearchParams: () => mockParams,
  Redirect: () => null,
}));
jest.mock("react-i18next", () => {
  const { makeTranslator: translator } = require("../helpers/i18n");
  const t = translator(() => "en");
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});
const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
jest.mock("@/lib/theme/useToast", () => ({ useToast: () => mockToast }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 20, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));
const mockAppState = { isOnline: true, hotelTimezone: "America/Chicago", user: { id: "u1", role: "housekeeper", tenant_id: "h1" } };
jest.mock("@/stores/appStore", () => ({
  useAppStore: (selector?: (state: unknown) => unknown) => (selector ? selector(mockAppState) : mockAppState),
}));

import SchedulingScreen from "@/app/(app)/scheduling/index";
import { MyOffersScreen } from "@/components/scheduling/MyOffersScreen";
import { MyRequestsScreen } from "@/components/scheduling/MyRequestsScreen";
import { api } from "@/lib/api/client";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { allStrings } from "../helpers/workspaceHarness";

const get = api.get as jest.Mock;
const tr = makeTranslator(() => "en");
configure({ asyncUtilTimeout: 5000 });
jest.setTimeout(30000);

const wrap = (node: React.ReactNode) => <ThemeProvider>{node}</ThemeProvider>;
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
const ID = "c0000001-0000-4000-8000-000000000001";
const OTHER = "c0000002-0000-4000-8000-000000000002";

const assignment = (id: string, work_date: string, over: Record<string, unknown> = {}) => ({
  id, work_date, is_on_shift: false, clocked_in_at: null, clocked_out_at: null,
  shifts: { name: "Morning", start_time: "07:00:00", end_time: "15:00:00" }, ...over,
});
const ranges = () => get.mock.calls.filter(([url]) => String(url).startsWith("/schedules/assignments/my-schedule")).map(([url]) => String(url).split("?")[1]);

beforeEach(() => {
  jest.clearAllMocks();
  get.mockReset();
  mockParams = {};
});

describe("My Schedule opens the week a notification names", () => {
  const serve = (rows: Array<Record<string, unknown>>) =>
    get.mockImplementation(async (url: string) => {
      if (url === "/schedules/me/requests") return { data: [], meta: { counts: { action_required: 0 } } };
      if (url === "/schedules/me/offers?history=true" || url.startsWith("/schedules/me/offers")) return { data: [] };
      if (url.startsWith("/schedules/assignments/my-schedule")) return { data: rows };
      throw new Error(`unexpected GET ${url}`);
    });
  const open = async () => {
    const screen = render(wrap(<SchedulingScreen />));
    await settle();
    return screen;
  };

  it("loads the Monday-to-Sunday week that contains the notified future date, not the current week", async () => {
    mockParams = { date: "2030-06-12" }; // a Wednesday
    serve([assignment("a-1", "2030-06-12")]);
    const screen = await open();
    await waitFor(() => expect(screen.getByTestId("my-schedule-highlight")).toBeTruthy());
    expect(ranges()).toEqual(["date_from=2030-06-10&date_to=2030-06-16"]);
    expect(screen.queryByTestId("my-schedule-shift-unavailable")).toBeNull();
    expect(screen.queryByTestId("week-current")).not.toBeNull();                       // a way back to this week
  });

  it("keeps an overnight shift on the day it starts, across a month boundary", async () => {
    mockParams = { date: "2030-07-31" };
    serve([assignment("a-night", "2030-07-31", { shifts: { name: "Night", start_time: "23:00:00", end_time: "07:00:00" } })]);
    const screen = await open();
    await waitFor(() => expect(screen.getByTestId("my-schedule-highlight")).toBeTruthy());
    expect(ranges()).toEqual(["date_from=2030-07-29&date_to=2030-08-04"]);
    expect(allStrings(screen).join(" ")).toContain("Night 11:00 PM–7:00 AM");
  });

  it("opens the week of a DST change with seven consecutive days", async () => {
    mockParams = { date: "2030-03-10" }; // US clocks go forward that Sunday
    serve([assignment("a-dst", "2030-03-10")]);
    const screen = await open();
    await waitFor(() => expect(screen.getByTestId("my-schedule-highlight")).toBeTruthy());
    expect(ranges()).toEqual(["date_from=2030-03-04&date_to=2030-03-10"]);
    for (const day of ["04", "05", "06", "07", "08", "09", "10"]) expect(screen.getByTestId(day === "10" ? "my-schedule-highlight" : `week-row-2030-03-${day}`)).toBeTruthy();
  });

  it("says so when the notified shift is no longer on the person's schedule", async () => {
    mockParams = { date: "2030-06-12" };
    serve([]); // cancelled, reassigned, or never theirs: the server returns nothing for them
    const screen = await open();
    await screen.findByTestId("my-schedule-shift-unavailable");
    expect(allStrings(screen).join(" ")).toContain(tr("scheduling.week.shiftUnavailable"));
    expect(screen.queryByTestId("my-schedule-highlight")).toBeNull();
  });

  it("highlights the exact shift when the notification names one, and says so when that shift is gone", async () => {
    mockParams = { date: "2030-06-12", assignmentId: ID };
    serve([assignment("other", "2030-06-12"), assignment(ID, "2030-06-13")]);
    let screen = await open();
    await waitFor(() => expect(screen.getByTestId("my-schedule-highlight")).toBeTruthy());
    expect(screen.queryByTestId("week-row-2030-06-13")).toBeNull();                    // the named shift's day is the highlighted one
    expect(screen.getByTestId("week-row-2030-06-12")).toBeTruthy();
    screen.unmount();

    mockParams = { date: "2030-06-12", assignmentId: OTHER };
    screen = await open();
    await screen.findByTestId("my-schedule-shift-unavailable");
  });

  it("ignores a date that is not a real calendar day and opens the current week", async () => {
    mockParams = { date: "2030-02-31" };
    serve([]);
    await open();
    const [range] = ranges();
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const iso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const [from, to] = range.replace("date_from=", "").split("&date_to=");
    expect(from <= iso && iso <= to).toBe(true);
  });

  it("moves between weeks without a stale answer overwriting the week on screen", async () => {
    mockParams = { date: "2030-06-12" };
    let release: (rows: Array<Record<string, unknown>>) => void = () => undefined;
    get.mockImplementation(async (url: string) => {
      if (url === "/schedules/me/requests") return { data: [], meta: { counts: {} } };
      if (url.startsWith("/schedules/me/offers")) return { data: [] };
      if (url === "/schedules/assignments/my-schedule?date_from=2030-06-10&date_to=2030-06-16") {
        return new Promise((resolve) => { release = (rows) => resolve({ data: rows }); });   // slow
      }
      if (url === "/schedules/assignments/my-schedule?date_from=2030-06-17&date_to=2030-06-23") return { data: [assignment("later", "2030-06-18")] };
      throw new Error(`unexpected GET ${url}`);
    });
    const screen = render(wrap(<SchedulingScreen />));
    await settle();
    fireEvent.press(screen.getByTestId("week-next"));
    await settle();
    await act(async () => { release([assignment("stale", "2030-06-11")]); });
    await settle();
    expect(screen.queryByTestId("swap-from-stale")).toBeNull();
    expect(screen.getByTestId("swap-from-later")).toBeTruthy();
  });

  it("shows a retryable error instead of an empty week when the schedule cannot be read", async () => {
    get.mockImplementation(async (url: string) => {
      if (url.startsWith("/schedules/assignments/my-schedule")) throw Object.assign(new Error("down"), { status: 500 });
      if (url === "/schedules/me/requests") return { data: [], meta: { counts: {} } };
      return { data: [] };
    });
    const screen = await open();
    await screen.findByTestId("my-schedule-failed");
    expect(allStrings(screen).join(" ")).not.toContain(tr("scheduling.dayOff"));          // never a false "day off"
    expect(screen.queryByTestId("my-schedule-shift-unavailable")).toBeNull();
    serve([assignment("a-1", "2030-06-12")]);
    fireEvent.press(screen.getByTestId("my-schedule-retry"));
    await settle();
    expect(screen.queryByTestId("my-schedule-failed")).toBeNull();
  });
});

describe("Offers and requests reveal what the notification names", () => {
  const offer = (id: string) => ({ id, status: "pending", expires_at: null, shift: { id: "g1", shift_name: "Morning", work_date: "2030-01-08", start_time: "07:00:00", end_time: "15:00:00", starts_at: "2030-01-08T13:00:00Z", ends_at: "2030-01-08T21:00:00Z", required_role: null, status: "open", version: 1 } });

  it("highlights the named offer when it is still live", async () => {
    mockParams = { offerId: ID };
    get.mockImplementation(async () => ({ data: [offer(ID)] }));
    const screen = render(wrap(<MyOffersScreen />));
    await settle();
    await screen.findByTestId("offer-highlight");
    expect(screen.queryByTestId("my-offers-offer-unavailable")).toBeNull();
  });

  it("says the offer is gone when it is not one of this person's live offers (withdrawn, answered, or someone else's)", async () => {
    mockParams = { offerId: OTHER };
    get.mockImplementation(async () => ({ data: [offer(ID)] }));
    const screen = render(wrap(<MyOffersScreen />));
    await settle();
    await screen.findByTestId("my-offers-offer-unavailable");
    expect(screen.queryByTestId("offer-highlight")).toBeNull();
  });

  it("opens the named swap request straight away", async () => {
    mockParams = { requestId: ID };
    get.mockImplementation(async (url: string) => {
      if (url === "/schedules/me/requests") return inbox([wireSwapItem({ id: ID, status: "proposed", needs_my_response: true, needs_action: false, user: person("u2", "Bea Cruz"), counterpart: person("u1", "Ana Lopez") })]);
      if (url === `/schedules/swaps/${ID}`) return { data: wireSwap({ id: ID, viewer: "counterpart", status: "proposed", can: { respond: true, cancel: false, approve: false, deny: false }, analysis: { blockers: [], warnings: [] } }) };
      if (url === `/schedules/swaps/${ID}/history`) return { data: [] };
      throw new Error(`unexpected GET ${url}`);
    });
    const screen = render(wrap(<MyRequestsScreen />));
    await settle();
    await waitFor(() => expect(get).toHaveBeenCalledWith(`/schedules/swaps/${ID}`));
    expect(screen.queryByTestId("my-requests-unavailable")).toBeNull();
  });

  it("never opens a request that is not in this person's own list, it only says it is unavailable", async () => {
    mockParams = { requestId: OTHER };
    get.mockImplementation(async (url: string) => {
      if (url === "/schedules/me/requests") return inbox([wireItem({ id: ID })]);
      throw new Error(`unexpected GET ${url}`);
    });
    const screen = render(wrap(<MyRequestsScreen />));
    await settle();
    await screen.findByTestId("my-requests-unavailable");
    expect(get).not.toHaveBeenCalledWith(expect.stringContaining(OTHER));
    void wireShiftBrief;
  });
});
