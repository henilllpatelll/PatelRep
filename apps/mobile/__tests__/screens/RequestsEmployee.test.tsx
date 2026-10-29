import React from "react";
import { StyleSheet } from "react-native";
import type { ReactTestInstance } from "react-test-renderer";
import { act, configure, fireEvent, render, waitFor } from "@testing-library/react-native";
import { makeTranslator } from "../helpers/i18n";

/* The REAL employee side of Phase 5: My availability, Request time off, My requests, the swap proposal drawer and the My
   Schedule entry points. Only the network, the router, the translator, the app store and the icon font are doubled. */

let mockLanguage: "en" | "es" = "en";
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({ __esModule: true, default: () => "light" }));
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() },
  useLocalSearchParams: () => ({}),
  Redirect: () => null,
}));
jest.mock("react-i18next", () => {
  const { makeTranslator: translator } = require("../helpers/i18n");
  const t = translator(() => mockLanguage);
  return { useTranslation: () => ({ t, i18n: { language: mockLanguage } }) };
});
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 20, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));

const mockAppState: { isOnline: boolean; hotelTimezone: string; user: { id: string; role: string; tenant_id: string } | null } = {
  isOnline: true,
  hotelTimezone: "America/Chicago",
  user: { id: "u1", role: "housekeeper", tenant_id: "h1" },
};
jest.mock("@/stores/appStore", () => ({
  useAppStore: (selector?: (state: unknown) => unknown) => (selector ? selector(mockAppState) : mockAppState),
}));

import { router } from "expo-router";
import SchedulingScreen from "@/app/(app)/scheduling/index";
import { MyAvailabilityScreen } from "@/components/scheduling/MyAvailabilityScreen";
import { MyRequestsScreen } from "@/components/scheduling/MyRequestsScreen";
import { SwapRequestSheet } from "@/components/scheduling/SwapRequestSheet";
import { TimeOffScreen } from "@/components/scheduling/TimeOffScreen";
import { api } from "@/lib/api/client";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { allStrings } from "../helpers/workspaceHarness";
import { apiError, inbox, person, wireAvailability, wireException, wireItem, wireLeave, wireShiftBrief, wireSwap, wireSwapItem, wireWeek } from "../helpers/requestFixtures";

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const put = api.put as jest.Mock;

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

// The "hotel today" the screens use comes from the app store zone and the real clock, so dates are derived from it.
const ymd = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

let world: { availability: Record<string, unknown>; mine: Array<Record<string, unknown>>; counts: Record<string, unknown>; leave: Record<string, unknown>; swap: Record<string, unknown>; options: unknown[]; optionMeta: Record<string, unknown> };

beforeEach(() => {
  jest.clearAllMocks();
  get.mockReset();
  post.mockReset();
  put.mockReset();
  mockLanguage = "en";
  mockAppState.isOnline = true;
  world = {
    availability: wireAvailability(),
    mine: [],
    counts: { action_required: 0 },
    leave: wireLeave({ viewer: "self", can: { approve: false, deny: false, cancel: true, cancel_needs_reason: false } }),
    swap: wireSwap({ viewer: "counterpart", status: "proposed", can: { respond: true, cancel: false, approve: false, deny: false }, analysis: { blockers: [], warnings: [] } }),
    options: [{ person: person("u2", "Bea Cruz"), shifts: [{ ...wireShiftBrief({ id: "s2", work_date: ymd(5), user_id: "u2" }), warnings: [] }] }],
    optionMeta: { my_shift: wireShiftBrief({ id: "s1" }) },
  };
  get.mockImplementation(async (url: string) => {
    if (url === "/schedules/me/availability") return { data: world.availability };
    if (url === "/schedules/me/requests") return { data: world.mine, meta: { counts: world.counts } };
    if (url === "/schedules/time-off/l1") return { data: world.leave };
    if (url === "/schedules/swaps/w1") return { data: world.swap };
    if (url.startsWith("/schedules/me/swap-options")) return { data: world.options, meta: world.optionMeta };
    if (url.startsWith("/schedules/assignments/my-schedule")) return { data: [] };
    throw new Error(`unexpected GET ${url}`);
  });
});

/* ─── My availability ─────────────────────────────────────────────────────── */

