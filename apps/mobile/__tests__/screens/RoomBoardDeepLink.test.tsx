import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

let mockParams: { roomId?: string } = {};
jest.mock("@/lib/theme/useToast", () => ({ useToast: () => ({ success: jest.fn(), error: jest.fn(), info: jest.fn() }) }));
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn(), setParams: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
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
jest.mock("@/lib/utils/date", () => ({ localDate: () => "2026-06-09" }));
jest.mock("@/components/supervisor/RoomDetailSheet", () => {
  const { Text } = require("react-native");
  return { RoomDetailSheet: ({ room }: { room: { roomNumber: string } }) => <Text testID="room-sheet">{room.roomNumber}</Text> };
});
const mockAppState = {
  isOnline: true,
  hotelTimezone: "America/Chicago",
  user: { id: "u1", role: "housekeeping_supervisor", tenant_id: "h1" },
};
jest.mock("@/stores/appStore", () => ({
  useAppStore: (selector?: (state: unknown) => unknown) => (selector ? selector(mockAppState) : mockAppState),
}));

import { router } from "expo-router";
import { fetchAssignableStaff, fetchBoardVerified as fetchBoard, fetchShiftRoster, fetchInspectionHistory, fetchLateCheckoutsVerified } from "@/lib/api/housekeepingSupervisor";
import { fetchBlockedTasks } from "@/lib/api/tasks";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import RoomBoardScreen from "@/app/(app)/room-board/index";

const board = fetchBoard as jest.Mock;
const staff = fetchAssignableStaff as jest.Mock;
const setParams = (router as unknown as { setParams: jest.Mock }).setParams;

const rows = [
  { room_id: "r1", status: "DIRTY", fo_status: "VAC", vip_flag: false, dnd_flag: false, assigned_to: null, rooms: { room_number: "101", floor: 1 } },
  { room_id: "r2", status: "CLEAN", fo_status: null, vip_flag: false, dnd_flag: false, assigned_to: null, rooms: { room_number: "201", floor: 2 } },
];

const renderBoard = () =>
  render(
    <ThemeProvider>
      <RoomBoardScreen />
    </ThemeProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  board.mockResolvedValue(rows);
  staff.mockResolvedValue([]);
  (fetchShiftRoster as jest.Mock).mockResolvedValue([]);
  (fetchInspectionHistory as jest.Mock).mockResolvedValue([]);
  (fetchLateCheckoutsVerified as jest.Mock).mockResolvedValue([]);
  (fetchBlockedTasks as jest.Mock).mockResolvedValue({ items: [] });
});

describe("Room Board deep link (?roomId=)", () => {
  it("opens the linked room once the board has loaded, then drops the single-use param", async () => {
    mockParams = { roomId: "r2" };
    const screen = renderBoard();
    await waitFor(() => expect(screen.getByTestId("room-sheet")).toHaveTextContent("201"));
    expect(screen.queryByTestId("room-board-link-missing")).toBeNull();
    expect(setParams).toHaveBeenCalledWith({ roomId: undefined });
  });

  it("says so — and opens nothing else — when the room is not on the board", async () => {
    mockParams = { roomId: "gone-room" };
    const screen = renderBoard();
    await waitFor(() => expect(screen.getByTestId("room-board-link-missing")).toBeTruthy());
    expect(screen.queryByTestId("room-sheet")).toBeNull();
    fireEvent.press(screen.getByTestId("room-board-link-missing-close"));
    expect(screen.queryByTestId("room-board-link-missing")).toBeNull();
  });

  it("does not judge the link against a board that failed to load", async () => {
    board.mockRejectedValue(new Error("down"));
    mockParams = { roomId: "r2" };
    const screen = renderBoard();
    await waitFor(() => expect(board).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByTestId("room-board-link-missing")).toBeNull();
    expect(screen.queryByTestId("room-sheet")).toBeNull();
    expect(setParams).not.toHaveBeenCalled();
  });

  it("does nothing special without a link", async () => {
    const screen = renderBoard();
    await waitFor(() => expect(screen.getByTestId("board-tile-101")).toBeTruthy());
    expect(screen.queryByTestId("room-sheet")).toBeNull();
    expect(screen.queryByTestId("room-board-link-missing")).toBeNull();
  });
});
