import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react-native";
import type { Room } from "@/stores/appStore";

const mockSetMyRooms = jest.fn();
const mockEnqueueAction = jest.fn();
let mockIsOnline = true;
let mockRooms: Room[] = [];

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: "room-1",
    room_number: "101",
    floor: 1,
    status: "DIRTY",
    risk_level: null,
    dnd_flag: false,
    guest_name: null,
    predicted_ready_at: null,
    vip_flag: false,
    checkin_time: null,
    checkout_time: null,
    actual_checkout_at: null,
    clean_type: null,
    updated_at: "2026-06-09T15:00:00.000Z",
    ...overrides,
  };
}

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ roomId: "room-1" }),
  router: { push: jest.fn(), back: jest.fn() },
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
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
    isOnline: mockIsOnline,
    myRooms: mockRooms,
    setMyRooms: mockSetMyRooms,
    enqueueAction: mockEnqueueAction,
    user: { id: "user-1" },
  }),
}));

import { api } from "@/lib/api/client";
import RoomDetailScreen from "@/app/(app)/my-rooms/[roomId]";

const mockApiGet = api.get as jest.Mock;
const mockApiPatch = api.patch as jest.Mock;
const mockApiPost = api.post as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockIsOnline = true;
  mockRooms = [makeRoom()];
  mockApiGet.mockResolvedValue({ data: [] });
  mockApiPatch.mockResolvedValue({ data: {} });
  mockApiPost.mockResolvedValue({ data: {} });
});

describe("RoomDetailScreen", () => {
  it("shows Before you enter warnings only when the room has exceptions", async () => {
    mockRooms = [makeRoom({ vip_flag: true, latest_note: "Guest requested feather-free room" })];

    const { getByText } = render(<RoomDetailScreen />);

    await waitFor(() => expect(getByText("Before you enter")).toBeTruthy());
    expect(getByText("VIP room")).toBeTruthy();
    expect(getByText("Guest requested feather-free room")).toBeTruthy();
    expect(getByText("Start Cleaning")).toBeTruthy();
  });

  it("starts a dirty room using the existing status API and optimistic store update", async () => {
    const { getByText } = render(<RoomDetailScreen />);

    fireEvent.press(getByText("Start Cleaning"));

    await waitFor(() => expect(mockApiPatch).toHaveBeenCalledWith("/rooms/room-1/status", { status: "IN_PROGRESS" }));
    expect(mockSetMyRooms).toHaveBeenCalledWith([
      expect.objectContaining({ id: "room-1", status: "IN_PROGRESS" }),
    ]);
  });

  it("queues a status update when starting offline", async () => {
    mockIsOnline = false;
    const { getByText } = render(<RoomDetailScreen />);

    fireEvent.press(getByText("Start Cleaning"));

    await waitFor(() => expect(mockEnqueueAction).toHaveBeenCalledWith({
      type: "room_status",
      entityId: "room-1",
      payload: { status: "IN_PROGRESS" },
    }));
    expect(mockApiPatch).not.toHaveBeenCalled();
  });

  it("submits blocker quick actions as room notes", async () => {
    const { getByText } = render(<RoomDetailScreen />);

    fireEvent.press(getByText("Need Linen"));

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith("/rooms/room-1/notes", { text: "BLOCKER: Need linen" }));
    await waitFor(() => expect(getByText("Note saved")).toBeTruthy());
  });
});
