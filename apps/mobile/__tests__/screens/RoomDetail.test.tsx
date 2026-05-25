import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react-native";

const mockSetMyRooms = jest.fn();
let mockRooms = [
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
  },
];

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ roomId: "room-1" }),
  router: { back: jest.fn() },
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
  }),
}));

import { api } from "@/lib/api/client";
import RoomDetailScreen from "@/app/(app)/my-rooms/[roomId]";

const mockApiPost = api.post as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockRooms = [{ ...mockRooms[0], status: "CLEAN" }];
  mockApiPost.mockResolvedValue({
    data: {
      ...mockRooms[0],
      status: "IN_PROGRESS",
    },
  });
});

describe("RoomDetailScreen", () => {
  it("calls room status undo when Undo Last Step is pressed", async () => {
    const { getByText } = render(<RoomDetailScreen />);

    await waitFor(() => expect(getByText("rooms.undoLastStep")).toBeTruthy());
    fireEvent.press(getByText("rooms.undoLastStep"));

    await waitFor(() =>
      expect(mockApiPost).toHaveBeenCalledWith("/rooms/room-1/status/undo", {})
    );
    expect(mockSetMyRooms).toHaveBeenCalled();
  });
});
