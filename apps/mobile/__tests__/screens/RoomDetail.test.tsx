import React from "react";
import { render, waitFor } from "@testing-library/react-native";
import type { Room } from "@/stores/appStore";

const mockSetMyRooms = jest.fn();
const mockEnqueueAction = jest.fn();
let mockRooms: Room[] = [
  {
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
    updated_at: "2026-05-25T15:00:00.000Z",
  },
];

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
jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn(),
    patch: jest.fn(),
    post: jest.fn(),
  },
}));
jest.mock("@/lib/offline/db", () => ({
  enqueueAction: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/stores/appStore", () => ({
  useAppStore: () => ({
    isOnline: true,
    myRooms: mockRooms,
    setMyRooms: mockSetMyRooms,
    enqueueAction: mockEnqueueAction,
  }),
}));

import { api } from "@/lib/api/client";
import RoomDetailScreen from "@/app/(app)/my-rooms/[roomId]";

const mockApiPost = api.post as jest.Mock;
const mockApiGet = api.get as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockRooms = [{ ...mockRooms[0], status: "CLEAN" }];
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

  it("keeps room detail actions compact and button-driven", async () => {
    const { getByText } = render(<RoomDetailScreen />);

    await waitFor(() => expect(getByText("Add Note")).toBeTruthy());
    expect(getByText("Work Order")).toBeTruthy();
    expect(getByText("Lost & Found")).toBeTruthy();
    expect(mockApiPost).not.toHaveBeenCalled();
    expect(mockSetMyRooms).not.toHaveBeenCalled();
  });

  it("restores the reviewed room workflow inside the redesigned detail screen", async () => {
    mockRooms = [{
      ...mockRooms[0],
      status: "DIRTY",
      clean_type: "DEP",
      dnd_flag: true,
      actual_checkout_at: null,
    }];

    const { getByText } = render(<RoomDetailScreen />);

    await waitFor(() => expect(getByText("Before you enter")).toBeTruthy());
    expect(getByText("DND active")).toBeTruthy();
    expect(getByText("Not checked out")).toBeTruthy();
    expect(getByText("Quick blockers")).toBeTruthy();
    expect(getByText("Start Cleaning")).toBeTruthy();
  });
});
