import React from "react";
import { Modal } from "react-native";
import { act, configure, fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { makeTranslator, type Language } from "../helpers/i18n";

/* The REAL Assignments screen, Rooms view, filter sheet, room sheet, assignment panel and controller; only the
   network, the realtime channel, the router and the toast are doubled. Every assertion is about what the supervisor
   sees or what the server was asked to do. */

let mockLanguage: Language = "en";
const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };

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
  supabase: { channel: jest.fn().mockReturnValue({ on: jest.fn().mockReturnThis(), subscribe: jest.fn().mockReturnValue({}) }), removeChannel: jest.fn() },
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
    removeAssignmentGuarded: jest.fn(),
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
  removeAssignmentGuarded,
  saveAssignments,
} from "@/lib/api/housekeepingSupervisor";
import { fetchBlockedTasks } from "@/lib/api/tasks";
import { hotelDateKey } from "@/lib/housekeeping/hotelTime";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import AssignmentsScreen from "@/app/(app)/assignments/index";
import { STAFF, hotelBoard, rawRoom } from "../helpers/roomBoardFixtures";

const board = fetchBoardVerified as jest.Mock;
const roster = fetchShiftRoster as jest.Mock;
const save = saveAssignments as jest.Mock;
const remove = removeAssignmentGuarded as jest.Mock;
const tr = (key: string, values?: Record<string, unknown>) => makeTranslator("en")(key, values);
const apiError = (status: number, message: string) => Object.assign(new Error(message), { status });
const text = (node: { props: { children?: unknown } }) => String(node.props.children);

const ui = () => (
  <ThemeProvider>
    <AssignmentsScreen />
  </ThemeProvider>
);

const rosterRows = (rows: Array<[string, string]> = [["hk-1", "active"], ["hk-2", "active"], ["hk-3", "ended"]]) =>
  rows.map(([user_id, status]) => ({ user_id, status, started_at: new Date().toISOString() }));

// The first render of the file pays the cold module-load cost; a slow machine must not read that as a failure.
configure({ asyncUtilTimeout: 5000 });

beforeEach(() => {
  jest.clearAllMocks();
  mockLanguage = "en";
  mockAppState.isOnline = true;
  mockAppState.user = { id: "sup-1", role: "housekeeping_supervisor", tenant_id: "h1" };
  board.mockResolvedValue(hotelBoard());
  (fetchAssignableStaff as jest.Mock).mockResolvedValue(STAFF);
  roster.mockResolvedValue(rosterRows());
  (fetchInspectionHistory as jest.Mock).mockResolvedValue([]);
  (fetchLateCheckoutsVerified as jest.Mock).mockResolvedValue([]);
  (fetchBlockedTasks as jest.Mock).mockResolvedValue({ items: [] });
  (fetchWorkloadSettings as jest.Mock).mockResolvedValue({ targetCredits: 16, creditWeights: { DEP: 3, FULL: 2, LIGHT: 1 }, capacityOverrides: {} });
  (fetchScheduledShifts as jest.Mock).mockResolvedValue([]);
  save.mockResolvedValue(undefined);
  remove.mockResolvedValue(undefined);
});

const visibleModals = (screen: ReturnType<typeof render>) => screen.UNSAFE_getAllByType(Modal).filter((modal) => modal.props.visible === true);

async function loaded(rooms = hotelBoard()) {
  board.mockResolvedValue(rooms);
  const screen = render(ui());
  await waitFor(() => expect(screen.getByTestId("assignment-room-101") ?? screen.getByTestId("assignments-list")).toBeTruthy());
  return screen;
}

