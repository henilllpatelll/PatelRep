import React from "react";
import { render, fireEvent, waitFor, screen } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({}),
  router: { push: jest.fn() },
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));
jest.mock("@/lib/api/client", () => ({
  api: { get: jest.fn() },
}));
jest.mock("@/stores/appStore", () => ({
  useAppStore: () => ({ isOnline: true }),
}));

import { api } from "@/lib/api/client";
import RoomStatusScreen from "@/app/(app)/room-status/index";

const mockApiGet = api.get as jest.Mock;

const rooms = [
  { id: "r1", room_number: "101", floor: 1, status: "DIRTY", fo_status: "VAC", vip_flag: false, dnd_flag: false, guest_name: null, checkout_time: null },
  { id: "r2", room_number: "102", floor: 1, status: "OCCUPIED", fo_status: "OCC", vip_flag: false, dnd_flag: false, guest_name: "Guest A", checkout_time: null },
  { id: "r3", room_number: "103", floor: 1, status: "CLEAN", fo_status: null, vip_flag: false, dnd_flag: false, guest_name: null, checkout_time: null },
  { id: "r4", room_number: "104", floor: 1, status: "PICKUP", fo_status: null, vip_flag: false, dnd_flag: false, guest_name: "Guest B", checkout_time: null },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockApiGet.mockResolvedValue({ data: rooms });
});

describe("RoomStatusScreen", () => {
  it("lists all rooms by default", async () => {
    render(<RoomStatusScreen />);
    await waitFor(() => expect(screen.getByText("101")).toBeTruthy());
    expect(screen.getByText("102")).toBeTruthy();
    expect(screen.getByText("103")).toBeTruthy();
    expect(screen.getByText("104")).toBeTruthy();
  });

  it("Vacant filter hides occupied rooms (FO OCC, OCCUPIED, and PICKUP)", async () => {
    render(<RoomStatusScreen />);
    await waitFor(() => expect(screen.getByText("101")).toBeTruthy());

    fireEvent.press(screen.getByTestId("room-filter-VACANT"));

    expect(screen.getByText("101")).toBeTruthy();
    expect(screen.getByText("103")).toBeTruthy();
    expect(screen.queryByText("102")).toBeNull();
    expect(screen.queryByText("104")).toBeNull();
  });
});