describe("My availability", () => {
  const open = async () => {
    const screen = render(wrap(<MyAvailabilityScreen />));
    await settle();
    await screen.findByTestId("availability-day-0");
    return screen;
  };

  it("starts with every day 'Not submitted' and says that is unknown, not free", async () => {
    const screen = await open();
    for (let day = 0; day < 7; day += 1) expect(screen.getByTestId(`availability-day-${day}-state-unset`).props.accessibilityState).toEqual({ selected: true });
    expect(text(screen.getByTestId("availability-day-0"))).toContain("Not submitted. Your supervisor will see this as unknown, not as free.");
    expect(text(screen.getByTestId("my-availability-fresh"))).toBe("You haven't submitted any availability yet.");
    expect(disabled(screen.getByTestId("my-availability-save"))).toBe(true);                // nothing to save yet
  });

  it("sets Monday's usual hours without typing, saves the whole week with the revision it read, and shows the clash without changing the shift", async () => {
    world.availability = wireAvailability({ revision: 2, submitted: true, freshness: "current", last_updated_at: "2030-01-01T10:00:00+00:00" });
    const screen = await open();
    fireEvent.press(screen.getByTestId("availability-day-0-state-available"));
    expect(text(screen.getByTestId("availability-day-0-start-0-value"))).toBe("7:00 AM");
    expect(text(screen.getByTestId("availability-day-0-end-0-value"))).toBe("3:00 PM");
    fireEvent.press(screen.getByTestId("availability-day-0-start-0-later"));              // 7:15 AM
    fireEvent.press(screen.getByTestId("availability-day-0-end-0-earlier"));              // 2:45 PM
    expect(text(screen.getByTestId("availability-day-0-start-0-value"))).toBe("7:15 AM");
    expect(text(screen.getByTestId("availability-day-0-end-0-value"))).toBe("2:45 PM");
    fireEvent.press(screen.getByTestId("availability-day-2-state-unavailable"));
    expect(disabled(screen.getByTestId("my-availability-save"))).toBe(false);
    put.mockResolvedValue({
      data: wireAvailability({ revision: 3, submitted: true, freshness: "current", last_updated_at: "2030-01-02T10:00:00+00:00", weekly: wireWeek({ 0: { state: "available", windows: [{ start: "07:15", end: "14:45" }] }, 2: { state: "unavailable" } }) }),
      meta: { replayed: false, shift_clashes: [{ ...wireShiftBrief({ id: "s9", work_date: "2030-01-09" }), availability: "unavailable" }] },
    });
    fireEvent.press(screen.getByTestId("my-availability-save"));
    await waitFor(() => expect(put).toHaveBeenCalledWith("/schedules/me/availability", { expected_revision: 2, days: [
      { weekday: 0, mode: "available", windows: [{ start: "07:15", end: "14:45" }] },
      { weekday: 2, mode: "unavailable", windows: [] },
    ] }));
    await screen.findByTestId("my-availability-notice");
    expect(text(screen.getByTestId("my-availability-notice"))).toBe("Availability saved.");
    expect(text(screen.getByTestId("availability-clashes"))).toContain("Your shifts were not changed.");
    expect(text(screen.getByTestId("availability-clash-s9"))).toContain("You marked this day unavailable");
    expect(disabled(screen.getByTestId("my-availability-save"))).toBe(true);              // now saved
  });

  it("supports several time windows in a day, all day, and removing one", async () => {
    const screen = await open();
    fireEvent.press(screen.getByTestId("availability-day-1-state-available"));
    fireEvent.press(screen.getByTestId("availability-day-1-add"));
    expect(screen.getByTestId("availability-day-1-window-1")).toBeTruthy();
    expect(text(screen.getByTestId("availability-day-1-start-1-value"))).toBe("4:00 PM");
    fireEvent.press(screen.getByTestId("availability-day-1-allday-1"));
    expect(text(screen.getByTestId("availability-day-1-window-1"))).toContain("All day");
    expect(text(screen.getByTestId("availability-day-1-window-1"))).toContain("Set hours");
    expect(screen.getByTestId("availability-day-1-error")).toBeTruthy();                     // all day overlaps the morning window
    expect(text(screen.getByTestId("availability-day-1-error"))).toBe("Two time windows on Tuesday overlap.");
    expect(disabled(screen.getByTestId("my-availability-save"))).toBe(true);
    fireEvent.press(screen.getByTestId("availability-day-1-remove-1"));
    expect(screen.queryByTestId("availability-day-1-error")).toBeNull();
    expect(disabled(screen.getByTestId("my-availability-save"))).toBe(false);
  });

  it("reloads and resets to the server's week when another device saved first", async () => {
    world.availability = wireAvailability({ revision: 1 });
    const screen = await open();
    fireEvent.press(screen.getByTestId("availability-day-0-state-available"));
    put.mockRejectedValue(apiError(409, "availability_changed"));
    world.availability = wireAvailability({ revision: 2, submitted: true, weekly: wireWeek({ 4: { state: "unavailable" } }) });
    fireEvent.press(screen.getByTestId("my-availability-save"));
    await screen.findByTestId("my-availability-action-failed");
    expect(text(screen.getByTestId("my-availability-action-failed"))).toBe("Your availability changed on another device. We reloaded it.");
    await waitFor(() => expect(screen.getByTestId("availability-day-4-state-unavailable").props.accessibilityState).toEqual({ selected: true }));
    expect(screen.getByTestId("availability-day-0-state-unset").props.accessibilityState).toEqual({ selected: true });   // the stale draft is gone
  });

  it("starts a change at a later date and says the current week stays in force until then", async () => {
    world.availability = wireAvailability({ revision: 1, submitted: true, weekly: wireWeek({ 0: { state: "available", windows: [{ start: "07:00", end: "15:00" }] } }) });
    const screen = await open();
    fireEvent.press(screen.getByTestId("my-availability-effective-next"));
    fireEvent.press(screen.getByTestId("my-availability-effective-next"));
    expect(text(screen.getByTestId("my-availability-effective").parent as ReactTestInstance)).toBeTruthy();
    expect(allStrings(screen).join(" ")).toContain("Your current week stays in force until this date.");
    expect(disabled(screen.getByTestId("my-availability-save"))).toBe(false);
    put.mockResolvedValue({ data: wireAvailability({ revision: 2 }), meta: {} });
    fireEvent.press(screen.getByTestId("my-availability-save"));
    await waitFor(() => expect(put.mock.calls[0][1].effective_from).toMatch(/^\d{4}-\d{2}-\d{2}$/));
  });

  it("adds and removes a date exception", async () => {
    world.availability = wireAvailability({ revision: 1, submitted: true, exceptions: [wireException({ id: "x9", exception_date: "2030-01-10" })] });
    const screen = await open();
    expect(text(screen.getByTestId("my-availability-exception-x9"))).toContain("Unavailable Thursday, January 10");
    post.mockResolvedValue({ data: wireException({ id: "x10" }), meta: { shift_clashes: [] } });
    fireEvent.press(screen.getByTestId("my-availability-exception-save"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/schedules/me/availability/exceptions", expect.objectContaining({ mode: "unavailable", windows: [] })));
    post.mockResolvedValue({ data: {} });
    fireEvent.press(screen.getByTestId("my-availability-exception-remove-x9"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/schedules/availability/x9/retire", { expected_version: 1 }));
  });

  it("can be read offline but not changed", async () => {
    mockAppState.isOnline = false;
    world.availability = wireAvailability({ revision: 1, submitted: true, weekly: wireWeek({ 0: { state: "unavailable" } }) });
    const screen = await open();
    expect(screen.getByTestId("my-availability-offline")).toBeTruthy();
    expect(disabled(screen.getByTestId("my-availability-save"))).toBe(true);
    expect(disabled(screen.getByTestId("my-availability-exception-save"))).toBe(true);
    await waitFor(() => expect(screen.getByTestId("availability-day-0-state-unavailable").props.accessibilityState).toEqual({ selected: true }));
  });

  it("says when availability could not be loaded", async () => {
    get.mockRejectedValue(Object.assign(new Error("down"), { status: 500 }));
    const screen = render(wrap(<MyAvailabilityScreen />));
    await settle();
    await screen.findByTestId("my-availability-failed");
  });

  it("speaks Spanish", async () => {
    mockLanguage = "es";
    const screen = await open();
    expect(allStrings(screen).join(" ")).toContain("Sin enviar");
    expect(text(screen.getByTestId("availability-day-0"))).toContain("Lunes");
  });

  it("gives every control a role, a name and at least a 44-point target", async () => {
    const screen = await open();
    fireEvent.press(screen.getByTestId("availability-day-0-state-available"));
    for (const id of ["availability-day-0-start-0-earlier", "availability-day-0-start-0-later", "availability-day-0-end-0-earlier", "availability-day-0-end-0-later"]) {
      const node = screen.getByTestId(id);
      expect(node.props.accessibilityRole).toBe("button");
      expect(node.props.accessibilityLabel).toBeTruthy();
      const flat = StyleSheet.flatten(node.props.style) as { width: number; height: number };
      expect(flat.width).toBeGreaterThanOrEqual(44);
      expect(flat.height).toBeGreaterThanOrEqual(44);
    }
    expect(screen.getByTestId("availability-day-0-state").props.accessibilityRole).toBe("tablist");
  });
});

/* ─── Request time off ────────────────────────────────────────────────────── */

describe("Request time off", () => {
  const open = async () => {
    const screen = render(wrap(<TimeOffScreen />));
    await settle();
    return screen;
  };

  it("sends a pending request for the signed-in employee, with no user id and an idempotency key, and says it is not approved", async () => {
    const screen = await open();
    expect(allStrings(screen).join(" ")).toContain("Sending a request doesn't change your shifts");
    fireEvent.press(screen.getByTestId("time-off-send"));
    expect(text(screen.getByTestId("time-off-problem"))).toBe("Choose a reason.");
    expect(post).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("time-off-reason-family"));
    fireEvent.press(screen.getByTestId("time-off-end-next"));
    fireEvent.changeText(screen.getByTestId("time-off-note"), "Wedding");
    post.mockResolvedValue({ data: wireLeave({ viewer: "self", user: person("u1", "Ana Lopez"), reason_category: "family", note: "Wedding" }) });
    fireEvent.press(screen.getByTestId("time-off-send"));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [url, body] = post.mock.calls[0];
    expect(url).toBe("/schedules/me/time-off");
    expect(body).toEqual(expect.objectContaining({ partial: false, reason_category: "family", note: "Wedding", idempotency_key: expect.stringMatching(/^leave-/) }));
    expect(body.end_date > body.start_date).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/user|status/);
    await screen.findByTestId("time-off-sent");
    expect(text(screen.getByTestId("time-off-sent-status"))).toBe("Pending");
    expect(text(screen.getByTestId("time-off-sent"))).toContain("It isn't approved until your supervisor decides.");
    expect(text(screen.getByTestId("time-off-sent"))).not.toContain("Approved");
  });

  it("asks for only the hours of one day when it is a partial day", async () => {
    const screen = await open();
    fireEvent.press(screen.getByTestId("time-off-partial"));
    expect(screen.queryByTestId("time-off-end")).toBeNull();                       // a partial day covers one date
    fireEvent.press(screen.getByTestId("time-off-from-later"));
    fireEvent.press(screen.getByTestId("time-off-reason-appointment"));
    post.mockResolvedValue({ data: wireLeave({ viewer: "self", partial: true, start_time: "09:15:00", end_time: "13:00:00", reason_category: "appointment" }) });
    fireEvent.press(screen.getByTestId("time-off-send"));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toEqual(expect.objectContaining({ partial: true, start_time: "09:15", end_time: "13:00" }));
    expect(post.mock.calls[0][1].end_date).toBe(post.mock.calls[0][1].start_date);
  });

  it("retries an unconfirmed send with the SAME key, and a changed form with a new one", async () => {
    const screen = await open();
    fireEvent.press(screen.getByTestId("time-off-reason-personal"));
    post.mockRejectedValueOnce(new Error("Network request failed"));
    fireEvent.press(screen.getByTestId("time-off-send"));
    await screen.findByTestId("time-off-failed");
    expect(text(screen.getByTestId("time-off-failed"))).toBe("We could not confirm that. Check the request before you try again.");
    expect(screen.queryByTestId("time-off-sent")).toBeNull();
    post.mockRejectedValueOnce(new Error("Network request failed"));
    fireEvent.press(screen.getByTestId("time-off-send"));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1][1].idempotency_key).toBe(post.mock.calls[0][1].idempotency_key);
    fireEvent.press(screen.getByTestId("time-off-reason-vacation"));
    post.mockResolvedValue({ data: wireLeave({ viewer: "self" }) });
    fireEvent.press(screen.getByTestId("time-off-send"));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
    expect(post.mock.calls[2][1].idempotency_key).not.toBe(post.mock.calls[0][1].idempotency_key);
  });

  it("explains a refusal in words and keeps the form", async () => {
    const screen = await open();
    fireEvent.press(screen.getByTestId("time-off-reason-personal"));
    post.mockRejectedValue(apiError(409, "leave_overlap"));
    fireEvent.press(screen.getByTestId("time-off-send"));
    await screen.findByTestId("time-off-failed");
    expect(text(screen.getByTestId("time-off-failed"))).toBe("This overlaps other time off that is already requested or approved.");
    expect(screen.getByTestId("time-off-send")).toBeTruthy();
  });

  it("will not send while offline", async () => {
    mockAppState.isOnline = false;
    const screen = await open();
    expect(screen.getByTestId("time-off-offline")).toBeTruthy();
    expect(disabled(screen.getByTestId("time-off-send"))).toBe(true);
  });

  it("opens the request just sent so the employee can see and withdraw it", async () => {
    const screen = await open();
    fireEvent.press(screen.getByTestId("time-off-reason-personal"));
    post.mockResolvedValue({ data: wireLeave({ viewer: "self" }) });
    fireEvent.press(screen.getByTestId("time-off-send"));
    fireEvent.press(await screen.findByTestId("time-off-view"));
    await screen.findByTestId("request-cancel");
    post.mockResolvedValue({ data: wireLeave({ viewer: "self", status: "cancelled", version: 2, can: { approve: false, deny: false, cancel: false, cancel_needs_reason: false } }) });
    fireEvent.press(screen.getByTestId("request-cancel"));
    await waitFor(() => expect(post).toHaveBeenLastCalledWith("/schedules/time-off/l1/cancel", { expected_version: 1 }));
    await waitFor(() => expect(text(screen.getByTestId("request-status"))).toBe("Cancelled"));
  });
});

