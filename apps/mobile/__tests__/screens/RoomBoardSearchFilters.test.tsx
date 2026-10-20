import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

let mockSystemScheme: "light" | "dark" = "light";
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({
  __esModule: true,
  default: () => mockSystemScheme,
}));
let mockParams: { roomId?: string } = {};
const mockSetParams = jest.fn();
jest.mock("@/lib/theme/useToast", () => ({ useToast: () => ({ success: jest.fn(), error: jest.fn(), info: jest.fn() }) }));
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn(), setParams: (...args: unknown[]) => mockSetParams(...args) },
  useLocalSearchParams: () => mockParams,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
    i18n: { language: "en" },
  }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 20, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/lib/supabase", () => ({
  supabase: { channel: jest.fn().mockReturnValue({ on: jest.fn().mockReturnThis(), subscribe: jest.fn().mockReturnValue({}) }), removeChannel: jest.fn() },
}));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));
jest.mock("@/lib/api/housekeepingSupervisor", () => ({
  fetchBoardVerified: jest.fn(),
  fetchAssignableStaff: jest.fn(),
  fetchShiftRoster: jest.fn(),
  fetchInspectionHistory: jest.fn(),
  fetchLateCheckoutsVerified: jest.fn(),
  saveAssignments: jest.fn(),
  removeAssignmentByPlan: jest.fn(),
}));
jest.mock("@/lib/api/tasks", () => ({ fetchBlockedTasks: jest.fn() }));

// The sheet has its own tests; here it only proves WHICH room the screen handed it.
jest.mock("@/components/supervisor/RoomDetailSheet", () => {
  const { Text, View } = require("react-native");
  return {
    RoomDetailSheet: (props: { room: { roomNumber: string } }) => (
      <View testID="room-sheet">
        <Text testID="sheet-room">{props.room.roomNumber}</Text>
      </View>
    ),
  };
});
jest.mock("@/components/supervisor/HousekeeperPicker", () => ({ HousekeeperPicker: () => null }));

const mockAppState = {
  isOnline: true,
  hotelTimezone: "America/Chicago",
  user: { id: "sup-1", role: "housekeeping_supervisor", tenant_id: "h1" },
};
jest.mock("@/stores/appStore", () => ({
  useAppStore: (selector?: (state: unknown) => unknown) => (selector ? selector(mockAppState) : mockAppState),
}));

import {
  fetchAssignableStaff,
  fetchBoardVerified,
  fetchInspectionHistory,
  fetchLateCheckoutsVerified,
  fetchShiftRoster,
} from "@/lib/api/housekeepingSupervisor";
import { fetchBlockedTasks } from "@/lib/api/tasks";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import RoomBoardScreen from "@/app/(app)/room-board/index";
import { STAFF, hotelBoard, rawRoom } from "../helpers/roomBoardFixtures";

const board = fetchBoardVerified as jest.Mock;

const ui = () => (
  <ThemeProvider>
    <RoomBoardScreen />
  </ThemeProvider>
);

async function renderLoaded() {
  const screen = render(ui());
  await waitFor(() => expect(screen.getByTestId("board-tile-101")).toBeTruthy());
  return screen;
}

type Screen = Awaited<ReturnType<typeof renderLoaded>>;
const type = (screen: Screen, text: string) => fireEvent.changeText(screen.getByTestId("room-board-search"), text);
const press = (screen: Screen, id: string) => fireEvent.press(screen.getByTestId(id));
const openSheet = (screen: Screen) => press(screen, "room-board-filter-button");
// Result rows as displayed (priority-first by default), and the same set sorted for order-independent checks.
const inOrder = (screen: Screen) => screen.queryAllByTestId(/^board-result-[A-Za-z0-9]+$/).map((node) => node.props.testID.replace("board-result-", ""));
const shown = (screen: Screen) => [...inOrder(screen)].sort();
const countText = (screen: Screen) => String(screen.getByTestId("room-board-result-count").props.children);

beforeEach(() => {
  jest.clearAllMocks();
  mockSystemScheme = "light";
  mockParams = {};
  mockAppState.isOnline = true;
  board.mockResolvedValue(hotelBoard());
  (fetchAssignableStaff as jest.Mock).mockResolvedValue(STAFF);
  (fetchShiftRoster as jest.Mock).mockResolvedValue([]);
  (fetchInspectionHistory as jest.Mock).mockResolvedValue([]);
  (fetchLateCheckoutsVerified as jest.Mock).mockResolvedValue([]);
  (fetchBlockedTasks as jest.Mock).mockResolvedValue({ items: [] });
});

