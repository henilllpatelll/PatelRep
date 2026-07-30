import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn() },
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
  fetchBoard: jest.fn(),
  fetchAssignableStaff: jest.fn(),
  saveAssignments: jest.fn(),
  removeAssignment: jest.fn(),
}));
jest.mock("@/lib/utils/date", () => ({
  localDate: () => "2026-06-09",
}));
jest.mock("@/stores/appStore", () => ({
  useAppStore: () => ({
    isOnline: true,
    user: { id: "u1", role: "housekeeping_supervisor", tenant_id: "h1" },
  }),
}));

import { fetchAssignableStaff, fetchBoard } from "@/lib/api/housekeepingSupervisor";
import RoomBoardScreen from "@/app/(app)/room-board/index";

const mockFetchBoard = fetchBoard as jest.Mock;
const mockFetchAssignableStaff = fetchAssignableStaff as jest.Mock;

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
});

describe("RoomBoardScreen", () => {
  it("renders without crashing before the board fetch resolves (loading state)", async () => {
    const { toJSON } = render(<RoomBoardScreen />);
    expect(toJSON()).toBeTruthy();

    // Let the in-flight fetch settle so React state updates aren't left dangling.
    await waitFor(() => expect(mockFetchBoard).toHaveBeenCalled());
  });

  it("renders fetched rooms grouped by floor once loaded (populated state)", async () => {
    render(<RoomBoardScreen />);

    await waitFor(() => expect(screen.getByTestId("board-tile-101")).toBeTruthy());
    expect(screen.getByTestId("board-tile-201")).toBeTruthy();
  });

  it("renders the status color legend", async () => {
    render(<RoomBoardScreen />);

    await waitFor(() => expect(screen.getByTestId("board-tile-101")).toBeTruthy());
    expect(screen.getByTestId("color-legend")).toBeTruthy();
  });
});
