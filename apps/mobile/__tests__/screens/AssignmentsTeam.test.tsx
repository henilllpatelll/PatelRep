import React from "react";
import { Modal } from "react-native";
import { act, configure, fireEvent, render, waitFor } from "@testing-library/react-native";
import { makeTranslator, type Language } from "../helpers/i18n";

/* The REAL Assignments screen on its Team tab: search, filter sheet, sort, staff drawer and the room sheet it hands
   off to. Only the network, the realtime channel, the router and the toast are doubled. */

let mockLanguage: Language = "en";
const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
const mockRealtime: { handlers: Array<() => void> } = { handlers: [] };

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({ __esModule: true, default: () => "light" }));
jest.mock("@/lib/theme/useToast", () => ({ useToast: () => mockToast }));
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn(), setParams: jest.fn() },
  useLocalSearchParams: () => ({}),
}));
jest.mock("react-i18next", () => {
  const { makeTranslator: translator } = require("../helpers/i18n");
  const t = translator(() => mockLanguage);
  return { useTranslation: () => ({ t, i18n: { language: mockLanguage } }) };
});
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 20, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/lib/supabase", () => ({
  supabase: {
    channel: jest.fn(() => {
      const channel: { on: jest.Mock; subscribe: jest.Mock } = {
        on: jest.fn((_type: string, _filter: unknown, handler: () => void) => {
          mockRealtime.handlers.push(handler);
          return channel;
        }),
        subscribe: jest.fn(() => ({})),
      };
      return channel;
    }),
    removeChannel: jest.fn(),
  },
}));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));
jest.mock("@/lib/api/housekeepingSupervisor", () => {
  const actual = jest.requireActual("@/lib/api/housekeepingSupervisor");
  return {
    ...actual,
    fetchBoardVerified: jest.fn(),
    fetchAssignableStaff: jest.fn(),
    fetchShiftRoster: jest.fn(),
    fetchInspectionHistory: jest.fn(),
    fetchLateCheckoutsVerified: jest.fn(),
    fetchWorkloadSettings: jest.fn(),
    fetchScheduledShifts: jest.fn(),
    saveAssignments: jest.fn(),
    removeAssignmentByPlan: jest.fn(),
  };
});
jest.mock("@/lib/api/tasks", () => ({ fetchBlockedTasks: jest.fn() }));

const mockAppState = {
  isOnline: true,
  hotelTimezone: "America/Chicago",
  user: { id: "sup-1", role: "housekeeping_supervisor", tenant_id: "h1" },
};
jest.mock("@/stores/appStore", () => ({
  useAppStore: (selector?: (state: unknown) => unknown) => (selector ? selector(mockAppState) : mockAppState),
}));

import { router } from "expo-router";
import {
  fetchAssignableStaff,
  fetchBoardVerified,
  fetchInspectionHistory,
  fetchLateCheckoutsVerified,
  fetchScheduledShifts,
  fetchShiftRoster,
  fetchWorkloadSettings,
  saveAssignments,
  removeAssignmentByPlan,
} from "@/lib/api/housekeepingSupervisor";
import { fetchBlockedTasks } from "@/lib/api/tasks";
import { supabase } from "@/lib/supabase";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import AssignmentsScreen from "@/app/(app)/assignments/index";
import { STAFF, hotelBoard, rawRoom } from "../helpers/roomBoardFixtures";

const board = fetchBoardVerified as jest.Mock;
const roster = fetchShiftRoster as jest.Mock;
const staffList = fetchAssignableStaff as jest.Mock;
const tr = (key: string, values?: Record<string, unknown>) => makeTranslator("en")(key, values);
const apiError = (status: number, message: string) => Object.assign(new Error(message), { status });
const text = (node: { props: { children?: unknown } }) => String(node.props.children);

const ui = () => (
  <ThemeProvider>
    <AssignmentsScreen />
  </ThemeProvider>
);

const rosterRows = (rows: Array<[string, string]> = [["hk-1", "active"], ["hk-2", "on_break"], ["hk-3", "ended"]]) =>
  rows.map(([user_id, status]) => ({ user_id, status, started_at: new Date(Date.now() - 2 * 60 * 60_000).toISOString() }));

configure({ asyncUtilTimeout: 5000 });