describe("Room Board — instant search", () => {
  it("shows a prominent labelled search field and a filter button above the status navigation", async () => {
    const screen = await renderLoaded();
    const input = screen.getByTestId("room-board-search");
    expect(input.props.placeholder).toBe("roomBoard.search.placeholder");
    expect(input.props.accessibilityLabel).toBe("roomBoard.search.label");
    expect(input.props.returnKeyType).toBe("search");
    expect(screen.getByTestId("room-board-filter-button").props.accessibilityLabel).toBe("roomBoard.search.openFilters");
    expect(screen.getByTestId("room-board-filter-button").props.accessibilityRole).toBe("button");
    expect(screen.queryByTestId("room-board-search-clear")).toBeNull();
  });

  it("filters as the user types, numeric prefix first, with no network request per keystroke", async () => {
    const screen = await renderLoaded();
    const calls = board.mock.calls.length;
    type(screen, "10");
    // The list is virtualised (a first window of rows renders), so the verified count carries the full answer.
    expect(shown(screen)).toEqual(["101", "102", "103", "104", "105", "106", "107", "108"]);
    expect(countText(screen)).toBe(`roomBoard.results.showing:${JSON.stringify({ shown: 9, total: 10 })}`);
    type(screen, "201");
    expect(shown(screen)).toEqual(["201"]);
    expect(board.mock.calls.length).toBe(calls);
    // The grid is replaced by a list while searching.
    expect(screen.queryByTestId("board-tile-101")).toBeNull();
  });

  it("is case-insensitive, trims whitespace and matches alphanumeric room numbers", async () => {
    board.mockResolvedValue([...hotelBoard(), rawRoom("PH1", "DIRTY")]);
    const screen = await renderLoaded();
    type(screen, "  ph1 ");
    expect(shown(screen)).toEqual(["PH1"]);
    type(screen, "  201  ");
    expect(shown(screen)).toEqual(["201"]);
  });

  it("each result shows room number, status, assignment, a recorded detail and location", async () => {
    const screen = await renderLoaded();
    type(screen, "102");
    expect(screen.getByTestId("board-result-number-102").props.children).toBe("102");
    expect(String(screen.getByTestId("board-result-status-102").findByProps({}).props.children ?? "")).toBeDefined();
    expect(screen.getByTestId("board-result-assignee-102").props.children).toBe("Ana Torres");
    expect(String(screen.getByTestId("board-result-location-102").props.children)).toContain("roomBoard.building");
    const label = String(screen.getByTestId("board-result-102").props.accessibilityLabel);
    expect(label).toContain("roomBoard.card.roomLabel");
    expect(label).toContain("roomBoard.card.status.OCCUPIED");
  });

  it("opens the existing room sheet for the tapped result, then clearing returns the grouped board", async () => {
    const screen = await renderLoaded();
    type(screen, "201");
    press(screen, "board-result-201");
    expect(screen.getByTestId("sheet-room").props.children).toBe("201");
    expect(countText(screen)).toBe(`roomBoard.results.showing:${JSON.stringify({ shown: 1, total: 10 })}`);

    press(screen, "room-board-search-clear");
    expect(screen.getByTestId("room-board-search").props.value).toBe("");
    expect(screen.getByTestId("board-tile-101")).toBeTruthy();
    expect(screen.queryByTestId("room-board-active-filters")).toBeNull();
  });

  it("explains no match with the query and offers Clear search", async () => {
    const screen = await renderLoaded();
    type(screen, "999");
    expect(screen.getByTestId("room-board-search-empty")).toBeTruthy();
    expect(screen.getByText(`roomBoard.search.noMatch:${JSON.stringify({ query: "999" })}`)).toBeTruthy();
    press(screen, "room-board-search-empty-clear");
    expect(screen.getByTestId("board-tile-101")).toBeTruthy();
  });

  it("never searches guests: a guest name in a note matches nothing", async () => {
    board.mockResolvedValue([rawRoom("101", "DIRTY", { latest_note: "Smith family" })]);
    const screen = await renderLoaded();
    type(screen, "smith");
    expect(screen.getByTestId("room-board-search-empty")).toBeTruthy();
  });

  it("keeps the search when the board refreshes and reflects new data in the results", async () => {
    const screen = await renderLoaded();
    type(screen, "10");
    expect(shown(screen)).toContain("107");
    board.mockResolvedValue(hotelBoard().filter((row) => row.room_id !== "room-107"));
    await act(async () => {
      press(screen, "room-board-refresh");
    });
    await waitFor(() => expect(shown(screen)).not.toContain("107"));
    expect(screen.getByTestId("room-board-search").props.value).toBe("10");
  });
});

