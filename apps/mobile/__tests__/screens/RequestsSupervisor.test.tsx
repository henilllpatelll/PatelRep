import React from "react";
import type { ReactTestInstance } from "react-test-renderer";
import { act, configure, fireEvent, render, waitFor } from "@testing-library/react-native";
import { makeTranslator } from "../helpers/i18n";

/* The REAL supervisor Requests inbox, the request drawer (time off and shift swaps), Team Availability and the Team Schedule
   entry points. Only the network, the router, the translator, the app store and the icon font are doubled. The server doubled
   here is the Phase 5 API (routers/scheduling_inbox.py, scheduling_leave.py, scheduling_swaps.py, scheduling_availability.py). */

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({ __esModule: true, default: () => "light" }));
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() },
  useLocalSearchParams: () => ({}),
  Redirect: () => null,
}));
jest.mock("react-i18next", () => {
  const { makeTranslator: translator } = require("../helpers/i18n");
  const t = translator(() => "en");
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 20, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));
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
import TeamScheduleRoute from "@/app/(app)/team-schedule/index";
import { RequestsScreen } from "@/components/scheduling/RequestsScreen";
import { TeamAvailabilityScreen } from "@/components/scheduling/TeamAvailabilityScreen";
import { api } from "@/lib/api/client";
import { hotelDateKey, zonedTimeToInstant } from "@/lib/housekeeping/hotelTime";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { allStrings } from "../helpers/workspaceHarness";
import { apiError, inbox, person, wireException, wireImpact, wireItem, wireLeave, wireShiftBrief, wireSwap, wireSwapItem, wireWeek } from "../helpers/requestFixtures";
import { wirePage, wirePerson, wireShift, ZONE } from "../helpers/teamScheduleFixtures";

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const tr = (key: string, values?: Record<string, unknown>) => makeTranslator("en")(key, values);
const TODAY = hotelDateKey(new Date(), ZONE) as string;

configure({ asyncUtilTimeout: 5000 });
jest.setTimeout(30000);

const wrap = (node: React.ReactNode) => <ThemeProvider>{node}</ThemeProvider>;
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
const text = (node: ReactTestInstance) =>
  node
    .findAll((n) => (n.type as unknown) === "Text")
    .map((n) => [n.props.children].flat(2).filter((part) => typeof part === "string" || typeof part === "number").join(""))
    .join(" ")
    .trim();
const disabled = (node: ReactTestInstance) => node.props.accessibilityState?.disabled === true;

let world: {
  list: Array<Record<string, unknown>>;
  leave: Record<string, unknown>;
  swap: Record<string, unknown>;
  team: Array<Record<string, unknown>>;
  member: Record<string, unknown>;
  listFails: boolean;
  requestUrls: string[];
};

const shiftImpact = (over: Record<string, unknown> = {}) => ({ ...wireShiftBrief(), overlap: "full", resolved: false, coverage: null, ...over });

beforeEach(() => {
  jest.clearAllMocks();
  get.mockReset();
  post.mockReset();
  mockAppState.isOnline = true;
  world = {
    list: [wireItem(), wireSwapItem()],
    leave: wireLeave(),
    swap: wireSwap(),
    team: [],
    member: {},
    listFails: false,
    requestUrls: [],
  };
  get.mockImplementation(async (url: string) => {
    if (url.startsWith("/schedules/requests")) {
      world.requestUrls.push(url);
      if (world.listFails) throw Object.assign(new Error("down"), { status: 500 });
      return inbox(world.list);
    }
    if (url === "/schedules/time-off/l1") return { data: world.leave };
    if (url === "/schedules/swaps/w1") return { data: world.swap };
    if (url.startsWith("/schedules/availability/team/")) return { data: world.member };
    if (url.startsWith("/schedules/availability/team")) return { data: world.team, meta: { total: world.team.length, truncated: false } };
    throw new Error(`unexpected GET ${url}`);
  });
});

/* ─── The inbox ───────────────────────────────────────────────────────────── */

