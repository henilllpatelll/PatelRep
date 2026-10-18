import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

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
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
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

// The sheet and picker have their own tests; here they only expose the props the screen hands them.
const mockSheetProps: { current: Record<string, unknown> | null } = { current: null };
jest.mock("@/components/supervisor/RoomDetailSheet", () => {
  const { Text, Pressable, View } = require("react-native");
  return {
    RoomDetailSheet: (props: {
      room: { roomNumber: string };
      assigneeName: string | null;
      actionsDisabled?: boolean;
      onRemoveAssignment: (room: unknown) => void;
      onAssign: (room: unknown) => void;
    }) => {
      mockSheetProps.current = props as never;
      return (
        <View testID="room-sheet">
          <Text testID="sheet-assignee">{props.assigneeName ?? "NONE"}</Text>
          <Text testID="sheet-disabled">{String(Boolean(props.actionsDisabled))}</Text>
          <Pressable testID="sheet-assign" onPress={() => props.onAssign(props.room)}><Text>assign</Text></Pressable>
          <Pressable testID="sheet-remove" onPress={() => props.onRemoveAssignment(props.room)}><Text>remove</Text></Pressable>
        </View>
      );
    },
  };
});
jest.mock("@/components/supervisor/HousekeeperPicker", () => {
  const { Pressable, Text } = require("react-native");
  return {
    HousekeeperPicker: ({ visible, staff, onSelect }: { visible: boolean; staff: Array<{ userId: string; name: string }>; onSelect: (m: unknown) => void }) =>
      visible ? (
        <Pressable testID="picker-select" onPress={() => onSelect(staff[0])}>
          <Text>{staff.map((m) => m.name).join(",")}</Text>
        </Pressable>
      ) : null,
  };
});

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
  removeAssignmentByPlan,
  saveAssignments,
} from "@/lib/api/housekeepingSupervisor";
import { fetchBlockedTasks } from "@/lib/api/tasks";
import { hotelDateKey } from "@/lib/housekeeping/hotelTime";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import RoomBoardScreen from "@/app/(app)/room-board/index";
import { STAFF, hotelBoard, rawRoom } from "../helpers/roomBoardFixtures";

const board = fetchBoardVerified as jest.Mock;
const staff = fetchAssignableStaff as jest.Mock;

// A NEW element each call: re-rendering the very same element object would be skipped by React.
const ui = () => (
  <ThemeProvider>
    <RoomBoardScreen />
  </ThemeProvider>
);
const renderBoard = () => render(ui());

beforeEach(() => {
  jest.clearAllMocks();
  mockSheetProps.current = null;
  mockAppState.isOnline = true;
  board.mockResolvedValue(hotelBoard());
  staff.mockResolvedValue(STAFF);
  (fetchShiftRoster as jest.Mock).mockResolvedValue([]);
  (fetchInspectionHistory as jest.Mock).mockResolvedValue([]);
  (fetchLateCheckoutsVerified as jest.Mock).mockResolvedValue([]);
  (fetchBlockedTasks as jest.Mock).mockResolvedValue({ items: [] });
  (saveAssignments as jest.Mock).mockResolvedValue(undefined);
  (removeAssignmentByPlan as jest.Mock).mockResolvedValue(true);
});