beforeEach(() => {
  jest.clearAllMocks();
  mockRealtime.handlers = [];
  mockLanguage = "en";
  mockAppState.isOnline = true;
  mockAppState.user = { id: "sup-1", role: "housekeeping_supervisor", tenant_id: "h1" };
  board.mockResolvedValue(hotelBoard());
  staffList.mockResolvedValue(STAFF);
  roster.mockResolvedValue(rosterRows());
  (fetchInspectionHistory as jest.Mock).mockResolvedValue([]);
  (fetchLateCheckoutsVerified as jest.Mock).mockResolvedValue([]);
  (fetchBlockedTasks as jest.Mock).mockResolvedValue({ items: [] });
  (fetchWorkloadSettings as jest.Mock).mockResolvedValue({ targetCredits: 16, creditWeights: { DEP: 3, FULL: 2, LIGHT: 1 }, capacityOverrides: {} });
  (fetchScheduledShifts as jest.Mock).mockResolvedValue([]);
  (saveAssignments as jest.Mock).mockResolvedValue(undefined);
  (removeAssignmentByPlan as jest.Mock).mockResolvedValue(true);
});

async function teamTab(rooms = hotelBoard()) {
  board.mockResolvedValue(rooms);
  const screen = render(ui());
  // The first answer has landed once the loading skeleton is gone (an empty hotel has no room 101 to wait for).
  await waitFor(() => expect(screen.queryByTestId("assignments-skeleton")).toBeNull());
  fireEvent.press(screen.getByTestId("assignments-tab-team"));
  await waitFor(() => expect(screen.getByTestId("assignments-team-metrics")).toBeTruthy());
  return screen;
}

const visibleModals = (screen: ReturnType<typeof render>) => screen.UNSAFE_getAllByType(Modal).filter((modal) => modal.props.visible === true);
const cardOrder = (screen: ReturnType<typeof render>) => screen.getAllByTestId(/^team-card-hk-\d$|^team-card-ghost$/).map((node) => String(node.props.testID).replace("team-card-", ""));

describe("Rooms / Team switch", () => {
  it("switches immediately, keeps the date and does not refetch or open another channel", async () => {
    const screen = render(ui());
    await waitFor(() => expect(screen.getByTestId("assignment-room-101")).toBeTruthy());
    const dateRooms = text(screen.getByTestId("assignments-date"));
    const boardCalls = board.mock.calls.length;
    const rosterCalls = roster.mock.calls.length;
    const channels = (supabase.channel as jest.Mock).mock.calls.length;

    fireEvent.press(screen.getByTestId("assignments-tab-team"));
    expect(screen.getByTestId("assignments-tab-team").props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId("assignments-tab-rooms").props.accessibilityState.selected).toBe(false);
    await waitFor(() => expect(screen.getByTestId("team-card-hk-1")).toBeTruthy());
    expect(text(screen.getByTestId("assignments-date"))).toBe(dateRooms);

    fireEvent.press(screen.getByTestId("assignments-tab-rooms"));
    await waitFor(() => expect(screen.getByTestId("assignment-room-101")).toBeTruthy());
    expect(board.mock.calls.length).toBe(boardCalls);
    expect(roster.mock.calls.length).toBe(rosterCalls);
    expect((supabase.channel as jest.Mock).mock.calls.length).toBe(channels);
  });

  it("each tab keeps its own search when you switch away and back", async () => {
    const screen = await teamTab();
    fireEvent.changeText(screen.getByTestId("assignments-team-search"), "ben");
    await waitFor(() => expect(screen.queryByTestId("team-card-hk-1")).toBeNull());
    fireEvent.press(screen.getByTestId("assignments-tab-rooms"));
    await waitFor(() => expect(screen.getByTestId("assignment-room-101")).toBeTruthy());
    expect(screen.getByTestId("assignments-search").props.value).toBe("");
    fireEvent.press(screen.getByTestId("assignments-tab-team"));
    await waitFor(() => expect(screen.getByTestId("assignments-team-search").props.value).toBe("ben"));
    expect(screen.getByTestId("team-card-hk-2")).toBeTruthy();
  });

  it("the Team header shows its own three metrics, not the Rooms ones", async () => {
    const screen = await teamTab();
    expect(screen.queryByTestId("assignments-metrics")).toBeNull();
    expect(text(screen.getByTestId("assignments-team-metric-onShift-value"))).toBe("1");
    expect(text(screen.getByTestId("assignments-team-metric-onBreak-value"))).toBe("1");
    expect(screen.getByTestId("assignments-team-metric-needReview")).toBeTruthy();
  });
});