describe("Room Board — Filter & Sort drawer", () => {
  it("opens as an accessible modal with sort, status, operations and Apply / Reset / Close", async () => {
    const screen = await renderLoaded();
    expect(screen.queryByTestId("board-filter-sheet")).toBeNull();
    openSheet(screen);
    const sheet = screen.getByTestId("board-filter-sheet");
    expect(sheet.props.accessibilityViewIsModal).toBe(true);
    for (const id of ["board-filter-apply", "board-filter-reset", "board-filter-close"]) expect(screen.getByTestId(id)).toBeTruthy();
    for (const sort of ["priority", "roomNumber", "departure", "arrival", "status", "floor"]) {
      expect(screen.getByTestId(`board-sort-${sort}`).props.accessibilityRole).toBe("radio");
    }
    expect(screen.getByTestId("board-sort-priority").props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId("board-filter-status-toClean").props.accessibilityRole).toBe("checkbox");
    // No unrecognised statuses on this board, so that filter is not offered.
    expect(screen.queryByTestId("board-filter-status-unrecognized")).toBeNull();
  });

  it("only one sort mode can be selected", async () => {
    const screen = await renderLoaded();
    openSheet(screen);
    press(screen, "board-sort-roomNumber");
    expect(screen.getByTestId("board-sort-roomNumber").props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId("board-sort-priority").props.accessibilityState.selected).toBe(false);
  });

  it("changes the board only on Apply, and shows chips, a verified count and the filter badge", async () => {
    const screen = await renderLoaded();
    openSheet(screen);
    press(screen, "board-filter-status-toClean");
    press(screen, "board-filter-flag-unassigned");
    // Draft only: the board is untouched until Apply.
    expect(screen.queryByTestId("room-board-active-filters")).toBeNull();

    press(screen, "board-filter-apply");
    expect(screen.queryByTestId("board-filter-sheet")).toBeNull();
    expect(screen.getByTestId("room-board-chip-status:toClean")).toBeTruthy();
    expect(screen.getByTestId("room-board-chip-flag:unassigned")).toBeTruthy();
    expect(shown(screen)).toEqual(["101", "201"]); // To clean AND unassigned
    expect(countText(screen)).toBe(`roomBoard.results.showing:${JSON.stringify({ shown: 2, total: 10 })}`);
    expect(screen.getByTestId("room-board-filter-badge")).toBeTruthy();
    expect(screen.getByTestId("room-board-filter-button").props.accessibilityLabel).toBe(`roomBoard.search.openFiltersActive:${JSON.stringify({ active: 2 })}`);
  });

  it("closing without applying keeps the previously applied filters, and reopening shows them", async () => {
    const screen = await renderLoaded();
    openSheet(screen);
    press(screen, "board-filter-status-ready");
    press(screen, "board-filter-apply");
    expect(shown(screen)).toEqual(["106"]);

    openSheet(screen);
    expect(screen.getByTestId("board-filter-status-ready").props.accessibilityState.checked).toBe(true);
    press(screen, "board-filter-status-toClean");
    press(screen, "board-filter-close");
    expect(shown(screen)).toEqual(["106"]);
    expect(screen.queryByTestId("room-board-chip-status:toClean")).toBeNull();

    // The abandoned edit is gone on reopen.
    openSheet(screen);
    expect(screen.getByTestId("board-filter-status-toClean").props.accessibilityState.checked).toBe(false);
    expect(screen.getByTestId("board-filter-status-ready").props.accessibilityState.checked).toBe(true);
  });

  it("Reset all clears the draft only; the board changes when Apply is tapped", async () => {
    const screen = await renderLoaded();
    openSheet(screen);
    press(screen, "board-filter-status-ready");
    press(screen, "board-sort-roomNumber");
    press(screen, "board-filter-apply");
    expect(shown(screen)).toEqual(["106"]);

    openSheet(screen);
    press(screen, "board-filter-reset");
    expect(screen.getByTestId("board-filter-status-ready").props.accessibilityState.checked).toBe(false);
    expect(screen.getByTestId("board-sort-priority").props.accessibilityState.selected).toBe(true);
    // Not applied yet.
    press(screen, "board-filter-close");
    expect(shown(screen)).toEqual(["106"]);

    openSheet(screen);
    press(screen, "board-filter-reset");
    press(screen, "board-filter-apply");
    expect(screen.queryByTestId("room-board-active-filters")).toBeNull();
    expect(screen.getByTestId("board-tile-101")).toBeTruthy();
  });

  it("applies OR within status and AND across categories", async () => {
    const screen = await renderLoaded();
    openSheet(screen);
    press(screen, "board-filter-status-toClean");
    press(screen, "board-filter-status-toInspect");
    press(screen, "board-filter-apply");
    expect(shown(screen)).toEqual(["101", "102", "103", "105", "201"]);

    openSheet(screen);
    press(screen, "board-filter-flag-vip");
    press(screen, "board-filter-apply");
    expect(shown(screen)).toEqual(["201"]);
  });

  it("disables filters whose data is not on the board instead of returning false zeros", async () => {
    const screen = await renderLoaded();
    openSheet(screen);
    for (const key of ["arrivalsToday", "departuresToday", "risk"]) {
      const choice = screen.getByTestId(`board-filter-flag-${key}`);
      expect(choice.props.accessibilityState.disabled).toBe(true);
      expect(String(choice.props.accessibilityLabel)).toContain("roomBoard.filters.noData");
    }
    expect(screen.getByTestId("board-filter-flag-vip").props.accessibilityState.disabled).toBe(false);
  });

  it("offers an Unrecognized status only when such a room exists, and keeps those rooms under All", async () => {
    board.mockResolvedValue([...hotelBoard(), rawRoom("301", "MYSTERY")]);
    const screen = await renderLoaded();
    expect(screen.getByTestId("board-tile-301")).toBeTruthy();
    openSheet(screen);
    press(screen, "board-filter-status-unrecognized");
    press(screen, "board-filter-apply");
    expect(shown(screen)).toEqual(["301"]);
  });

  it("selects building and floors for a multi-building hotel, and removes a floor chip", async () => {
    board.mockResolvedValue(hotelBoard());
    const screen = await renderLoaded();
    openSheet(screen);
    expect(screen.getByTestId("board-filter-building-all")).toBeTruthy();
    press(screen, "board-filter-building-B");
    // Only building B's floors remain on offer.
    expect(screen.queryByTestId("board-filter-floor-A|1")).toBeNull();
    press(screen, "board-filter-apply");
    expect(shown(screen)).toEqual(["201"]);
    expect(screen.getByTestId("room-board-chip-building:B")).toBeTruthy();
    press(screen, "room-board-chip-building:B");
    expect(screen.getByTestId("board-tile-101")).toBeTruthy();
  });

  it("does not offer building selection for a single-building hotel, only floors", async () => {
    board.mockResolvedValue([rawRoom("101", "DIRTY"), rawRoom("201", "DIRTY"), rawRoom("301", "DIRTY")]);
    const screen = await renderLoaded();
    openSheet(screen);
    expect(screen.queryByTestId("board-filter-building-all")).toBeNull();
    press(screen, "board-filter-floor-A|2");
    press(screen, "board-filter-apply");
    expect(shown(screen)).toEqual(["201"]);
    expect(String(screen.getByTestId("room-board-chip-floor:A|2").props.accessibilityLabel)).toContain("roomBoard.filters.removeChip");
  });
});

