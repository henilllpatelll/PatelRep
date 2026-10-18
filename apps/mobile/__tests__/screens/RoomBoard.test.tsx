import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn(), setParams: jest.fn() },
  useLocalSearchParams: () => ({}),
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}));
jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@/lib/supabase", () => ({
  supabase: {
    channel: jest.fn().mockReturnValue({
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn().mockReturnValue({}),
    }),
    removeChannel: jest.fn(),
  },
}));
jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));
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
jest.mock("@/lib/utils/date", () => ({
  localDate: () => "2026-06-09",
}));
const mockAppState = {
  isOnline: true,
  hotelTimezone: "America/Chicago",
  user: { id: "u1", role: "housekeeping_supervisor", tenant_id: "h1" },
};
jest.mock("@/stores/appStore", () => ({
  useAppStore: (selector?: (state: unknown) => unknown) => (selector ? selector(mockAppState) : mockAppState),
}));

import { fetchAssignableStaff, fetchBoardVerified as fetchBoard, fetchShiftRoster, fetchInspectionHistory, fetchLateCheckoutsVerified } from "@/lib/api/housekeepingSupervisor";
import { fetchBlockedTasks } from "@/lib/api/tasks";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import RoomBoardScreen from "@/app/(app)/room-board/index";

const mockFetchBoard = fetchBoard as jest.Mock;
const mockFetchAssignableStaff = fetchAssignableStaff as jest.Mock;

function renderScreen() {
  return render(
    <ThemeProvider>
      <RoomBoardScreen />
    </ThemeProvider>,
  );
}

// Board rows carry room identity nested under `rooms` — no flat room_number.
const rows = [
  {
    room_id: "r1",
    status: "DIRTY",
    fo_status: "VAC",
    vip_flag: false,
    dnd_flag: false,
    assigned_to: null,
    rooms: { room_number: "101", floor: 1 },
  },
  {
    room_id: "r2",
    status: "CLEAN",
    fo_status: null,
    vip_flag: false,
    dnd_flag: false,
    assigned_to: null,
    rooms: { room_number: "201", floor: 2 },
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchBoard.mockResolvedValue(rows);
  mockFetchAssignableStaff.mockResolvedValue([]);
  (fetchShiftRoster as jest.Mock).mockResolvedValue([]);
  (fetchInspectionHistory as jest.Mock).mockResolvedValue([]);
  (fetchLateCheckoutsVerified as jest.Mock).mockResolvedValue([]);
  (fetchBlockedTasks as jest.Mock).mockResolvedValue({ items: [] });
});

describe("RoomBoardScreen", () => {
  it("renders without crashing before the board fetch resolves (loading state)", async () => {
    const { toJSON } = renderScreen();
    expect(toJSON()).toBeTruthy();

    // Let the in-flight fetch settle so React state updates aren't left dangling.
    await waitFor(() => expect(mockFetchBoard).toHaveBeenCalled());
  });

  it("renders fetched rooms grouped by floor once loaded (populated state)", async () => {
    renderScreen();

    await waitFor(() => expect(screen.getByTestId("board-tile-101")).toBeTruthy());
    expect(screen.getByTestId("board-tile-201")).toBeTruthy();
  });

  it("labels each room with its status in words (the old colour legend is replaced by on-card labels)", async () => {
    renderScreen();

    await waitFor(() => expect(screen.getByTestId("board-tile-101")).toBeTruthy());
    expect(screen.queryByTestId("color-legend")).toBeNull();
    expect(screen.getByTestId("board-tile-status-101")).toHaveTextContent("roomBoard.card.status.DIRTY");
    expect(screen.getByTestId("board-tile-status-201")).toHaveTextContent("roomBoard.card.status.CLEAN");
  });
});