describe("who is listed", () => {
  it("lists everyone — people with rooms AND the person with none — with their verified state", async () => {
    const screen = await teamTab();
    expect(cardOrder(screen)).toEqual(["hk-1", "hk-2", "hk-3"]);
    expect(text(screen.getByTestId("team-card-stats-hk-3"))).toBe("No rooms assigned");
    expect(text(screen.getByTestId("team-card-remaining-hk-3"))).toBe("No current cleaning workload");
  });

  it("the default order puts working people first and the clocked-out person last", async () => {
    const screen = await teamTab();
    expect(text(screen.getByTestId("team-card-attendance-hk-1").findByType(require("react-native").Text))).toBe("On shift");
    expect(text(screen.getByTestId("team-card-attendance-hk-3").findByType(require("react-native").Text))).toBe("Shift ended");
  });

  it("an owner missing from the staff list still appears, under a safe fallback name", async () => {
    const screen = await teamTab([...hotelBoard(), rawRoom("301", "DIRTY", { assigned_to: "ghost", assignment_id: "ghost-1" })]);
    expect(text(screen.getByTestId("team-card-name-ghost"))).toBe("Name unavailable");
    expect(text(screen.getByTestId("team-card-stats-ghost"))).toMatch(/^1 room/);
  });

  it("an employee on break keeps their rooms and is marked as on break", async () => {
    const screen = await teamTab();
    expect(text(screen.getByTestId("team-card-stats-hk-2"))).toMatch(/^2 rooms/);
    expect(screen.getByTestId("team-card-note-hk-2-on_break")).toBeTruthy();
  });

  it("a shift that ended with unfinished rooms is called out and counted for review", async () => {
    const screen = await teamTab([rawRoom("101", "DIRTY", { assigned_to: "hk-3", assignment_id: "x" })]);
    expect(screen.getByTestId("team-card-note-hk-3-shift_ended_with_open_rooms")).toBeTruthy();
    expect(text(screen.getByTestId("assignments-team-metric-needReview-value"))).toBe("1");
  });
});

describe("failed or partial sources", () => {
  it("a failed roster is NOT zero staff: counts are unknown, people and rooms stay, and Retry works", async () => {
    roster.mockRejectedValue(apiError(500, "down"));
    const screen = await teamTab();
    expect(text(screen.getByTestId("assignments-team-metric-onShift-value"))).toBe("—");
    expect(text(screen.getByTestId("assignments-team-metric-onBreak-value"))).toBe("—");
    expect(screen.getByTestId("assignments-team-metric-onShift").props.accessibilityLabel).toBe("On shift: unknown");
    expect(screen.getByText(tr("assignments.v2.team.notice.availabilityUnverified"))).toBeTruthy();
    expect(screen.queryByText(tr("assignments.v2.team.notice.nobodyOnShift"))).toBeNull();
    expect(screen.getByTestId("team-card-hk-1")).toBeTruthy();
    expect(text(screen.getByTestId("team-card-stats-hk-1"))).toMatch(/^2 rooms/);

    roster.mockResolvedValue(rosterRows());
    await act(async () => {
      fireEvent.press(screen.getByTestId("assignments-team-retry-availabilityUnverified"));
    });
    await waitFor(() => expect(text(screen.getByTestId("assignments-team-metric-onShift-value"))).toBe("1"));
    expect(screen.queryByTestId("assignments-team-notice-availabilityUnverified")).toBeNull();
  });

  it("a verified roster with nobody working says so", async () => {
    roster.mockResolvedValue([]);
    const screen = await teamTab();
    expect(text(screen.getByTestId("assignments-team-metric-onShift-value"))).toBe("0");
    expect(screen.getByText(tr("assignments.v2.team.notice.nobodyOnShift"))).toBeTruthy();
  });

  it("an unavailable staff list is never shown as an empty team", async () => {
    staffList.mockRejectedValue(apiError(500, "down"));
    const screen = await teamTab([]);
    await waitFor(() => expect(screen.getByTestId("assignments-team-staff-unavailable")).toBeTruthy());
    expect(screen.queryByTestId("assignments-team-empty")).toBeNull();
  });

  it("a verified empty staff list is an empty team, with its own words", async () => {
    staffList.mockResolvedValue([]);
    const screen = await teamTab([]);
    await waitFor(() => expect(screen.getByTestId("assignments-team-empty")).toBeTruthy());
    expect(screen.getByText(tr("assignments.v2.team.empty.noStaff"))).toBeTruthy();
  });

  it("fresh rooms with unverified attendance keep their workload; only attendance becomes unknown", async () => {
    roster.mockRejectedValue(apiError(500, "down"));
    const screen = await teamTab();
    expect(text(screen.getByTestId("team-card-attendance-hk-1").findByType(require("react-native").Text))).toBe("Availability unknown");
    expect(text(screen.getByTestId("team-card-remaining-hk-1"))).toBe("60 min remaining");
  });

  it("no workload settings: capacity is stated as unavailable and no High load is claimed", async () => {
    (fetchWorkloadSettings as jest.Mock).mockRejectedValue(apiError(500, "down"));
    const screen = await teamTab();
    await waitFor(() => expect(screen.getByTestId("assignments-team-notice-capacityUnavailable")).toBeTruthy());
    expect(screen.queryByTestId("team-card-badge-hk-1")).toBeNull();
    expect(screen.getByTestId("team-card-capacity-hk-1").props.accessibilityLabel).toBe("Capacity unavailable");
  });

  it("an unavailable board is an error with a retry, not an empty team", async () => {
    board.mockRejectedValue(apiError(503, "down"));
    const screen = render(ui());
    await waitFor(() => expect(screen.getByTestId("assignments-unavailable")).toBeTruthy());
    fireEvent.press(screen.getByTestId("assignments-tab-team"));
    await waitFor(() => expect(screen.getByTestId("assignments-team-unavailable")).toBeTruthy());
    expect(screen.queryByTestId("assignments-team-empty")).toBeNull();
  });
});