/* ─── My requests ─────────────────────────────────────────────────────────── */

describe("My requests", () => {
  const open = async () => {
    const screen = render(wrap(<MyRequestsScreen />));
    await settle();
    await screen.findByTestId("my-requests-list");
    return screen;
  };

  it("lists time off and swaps with the server's real statuses and flags the swap waiting on me", async () => {
    world.mine = [
      wireItem({ id: "l1", status: "approved", status_group: "approved", needs_action: false, impact: null }),
      wireSwapItem({ id: "w1", status: "proposed", needs_my_response: true, needs_action: false, user: person("u2", "Bea Cruz"), counterpart: person("u1", "Ana Lopez") }),
      wireItem({ id: "l2", status: "denied", status_group: "denied", needs_action: false, impact: null }),
    ];
    world.counts = { action_required: 1, pending: 1, approved: 1, denied: 1, cancelled: 0 };
    const screen = await open();
    expect(text(screen.getByTestId("request-time_off-l1"))).toContain("Approved");
    expect(text(screen.getByTestId("request-shift_swap-w1"))).toContain("Bea Cruz asked to swap shifts");
    expect(text(screen.getByTestId("request-shift_swap-w1"))).toContain("Needs your answer");
    expect(text(screen.getByTestId("request-time_off-l2"))).toContain("Denied");
    expect(text(screen.getByTestId("my-requests-filter-action"))).toBe("Needs my answer (1)");
    fireEvent.press(screen.getByTestId("my-requests-filter-approved"));
    expect(screen.queryByTestId("request-shift_swap-w1")).toBeNull();
    expect(screen.getByTestId("request-time_off-l1")).toBeTruthy();
    fireEvent.press(screen.getByTestId("my-requests-filter-action"));
    expect(screen.queryByTestId("request-time_off-l1")).toBeNull();
    expect(screen.getByTestId("request-shift_swap-w1")).toBeTruthy();
  });

  it("says when there is nothing, per filter", async () => {
    const screen = await open();
    expect(text(screen.getByTestId("my-requests-empty"))).toContain("No requests yet");
    fireEvent.press(screen.getByTestId("my-requests-filter-action"));
    expect(text(screen.getByTestId("my-requests-empty"))).toContain("Nothing waiting on you");
  });

  it("lets the coworker accept a swap, and says accepting changes nothing yet", async () => {
    world.mine = [wireSwapItem({ id: "w1", status: "proposed", needs_my_response: true, needs_action: false, user: person("u2", "Bea Cruz"), counterpart: person("u1", "Ana Lopez") })];
    const screen = await open();
    fireEvent.press(screen.getByTestId("request-shift_swap-w1"));
    await screen.findByTestId("swap-accept");
    expect(allStrings(screen).join(" ")).toContain("Accepting does not change your schedule. A supervisor still has to approve the swap.");
    expect(screen.queryByTestId("swap-approve")).toBeNull();                          // an employee never sees the supervisor's controls
    post.mockResolvedValue({ data: wireSwap({ viewer: "counterpart", status: "accepted", version: 3, can: { respond: false, cancel: true, approve: false, deny: false }, analysis: { blockers: [], warnings: [] } }) });
    fireEvent.press(screen.getByTestId("swap-accept"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/schedules/swaps/w1/respond", { accept: true, expected_version: 2 }));
    await waitFor(() => expect(text(screen.getByTestId("request-status"))).toBe("Waiting for supervisor"));
    expect(text(screen.getByTestId("request-notice"))).toBe("Accepted. A supervisor still has to approve it; nothing has changed on the schedule yet.");
  });

  it("will not let the coworker accept a swap the server says can no longer work", async () => {
    world.swap = wireSwap({ viewer: "counterpart", status: "proposed", can: { respond: true, cancel: false, approve: false, deny: false }, analysis: { blockers: [{ code: "shift_changed", user_id: null }], warnings: [] } });
    world.mine = [wireSwapItem({ id: "w1", status: "proposed", needs_my_response: true, needs_action: false })];
    const screen = await open();
    fireEvent.press(screen.getByTestId("request-shift_swap-w1"));
    await screen.findByTestId("swap-accept");
    expect(text(screen.getByTestId("swap-blocker-shift_changed"))).toBe("A shift changed after the swap was agreed");
    expect(disabled(screen.getByTestId("swap-accept"))).toBe(true);
    expect(disabled(screen.getByTestId("swap-decline"))).toBe(false);
  });

  it("lets the requester withdraw an unanswered swap", async () => {
    world.swap = wireSwap({ viewer: "requester", status: "proposed", can: { respond: false, cancel: true, approve: false, deny: false }, analysis: { blockers: [], warnings: [] } });
    world.mine = [wireSwapItem({ id: "w1", status: "proposed", needs_action: false })];
    const screen = await open();
    fireEvent.press(screen.getByTestId("request-shift_swap-w1"));
    expect(text(await screen.findByTestId("request-sheet"))).toContain("Waiting for Bea Cruz to answer.");
    fireEvent.press(await screen.findByTestId("swap-cancel"));
    post.mockResolvedValue({ data: wireSwap({ viewer: "requester", status: "cancelled", version: 3, can: { respond: false, cancel: false, approve: false, deny: false }, analysis: null }) });
    fireEvent.press(await screen.findByTestId("request-confirm-reason"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/schedules/swaps/w1/cancel", { expected_version: 2 }));
    await waitFor(() => expect(text(screen.getByTestId("request-status"))).toBe("Cancelled"));
  });

  it("shows the decision reason when a supervisor denied the request", async () => {
    world.mine = [wireItem({ id: "l1", status: "denied", status_group: "denied", needs_action: false, impact: null })];
    world.leave = wireLeave({ viewer: "self", status: "denied", decision_reason: "Inventory week", decided_by: person("sup-1", "Sam Wu"), can: { approve: false, deny: false, cancel: false, cancel_needs_reason: false } });
    const screen = await open();
    fireEvent.press(screen.getByTestId("request-time_off-l1"));
    await screen.findByTestId("request-status");
    expect(text(screen.getByTestId("request-sheet"))).toContain("Inventory week");
    expect(screen.queryByTestId("request-cancel")).toBeNull();
  });

  it("keeps the last list and says so when a refresh fails, and offers the new-request button only online", async () => {
    world.mine = [wireItem({ id: "l1", needs_action: false })];
    const screen = await open();
    expect(disabled(screen.getByTestId("my-requests-new"))).toBe(false);
    fireEvent.press(screen.getByTestId("my-requests-new"));
    expect(router.push).toHaveBeenCalledWith("/(app)/scheduling/time-off");
    mockAppState.isOnline = false;
    screen.rerender(wrap(<MyRequestsScreen />));
    await settle();
    expect(screen.getByTestId("my-requests-offline")).toBeTruthy();
    expect(disabled(screen.getByTestId("my-requests-new"))).toBe(true);
    expect(screen.getByTestId("request-time_off-l1")).toBeTruthy();
  });

  it("never claims anyone was notified", async () => {
    world.mine = [wireItem({ id: "l1", needs_action: false })];
    const screen = await open();
    expect(allStrings(screen).join(" ")).not.toMatch(/notified|we.ll tell/i);
  });
});

/* ─── Requesting a swap ───────────────────────────────────────────────────── */

describe("Request a swap", () => {
  const source = { id: "s1", workDate: ymd(3), shiftName: "Morning", startTime: "07:00:00", endTime: "15:00:00" };
  const open = async (props: Partial<React.ComponentProps<typeof SwapRequestSheet>> = {}) => {
    const onSent = jest.fn();
    const screen = render(wrap(<SwapRequestSheet source={source} isOnline language="en" onClose={jest.fn()} onSent={onSent} t={makeTranslator("en")} {...props} />));
    await settle();
    return { screen, onSent };
  };

  it("offers only the coworker shifts the server says could work, then reviews and sends by shift id", async () => {
    const { screen, onSent } = await open();
    await screen.findByTestId("swap-option-u2");
    expect(get).toHaveBeenCalledWith("/schedules/me/swap-options?assignment_id=s1");
    expect(text(screen.getByTestId("swap-option-u2"))).toContain("Bea Cruz");
    fireEvent.press(screen.getByTestId("swap-option-shift-s2"));
    expect(text(screen.getByTestId("swap-sheet"))).toContain("You give up");
    expect(text(screen.getByTestId("swap-sheet-explain"))).toBe("Accepting does not change your schedule. A supervisor still has to approve the swap.");
    fireEvent.changeText(screen.getByTestId("swap-sheet-note"), "Dentist");
    post.mockResolvedValue({ data: wireSwap({ viewer: "requester", status: "proposed", version: 1 }) });
    fireEvent.press(screen.getByTestId("swap-sheet-send"));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/schedules/me/swaps", { requester_assignment_id: "s1", counterpart_assignment_id: "s2", note: "Dentist", idempotency_key: expect.stringMatching(/^swap-/) }));
    await screen.findByTestId("swap-sent");
    expect(text(screen.getByTestId("swap-sent"))).toContain("Bea Cruz has to accept. Nothing changes on the schedule until a supervisor approves.");
    expect(onSent).toHaveBeenCalled();
  });

  it("shows the warnings the server attached to a choice", async () => {
    world.options = [{ person: person("u2", "Bea Cruz"), shifts: [{ ...wireShiftBrief({ id: "s2", work_date: ymd(5), user_id: "u2" }), warnings: ["insufficient_rest"] }] }];
    const { screen } = await open();
    fireEvent.press(await screen.findByTestId("swap-option-shift-s2"));
    expect(text(screen.getByTestId("swap-sheet-warning-insufficient_rest"))).toBe("Little rest between shifts");
  });

  it("says plainly when nothing can be swapped, and why a tied-up shift cannot", async () => {
    world.options = [];
    const { screen } = await open();
    expect(text(await screen.findByTestId("swap-sheet-none"))).toBe("No coworker shifts can be swapped with this one right now.");
    world.optionMeta = { reason: "shift_unavailable_for_swap" };
    const again = await open();
    expect(text(await again.screen.findAllByTestId("swap-sheet-none").then((nodes) => nodes[nodes.length - 1]))).toContain("already has a pending swap or a call-out");
  });

  it("explains a refusal and keeps the choice", async () => {
    const { screen } = await open();
    fireEvent.press(await screen.findByTestId("swap-option-shift-s2"));
    post.mockRejectedValue(apiError(409, "swap_invalid", { blockers: [{ code: "approved_time_off", user_id: "u2" }] }));
    fireEvent.press(screen.getByTestId("swap-sheet-send"));
    await screen.findByTestId("swap-sheet-failed");
    expect(text(screen.getByTestId("swap-sheet-failed"))).toBe("These two shifts can't be exchanged right now.");
    expect(screen.getByTestId("swap-sheet-send")).toBeTruthy();
  });

  it("will not send offline", async () => {
    const { screen } = await open({ isOnline: false });
    fireEvent.press(await screen.findByTestId("swap-option-shift-s2"));
    expect(disabled(screen.getByTestId("swap-sheet-send"))).toBe(true);
    expect(screen.getByTestId("swap-sheet-offline")).toBeTruthy();
  });
});

/* ─── My Schedule ─────────────────────────────────────────────────────────── */

describe("My Schedule entry points", () => {
  const upcoming = ymd(2);
  const serve = () => {
    const base = get.getMockImplementation() as (url: string) => Promise<unknown>;
    get.mockImplementation(async (url: string) => {
      if (url.startsWith("/schedules/assignments/my-schedule")) {
        return { data: [{ id: "a-future", work_date: upcoming, is_on_shift: false, clocked_in_at: null, clocked_out_at: null, shifts: { name: "Morning", start_time: "07:00:00", end_time: "15:00:00" } }] };
      }
      return base(url);
    });
  };

  it("adds availability, time off and requests as actions (not tabs) with the number waiting on me", async () => {
    world.counts = { action_required: 2 };
    serve();
    const screen = render(wrap(<SchedulingScreen />));
    await settle();
    await waitFor(() => expect(allStrings(screen).join(" ")).toContain("My requests (2 need you)"));
    fireEvent.press(screen.getByTestId("schedule-action-availability"));
    expect(router.push).toHaveBeenCalledWith("/(app)/scheduling/availability");
    fireEvent.press(screen.getByTestId("schedule-action-time-off"));
    expect(router.push).toHaveBeenCalledWith("/(app)/scheduling/time-off");
    fireEvent.press(screen.getByTestId("schedule-action-requests"));
    expect(router.push).toHaveBeenCalledWith("/(app)/scheduling/requests");
  });

  it("starts a swap from an upcoming shift and shows no number when the count could not be read", async () => {
    get.mockImplementation(async (url: string) => {
      if (url === "/schedules/me/requests") throw Object.assign(new Error("down"), { status: 500 });
      if (url.startsWith("/schedules/assignments/my-schedule")) return { data: [{ id: "a-future", work_date: upcoming, is_on_shift: false, clocked_in_at: null, clocked_out_at: null, shifts: { name: "Morning", start_time: "07:00:00", end_time: "15:00:00" } }] };
      if (url.startsWith("/schedules/me/swap-options")) return { data: world.options, meta: world.optionMeta };
      throw new Error(`unexpected GET ${url}`);
    });
    const screen = render(wrap(<SchedulingScreen />));
    await settle();
    await waitFor(() => expect(screen.getByTestId("swap-from-a-future")).toBeTruthy());
    expect(allStrings(screen).join(" ")).not.toMatch(/need you/);
    fireEvent.press(screen.getByTestId("swap-from-a-future"));
    await screen.findByTestId("swap-sheet");
    await waitFor(() => expect(get).toHaveBeenCalledWith("/schedules/me/swap-options?assignment_id=a-future"));
  });

  it("offers no swap on a shift that already has attendance", async () => {
    get.mockImplementation(async (url: string) => {
      if (url === "/schedules/me/requests") return { data: [], meta: { counts: {} } };
      if (url.startsWith("/schedules/assignments/my-schedule")) return { data: [{ id: "a-live", work_date: upcoming, is_on_shift: true, clocked_in_at: "2030-01-01T10:00:00Z", clocked_out_at: null, shifts: { name: "Morning", start_time: "07:00:00", end_time: "15:00:00" } }] };
      throw new Error(`unexpected GET ${url}`);
    });
    const screen = render(wrap(<SchedulingScreen />));
    await settle();
    expect(screen.queryByTestId("swap-from-a-live")).toBeNull();
  });
});