describe("header and metrics", () => {
  it("shows the hotel's date, a live status and counts derived from the verified rooms", async () => {
    const screen = await loaded();
    expect(text(screen.getByTestId("assignments-date"))).toMatch(/^Today · /);
    expect(text(screen.getByTestId("assignments-status-pill"))).toBe("Live");
    // 101 and 201 are unowned and ready; 201 is a VIP, so it is the one urgent room; two people are clocked in.
    expect(text(screen.getByTestId("assignments-metric-unassigned-value"))).toBe("2");
    expect(text(screen.getByTestId("assignments-metric-urgent-value"))).toBe("1");
    expect(text(screen.getByTestId("assignments-metric-onShift-value"))).toBe("2");
    expect(screen.getByTestId("assignments-header")).toBeTruthy();
  });

  it("an unavailable roster is 'unknown' on shift — never zero", async () => {
    roster.mockRejectedValue(apiError(500, "down"));
    const screen = await loaded();
    expect(text(screen.getByTestId("assignments-metric-onShift-value"))).toBe("—");
    expect(screen.getByTestId("assignments-metric-onShift").props.accessibilityLabel).toBe("On shift: unknown");
    // The rooms themselves are untouched and the supervisor is told something is missing.
    expect(screen.getByTestId("assignment-room-101")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("assignments-aux-notice")).toBeTruthy());
  });

  it("held-back rooms are named separately and never counted as ready to assign", async () => {
    const screen = await loaded([...hotelBoard(), rawRoom("301", "DIRTY", { dnd_flag: true })]);
    expect(text(screen.getByTestId("assignments-metric-unassigned-value"))).toBe("2");
    expect(text(screen.getByTestId("assignments-blocked-note").findByProps({ children: tr("assignments.v2.metric.blockedNote", { count: 1 }) }))).toBe(
      tr("assignments.v2.metric.blockedNote", { count: 1 }),
    );
    fireEvent.press(screen.getByTestId("assignments-blocked-note"));
    await waitFor(() => expect(screen.queryByTestId("assignment-room-101")).toBeNull());
    expect(screen.getByTestId("assignment-room-301")).toBeTruthy();
  });
});

describe("rooms list", () => {
  it("groups ready rooms before assigned ones and lists each room once", async () => {
    const screen = await loaded();
    for (const number of ["101", "102", "103", "104", "201"]) expect(screen.getByTestId(`assignment-room-${number}`)).toBeTruthy();
    // 105 (submitted) is not assignment work.
    expect(screen.queryByTestId("assignment-room-105")).toBeNull();
    expect(screen.getByTestId("assignments-section-urgent")).toBeTruthy();
    expect(screen.getByTestId("assignments-section-unassigned")).toBeTruthy();
    expect(screen.getByTestId("assignments-section-assigned")).toBeTruthy();
  });

  it("an assigned room says who has it; a room being cleaned is protected", async () => {
    const screen = await loaded();
    expect(text(screen.getByTestId("assignment-room-assignee-102"))).toBe("Ana Torres");
    expect(text(screen.getByTestId("assignment-room-cta-102").findByProps({ children: "View assignment" }))).toBe("View assignment");
    expect(screen.getByTestId("assignment-room-blocker-104")).toBeTruthy();
  });

  it("a held-back room offers 'View reason', never Assign", async () => {
    const screen = await loaded([rawRoom("101", "DIRTY"), rawRoom("301", "DIRTY", { dnd_flag: true })]);
    expect(within(screen.getByTestId("assignment-room-blocker-301")).getByText("Do not disturb")).toBeTruthy();
    expect(screen.getByTestId("assignment-room-cta-301").findByProps({ children: "View reason" })).toBeTruthy();
    expect(() => screen.getByTestId("assignment-room-cta-301").findByProps({ children: "Assign" })).toThrow();
  });

  it("an unavailable board is an error with a retry — never an empty list", async () => {
    board.mockRejectedValue(apiError(503, "down"));
    const screen = render(ui());
    await waitFor(() => expect(screen.getByTestId("assignments-unavailable")).toBeTruthy());
    expect(screen.getByText(tr("assignments.v2.state.unavailableError"))).toBeTruthy();
    expect(screen.queryByTestId("assignments-empty")).toBeNull();
    expect(text(screen.getByTestId("assignments-metric-unassigned-value"))).toBe("—");
    board.mockResolvedValue(hotelBoard());
    await act(async () => {
      fireEvent.press(screen.getByText(tr("assignments.v2.state.retry")));
    });
    await waitFor(() => expect(screen.getByTestId("assignment-room-101")).toBeTruthy());
  });

  it("when every room is handed out the Unassigned view says so and offers all rooms", async () => {
    const screen = await loaded([rawRoom("101", "DIRTY", { assigned_to: "hk-1", assignment_id: "a1" }), rawRoom("102", "DIRTY", { assigned_to: "hk-2", assignment_id: "a2" })]);
    fireEvent.press(screen.getByTestId("assignments-quick-unassigned"));
    await waitFor(() => expect(screen.getByTestId("assignments-scope-empty")).toBeTruthy());
    expect(screen.getByText(tr("assignments.v2.empty.scope"))).toBeTruthy();
    fireEvent.press(screen.getByTestId("assignments-view-all"));
    await waitFor(() => expect(screen.getByTestId("assignment-room-101")).toBeTruthy());
  });
});

