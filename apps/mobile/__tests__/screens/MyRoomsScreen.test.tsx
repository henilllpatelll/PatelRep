import React from "react";
import { render, waitFor } from "@testing-library/react-native";

const mockRouterPush = jest.fn();
const mockSetMyRooms = jest.fn();
const mockEnqueueAction = jest.fn();

let mockRooms = [
  {
    id: "room-1",
    room_number: "101",
    floor: 1,
    status: "DIRTY",
    risk_level: null,
    dnd_flag: false,
    guest_name: null,
    predicted_ready_at: null,
    vip_flag: true,
    checkin_time: null,
    checkout_time: null,
    actual_checkout_at: null,
    clean_type: "DEP",
    clean_type_label: "Departure",
  },
];

const mockStore = {
  isOnline: true,
  myRooms: mockRooms,
  setMyRooms: mockSetMyRooms,
  enqueueAction: mockEnqueueAction,
};

jest.mock("expo-router", () => ({
  router: { push: mockRouterPush },
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
jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn(),
    patch: jest.fn(),
    post: jest.fn(),
  },
}));
jest.mock("@/lib/offline/db", () => ({
  getRooms: jest.fn().mockResolvedValue([]),
  upsertRooms: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/lib/utils/date", () => ({
  localDate: () => "2026-06-09",
}));
jest.mock("@/stores/appStore", () => ({
  useAppStore: Object.assign(
    () => mockStore,
    {
      getState: () => ({
        myRooms: mockRooms,
        setMyRooms: mockSetMyRooms,
      }),
    },
  ),
}));

import { api } from "@/lib/api/client";
import MyRoomsScreen from "@/app/(app)/my-rooms";

const mockApiGet = api.get as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockRooms = [{ ...mockRooms[0], status: "DIRTY", vip_flag: true }];
  mockStore.myRooms = mockRooms;
  mockApiGet.mockResolvedValue({ data: mockRooms });
});

describe("MyRoomsScreen", () => {
  it("keeps exception rooms in the redesigned list but routes them through review", async () => {
    const { getByText, queryByText } = render(<MyRoomsScreen />);

    await waitFor(() => expect(mockApiGet).toHaveBeenCalledWith("/housekeeping/my-rooms?date=2026-06-09"));

    expect(getByText("101")).toBeTruthy();
    expect(getByText("VIP")).toBeTruthy();
    expect(getByText("Review")).toBeTruthy();
    expect(queryByText("Start")).toBeNull();
  });
});