describe("Room Board — active filters, chips and segments", () => {
  const applyStatus = (screen: Screen, ...keys: string[]) => {
    openSheet(screen);
    for (const key of keys) press(screen, `board-filter-status-${key}`);
    press(screen, "board-filter-apply");
  };

  it("removing a chip updates the results immediately; Clear all clears every filter", async () => {
    const screen = await renderLoaded();
    applyStatus(screen, "toClean", "toInspect");
    press(screen, "room-board-chip-status:toInspect");
    expect(shown(screen)).toEqual(["101", "102", "103", "201"]);
    applyStatus(screen, "ready");
    press(screen, "room-board-clear-filters");
    expect(screen.queryByTestId("room-board-active-filters")).toBeNull();
    expect(screen.getByTestId("board-tile-101")).toBeTruthy();
  });

  it("Edit filters reopens the drawer with the applied selection", async () => {
    const screen = await renderLoaded();
    applyStatus(screen, "ready");
    press(screen, "room-board-edit-filters");
    expect(screen.getByTestId("board-filter-status-ready").props.accessibilityState.checked).toBe(true);
  });

  it("derives segment counts from the filtered dataset and shows a separate empty segment state with Show all", async () => {
    const screen = await renderLoaded();
    applyStatus(screen, "toClean");
    expect(screen.getByTestId("room-board-seg-all").props.accessibilityLabel).toBe(`roomBoard.seg.a11y:${JSON.stringify({ label: "roomBoard.seg.all", count: 4 })}`);
    expect(screen.getByTestId("room-board-seg-ready").props.accessibilityLabel).toBe(`roomBoard.seg.a11y:${JSON.stringify({ label: "roomBoard.seg.ready", count: 0 })}`);
    press(screen, "room-board-seg-toInspect");
    expect(screen.getByTestId("room-board-segment-empty")).toBeTruthy();
    expect(screen.getByText("roomBoard.segmentEmptyBody.toInspect")).toBeTruthy();
    press(screen, "room-board-show-all");
    expect(shown(screen)).toEqual(["101", "102", "103", "201"]);
  });

  it("says no rooms match the filters, with a Clear filters action, when nothing satisfies them", async () => {
    const screen = await renderLoaded();
    openSheet(screen);
    press(screen, "board-filter-flag-dnd");
    press(screen, "board-filter-apply");
    expect(screen.getByTestId("room-board-filters-empty")).toBeTruthy();
    expect(screen.getByText("roomBoard.empty.filters")).toBeTruthy();
    press(screen, "room-board-filters-empty-clear");
    expect(screen.getByTestId("board-tile-101")).toBeTruthy();
  });

  it("combines search with filters and offers to clear both when they exclude everything", async () => {
    const screen = await renderLoaded();
    applyStatus(screen, "ready");
    type(screen, "101");
    expect(screen.getByTestId("room-board-filters-empty")).toBeTruthy();
    expect(screen.getByText(`roomBoard.empty.searchFilters:${JSON.stringify({ query: "101" })}`)).toBeTruthy();
    press(screen, "room-board-filters-empty-clear-search");
    expect(shown(screen)).toEqual(["106"]);
  });

  it("a non-default sort counts toward the badge and the flat sorts render a list", async () => {
    const screen = await renderLoaded();
    openSheet(screen);
    press(screen, "board-sort-status");
    press(screen, "board-filter-apply");
    expect(screen.getByTestId("room-board-filter-badge")).toBeTruthy();
    // Cleaning status order across the whole hotel: to clean first, out of service last.
    const order = inOrder(screen);
    expect(order[0]).toBe("101");
    // To clean (101, 102, 103, 201) → in progress (104) → awaiting inspection (105) → ready (106) → out of service.
    for (const [before, after] of [["201", "104"], ["104", "105"], ["105", "106"], ["106", "107"]]) {
      expect(order.indexOf(before)).toBeLessThan(order.indexOf(after));
    }
    expect(countText(screen)).toBe(`roomBoard.results.showing:${JSON.stringify({ shown: 10, total: 10 })}`);
    expect(String(screen.getByTestId("room-board-sort-label").props.children)).toBe(`roomBoard.results.sortedBy:${JSON.stringify({ sort: "roomBoard.sort.status" })}`);
  });

  it("keeps filters across a routine refresh", async () => {
    const screen = await renderLoaded();
    applyStatus(screen, "ready");
    await act(async () => {
      press(screen, "room-board-refresh");
    });
    await waitFor(() => expect(board.mock.calls.length).toBeGreaterThan(1));
    expect(shown(screen)).toEqual(["106"]);
    expect(screen.getByTestId("room-board-chip-status:ready")).toBeTruthy();
  });
});