describe("held-back rooms only", () => {
  it("when nothing can be handed out but rooms are held back, Unassigned says so and offers the blocked rooms", async () => {
    const screen = await loaded([rawRoom("101", "DIRTY", { dnd_flag: true }), rawRoom("102", "DIRTY", { do_not_service: true })]);
    expect(text(screen.getByTestId("assignments-metric-unassigned-value"))).toBe("0");
    fireEvent.press(screen.getByTestId("assignments-quick-unassigned"));
    await waitFor(() => expect(screen.getByTestId("assignments-blocked-only")).toBeTruthy());
    expect(screen.getByText(tr("assignments.v2.empty.blockedOnly"))).toBeTruthy();
    fireEvent.press(screen.getByTestId("assignments-view-blocked"));
    await waitFor(() => expect(screen.getByTestId("assignment-room-101")).toBeTruthy());
    expect(screen.getByTestId("assignment-room-102")).toBeTruthy();
  });
});

describe("search", () => {
  it("finds rooms by the assigned person's name and by floor, and clearing restores everything", async () => {
    const screen = await loaded();
    fireEvent.changeText(screen.getByTestId("assignments-search"), "  ana ");
    await waitFor(() => expect(screen.queryByTestId("assignment-room-101")).toBeNull());
    expect(screen.getByTestId("assignment-room-102")).toBeTruthy();
    expect(screen.getByTestId("assignment-room-103")).toBeTruthy();
    expect(text(screen.getByTestId("assignments-result-count"))).toBe("Showing 2 of 5 rooms");

    fireEvent.press(screen.getByTestId("assignments-search-clear"));
    await waitFor(() => expect(screen.getByTestId("assignment-room-101")).toBeTruthy());
    expect(screen.queryByTestId("assignments-active-filters")).toBeNull();
  });

  it("no match is 'no rooms match' with a way out, and it never fetches", async () => {
    const screen = await loaded();
    const loads = board.mock.calls.length;
    fireEvent.changeText(screen.getByTestId("assignments-search"), "zzz");
    await waitFor(() => expect(screen.getByTestId("assignments-search-empty")).toBeTruthy());
    expect(board.mock.calls.length).toBe(loads);
    fireEvent.press(screen.getByTestId("assignments-search-empty-clear"));
    await waitFor(() => expect(screen.getByTestId("assignment-room-101")).toBeTruthy());
  });
});

describe("filters", () => {
  it("opens a scrollable sheet whose options come from the rooms, previews the count, and applies", async () => {
    const screen = await loaded();
    fireEvent.press(screen.getByTestId("assignments-filter-button"));
    expect(visibleModals(screen)).toHaveLength(1);
    expect(screen.getByTestId("assignments-filter-scroll")).toBeTruthy();
    // Buildings A and B exist; there is no building C.
    expect(screen.getByTestId("assignments-filter-building-A")).toBeTruthy();
    expect(screen.getByTestId("assignments-filter-building-B")).toBeTruthy();
    expect(screen.queryByTestId("assignments-filter-building-C")).toBeNull();
    expect(text(screen.getByTestId("assignments-filter-apply-text"))).toBe("Show 5 rooms");

    fireEvent.press(screen.getByTestId("assignments-filter-building-B"));
    expect(text(screen.getByTestId("assignments-filter-apply-text"))).toBe("Show 1 room");
    fireEvent.press(screen.getByTestId("assignments-filter-apply"));

    await waitFor(() => expect(screen.queryByTestId("assignment-room-101")).toBeNull());
    expect(screen.getByTestId("assignment-room-201")).toBeTruthy();
    expect(screen.getByTestId("assignments-chip-building:B")).toBeTruthy();
    expect(text(screen.getByTestId("assignments-result-count"))).toBe("Showing 1 of 5 rooms");

    fireEvent.press(screen.getByTestId("assignments-clear-filters"));
    await waitFor(() => expect(screen.getByTestId("assignment-room-101")).toBeTruthy());
  });

  it("filters compose with search, and a removed chip restores only its own filter", async () => {
    const screen = await loaded();
    fireEvent.press(screen.getByTestId("assignments-filter-button"));
    fireEvent.press(screen.getByTestId("assignments-filter-building-A"));
    fireEvent.press(screen.getByTestId("assignments-filter-apply"));
    fireEvent.changeText(screen.getByTestId("assignments-search"), "10");
    await waitFor(() => expect(screen.queryByTestId("assignment-room-201")).toBeNull());
    expect(screen.getByTestId("assignment-room-101")).toBeTruthy();
    fireEvent.press(screen.getByTestId("assignments-chip-building:A"));
    await waitFor(() => expect(screen.getByTestId("assignments-search").props.value).toBe("10"));
  });

  it("the Urgent quick chip narrows to urgent rooms and toggles back", async () => {
    const screen = await loaded();
    fireEvent.press(screen.getByTestId("assignments-quick-urgent"));
    await waitFor(() => expect(screen.queryByTestId("assignment-room-101")).toBeNull());
    expect(screen.getByTestId("assignment-room-201")).toBeTruthy();
    fireEvent.press(screen.getByTestId("assignments-quick-urgent"));
    await waitFor(() => expect(screen.getByTestId("assignment-room-101")).toBeTruthy());
  });
});

