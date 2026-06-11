import React from "react";
import { render, waitFor } from "@testing-library/react-native";
import type { Room } from "@/stores/appStore";

const mockSetMyRooms = jest.fn();
const mockEnqueueAction = jest.fn();

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: "room-1",
    room_number: "101",
    floor: 1,
    status: "CLEAN",
    risk_level: null,
    dnd_flag: false,
    guest_name: null,
    predicted_ready_at: null,
    vip_flag: false,
    checkin_time: null,
    checkout_time: null,
    actual_checkout_at: null,
    clean_type: null,
    clean_type_label: null,
    updated_at: "2026-05-25T15:00:00.000Z",
    rooms: { room_types: { name: "King" } },
    ...overrides,
  };
}

let mockRooms: Room[] = [makeRoom()];

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ roomId: "room-1" }),
  router: { back: jest.fn(), push: jest.fn() },
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));
jest.mock("@/components/housekeeping/ReportIssueModal", () => () => null);
jest.mock("@/components/housekeeping/FoundItemModal", () => () => null);
jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn(),
    patch: jest.fn(),
    post: jest.fn(),
  },
}));
jest.mock("@/stores/appStore", () => ({
  useAppStore: () => ({
    isOnline: true,
    myRooms: mockRooms,
    setMyRooms: mockSetMyRooms,
    enqueueAction: mockEnqueueAction,
    user: { id: "user-1" },
  }),
}));

import { api } from "@/lib/api/client";
import RoomDetailScreen from "@/app/(app)/my-rooms/[roomId]";

const mockApiPost = api.post as jest.Mock;
const mockApiGet = api.get as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockRooms = [makeRoom()];
  mockApiGet.mockResolvedValue({
    data: [],
  });
  mockApiPost.mockResolvedValue({
    data: {
      ...mockRooms[0],
      status: "IN_PROGRESS",
    },
  });
});

describe("RoomDetailScreen", () => {
  it("shows a compact last action line instead of full status history", async () => {
    const { getByText, queryByText } = render(<RoomDetailScreen />);

    await waitFor(() => expect(mockApiGet).toHaveBeenCalledWith("/rooms/room-1/history?limit=1"));
    await waitFor(() => expect(getByText(/Last action:/)).toBeTruthy());
    expect(getByText(/Marked clean/)).toBeTruthy();
    expect(queryByText("Status History")).toBeNull();
  });

  it("shows Before you enter near the top for unsafe rooms and does not offer Start", async () => {
    mockRooms = [
      makeRoom({
        // OCCUPIED departure: the only case that warns "Not checked out"
        status: "OCCUPIED",
        clean_type: "DEP",
        clean_type_label: "Departure",
        dnd_flag: true,
        guest_name: "Taylor Guest",
        fo_status: "OCC",
        actual_checkout_at: null,
      }),
    ];

    const { getByText, queryByText } = render(<RoomDetailScreen />);

    await waitFor(() => expect(getByText("Before you enter")).toBeTruthy());
    expect(getByText("DND active")).toBeTruthy();
    expect(getByText("Guest may be inside")).toBeTruthy();
    expect(getByText("Not checked out")).toBeTruthy();
    expect(getByText("Review room")).toBeTruthy();
    expect(queryByText("Start Cleaning")).toBeNull();
  });

  it("shows reservation and timing context", async () => {
    mockRooms = [
      makeRoom({
        status: "DIRTY",
        guest_name: "Taylor Guest",
        fo_status: "VAC",
        clean_type: "DEP",
        actual_checkout_at: "2026-06-09T10:00:00.000Z",
        checkout_time: "2026-06-09T11:00:00.000Z",
        checkin_time: "2026-06-09T16:00:00.000Z",
        predicted_ready_at: "2026-06-09T12:15:00.000Z",
      }),
    ];

    const { getByText } = render(<RoomDetailScreen />);

    await waitFor(() => expect(getByText("Reservation / Timing")).toBeTruthy());
    expect(getByText("Guest")).toBeTruthy();
    expect(getByText("Taylor Guest")).toBeTruthy();
    expect(getByText("FO status")).toBeTruthy();
    expect(getByText("VAC")).toBeTruthy();
    expect(getByText("Check-in")).toBeTruthy();
    expect(getByText("Scheduled checkout")).toBeTruthy();
    expect(getByText("Actual checkout")).toBeTruthy();
    expect(getByText("Predicted ready")).toBeTruthy();
  });

  it("shows a local cleaning checklist based on clean_type", async () => {
    mockRooms = [makeRoom({ status: "IN_PROGRESS", clean_type: "FULL", clean_type_label: "Full" })];

    const { getByLabelText, getByText } = render(<RoomDetailScreen />);

    await waitFor(() => expect(getByText("Cleaning Checklist")).toBeTruthy());
    expect(getByLabelText("Full clean type")).toBeTruthy();
    expect(getByText("Bed made")).toBeTruthy();
    expect(getByText("Towels replaced")).toBeTruthy();
    expect(getByText("Floors cleaned")).toBeTruthy();
  });

  it("keeps room detail actions compact and button-driven", async () => {
    const { getByText } = render(<RoomDetailScreen />);

    await waitFor(() => expect(getByText("Add Note")).toBeTruthy());
    expect(getByText("Work Order")).toBeTruthy();
    expect(getByText("Lost & Found")).toBeTruthy();
    expect(mockApiPost).not.toHaveBeenCalled();
    expect(mockSetMyRooms).not.toHaveBeenCalled();
  });
});
