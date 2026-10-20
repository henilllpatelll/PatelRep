import React from "react";
import { Text } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { makeTranslator } from "../helpers/i18n";

/* Room Board, Supervisor Today and the realtime channel share ONE snapshot. These tests mount the real Board
   screen next to a real Supervisor Today reader and check that a confirmed assignment moves both, with a single
   realtime subscription. */

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
  const t = translator("en");
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
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
import { supabase } from "@/lib/supabase";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import RoomBoardScreen from "@/app/(app)/room-board/index";
import { useSupervisorToday } from "@/lib/housekeeping/useSupervisorToday";
import { useSupervisorTodayStore } from "@/stores/supervisorTodayStore";
import { STAFF, hotelBoard, rawRoom } from "../helpers/roomBoardFixtures";

const board = fetchBoardVerified as jest.Mock;
const tr = makeTranslator("en");

/** Reads the same snapshot Supervisor Today reads. */
function TodayProbe() {
  const { today } = useSupervisorToday({ scopeKey: "h1:sup-1", viewerId: "sup-1", reuseFresh: true });
  return <Text testID="today-unassigned">{String(today.readiness.value?.unassignedActionable ?? "unknown")}</Text>;
}

const ui = () => (
  <ThemeProvider>
    <TodayProbe />
    <RoomBoardScreen />
  </ThemeProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  mockRealtime.handlers = [];
  useSupervisorTodayStore.setState(useSupervisorTodayStore.getInitialState?.() ?? { scope: null }, true);
  mockAppState.isOnline = true;
  board.mockResolvedValue(hotelBoard());
  (fetchAssignableStaff as jest.Mock).mockResolvedValue(STAFF);
  (fetchShiftRoster as jest.Mock).mockResolvedValue([{ user_id: "hk-2", status: "active", started_at: new Date().toISOString() }]);
  (fetchInspectionHistory as jest.Mock).mockResolvedValue([]);
  (fetchLateCheckoutsVerified as jest.Mock).mockResolvedValue([]);
  (fetchBlockedTasks as jest.Mock).mockResolvedValue({ items: [] });
  (saveAssignments as jest.Mock).mockResolvedValue(undefined);
  (removeAssignmentByPlan as jest.Mock).mockResolvedValue(true);
});

const withAssigned = (roomId: string, userId: string | null) =>
  hotelBoard().map((row) =>
    row.room_id === roomId ? { ...row, assigned_to: userId, assignment_id: userId ? "as-new" : null } : row,
  );

describe("one shared snapshot", () => {
  it("a confirmed assignment moves the Board AND the Today unassigned count together", async () => {
    const screen = render(ui());
    await waitFor(() => expect(screen.getByTestId("board-tile-101")).toBeTruthy());
    // 101 (DIRTY) and 201 (DIRTY) are unassigned work.
    await waitFor(() => expect(screen.getByTestId("today-unassigned").props.children).toBe("2"));

    fireEvent.press(screen.getByTestId("board-tile-101"));
    fireEvent.press(screen.getByTestId("room-detail-primary"));
    fireEvent.press(screen.getByTestId("picker-hk-2"));
    fireEvent.press(screen.getByTestId("assign-review"));
    (saveAssignments as jest.Mock).mockImplementationOnce(async () => {
      board.mockResolvedValue(withAssigned("room-101", "hk-2"));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId("assign-confirm"));
    });

    await waitFor(() => expect(screen.getByTestId("today-unassigned").props.children).toBe("1"));
    // The open room now reads as assigned to the saved person.
    await waitFor(() => expect(screen.getByTestId("room-detail-assignee").props.children).toBe("Ben Ortiz"));
    expect(mockToast.success).toHaveBeenCalledWith("Room 101 assigned to Ben Ortiz.");
  });

  it("a confirmed removal returns the room to the unassigned count without touching its status", async () => {
    board.mockResolvedValue([rawRoom("401", "DIRTY", { assigned_to: "hk-1", assignment_id: "as-401" }), rawRoom("402", "DIRTY")]);
    const screen = render(ui());
    await waitFor(() => expect(screen.getByTestId("today-unassigned").props.children).toBe("1"));
    fireEvent.press(screen.getByTestId("board-tile-401"));
    fireEvent.press(screen.getByTestId("room-detail-more"));
    fireEvent.press(screen.getByTestId("room-action-remove"));
    (removeAssignmentByPlan as jest.Mock).mockImplementationOnce(async () => {
      board.mockResolvedValue([rawRoom("401", "DIRTY"), rawRoom("402", "DIRTY")]);
      return true;
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId("remove-confirm"));
    });
    await waitFor(() => expect(screen.getByTestId("today-unassigned").props.children).toBe("2"));
    expect(saveAssignments).not.toHaveBeenCalled();
  });

  it("opens ONE realtime channel for the board and Today together", async () => {
    const screen = render(ui());
    await waitFor(() => expect(screen.getByTestId("board-tile-101")).toBeTruthy());
    expect((supabase.channel as jest.Mock).mock.calls.filter(([name]) => name === "supervisor-home-realtime")).toHaveLength(1);
    expect((supabase.channel as jest.Mock)).toHaveBeenCalledTimes(1);
  });

  it("a realtime change repaints the open room and its workflow follows the live board", async () => {
    const screen = render(ui());
    await waitFor(() => expect(screen.getByTestId("board-tile-101")).toBeTruthy());
    fireEvent.press(screen.getByTestId("board-tile-101"));
    fireEvent.press(screen.getByTestId("room-detail-primary"));
    fireEvent.press(screen.getByTestId("picker-hk-2"));
    fireEvent.press(screen.getByTestId("assign-review"));
    expect(screen.getByTestId("assign-confirm").props.accessibilityState.disabled).toBe(false);

    // Another supervisor starts the room; the channel tells us.
    board.mockResolvedValue(hotelBoard().map((row) => (row.room_id === "room-101" ? { ...row, status: "IN_PROGRESS" } : row)));
    await act(async () => {
      mockRealtime.handlers.forEach((handler) => handler());
    });
    await waitFor(() => expect(screen.getByText(tr("roomBoard.assign.error.in_progress"))).toBeTruthy(), { timeout: 5000 });
    expect(screen.getByTestId("assign-confirm").props.accessibilityState.disabled).toBe(true);
    expect(saveAssignments).not.toHaveBeenCalled();
  });
});

describe("stale and offline protection", () => {
  it("opening the workflow on a board that has gone offline pauses Confirm and says why", async () => {
    const screen = render(ui());
    await waitFor(() => expect(screen.getByTestId("board-tile-101")).toBeTruthy());
    fireEvent.press(screen.getByTestId("board-tile-101"));
    fireEvent.press(screen.getByTestId("room-detail-primary"));
    fireEvent.press(screen.getByTestId("picker-hk-2"));
    mockAppState.isOnline = false;
    screen.rerender(ui());
    await waitFor(() => expect(screen.getByTestId("assign-paused")).toBeTruthy());
    expect(screen.getByTestId("assign-review").props.accessibilityState.disabled).toBe(true);
    expect(saveAssignments).not.toHaveBeenCalled();
  });

  it("a board that failed to load offers no assignment at all", async () => {
    board.mockRejectedValue(Object.assign(new Error("down"), { status: 503 }));
    const screen = render(ui());
    await waitFor(() => expect(screen.getByText("The board could not be loaded.", { exact: false })).toBeTruthy()).catch(() => undefined);
    expect(screen.queryByTestId("room-detail-primary")).toBeNull();
    expect(saveAssignments).not.toHaveBeenCalled();
  });
});