describe("Room Board — what it claims", () => {
  it("a failed load is an error with a retry — never 'no rooms' and never a board", async () => {
    board.mockRejectedValue(Object.assign(new Error("down"), { status: 503 }));
    const screen = renderBoard();
    await waitFor(() => expect(screen.getByText("roomBoard.state.unavailableError")).toBeTruthy(), { timeout: 5000 });
    expect(screen.queryByText("roomBoard.state.verifiedEmpty")).toBeNull();
    expect(screen.queryByText("roomBoard.noRoomsLoaded")).toBeNull();
    expect(screen.queryByTestId("room-board-readiness")).toBeNull();
    expect(screen.queryByTestId("board-tile-101")).toBeNull();

    // Retrying recovers the board.
    board.mockResolvedValue(hotelBoard());
    await act(async () => {
      fireEvent.press(screen.getByText("roomBoard.state.retry"));
    });
    await waitFor(() => expect(screen.getByTestId("board-tile-101")).toBeTruthy());
    expect(screen.queryByText("roomBoard.state.unavailableError")).toBeNull();
  });

  it("only a verified board is called a live floor — a failed, stale or empty-by-failure board is not", async () => {
    const screen = renderBoard();
    await waitFor(() => expect(screen.getByTestId("board-tile-101")).toBeTruthy());
    expect(screen.getByTestId("room-board-status-text").props.children).toBe("roomBoard.header.liveNow");
    mockAppState.isOnline = false;
    screen.rerender(ui());
    await waitFor(() => expect(String(screen.getByTestId("room-board-status-text").props.children)).toMatch(/^roomBoard.header.offline/));
    expect(String(screen.getByTestId("room-board-status-text").props.children)).not.toMatch(/liveNow|live[A-Z]/);
  });

  it("a failed load does not say 'live floor' either", async () => {
    board.mockRejectedValue(Object.assign(new Error("down"), { status: 500 }));
    const screen = renderBoard();
    await waitFor(() => expect(screen.getByText("roomBoard.state.unavailableError")).toBeTruthy(), { timeout: 5000 });
    expect(screen.getByTestId("room-board-status-text").props.children).toBe("roomBoard.header.unavailable");
  });

  it("offline with nothing verified says so and does not call the server", async () => {
    mockAppState.isOnline = false;
    const screen = renderBoard();
    await waitFor(() => expect(screen.getByText("roomBoard.state.unavailableOffline")).toBeTruthy());
    expect(board).not.toHaveBeenCalled();
    expect(screen.queryByTestId("board-tile-101")).toBeNull();
  });

  it("a forbidden answer is its own message", async () => {
    board.mockRejectedValue(Object.assign(new Error("no"), { status: 403 }));
    const screen = renderBoard();
    await waitFor(() => expect(screen.getByText("roomBoard.state.unavailableForbidden")).toBeTruthy());
  });

  it("a verified empty hotel is a distinct message", async () => {
    board.mockResolvedValue([]);
    const screen = renderBoard();
    await waitFor(() => expect(screen.getByText("roomBoard.state.verifiedEmpty")).toBeTruthy());
    expect(screen.queryByText("roomBoard.state.unavailableError")).toBeNull();
  });

  it("the headline counts ready rooms against IN-SERVICE rooms (out-of-order rooms are not 'left to clean')", async () => {
    const screen = renderBoard();
    await waitFor(() => expect(screen.getByTestId("board-tile-101")).toBeTruthy());
    // 10 rooms, 3 out of order → 7 in service, 1 inspected, 1 in progress.
    expect(screen.getByTestId("room-board-readiness-headline").props.children).toBe(`roomBoard.card.headline:${JSON.stringify({ ready: 1, total: 7 })}`);
  });

  it("going offline after a good load keeps the rooms but says the board is not live and pauses changes", async () => {
    const screen = renderBoard();
    await waitFor(() => expect(screen.getByTestId("board-tile-101")).toBeTruthy());
    expect(screen.queryByTestId("room-board-not-live")).toBeNull();

    mockAppState.isOnline = false;
    screen.rerender(ui());
    await waitFor(() => expect(screen.getByTestId("room-board-not-live")).toBeTruthy());
    expect(screen.getByText(/roomBoard\.state\.staleOffline/)).toBeTruthy();
    expect(screen.getByTestId("board-tile-101")).toBeTruthy();

    fireEvent.press(screen.getByTestId("board-tile-101"));
    expect(screen.getByTestId("sheet-disabled").props.children).toBe("true");
  });
});