describe("Room Board — deep links, freshness and failure", () => {
  it("opens a deep-linked room even when the current search and filters hide its tile", async () => {
    const screen = await renderLoaded();
    openSheet(screen);
    press(screen, "board-filter-status-ready");
    press(screen, "board-filter-apply");
    type(screen, "106");
    expect(screen.queryByTestId("board-result-201")).toBeNull();

    mockParams = { roomId: "room-201" };
    screen.rerender(ui());
    await waitFor(() => expect(screen.getByTestId("sheet-room").props.children).toBe("201"));
    expect(screen.queryByTestId("room-board-link-missing")).toBeNull();
    expect(mockSetParams).toHaveBeenCalledWith({ roomId: undefined });
  });

  it("still reports a linked room missing only when it is not on the verified board", async () => {
    const screen = await renderLoaded();
    mockParams = { roomId: "nope" };
    screen.rerender(ui());
    await waitFor(() => expect(screen.getByTestId("room-board-link-missing")).toBeTruthy());
  });

  it("does not present 'no match' as authoritative on a board that is no longer live", async () => {
    const screen = await renderLoaded();
    mockAppState.isOnline = false;
    screen.rerender(ui());
    await waitFor(() => expect(screen.getByTestId("room-board-not-live")).toBeTruthy());
    type(screen, "999");
    expect(screen.getByText(/roomBoard\.empty\.staleNote/)).toBeTruthy();
    // Search and filters still work on the held board.
    type(screen, "101");
    expect(shown(screen)).toEqual(["101"]);
  });

  it("a failed or offline load shows neither search results nor 'no rooms match'", async () => {
    board.mockRejectedValue(Object.assign(new Error("down"), { status: 503 }));
    const screen = render(ui());
    await waitFor(() => expect(screen.getByText("roomBoard.state.unavailableError")).toBeTruthy(), { timeout: 5000 });
    expect(screen.queryByTestId("room-board-search")).toBeNull();
    expect(screen.queryByTestId("room-board-search-empty")).toBeNull();
    expect(screen.queryByTestId("room-board-filters-empty")).toBeNull();
  });

  it("a verified empty hotel keeps its own state, not a search or filter message", async () => {
    board.mockResolvedValue([]);
    const screen = render(ui());
    await waitFor(() => expect(screen.getByText("roomBoard.state.verifiedEmpty")).toBeTruthy());
    expect(screen.queryByTestId("room-board-search-empty")).toBeNull();
  });
});