describe("room sheet and the existing assignment workflow", () => {
  it("opens the assignment-focused sheet for a room and closes it again", async () => {
    const screen = await loaded();
    fireEvent.press(screen.getByTestId("assignment-room-102"));
    expect(text(screen.getByTestId("assignment-sheet-number"))).toBe("102");
    expect(screen.getByTestId("assignment-sheet-rows")).toBeTruthy();
    expect(screen.getByTestId("assignment-sheet-reassign")).toBeTruthy();
    expect(screen.getByTestId("assignment-sheet-remove")).toBeTruthy();
    fireEvent.press(screen.getByTestId("assignment-sheet-close"));
    expect(screen.queryByTestId("assignment-sheet")).toBeNull();
  });

  it("a room being cleaned offers no assign, reassign or remove", async () => {
    const screen = await loaded();
    fireEvent.press(screen.getByTestId("assignment-room-104"));
    expect(screen.getByTestId("assignment-sheet-frozen")).toBeTruthy();
    for (const id of ["assignment-sheet-assign", "assignment-sheet-reassign", "assignment-sheet-remove"]) expect(screen.queryByTestId(id)).toBeNull();
    expect(screen.getByTestId("assignment-sheet-open-board")).toBeTruthy();
  });

  it("the Assign button on a card goes straight to the picker; the write reports success only after the server accepted it", async () => {
    let finish: () => void = () => undefined;
    save.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const screen = await loaded();
    fireEvent.press(screen.getByTestId("assignment-room-101"));
    expect(text(screen.getByTestId("assign-title"))).toBe("Assign Room 101");
    expect(visibleModals(screen)).toHaveLength(1);
    fireEvent.press(screen.getByTestId("assign-candidate-hk-2"));
    // Choosing a person saves nothing: the review comes first.
    expect(save).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("assign-continue"));
    expect(screen.getByTestId("assign-panel-review")).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId("assign-confirm"));
      fireEvent.press(screen.getByTestId("assign-confirm"));
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(
      hotelDateKey(new Date(), "America/Chicago"),
      [{ room_id: "room-101", housekeeper_id: "hk-2", expect_unassigned: true, acknowledged_blocks: [] }],
      false,
    );
    expect(mockToast.success).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(mockToast.success).toHaveBeenCalledWith("Room 101 assigned to Ben Ortiz.");
    expect(mockToast.error).not.toHaveBeenCalled();
    // The confirmed result is shown; Done returns to the room itself.
    expect(screen.getByTestId("assign-applied")).toBeTruthy();
    fireEvent.press(screen.getByTestId("assign-done"));
    await waitFor(() => expect(screen.getByTestId("assignment-sheet-rows")).toBeTruthy());
  });

  it("a rejected save is an error, not 'assigned', and a deliberate retry works", async () => {
    save.mockRejectedValueOnce(apiError(403, "Forbidden"));
    const screen = await loaded();
    fireEvent.press(screen.getByTestId("assignment-room-101"));
    fireEvent.press(screen.getByTestId("assign-candidate-hk-2"));
    fireEvent.press(screen.getByTestId("assign-continue"));
    await act(async () => {
      fireEvent.press(screen.getByTestId("assign-confirm"));
    });
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(screen.getByTestId("assign-panel-review")).toBeTruthy();
    expect(screen.getByTestId("assign-banner")).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId("assign-confirm"));
    });
    expect(mockToast.success).toHaveBeenCalledWith("Room 101 assigned to Ben Ortiz.");
  });

  it("remove assignment asks for confirmation, then removes only while the owner is who the supervisor saw", async () => {
    const screen = await loaded();
    fireEvent.press(screen.getByTestId("assignment-room-102"));
    fireEvent.press(screen.getByTestId("assignment-sheet-remove"));
    expect(screen.getByTestId("assign-remove-owner")).toBeTruthy();
    expect(remove).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.press(screen.getByTestId("assign-remove-confirm"));
    });
    expect(remove).toHaveBeenCalledWith(hotelDateKey(new Date(), "America/Chicago"), "room-102", "hk-1");
    expect(mockToast.success).toHaveBeenCalledWith("Room 102 is now unassigned.");
  });

  it("'Open full Room Board detail' leaves for the room board with this room and closes the sheet", async () => {
    const screen = await loaded();
    fireEvent.press(screen.getByTestId("assignment-room-102"));
    fireEvent.press(screen.getByTestId("assignment-sheet-open-board"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/(app)/room-board", params: { roomId: "room-102" } });
    expect(screen.queryByTestId("assignment-sheet")).toBeNull();
  });
});