describe("Room Board — assignment correctness", () => {
  it("a room assigned to someone with no known name is still ASSIGNED (never 'unassigned')", async () => {
    board.mockResolvedValue([rawRoom("301", "DIRTY", { assigned_to: "ghost-user", assignment_id: null })]);
    staff.mockResolvedValue(STAFF); // ghost-user is not in the staff list
    const screen = renderBoard();
    await waitFor(() => expect(screen.getByTestId("board-tile-301")).toBeTruthy());
    expect(screen.getByTestId("board-tile-assignee-301").props.children).toBe("roomBoard.assigneeUnknown");
    fireEvent.press(screen.getByTestId("board-tile-301"));
    expect(screen.getByTestId("sheet-assignee").props.children).toBe("roomBoard.assigneeUnknown");
  });

  it("a failed staff list does not turn assigned rooms into unassigned ones", async () => {
    board.mockResolvedValue([rawRoom("301", "DIRTY", { assigned_to: "hk-1", assignment_id: "as-1" })]);
    staff.mockRejectedValue(new Error("staff down"));
    const screen = renderBoard();
    await waitFor(() => expect(screen.getByTestId("board-tile-301")).toBeTruthy());
    expect(screen.getByTestId("board-tile-assignee-301").props.children).toBe("roomBoard.assigneeUnknown");
  });

  it("an unassigned room has no assignee label", async () => {
    board.mockResolvedValue([rawRoom("302", "DIRTY")]);
    const screen = renderBoard();
    await waitFor(() => expect(screen.getByTestId("board-tile-302")).toBeTruthy());
    fireEvent.press(screen.getByTestId("board-tile-302"));
    expect(screen.getByTestId("sheet-assignee").props.children).toBe("NONE");
  });

  it("assigns for the HOTEL's date, then re-reads the board", async () => {
    const screen = renderBoard();
    await waitFor(() => expect(screen.getByTestId("board-tile-101")).toBeTruthy());
    fireEvent.press(screen.getByTestId("board-tile-101"));
    fireEvent.press(screen.getByTestId("sheet-assign"));
    const loads = board.mock.calls.length;
    await act(async () => {
      fireEvent.press(screen.getByTestId("picker-select"));
    });
    const hotelToday = hotelDateKey(new Date(), "America/Chicago");
    expect(saveAssignments).toHaveBeenCalledWith(hotelToday, [{ room_id: "room-101", housekeeper_id: "hk-1" }]);
    await waitFor(() => expect(board.mock.calls.length).toBeGreaterThan(loads));
  });

  it("does not assign while the board cannot be trusted", async () => {
    const screen = renderBoard();
    await waitFor(() => expect(screen.getByTestId("board-tile-101")).toBeTruthy());
    fireEvent.press(screen.getByTestId("board-tile-101"));
    fireEvent.press(screen.getByTestId("sheet-assign"));
    mockAppState.isOnline = false;
    screen.rerender(ui());
    await waitFor(() => expect(screen.getByTestId("room-board-not-live")).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByTestId("picker-select"));
    });
    expect(saveAssignments).not.toHaveBeenCalled();
  });

  it("removes a dated assignment by id and a mirror-only assignment through its room", async () => {
    board.mockResolvedValue([
      rawRoom("401", "DIRTY", { assigned_to: "hk-1", assignment_id: "as-401" }),
      rawRoom("402", "DIRTY", { assigned_to: "hk-2", assignment_id: null }),
    ]);
    const screen = renderBoard();
    await waitFor(() => expect(screen.getByTestId("board-tile-401")).toBeTruthy());

    fireEvent.press(screen.getByTestId("board-tile-401"));
    await act(async () => {
      fireEvent.press(screen.getByTestId("sheet-remove"));
    });
    expect(removeAssignmentByPlan).toHaveBeenLastCalledWith({ kind: "assignment", assignmentId: "as-401" });

    fireEvent.press(screen.getByTestId("board-tile-402"));
    await act(async () => {
      fireEvent.press(screen.getByTestId("sheet-remove"));
    });
    expect(removeAssignmentByPlan).toHaveBeenLastCalledWith({ kind: "mirror", roomId: "room-402" });
  });

  it("does not remove anything while the board is not live", async () => {
    board.mockResolvedValue([rawRoom("401", "DIRTY", { assigned_to: "hk-1", assignment_id: "as-401" })]);
    const screen = renderBoard();
    await waitFor(() => expect(screen.getByTestId("board-tile-401")).toBeTruthy());
    fireEvent.press(screen.getByTestId("board-tile-401"));
    mockAppState.isOnline = false;
    screen.rerender(ui());
    await waitFor(() => expect(screen.getByTestId("room-board-not-live")).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByTestId("sheet-remove"));
    });
    expect(removeAssignmentByPlan).not.toHaveBeenCalled();
  });
});
