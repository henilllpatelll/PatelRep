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
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
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

// Board rows carry room identity nested under rooms(...) — no flat room_number.
const rows = [
  { room_id: "r1", status: "DIRTY", fo_status: "VAC", vip_flag: false, dnd_flag: false, guest_name: null, checkout_time: null, rooms: { room_number: "101", floor: 1 } },
  { room_id: "r2", status: "OCCUPIED", fo_status: "OCC", vip_flag: false, dnd_flag: false, guest_name: "Guest A", checkout_time: null, rooms: { room_number: "102", floor: 1 } },
  { room_id: "r3", status: "CLEAN", fo_status: null, vip_flag: false, dnd_flag: false, guest_name: null, checkout_time: null, rooms: { room_number: "103", floor: 1 } },
  { room_id: "r4", status: "PICKUP", fo_status: null, vip_flag: false, dnd_flag: false, guest_name: "Guest B", checkout_time: null, rooms: { room_number: "204", floor: 2 } },
  { room_id: "r5", status: "OUT_OF_SERVICE", fo_status: "VAC", vip_flag: false, dnd_flag: false, guest_name: null, checkout_time: null, rooms: { room_number: "105", floor: 1 } },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockApiGet.mockResolvedValue({ data: rows });
});

describe("RoomStatusScreen", () => {
  it("renders room numbers from the nested rooms join, grouped by floor", async () => {
    render(<RoomStatusScreen />);
    await waitFor(() => expect(screen.getByText("101")).toBeTruthy());
    expect(screen.getByText("102")).toBeTruthy();
    expect(screen.getByText("103")).toBeTruthy();
    expect(screen.getByText("105")).toBeTruthy();
    expect(screen.getByText("204")).toBeTruthy();
    expect(screen.getAllByText("roomStatus.floorSection")).toHaveLength(2);
  });

  it("offers exactly All / Vacant / Occupied / OOO filters", async () => {
    render(<RoomStatusScreen />);
    await waitFor(() => expect(screen.getByText("101")).toBeTruthy());
    expect(screen.getByTestId("room-filter-all")).toBeTruthy();
    expect(screen.getByTestId("room-filter-VACANT")).toBeTruthy();
    expect(screen.getByTestId("room-filter-OCCUPIED")).toBeTruthy();
    expect(screen.getByTestId("room-filter-OOO")).toBeTruthy();
    expect(screen.queryByTestId("room-filter-DIRTY")).toBeNull();
    expect(screen.queryByTestId("room-filter-CLEAN")).toBeNull();
    expect(screen.queryByTestId("room-filter-INSPECTED")).toBeNull();
  });

  it("Vacant filter hides occupied rooms (FO OCC, OCCUPIED, and PICKUP)", async () => {
    render(<RoomStatusScreen />);
    await waitFor(() => expect(screen.getByText("101")).toBeTruthy());

    fireEvent.press(screen.getByTestId("room-filter-VACANT"));

    expect(screen.getByText("101")).toBeTruthy();
    expect(screen.getByText("103")).toBeTruthy();
    expect(screen.getByText("105")).toBeTruthy();
    expect(screen.queryByText("102")).toBeNull();
    expect(screen.queryByText("204")).toBeNull();
    // Floor 2 had only an occupied room, so its section collapses too.
    expect(screen.getAllByText("roomStatus.floorSection")).toHaveLength(1);
  });

  it("OOO filter shows only out-of-order/out-of-service rooms", async () => {
    render(<RoomStatusScreen />);
    await waitFor(() => expect(screen.getByText("101")).toBeTruthy());

    fireEvent.press(screen.getByTestId("room-filter-OOO"));

    expect(screen.getByText("105")).toBeTruthy();
    expect(screen.queryByText("101")).toBeNull();
    expect(screen.queryByText("102")).toBeNull();
    expect(screen.queryByText("103")).toBeNull();
    expect(screen.queryByText("204")).toBeNull();
  });
});