describe("search, filters and sort", () => {
  it("searches by name and offers Clear when nothing matches", async () => {
    const screen = await teamTab();
    fireEvent.changeText(screen.getByTestId("assignments-team-search"), "cara");
    await waitFor(() => expect(cardOrder(screen)).toEqual(["hk-3"]));
    expect(text(screen.getByTestId("assignments-team-result-count"))).toBe("Showing 1 of 3 staff");
    fireEvent.changeText(screen.getByTestId("assignments-team-search"), "zzz");
    await waitFor(() => expect(screen.getByTestId("assignments-team-no-match")).toBeTruthy());
    fireEvent.press(screen.getByTestId("assignments-team-clear-search"));
    await waitFor(() => expect(cardOrder(screen)).toEqual(["hk-1", "hk-2", "hk-3"]));
  });

  it("the filter sheet narrows by attendance, shows a live count and the chip removes it", async () => {
    const screen = await teamTab();
    fireEvent.press(screen.getByTestId("assignments-team-filter-button"));
    // Only states somebody is in are offered.
    expect(screen.queryByTestId("assignments-team-filter-attendance-unknown")).toBeNull();
    fireEvent.press(screen.getByTestId("assignments-team-filter-attendance-on_break"));
    expect(text(screen.getByTestId("assignments-team-filter-apply-text"))).toBe("Show 1 person");
    fireEvent.press(screen.getByTestId("assignments-team-filter-apply"));
    await waitFor(() => expect(cardOrder(screen)).toEqual(["hk-2"]));
    fireEvent.press(screen.getByTestId("assignments-team-chip-attendance:on_break"));
    await waitFor(() => expect(cardOrder(screen)).toEqual(["hk-1", "hk-2", "hk-3"]));
  });

  it("'No assignments' shows only people with nothing to do, and 'no match' offers Clear all", async () => {
    const screen = await teamTab();
    fireEvent.press(screen.getByTestId("assignments-team-filter-button"));
    fireEvent.press(screen.getByTestId("assignments-team-filter-workload-none"));
    fireEvent.press(screen.getByTestId("assignments-team-filter-attendance-on_shift"));
    fireEvent.press(screen.getByTestId("assignments-team-filter-apply"));
    await waitFor(() => expect(screen.getByTestId("assignments-team-no-match")).toBeTruthy());
    expect(screen.getByText(tr("assignments.v2.team.empty.filters"))).toBeTruthy();
    fireEvent.press(screen.getByTestId("assignments-team-clear-all"));
    await waitFor(() => expect(cardOrder(screen)).toEqual(["hk-1", "hk-2", "hk-3"]));
  });

  it("sorting by most assigned rooms reorders the list; the chosen sort is named", async () => {
    const screen = await teamTab([...hotelBoard(), rawRoom("302", "DIRTY", { assigned_to: "hk-3", assignment_id: "n1" }), rawRoom("303", "DIRTY", { assigned_to: "hk-3", assignment_id: "n2" }), rawRoom("304", "DIRTY", { assigned_to: "hk-3", assignment_id: "n3" })]);
    fireEvent.press(screen.getByTestId("assignments-team-filter-button"));
    fireEvent.press(screen.getByTestId("assignments-team-sort-most_rooms"));
    fireEvent.press(screen.getByTestId("assignments-team-filter-apply"));
    await waitFor(() => expect(cardOrder(screen)[0]).toBe("hk-3"));
    expect(text(screen.getByTestId("assignments-team-sort-label"))).toBe("Sorted by Most assigned rooms");
  });

  it("with an unverified roster 'Most available' falls back to name and says so", async () => {
    roster.mockRejectedValue(apiError(500, "down"));
    const screen = await teamTab();
    fireEvent.press(screen.getByTestId("assignments-team-filter-button"));
    expect(screen.getByTestId("assignments-team-sort-unverified")).toBeTruthy();
    fireEvent.press(screen.getByTestId("assignments-team-filter-apply"));
    expect(cardOrder(screen)).toEqual(["hk-1", "hk-2", "hk-3"]);
    expect(text(screen.getByTestId("assignments-team-sort-label"))).toBe(tr("assignments.v2.team.sortFallback"));
  });

  it("closing the sheet discards an unapplied draft", async () => {
    const screen = await teamTab();
    fireEvent.press(screen.getByTestId("assignments-team-filter-button"));
    fireEvent.press(screen.getByTestId("assignments-team-filter-attendance-on_break"));
    fireEvent.press(screen.getByTestId("assignments-team-filter-close"));
    expect(cardOrder(screen)).toEqual(["hk-1", "hk-2", "hk-3"]);
    fireEvent.press(screen.getByTestId("assignments-team-filter-button"));
    expect(screen.getByTestId("assignments-team-filter-attendance-all").props.accessibilityState.selected).toBe(true);
  });
});

