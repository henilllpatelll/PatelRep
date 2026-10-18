import React from "react";
import { Dimensions, StyleSheet } from "react-native";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react-native";

let mockSystemScheme: "light" | "dark" = "light";
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({
  __esModule: true,
  default: () => mockSystemScheme,
}));
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn(), setParams: jest.fn() },
  useLocalSearchParams: () => ({}),
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

// The sheet and picker have their own tests; here they only prove which room the screen handed them.
jest.mock("@/components/supervisor/RoomDetailSheet", () => {
  const { Text, View } = require("react-native");
  return {
    RoomDetailSheet: (props: { room: { roomNumber: string; roomId: string } }) => (
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
import { darkTheme, lightTheme } from "@/components/shared/tokens";
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

const text = (node: { props: { children?: unknown } }) => String(node.props.children);

beforeEach(() => {
  jest.clearAllMocks();
  mockSystemScheme = "light";
  mockAppState.isOnline = true;
  board.mockResolvedValue(hotelBoard());
  (fetchAssignableStaff as jest.Mock).mockResolvedValue(STAFF);
  (fetchShiftRoster as jest.Mock).mockResolvedValue([]);
  (fetchInspectionHistory as jest.Mock).mockResolvedValue([]);
  (fetchLateCheckoutsVerified as jest.Mock).mockResolvedValue([]);
  (fetchBlockedTasks as jest.Mock).mockResolvedValue({ items: [] });
});

afterEach(() => jest.restoreAllMocks());

describe("Room Board — header and readiness", () => {
  it("shows the compact header with a live, just-verified status and a refresh control", async () => {
    const screen = await renderLoaded();
    expect(screen.getByTestId("room-board-header")).toBeTruthy();
    expect(text(screen.getByTestId("room-board-status-text"))).toBe("roomBoard.header.liveNow");
    expect(screen.getByLabelText("roomBoard.header.refresh")).toBeTruthy();
    // No "More" button: there is nothing behind it in this phase.
    expect(screen.queryByLabelText(/more/i)).toBeNull();
  });

  it("reports readiness from the verified board: ready ÷ in-service, with out-of-service rooms named separately", async () => {
    const screen = await renderLoaded();
    // 10 rooms, 3 out of service/order → 7 in service; 1 INSPECTED is ready.
    expect(text(screen.getByTestId("room-board-readiness-headline"))).toBe(`roomBoard.card.headline:${JSON.stringify({ ready: 1, total: 7 })}`);
    expect(text(within(screen.getByTestId("room-board-stat-toClean")).getAllByText(/^\d+$/)[0])).toBe("4");
    expect(text(within(screen.getByTestId("room-board-stat-working")).getAllByText(/^\d+$/)[0])).toBe("1");
    expect(text(within(screen.getByTestId("room-board-stat-toInspect")).getAllByText(/^\d+$/)[0])).toBe("1");
    expect(text(within(screen.getByTestId("room-board-stat-ready")).getAllByText(/^\d+$/)[0])).toBe("1");
    expect(text(screen.getByTestId("room-board-readiness-footer"))).toContain(`roomBoard.card.outOfService:${JSON.stringify({ count: 3 })}`);
    expect(screen.queryByTestId("room-board-readiness-unknown")).toBeNull();
  });

  it("counts an unrecognised status aloud instead of dropping it", async () => {
    board.mockResolvedValue([...hotelBoard(), rawRoom("301", "MYSTERY")]);
    const screen = await renderLoaded();
    expect(text(screen.getByTestId("room-board-readiness-unknown"))).toBe(`roomBoard.card.unrecognized:${JSON.stringify({ count: 1 })}`);
  });

  it("makes no readiness claim and draws no bar when nothing is in service", async () => {
    board.mockResolvedValue([rawRoom("101", "OOO"), rawRoom("102", "OUT_OF_SERVICE")]);
    const screen = render(ui());
    await waitFor(() => expect(screen.getByTestId("board-tile-101")).toBeTruthy());
    expect(text(screen.getByTestId("room-board-readiness-headline"))).toBe("roomBoard.card.noneInService");
    expect(screen.queryByTestId("room-board-readiness-bar")).toBeNull();
  });

  it("shows only substantiated attention chips, and none when nothing needs attention", async () => {
    const screen = await renderLoaded();
    expect(screen.getByTestId("room-board-signal-unassigned")).toBeTruthy();
    expect(screen.getByTestId("room-board-signal-urgent")).toBeTruthy(); // the VIP room that is not ready
    expect(screen.getByTestId("room-board-signal-vip")).toBeTruthy();
    expect(screen.queryByTestId("room-board-signal-dnd")).toBeNull();
    // Informational only: no dead buttons.
    expect(screen.getByTestId("room-board-signal-vip").props.accessibilityRole).toBe("text");

    board.mockResolvedValue([rawRoom("101", "INSPECTED"), rawRoom("102", "OOO")]);
    await act(async () => {
      fireEvent.press(screen.getByTestId("room-board-refresh"));
    });
    await waitFor(() => expect(screen.queryByTestId("room-board-attention")).toBeNull());
  });
});

describe("Room Board — status navigation", () => {
  it("shows every segment with its verified count and marks the selected one", async () => {
    const screen = await renderLoaded();
    const expected = { all: 10, toClean: 4, working: 1, toInspect: 1, ready: 1 };
    for (const [key, count] of Object.entries(expected)) {
      const chip = screen.getByTestId(`room-board-seg-${key}`);
      expect(chip.props.accessibilityLabel).toBe(`roomBoard.seg.a11y:${JSON.stringify({ label: `roomBoard.seg.${key}`, count })}`);
      expect(chip.props.accessibilityRole).toBe("tab");
    }
    expect(screen.getByTestId("room-board-seg-all").props.accessibilityState.selected).toBe(true);
    fireEvent.press(screen.getByTestId("room-board-seg-working"));
    expect(screen.getByTestId("room-board-seg-working").props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId("room-board-seg-all").props.accessibilityState.selected).toBe(false);
  });

  it("filters the board: CLEAN is under To inspect, IN_PROGRESS under Working, INSPECTED under Ready", async () => {
    const screen = await renderLoaded();
    fireEvent.press(screen.getByTestId("room-board-seg-toInspect"));
    expect(screen.getByTestId("board-tile-105")).toBeTruthy();
    expect(screen.queryByTestId("board-tile-104")).toBeNull();
    expect(screen.queryByTestId("board-tile-101")).toBeNull();

    fireEvent.press(screen.getByTestId("room-board-seg-working"));
    expect(screen.getByTestId("board-tile-104")).toBeTruthy();
    expect(screen.queryByTestId("board-tile-105")).toBeNull();

    fireEvent.press(screen.getByTestId("room-board-seg-ready"));
    expect(screen.getByTestId("board-tile-106")).toBeTruthy();
    expect(screen.queryByTestId("board-tile-104")).toBeNull();

    fireEvent.press(screen.getByTestId("room-board-seg-toClean"));
    for (const room of ["101", "102", "103", "201"]) expect(screen.getByTestId(`board-tile-${room}`)).toBeTruthy();
    expect(screen.queryByTestId("board-tile-107")).toBeNull(); // out of order stays out of the work segments
  });

  it("keeps out-of-service rooms visible under All", async () => {
    const screen = await renderLoaded();
    for (const room of ["107", "108", "109"]) expect(screen.getByTestId(`board-tile-${room}`)).toBeTruthy();
  });

  it("explains an empty segment and lets the supervisor go back to All", async () => {
    board.mockResolvedValue([rawRoom("101", "DIRTY")]);
    const screen = render(ui());
    await waitFor(() => expect(screen.getByTestId("board-tile-101")).toBeTruthy());
    fireEvent.press(screen.getByTestId("room-board-seg-ready"));
    expect(screen.getByTestId("room-board-segment-empty")).toBeTruthy();
    expect(screen.getByText("roomBoard.segmentEmpty")).toBeTruthy();
    fireEvent.press(screen.getByTestId("room-board-show-all"));
    expect(screen.getByTestId("board-tile-101")).toBeTruthy();
    expect(screen.queryByTestId("room-board-segment-empty")).toBeNull();
  });
});

describe("Room Board — floors and buildings", () => {
  it("groups by building and floor with per-floor counts for a two-building hotel", async () => {
    const screen = await renderLoaded();
    expect(screen.getByTestId("room-board-building-b:A")).toBeTruthy();
    expect(screen.getByTestId("room-board-building-b:B")).toBeTruthy();
    const floorA = screen.getByTestId("room-board-floor-f:A:1");
    expect(within(floorA).getByText(`roomBoard.floor:${JSON.stringify({ floor: 1 })}`)).toBeTruthy();
    expect(within(floorA).getByText(`roomBoard.roomCount:${JSON.stringify({ count: 9 })}`)).toBeTruthy();
    expect(screen.getByTestId("room-board-floor-f:B:2")).toBeTruthy();
  });

  it("shows 'x of y' for a floor when a segment filters it, and no building heading for a single building", async () => {
    board.mockResolvedValue(hotelBoard().filter((row) => row.rooms?.building === "A"));
    const screen = await renderLoaded();
    expect(screen.queryByTestId(/^room-board-building-/)).toBeNull();
    fireEvent.press(screen.getByTestId("room-board-seg-toClean"));
    expect(
      within(screen.getByTestId("room-board-floor-f:A:1")).getByText(`roomBoard.roomCountOf:${JSON.stringify({ shown: 3, total: 9 })}`),
    ).toBeTruthy();
  });
});

describe("Room Board — room cards", () => {
  it("shows number, labelled status, assignment and detail on each card", async () => {
    const screen = await renderLoaded();
    expect(text(screen.getByTestId("board-tile-number-101"))).toBe("101");
    expect(screen.getByTestId("board-tile-status-101")).toHaveTextContent("roomBoard.card.status.DIRTY");
    expect(text(screen.getByTestId("board-tile-assignee-101"))).toBe("roomBoard.unassigned");
    expect(screen.getByTestId("board-tile-status-105")).toHaveTextContent("roomBoard.card.status.CLEAN");
    expect(text(screen.getByTestId("board-tile-assignee-105"))).toBe("Ben Ortiz");
    expect(screen.getByTestId("board-tile-status-104")).toHaveTextContent("roomBoard.card.status.IN_PROGRESS");
    expect(text(screen.getByTestId("board-tile-detail-104"))).toBe("roomBoard.card.base.IN_PROGRESS");
    expect(screen.getByTestId("board-tile-status-106")).toHaveTextContent("roomBoard.card.status.INSPECTED");
    expect(screen.getByTestId("board-tile-status-107")).toHaveTextContent("roomBoard.card.status.OOO");
    expect(screen.getByTestId("board-tile-status-108")).toHaveTextContent("roomBoard.card.status.OUT_OF_ORDER");
    expect(screen.getByTestId("board-tile-status-109")).toHaveTextContent("roomBoard.card.status.OUT_OF_SERVICE");
    expect(screen.queryByTestId("board-tile-assignee-107")).toBeNull();
  });

  it("an assigned room with an unknown name is shown as assigned, never unassigned", async () => {
    board.mockResolvedValue([rawRoom("101", "DIRTY", { assigned_to: "ghost", assignment_id: "a1" })]);
    const screen = await renderLoaded();
    expect(text(screen.getByTestId("board-tile-assignee-101"))).toBe("roomBoard.assigneeUnknown");
  });

  it("announces room, status, assignment and detail in one label", async () => {
    const screen = await renderLoaded();
    const label = screen.getByTestId("board-tile-105").props.accessibilityLabel as string;
    expect(label).toContain("roomBoard.card.status.CLEAN");
    expect(label).toContain("Ben Ortiz");
    expect(screen.getByTestId("board-tile-105").props.accessibilityRole).toBe("button");
  });

  it("opens the existing room sheet for the tapped room, and keeps it open when the segment changes", async () => {
    const screen = await renderLoaded();
    fireEvent.press(screen.getByTestId("board-tile-105"));
    expect(text(screen.getByTestId("sheet-room"))).toBe("105");
    fireEvent.press(screen.getByTestId("room-board-seg-ready"));
    expect(text(screen.getByTestId("sheet-room"))).toBe("105");
  });

  it("repaints a card when the board changes (a refresh after a realtime event)", async () => {
    const screen = await renderLoaded();
    expect(screen.getByTestId("board-tile-status-101")).toHaveTextContent("roomBoard.card.status.DIRTY");
    board.mockResolvedValue(hotelBoard().map((row) => (row.room_id === "room-101" ? { ...row, status: "IN_PROGRESS", assigned_to: "hk-1", assignment_id: "as-101" } : row)));
    await act(async () => {
      fireEvent.press(screen.getByTestId("room-board-refresh"));
    });
    await waitFor(() => expect(screen.getByTestId("board-tile-status-101")).toHaveTextContent("roomBoard.card.status.IN_PROGRESS"));
    expect(text(screen.getByTestId("board-tile-assignee-101"))).toBe("Ana Torres");
    expect(text(within(screen.getByTestId("room-board-stat-working")).getAllByText(/^\d+$/)[0])).toBe("2");
  });
});

describe("Room Board — states", () => {
  it("shows a lightweight skeleton while loading, with no room counts", () => {
    board.mockReturnValue(new Promise(() => undefined));
    const screen = render(ui());
    expect(screen.getByTestId("room-board-loading")).toBeTruthy();
    expect(screen.queryByTestId("room-board-readiness")).toBeNull();
    expect(text(screen.getByTestId("room-board-status-text"))).toBe("roomBoard.header.loading");
  });

  it("a verified empty hotel says so and offers a refresh — different from a failure", async () => {
    board.mockResolvedValue([]);
    const screen = render(ui());
    await waitFor(() => expect(screen.getByTestId("room-board-empty")).toBeTruthy());
    expect(screen.getByText("roomBoard.state.verifiedEmpty")).toBeTruthy();
    expect(screen.queryByText("roomBoard.state.unavailableError")).toBeNull();
    board.mockResolvedValue(hotelBoard());
    await act(async () => {
      fireEvent.press(screen.getByTestId("room-board-empty-refresh"));
    });
    await waitFor(() => expect(screen.getByTestId("board-tile-101")).toBeTruthy());
  });

  it("a failed load is 'unable to load' with a retry, never a board or an empty board", async () => {
    board.mockRejectedValue(Object.assign(new Error("down"), { status: 500 }));
    const screen = render(ui());
    await waitFor(() => expect(screen.getByText("roomBoard.state.unavailableError")).toBeTruthy(), { timeout: 5000 });
    expect(text(screen.getByTestId("room-board-status-text"))).toBe("roomBoard.header.unavailable");
    expect(screen.queryByTestId("room-board-readiness")).toBeNull();
    expect(screen.queryByTestId("room-board-empty")).toBeNull();
    expect(screen.getByText("roomBoard.state.retry")).toBeTruthy();
  });

  it("offline after a good load keeps the rooms, drops 'live', shows the last verified time and pauses changes", async () => {
    const screen = await renderLoaded();
    mockAppState.isOnline = false;
    screen.rerender(ui());
    await waitFor(() => expect(text(screen.getByTestId("room-board-status-text"))).toMatch(/^roomBoard\.header\.offline:/));
    expect(screen.getByTestId("board-tile-101")).toBeTruthy();
    expect(screen.getByTestId("room-board-not-live")).toBeTruthy();
  });
});

describe("Room Board — layout, themes and virtualisation", () => {
  const rowsOf = (screen: ReturnType<typeof render>) =>
    screen.getAllByTestId("board-row").map((row) => within(row).queryAllByTestId(/^board-tile-\d+$/).length);

  it("uses two columns on an ordinary phone", async () => {
    jest.spyOn(Dimensions, "get").mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1 });
    const screen = await renderLoaded();
    expect(rowsOf(screen)[0]).toBe(2);
  });

  it("falls back to one wide column on a narrow phone with large text", async () => {
    jest.spyOn(Dimensions, "get").mockReturnValue({ width: 320, height: 640, scale: 2, fontScale: 1.6 });
    const screen = await renderLoaded();
    expect(new Set(rowsOf(screen))).toEqual(new Set([1]));
  });

  it("virtualises a large hotel instead of rendering every room", async () => {
    const rows = Array.from({ length: 300 }, (_, i) => rawRoom(String(100 * (Math.floor(i / 30) + 1) + (i % 30) + 1), "DIRTY"));
    board.mockResolvedValue(rows);
    const screen = render(ui());
    await waitFor(() => expect(screen.getByTestId("board-tile-101")).toBeTruthy());
    expect(screen.queryAllByTestId(/^board-tile-\d+$/).length).toBeLessThan(120);
    expect(screen.queryByTestId("board-tile-1030")).toBeNull();
    expect(text(screen.getByTestId("room-board-readiness-headline"))).toBe(`roomBoard.card.headline:${JSON.stringify({ ready: 0, total: 300 })}`);
  });

  it("renders in both themes with the theme's own surface colour", async () => {
    const light = await renderLoaded();
    const lightCard = StyleSheet.flatten(light.getByTestId("room-board-readiness").props.style);
    expect(lightCard.backgroundColor).toBe(lightTheme.surface);
    light.unmount();

    mockSystemScheme = "dark";
    const dark = await renderLoaded();
    const darkCard = StyleSheet.flatten(dark.getByTestId("room-board-readiness").props.style);
    expect(darkCard.backgroundColor).toBe(darkTheme.surface);
    expect(darkCard.backgroundColor).not.toBe(lightCard.backgroundColor);
  });
});