describe("Requests inbox", () => {
  const open = async () => {
    const screen = render(wrap(<RequestsScreen />));
    await settle();
    await waitFor(() => expect(screen.getByTestId("requests-list")).toBeTruthy());
    return screen;
  };

  it("lists time off and swaps together with the number waiting, the effect on the schedule and the status", async () => {
    const screen = await open();
    expect(text(screen.getByTestId("requests-pending-count"))).toBe("2 waiting for you");
    expect(world.requestUrls[0]).toBe("/schedules/requests?type=all&status=pending");
    const leave = text(screen.getByTestId("request-time_off-l1"));
    expect(leave).toContain("Ana Lopez");
    expect(leave).toContain("Housekeeper");
    expect(leave).toContain("Time off");
    expect(leave).toContain("Jan 8 – Jan 9");
    expect(leave).toContain("Personal");
    expect(leave).toContain("2 scheduled shift(s) in these dates");
    expect(leave).toContain("Pending");
    const swap = text(screen.getByTestId("request-shift_swap-w1"));
    expect(swap).toContain("Ana Lopez ⇄ Bea Cruz");
    expect(swap).toContain("Waiting for supervisor");
    expect(allStrings(screen).join(" ")).not.toMatch(/notified/i);
  });

  it("never turns an unreadable schedule into a count", async () => {
    world.list = [wireItem({ impact: { verified: false, shift_count: null } })];
    const screen = await open();
    const card = text(screen.getByTestId("request-time_off-l1"));
    expect(card).toContain("Schedule impact could not be checked");
    expect(card).not.toMatch(/\d scheduled shift/);
  });

  it("asks the server for exactly the filters chosen and says so when nothing matches", async () => {
    const screen = await open();
    world.list = [];
    fireEvent.press(screen.getByTestId("requests-status-approved"));
    await waitFor(() => expect(world.requestUrls.at(-1)).toBe("/schedules/requests?type=all&status=approved"));
    await screen.findByTestId("requests-empty");
    fireEvent.press(screen.getByTestId("requests-type-shift_swap"));
    await waitFor(() => expect(world.requestUrls.at(-1)).toBe("/schedules/requests?type=shift_swap&status=approved"));
    fireEvent.press(screen.getByTestId("requests-range-week"));
    await waitFor(() => expect(world.requestUrls.at(-1)).toMatch(/^\/schedules\/requests\?type=shift_swap&status=approved&date_from=\d{4}-\d{2}-\d{2}&date_to=\d{4}-\d{2}-\d{2}$/));
    fireEvent.changeText(screen.getByTestId("requests-search"), "bea");
    await waitFor(() => expect(world.requestUrls.at(-1)).toContain("&q=bea"));
  });

  it("says when requests could not be loaded, and keeps the last list when a refresh fails", async () => {
    world.listFails = true;
    const screen = render(wrap(<RequestsScreen />));
    await settle();
    await screen.findByTestId("requests-failed");
    world.listFails = false;
    fireEvent.press(screen.getByTestId("requests-retry"));
    await screen.findByTestId("request-time_off-l1");
    world.listFails = true;
    fireEvent.press(screen.getByTestId("requests-status-all"));
    await settle();
    await waitFor(() => expect(screen.queryByTestId("request-time_off-l1")).toBeNull());       // a list for other filters is not shown as this one
    await screen.findByTestId("requests-failed");
  });

  it("warns when offline", async () => {
    mockAppState.isOnline = false;
    const screen = await open();
    expect(screen.getByTestId("requests-offline")).toBeTruthy();
  });

  it("reads as accessible: roles, labels and a live count", async () => {
    const screen = await open();
    expect(screen.getByTestId("requests-pending-count").props.accessibilityLiveRegion).toBe("polite");
    expect(screen.getByTestId("requests-status").props.accessibilityRole).toBe("tablist");
    expect(screen.getByTestId("requests-status-pending").props.accessibilityState).toEqual({ selected: true });
    const card = screen.getByTestId("request-time_off-l1");
    expect(card.props.accessibilityRole).toBe("button");
    expect(card.props.accessibilityLabel).toContain("Ana Lopez");
    expect(card.props.accessibilityLabel).toContain("Pending");
  });
});