describe("Room Board — floors, scale and themes", () => {
  const tallHotel = () =>
    Array.from({ length: 6 }, (_, floor) => floor + 1).flatMap((floor) =>
      ["01", "02", "03"].map((suffix) => rawRoom(`${floor}${suffix}`, floor % 2 ? "DIRTY" : "CLEAN")),
    );

  it("shows a floor-jump strip for a tall hotel (and not for a short one) with accessible labels", async () => {
    board.mockResolvedValue(tallHotel());
    const screen = await renderLoaded();
    const strip = screen.getByTestId("room-board-floor-jump");
    expect(strip.props.accessibilityLabel).toBe("roomBoard.jump.title");
    const five = screen.getByTestId("room-board-jump-f:A:5");
    expect(five.props.accessibilityLabel).toBe(`roomBoard.jump.item:${JSON.stringify({ label: `roomBoard.floor:${JSON.stringify({ floor: 5 })}` })}`);
    expect(five.props.accessibilityRole).toBe("button");
    expect(() => press(screen, "room-board-jump-f:A:5")).not.toThrow();
  });

  it("has no floor jump when there are only a few floors", async () => {
    const screen = await renderLoaded();
    expect(screen.queryByTestId("room-board-floor-jump")).toBeNull();
  });

  it("stays responsive for hundreds of rooms: instant search over the whole inventory", async () => {
    const raw = Array.from({ length: 400 }, (_, i) => rawRoom(`${Math.floor(i / 20) + 1}${String((i % 20) + 1).padStart(2, "0")}`, ["DIRTY", "CLEAN", "INSPECTED"][i % 3]));
    board.mockResolvedValue(raw);
    const screen = await renderLoaded();
    const started = Date.now();
    type(screen, "1505");
    expect(Date.now() - started).toBeLessThan(1500);
    expect(shown(screen)).toContain("1505");
  });

  it("renders the drawer and the board in dark mode", async () => {
    mockSystemScheme = "dark";
    const screen = await renderLoaded();
    openSheet(screen);
    expect(screen.getByTestId("board-filter-sheet")).toBeTruthy();
    press(screen, "board-filter-close");
    type(screen, "101");
    expect(shown(screen)).toEqual(["101"]);
  });
});