describe("stale and offline", () => {
  it("offline keeps the verified rooms, says it is not live, and pauses every assignment action", async () => {
    const screen = await loaded();
    mockAppState.isOnline = false;
    screen.rerender(ui());
    await waitFor(() => expect(text(screen.getByTestId("assignments-status-pill"))).toBe("Offline"));
    expect(text(screen.getByTestId("assignments-status-text"))).toMatch(/^Offline/);
    expect(screen.getByTestId("assignment-room-101")).toBeTruthy();
    // No card offers to assign, and the sheet's buttons are disabled.
    expect(screen.getByTestId("assignment-room-cta-101").findByProps({ children: "View room" })).toBeTruthy();
    fireEvent.press(screen.getByTestId("assignment-room-101"));
    expect(screen.queryByTestId("assign-title")).toBeNull();
    expect(screen.getByTestId("assignment-sheet-paused")).toBeTruthy();
    expect(screen.getByTestId("assignment-sheet-assign").props.accessibilityState.disabled).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("team tab and scope", () => {
  it("the Rooms view stays fully functional after a round trip through Team", async () => {
    const screen = await loaded();
    fireEvent.press(screen.getByTestId("assignments-tab-team"));
    await waitFor(() => expect(screen.getByTestId("team-card-hk-1")).toBeTruthy());
    expect(screen.queryByTestId("assignment-room-101")).toBeNull();
    fireEvent.press(screen.getByTestId("assignments-tab-rooms"));
    await waitFor(() => expect(screen.getByTestId("assignment-room-101")).toBeTruthy());
    expect(text(screen.getByTestId("assignments-metric-unassigned-value"))).toBe("2");
  });

  it("another hotel or person starts with a clean search and no filters", async () => {
    const screen = await loaded();
    fireEvent.changeText(screen.getByTestId("assignments-search"), "ana");
    await waitFor(() => expect(screen.queryByTestId("assignment-room-101")).toBeNull());
    mockAppState.user = { id: "sup-1", role: "housekeeping_supervisor", tenant_id: "h2" };
    screen.rerender(ui());
    await waitFor(() => expect(screen.getByTestId("assignments-search").props.value).toBe(""));
  });

  it("the screen adds only the Rooms / Team switch — no further top-level tabs", async () => {
    const screen = await loaded();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });
});

describe("Spanish", () => {
  it("renders the redesigned screen in Spanish without raw keys", async () => {
    mockLanguage = "es";
    const screen = await loaded();
    expect(screen.getByText("Cuartos")).toBeTruthy();
    expect(screen.queryByText(/assignments\.v2\./)).toBeNull();
    expect(text(screen.getByTestId("assignments-status-pill"))).toBe("En vivo");
  });
});