/* ─── Deciding time off ───────────────────────────────────────────────────── */

describe("Time-off drawer", () => {
  const openLeave = async () => {
    const screen = render(wrap(<RequestsScreen />));
    await settle();
    fireEvent.press(await screen.findByTestId("request-time_off-l1"));
    await screen.findByTestId("request-approve");
    return screen;
  };

  it("shows the request, who asked, why, and the real shifts it touches before anything is decided", async () => {
    world.leave = wireLeave({ impact: wireImpact({ shift_count: 2, unresolved_count: 2, shifts: [shiftImpact({ id: "s1" }), shiftImpact({ id: "s9", work_date: "2030-01-09", overlap: "partial" })] }) });
    const screen = await openLeave();
    const sheet = text(screen.getByTestId("request-sheet"));
    expect(sheet).toContain("Ana Lopez");
    expect(sheet).toContain("Family trip");
    expect(sheet).toContain("2 scheduled shift(s) fall inside these dates.");
    expect(sheet).toContain("If you approve, these shifts stay on the schedule until you resolve them.");
    expect(sheet).toContain("Whole shift is inside the time off");
    expect(sheet).toContain("Part of the shift is inside the time off");
    expect(sheet).toContain("2 shift(s) still need a decision");
    expect(text(screen.getByTestId("request-status"))).toBe("Pending");
  });

  it("approves with the version it read, then says what is NOT resolved yet and offers the schedule", async () => {
    world.leave = wireLeave({ impact: wireImpact({ shift_count: 1, unresolved_count: 1, shifts: [shiftImpact()] }) });
    const screen = await openLeave();
    post.mockResolvedValue({
      data: wireLeave({ status: "approved", version: 2, can: { approve: false, deny: false, cancel: true, cancel_needs_reason: true }, decided_by: person("sup-1", "Sam Wu"),
        impact: wireImpact({ shift_count: 1, unresolved_count: 1, shifts: [shiftImpact()] }) }),
      meta: { follow_up_required: true },
    });
    fireEvent.press(screen.getByTestId("request-approve"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/schedules/time-off/l1/approve", { expected_version: 1 }));
    await waitFor(() => expect(text(screen.getByTestId("request-status"))).toBe("Approved"));
    expect(text(screen.getByTestId("request-notice"))).toBe("Approved. The decision is recorded.");
    const sheet = text(screen.getByTestId("request-sheet"));
    expect(sheet).toContain("Approving does not remove or move these shifts.");
    expect(sheet).toContain("1 shift(s) still need a decision");                      // approval is not the same as resolved
    expect(sheet).not.toContain("Every shift in these dates has been covered");
    fireEvent.press(screen.getByTestId("request-open-schedule"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/(app)/team-schedule", params: { date: "2030-01-08" } });
    await waitFor(() => expect(world.requestUrls.length).toBeGreaterThan(1));          // the list behind the drawer re-read
  });

  it("says the schedule is fully handled only when every shift is covered", async () => {
    world.leave = wireLeave({ status: "approved", can: { approve: false, deny: false, cancel: true, cancel_needs_reason: true },
      impact: wireImpact({ shift_count: 1, unresolved_count: 0, shifts: [shiftImpact({ resolved: true, coverage: { gap_id: "g1", status: "filled", resolution: "direct_assignment", replacement: person("u2", "Bea Cruz") } })] }) });
    const screen = render(wrap(<RequestsScreen />));
    await settle();
    fireEvent.press(await screen.findByTestId("request-time_off-l1"));
    await screen.findByTestId("leave-unresolved");
    expect(text(screen.getByTestId("leave-unresolved"))).toContain("Every shift in these dates has been covered or closed.");
    expect(text(screen.getByTestId("leave-impact-s1"))).toContain("Covered by Bea Cruz");
    expect(screen.queryByTestId("request-open-schedule")).toBeNull();
  });

  it("will not deny without a reason, then sends it", async () => {
    const screen = await openLeave();
    fireEvent.press(screen.getByTestId("request-deny"));
    const confirm = await screen.findByTestId("request-confirm-reason");
    expect(disabled(confirm)).toBe(true);
    fireEvent.changeText(screen.getByTestId("request-reason"), "Inventory week");
    await waitFor(() => expect(disabled(screen.getByTestId("request-confirm-reason"))).toBe(false));
    post.mockResolvedValue({ data: wireLeave({ status: "denied", version: 2, decision_reason: "Inventory week", can: { approve: false, deny: false, cancel: false, cancel_needs_reason: false } }) });
    fireEvent.press(screen.getByTestId("request-confirm-reason"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/schedules/time-off/l1/deny", { expected_version: 1, reason: "Inventory week" }));
    await waitFor(() => expect(text(screen.getByTestId("request-status"))).toBe("Denied"));
    expect(screen.queryByTestId("request-approve")).toBeNull();
  });

  it("reloads the request when someone else decided first, and shows why in words", async () => {
    const screen = await openLeave();
    post.mockRejectedValue(apiError(409, "request_not_pending", { current_status: "approved" }));
    world.leave = wireLeave({ status: "approved", version: 2, can: { approve: false, deny: false, cancel: true, cancel_needs_reason: true } });
    fireEvent.press(screen.getByTestId("request-approve"));
    await screen.findByTestId("request-action-failed");
    expect(text(screen.getByTestId("request-action-failed"))).toBe("This request was already decided. We reloaded it.");
    await waitFor(() => expect(text(screen.getByTestId("request-status"))).toBe("Approved"));
    expect(screen.queryByTestId("request-approve")).toBeNull();                       // the buttons follow the server's new state
    expect(text(screen.getByTestId("request-notice"))).toBe("We reloaded this request. Check it and decide again.");
  });

  it("says a write it could not confirm is unconfirmed, and keeps the buttons so the supervisor can check", async () => {
    const screen = await openLeave();
    post.mockRejectedValue(new Error("Network request failed"));
    fireEvent.press(screen.getByTestId("request-approve"));
    await screen.findByTestId("request-action-failed");
    expect(text(screen.getByTestId("request-action-failed"))).toBe("We could not confirm that. Check the request before you try again.");
    expect(screen.getByTestId("request-approve")).toBeTruthy();
    expect(text(screen.getByTestId("request-status"))).toBe("Pending");
  });

  it("pauses decisions when offline", async () => {
    const screen = await openLeave();
    mockAppState.isOnline = false;
    screen.rerender(wrap(<RequestsScreen />));
    await settle();
    expect(disabled(screen.getByTestId("request-approve"))).toBe(true);
    expect(disabled(screen.getByTestId("request-deny"))).toBe(true);
    expect(screen.getByTestId("request-offline")).toBeTruthy();
  });

  it("makes cancelling approved leave ask for a reason and warns that nothing is restored", async () => {
    world.leave = wireLeave({ status: "approved", version: 2, can: { approve: false, deny: false, cancel: true, cancel_needs_reason: true },
      impact: wireImpact({ shift_count: 1, unresolved_count: 0, shifts: [shiftImpact({ resolved: true, coverage: { gap_id: "g1", status: "filled", resolution: "direct_assignment", replacement: person("u2", "Bea Cruz") } })] }) });
    const screen = render(wrap(<RequestsScreen />));
    await settle();
    fireEvent.press(await screen.findByTestId("request-time_off-l1"));
    fireEvent.press(await screen.findByTestId("request-cancel"));
    expect(disabled(await screen.findByTestId("request-confirm-reason"))).toBe(true);
    fireEvent.changeText(screen.getByTestId("request-reason"), "Coverage emergency");
    post.mockResolvedValue({ data: wireLeave({ status: "cancelled", version: 3, cancel_reason: "Coverage emergency", can: { approve: false, deny: false, cancel: false, cancel_needs_reason: false },
      impact: wireImpact({ shift_count: 1, unresolved_count: 0, shifts: [shiftImpact({ resolved: true, coverage: { gap_id: "g1", status: "filled", resolution: "direct_assignment", replacement: person("u2", "Bea Cruz") } })] }) }) });
    fireEvent.press(screen.getByTestId("request-confirm-reason"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/schedules/time-off/l1/cancel", { expected_version: 2, reason: "Coverage emergency" }));
    await waitFor(() => expect(text(screen.getByTestId("request-notice"))).toBe("1 shift(s) were covered or closed while this was approved. Nothing was restored automatically."));
  });
});

/* ─── Deciding a swap ─────────────────────────────────────────────────────── */

describe("Shift swap drawer", () => {
  const openSwap = async () => {
    const screen = render(wrap(<RequestsScreen />));
    await settle();
    fireEvent.press(await screen.findByTestId("request-shift_swap-w1"));
    await screen.findByTestId("swap-approve");
    return screen;
  };

  it("shows both people, what each gives up and takes, and that approval exchanges both at once", async () => {
    const screen = await openSwap();
    expect(text(screen.getByTestId("swap-person-u1"))).toContain("Gives up");
    expect(text(screen.getByTestId("swap-person-u1"))).toContain("Jan 8 · Morning · 7:00 AM – 3:00 PM");
    expect(text(screen.getByTestId("swap-person-u1"))).toContain("Jan 9 · Morning");
    expect(text(screen.getByTestId("swap-person-u2"))).toContain("Jan 9 · Morning");
    expect(text(screen.getByTestId("swap-approve-note"))).toBe("Approving exchanges both shifts at once. Nothing changes until you approve.");
    expect(screen.getByTestId("swap-checks-ok")).toBeTruthy();
  });

  it("approves a clean swap with the version it read", async () => {
    const screen = await openSwap();
    post.mockResolvedValue({ data: wireSwap({ status: "approved", version: 3, analysis: null, can: { respond: false, cancel: false, approve: false, deny: false } }) });
    fireEvent.press(screen.getByTestId("swap-approve"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/schedules/swaps/w1/approve", { expected_version: 2, acknowledge_warnings: false }));
    await waitFor(() => expect(text(screen.getByTestId("request-status"))).toBe("Approved"));
    expect(text(screen.getByTestId("request-notice"))).toBe("Both shifts were exchanged.");
    expect(screen.queryByTestId("swap-approve")).toBeNull();
  });

  it("makes the supervisor acknowledge warnings before approving", async () => {
    world.swap = wireSwap({ analysis: { blockers: [], warnings: [{ code: "insufficient_rest", user_id: "u2" }] } });
    const screen = await openSwap();
    expect(text(screen.getByTestId("swap-warning-insufficient_rest"))).toBe("Little rest between shifts (Bea Cruz)");
    expect(disabled(screen.getByTestId("swap-approve"))).toBe(true);
    fireEvent.press(screen.getByTestId("swap-acknowledge"));
    await waitFor(() => expect(disabled(screen.getByTestId("swap-approve"))).toBe(false));
    post.mockResolvedValue({ data: wireSwap({ status: "approved", version: 3, analysis: null }) });
    fireEvent.press(screen.getByTestId("swap-approve"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/schedules/swaps/w1/approve", { expected_version: 2, acknowledge_warnings: true }));
  });

  it("will not offer approval when the exchange cannot go ahead", async () => {
    world.swap = wireSwap({ analysis: { blockers: [{ code: "approved_time_off", user_id: "u2" }], warnings: [] } });
    const screen = await openSwap();
    expect(text(screen.getByTestId("swap-blocker-approved_time_off"))).toBe("Approved time off during that shift (Bea Cruz)");
    expect(disabled(screen.getByTestId("swap-approve"))).toBe(true);
  });

  it("denies only with a reason", async () => {
    const screen = await openSwap();
    fireEvent.press(screen.getByTestId("swap-deny"));
    expect(disabled(await screen.findByTestId("request-confirm-reason"))).toBe(true);
    fireEvent.changeText(screen.getByTestId("request-reason"), "Training that day");
    post.mockResolvedValue({ data: wireSwap({ status: "denied", version: 3, decision_reason: "Training that day", analysis: null }) });
    fireEvent.press(screen.getByTestId("request-confirm-reason"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/schedules/swaps/w1/deny", { expected_version: 2, reason: "Training that day" }));
    await waitFor(() => expect(text(screen.getByTestId("request-status"))).toBe("Denied"));
  });

  it("reloads when the coworker withdrew during the decision", async () => {
    const screen = await openSwap();
    post.mockRejectedValue(apiError(409, "swap_not_approvable", { current_status: "cancelled" }));
    world.swap = wireSwap({ status: "cancelled", version: 3, analysis: null, can: { respond: false, cancel: false, approve: false, deny: false } });
    fireEvent.press(screen.getByTestId("swap-approve"));
    await screen.findByTestId("request-action-failed");
    expect(text(screen.getByTestId("request-action-failed"))).toBe("This swap isn't waiting for a supervisor any more. We reloaded it.");
    await waitFor(() => expect(text(screen.getByTestId("request-status"))).toBe("Cancelled"));
    expect(screen.queryByTestId("swap-approve")).toBeNull();
  });
});

/* ─── Team availability ───────────────────────────────────────────────────── */

describe("Team availability", () => {
  const teamPerson = (id: string, name: string, over: Record<string, unknown> = {}) => ({
    ...person(id, name), weekly: wireWeek(), exception_count: 0, exceptions: [], submitted: false, freshness: "none", last_updated_at: null, leave: [], ...over,
  });
  const submittedWeek = wireWeek({ 0: { state: "available", windows: [{ start: "07:00", end: "15:00" }] }, 2: { state: "unavailable" } });

  it("shows who submitted what, who submitted nothing, and what is out of date", async () => {
    world.team = [
      teamPerson("u1", "Ana Lopez", { weekly: submittedWeek, submitted: true, freshness: "current", last_updated_at: "2030-01-02T10:00:00+00:00", exception_count: 1 }),
      teamPerson("u2", "Bea Cruz"),
      teamPerson("u3", "Cy Diaz", { weekly: submittedWeek, submitted: true, freshness: "stale", last_updated_at: "2029-01-02T10:00:00+00:00",
        leave: [{ id: "l7", start_date: "2030-01-08", end_date: "2030-01-09", partial: false, status: "approved" }] }),
    ];
    const screen = render(wrap(<TeamAvailabilityScreen />));
    await settle();
    await screen.findByTestId("team-availability-u1");
    expect(text(screen.getByTestId("team-availability-note"))).toContain("A blank day means nothing was submitted, not that the person is free.");
    expect(text(screen.getByTestId("team-availability-week-u1"))).toBe("Available: Mon · Unavailable: Wed · Not submitted: Tue Thu Fri Sat Sun");
    expect(text(screen.getByTestId("team-availability-u1"))).toContain("Updated Jan 2");
    expect(text(screen.getByTestId("team-availability-u1"))).toContain("1 date exceptions");
    expect(text(screen.getByTestId("team-availability-u2"))).toContain("Nothing submitted yet");
    expect(screen.queryByTestId("team-availability-week-u2")).toBeNull();                  // no invented week for someone who sent nothing
    expect(text(screen.getByTestId("team-availability-u3"))).toContain("Last updated Jan 2. It may be out of date.");
    expect(text(screen.getByTestId("team-availability-u3"))).toContain("Time off: Jan 8 – Jan 9 (Approved)");
  });

  it("asks the server to filter and search", async () => {
    world.team = [teamPerson("u2", "Bea Cruz")];
    const screen = render(wrap(<TeamAvailabilityScreen />));
    await settle();
    await screen.findByTestId("team-availability-u2");
    fireEvent.press(screen.getByTestId("team-availability-filter-none"));
    await waitFor(() => expect(get).toHaveBeenCalledWith("/schedules/availability/team?filter=none"));
    fireEvent.changeText(screen.getByTestId("team-availability-search"), "bea");
    await waitFor(() => expect(get).toHaveBeenCalledWith("/schedules/availability/team?q=bea&filter=none"));
  });

  it("opens one person's week, exceptions, time off and the shifts that clash, without changing any shift", async () => {
    world.team = [teamPerson("u1", "Ana Lopez", { weekly: submittedWeek, submitted: true, freshness: "current", last_updated_at: "2030-01-02T10:00:00+00:00" })];
    world.member = {
      ...teamPerson("u1", "Ana Lopez", { weekly: submittedWeek, submitted: true, freshness: "current", last_updated_at: "2030-01-02T10:00:00+00:00" }),
      upcoming_change: null, exceptions: [wireException({ exception_date: "2030-01-10" })],
      leave: [{ id: "l1", start_date: "2030-01-12", end_date: "2030-01-13", partial: false, status: "pending" }],
      shift_clashes: [{ ...wireShiftBrief({ id: "s5" }), availability: "unavailable" }],
    };
    const screen = render(wrap(<TeamAvailabilityScreen />));
    await settle();
    fireEvent.press(await screen.findByTestId("team-availability-u1"));
    await screen.findByTestId("member-availability-day-0");
    expect(text(screen.getByTestId("member-availability-day-0"))).toBe("Mon 7:00 AM – 3:00 PM");
    expect(text(screen.getByTestId("member-availability-day-2"))).toBe("Wed Unavailable");
    expect(text(screen.getByTestId("member-availability-day-4"))).toBe("Fri Not submitted");
    const sheet = text(screen.getByTestId("member-availability"));
    expect(sheet).toContain("Unavailable Thursday, January 10");
    expect(sheet).toContain("Jan 12 – Jan 13 · Pending");
    expect(text(screen.getByTestId("member-availability-clash-note"))).toContain("Availability never changes a shift");
    expect(text(screen.getByTestId("member-availability-clash-s5"))).toContain("Marked unavailable that day");
    expect(post).not.toHaveBeenCalled();
  });

  it("says plainly when nobody matches", async () => {
    world.team = [];
    const screen = render(wrap(<TeamAvailabilityScreen />));
    await settle();
    await screen.findByTestId("team-availability-empty");
  });
});

/* ─── The Team Schedule entry points ──────────────────────────────────────── */

describe("Team Schedule entry points", () => {
  const at = (h: number, m: number) => (zonedTimeToInstant(TODAY, h, m, ZONE) as Date).toISOString();

  const serve = () => {
    const base = get.getMockImplementation() as (url: string) => Promise<unknown>;
    get.mockImplementation(async (url: string) => {
      if (url.startsWith("/schedules/team")) {
        return wirePage({
          staff: [wirePerson("u1", "Ana Torres")],
          assignments: [wireShift({ id: "t1", user_id: "u1", work_date: TODAY, shift_name: "Day", start_time: "00:00:00", end_time: "23:59:00", starts_at: at(0, 0), ends_at: at(23, 59) })],
          dateFrom: TODAY, dateTo: TODAY,
        });
      }
      if (url.startsWith("/schedules/gaps") || url.startsWith("/schedules/shifts")) return { data: [] };
      return base(url);
    });
  };

  it("shows how many requests wait for a decision and opens Requests and Availability", async () => {
    serve();
    const screen = render(wrap(<TeamScheduleRoute />));
    await settle();
    await waitFor(() => expect(screen.getByTestId("team-schedule-open-requests")).toBeTruthy());
    await waitFor(() => expect(allStrings(screen).join(" ")).toContain("Requests (2)"));
    fireEvent.press(screen.getByTestId("team-schedule-open-requests"));
    expect(router.push).toHaveBeenCalledWith("/(app)/team-schedule/requests");
    fireEvent.press(screen.getByTestId("team-schedule-open-availability"));
    expect(router.push).toHaveBeenCalledWith("/(app)/team-schedule/availability");
  });

  it("shows no number at all when the count could not be read", async () => {
    world.listFails = true;
    serve();
    const screen = render(wrap(<TeamScheduleRoute />));
    await settle();
    await waitFor(() => expect(screen.getByTestId("team-schedule-open-requests")).toBeTruthy());
    expect(allStrings(screen).join(" ")).not.toMatch(/Requests \(\d+\)/);
    expect(tr("teamSchedule.requests.title")).toBe("Requests");
  });
});