describe("the staff drawer", () => {
  it("opens with attendance, the recorded clock-in, workload and rooms — and closes", async () => {
    const screen = await teamTab();
    fireEvent.press(screen.getByTestId("team-card-hk-1"));
    expect(text(screen.getByTestId("team-detail-name"))).toBe("Ana Torres");
    expect(screen.getByTestId("team-detail-started")).toBeTruthy();
    expect(text(screen.getByTestId("team-detail-row-assigned-value"))).toBe("2 rooms");
    expect(text(screen.getByTestId("team-detail-row-remaining-value"))).toBe("60 min remaining");
    // Rooms are listed with their stages; there is no assign / reassign control in this phase.
    expect(text(screen.getByTestId("team-detail-room-status-102"))).toBe("Not started");
    expect(text(screen.getByTestId("team-detail-room-status-103"))).toBe("Not started");
    expect(screen.queryByTestId("team-detail-assign")).toBeNull();
    fireEvent.press(screen.getByTestId("team-detail-close"));
    await waitFor(() => expect(screen.queryByTestId("team-detail-sheet")).toBeNull());
    expect(screen.getByTestId("team-card-hk-1")).toBeTruthy();
  });

  it("uses the right status for a room in progress and a submitted room", async () => {
    const screen = await teamTab();
    fireEvent.press(screen.getByTestId("team-card-hk-2"));
    expect(text(screen.getByTestId("team-detail-room-status-104"))).toBe("In progress");
    expect(text(screen.getByTestId("team-detail-room-status-105"))).toBe("Completed");
  });

  it("a person with no rooms still opens a drawer that says so", async () => {
    const screen = await teamTab();
    fireEvent.press(screen.getByTestId("team-card-hk-3"));
    expect(screen.getByTestId("team-detail-no-rooms")).toBeTruthy();
  });

  it("a room opens the room sheet (one modal at a time) and closing it returns to the drawer", async () => {
    const screen = await teamTab();
    fireEvent.press(screen.getByTestId("team-card-hk-1"));
    fireEvent.press(screen.getByTestId("team-detail-room-102"));
    await waitFor(() => expect(text(screen.getByTestId("assignment-sheet-number"))).toBe("102"));
    expect(screen.queryByTestId("team-detail-sheet")).toBeNull();
    expect(visibleModals(screen).length).toBeLessThanOrEqual(2); // the room sheet (+ the always-mounted, hidden filter sheets)
    fireEvent.press(screen.getByTestId("assignment-sheet-close"));
    await waitFor(() => expect(screen.getByTestId("team-detail-sheet")).toBeTruthy());
    expect(text(screen.getByTestId("team-detail-name"))).toBe("Ana Torres");
  });

  it("a room being cleaned offers no reassignment from the drawer's room sheet", async () => {
    const screen = await teamTab();
    fireEvent.press(screen.getByTestId("team-card-hk-2"));
    fireEvent.press(screen.getByTestId("team-detail-room-104"));
    await waitFor(() => expect(text(screen.getByTestId("assignment-sheet-number"))).toBe("104"));
    expect(screen.queryByTestId("assignment-sheet-reassign")).toBeNull();
    expect(screen.queryByTestId("assignment-sheet-remove")).toBeNull();
    expect(saveAssignments).not.toHaveBeenCalled();
  });

  it("opening the full Room Board from that sheet leaves for the board and does not reopen the drawer", async () => {
    const screen = await teamTab();
    fireEvent.press(screen.getByTestId("team-card-hk-1"));
    fireEvent.press(screen.getByTestId("team-detail-room-102"));
    await waitFor(() => expect(screen.getByTestId("assignment-sheet-open-board")).toBeTruthy());
    fireEvent.press(screen.getByTestId("assignment-sheet-open-board"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/(app)/room-board", params: { roomId: "room-102" } });
    expect(screen.queryByTestId("team-detail-sheet")).toBeNull();
  });
});

describe("freshness, realtime and scope", () => {
  it("a realtime room change repaints the Team without a second channel", async () => {
    const screen = await teamTab();
    expect(text(screen.getByTestId("team-card-stats-hk-3"))).toBe("No rooms assigned");
    expect((supabase.channel as jest.Mock)).toHaveBeenCalledTimes(1);
    board.mockResolvedValue([...hotelBoard(), rawRoom("301", "DIRTY", { assigned_to: "hk-3", assignment_id: "rt-1" })]);
    await act(async () => {
      mockRealtime.handlers.forEach((handler) => handler());
    });
    await waitFor(() => expect(text(screen.getByTestId("team-card-stats-hk-3"))).toMatch(/^1 room/), { timeout: 5000 });
    expect((supabase.channel as jest.Mock)).toHaveBeenCalledTimes(1);
  });

  it("a room that starts cleaning moves from not-started to in progress on the card", async () => {
    const screen = await teamTab();
    expect(screen.queryByTestId("team-card-badge-hk-1")).toBeNull();
    board.mockResolvedValue(hotelBoard().map((row) => (row.room_id === "room-102" ? { ...row, status: "IN_PROGRESS" } : row)));
    await act(async () => {
      mockRealtime.handlers.forEach((handler) => handler());
    });
    await waitFor(() => expect(text(screen.getByTestId("team-card-stats-hk-1"))).toMatch(/1 in progress/), { timeout: 5000 });
  });

  it("another hotel or person starts with a clean team search and filters", async () => {
    const screen = await teamTab();
    fireEvent.changeText(screen.getByTestId("assignments-team-search"), "ana");
    await waitFor(() => expect(cardOrder(screen)).toEqual(["hk-1"]));
    mockAppState.user = { id: "sup-1", role: "housekeeping_supervisor", tenant_id: "h2" };
    screen.rerender(ui());
    await waitFor(() => expect(screen.getByTestId("assignments-team-search").props.value).toBe(""));
  });

  it("going offline does not blank the team: the people already verified stay on screen", async () => {
    const screen = await teamTab();
    mockAppState.isOnline = false;
    screen.rerender(ui());
    await waitFor(() => expect(screen.getByTestId("team-card-hk-1")).toBeTruthy());
  });
});

describe("accessibility and language", () => {
  it("every card is a labelled button that names state, workload and warnings (not colour alone)", async () => {
    const screen = await teamTab();
    const card = screen.getByTestId("team-card-hk-2");
    expect(card.props.accessibilityRole).toBe("button");
    expect(card.props.accessibilityLabel).toMatch(/Ben Ortiz\. On break\./);
    expect(card.props.accessibilityLabel).toMatch(/discouraged/);
  });

  it("renders in Spanish without raw keys", async () => {
    mockLanguage = "es";
    const screen = await teamTab();
    expect(screen.getByText("Equipo de limpieza")).toBeTruthy();
    expect(screen.queryByText(/assignments\.v2\./)).toBeNull();
    fireEvent.press(screen.getByTestId("team-card-hk-1"));
    expect(screen.queryByText(/assignments\.v2\./)).toBeNull();
  });
});
